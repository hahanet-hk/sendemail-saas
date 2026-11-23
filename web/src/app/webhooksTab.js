'use client';
import { useState, useEffect } from 'react';
import SdkExamples from './sdkExamples';

export default function WebhooksTab() {
  const [endpoints, setEndpoints] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [url, setUrl] = useState('');
  const [eventFilter, setEventFilter] = useState('*');
  const [newSecret, setNewSecret] = useState('');
  const [simEmail, setSimEmail] = useState('');
  const [simType, setSimType] = useState('hard_bounce');
  const [simMsg, setSimMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [r1, r2] = await Promise.all([fetch('/api/v1/webhooks'), fetch('/api/v1/webhooks/deliveries')]);
    if (r1.ok) setEndpoints((await r1.json()).webhooks || []);
    if (r2.ok) setDeliveries((await r2.json()).deliveries || []);
  };
  useEffect(() => { load(); }, []);

  async function addEndpoint(e) {
    e.preventDefault(); if (!url.trim()) return; setBusy(true); setNewSecret('');
    const evs = eventFilter === 'bundle' ? ['hard_bounce', 'complained', 'unsubscribed'] : ['*'];
    const r = await fetch('/api/v1/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, events: evs }) });
    const d = await r.json(); setBusy(false);
    if (r.ok) { setNewSecret(d.signing_secret); setUrl(''); load(); }
  }
  async function testEndpoint(id) { setBusy(true); await fetch('/api/v1/webhooks/' + id + '/test', { method: 'POST' }); setBusy(false); load(); }
  async function removeEndpoint(id) { await fetch('/api/v1/webhooks/' + id, { method: 'DELETE' }); load(); }
  async function simulateIngest(e) {
    e.preventDefault(); if (!simEmail.trim()) return; setBusy(true); setSimMsg('');
    const r = await fetch('/api/v1/webhooks/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: simType, email: simEmail, reason: 'Console simulation' }) });
    const d = await r.json(); setBusy(false);
    if (r.ok) { setSimMsg(`Event \${d.event_type} processed for \${d.email} (Auto-Suppressed: \${d.auto_suppressed ? 'YES' : 'NO'})`); setSimEmail(''); load(); }
  }
  const card = { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginBottom: 18 };
  const inp = { padding: 9, borderRadius: 8, border: '1px solid #cbd5e1' };
  return (
    <div>
      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Webhook Endpoints</h2>
        <form onSubmit={addEndpoint} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input placeholder="https://your-app.com/webhooks/sendemail" value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...inp, flex: 1 }} />
          <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} style={inp}><option value="*">All Events (*)</option><option value="bundle">Bounce / Complaint / Unsub</option></select>
          <button disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Add Endpoint</button>
        </form>
        {newSecret && <div style={{ background: '#fefce8', border: '1px solid #fde047', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}><strong>Signing Secret (HMAC-SHA256):</strong> <code style={{ userSelect: 'all', display: 'block', marginTop: 4, fontWeight: 700 }}>{newSecret}</code></div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}><th style={{ padding: 8 }}>URL</th><th>Secret</th><th>Events</th><th></th></tr></thead>
          <tbody>{endpoints.map((ep) => (<tr key={ep.id} style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: 8, fontWeight: 500 }}>{ep.url}</td><td><code>{ep.signing_secret?.slice(0, 12)}...</code></td><td>{Array.isArray(ep.events) ? ep.events.join(', ') : ep.events}</td><td style={{ textAlign: 'right' }}><button onClick={() => testEndpoint(ep.id)} style={{ marginRight: 10, color: '#2563eb', background: 'none', border: 0, cursor: 'pointer' }}>Test Ping</button><button onClick={() => removeEndpoint(ep.id)} style={{ color: '#dc2626', background: 'none', border: 0, cursor: 'pointer' }}>Delete</button></td></tr>))}</tbody>
        </table>
      </div>
      <div style={card}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Simulate Bounce / Event Ingest (Auto-Suppression)</h3>
        <form onSubmit={simulateIngest} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input placeholder="bounced@example.com" value={simEmail} onChange={(e) => setSimEmail(e.target.value)} style={{ ...inp, flex: 1 }} />
          <select value={simType} onChange={(e) => setSimType(e.target.value)} style={inp}><option value="hard_bounce">hard_bounce (Auto-Suppress)</option><option value="complained">complained (Auto-Suppress)</option><option value="unsubscribed">unsubscribed (Auto-Suppress)</option><option value="delivered">delivered</option></select>
          <button disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Trigger Event</button>
        </form>
        {simMsg && <div style={{ fontSize: 13, color: '#15803d', marginBottom: 10 }}>{simMsg}</div>}
        <h3 style={{ marginTop: 18, fontSize: 16 }}>Recent Webhook Deliveries</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}><th style={{ padding: 6 }}>Event</th><th>Recipient</th><th>Status</th><th>Target URL</th></tr></thead>
          <tbody>{deliveries.map((d) => (<tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: 6, fontWeight: 600 }}>{d.event_type}</td><td>{d.recipient_email || '-'}</td><td>{d.response_status || 'ERR'}</td><td>{d.url || '-'}</td></tr>))}</tbody>
        </table>
      </div>
      <SdkExamples defaultScenario="webhook" />
    </div>
  );
}
