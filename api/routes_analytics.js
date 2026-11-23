export function registerAnalyticsRoutes(app, pool, auth) {
  app.get("/api/v1/analytics", auth, async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 30);
      const tid = req.tenant.id;

      const [dailyRows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
                COALESCE(SUM(CASE WHEN status='sent' THEN recipient_count ELSE 0 END), 0) AS sent,
                COALESCE(SUM(CASE WHEN status='failed' THEN recipient_count ELSE 0 END), 0) AS failed,
                COALESCE(SUM(CASE WHEN status='queued' THEN recipient_count ELSE 0 END), 0) AS queued
         FROM email_dispatches
         WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY day ORDER BY day ASC`,
        [tid, days - 1]
      );

      const dayMap = new Map(dailyRows.map((r) => [r.day, { sent: Number(r.sent), failed: Number(r.failed), queued: Number(r.queued) }]));
      const series = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const entry = dayMap.get(d) || { sent: 0, failed: 0, queued: 0 };
        series.push({ date: d, label: d.slice(5), ...entry });
      }

      const [supRows] = await pool.query(
        "SELECT reason, COUNT(*) AS cnt FROM suppressions WHERE tenant_id=? GROUP BY reason ORDER BY cnt DESC",
        [tid]
      );

      const [[dispTot]] = await pool.query(
        `SELECT COALESCE(SUM(recipient_count),0) AS total,
                COALESCE(SUM(CASE WHEN status='sent' THEN recipient_count ELSE 0 END),0) AS sent,
                COALESCE(SUM(CASE WHEN status='failed' THEN recipient_count ELSE 0 END),0) AS failed
         FROM email_dispatches WHERE tenant_id=?`,
        [tid]
      );

      const [[verTot]] = await pool.query(
        `SELECT COALESCE(SUM(total_count),0) AS checked,
                COALESCE(SUM(blocked_count),0) AS invalid
         FROM verification_batches WHERE tenant_id=?`,
        [tid]
      );

      const [[whTot]] = await pool.query(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END), 0) AS ok
         FROM webhook_deliveries WHERE tenant_id=?`,
        [tid]
      );

      res.json({
        days,
        series,
        suppressions: supRows.map((r) => ({ reason: r.reason || "manual", count: Number(r.cnt) })),
        summary: {
          total_recipients: Number(dispTot.total),
          sent_recipients: Number(dispTot.sent),
          failed_recipients: Number(dispTot.failed),
          delivery_rate: Number(dispTot.total) > 0 ? Math.round((Number(dispTot.sent) / Number(dispTot.total)) * 1000) / 10 : null,
          total_checked: Number(verTot.checked),
          blocked_invalid: Number(verTot.invalid),
          webhook_total: Number(whTot.total),
          webhook_success_rate: Number(whTot.total) > 0 ? Math.round((Number(whTot.ok) / Number(whTot.total)) * 1000) / 10 : null
        }
      });
    } catch (err) {
      res.status(500).json({ error: "ANALYTICS_FAILED", message: err.message });
    }
  });
}
