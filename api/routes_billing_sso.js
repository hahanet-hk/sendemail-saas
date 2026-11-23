import crypto from "node:crypto";

const TOPUP_PACKAGES = {
  pack_10k: { credits: 10000, usd: 15.0, hkd: 118.0, twd: 480.0 },
  pack_50k: { credits: 50000, usd: 60.0, hkd: 468.0, twd: 1920.0 },
  pack_200k: { credits: 200000, usd: 199.0, hkd: 1550.0, twd: 6350.0 }
};

function getPriceByCurrency(row, currency, prefix = "price_") {
  const cur = String(currency || "USD").toUpperCase();
  if (cur === "HKD") return Number(row[`${prefix}hkd`] ?? row.hkd);
  if (cur === "TWD") return Number(row[`${prefix}twd`] ?? row.twd);
  return Number(row[`${prefix}usd`] ?? row.usd);
}

async function fulfillPaidOrder(pool, orderUid, providerIntentId = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ord]] = await conn.query("SELECT * FROM billing_orders WHERE order_uid=? FOR UPDATE", [orderUid]);
    if (!ord) {
      await conn.rollback();
      return { ok: false, error: "ORDER_NOT_FOUND" };
    }
    if (ord.status === "paid") {
      await conn.commit();
      return { ok: true, idempotent: true, order: ord };
    }

    await conn.query(
      "UPDATE billing_orders SET status='paid', paid_at=NOW(), provider_intent_id=COALESCE(?, provider_intent_id) WHERE id=?",
      [providerIntentId, ord.id]
    );

    const [[tenant]] = await conn.query("SELECT id, credit_balance, monthly_quota FROM tenants WHERE id=? FOR UPDATE", [ord.tenant_id]);
    let addCredits = Number(ord.credit_amount || 0);

    if (ord.order_type === "subscription" && ord.plan_code) {
      const [[plan]] = await conn.query("SELECT * FROM subscription_plans WHERE plan_code=? LIMIT 1", [ord.plan_code]);
      if (plan) {
        addCredits = Number(plan.included_verify_credits || 0);
        await conn.query(
          "UPDATE tenants SET plan_tier=?, billing_currency=?, monthly_quota=?, billing_cycle_end=DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id=?",
          [plan.plan_code, ord.currency, plan.monthly_quota, tenant.id]
        );
      }
    }

    if (addCredits > 0) {
      const newBal = Number(tenant.credit_balance) + addCredits;
      await conn.query("UPDATE tenants SET credit_balance=? WHERE id=?", [newBal, tenant.id]);
      await conn.query(
        "INSERT INTO credit_ledger (tenant_id, delta, balance_after, reason, ref_uid) VALUES (?,?,?,?,?)",
        [tenant.id, addCredits, newBal, ord.order_type === "subscription" ? `Subscription ${ord.plan_code} credits` : `Top-up ${addCredits} credits`, ord.order_uid]
      );
    }

    await conn.commit();
    return { ok: true, idempotent: false, order_uid: ord.order_uid, credits_added: addCredits };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function isSuperAdmin(pool, user) {
  if (!user?.email) return false;
  const allowList = String(process.env.SUPERADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowList.includes(user.email.toLowerCase())) return true;
  const [[firstUser]] = await pool.query("SELECT id FROM global_auth.users ORDER BY id ASC LIMIT 1");
  return Number(firstUser?.id) === Number(user.id);
}

export function registerBillingAndSsoRoutes(app, pool, auth) {
  // 1. SSO 統一身分中樞端點
  app.get("/api/v1/auth/sso/providers", (_req, res) => {
    res.json({
      hub: "global_auth",
      providers: [
        { id: "google", name: "Google Workspace / Gmail SSO", enabled: Boolean(process.env.GOOGLE_CLIENT_ID), authorize_url: "/api/v1/auth/sso/authorize?provider=google" },
        { id: "github", name: "GitHub Developer SSO", enabled: Boolean(process.env.GITHUB_CLIENT_ID), authorize_url: "/api/v1/auth/sso/authorize?provider=github" },
        { id: "global_sso", name: "Unified Portal SSO (One-Click)", enabled: true, authorize_url: "/api/v1/auth/sso/exchange" }
      ]
    });
  });

  app.get("/api/v1/auth/sso/authorize", (req, res) => {
    const provider = String(req.query.provider || "google");
    if (provider === "google" && process.env.GOOGLE_CLIENT_ID) {
      const redirectUri = encodeURIComponent(process.env.SSO_REDIRECT_URI || "https://app.sendemail.ai/api/v1/auth/sso/callback");
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20email%20profile&state=google`);
    }
    res.status(200).json({
      provider,
      mode: "global_auth_federated",
      message: "請透過 POST /api/v1/auth/sso/exchange 傳入 SSO 驗證憑證以完成跨服務單點登入。"
    });
  });

  app.post("/api/v1/auth/sso/exchange", async (req, res) => {
    const { provider, provider_uid, email, name } = req.body || {};
    const normEmail = String(email || "").trim().toLowerCase();
    const prov = ["google", "github", "global_sso"].includes(provider) ? provider : "global_sso";
    if (!normEmail || !normEmail.includes("@")) {
      return res.status(400).json({ error: "INVALID_SSO_PROFILE", message: "SSO 回傳缺少有效 Email。" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let [[gUser]] = await conn.query("SELECT id, uuid, email, full_name FROM global_auth.users WHERE email=? LIMIT 1", [normEmail]);
      if (!gUser) {
        const randPass = crypto.randomBytes(24).toString("hex");
        const [uIns] = await conn.query(
          "INSERT INTO global_auth.users (uuid, email, password_hash, full_name, email_verified_at) VALUES (?,?,?,?,NOW())",
          [crypto.randomUUID(), normEmail, "sso:" + randPass, name || normEmail.split("@")[0]]
        );
        gUser = { id: uIns.insertId, email: normEmail, full_name: name || normEmail.split("@")[0] };
      }

      if (provider_uid) {
        await conn.query(
          "INSERT IGNORE INTO global_auth.oauth_accounts (user_id, provider, provider_user_id, email) VALUES (?,?,?,?)",
          [gUser.id, prov, String(provider_uid), normEmail]
        ).catch(() => {});
      }

      let [[tenant]] = await conn.query("SELECT id, name, email FROM tenants WHERE owner_user_id=? OR email=? LIMIT 1", [gUser.id, normEmail]);
      if (!tenant) {
        const apiToken = "se_tok_" + crypto.randomBytes(20).toString("hex");
        const [tIns] = await conn.query(
          "INSERT INTO tenants (owner_user_id, name, email, api_token) VALUES (?,?,?,?)",
          [gUser.id, (name || normEmail.split("@")[0]) + " Workspace", normEmail, apiToken]
        );
        tenant = { id: tIns.insertId, name: (name || normEmail.split("@")[0]) + " Workspace", email: normEmail };
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
      await conn.query(
        "INSERT INTO global_auth.sessions (user_id, token_hash, expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 7 DAY))",
        [gUser.id, tokenHash]
      );
      await conn.commit();

      res.cookie("se_session", sessionToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 * 1000 });
      res.json({ authenticated: true, provider: prov, user: gUser, tenant });
    } catch (e) {
      await conn.rollback();
      res.status(500).json({ error: "SSO_EXCHANGE_FAILED", message: e.message });
    } finally {
      conn.release();
    }
  });

  // 2. Airwallex 多幣別訂閱與計量加購計費引擎
  app.get("/api/v1/billing/plans", auth, async (req, res) => {
    const tid = req.tenant.id;
    const [plans] = await pool.query("SELECT plan_code, name, monthly_quota, included_verify_credits, price_usd, price_hkd, price_twd, features FROM subscription_plans WHERE is_active=1 ORDER BY price_usd ASC");
    const [[tenant]] = await pool.query("SELECT plan_tier, billing_currency, billing_cycle_end, monthly_quota, used_quota, credit_balance FROM tenants WHERE id=?", [tid]);
    const [orders] = await pool.query("SELECT order_uid, order_type, plan_code, credit_amount, currency, amount, provider, status, paid_at, created_at FROM billing_orders WHERE tenant_id=? ORDER BY id DESC LIMIT 20", [tid]);
    const [ledger] = await pool.query("SELECT id, delta, balance_after, reason, ref_uid, created_at FROM credit_ledger WHERE tenant_id=? ORDER BY id DESC LIMIT 25", [tid]);
    res.json({ current: tenant, plans, topup_packages: TOPUP_PACKAGES, orders, ledger });
  });

  app.post("/api/v1/billing/checkout", auth, async (req, res) => {
    const { order_type, plan_code, topup_package, currency } = req.body || {};
    const cur = ["USD", "HKD", "TWD"].includes(String(currency || "USD").toUpperCase()) ? String(currency || "USD").toUpperCase() : "USD";
    const orderUid = "ord_" + crypto.randomBytes(10).toString("hex");
    let amount = 0;
    let creditAmount = 0;
    let resolvedPlan = null;

    if (order_type === "credit_topup") {
      const pkg = TOPUP_PACKAGES[topup_package];
      if (!pkg) return res.status(400).json({ error: "INVALID_TOPUP_PACKAGE" });
      amount = getPriceByCurrency(pkg, cur, "");
      creditAmount = pkg.credits;
    } else {
      const [[plan]] = await pool.query("SELECT * FROM subscription_plans WHERE plan_code=? AND is_active=1 LIMIT 1", [plan_code]);
      if (!plan) return res.status(400).json({ error: "INVALID_PLAN_CODE" });
      resolvedPlan = plan.plan_code;
      amount = getPriceByCurrency(plan, cur, "price_");
      creditAmount = Number(plan.included_verify_credits);
    }

    const hasAirwallex = Boolean(process.env.AIRWALLEX_CLIENT_ID && process.env.AIRWALLEX_API_KEY);
    const provider = hasAirwallex ? "airwallex" : "sandbox_sim";
    const providerIntentId = "int_" + crypto.randomBytes(12).toString("hex");

    await pool.query(
      "INSERT INTO billing_orders (order_uid, tenant_id, order_type, plan_code, credit_amount, currency, amount, provider, provider_intent_id, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [orderUid, req.tenant.id, order_type === "credit_topup" ? "credit_topup" : "subscription", resolvedPlan, creditAmount, cur, amount, provider, providerIntentId, "pending"]
    );

    if (amount === 0) {
      const done = await fulfillPaidOrder(pool, orderUid, providerIntentId);
      return res.status(201).json({ order_uid: orderUid, status: "paid", amount: 0, currency: cur, fulfilled: done });
    }

    res.status(201).json({
      order_uid: orderUid,
      provider,
      provider_intent_id: providerIntentId,
      currency: cur,
      amount,
      status: "pending",
      checkout_url: `/dashboard?billing_order=${orderUid}`
    });
  });

  app.post("/api/v1/billing/orders/:orderUid/confirm", auth, async (req, res) => {
    const [[ord]] = await pool.query("SELECT order_uid FROM billing_orders WHERE order_uid=? AND tenant_id=? LIMIT 1", [req.params.orderUid, req.tenant.id]);
    if (!ord) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    const result = await fulfillPaidOrder(pool, ord.order_uid);
    res.json(result);
  });

  app.post("/api/v1/billing/webhooks/airwallex", async (req, res) => {
    const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
    if (secret) {
      const sig = String(req.headers["x-signature"] || "");
      const ts = String(req.headers["x-timestamp"] || "");
      const expected = crypto.createHmac("sha256", secret).update(ts + JSON.stringify(req.body || {})).digest("hex");
      if (!sig || sig !== expected) return res.status(401).json({ error: "INVALID_AIRWALLEX_SIGNATURE" });
    }
    const evName = req.body?.name || req.body?.event_type;
    const obj = req.body?.data?.object || req.body || {};
    const orderUid = obj.merchant_order_id || obj.order_uid;
    if (evName === "payment_intent.succeeded" && orderUid) {
      const out = await fulfillPaidOrder(pool, orderUid, obj.id || null);
      return res.json({ received: true, ...out });
    }
    res.json({ received: true, ignored: evName || "unknown" });
  });

  // 3. 超級管理員全域戰情室 API
  app.get("/api/v1/superadmin/overview", auth, async (req, res) => {
    if (!(await isSuperAdmin(pool, req.user))) {
      return res.status(403).json({ error: "SUPERADMIN_REQUIRED", message: "僅限平台超級管理員存取全域戰情室。" });
    }
    const [[kpis]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tenants) AS total_tenants,
        (SELECT COUNT(*) FROM tenants WHERE sending_frozen_at IS NOT NULL) AS frozen_tenants,
        (SELECT COALESCE(SUM(recipient_count),0) FROM email_dispatches) AS total_emails_dispatched,
        (SELECT COALESCE(SUM(amount),0) FROM billing_orders WHERE status='paid') AS gross_revenue_paid
    `);
    const [tenants] = await pool.query(
      "SELECT id, name, email, plan_tier, billing_currency, monthly_quota, used_quota, credit_balance, reputation_score, sending_frozen_at, freeze_reason, created_at FROM tenants ORDER BY id DESC LIMIT 100"
    );
    const [audits] = await pool.query("SELECT id, actor_email, target_tenant_id, action, details, created_at FROM superadmin_audit_logs ORDER BY id DESC LIMIT 30");
    res.json({ kpis, tenants, audits });
  });

  app.post("/api/v1/superadmin/tenants/:tenantId/action", auth, async (req, res) => {
    if (!(await isSuperAdmin(pool, req.user))) {
      return res.status(403).json({ error: "SUPERADMIN_REQUIRED" });
    }
    const targetId = Number(req.params.tenantId);
    const { action, reason, add_credits, new_quota } = req.body || {};
    if (action === "freeze") {
      await pool.query("UPDATE tenants SET sending_frozen_at=NOW(), freeze_reason=? WHERE id=?", [reason || "SuperAdmin manual freeze", targetId]);
    } else if (action === "unfreeze") {
      await pool.query("UPDATE tenants SET sending_frozen_at=NULL, freeze_reason=NULL, reputation_score=GREATEST(reputation_score, 85) WHERE id=?", [targetId]);
    } else if (action === "adjust") {
      if (Number(add_credits)) {
        await pool.query("UPDATE tenants SET credit_balance = GREATEST(0, credit_balance + ?) WHERE id=?", [Number(add_credits), targetId]);
      }
      if (Number(new_quota) > 0) {
        await pool.query("UPDATE tenants SET monthly_quota = ? WHERE id=?", [Number(new_quota), targetId]);
      }
    } else {
      return res.status(400).json({ error: "INVALID_SUPERADMIN_ACTION" });
    }

    await pool.query(
      "INSERT INTO superadmin_audit_logs (actor_email, target_tenant_id, action, details) VALUES (?,?,?,?)",
      [req.user.email, targetId, action, JSON.stringify({ reason, add_credits, new_quota })]
    );
    res.json({ ok: true, target_tenant_id: targetId, action });
  });
}
