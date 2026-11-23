'use client';
import { useState } from 'react';
export default function ProfileTab({ user, tenant, onRefresh }) {
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setMsg(''); setErr('');
    if (nw && nw !== cf) return setErr('Passwords do not match');
    setBusy(true);
    const r = await fetch('/api/v1/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: fullName, current_password: cur, new_password: nw }) });
    const d = await r.json(); setBusy(false);
    if (!r.ok) return setErr(d.error || 'Failed');
    setMsg('Saved successfully'); setCur(''); setNw(''); setCf(''); if (onRefresh) onRefresh();
  }
  const inp = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 12, boxSizing: 'border-box' };
  return (<div style={{ background: '#fff', padding: 22, borderRadius: 12, maxWidth: 520 }}><h3 style={{ marginTop: 0 }}>Profile &amp; Password ({user?.email})</h3><form onSubmit={save}><input style={inp} placeholder='Full Name' value={fullName} onChange={e => setFullName(e.target.value)} /><input style={inp} type='password' placeholder='Current Password (required to change password)' value={cur} onChange={e => setCur(e.target.value)} /><input style={inp} type='password' placeholder='New Password (min 8 chars)' value={nw} onChange={e => setNw(e.target.value)} /><input style={inp} type='password' placeholder='Confirm New Password' value={cf} onChange={e => setCf(e.target.value)} />{err && <div style={{ color: '#dc2626', marginBottom: 8 }}>{err}</div>}{msg && <div style={{ color: '#16a34a', marginBottom: 8 }}>{msg}</div>}<button disabled={busy} style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Saving...' : 'Save Changes'}</button></form></div>);
}
