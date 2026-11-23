'use client';
import { useState, useEffect } from 'react';

export default function SandboxTab() {
  const [msgs, setMsgs] = useState([]);
  const [sups, setSups] = useState([]);
  const [email, setEmail] = useState('');
  const [busyUid, setBusyUid] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const [m, s] = await Promise.all([fetch('/api/v1/sandbox'), fetch('/api/v1/suppressions')]);
    if (m.ok) setMsgs((await m.json()).messages || []);
    if (s.ok) setSups((await s.json()).suppressions || []);
  };
  useEffect(() => { load(); }, []);

  const clearBox = async () => { await fetch('/api/v1/sandbox', { method: 'DELETE' }); load(); };
  const rescanMsg = async (uid) => {
    setBusyUid(uid);
    try { await fetch(`/api/v1/sandbox/${uid}/rescan`, { method: 'POST' }); await load(); } finally { setBusyUid(''); }
  };
  const learnMsg = async (m, type) => {
    setBusyUid(m.message_uid);
    try {
      const r = await fetch('/api/v1/tools/spam-learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, from_email: m.from_email, to_email: m.to_email, subject: m.subject, html: m.html_body, text: m.text_body }) });
      if (r.ok) { setNotice(`Trained Rspamd Bayes as ${type.toUpperCase()} for "${m.subject}"`); setTimeout(() => setNotice(''), 3000); }
    } finally { setBusyUid(''); }
  };
  const addSup = async (e) => {
    e.preventDefault(); if (!email.includes('@')) return;
    await fetch('/api/v1/suppressions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, reason: 'manual' }) });
    setEmail(''); load();
  };
  const delSup = async (id) => { await fetch(`/api/v1/suppressions/${id}`, { method: 'DELETE' }); load(); };
  const box = { background: '#fff', padding: 20, borderRadius: 12, marginBottom: 16 };
  const scoreBadge = (s) => ({ padding: '2px 8px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, background: s >= 6 ? '#fee2e2' : s >= 3 ? '#fef3c7' : '#dcfce7', color: s >= 6 ? '#991b1b' : s >= 3 ? '#92400e' : '#166534' });

  return (<div>
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Sandbox Virtual Inbox & Rspamd Inspector ({msgs.length})</h2>
        <button onClick={clearBox} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Clear All</button>
      </div>
      {notice && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', fontSize: 12.5, marginBottom: 10 }}>{notice}</div>}
      {msgs.map(m => {
        let rep = null;
        try { rep = typeof m.spam_report === 'string' ? JSON.parse(m.spam_report) : m.spam_report; } catch {}
        const score = Number(m.spam_score || rep?.score || 0);
        return (<div key={m.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div><strong>{m.subject}</strong> — To: {m.to_email} <span style={{ color: '#64748b' }}>({m.from_email})</span> <span style={scoreBadge(score)}>Rspamd: {score.toFixed(2)}</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" disabled={busyUid === m.message_uid} onClick={() => rescanMsg(m.message_uid)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 11.5, cursor: 'pointer' }}>Rescan</button>
              <button type="button" disabled={busyUid === m.message_uid} onClick={() => learnMsg(m, 'spam')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 11.5, cursor: 'pointer' }}>Train Spam</button>
              <button type="button" disabled={busyUid === m.message_uid} onClick={() => learnMsg(m, 'ham')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#fff', color: '#15803d', fontSize: 11.5, cursor: 'pointer' }}>Train Ham</button>
            </div>
          </div>
          <div style={{ color: '#475569', marginTop: 4, fontSize: 12 }}>{m.text_body || '(HTML content)'}</div>
          {rep?.symbols?.length > 0 && <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>{rep.symbols.filter(s => s.score !== 0).slice(0, 6).map(s => <span key={s.name} title={s.description} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: s.score > 0 ? '#fef2f2' : '#f0fdf4', color: s.score > 0 ? '#991b1b' : '#166534', border: '1px solid #e2e8f0' }}>{s.name} ({s.score > 0 ? '+' : ''}{s.score})</span>)}</div>}
        </div>);
      })}
    </div>
    <div style={box}><h2 style={{ marginTop: 0, fontSize: 18 }}>Suppression List ({sups.length})</h2>
      <form onSubmit={addSup} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input placeholder="bounce@example.com" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }} />
        <button style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#dc2626', color: '#fff' }}>Suppress</button>
      </form>
      {sups.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><span>{s.email} ({s.reason})</span><button onClick={() => delSup(s.id)} style={{ color: '#2563eb', background: 'none', border: 0, cursor: 'pointer' }}>Remove</button></div>)}
    </div>
  </div>);
}
