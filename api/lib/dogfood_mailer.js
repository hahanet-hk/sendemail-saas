import crypto from 'node:crypto';
import { sha256 } from '../auth.js';

export async function issueAuthToken(pool, { userId, tenantId = null, email, purpose, ttlMinutes = 30 }) {
  const rawToken = crypto.randomBytes(24).toString('hex');
  await pool.query(
    'INSERT INTO sendemail_saas.auth_verification_tokens (user_id, tenant_id, email, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [userId, tenantId, email, purpose, sha256(rawToken), ttlMinutes]
  );
  return rawToken;
}

export async function sendDogfoodEmail(pool, dispatchQueue, { to, fromEmail = 'no-reply@sendemail.ai', fromName = 'SendEmail.ai', subject, htmlBody, textBody }) {
  let [[sysTenant]] = await pool.query('SELECT id, mw_api_key FROM sendemail_saas.tenants WHERE email = "system@sendemail.ai" LIMIT 1');
  const [[adminTenant]] = await pool.query('SELECT mw_api_key FROM sendemail_saas.tenants WHERE id = 1 OR email = "admin@sendemail.ai" ORDER BY id ASC LIMIT 1');
  const effectiveMwKey = sysTenant?.mw_api_key || adminTenant?.mw_api_key || null;

  if (!sysTenant) {
    const [ins] = await pool.query(
      'INSERT INTO sendemail_saas.tenants (name, email, api_token, mw_api_key, credit_balance, monthly_quota, status, email_verified) VALUES ("SendEmail System", "system@sendemail.ai", ?, ?, 999999, 999999, "active", 1)',
      ['se_sys_' + crypto.randomBytes(16).toString('hex'), effectiveMwKey]
    );
    sysTenant = { id: ins.insertId, mw_api_key: effectiveMwKey };
  } else if (!sysTenant.mw_api_key && effectiveMwKey) {
    await pool.query('UPDATE sendemail_saas.tenants SET mw_api_key = ? WHERE id = ?', [effectiveMwKey, sysTenant.id]);
  }

  const dispatchUid = 'sys_' + crypto.randomBytes(10).toString('hex');
  const plainText = textBody || String(htmlBody || subject).replace(/<[^>]+>/g, ' ').trim();
  await pool.query(
    'INSERT INTO sendemail_saas.email_dispatches (tenant_id, dispatch_uid, mode, subject, recipient_count, status, created_at) VALUES (?, ?, "transactional", ?, 1, "queued", NOW())',
    [sysTenant.id, dispatchUid, subject]
  );

  if (dispatchQueue) {
    await dispatchQueue.add('dispatch-email', {
      dispatchUid,
      tenantId: sysTenant.id,
      mwApiKey: effectiveMwKey,
      channelId: null,
      mode: 'transactional',
      subject,
      html: htmlBody,
      text: plainText,
      fromName,
      fromEmail,
      recipients: [to],
      skipVerification: true
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 2000 });
  }
  return { dispatchUid, to, subject };
}
