import dns from 'node:dns/promises';
import Redis from 'ioredis';
import { hashPassword, sha256 } from './auth.js';
import { SettingsVault } from './lib/settings_vault.js';
import { issueAuthToken, sendDogfoodEmail } from './lib/dogfood_mailer.js';

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com', 'throwawaymail.com', 'dispostable.com']);

export function registerAuthSecurityRoutes(app, pool, _authMw, redisConfig, dispatchQueue) {
  const redis = new Redis({ ...redisConfig, maxRetriesPerRequest: 2 });
  const vault = new SettingsVault(pool, redisConfig);
  const hitIp = async (k, max, sec) => { const n = await redis.incr(k); if (n === 1) await redis.expire(k, sec); return n <= max; };

  app.use('/api/v1/auth/register', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const betaCode = process.env.BETA_INVITE_CODE;
    if (betaCode && String(req.body?.invite_code || "").trim() !== betaCode) return res.status(403).json({ error: "INVITE_CODE_REQUIRED: Private beta only." });
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim();
    if (!(await hitIp(`sec:reg:ip:${ip}`, 2, 3600))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    const sk = await vault.get('turnstile_secret_key');
    if (sk) {
      const tk = req.body?.['cf-turnstile-response'] || req.body?.turnstile_token;
      if (!tk) return res.status(400).json({ error: 'TURNSTILE_TOKEN_REQUIRED' });
      const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: sk, response: tk, remoteip: ip }) }).then((r) => r.json()).catch(() => ({ success: false }));
      if (!vr.success) return res.status(403).json({ error: 'TURNSTILE_VERIFICATION_FAILED' });
    }
    const domain = String(req.body?.email || '').trim().toLowerCase().split('@')[1] || '';
    if (!domain || DISPOSABLE.has(domain)) return res.status(400).json({ error: 'DISPOSABLE_EMAIL_NOT_ALLOWED' });
    if (!(await dns.resolveMx(domain).catch(() => [])).length) return res.status(400).json({ error: 'INVALID_EMAIL_DOMAIN_MX' });
    const orig = res.json.bind(res);
    res.json = (p) => {
      if (res.statusCode === 201 && p?.user?.id && p?.tenant?.id) {
        pool.query('UPDATE sendemail_saas.tenants SET email_verified=0, monthly_quota=50, credit_balance=50 WHERE id=?', [p.tenant.id]).catch(() => {});
        issueAuthToken(pool, { userId: p.user.id, tenantId: p.tenant.id, email: p.user.email, purpose: 'email_verify' })
          .then((tok) => sendDogfoodEmail(pool, dispatchQueue, { to: p.user.email, subject: 'Verify your SendEmail.ai account', htmlBody: `https://app.sendemail.ai/api/v1/auth/verify-email?token=${tok}` })).catch(() => {});
        Object.assign(p.tenant, { email_verified: 0, monthly_quota: 50, credit_balance: 50 });
      }
      return orig(p);
    };
    next();
  });

  app.use('/api/v1/auth/login', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim();
    if (!(await hitIp(`sec:login:ip:${ip}`, 5, 60))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    next();
  });

  app.get('/api/v1/auth/verify-email', async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM sendemail_saas.auth_verification_tokens WHERE token_hash=? AND purpose="email_verify" AND used_at IS NULL AND expires_at>NOW() LIMIT 1', [sha256(String(req.query.token || ''))]);
    if (!rows.length) return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    await pool.query('UPDATE sendemail_saas.auth_verification_tokens SET used_at=NOW() WHERE id=?', [rows[0].id]);
    await pool.query('UPDATE sendemail_saas.tenants SET email_verified=1, monthly_quota=GREATEST(monthly_quota,1000), credit_balance=GREATEST(credit_balance,1000) WHERE owner_user_id=?', [rows[0].user_id]);
    res.json({ ok: true, email_verified: 1, unlocked_quota: 1000 });
  });

  app.post('/api/v1/auth/forgot-password', async (req, res) => {
    const [u] = await pool.query('SELECT id, email FROM global_auth.users WHERE email=? AND status="active" LIMIT 1', [String(req.body?.email || '').trim().toLowerCase()]);
    if (u.length) {
      const tok = await issueAuthToken(pool, { userId: u[0].id, email: u[0].email, purpose: 'password_reset' });
      await sendDogfoodEmail(pool, dispatchQueue, { to: u[0].email, subject: 'Reset your SendEmail.ai password', htmlBody: `https://app.sendemail.ai/reset-password?token=${tok}` });
    }
    res.json({ ok: true });
  });

  app.post('/api/v1/auth/reset-password', async (req, res) => {
    const newPw = String(req.body?.new_password || '');
    if (newPw.length < 8) return res.status(400).json({ error: 'SHORT_PASSWORD' });
    const [rows] = await pool.query('SELECT * FROM sendemail_saas.auth_verification_tokens WHERE token_hash=? AND purpose="password_reset" AND used_at IS NULL AND expires_at>NOW() LIMIT 1', [sha256(String(req.body?.token || ''))]);
    if (!rows.length) return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    await pool.query('UPDATE sendemail_saas.auth_verification_tokens SET used_at=NOW() WHERE id=?', [rows[0].id]);
    await pool.query('UPDATE global_auth.users SET password_hash=? WHERE id=?', [hashPassword(newPw), rows[0].user_id]);
    res.json({ ok: true });
  });
}
