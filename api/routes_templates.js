import crypto from "node:crypto";

export function extractVariables(...sources) {
  const found = new Set();
  for (const src of sources) {
    for (const m of String(src || "").matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

export function renderTemplateString(tpl, variables = {}) {
  if (!tpl) return "";
  const vars = variables && typeof variables === "object" ? variables : {};
  return String(tpl).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ""
  );
}

export async function registerTemplateRoutes(app, pool, auth) {
  await pool.query(`CREATE TABLE IF NOT EXISTS email_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    template_uid VARCHAR(40) NOT NULL UNIQUE,
    tenant_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(160) NOT NULL,
    subject_template VARCHAR(500) NOT NULL,
    html_template LONGTEXT NOT NULL,
    text_template LONGTEXT NULL,
    sample_variables JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tpl_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  app.get("/api/v1/templates", auth, async (req, res) => {
    const [rows] = await pool.query("SELECT template_uid, name, subject_template, html_template, text_template, sample_variables, created_at FROM email_templates WHERE tenant_id=? ORDER BY id DESC", [req.tenant.id]);
    res.json({
      templates: rows.map((r) => {
        let sv = {};
        try { sv = typeof r.sample_variables === "string" ? JSON.parse(r.sample_variables || "{}") : (r.sample_variables || {}); } catch {}
        return { ...r, sample_variables: sv, variables: extractVariables(r.subject_template, r.html_template, r.text_template) };
      })
    });
  });

  app.post("/api/v1/templates", auth, async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const subjectTpl = String(req.body?.subject_template || "").trim();
    const htmlTpl = String(req.body?.html_template || "").trim();
    const textTpl = String(req.body?.text_template || "").trim();
    const sv = req.body?.sample_variables && typeof req.body.sample_variables === "object" ? req.body.sample_variables : {};
    if (!name || !subjectTpl || !htmlTpl) return res.status(400).json({ error: "MISSING_FIELDS" });
    const uid = `tpl_${crypto.randomBytes(8).toString("hex")}`;
    await pool.query("INSERT INTO email_templates (template_uid, tenant_id, name, subject_template, html_template, text_template, sample_variables) VALUES (?,?,?,?,?,?,?)", [uid, req.tenant.id, name.slice(0, 160), subjectTpl.slice(0, 500), htmlTpl, textTpl || null, JSON.stringify(sv)]);
    res.status(201).json({ template: { template_uid: uid, name, subject_template: subjectTpl, html_template: htmlTpl, text_template: textTpl, sample_variables: sv, variables: extractVariables(subjectTpl, htmlTpl, textTpl) } });
  });

  app.put("/api/v1/templates/:uid", auth, async (req, res) => {
    const [[ex]] = await pool.query("SELECT id FROM email_templates WHERE template_uid=? AND tenant_id=? LIMIT 1", [req.params.uid, req.tenant.id]);
    if (!ex) return res.status(404).json({ error: "TEMPLATE_NOT_FOUND" });
    const name = String(req.body?.name || "").trim();
    const subjectTpl = String(req.body?.subject_template || "").trim();
    const htmlTpl = String(req.body?.html_template || "").trim();
    const textTpl = String(req.body?.text_template || "").trim();
    const sv = req.body?.sample_variables && typeof req.body.sample_variables === "object" ? req.body.sample_variables : {};
    if (!name || !subjectTpl || !htmlTpl) return res.status(400).json({ error: "MISSING_FIELDS" });
    await pool.query("UPDATE email_templates SET name=?, subject_template=?, html_template=?, text_template=?, sample_variables=? WHERE id=?", [name.slice(0, 160), subjectTpl.slice(0, 500), htmlTpl, textTpl || null, JSON.stringify(sv), ex.id]);
    res.json({ template: { template_uid: req.params.uid, name, subject_template: subjectTpl, html_template: htmlTpl, text_template: textTpl, sample_variables: sv, variables: extractVariables(subjectTpl, htmlTpl, textTpl) } });
  });

  app.delete("/api/v1/templates/:uid", auth, async (req, res) => {
    const [del] = await pool.query("DELETE FROM email_templates WHERE template_uid=? AND tenant_id=?", [req.params.uid, req.tenant.id]);
    res.status(del.affectedRows ? 200 : 404).json(del.affectedRows ? { deleted: true } : { error: "TEMPLATE_NOT_FOUND" });
  });
}
