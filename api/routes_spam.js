const RSPAMD_URL = process.env.RSPAMD_INTERNAL_URL || "http://sendemail-rspamd:11334";

export function buildRawMime({ from_email, from_name, to_email, subject, html, text }) {
  const from = from_name ? `"${String(from_name).replace(/"/g, "")}" <${from_email || "noreply@sendemail.ai"}>` : (from_email || "noreply@sendemail.ai");
  const to = Array.isArray(to_email) ? to_email.join(", ") : (to_email || "recipient@example.com");
  const rawSub = String(subject || "(No Subject)");
  const encodedSub = /^[\x20-\x7E]*$/.test(rawSub) ? rawSub : `=?UTF-8?B?${Buffer.from(rawSub, "utf8").toString("base64")}?=`;
  const boundary = "----=_Part_" + Date.now().toString(36);
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encodedSub}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@sendemail.ai>`,
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "",
    String(text || (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "")), "",
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "",
    String(html || `<p>${text || ""}</p>`), "", `--${boundary}--`
  ];
  return lines.join("\r\n");
}

export async function analyzeWithRspamd(payload) {
  const raw = buildRawMime(payload);
  const res = await fetch(`${RSPAMD_URL}/checkv2`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: raw });
  if (!res.ok) throw new Error(`Rspamd HTTP ${res.status}`);
  const data = await res.json();
  const syms = Object.values(data.symbols || {}).map((s) => ({
    name: s.name, score: Number(s.score || 0), description: s.description || "", options: s.options || []
  })).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const score = Number(data.score || 0);
  const verdict = score >= 6 ? "spam" : score >= 3 ? "warning" : "clean";
  return { score, required_score: Number(data.required_score || 15), action: data.action || "no action", verdict, symbols: syms };
}

export function registerSpamRoutes(app, pool, auth) {
  app.post("/api/v1/tools/spam-check", auth, async (req, res) => {
    const { from_email, from_name, to_email, subject, html, text } = req.body || {};
    if (!subject && !html && !text) return res.status(400).json({ error: "MISSING_CONTENT" });
    try {
      const report = await analyzeWithRspamd({ from_email: from_email || req.tenant.email, from_name: from_name || req.tenant.name, to_email, subject, html, text });
      res.json(report);
    } catch (e) {
      res.status(502).json({ error: "RSPAMD_UNAVAILABLE", message: e.message });
    }
  });

  app.post("/api/v1/tools/spam-learn", auth, async (req, res) => {
    const { type, from_email, from_name, to_email, subject, html, text } = req.body || {};
    if (!["spam", "ham"].includes(type)) return res.status(400).json({ error: "INVALID_LEARN_TYPE" });
    if (!subject && !html && !text) return res.status(400).json({ error: "MISSING_CONTENT" });
    try {
      const raw = buildRawMime({ from_email: from_email || req.tenant.email, from_name: from_name || req.tenant.name, to_email, subject, html, text });
      const ep = type === "spam" ? "/learnspam" : "/learnham";
      const r = await fetch(`${RSPAMD_URL}${ep}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: raw });
      const body = await r.text();
      if (!r.ok) return res.status(502).json({ error: "RSPAMD_LEARN_FAILED", status: r.status, detail: body });
      res.json({ learned: type, status: "ok", detail: body });
    } catch (e) {
      res.status(502).json({ error: "RSPAMD_UNAVAILABLE", message: e.message });
    }
  });

  app.post("/api/v1/sandbox/:uid/rescan", auth, async (req, res) => {
    const [[msg]] = await pool.query("SELECT * FROM sandbox_messages WHERE message_uid=? AND tenant_id=? LIMIT 1", [req.params.uid, req.tenant.id]);
    if (!msg) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      const report = await analyzeWithRspamd({ from_email: msg.from_email, to_email: msg.to_email, subject: msg.subject, html: msg.html_body, text: msg.text_body });
      await pool.query("UPDATE sandbox_messages SET spam_score=?, spam_report=? WHERE id=?", [report.score, JSON.stringify(report), msg.id]);
      res.json({ message_uid: msg.message_uid, ...report });
    } catch (e) {
      res.status(502).json({ error: "RSPAMD_UNAVAILABLE", message: e.message });
    }
  });

}
