import { startAbScheduler } from "./ab_scheduler.js";
import { startDagWorker } from './dag_engine.js';
import mysql from 'mysql2/promise';
import { Worker } from 'bullmq';
import { dispatchViaChannel } from './channel_dispatcher.js';
import { emitWebhookEvent, isHardBounceError } from './webhook_emitter.js';
import { startQuotaScheduler } from './quota_scheduler.js';
import { startDnsPoller } from './dns_poller.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'global-mariadb',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'sendemail_saas',
  user: process.env.DB_USER || 'sendemail_user',
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10
});

const redisConnection = {
  host: process.env.REDIS_HOST || 'global-redis',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD,
  db: Number(process.env.REDIS_DB || 14)
};

const CHECKEMAIL_URL = process.env.CHECKEMAIL_INTERNAL_URL || 'http://checkemail-docker-web-1:3000/api/v1/verify';
const MAILWIZZ_URL = process.env.MAILWIZZ_INTERNAL_URL || 'http://php-site-03/api';

function mapVerdict(v) {
  const s = String(v || '').toUpperCase();
  if (s === 'ALLOW' || s === 'SAFE' || s === 'VALID') return 'allow';
  if (s === 'BLOCK' || s === 'INVALID' || s === 'DISPOSABLE') return 'block';
  return 'review';
}

async function verifyEmailInternal(email) {
  const res = await fetch(CHECKEMAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Service': 'sendemail-worker' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error(`checkemail HTTP ${res.status}`);
  return res.json();
}

async function mwPostForm(endpoint, apiKey, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const res = await fetch(`${MAILWIZZ_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Host': 'www.sendemail.ai', 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') throw new Error(`MailWizz ${endpoint}: ${JSON.stringify(data)}`);
  return data;
}

const verifyWorker = new Worker('email-verify', async (job) => {
  const { batchId, resultId, id, email } = job.data;
  const targetId = resultId || id;
  await pool.query('UPDATE verification_batches SET status = "processing" WHERE id = ? AND status = "queued"', [batchId]);
  let verdict = 'error', riskScore = null, rawJson = null;
  try {
    const data = await verifyEmailInternal(email);
    verdict = mapVerdict(data.verdict);
    riskScore = typeof data.risk_score === 'number' ? data.risk_score : null;
    rawJson = JSON.stringify(data);
  } catch (err) {
    rawJson = JSON.stringify({ error: err.message });
  }
  await pool.query('UPDATE verification_results SET verdict = ?, risk_score = ?, raw_response = ? WHERE id = ?', [verdict, riskScore, rawJson, targetId]);
  const col = verdict === 'allow' ? 'safe_count' : verdict === 'block' ? 'blocked_count' : 'review_count';
  await pool.query(`UPDATE verification_batches SET processed_count = processed_count + 1, ${col} = ${col} + 1, status = IF(processed_count + 1 >= total_count, 'completed', 'processing') WHERE id = ?`, [batchId]);
}, { connection: redisConnection, concurrency: 8 });

const dispatchWorker = new Worker('email-dispatch', async (job) => {
  const { dispatchUid, tenantId, channelId, mwApiKey, mode, subject, html, text, fromName, fromEmail, recipients, skipVerification } = job.data;
  const recList = Array.isArray(recipients) ? recipients : [];

  try {
    let valid = [...recList];
    if (!skipVerification) {
      const checked = [];
      for (const addr of valid) {
        const res = await verifyEmailInternal(addr);
        if (mapVerdict(res.verdict) !== 'block') {
          checked.push(addr);
        } else {
          await emitWebhookEvent(pool, {
            tenantId,
            dispatchUid,
            eventType: 'hard_bounce',
            email: addr,
            reason: `Pre-send verification blocked (${res.verdict})`
          });
        }
      }
      valid = checked;
    }

    if (valid.length === 0) {
      await pool.query('UPDATE email_dispatches SET status = "failed", error_message = ? WHERE dispatch_uid = ?', ['ALL_RECIPIENTS_BLOCKED', dispatchUid]);
      return;
    }

    if (tenantId || channelId) {
      const chRes = await dispatchViaChannel(pool, { tenantId, channelId, mode, fromName, fromEmail, recipients: valid, subject, html, text });
      if (chRes) {
        const msgId = chRes.messageId.slice(0, 120);
        await pool.query('UPDATE email_dispatches SET status = "sent", mw_reference_uid = ? WHERE dispatch_uid = ?', [msgId, dispatchUid]);
        for (const addr of valid) {
          await emitWebhookEvent(pool, { tenantId, dispatchUid, eventType: 'delivered', email: addr, messageId: msgId });
        }
        return;
      }
    }

    if (!mwApiKey) {
      await pool.query('UPDATE email_dispatches SET status = "failed", error_message = ? WHERE dispatch_uid = ?', ['MISSING_MAILWIZZ_API_KEY', dispatchUid]);
      for (const addr of valid) {
        await emitWebhookEvent(pool, { tenantId, dispatchUid, eventType: 'failed', email: addr, reason: 'MISSING_MAILWIZZ_API_KEY' });
      }
      return;
    }

    if (mode === 'transactional') {
      const toAddr = valid[0];
      const mwRes = await mwPostForm('/transactional-emails', mwApiKey, {
        'email[to_name]': toAddr.split('@')[0], 'email[to_email]': toAddr,
        'email[from_name]': fromName, 'email[from_email]': fromEmail, 'email[subject]': subject,
        'email[body]': Buffer.from(html || text).toString('base64'),
        'email[plain_text]': Buffer.from(text || subject).toString('base64')
      });
      const uid = mwRes?.data?.email_uid || mwRes?.data?.record?.email_uid || 'sent';
      await pool.query('UPDATE email_dispatches SET status = "sent", mw_reference_uid = ? WHERE dispatch_uid = ?', [uid, dispatchUid]);
      await emitWebhookEvent(pool, { tenantId, dispatchUid, eventType: 'delivered', email: toAddr, messageId: uid });
    } else {
      const listRes = await mwPostForm('/lists', mwApiKey, {
        'general[name]': `SaaS_${dispatchUid.slice(0, 8)}`, 'general[description]': 'SaaS Campaign',
        'company[name]': 'SendEmail.ai', 'company[country_id]': '223', 'company[address_1]': '100 Market St', 'company[city]': 'San Francisco', 'company[zip_code]': '94105', 'defaults[from_name]': fromName, 'defaults[from_email]': fromEmail, 'defaults[reply_to]': fromEmail, 'defaults[subject]': subject
      });
      const listUid = listRes?.list_uid || listRes?.data?.record?.general?.list_uid || listRes?.data?.list_uid;
      for (const addr of valid) {
        await mwPostForm(`/lists/${listUid}/subscribers`, mwApiKey, { EMAIL: addr, FNAME: addr.split('@')[0] });
      }
      const sendAt = new Date(Date.now() + 60000).toISOString().slice(0, 19).replace('T', ' ');
      let rawHtml = html || `<p>${text}</p>`;
      if (!rawHtml.includes('[UNSUBSCRIBE_URL]') || !rawHtml.includes('[COMPANY_FULL_ADDRESS]')) {
        rawHtml += '<hr style="margin-top:24px;border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888">[COMPANY_FULL_ADDRESS] | <a href="[UNSUBSCRIBE_URL]">Unsubscribe</a></p>';
      }
      const campRes = await mwPostForm('/campaigns', mwApiKey, {
        'campaign[name]': `Dispatch_${dispatchUid.slice(0, 8)}`, 'campaign[type]': 'regular',
        'campaign[from_name]': fromName, 'campaign[from_email]': fromEmail, 'campaign[subject]': subject,
        'campaign[reply_to]': fromEmail, 'campaign[send_at]': sendAt, 'campaign[list_uid]': listUid,
        'campaign[template][content]': Buffer.from(rawHtml).toString('base64'),
        'campaign[template][plain_text]': Buffer.from(text || subject).toString('base64'),
        'campaign[template][auto_plain_text]': 'yes'
      });
      const campUid = campRes?.campaign_uid || campRes?.data?.record?.campaign_uid || campRes?.data?.campaign_uid || listUid;
      await pool.query('UPDATE email_dispatches SET status = "sent", mw_reference_uid = ? WHERE dispatch_uid = ?', [campUid, dispatchUid]);
      for (const addr of valid) {
        await emitWebhookEvent(pool, { tenantId, dispatchUid, eventType: 'delivered', email: addr, messageId: campUid });
      }
    }
  } catch (err) {
    const errMsg = String(err.message || err).slice(0, 1000);
    await pool.query('UPDATE email_dispatches SET status = "failed", error_message = ? WHERE dispatch_uid = ?', [errMsg, dispatchUid]);
    const evType = isHardBounceError(errMsg) ? 'hard_bounce' : 'failed';
    for (const addr of recList) {
      await emitWebhookEvent(pool, { tenantId, dispatchUid, eventType: evType, email: addr, reason: errMsg });
    }
  }
}, { connection: redisConnection, concurrency: 3 });

for (const ev of ['SIGTERM', 'SIGINT']) {
  process.on(ev, async () => { clearInterval(quotaTimer); clearInterval(dnsTimer); await verifyWorker.close(); await dispatchWorker.close(); await dagWorker.close(); process.exit(0); });
}
const quotaTimer = startQuotaScheduler(pool);
const dnsTimer = startDnsPoller(pool);
const abTimer = startAbScheduler(pool);
const { dagWorker } = startDagWorker(pool, redisConnection);
console.log('sendemail-worker started');
