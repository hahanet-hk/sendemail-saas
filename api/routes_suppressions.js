export function registerSuppressionRoutes(app, pool, auth) {
  app.get("/api/v1/suppressions", auth, async (req, res) => {
    const [rows] = await pool.query("SELECT id,email,reason,created_at FROM suppressions WHERE tenant_id=? ORDER BY id DESC LIMIT 200", [req.tenant.id]);
    res.json({ suppressions: rows });
  });
  app.post("/api/v1/suppressions", auth, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const reason = ["hard_bounce", "complaint", "unsubscribe", "manual"].includes(req.body?.reason) ? req.body.reason : "manual";
    if (!email.includes("@")) return res.status(400).json({ error: "INVALID_EMAIL" });
    await pool.query("INSERT INTO suppressions (tenant_id,email,reason) VALUES (?,?,?,\"api\") ON DUPLICATE KEY UPDATE reason=VALUES(reason)", [req.tenant.id, email, reason]);
    res.status(201).json({ email, reason, suppressed: true });
  });
  app.delete("/api/v1/suppressions/:id", auth, async (req, res) => {
    const [r] = await pool.query("DELETE FROM suppressions WHERE id=? AND tenant_id=?", [req.params.id, req.tenant.id]);
    res.status(r.affectedRows ? 200 : 404).json({ deleted: !!r.affectedRows });
  });
}
