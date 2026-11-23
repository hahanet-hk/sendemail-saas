import { registerBillingOauthLiveRoutes } from "./routes_billing_oauth_live.js";
import { registerTrackingRoutes } from "./routes_tracking.js";
import { registerAuthSecurityRoutes } from "./routes_auth_security.js";
import { registerSuperAdminCmsRoutes } from "./routes_superadmin_cms.js";
import { registerBillingAndSsoRoutes } from "./routes_billing_sso.js";
import { registerAutomationRoutes } from "./routes_automations.js";
import { registerBounceRoutes, registerBounceGuard } from "./routes_bounces.js";
import { registerPreflightRoutes } from "./routes_preflight.js";
import { registerSpamRoutes } from "./routes_spam.js";
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { Queue } from 'bullmq';
import { sha256, parseCookies, clearSessionCookie } from './auth.js';
import { ensureTenant, registerAuthRoutes } from './routes_auth.js';
import { registerDomainRoutes } from './routes_domains.js';
import { registerChannelRoutes } from './routes_channels.js';
import { registerSendRoutes } from './routes_send.js';
import { registerSuppressionRoutes } from './routes_suppressions.js';
import { registerWebhookRoutes } from './routes_webhooks.js';
import { registerAnalyticsRoutes } from './routes_analytics.js';
import { registerVerifyRoutes } from './routes_verify.js';
import { registerTemplateRoutes } from './routes_templates.js';
import { createRateLimiter } from './rate_limiter.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
const pool = mysql.createPool({ host: process.env.DB_HOST || 'global-mariadb', port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME || 'sendemail_saas', user: process.env.DB_USER || 'sendemail_user', password: process.env.DB_PASSWORD, waitForConnections: true, connectionLimit: 10 });
const redisConnection = { host: process.env.REDIS_HOST || 'global-redis', port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD, db: Number(process.env.REDIS_DB || 14) };
const verifyQueue = new Queue('email-verify', { connection: redisConnection });
const dispatchQueue = new Queue('email-dispatch', { connection: redisConnection });
async function authenticateTenant(req, res, next) {
  try {
    const auth = req.headers.authorization || '', bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer) {
      const [kr] = await pool.query('SELECT k.id AS kid, k.scopes, t.* FROM sendemail_saas.api_keys k JOIN sendemail_saas.tenants t ON t.id=k.tenant_id WHERE k.key_hash=? AND k.revoked_at IS NULL AND t.status="active" LIMIT 1', [sha256(bearer)]);
      if (kr.length) { req.tenant = kr[0]; pool.query('UPDATE sendemail_saas.api_keys SET last_used_at=NOW(), last_used_ip=? WHERE id=?', [String(req.ip || '').slice(0, 45), kr[0].kid]).catch(() => {}); return next(); }
      const [lr] = await pool.query('SELECT * FROM sendemail_saas.tenants WHERE api_token=? AND status="active" LIMIT 1', [bearer]);
      if (lr.length) { req.tenant = lr[0]; return next(); }
      return res.status(401).json({ error: 'INVALID_OR_REVOKED_API_KEY' });
    }
    const tok = parseCookies(req).se_session;
    if (!tok) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const [sr] = await pool.query('SELECT u.id, u.uuid, u.email, u.full_name FROM global_auth.sessions s JOIN global_auth.users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.status="active" LIMIT 1', [sha256(tok)]);
    if (!sr.length) { clearSessionCookie(res); return res.status(401).json({ error: 'SESSION_EXPIRED' }); }
    req.user = sr[0]; req.tenant = await ensureTenant(pool, req.user);
    if (req.tenant.status !== 'active') return res.status(403).json({ error: 'TENANT_SUSPENDED' });
    next();
  } catch (e) { res.status(500).json({ error: 'AUTH_ERROR', message: e.message }); }
}
app.get("/api/v1/openapi.yaml", (req, res) => {
  const candidates = ["/app/docs/openapi.yaml", path.resolve("../docs/openapi.yaml"), path.resolve("docs/openapi.yaml")];
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) return res.status(404).json({ error: "OPENAPI_SPEC_NOT_FOUND" });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/yaml; charset=utf-8");
  res.send(fs.readFileSync(file, "utf8"));
});

const limiter = createRateLimiter(redisConnection);
app.use("/api/v1/auth/login", limiter({ bucket: "auth", max: 15, windowMs: 60000 }));
app.use("/api/v1/auth/register", limiter({ bucket: "auth", max: 15, windowMs: 60000 }));
for (const m of ['get','post','put','patch','delete']) { const o = app[m].bind(app); app[m] = (p, ...hs) => o(p, ...hs.map(h => typeof h === 'function' && h.length < 4 ? (q, s, n) => Promise.resolve(h(q, s, n)).catch(n) : h)); }
process.on('unhandledRejection', e => console.error('[API Reject]', e));
app.use("/api/v1/send", limiter({ bucket: "dispatch", max: 120, windowMs: 60000 }));
app.use("/api/v1/verify", limiter({ bucket: "dispatch", max: 120, windowMs: 60000 }));
app.use("/api/v1", limiter({ bucket: "global", max: 600, windowMs: 60000 }));
registerAuthSecurityRoutes(app, pool, authenticateTenant, redisConnection, dispatchQueue);
registerAuthRoutes(app, pool, authenticateTenant);
registerDomainRoutes(app, pool, authenticateTenant);
registerChannelRoutes(app, pool, authenticateTenant);
registerBounceGuard(app, pool);
registerSendRoutes(app, pool, authenticateTenant, dispatchQueue);
registerSuppressionRoutes(app, pool, authenticateTenant);
await registerWebhookRoutes(app, pool, authenticateTenant);
registerTrackingRoutes(app, pool);
registerAnalyticsRoutes(app, pool, authenticateTenant);
registerSpamRoutes(app, pool, authenticateTenant);
registerPreflightRoutes(app, pool, authenticateTenant);
registerBounceRoutes(app, pool, authenticateTenant);
registerAutomationRoutes(app, pool, authenticateTenant, redisConnection);
registerBillingOauthLiveRoutes(app, pool, authenticateTenant, redisConnection);
registerBillingAndSsoRoutes(app, pool, authenticateTenant);
registerSuperAdminCmsRoutes(app, pool, authenticateTenant, redisConnection);
await registerVerifyRoutes(app, pool, authenticateTenant, verifyQueue);
await registerTemplateRoutes(app, pool, authenticateTenant);
app.get("/api/v1/billing/reset-logs", authenticateTenant, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, cycle_key, tenants_reset_count, total_quota_cleared, executed_at FROM quota_reset_logs ORDER BY cycle_key DESC LIMIT 24");
    res.json({ logs: rows });
  } catch (e) {
    res.json({ logs: [] });
  }
});

app.get('/api/health', async (_q, s) => { try { await pool.query('SELECT 1 FROM global_auth.users LIMIT 1'); s.json({ status: 'ok', service: 'sendemail-api' }); } catch (e) { s.status(500).json({ status: 'error', message: e.message }); } });
app.get('/api/v1/me', authenticateTenant, (req, res) => { const { id, name, email, credit_balance, monthly_quota, used_quota, status, created_at } = req.tenant; res.json({ id, name, email, credit_balance, monthly_quota, used_quota, status, created_at }); });
app.get('/api/v1/dispatches/:dispatchUid', authenticateTenant, async (req, res) => { const [r] = await pool.query('SELECT dispatch_uid, mode, subject, recipient_count, mw_reference_uid, status, error_message, created_at FROM email_dispatches WHERE dispatch_uid=? AND tenant_id=? LIMIT 1', [req.params.dispatchUid, req.tenant.id]); res.status(r.length ? 200 : 404).json(r[0] || { error: 'NOT_FOUND' }); });
app.use((err, _q, res, _n) => { console.error('[API Err]', err); if (!res.headersSent) res.status(500).json({ error: err?.code || 'INTERNAL_SERVER_ERROR', message: err?.message }); });
app.listen(Number(process.env.API_PORT || 8096), '0.0.0.0', () => console.log('sendemail-api listening on 8096'));
