import crypto from "node:crypto";
import nodemailer from "nodemailer";

const SEC = crypto.createHash("sha256").update(process.env.DB_PASSWORD || "sendemail-secret").digest();

function decryptCreds(raw) {
  if (!raw) return {};
  const [ivH, tagH, encH] = String(raw).split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", SEC, Buffer.from(ivH, "hex"));
  d.setAuthTag(Buffer.from(tagH, "hex"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(encH, "hex")), d.final()]).toString("utf8"));
}

function buildHeaders(mode, tenantId, recipient) {
  if (mode !== "campaign") return {};
  const unsub = `https://app.sendemail.ai/api/v1/public/unsubscribe?t=${tenantId}&e=${encodeURIComponent(recipient)}`;
  return { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

async function sendByoGmail(creds, { fromName, fromEmail, recipients, subject, html, text, headers }) {
  let token = creds.access_token;
  if (creds.refresh_token && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: creds.refresh_token, grant_type: "refresh_token" })
    });
    const j = await r.json();
    if (j.access_token) token = j.access_token;
  }
  if (!token) throw new Error("GMAIL_OAUTH_TOKEN_MISSING");
  const tx = nodemailer.createTransport({ streamTransport: true, newline: "unix" });
  const built = await tx.sendMail({ from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail, to: recipients.join(", "), subject, html: html || undefined, text: text || undefined, headers });
  const chunks = [];
  for await (const c of built.message) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data.id || "gmail_sent";
}

export async function dispatchViaChannel(pool, { tenantId, channelId, mode, fromName, fromEmail, recipients, subject, html, text }) {
  const [rows] = channelId
    ? await pool.query("SELECT * FROM sending_channels WHERE id=? AND tenant_id=? AND status='active' LIMIT 1", [channelId, tenantId])
    : await pool.query("SELECT * FROM sending_channels WHERE tenant_id=? AND status='active' ORDER BY is_default DESC, (weight * RAND()) DESC", [tenantId]);
  if (!rows.length) return null;

  const headers = buildHeaders(mode, tenantId, recipients[0] || "");
  for (const ch of rows) {
    if (ch.daily_limit !== null && ch.daily_sent + recipients.length > ch.daily_limit) continue;
    if (ch.provider_type === "platform_transactional" || ch.provider_type === "platform_marketing") {
      await pool.query("UPDATE sending_channels SET daily_sent=daily_sent+? WHERE id=?", [recipients.length, ch.id]);
      return null;
    }
    try {
      const creds = decryptCreds(ch.encrypted_credentials);
      const effFrom = ch.from_email || fromEmail;
      const effName = ch.from_name || fromName;
      let msgId = "sent";
      if (ch.provider_type === "byo_google_oauth") {
        msgId = await sendByoGmail(creds, { fromName: effName, fromEmail: effFrom, recipients, subject, html, text, headers });
      } else if (ch.provider_type === "byo_smtp") {
        const domain = String(effFrom).split("@")[1]?.toLowerCase() || "";
        const [domRows] = await pool.query("SELECT dkim_selector,dkim_private_key FROM sending_domains WHERE tenant_id=? AND domain=? AND dkim_private_key IS NOT NULL LIMIT 1", [tenantId, domain]);
        const dkim = domRows.length ? { domainName: domain, keySelector: domRows[0].dkim_selector, privateKey: domRows[0].dkim_private_key } : undefined;
        const tx = nodemailer.createTransport({ host: creds.host, port: Number(creds.port || 587), secure: Number(creds.port) === 465, auth: creds.user ? { user: creds.user, pass: creds.pass } : undefined, dkim });
        const info = await tx.sendMail({ from: effName ? `"${effName}" <${effFrom}>` : effFrom, to: recipients.join(", "), subject, html: html || undefined, text: text || undefined, headers });
        msgId = info.messageId || "smtp_sent";
      }
      await pool.query("UPDATE sending_channels SET consecutive_failures=0,last_error=NULL,daily_sent=daily_sent+? WHERE id=?", [recipients.length, ch.id]);
      return { channelId: ch.id, providerType: ch.provider_type, messageId: msgId };
    } catch (err) {
      const fails = Number(ch.consecutive_failures || 0) + 1;
      const nextSt = fails >= 3 ? "error" : "active";
      await pool.query("UPDATE sending_channels SET consecutive_failures=?,status=?,last_error=? WHERE id=?", [fails, nextSt, String(err.message || err).slice(0, 500), ch.id]);
      if (channelId) throw err;
    }
  }
  return null;
}
