'use client';
import { useState, useEffect } from 'react';
import SdkExamples from './sdkExamples';

export default function KeysTab() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [env, setEnv] = useState('live');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => { const r = await fetch('/api/v1/api-keys'); if (r.ok) setKeys((await r.json()).keys || []); };
  useEffect(() => { load(); }, []);

  async function createKey(e) {
    e.preventDefault(); if (!name.trim()) return; setBusy(true); setSecret('');
    const r = await fetch('/api/v1/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, environment: env }) });
    const d = await r.json(); setBusy(false);
    if (r.ok) { setSecret(d.secret_key); setName(''); load(); }
  }
  async function revoke(id) { await fetch('/api/v1/api-keys/' + id, { method: 'DELETE' }); load(); }
  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)' }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>API Keys</h2>
      <form onSubmit={createKey} style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input placeholder="Key name (e.g. Production Backend)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, padding: 9, borderRadius: 8, border: '1px solid #cbd5e1' }} />
        <select value={env} onChange={(e) => setEnv(e.target.value)} style={{ padding: 9, borderRadius: 8, border: '1px solid #cbd5e1' }}><option value="live">Live</option><option value="test">Test</option></select>
        <button disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Create Key</button>
      </form>
      {secret && <div style={{ background: '#fefce8', border: '1px solid #fde047', padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 13 }}><strong>Copy now (shown once):</strong> <code style={{ userSelect: 'all', display: 'block', marginTop: 6, fontWeight: 700 }}>{secret}</code></div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}><th style={{ padding: 8 }}>Name</th><th>Prefix</th><th>Env</th><th>Status</th><th></th></tr></thead>
        <tbody>{keys.map((k) => (<tr key={k.id} style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: 8, fontWeight: 500 }}>{k.name}</td><td><code>{k.key_prefix}...</code></td><td>{k.environment}</td><td>{k.revoked_at ? 'Revoked' : 'Active'}</td><td style={{ textAlign: 'right' }}>{!k.revoked_at && <button onClick={() => revoke(k.id)} style={{ color: '#dc2626', background: 'none', border: 0, cursor: 'pointer' }}>Revoke</button>}</td></tr>))}</tbody>
      </table>
      <SdkExamples apiKey={secret} defaultScenario="send" />
    </div>
  );
}
