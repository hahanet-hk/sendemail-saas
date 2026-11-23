import crypto from "node:crypto";
import { validateSafeWebhookUrl } from "./ssrf_guard.js";

const SUPPRESS_EVENTS = new Set(["hard_bounce", "complained", "unsubscribed"]);

export async function dispatchTenantWebhooks(pool, tenantId, eventType, data) {
  const [eps] = await pool.query(
    "SELECT id, url, signing_secret, events FROM webhook_endpoints WHERE tenant_id=? AND is_active=1",
    [tenantId]
  );
  const payloadObj = { id: `evt_${crypto.randomUUID()}`, type: eventType, created_at: new Date().toISOString(), data };
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
      [tenantId, ep.id, eventType, data.email || null, bodyStr, status, respText]
    ).catch(() => {});
  }
}

export async function registerWebhookRoutes(app, pool, auth) {
  await pool.query(`CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    url VARCHAR(512) NOT NULL,
    signing_secret VARCHAR(128) NOT NULL,
    events JSON NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wh_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    endpoint_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    recipient_email VARCHAR(255) NULL,
    payload MEDIUMTEXT NOT NULL,
    response_status INT NOT NULL DEFAULT 0,
    response_body TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_whd_tenant (tenant_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  app.get("/api/v1/webhooks", auth, async (req, res) => {
    const [rows] = await pool.query(
      "SELECT id, url, signing_secret, events, is_active, created_at FROM webhook_endpoints WHERE tenant_id=? ORDER BY id DESC",
      [req.tenant.id]
    );
    res.json({ webhooks: rows });
  });

  app.post("/api/v1/webhooks", auth, async (req, res) => {
    const { url, events } = req.body || {};
    const check = await validateSafeWebhookUrl(url);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const evList = Array.isArray(events) && events.length ? events : ["*"];
    const [ins] = await pool.query(
      "INSERT INTO webhook_endpoints (tenant_id, url, signing_secret, events) VALUES (?,?,?,?)",
      [req.tenant.id, check.url, secret, JSON.stringify(evList)]
    );
    res.status(201).json({ id: ins.insertId, url: check.url, signing_secret: secret, events: evList, is_active: 1 });
  });

  app.delete("/api/v1/webhooks/:id", auth, async (req, res) => {
    await pool.query("DELETE FROM webhook_endpoints WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    res.json({ ok: true });
  });

  app.get("/api/v1/webhooks/deliveries", auth, async (req, res) => {
    const [rows] = await pool.query(
      "SELECT d.id, d.endpoint_id, e.url, d.event_type, d.recipient_email, d.response_status, d.response_body, d.created_at FROM webhook_deliveries d LEFT JOIN webhook_endpoints e ON e.id=d.endpoint_id WHERE d.tenant_id=? ORDER BY d.id DESC LIMIT 50",
      [req.tenant.id]
    );
    res.json({ deliveries: rows });
  });

  app.post("/api/v1/webhooks/:id/test", auth, async (req, res) => {
    const [rows] = await pool.query("SELECT id FROM webhook_endpoints WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    await dispatchTenantWebhooks(pool, req.tenant.id, "test.ping", { message: "Hello from sendemail.ai webhook engine" });
    res.json({ ok: true });
  });

  app.post("/api/v1/webhooks/ingest", auth, async (req, res) => {
    try {
      const { event_type, email, dispatch_uid, reason } = req.body || {};
      if (!event_type || !email) return res.status(400).json({ error: "MISSING_FIELDS" });
      const normEmail = String(email).trim().toLowerCase();
      let autoSuppressed = false;
      if (SUPPRESS_EVENTS.has(event_type)) {
        const rMap = { hard_bounce: "hard_bounce", complained: "complaint", unsubscribed: "unsubscribe" };
        await pool.query(
          "INSERT INTO suppressions (tenant_id, email, reason) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)",
          [req.tenant.id, normEmail, rMap[event_type] || "hard_bounce"]
        );
        autoSuppressed = true;
      }
      await dispatchTenantWebhooks(pool, req.tenant.id, event_type, {
        email: normEmail,
        dispatch_uid: dispatch_uid || null,
        reason: reason || event_type,
        auto_suppressed: autoSuppressed
      });
      res.json({ ok: true, event_type, email: normEmail, auto_suppressed: autoSuppressed });
    } catch (err) {
      res.status(500).json({ error: err.code || "INGEST_FAILED", message: err.sqlMessage || err.message });
    }
  });
}
