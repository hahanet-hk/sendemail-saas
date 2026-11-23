'use client';
import { useState, useEffect, use } from 'react';

export default function DnsSharePage({ params }) {
  const { token } = use(params);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState('');

  const load = async () => {
    const r = await fetch(`/api/v1/public/dns-share/${token}`);
    if (r.ok) setData(await r.json());
    else setErr((await r.json()).error || 'SHARE_LINK_NOT_FOUND');
  };
  useEffect(() => { load(); }, [token]);

  const verify = async () => {
    setChecking(true);
    try {
      const r = await fetch(`/api/v1/public/dns-share/${token}/verify`, { method: 'POST' });
      if (r.ok) setData(await r.json());
    } finally { setChecking(false); }
  };

  const copy = (k, v) => { navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 1500); };
  if (err) return <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'system-ui', textAlign: 'center', color: '#dc2626' }}>Invalid or expired DNS share link ({err}).</div>;
  if (!data) return <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'system-ui', textAlign: 'center', color: '#64748b' }}>Loading DNS instructions...</div>;

  const recs = data.records || {};
  const rows = [
    { k: 'spf', label: 'SPF (Required)', item: recs.spf },
    { k: 'dkim', label: 'DKIM 2048-bit (Required)', item: recs.dkim },
    { k: 'dmarc', label: 'DMARC (Recommended)', item: recs.dmarc },
    { k: 'verp', label: 'VERP Return-Path (Recommended)', item: recs.verp }
  ].filter((x) => x.item);

  return (
    <div style={{ maxWidth: 860, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 12px rgba(15,23,42,.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>SENDEMAIL.AI · IT DNS CONFIGURATION</div>
            <h1 style={{ margin: '4px 0', fontSize: 22, color: '#0f172a' }}>{data.domain}</h1>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>Purpose: {data.purpose} · Status: <strong>{data.status.toUpperCase()}</strong></span>
          </div>
          <button onClick={verify} disabled={checking} style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {checking ? 'Checking DNS...' : 'Verify DNS Now'}
          </button>
        </div>
        {recs.hints && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12.5, color: '#334155' }}>
            <div><strong>Cloudflare:</strong> {recs.hints.providers?.cloudflare?.tip}</div>
            <div style={{ marginTop: 4 }}><strong>GoDaddy / Namecheap:</strong> {recs.hints.providers?.godaddy?.tip}</div>
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
              <th style={{ padding: 8 }}>Record</th><th style={{ padding: 8 }}>Type</th><th style={{ padding: 8 }}>Host</th><th style={{ padding: 8 }}>Value</th><th style={{ padding: 8, textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ k, label, item }) => (
              <tr key={k} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                <td style={{ padding: 8, fontWeight: 700 }}>{label}</td>
                <td style={{ padding: 8 }}>{item.type}</td>
                <td style={{ padding: 8 }}><code>{item.host}</code> <button onClick={() => copy(k + 'h', item.host)} style={{ fontSize: 11, color: '#2563eb', border: 0, background: 'none', cursor: 'pointer' }}>{copied === k + 'h' ? 'Copied' : 'Copy'}</button></td>
                <td style={{ padding: 8, wordBreak: 'break-all' }}><code>{item.value}</code> <button onClick={() => copy(k + 'v', item.value)} style={{ fontSize: 11, color: '#2563eb', border: 0, background: 'none', cursor: 'pointer' }}>{copied === k + 'v' ? 'Copied' : 'Copy'}</button></td>
                <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: item.verified ? '#166534' : '#92400e' }}>{item.verified ? 'Verified' : 'Pending'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
