import { analyzeWithRspamd } from "./routes_spam.js";
import crypto from "node:crypto";
import { renderTemplateString } from "./routes_templates.js";
import { reserveMonthlyQuota, refundMonthlyQuota } from "./billing_guard.js";

export function registerSendRoutes(app, pool, auth, dispatchQueue) {
  app.post("/api/v1/send", auth, async (req, res) => {
    const { subject, html, text, from_name, from_email, to, skip_verification, sandbox, channel_id, template_id, variables } = req.body || {};
    const rec = (Array.isArray(to) ? to : typeof to === "string" ? [to] : []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
    if (!rec.length) return res.status(400).json({ error: "MISSING_RECIPIENTS" });

    let sub = subject || "", bodyHtml = html || "", bodyText = text || "";
    if (template_id) {
      const [[tpl]] = await pool.query("SELECT subject_template, html_template, text_template, sample_variables FROM email_templates WHERE (template_uid=? OR id=?) AND tenant_id=? LIMIT 1", [String(template_id), Number(template_id) || 0, req.tenant.id]);
      if (!tpl) return res.status(404).json({ error: "TEMPLATE_NOT_FOUND" });
      let def = {};
      try { def = typeof tpl.sample_variables === "string" ? JSON.parse(tpl.sample_variables || "{}") : (tpl.sample_variables || {}); } catch {}
      const merged = { ...def, ...(variables && typeof variables === "object" ? variables : {}) };
      sub = renderTemplateString(sub || tpl.subject_template, merged);
      bodyHtml = renderTemplateString(bodyHtml || tpl.html_template, merged);
      bodyText = renderTemplateString(bodyText || tpl.text_template || "", merged);
    } else if (variables && typeof variables === "object") {
      sub = renderTemplateString(sub, variables);
      bodyHtml = renderTemplateString(bodyHtml, variables);
      bodyText = renderTemplateString(bodyText, variables);
    }
    if (!sub || (!bodyHtml && !bodyText)) return res.status(400).json({ error: "MISSING_FIELDS" });

    const isTestKey = (req.headers.authorization || "").includes("se_test_");
    if (sandbox || isTestKey) {
      const uid = crypto.randomUUID();
      let spam = null;
      try { spam = await analyzeWithRspamd({ from_email: from_email || req.tenant.email, from_name: from_name || req.tenant.name, to_email: rec, subject: sub, html: bodyHtml, text: bodyText }); } catch {}
      await pool.query("INSERT INTO sandbox_messages (tenant_id,message_uid,from_email,to_email,subject,html_body,text_body,spam_score,spam_report) VALUES (?,?,?,?,?,?,?,?,?)", [req.tenant.id, uid, from_email || req.tenant.email, rec.join(","), sub, bodyHtml, bodyText, spam ? spam.score : 0, spam ? JSON.stringify(spam) : null]);
      return res.status(202).json({ dispatch_uid: uid, mode: "sandbox", template_id: template_id || null, recipient_count: rec.length, spam_check: spam, status: "captured_in_sandbox" });
    }

    const [supRows] = await pool.query("SELECT email FROM suppressions WHERE tenant_id=? AND email IN (?)", [req.tenant.id, rec]);
    const blocked = new Set(supRows.map(r => r.email));
    const cleanRec = rec.filter(e => !blocked.has(e));
    if (!cleanRec.length) return res.status(200).json({ status: "suppressed_all", suppressed_count: blocked.size });

    const quota = await reserveMonthlyQuota(pool, req.tenant.id, cleanRec.length);
    if (!quota.ok) {
      return res.status(402).json({
        error: quota.error,
        message: "Monthly sending quota exceeded.",
        used_quota: quota.used_quota,
        monthly_quota: quota.monthly_quota,
        remaining: quota.remaining
      });
    }

    const mode = cleanRec.length === 1 ? "transactional" : "campaign", uid = crypto.randomUUID();
    try {
      await pool.query("INSERT INTO email_dispatches (tenant_id,dispatch_uid,mode,subject,recipient_count,status) VALUES (?,?,?,?,?,\"queued\")", [req.tenant.id, uid, mode, sub, cleanRec.length]);
      await dispatchQueue.add("dispatch-email", { dispatchUid: uid, tenantId: req.tenant.id, mwApiKey: req.tenant.mw_api_key, channelId: channel_id || null, mode, subject: sub, html: bodyHtml, text: bodyText, fromName: from_name || req.tenant.name, fromEmail: from_email || req.tenant.email, recipients: cleanRec, skipVerification: Boolean(skip_verification) }, { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 2000 });
    } catch (err) {
      await refundMonthlyQuota(pool, req.tenant.id, cleanRec.length);
      return res.status(500).json({ error: "DISPATCH_QUEUE_FAILED", message: err.message });
    }

    res.status(202).json({
      dispatch_uid: uid,
      mode,
      template_id: template_id || null,
      recipient_count: cleanRec.length,
      suppressed_count: blocked.size,
      quota_remaining: quota.remaining,
      status: "queued"
    });
  });
}
