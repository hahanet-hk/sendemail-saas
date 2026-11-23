'use client';
import { useState, useEffect, useCallback } from 'react';

export default function OpsRiskTab() {
  const [data, setData] = useState(null);
  const [simEmail, setSimEmail] = useState('');
  const [simSource, setSimSource] = useState('verp_dsn');
  const [simType, setSimType] = useState('soft');
  const [simCode, setSimCode] = useState('4.2.2');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/bounces');
    if (r.ok) setData(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitBounce(e) {
    e.preventDefault();
    if (!simEmail.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/v1/bounces/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_email: simEmail.trim(), source: simSource, bounce_type: simType, smtp_code: simCode })
      });
      if (r.ok) { setSimEmail(''); await load(); }
    } finally { setBusy(false); }
  }

  async function resolveAlert(uid, action) {
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/ops/alerts/${uid}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (r.ok) await load();
    } finally { setBusy(false); }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
  const risk = data?.tenant_risk || {};
  const health = data?.health || {};
  const isFrozen = Boolean(risk.sending_frozen_at);

  return (
    <div>
      {isFrozen && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: 14, borderRadius: 10, marginBottom: 16 }}><strong>SENDING FROZEN：</strong>{risk.freeze_reason}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>Reputation</div><div style={{ fontSize: 22, fontWeight: 700 }}>{risk.reputation_score ?? 100}/100</div></div>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>24h Hard Bounce</div><div style={{ fontSize: 22, fontWeight: 700 }}>{health.hard_rate_pct ?? 0}%</div></div>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>24h Complaint</div><div style={{ fontSize: 22, fontWeight: 700 }}>{health.complaint_rate_pct ?? 0}%</div></div>
        <div style={card}><div style={{ fontSize: 12, color: '#64748b' }}>Circuit Status</div><div style={{ fontSize: 22, fontWeight: 700, color: isFrozen ? '#dc2626' : '#16a34a' }}>{isFrozen ? 'FROZEN' : 'ACTIVE'}</div></div>
      </div>
      {data?.alerts?.map((a) => (
        <div key={a.alert_uid} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><strong>[{a.severity.toUpperCase()}] {a.summary}</strong><div style={{ fontSize: 12, color: '#64748b' }}>Status: {a.resolution} · Channels: {a.notified_channels}</div></div>
          {a.resolution === 'pending' && <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={() => resolveAlert(a.alert_uid, 'released')} style={{ padding: '6px 12px', borderRadius: 6, border: 0, background: '#16a34a', color: '#fff', cursor: 'pointer' }}>Release</button>
            <button disabled={busy} onClick={() => resolveAlert(a.alert_uid, 'banned')} style={{ padding: '6px 12px', borderRadius: 6, border: 0, background: '#dc2626', color: '#fff', cursor: 'pointer' }}>Ban</button>
          </div>}
        </div>
      ))}
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Bounce &amp; FBL Simulator</h3>
        <form onSubmit={submitBounce} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={simEmail} onChange={(e) => setSimEmail(e.target.value)} placeholder="bounced@example.com" required style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 2 }} />
          <select value={simSource} onChange={(e) => setSimSource(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}><option value="verp_dsn">VERP DSN</option><option value="gmail_api">Gmail API</option><option value="isp_fbl">ISP FBL</option></select>
          <select value={simType} onChange={(e) => { setSimType(e.target.value); setSimCode(e.target.value === 'hard' ? '5.1.1' : e.target.value === 'complaint' ? 'ARF' : '4.2.2'); }} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}><option value="soft">Soft (72h Retry)</option><option value="hard">Hard (Suppress)</option><option value="complaint">Complaint (+Bayes)</option></select>
          <input value={simCode} onChange={(e) => setSimCode(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', width: 80 }} />
          <button disabled={busy} type="submit" style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0f172a', color: '#fff', cursor: 'pointer' }}>Ingest</button>
        </form>
      </div>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Bounce Attribution Log</h3>
        {data?.events?.length ? data.events.map((ev) => (
          <div key={ev.event_uid} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <strong>{ev.recipient_email}</strong> · {ev.source} · {ev.bounce_type} ({ev.smtp_code}) — {ev.suppressed ? 'Suppressed' : `Retry #${ev.retry_count}/3`}
          </div>
        )) : <p style={{ fontSize: 13, color: '#64748b' }}>No bounce events yet.</p>}
      </div>
    </div>
  );
}
