import crypto from "node:crypto";

const RSPAMD_URL = process.env.RSPAMD_URL || "http://sendemail-rspamd:11334";

function classifyBounce(smtpCode, explicitType) {
  if (explicitType === "complaint") return "complaint";
  if (explicitType === "hard" || explicitType === "soft") return explicitType;
  const code = String(smtpCode || "").trim();
  if (/^5\./.test(code) || /^5\d\d/.test(code)) return "hard";
  return "soft";
}

async function notifyOpsChannels(alert) {
  const sent = [];
  const text = `[SendEmail.ai Ops Alert] ${alert.severity.toUpperCase()} - ${alert.summary} (Tenant #${alert.tenant_id})`;
  if (process.env.OPS_SLACK_WEBHOOK_URL) {
    await fetch(process.env.OPS_SLACK_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    }).then(() => sent.push("slack")).catch(() => {});
  }
  if (process.env.OPS_TELEGRAM_BOT_TOKEN && process.env.OPS_TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${process.env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.OPS_TELEGRAM_CHAT_ID, text })
    }).then(() => sent.push("telegram")).catch(() => {});
  }
  return sent.length ? sent.join(",") : "dashboard_only";
}

export async function evaluateCircuitBreaker(pool, tenantId) {
  const [[sentRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM email_dispatches WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
    [tenantId]
  );
  const [[bRow]] = await pool.query(
    "SELECT SUM(bounce_type='hard') AS hard_cnt, SUM(bounce_type='soft') AS soft_cnt, SUM(bounce_type='complaint') AS comp_cnt FROM bounce_events WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
    [tenantId]
  );
  const hardCnt = Number(bRow?.hard_cnt || 0);
  const softCnt = Number(bRow?.soft_cnt || 0);
  const compCnt = Number(bRow?.comp_cnt || 0);
  const denom = Math.max(Number(sentRow?.cnt || 0), hardCnt + softCnt + compCnt, 1);
  const hardRate = Number(((hardCnt / denom) * 100).toFixed(2));
  const compRate = Number(((compCnt / denom) * 100).toFixed(3));
  const triggered = (denom >= 5 && hardRate > 5) || (compCnt >= 1 && compRate > 0.1);

  if (triggered) {
    const reason = compRate > 0.1
      ? `垃圾信投訴率達 ${compRate}%（超過 0.1% 熔斷閾值）`
      : `硬退信率達 ${hardRate}%（超過 5.0% 熔斷閾值）`;
    await pool.query(
      "UPDATE tenants SET sending_frozen_at = COALESCE(sending_frozen_at, NOW()), freeze_reason = ? WHERE id = ?",
      [reason, tenantId]
    );
    const [[existing]] = await pool.query(
      "SELECT id FROM ops_alerts WHERE tenant_id=? AND alert_type='circuit_breaker' AND resolution='pending' LIMIT 1",
      [tenantId]
    );
    if (!existing) {
      const alertUid = "alt_" + crypto.randomBytes(10).toString("hex");
      const metrics = { window: "24h", total_evaluated: denom, hard_bounces: hardCnt, complaints: compCnt, hard_rate_pct: hardRate, complaint_rate_pct: compRate };
      const channels = await notifyOpsChannels({ tenant_id: tenantId, severity: "critical", summary: reason });
      await pool.query(
        "INSERT INTO ops_alerts (alert_uid, tenant_id, alert_type, severity, summary, metrics, notified_channels) VALUES (?,?,?,?,?,?,?)",
        [alertUid, tenantId, "circuit_breaker", "critical", reason, JSON.stringify(metrics), channels]
      );
    }
  }
  return { window: "24h", total_evaluated: denom, hard_bounces: hardCnt, soft_bounces: softCnt, complaints: compCnt, hard_rate_pct: hardRate, complaint_rate_pct: compRate, circuit_breaker_triggered: triggered };
}

export function registerBounceGuard(app, pool) {
  app.use("/api/v1/send", async (req, res, next) => {
    if (req.method !== "POST") return next();
    let tid = req.tenant?.id;
    if (!tid) {
      const authHdr = String(req.headers.authorization || "");
      if (authHdr.startsWith("Bearer ")) {
        const rawKey = authHdr.slice(7).trim();
        const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
        const [[kRow]] = await pool.query("SELECT tenant_id FROM api_keys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1", [keyHash]);
        if (kRow) tid = kRow.tenant_id;
      }
    }
    if (!tid) return next();
    const [[t]] = await pool.query("SELECT sending_frozen_at, freeze_reason, hourly_limit FROM tenants WHERE id=? LIMIT 1", [tid]);
    if (t?.sending_frozen_at) {
      return res.status(403).json({
        error: "SENDING_FROZEN",
        message: "租戶發信權限已因風控熔斷自動凍結，請前往戰情室審核或聯繫支援。",
        reason: t.freeze_reason,
        frozen_at: t.sending_frozen_at
      });
    }
    if (t?.hourly_limit) {
      const [[hr]] = await pool.query("SELECT COALESCE(SUM(recipient_count),0) AS cnt FROM email_dispatches WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)", [tid]);
      const reqCount = Array.isArray(req.body?.to) ? req.body.to.length : 1;
      if (Number(hr?.cnt || 0) + reqCount > Number(t.hourly_limit)) {
        return res.status(429).json({
          error: "HOURLY_WARMUP_LIMIT_EXCEEDED",
          message: `已達當前信譽分級每小時發信上限（${t.hourly_limit} 封/小時），請稍後再試。`,
          hourly_limit: Number(t.hourly_limit)
        });
      }
    }
    next();
  });
}

export function registerBounceRoutes(app, pool, auth) {
  // 前置熔斷保護：凍結中的租戶立即攔截發信請求
  app.use("/api/v1/send", async (req, res, next) => {
    if (req.method !== "POST") return next();
    let tid = req.tenant?.id;
    if (!tid) {
      const authHdr = String(req.headers.authorization || "");
      if (authHdr.startsWith("Bearer ")) {
        const rawKey = authHdr.slice(7).trim();
        const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
        const [[kRow]] = await pool.query("SELECT tenant_id FROM api_keys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1", [keyHash]);
        if (kRow) tid = kRow.tenant_id;
      }
    }
    if (!tid) return next();
    const [[t]] = await pool.query("SELECT sending_frozen_at, freeze_reason FROM tenants WHERE id=? LIMIT 1", [tid]);
    if (t?.sending_frozen_at) {
      return res.status(403).json({
        error: "SENDING_FROZEN",
        message: "租戶發信權限已因風控熔斷自動凍結，請前往戰情室審核或聯繫支援。",
        reason: t.freeze_reason,
        frozen_at: t.sending_frozen_at
      });
    }
    next();
  });

  // 雙源退信與投訴接收端點（支援 VERP DSN、Gmail API 與 ISP FBL）
  app.post("/api/v1/bounces/ingest", async (req, res, next) => {
    if (req.headers["x-internal-service"] === "sendemail-bounce-parser") return next();
    return auth(req, res, next);
  }, async (req, res) => {
    const { recipient_email, source, bounce_type, smtp_code, diagnostic_message, dispatch_uid, verp_address, raw_message } = req.body || {};
    let tenantId = req.tenant?.id || null;
    let resolvedDispatch = dispatch_uid || null;

    if (!resolvedDispatch && verp_address) {
      const m = String(verp_address).match(/^bounce\+([a-zA-Z0-9_-]+)@/i);
      if (m) resolvedDispatch = m[1];
    }
    if (!tenantId && resolvedDispatch) {
      const [[disp]] = await pool.query("SELECT tenant_id FROM email_dispatches WHERE dispatch_uid=? LIMIT 1", [resolvedDispatch]);
      if (disp) tenantId = disp.tenant_id;
    }
    const email = String(recipient_email || "").trim().toLowerCase();
    if (!tenantId || !email || !email.includes("@")) {
      return res.status(400).json({ error: "INVALID_BOUNCE_PAYLOAD", message: "需要有效的 recipient_email 與租戶上下文或 VERP dispatch_uid。" });
    }

    const src = ["verp_dsn", "gmail_api", "isp_fbl"].includes(source) ? source : "verp_dsn";
    const bType = classifyBounce(smtp_code, bounce_type);
    const eventUid = "bnc_" + crypto.randomBytes(10).toString("hex");
    let suppressed = 0;
    let retryCount = 0;
    let nextRetryAt = null;

    if (bType === "hard" || bType === "complaint") {
      suppressed = 1;
      const reason = bType === "complaint" ? "complaint" : "hard_bounce";
      await pool.query(
        "INSERT IGNORE INTO suppressions (tenant_id, email, reason, diagnostic_code, source_message_id) VALUES (?,?,?,?,?)",
        [tenantId, email, reason, String(diagnostic_message || smtp_code || bType).slice(0, 500), resolvedDispatch]
      );
      const penalty = bType === "complaint" ? 15 : 3;
      await pool.query("UPDATE tenants SET reputation_score = GREATEST(0, reputation_score - ?) WHERE id=?", [penalty, tenantId]);

      if (bType === "complaint" && raw_message) {
        fetch(`${RSPAMD_URL}/learnspam`, { method: "POST", body: String(raw_message) }).catch(() => {});
      }
    } else {
      // 軟退信：72 小時指數退避重試（第 1 次 +4h、第 2 次 +24h、第 3 次 +44h，累計 3 次轉抑制）
      const [[prev]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM bounce_events WHERE tenant_id=? AND recipient_email=? AND bounce_type='soft' AND created_at >= DATE_SUB(NOW(), INTERVAL 72 HOUR)",
        [tenantId, email]
      );
      retryCount = Number(prev?.cnt || 0) + 1;
      if (retryCount >= 3) {
        suppressed = 1;
        await pool.query(
          "INSERT IGNORE INTO suppressions (tenant_id, email, reason, diagnostic_code, source_message_id) VALUES (?,?,?,?,?)",
          [tenantId, email, "hard_bounce", `Soft bounce exhausted 3 retries within 72h: ${smtp_code || ""}`, resolvedDispatch]
        );
        await pool.query("UPDATE tenants SET reputation_score = GREATEST(0, reputation_score - 2) WHERE id=?", [tenantId]);
      } else {
        const delayHours = retryCount === 1 ? 4 : 24;
        nextRetryAt = new Date(Date.now() + delayHours * 3600 * 1000);
      }
    }

    await pool.query(
      "INSERT INTO bounce_events (event_uid, tenant_id, dispatch_uid, recipient_email, source, bounce_type, smtp_code, diagnostic_message, retry_count, next_retry_at, suppressed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [eventUid, tenantId, resolvedDispatch, email, src, bType, smtp_code || null, diagnostic_message || null, retryCount, nextRetryAt, suppressed]
    );

    const health = await evaluateCircuitBreaker(pool, tenantId);
    res.status(201).json({
      event_uid: eventUid,
      bounce_type: bType,
      source: src,
      suppressed: Boolean(suppressed),
      retry_count: retryCount,
      next_retry_at: nextRetryAt,
      health
    });
  });

  // 查詢租戶退信歸因明細與滑動視窗風控狀態
  app.get("/api/v1/bounces", auth, async (req, res) => {
    const tid = req.tenant.id;
    const [[tenant]] = await pool.query("SELECT reputation_score, hourly_limit, sending_frozen_at, freeze_reason FROM tenants WHERE id=?", [tid]);
    const health = await evaluateCircuitBreaker(pool, tid);
    const [events] = await pool.query(
      "SELECT event_uid, dispatch_uid, recipient_email, source, bounce_type, smtp_code, diagnostic_message, retry_count, next_retry_at, suppressed, created_at FROM bounce_events WHERE tenant_id=? ORDER BY id DESC LIMIT 50",
      [tid]
    );
    const [alerts] = await pool.query(
      "SELECT alert_uid, alert_type, severity, summary, metrics, notified_channels, resolution, resolved_at, created_at FROM ops_alerts WHERE tenant_id=? ORDER BY id DESC LIMIT 20",
      [tid]
    );
    res.json({ tenant_risk: tenant, health, events, alerts });
  });

  // 戰情室告警一鍵審核（放行解除凍結或永久封禁）
  app.post("/api/v1/ops/alerts/:alertUid/resolve", auth, async (req, res) => {
    const { action } = req.body || {};
    if (!["released", "banned"].includes(action)) return res.status(400).json({ error: "INVALID_ACTION" });
    const [[alert]] = await pool.query("SELECT id, tenant_id FROM ops_alerts WHERE alert_uid=? AND tenant_id=? LIMIT 1", [req.params.alertUid, req.tenant.id]);
    if (!alert) return res.status(404).json({ error: "ALERT_NOT_FOUND" });

    await pool.query("UPDATE ops_alerts SET resolution=?, resolved_at=NOW() WHERE id=?", [action, alert.id]);
    if (action === "released") {
      await pool.query("UPDATE tenants SET sending_frozen_at=NULL, freeze_reason=NULL, reputation_score=GREATEST(reputation_score, 80) WHERE id=?", [alert.tenant_id]);
    } else {
      await pool.query("UPDATE tenants SET sending_frozen_at=COALESCE(sending_frozen_at, NOW()), freeze_reason='Admin confirmed abuse ban', reputation_score=0 WHERE id=?", [alert.tenant_id]);
    }
    res.json({ alert_uid: req.params.alertUid, resolution: action });
  });
}
