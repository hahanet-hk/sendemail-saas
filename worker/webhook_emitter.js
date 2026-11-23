import crypto from "node:crypto";
import { validateSafeWebhookUrl } from "./ssrf_guard.js";

const SUPPRESS_EVENTS = new Set(["hard_bounce", "complained", "unsubscribed"]);

export function isHardBounceError(errMsg) {
  const s = String(errMsg || "");
  return /\b55[0-4]\b|user unknown|no such user|mailbox unavailable|does not exist|invalid recipient|recipient rejected/i.test(s);
}

export async function resolveTenantId(pool, tenantId, dispatchUid) {
  if (tenantId) return tenantId;
  if (!dispatchUid) return null;
  const [rows] = await pool.query("SELECT tenant_id FROM email_dispatches WHERE dispatch_uid = ? LIMIT 1", [dispatchUid]);
  return rows.length ? rows[0].tenant_id : null;
}

export async function emitWebhookEvent(pool, { tenantId, dispatchUid, eventType, email, reason, messageId }) {
  const tid = await resolveTenantId(pool, tenantId, dispatchUid);
  if (!tid) return;

  const normEmail = email ? String(email).trim().toLowerCase() : null;
  let autoSuppressed = false;

  if (normEmail && SUPPRESS_EVENTS.has(eventType)) {
    const rMap = { hard_bounce: "hard_bounce", complained: "complaint", unsubscribed: "unsubscribe" };
    await pool.query(
      "INSERT INTO suppressions (tenant_id, email, reason) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)",
      [tid, normEmail, rMap[eventType] || "hard_bounce"]
    ).catch(() => {});
    autoSuppressed = true;
  }

  const [eps] = await pool.query(
    "SELECT id, url, signing_secret, events FROM webhook_endpoints WHERE tenant_id=? AND is_active=1",
    [tid]
  );
  if (!eps.length) return;

  const payloadObj = {
    id: `evt_${crypto.randomUUID()}`,
    type: eventType,
    created_at: new Date().toISOString(),
    data: {
      email: normEmail,
      dispatch_uid: dispatchUid || null,
      message_id: messageId || null,
      reason: reason || eventType,
      auto_suppressed: autoSuppressed
    }
  };
  const bodyStr = JSON.stringify(payloadObj);

  for (const ep of eps) {
    const subs = typeof ep.events === "string" ? JSON.parse(ep.events || "[]") : (ep.events || []);
    if (subs.length && !subs.includes("*") && !subs.includes(eventType)) continue;
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", ep.signing_secret).update(`${ts}.${bodyStr}`).digest("hex");
    let status = 0, respText = "";
    try {
      const check = await validateSafeWebhookUrl(ep.url);
      if (!check.ok) throw new Error(`Blocked by SSRF policy: ${check.error}`);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(check.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "SendEmail-Webhook/1.0",
          "X-SendEmail-Event": eventType,
          "X-SendEmail-Signature": `t=${ts},v1=${sig}`
        },
        body: bodyStr,
        signal: ctrl.signal
      });
      clearTimeout(timer);
      status = r.status;
      respText = (await r.text()).slice(0, 500);
    } catch (e) {
      respText = String(e.message || e).slice(0, 500);
    }
    await pool.query(
      "INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_type, recipient_email, payload, response_status, response_body) VALUES (?,?,?,?,?,?,?)",
      [tid, ep.id, eventType, normEmail, bodyStr, status, respText]
    ).catch(() => {});
  }
}
