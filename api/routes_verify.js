import crypto from "node:crypto";
import { reserveVerifyCredits, refundVerifyCredits } from "./billing_guard.js";

export async function registerVerifyRoutes(app, pool, auth, verifyQueue) {
  await pool.query("ALTER TABLE verification_batches ADD COLUMN IF NOT EXISTS source_name VARCHAR(255) NULL AFTER tenant_id").catch(() => {});
  await pool.query("ALTER TABLE verification_results MODIFY COLUMN verdict ENUM('pending','allow','review','block','error') NOT NULL DEFAULT 'pending'").catch(() => {});

  app.post("/api/v1/verify/batch", auth, async (req, res) => {
    let chargedCount = 0;
    try {
      const raw = Array.isArray(req.body?.emails)
        ? req.body.emails
        : typeof req.body?.emails === "string"
          ? req.body.emails.split(/[\n,;]+/)
          : [];
      const uniqueEmails = [...new Set(raw.map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@")))].slice(0, 5000);
      if (!uniqueEmails.length) return res.status(400).json({ error: "NO_VALID_EMAILS" });

      const creditCheck = await reserveVerifyCredits(pool, req.tenant.id, uniqueEmails.length);
      if (!creditCheck.ok) {
        return res.status(402).json({
          error: creditCheck.error,
          message: "Insufficient verification credits.",
          credit_balance: creditCheck.credit_balance,
          required: creditCheck.required
        });
      }
      chargedCount = uniqueEmails.length;

      const batchUid = crypto.randomUUID();
      const sourceName = String(req.body?.source_name || `Batch ${new Date().toISOString().slice(0, 16).replace("T", " ")}`).slice(0, 250);

      const [bIns] = await pool.query(
        "INSERT INTO verification_batches (batch_uid, tenant_id, source_name, total_count, status) VALUES (?,?,?,?,'queued')",
        [batchUid, req.tenant.id, sourceName, uniqueEmails.length]
      );
      const batchId = bIns.insertId;

      const valueRows = uniqueEmails.map((email) => [batchId, email, "pending"]);
      await pool.query("INSERT INTO verification_results (batch_id, email, verdict) VALUES ?", [valueRows]);

      const [insertedRows] = await pool.query(
        "SELECT id, email FROM verification_results WHERE batch_id=? ORDER BY id ASC",
        [batchId]
      );

      await verifyQueue.addBulk(
        insertedRows.map((row) => ({
          name: "verify-email",
          data: { batchId, resultId: row.id, email: row.email },
          opts: { attempts: 2, backoff: { type: "exponential", delay: 1500 }, removeOnComplete: 1000, removeOnFail: 2000 }
        }))
      );

      res.status(202).json({
        batch_uid: batchUid,
        source_name: sourceName,
        total_count: uniqueEmails.length,
        credit_balance: creditCheck.credit_balance,
        status: "queued"
      });
    } catch (err) {
      if (chargedCount > 0) await refundVerifyCredits(pool, req.tenant.id, chargedCount);
      res.status(500).json({ error: "BATCH_CREATE_FAILED", message: err.message });
    }
  });

  app.get("/api/v1/verify/batches", auth, async (req, res) => {
    const [rows] = await pool.query(
      "SELECT batch_uid, source_name, total_count, processed_count, safe_count, review_count, blocked_count, status, created_at FROM verification_batches WHERE tenant_id=? ORDER BY id DESC LIMIT 20",
      [req.tenant.id]
    );
    res.json({ batches: rows });
  });

  app.get("/api/v1/verify/batches/:batchUid", auth, async (req, res) => {
    const [[batch]] = await pool.query(
      "SELECT id, batch_uid, source_name, total_count, processed_count, safe_count, review_count, blocked_count, status, created_at FROM verification_batches WHERE batch_uid=? AND tenant_id=? LIMIT 1",
      [req.params.batchUid, req.tenant.id]
    );
    if (!batch) return res.status(404).json({ error: "BATCH_NOT_FOUND" });

    const [results] = await pool.query(
      "SELECT email, verdict, risk_score FROM verification_results WHERE batch_id=? ORDER BY id ASC LIMIT 200",
      [batch.id]
    );
    const { id: _ignore, ...publicBatch } = batch;
    res.json({ batch: publicBatch, results });
  });

  app.post("/api/v1/verify/batches/:batchUid/sync-suppressions", auth, async (req, res) => {
    try {
      const [[batch]] = await pool.query(
        "SELECT id, batch_uid FROM verification_batches WHERE batch_uid=? AND tenant_id=? LIMIT 1",
        [req.params.batchUid, req.tenant.id]
      );
      if (!batch) return res.status(404).json({ error: "BATCH_NOT_FOUND" });

      const includeReview = Boolean(req.body?.include_review);
      const targetVerdicts = includeReview ? ["block", "review"] : ["block"];

      const [rows] = await pool.query(
        "SELECT DISTINCT email FROM verification_results WHERE batch_id=? AND verdict IN (?)",
        [batch.id, targetVerdicts]
      );

      if (!rows.length) {
        return res.json({ batch_uid: batch.batch_uid, matched_count: 0, inserted_count: 0, already_suppressed_count: 0 });
      }

      const values = rows.map((r) => [req.tenant.id, r.email.trim().toLowerCase(), "verify_blocked"]);
      const [ins] = await pool.query("INSERT IGNORE INTO suppressions (tenant_id, email, reason) VALUES ?", [values]);
      const insertedCount = Number(ins.affectedRows || 0);
      res.json({
        batch_uid: batch.batch_uid,
        matched_count: rows.length,
        inserted_count: insertedCount,
        already_suppressed_count: Math.max(0, rows.length - insertedCount)
      });
    } catch (err) {
      res.status(500).json({ error: "SYNC_SUPPRESSIONS_FAILED", message: err.message });
    }
  });

  app.get("/api/v1/verify/batches/:batchUid/export.csv", auth, async (req, res) => {
    const [[batch]] = await pool.query(
      "SELECT id, batch_uid, source_name FROM verification_batches WHERE batch_uid=? AND tenant_id=? LIMIT 1",
      [req.params.batchUid, req.tenant.id]
    );
    if (!batch) return res.status(404).json({ error: "BATCH_NOT_FOUND" });

    const filterVerdict = String(req.query.verdict || "").trim().toLowerCase();
    const allowedFilters = new Set(["allow", "review", "block", "error", "pending"]);

    let sql = "SELECT email, verdict, risk_score FROM verification_results WHERE batch_id=?";
    const params = [batch.id];
    if (allowedFilters.has(filterVerdict)) {
      sql += " AND verdict=?";
      params.push(filterVerdict);
    }
    sql += " ORDER BY id ASC";

    const [rows] = await pool.query(sql, params);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["email,verdict,risk_score"];
    for (const r of rows) {
      lines.push([esc(r.email), esc(r.verdict), esc(r.risk_score !== null ? r.risk_score : "")].join(","));
    }

    const suffix = allowedFilters.has(filterVerdict) ? `_${filterVerdict}` : "_all";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="verify_${batch.batch_uid.slice(0, 8)}${suffix}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  });
}
