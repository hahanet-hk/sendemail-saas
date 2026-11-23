import { dispatchTenantWebhooks } from "./routes_webhooks.js";

const alertThrottle = new Map();
function shouldEmitAlert(tenantId, key, ttlMs = 300000) {
  const k = `${tenantId}:${key}`;
  const now = Date.now();
  const prev = alertThrottle.get(k) || 0;
  if (now - prev < ttlMs) return false;
  alertThrottle.set(k, now);
  return true;
}

export async function reserveMonthlyQuota(pool, tenantId, count) {
  const n = Math.max(1, Number(count || 0));
  const [[before]] = await pool.query(
    "SELECT monthly_quota, used_quota FROM tenants WHERE id=? LIMIT 1",
    [tenantId]
  );
  if (!before) return { ok: false, error: "TENANT_NOT_FOUND" };

  const [upd] = await pool.query(
    "UPDATE tenants SET used_quota = used_quota + ? WHERE id=? AND status='active' AND (used_quota + ?) <= monthly_quota",
    [n, tenantId, n]
  );

  if (!upd.affectedRows) {
    if (shouldEmitAlert(tenantId, `quota_exceeded_${before.monthly_quota}`)) {
      dispatchTenantWebhooks(pool, tenantId, "quota.exceeded", {
        resource: "monthly_quota",
        attempted: n,
        used_quota: Number(before.used_quota),
        monthly_quota: Number(before.monthly_quota),
        remaining: Math.max(0, Number(before.monthly_quota) - Number(before.used_quota))
      }).catch(() => {});
    }
    return {
      ok: false,
      error: "QUOTA_EXCEEDED",
      used_quota: Number(before.used_quota),
      monthly_quota: Number(before.monthly_quota),
      remaining: Math.max(0, Number(before.monthly_quota) - Number(before.used_quota))
    };
  }

  const total = Number(before.monthly_quota) || 1;
  const prevUsed = Number(before.used_quota);
  const newUsed = prevUsed + n;
  const prevPct = (prevUsed / total) * 100;
  const newPct = (newUsed / total) * 100;

  if (prevPct < 80 && newPct >= 80 && newPct < 100) {
    dispatchTenantWebhooks(pool, tenantId, "quota.warning", {
      resource: "monthly_quota",
      threshold_percent: 80,
      usage_percent: Number(newPct.toFixed(2)),
      used_quota: newUsed,
      monthly_quota: total,
      remaining: Math.max(0, total - newUsed)
    }).catch(() => {});
  } else if (prevPct < 100 && newPct >= 100) {
    dispatchTenantWebhooks(pool, tenantId, "quota.exceeded", {
      resource: "monthly_quota",
      threshold_percent: 100,
      usage_percent: 100,
      used_quota: newUsed,
      monthly_quota: total,
      remaining: 0
    }).catch(() => {});
  }

  return { ok: true, used_quota: newUsed, monthly_quota: total, remaining: Math.max(0, total - newUsed) };
}

export async function refundMonthlyQuota(pool, tenantId, count) {
  const n = Math.max(1, Number(count || 0));
  await pool.query("UPDATE tenants SET used_quota = GREATEST(0, CAST(used_quota AS SIGNED) - ?) WHERE id=?", [n, tenantId]).catch(() => {});
}

export async function reserveVerifyCredits(pool, tenantId, count) {
  const n = Math.max(1, Number(count || 0));
  const [[before]] = await pool.query(
    "SELECT credit_balance FROM tenants WHERE id=? LIMIT 1",
    [tenantId]
  );
  if (!before) return { ok: false, error: "TENANT_NOT_FOUND" };

  const [upd] = await pool.query(
    "UPDATE tenants SET credit_balance = credit_balance - ? WHERE id=? AND status='active' AND credit_balance >= ?",
    [n, tenantId, n]
  );

  if (!upd.affectedRows) {
    if (shouldEmitAlert(tenantId, `credits_exhausted_${before.credit_balance}`)) {
      dispatchTenantWebhooks(pool, tenantId, "credits.exhausted", {
        resource: "credit_balance",
        attempted: n,
        credit_balance: Number(before.credit_balance)
      }).catch(() => {});
    }
    return {
      ok: false,
      error: "INSUFFICIENT_CREDITS",
      credit_balance: Number(before.credit_balance),
      required: n
    };
  }

  const prevBal = Number(before.credit_balance);
  const newBal = prevBal - n;
  const lowThreshold = 100;

  if (newBal === 0) {
    dispatchTenantWebhooks(pool, tenantId, "credits.exhausted", {
      resource: "credit_balance",
      credit_balance: 0
    }).catch(() => {});
  } else if (prevBal > lowThreshold && newBal <= lowThreshold) {
    dispatchTenantWebhooks(pool, tenantId, "credits.low", {
      resource: "credit_balance",
      threshold: lowThreshold,
      credit_balance: newBal
    }).catch(() => {});
  }

  return { ok: true, credit_balance: newBal };
}

export async function refundVerifyCredits(pool, tenantId, count) {
  const n = Math.max(1, Number(count || 0));
  await pool.query("UPDATE tenants SET credit_balance = credit_balance + ? WHERE id=?", [n, tenantId]).catch(() => {});
}
