import crypto from 'node:crypto';
import { hashPassword, verifyPassword, sha256, generateApiKey, parseCookies, setSessionCookie, clearSessionCookie } from './auth.js';

export async function ensureTenant(pool, user) {
  const [ex] = await pool.query('SELECT * FROM sendemail_saas.tenants WHERE owner_user_id = ? LIMIT 1', [user.id]);
  if (ex.length) return ex[0];
  const [em] = await pool.query('SELECT * FROM sendemail_saas.tenants WHERE email = ? LIMIT 1', [user.email]);
  if (em.length) { await pool.query('UPDATE sendemail_saas.tenants SET owner_user_id = ? WHERE id = ?', [user.id, em[0].id]); return { ...em[0], owner_user_id: user.id }; }
  const name = (user.full_name || user.email.split('@')[0]) + "'s Workspace";
  const tok = 'se_live_' + crypto.randomBytes(24).toString('hex');
  const [ins] = await pool.query('INSERT INTO sendemail_saas.tenants (owner_user_id, name, email, api_token, credit_balance, monthly_quota, used_quota, status) VALUES (?, ?, ?, ?, 1000, 1000, 0, "active")', [user.id, name, user.email, tok]);
  const k = generateApiKey('live');
  await pool.query('INSERT INTO sendemail_saas.api_keys (tenant_id, name, key_prefix, key_hash, environment, scopes) VALUES (?, "Default Live Key", ?, ?, "live", ?)', [ins.insertId, k.prefix, k.hash, JSON.stringify(['send:transactional', 'send:campaign', 'verify:read'])]);
  return (await pool.query('SELECT * FROM sendemail_saas.tenants WHERE id = ? LIMIT 1', [ins.insertId]))[0][0];
}
async function createSess(pool, uid, req, res) {
  const raw = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO global_auth.sessions (user_id, token_hash, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?)', [uid, sha256(raw), String(req.headers['user-agent'] || '').slice(0, 250), String(req.ip || '').slice(0, 45), new Date(Date.now() + 30 * 86400000)]);
  await pool.query('UPDATE global_auth.users SET last_login_at = NOW() WHERE id = ?', [uid]);
  setSessionCookie(res, raw);
}

export function registerAuthRoutes(app, pool, authMw) {
  app.post('/api/v1/auth/register', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), pw = String(req.body?.password || ''), fn = String(req.body?.full_name || '').trim();
    if (!email.includes('@') || pw.length < 8) return res.status(400).json({ error: 'INVALID_EMAIL_OR_SHORT_PASSWORD' });
    const [ex] = await pool.query('SELECT id FROM global_auth.users WHERE email = ? LIMIT 1', [email]);
    if (ex.length) return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED' });
    const uuid = crypto.randomUUID();
    const [u] = await pool.query('INSERT INTO global_auth.users (uuid, email, password_hash, full_name, status) VALUES (?, ?, ?, ?, "active")', [uuid, email, hashPassword(pw), fn || null]);
    const user = { id: u.insertId, uuid, email, full_name: fn || null };
    const t = await ensureTenant(pool, user);
    await createSess(pool, user.id, req, res);
    res.status(201).json({ user, tenant: { id: t.id, name: t.name, credit_balance: t.credit_balance, monthly_quota: t.monthly_quota, used_quota: t.used_quota } });
  });
  app.post('/api/v1/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), pw = String(req.body?.password || '');
    const [rows] = await pool.query('SELECT id, uuid, email, password_hash, full_name, status FROM global_auth.users WHERE email = ? LIMIT 1', [email]);
    if (!rows.length || !verifyPassword(pw, rows[0].password_hash)) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    if (rows[0].status !== 'active') return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    const user = { id: rows[0].id, uuid: rows[0].uuid, email: rows[0].email, full_name: rows[0].full_name };
    const t = await ensureTenant(pool, user);
    await createSess(pool, user.id, req, res);
    res.json({ user, tenant: { id: t.id, name: t.name, credit_balance: t.credit_balance, monthly_quota: t.monthly_quota, used_quota: t.used_quota } });
  });
  app.post('/api/v1/auth/logout', async (req, res) => {
    const c = parseCookies(req);
    if (c.se_session) await pool.query('DELETE FROM global_auth.sessions WHERE token_hash = ?', [sha256(c.se_session)]).catch(() => {});
    clearSessionCookie(res);
    res.json({ ok: true });
  });
  app.get('/api/v1/auth/session', authMw, async (req, res) => {
    const [[ds]] = await pool.query('SELECT COALESCE(SUM(recipient_count),0) total_recipients, COALESCE(SUM(CASE WHEN status="sent" THEN recipient_count ELSE 0 END),0) sent_recipients, COUNT(*) total_dispatches FROM sendemail_saas.email_dispatches WHERE tenant_id=?', [req.tenant.id]);
    let vs = { total_checked: 0, blocked_invalid: 0 }; try { const [[r]] = await pool.query('SELECT COALESCE(SUM(total_count),0) total_checked, COALESCE(SUM(undeliverable_count),0) blocked_invalid FROM sendemail_saas.verification_batches WHERE tenant_id=?', [req.tenant.id]); if (r) vs = r; } catch { try { const [[r2]] = await pool.query('SELECT COALESCE(SUM(total_count),0) total_checked, 0 blocked_invalid FROM sendemail_saas.verification_batches WHERE tenant_id=?', [req.tenant.id]); if (r2) vs = r2; } catch {} }
    const [recent] = await pool.query('SELECT dispatch_uid, mode, subject, recipient_count, status, created_at FROM sendemail_saas.email_dispatches WHERE tenant_id=? ORDER BY id DESC LIMIT 8', [req.tenant.id]);
    res.json({ user: req.user || { email: req.tenant.email, full_name: req.tenant.name }, tenant: req.tenant, stats: ds, verify_stats: vs, recent_dispatches: recent });
  });
  app.get('/api/v1/api-keys', authMw, async (req, res) => {
    const [keys] = await pool.query('SELECT id, name, key_prefix, environment, scopes, last_used_at, last_used_ip, revoked_at, created_at FROM sendemail_saas.api_keys WHERE tenant_id=? ORDER BY id DESC', [req.tenant.id]);
    res.json({ keys: keys.map((k) => ({ ...k, scopes: typeof k.scopes === 'string' ? JSON.parse(k.scopes) : k.scopes })) });
  });
  app.post('/api/v1/api-keys', authMw, async (req, res) => {
    const name = String(req.body?.name || '').trim(), env = req.body?.environment === 'test' ? 'test' : 'live';
    const allowed = ['send:transactional', 'send:campaign', 'verify:read'];
    const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes.filter((s) => allowed.includes(s)) : allowed;
    if (!name || !scopes.length) return res.status(400).json({ error: 'NAME_AND_SCOPES_REQUIRED' });
    const g = generateApiKey(env);
    const [ins] = await pool.query('INSERT INTO sendemail_saas.api_keys (tenant_id, name, key_prefix, key_hash, environment, scopes) VALUES (?, ?, ?, ?, ?, ?)', [req.tenant.id, name, g.prefix, g.hash, env, JSON.stringify(scopes)]);
    res.status(201).json({ id: ins.insertId, name, key_prefix: g.prefix, secret_key: g.raw, environment: env, scopes, created_at: new Date().toISOString() });
  });
  app.delete('/api/v1/api-keys/:id', authMw, async (req, res) => {
    const [u] = await pool.query('UPDATE sendemail_saas.api_keys SET revoked_at=NOW() WHERE id=? AND tenant_id=? AND revoked_at IS NULL', [Number(req.params.id), req.tenant.id]);
    if (!u.affectedRows) return res.status(404).json({ error: 'KEY_NOT_FOUND' });
    res.json({ ok: true });
  });

  app.put('/api/v1/auth/profile', authMw, async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ error: 'USER_SESSION_REQUIRED' });
    const fn = req.body?.full_name !== undefined ? String(req.body.full_name || '').trim() : undefined;
    const cur = String(req.body?.current_password || ''), nw = String(req.body?.new_password || '');
    if (fn !== undefined) await pool.query('UPDATE global_auth.users SET full_name=? WHERE id=?', [fn || null, req.user.id]);
    if (nw) { if (nw.length < 8) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT_MIN_8' }); const [[u]] = await pool.query('SELECT password_hash FROM global_auth.users WHERE id=?', [req.user.id]); if (u?.password_hash && !verifyPassword(cur, u.password_hash)) return res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD' }); await pool.query('UPDATE global_auth.users SET password_hash=? WHERE id=?', [hashPassword(nw), req.user.id]); }
    const [[up]] = await pool.query('SELECT id, uuid, email, full_name, status FROM global_auth.users WHERE id=?', [req.user.id]);
    res.json({ ok: true, user: up });
  });
}
