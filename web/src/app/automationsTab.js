'use client';
import { useState, useEffect, useCallback } from 'react';

export default function AutomationsTab() {
  const [data, setData] = useState(null);
  const [tplSlug, setTplSlug] = useState('abandoned_checkout');
  const [delayMins, setDelayMins] = useState(60);
  const [simEmail, setSimEmail] = useState('');
  const [simEvent, setSimEvent] = useState('checkouts/create');
  const [simTt, setSimTt] = useState(true);
  const [expName, setExpName] = useState('');
  const [subA, setSubA] = useState('');
  const [subB, setSubB] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/automations');
    if (r.ok) setData(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createFromTpl(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/v1/automations/from-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: tplSlug, delay_minutes: Number(delayMins), activate: true })
      });
      if (r.ok) { setMsg('Automation workflow activated.'); await load(); }
    } finally { setBusy(false); }
  }

  async function trackEvent(e) {
    e.preventDefault();
    if (!simEmail.trim()) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/v1/events/track', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: simEvent, contact_email: simEmail.trim(), time_travel: simTt })
      });
      const j = await r.json();
      if (r.ok) {
        setMsg(`Event "${j.event_name}" processed: triggered ${j.triggered_runs?.length || 0} run(s), goal-cancelled ${j.cancelled_by_goal_count || 0} run(s).`);
        setTimeout(load, 2600);
        await load();
      }
    } finally { setBusy(false); }
  }

  async function createExp(e) {
    e.preventDefault();
    if (!expName.trim() || !subA.trim() || !subB.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/v1/experiments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: expName.trim(), variant_a: { subject: subA.trim() }, variant_b: { subject: subB.trim() } })
      });
      if (r.ok) { setExpName(''); setSubA(''); setSubB(''); await load(); }
    } finally { setBusy(false); }
  }

  async function evalExp(uid) {
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/experiments/${uid}/evaluate`, { method: 'POST' });
      if (r.ok) await load();
    } finally { setBusy(false); }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };

  return (
    <div>
      {msg && <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{msg}</div>}
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>1. Deploy Parameterized DAG Workflow Template</h3>
        <form onSubmit={createFromTpl} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={tplSlug} onChange={(e) => setTplSlug(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 2 }}>
            <option value="abandoned_checkout">Abandoned Checkout Recovery (Goal: orders/paid)</option>
            <option value="welcome_series">New Customer Welcome Series (Open Branching)</option>
            <option value="winback_verify">Dormant Win-Back + Auto Pre-Verify (Stage 2)</option>
          </select>
          <input type="number" min="1" value={delayMins} onChange={(e) => setDelayMins(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', width: 110 }} title="Delay minutes" />
          <button disabled={busy} type="submit" style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Activate Flow</button>
        </form>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>2. Time-Travel Sandbox &amp; Goal Cancellation Simulator</h3>
        <form onSubmit={trackEvent} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={simEmail} onChange={(e) => setSimEmail(e.target.value)} placeholder="customer@example.com" required style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 2 }} />
          <select value={simEvent} onChange={(e) => setSimEvent(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}>
            <option value="checkouts/create">Trigger: checkouts/create</option>
            <option value="customers/create">Trigger: customers/create</option>
            <option value="customer/dormant">Trigger: customer/dormant</option>
            <option value="orders/paid">Goal Event: orders/paid (Cancel Pending)</option>
          </select>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={simTt} onChange={(e) => setSimTt(e.target.checked)} /> Time-Travel (Days → Seconds)
          </label>
          <button disabled={busy} type="submit" style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Fire Event</button>
        </form>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>3. DAG Execution Runs ({data?.runs?.length || 0})</h3>
          <button onClick={load} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
        </div>
        {data?.runs?.length ? data.runs.map((r) => (
          <div key={r.flow_run_id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <strong>{r.contact_email}</strong> · {r.flow_name} {r.is_time_travel ? '[Time-Travel]' : ''} — <strong style={{ color: r.status === 'cancelled_by_goal' ? '#d97706' : r.status === 'completed' ? '#16a34a' : '#2563eb' }}>{r.status}</strong>
          </div>
        )) : <p style={{ fontSize: 13, color: '#64748b' }}>No workflow runs yet.</p>}
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>4. Native A/B Testing &amp; Auto-Winner Selection</h3>
        <form onSubmit={createExp} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input value={expName} onChange={(e) => setExpName(e.target.value)} placeholder="Experiment Name" required style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 1 }} />
          <input value={subA} onChange={(e) => setSubA(e.target.value)} placeholder="Variant A Subject" required style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 1 }} />
          <input value={subB} onChange={(e) => setSubB(e.target.value)} placeholder="Variant B Subject" required style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', flex: 1 }} />
          <button disabled={busy} type="submit" style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0f172a', color: '#fff', cursor: 'pointer' }}>Launch A/B</button>
        </form>
        {data?.experiments?.map((ex) => (
          <div key={ex.exp_uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <div><strong>{ex.name}</strong> ({ex.test_ratio_pct}% test / {100 - ex.test_ratio_pct}% rollout) · Status: <strong>{ex.status}</strong> {ex.winner_variant ? `· Winner: Variant ${ex.winner_variant}` : ''}</div>
            {ex.status === 'running' && <button disabled={busy} onClick={() => evalExp(ex.exp_uid)} style={{ padding: '5px 10px', borderRadius: 6, border: 0, background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Evaluate &amp; Rollout Winner</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
