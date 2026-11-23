'use client';
import { useState, useEffect } from 'react';

export default function DomainsTab() {
  const [domains, setDomains] = useState([]);
  const [channels, setChannels] = useState([]);
  const [dom, setDom] = useState('');
  const [purpose, setPurpose] = useState('transactional');
  const [verifyingId, setVerifyingId] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [ch, setCh] = useState({ channel_name: '', provider_type: 'platform_transactional', from_email: '', from_name: '', weight: '100', host: '', port: '587', user: '', pass: '', refresh_token: '' });

  const load = async () => {
    const [d, c] = await Promise.all([fetch('/api/v1/domains'), fetch('/api/v1/channels')]);
    if (d.ok) setDomains((await d.json()).domains || []);
    if (c.ok) setChannels((await c.json()).channels || []);
  };
  useEffect(() => { load(); }, []);

  const addDom = async (e) => { e.preventDefault(); if (!dom.trim()) return; await fetch('/api/v1/domains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: dom.trim(), purpose }) }); setDom(''); load(); };
  const verifyDom = async (id) => { setVerifyingId(id); try { await fetch(`/api/v1/domains/${id}/verify`, { method: 'POST' }); } finally { setVerifyingId(null); load(); } };
  const deleteDom = async (id) => { await fetch(`/api/v1/domains/${id}`, { method: 'DELETE' }); load(); };
  const copyText = (k, t) => { navigator.clipboard.writeText(t); setCopiedKey(k); setTimeout(() => setCopiedKey(''), 1500); };
  const addCh = async (e) => {
    e.preventDefault();
    if (!ch.channel_name || !ch.from_email) return;
    const credentials = ch.provider_type === 'byo_smtp' ? { host: ch.host, port: ch.port, user: ch.user, pass: ch.pass } : ch.provider_type === 'byo_google_oauth' ? { refresh_token: ch.refresh_token } : null;
    await fetch('/api/v1/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_name: ch.channel_name, provider_type: ch.provider_type, from_email: ch.from_email, from_name: ch.from_name, weight: Number(ch.weight) || 100, is_default: channels.length === 0, credentials }) });
    setCh({ channel_name: '', provider_type: 'platform_transactional', from_email: '', from_name: '', weight: '100', host: '', port: '587', user: '', pass: '', refresh_token: '' });
    load();
  };
  const resetCh = async (id) => { await fetch(`/api/v1/channels/${id}/reset-circuit`, { method: 'POST' }); load(); };
  const delCh = async (id) => { await fetch(`/api/v1/channels/${id}`, { method: 'DELETE' }); load(); };
  const box = { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginBottom: 18 };
  const inp = { padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 };
  const badge = (ok) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: ok ? '#dcfce7' : '#fef3c7', color: ok ? '#166534' : '#92400e' });

  return (
    <div>
      <div style={box}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#0f172a' }}>Sending Domains & 4-Level DNS</h2>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Isolate transactional (tx.) and marketing (mail.) subdomains, or share a read-only DNS link with IT.</div>
        <form onSubmit={addDom} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input placeholder="tx.yourdomain.com or mail.yourdomain.com" value={dom} onChange={(e) => setDom(e.target.value)} style={{ ...inp, flex: 1 }} />
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inp}><option value="transactional">Transactional (tx.)</option><option value="campaign">Marketing (mail.)</option><option value="general">General</option></select>
          <button style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Add Domain</button>
        </form>
        {domains.map((d) => {
          const recs = d.records || {}, shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/dns-share/${d.share_token}` : `/dns-share/${d.share_token}`;
          const rows = [{ k: 'spf', l: 'SPF', i: recs.spf }, { k: 'dkim', l: 'DKIM', i: recs.dkim }, { k: 'dmarc', l: 'DMARC', i: recs.dmarc }, { k: 'verp', l: 'VERP', i: recs.verp }].filter((x) => x.i);
          return (
            <div key={d.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div><strong>{d.domain}</strong> <span style={{ fontSize: 11.5, color: '#64748b' }}>({d.purpose})</span> <span style={badge(d.status === 'verified')}>{d.status}</span></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => copyText(`sh-${d.id}`, shareUrl)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 12, cursor: 'pointer' }}>{copiedKey === `sh-${d.id}` ? 'IT Link Copied!' : 'Copy IT Share Link'}</button>
                  <button type="button" disabled={verifyingId === d.id} onClick={() => verifyDom(d.id)} style={{ padding: '5px 12px', borderRadius: 7, border: 0, background: '#0f172a', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{verifyingId === d.id ? 'Checking...' : 'Verify DNS'}</button>
                  <button type="button" onClick={() => deleteDom(d.id)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
              {recs.hints?.isolation_advice && <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>{recs.hints.isolation_advice}</div>}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}><th style={{ padding: 6 }}>Record</th><th style={{ padding: 6 }}>Type</th><th style={{ padding: 6 }}>Host</th><th style={{ padding: 6 }}>Value</th><th style={{ padding: 6, textAlign: 'right' }}>Status</th></tr></thead>
                <tbody>{rows.map(({ k, l, i }) => (<tr key={k} style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: 6, fontWeight: 700 }}>{l}</td><td style={{ padding: 6 }}>{i.type}</td><td style={{ padding: 6 }}><code>{i.host}</code> <button type="button" onClick={() => copyText(`${d.id}${k}h`, i.host)} style={{ fontSize: 11, color: '#2563eb', border: 0, background: 'none', cursor: 'pointer' }}>{copiedKey === `${d.id}${k}h` ? 'Copied' : 'Copy'}</button></td><td style={{ padding: 6, wordBreak: 'break-all' }}><code>{i.value}</code> <button type="button" onClick={() => copyText(`${d.id}${k}v`, i.value)} style={{ fontSize: 11, color: '#2563eb', border: 0, background: 'none', cursor: 'pointer' }}>{copiedKey === `${d.id}${k}v` ? 'Copied' : 'Copy'}</button></td><td style={{ padding: 6, textAlign: 'right' }}><span style={badge(i.verified)}>{i.verified ? 'Verified' : 'Pending'}</span></td></tr>))}</tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div style={box}>
        <h2 style={{ marginTop: 0, fontSize: 18, color: '#0f172a' }}>Multi-Channel Sending Router</h2>
        <form onSubmit={addCh} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
          <input placeholder="Channel Label" value={ch.channel_name} onChange={(e) => setCh({ ...ch, channel_name: e.target.value })} style={inp} />
          <select value={ch.provider_type} onChange={(e) => setCh({ ...ch, provider_type: e.target.value })} style={inp}>
            <option value="platform_transactional">Platform Transactional</option>
            <option value="platform_marketing">Platform Marketing</option>
            <option value="byo_google_oauth">BYO Google OAuth</option>
            <option value="byo_smtp">BYO Custom SMTP</option>
          </select>
          <input placeholder="From Email" value={ch.from_email} onChange={(e) => setCh({ ...ch, from_email: e.target.value })} style={inp} />
          <input placeholder="From Name" value={ch.from_name} onChange={(e) => setCh({ ...ch, from_name: e.target.value })} style={inp} />
          <input placeholder="Weight (100)" value={ch.weight} onChange={(e) => setCh({ ...ch, weight: e.target.value })} style={inp} />
          {ch.provider_type === 'byo_smtp' && <><input placeholder="SMTP Host" value={ch.host} onChange={(e) => setCh({ ...ch, host: e.target.value })} style={inp} /><input placeholder="Port (587)" value={ch.port} onChange={(e) => setCh({ ...ch, port: e.target.value })} style={inp} /><input placeholder="SMTP User" value={ch.user} onChange={(e) => setCh({ ...ch, user: e.target.value })} style={inp} /><input type="password" placeholder="SMTP Pass" value={ch.pass} onChange={(e) => setCh({ ...ch, pass: e.target.value })} style={inp} /></>}
          {ch.provider_type === 'byo_google_oauth' && <input placeholder="OAuth Refresh Token" value={ch.refresh_token} onChange={(e) => setCh({ ...ch, refresh_token: e.target.value })} style={inp} />}
          <button style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Add Channel</button>
        </form>
        {channels.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div><strong>{c.channel_name}</strong> · <code>{c.provider_type}</code> · {c.from_email} · Weight: {c.weight} {c.daily_limit ? `· Transitional (${c.daily_sent}/${c.daily_limit}/day)` : ''} <span style={badge(c.status === 'active')}>{c.status}</span></div>
            <div style={{ display: 'flex', gap: 6 }}>{c.status === 'error' && <button type="button" onClick={() => resetCh(c.id)} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Reset Circuit</button>}<button type="button" onClick={() => delCh(c.id)} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', cursor: 'pointer' }}>Remove</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
