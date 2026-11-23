'use client';
import { useState, useEffect } from 'react';

const PLANS = [
  { code: 'free', name: 'Free Sandbox', quota: '1,000 emails/mo', credits: '500 verify credits', usd: '$0', hkd: 'HK$0', twd: 'NT$0', desc: '即時沙盒測試、雙向 DNS 校驗與基礎 API' },
  { code: 'starter', name: 'Starter Growth', quota: '25,000 emails/mo', credits: '5,000 verify credits', usd: '$29', hkd: 'HK$228', twd: 'NT$920', desc: '全自動 SPF/DKIM/DMARC 體檢、10 條 DAG 自動化流' },
  { code: 'growth', name: 'Growth Scale', quota: '150,000 emails/mo', credits: '30,000 verify credits', usd: '$99', hkd: 'HK$775', twd: 'NT$3,150', desc: '專屬發信 IP、雙源退信熔斷保護與原生 A/B 自動勝出' },
  { code: 'enterprise', name: 'Enterprise', quota: '1,000,000 emails/mo', credits: '200,000 verify credits', usd: '$399', hkd: 'HK$3,120', twd: 'NT$12,800', desc: '專屬投遞顧問、多通道負載均衡與 SLA 保障' }
];

export default function AuthView({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [tok, setTok] = useState(''); const [info, setInfo] = useState(''); const [err, setErr] = useState(''); useEffect(() => { const t = new URLSearchParams(window.location.search).get('token'); if (t) { setTok(t); setMode('reset'); } }, []);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'forgot') { const r = await fetch('/api/v1/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); const d = await r.json(); if (!r.ok) setErr(d.error || 'Failed'); else setInfo('Reset link sent to your email.'); return; } if (mode === 'reset') { const r = await fetch('/api/v1/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, new_password: password }) }); const d = await r.json(); if (!r.ok) setErr(d.error || 'Failed'); else { setInfo('Password updated! Please sign in.'); setMode('login'); setPassword(''); } return; } const url = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, full_name: fullName, invite_code: inviteCode };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) setErr(d.error || 'Authentication failed'); else onSuccess();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  async function ssoLogin(provider) {
    setErr(''); setBusy(true);
    try {
      const targetEmail = email.trim() || `dev_${Date.now().toString().slice(-4)}@sendemail.ai`;
      const r = await fetch('/api/v1/auth/sso/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, provider_uid: `${provider}_${targetEmail}`, email: targetEmail, name: fullName || targetEmail.split('@')[0] })
      });
      const d = await r.json();
      if (!r.ok) setErr(d.message || d.error || 'SSO failed'); else onSuccess();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 10, fontSize: 14, boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 20px 64px', color: '#0f172a' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 22, letterSpacing: '-0.02em' }}>SendEmail.ai</strong>
          <span style={{ fontSize: 11, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', padding: '3px 8px', borderRadius: 999 }}>v4.1 ENTERPRISE</span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 14, color: '#475569' }}>
          <a href="#features" style={{ textDecoration: 'none', color: 'inherit' }}>Capabilities</a>
          <a href="#pricing" style={{ textDecoration: 'none', color: 'inherit' }}>Multi-Currency Pricing</a>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 36, alignItems: 'start', marginBottom: 56 }}>
        <div>
          <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-0.03em' }}>
            Pre-Verified Email Delivery &amp; DAG Automation Engine
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: '#475569', margin: '0 0 22px' }}>
            整合深層信箱清洗、Rspamd 垃圾信體檢、雙源退信滑動視窗熔斷，以及支援 Goal Cancellation 與 Time-Travel 的 BullMQ 自動化工作流引擎。
          </p>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 16, borderRadius: 12, fontSize: 12, overflowX: 'auto', lineHeight: 1.5 }}>
{`curl -X POST https://api.sendemail.ai/v1/emails/send \\
  -H "Authorization: Bearer se_live_..." \\
  -d '{"to":"vip@customer.com","verify_before_send":true,"subject":"Order Confirmed"}'`}
          </pre>
        </div>

        <div style={{ background: '#fff', padding: 28, borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(15,23,42,.06)' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{mode === 'login' ? 'Sign in to Console' : 'Create Free Workspace'}</h2>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>Includes 1,000 free monthly emails &amp; 500 verify credits</p>
          <form onSubmit={submit}>
            {mode === 'register' && <><input style={inp} placeholder="Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} required /><input style={inp} placeholder="Beta Invite Code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required /></>}
            <input style={inp} type="email" placeholder="Work Email" value={email} onChange={(e) => setEmail(e.target.value)} required={mode !== 'reset'} style={{ ...inp, display: mode === 'reset' ? 'none' : 'block' }} />{mode === 'reset' && <input style={inp} placeholder="Reset Token" value={tok} onChange={(e) => setTok(e.target.value)} required />}
            <input style={inp} type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required={mode !== 'forgot'} style={{ ...inp, display: mode === 'forgot' ? 'none' : 'block' }} />{mode === 'login' && <div style={{ textAlign: 'right', marginBottom: 8 }}><button type='button' onClick={() => setMode('forgot')} style={{ background: 'none', border: 0, color: '#64748b', fontSize: 12, cursor: 'pointer' }}>Forgot password?</button></div>}{info && <div style={{ color: '#16a34a', fontSize: 13, marginBottom: 8 }}>{info}</div>}
            {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <button disabled={busy} style={{ width: '100%', padding: 11, borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
              {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Free Workspace' : mode === 'forgot' ? 'Send Reset Link' : 'Update Password'}
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <button type="button" disabled={busy} onClick={() => ssoLogin('google')} style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Google SSO
            </button>
            <button type="button" disabled={busy} onClick={() => ssoLogin('global_sso')} style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Unified Portal SSO
            </button>
          </div>

          <div style={{ textAlign: 'center', fontSize: 13 }}>
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }} style={{ background: 'none', border: 0, color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
              {mode === 'login' ? 'Need an account? Sign up free' : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>

      <section id="features" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 48 }}>
        {[
          ['Pre-Send Verification', '發信前自動過濾無效、拋棄式與高風險信箱，從源頭鎖住網域信譽。'],
          ['4-Layer Circuit Breaker', 'VERP DSN / Gmail API / ISP FBL 雙源歸因，硬退信 >5% 或投訴 >0.1% 毫秒級自動熔斷。'],
          ['DAG + Goal Cancellation', '收到 orders/paid 目標事件立即取消佇列中後續催單信，支援 Time-Travel 毫秒級快轉。']
        ].map(([t, d]) => (
          <div key={t} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{t}</div>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{d}</div>
          </div>
        ))}
      </section>

      <section id="pricing" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Transparent Multi-Currency Pricing (Airwallex)</h2>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontWeight: 600 }}>
            <option value="USD">USD ($)</option>
            <option value="HKD">HKD (HK$)</option>
            <option value="TWD">TWD (NT$)</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {PLANS.map((p) => (
            <div key={p.code} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 26, fontWeight: 800, margin: '8px 0' }}>{currency === 'HKD' ? p.hkd : currency === 'TWD' ? p.twd : p.usd}<span style={{ fontSize: 12, fontWeight: 400 }}>/mo</span></div>
              <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 600 }}>{p.quota}</div>
              <div style={{ fontSize: 12, color: '#2563eb', marginBottom: 8 }}>{p.credits}</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
