import { analyzeWithRspamd } from "./routes_spam.js";

export function registerPreflightRoutes(app, pool, auth) {
  app.post("/api/v1/tools/preflight", auth, async (req, res) => {
    const { from_email, from_name, to_email, subject, html, text, mode } = req.body || {};
    if (!subject && !html && !text) return res.status(400).json({ error: "MISSING_CONTENT" });
    const sender = String(from_email || req.tenant.email || "").trim().toLowerCase();
    const domName = sender.includes("@") ? sender.split("@")[1] : "";
    const [[dom]] = domName ? await pool.query("SELECT domain, spf_verified, dkim_verified, dmarc_verified, verp_verified, status FROM sending_domains WHERE tenant_id=? AND domain=? LIMIT 1", [req.tenant.id, domName]) : [[null]];
    const spam = await analyzeWithRspamd({ from_email: sender, from_name: from_name || req.tenant.name, to_email, subject, html, text }).catch((e) => ({ score: 0, required_score: 15, verdict: "unknown", symbols: [], error: e.message }));
    const bodyAll = `${html || ""}\n${text || ""}`;
    const hasUnsub = /unsubscribe|\[UNSUBSCRIBE_URL\]|退訂|取消訂閱/i.test(bodyAll);
    const isCampaign = mode === "campaign" || (Array.isArray(to_email) && to_email.length > 1);
    let score = 100;
    const issues = [];
    if (!dom) { score -= 25; issues.push({ level: "warning", code: "UNREGISTERED_DOMAIN", message: `發信網域 ${domName || "(未指定)"} 尚未在 SendEmail.ai 註冊驗證。` }); }
    else {
      if (!dom.spf_verified) { score -= 15; issues.push({ level: "error", code: "SPF_MISSING", message: `${dom.domain} 尚未通過 SPF 驗證。` }); }
      if (!dom.dkim_verified) { score -= 20; issues.push({ level: "error", code: "DKIM_MISSING", message: `${dom.domain} 尚未通過 DKIM 簽章驗證。` }); }
      if (!dom.dmarc_verified) { score -= 10; issues.push({ level: "warning", code: "DMARC_MISSING", message: `${dom.domain} 尚未設定 DMARC 政策。` }); }
    }
    if (spam.score >= 6) { score -= 35; issues.push({ level: "error", code: "HIGH_SPAM_SCORE", message: `Rspamd 垃圾信評分過高（${spam.score} 分），極可能進入垃圾信件匣。` }); }
    else if (spam.score >= 3) { score -= 15; issues.push({ level: "warning", code: "ELEVATED_SPAM_SCORE", message: `Rspamd 評分偏高（${spam.score} 分），建議優化標題或連結。` }); }
    if (isCampaign && !hasUnsub) { score -= 20; issues.push({ level: "error", code: "MISSING_UNSUBSCRIBE", message: "群發行銷信件缺少退訂連結或 [UNSUBSCRIBE_URL] 標記，違反 Gmail/Yahoo 寄件規範。" }); }
    score = Math.max(0, score);
    const readiness = score >= 80 ? "ready" : score >= 50 ? "warning" : "blocked";
    res.json({ readiness_score: score, readiness, domain: dom || { domain: domName, registered: false }, compliance: { is_campaign: isCampaign, has_unsubscribe: hasUnsub }, spam, issues });
  });
}
