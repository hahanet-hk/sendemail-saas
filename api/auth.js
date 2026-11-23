import crypto from 'node:crypto';
export const hashPassword = (pw) => { const s = crypto.randomBytes(16).toString('hex'); return `scrypt:${s}:${crypto.scryptSync(pw, s, 64).toString('hex')}`; };
export const verifyPassword = (pw, st) => { if (!st?.startsWith('scrypt:')) return false; const [, s, h] = st.split(':'); const b = Buffer.from(h, 'hex'), d = crypto.scryptSync(pw, s, 64); return b.length === d.length && crypto.timingSafeEqual(b, d); };
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
export const generateApiKey = (e = 'live') => { const r = (e === 'test' ? 'se_test_' : 'se_live_') + crypto.randomBytes(24).toString('hex'); return { raw: r, prefix: r.slice(0, 14), hash: sha256(r) }; };
export function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
export const setSessionCookie = (res, t) => res.setHeader('Set-Cookie', `se_session=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
export const clearSessionCookie = (res) => res.setHeader('Set-Cookie', 'se_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
