import crypto from 'node:crypto';
import { SettingsVault } from './lib/settings_vault.js';

export function registerBillingOauthLiveRoutes(app, pool, auth, redisConfig) {
  const vault = new SettingsVault(pool, redisConfig);

  app.get('/api/v1/auth/sso/providers', async (_req, res) => {
    const [gid, ghid] = await Promise.all([vault.get('google_client_id'), vault.get('github_client_id')]);
    res.json({
      hub: 'global_auth',
      providers: [
        { id: 'google', name: 'Google Workspace / Gmail SSO', enabled: Boolean(gid || process.env.GOOGLE_CLIENT_ID), authorize_url: '/api/v1/auth/sso/authorize?provider=google' },
        { id: 'github', name: 'GitHub Developer SSO', enabled: Boolean(ghid || process.env.GITHUB_CLIENT_ID), authorize_url: '/api/v1/auth/sso/authorize?provider=github' },
        { id: 'global_sso', name: 'Unified Portal SSO', enabled: true, authorize_url: '/api/v1/auth/sso/exchange' }
      ]
    });
  });

  app.get('/api/v1/auth/sso/authorize', async (req, res) => {
    const provider = String(req.query.provider || 'google');
    const redirectUri = encodeURIComponent(process.env.SSO_REDIRECT_URI || 'https://app.sendemail.ai/api/v1/auth/sso/callback');
    if (provider === 'google') {
      const cid = (await vault.get('google_client_id')) || process.env.GOOGLE_CLIENT_ID;
      if (cid) return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${cid}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20email%20profile&state=google`);
    }
    if (provider === 'github') {
      const cid = (await vault.get('github_client_id')) || process.env.GITHUB_CLIENT_ID;
      if (cid) return res.redirect(`https://github.com/login/oauth/authorize?client_id=${cid}&redirect_uri=${redirectUri}&scope=user:email&state=github`);
    }
    res.status(400).json({ error: 'OAUTH_PROVIDER_NOT_CONFIGURED', provider });
  });

  app.get('/api/v1/auth/sso/callback', async (req, res) => {
    const { code, state } = req.query || {};
    const provider = state === 'github' ? 'github' : 'google';
    const redirectUri = process.env.SSO_REDIRECT_URI || 'https://app.sendemail.ai/api/v1/auth/sso/callback';
    if (!code) return res.status(400).json({ error: 'MISSING_OAUTH_CODE' });
    try {
      let profile = null;
      if (provider === 'google') {
        const [cid, csec] = await Promise.all([vault.get('google_client_id'), vault.get('google_client_secret')]);
        const tk = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client_id: cid, client_secret: csec, redirect_uri: redirectUri, grant_type: 'authorization_code' }) }).then((r) => r.json());
        if (tk.access_token) {
          const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tk.access_token}` } }).then((r) => r.json());
          if (u.email) profile = { provider: 'google', provider_uid: u.id, email: u.email, name: u.name };
        }
      } else {
        const [cid, csec] = await Promise.all([vault.get('github_client_id'), vault.get('github_client_secret')]);
        const tk = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client_id: cid, client_secret: csec, redirect_uri: redirectUri }) }).then((r) => r.json());
        if (tk.access_token) {
          const u = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tk.access_token}`, 'User-Agent': 'SendEmail-AI' } }).then((r) => r.json());
          const ems = await fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${tk.access_token}`, 'User-Agent': 'SendEmail-AI' } }).then((r) => r.json());
          const primary = Array.isArray(ems) ? (ems.find((e) => e.primary && e.verified) || ems[0])?.email : u.email;
          if (primary) profile = { provider: 'github', provider_uid: String(u.id), email: primary, name: u.name || u.login };
        }
      }
      if (!profile) return res.status(401).json({ error: 'OAUTH_PROFILE_EXCHANGE_FAILED' });
      const ex = await fetch('http://127.0.0.1:8096/api/v1/auth/sso/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
      const setCookie = ex.headers.get('set-cookie');
      if (setCookie) res.setHeader('Set-Cookie', setCookie);
      return res.redirect('/dashboard');
    } catch (e) {
      return res.status(500).json({ error: 'OAUTH_CALLBACK_ERROR', message: e.message });
    }
  });

  app.post('/api/v1/billing/checkout', auth, async (req, res, next) => {
    const [cid, apiKey, envMode, apiVer] = await Promise.all([vault.get('airwallex_client_id'), vault.get('airwallex_api_key'), vault.get('airwallex_env'), vault.get('airwallex_api_version')]);
    const verHeader = { 'x-api-version': apiVer || '2024-06-30' };
    if (!cid || !apiKey) return next();
    const { order_type, plan_code, topup_package, currency } = req.body || {};
    const cur = ['USD', 'HKD', 'TWD'].includes(String(currency || 'USD').toUpperCase()) ? String(currency || 'USD').toUpperCase() : 'USD';
    const orderUid = 'ord_' + crypto.randomBytes(10).toString('hex');
    const pkgs = { pack_10k: { credits: 10000, USD: 15, HKD: 118, TWD: 480 }, pack_50k: { credits: 50000, USD: 60, HKD: 468, TWD: 1920 }, pack_200k: { credits: 200000, USD: 199, HKD: 1550, TWD: 6350 } };
    let amount = 0, creditAmount = 0, resolvedPlan = null;
    if (order_type === 'credit_topup') {
      if (!pkgs[topup_package]) return res.status(400).json({ error: 'INVALID_TOPUP_PACKAGE' });
      amount = pkgs[topup_package][cur]; creditAmount = pkgs[topup_package].credits;
    } else {
      const [[plan]] = await pool.query('SELECT * FROM subscription_plans WHERE plan_code=? AND is_active=1 LIMIT 1', [plan_code]);
      if (!plan) return res.status(400).json({ error: 'INVALID_PLAN_CODE' });
      resolvedPlan = plan.plan_code; amount = Number(plan[`price_${cur.toLowerCase()}`]); creditAmount = Number(plan.included_verify_credits);
    }
    if (amount === 0) return next();
    const base = envMode === 'prod' ? 'https://api.airwallex.com' : 'https://api-demo.airwallex.com';
    const authRes = await fetch(`${base}/api/v1/authentication/login`, { method: 'POST', headers: { ...verHeader, 'x-client-id': cid, 'x-api-key': apiKey, 'Content-Type': 'application/json' } }).then((r) => r.json()).catch(() => ({}));
    if (!authRes.token) return res.status(502).json({ error: 'AIRWALLEX_AUTH_FAILED' });
    const intent = await fetch(`${base}/api/v1/pa/payment_intents/create`, {
      method: 'POST', headers: { ...verHeader, Authorization: `Bearer ${authRes.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: crypto.randomUUID(), amount, currency: cur, merchant_order_id: orderUid, descriptor: `SendEmail.ai ${resolvedPlan || topup_package}` })
    }).then((r) => r.json()).catch(() => ({}));
    if (!intent.id) return res.status(502).json({ error: 'AIRWALLEX_INTENT_FAILED', detail: intent });
    await pool.query('INSERT INTO billing_orders (order_uid, tenant_id, order_type, plan_code, credit_amount, currency, amount, provider, provider_intent_id, status) VALUES (?,?,?,?,?,?,?,?,?,?)', [orderUid, req.tenant.id, order_type === 'credit_topup' ? 'credit_topup' : 'subscription', resolvedPlan, creditAmount, cur, amount, 'airwallex', intent.id, 'pending']);
    res.status(201).json({ order_uid: orderUid, provider: 'airwallex', env: envMode === 'prod' ? 'prod' : 'demo', provider_intent_id: intent.id, client_secret: intent.client_secret, currency: cur, amount, status: 'pending' });
  });

  app.post('/api/v1/billing/webhooks/airwallex', async (req, res, next) => {
    const secret = (await vault.get('airwallex_webhook_secret')) || process.env.AIRWALLEX_WEBHOOK_SECRET;
    if (secret) {
      const sig = String(req.headers['x-signature'] || '');
      const ts = String(req.headers['x-timestamp'] || '');
      const expected = crypto.createHmac('sha256', secret).update(ts + JSON.stringify(req.body || {})).digest('hex');
      const a = Buffer.from(sig, 'utf8'), b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'INVALID_AIRWALLEX_SIGNATURE' });
    }
    next();
  });
}
