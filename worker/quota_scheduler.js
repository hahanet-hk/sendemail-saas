export function getCycleKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function ensureQuotaAuditTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quota_reset_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cycle_key VARCHAR(16) NOT NULL UNIQUE,
      tenants_reset_count INT UNSIGNED NOT NULL DEFAULT 0,
      total_quota_cleared BIGINT UNSIGNED NOT NULL DEFAULT 0,
      details_json LONGTEXT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

export async function runMonthlyQuotaReset(pool, cycleKey = getCycleKey()) {
  await ensureQuotaAuditTable(pool);

  const [lockRes] = await pool.query(
    'INSERT IGNORE INTO quota_reset_logs (cycle_key, tenants_reset_count, total_quota_cleared) VALUES (?, 0, 0)',
    [cycleKey]
  );

  if (!lockRes.affectedRows) {
    return { skipped: true, cycle_key: cycleKey, reason: 'ALREADY_EXECUTED' };
  }

  const [rows] = await pool.query(
    'SELECT id, email, monthly_quota, used_quota FROM tenants WHERE used_quota > 0 ORDER BY id ASC'
  );

  const count = rows.length;
  const totalCleared = rows.reduce((acc, r) => acc + Number(r.used_quota || 0), 0);

  if (count > 0) {
    await pool.query('UPDATE tenants SET used_quota = 0 WHERE used_quota > 0');
  }

  const snapshot = rows.map((r) => ({
    tenant_id: r.id,
    email: r.email,
    cleared_used_quota: Number(r.used_quota),
    monthly_quota: Number(r.monthly_quota)
  }));

  await pool.query(
    'UPDATE quota_reset_logs SET tenants_reset_count = ?, total_quota_cleared = ?, details_json = ?, executed_at = NOW() WHERE cycle_key = ?',
    [count, totalCleared, JSON.stringify(snapshot), cycleKey]
  );

  console.log(`[quota-scheduler] Reset cycle ${cycleKey} completed: ${count} tenants, ${totalCleared} quota cleared.`);
  return { skipped: false, cycle_key: cycleKey, tenants_reset_count: count, total_quota_cleared: totalCleared };
}

export function startQuotaScheduler(pool) {
  runMonthlyQuotaReset(pool).catch((err) => {
    console.error('[quota-scheduler] Initial check failed:', err.message);
  });

  const timer = setInterval(() => {
    runMonthlyQuotaReset(pool).catch((err) => {
      console.error('[quota-scheduler] Periodic check failed:', err.message);
    });
  }, 10 * 60 * 1000);

  if (timer.unref) timer.unref();
  return timer;
}
