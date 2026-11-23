'use client';
import { useState, useEffect, useCallback } from 'react';

export default function ToolsTab({ onRefresh }) {
  const [rawEmails, setRawEmails] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [submittingVerify, setSubmittingVerify] = useState(false);
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchDetails, setBatchDetails] = useState([]);
  const [syncingUid, setSyncingUid] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);

  const [to, setTo] = useState('');
  const [sub, setSub] = useState('');
  const [html, setHtml] = useState('<p>Hello from SendEmail.ai!</p>');
  const [sRes, setSRes] = useState(null);
  const [spamRes, setSpamRes] = useState(null);
  const [pfFrom, setPfFrom] = useState("");
  const [pfMode, setPfMode] = useState("campaign");
  const [pfRes, setPfRes] = useState(null);
  const [pfBusy, setPfBusy] = useState(false);
  async function runPreflight(e) {
    e.preventDefault();
    setPfBusy(true);
    try {
      const r = await fetch("/api/v1/tools/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_email: pfFrom, mode: pfMode, to_email: to, subject: sub, html }) });
      if (r.ok) setPfRes(await r.json());
    } finally { setPfBusy(false); }
  }

  const [spamBusy, setSpamBusy] = useState(false);
  const [learnMsg, setLearnMsg] = useState("");
  async function runSpamCheck(e) {
    e.preventDefault();
    setSpamBusy(true); setLearnMsg("");
    try {
      const r = await fetch("/api/v1/tools/spam-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to_email: to, subject: sub, html }) });
      if (r.ok) setSpamRes(await r.json());
    } finally { setSpamBusy(false); }
  }
  async function runSpamLearn(type) {
    setSpamBusy(true);
    try {
      const r = await fetch("/api/v1/tools/spam-learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, to_email: to, subject: sub, html }) });
      if (r.ok) setLearnMsg("Bayes model updated (" + type.toUpperCase() + ")");
    } finally { setSpamBusy(false); }
  }


  const loadBatches = useCallback(async () => {
    const r = await fetch('/api/v1/verify/batches');
    if (r.ok) {
      const data = await r.json();
      setBatches(data.batches || []);
    }
  }, []);

  const loadBatchDetail = useCallback(async (uid) => {
    if (!uid) return;
    const r = await fetch(`/api/v1/verify/batches/${uid}`);
    if (r.ok) {
      const data = await r.json();
      setSelectedBatch(data.batch);
      setBatchDetails(data.results || []);
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    const hasActive = batches.some((b) => b.status === 'queued' || b.status === 'processing') ||
      (selectedBatch && (selectedBatch.status === 'queued' || selectedBatch.status === 'processing'));
    if (!hasActive) return;

    const timer = setInterval(() => {
      loadBatches();
      if (selectedBatch?.batch_uid) loadBatchDetail(selectedBatch.batch_uid);
      onRefresh?.();
    }, 1500);
    return () => clearInterval(timer);
  }, [batches, selectedBatch, loadBatches, loadBatchDetail, onRefresh]);

  async function runVerify(e) {
    e.preventDefault();
    const list = rawEmails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setSubmittingVerify(true);
    try {
      const r = await fetch('/api/v1/verify/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: list, source_name: sourceName.trim() || undefined })
      });
      if (r.ok) {
        const created = await r.json();
        setRawEmails('');
        setSourceName('');
        await loadBatches();
        await loadBatchDetail(created.batch_uid);
        onRefresh?.();
      }
    } finally {
      setSubmittingVerify(false);
    }
  }

  async function syncBlockedToSuppressions(batch) {
    setSyncingUid(batch.batch_uid);
    setSyncNotice(null);
    try {
      const r = await fetch(`/api/v1/verify/batches/${batch.batch_uid}/sync-suppressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_review: false })
      });
      const data = await r.json();
      if (r.ok) {
        setSyncNotice({
          type: 'ok',
          text: `Synced "${batch.source_name || batch.batch_uid.slice(0, 8)}" to Suppressions: ${data.inserted_count} newly added, ${data.already_suppressed_count} already suppressed.`
        });
        onRefresh?.();
      } else {
        setSyncNotice({ type: 'err', text: data.message || data.error || 'Failed to sync suppressions' });
      }
    } catch (err) {
      setSyncNotice({ type: 'err', text: String(err.message || err) });
    } finally {
      setSyncingUid(null);
    }
  }

  async function runSend(e) {
    e.preventDefault();
    const r = await fetch('/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: sub, html })
    });
    setSRes(await r.json());
    onRefresh?.();
  }

  const card = { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginBottom: 16 };
  const inp = { width: '100%', padding: 9, borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 10, fontSize: 13 };
  const verdictBadge = (v) => {
    const map = {
      allow: { bg: '#dcfce7', fg: '#166534', label: 'Allow' },
      review: { bg: '#fef3c7', fg: '#92400e', label: 'Review' },
      block: { bg: '#fee2e2', fg: '#991b1b', label: 'Block' },
      error: { bg: '#f1f5f9', fg: '#475569', label: 'Error' },
      pending: { bg: '#e0f2fe', fg: '#075985', label: 'Checking...' }
    };
    const st = map[v] || map.pending;
    return <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg }}>{st.label}</span>;
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 16 }}>
        <form onSubmit={runVerify} style={card}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Bulk Email List Verifier</h3>
          <p style={{ marginTop: 0, fontSize: 12.5, color: '#64748b' }}>
            Verify syntax, MX records, disposable domains, and SMTP risk scores in parallel.
          </p>
          <input
            style={inp}
            placeholder="Batch label (optional, e.g. Q4 Newsletter Leads)"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
          />
          <textarea
            rows={4}
            style={inp}
            placeholder="Paste emails (one per line or comma separated, up to 5,000)"
            value={rawEmails}
            onChange={(e) => setRawEmails(e.target.value)}
          />
          <button
            disabled={submittingVerify}
            style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            {submittingVerify ? 'Queueing Batch...' : 'Start Batch Verification'}
          </button>
        </form>

        <form onSubmit={runSend} style={card}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Dispatch Test Email</h3>
          <p style={{ marginTop: 0, fontSize: 12.5, color: '#64748b' }}>
            Send a live email through your default SMTP channel with automatic suppression filtering.
          </p>
          <input style={inp} placeholder="To (comma separated)" value={to} onChange={(e) => setTo(e.target.value)} required />
          <input style={inp} placeholder="Subject" value={sub} onChange={(e) => setSub(e.target.value)} required />
          <textarea rows={3} style={inp} value={html} onChange={(e) => setHtml(e.target.value)} />
          <button style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Send Now</button>
          {sRes && <pre style={{ background: '#f8fafc', padding: 10, borderRadius: 8, fontSize: 12, marginTop: 10, overflowX: 'auto' }}>{JSON.stringify(sRes, null, 2)}</pre>}
        </form>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Verification Batches & CSV Export</h3>
          <button type="button" onClick={loadBatches} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Refresh</button>
        </div>

        {syncNotice && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: syncNotice.type === 'ok' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${syncNotice.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
            color: syncNotice.type === 'ok' ? '#166534' : '#991b1b'
          }}>
            <span>{syncNotice.text}</span>
            <button type="button" onClick={() => setSyncNotice(null)} style={{ background: 'none', border: 0, cursor: 'pointer', fontWeight: 700, color: 'inherit' }}>✕</button>
          </div>
        )}

        {!batches.length ? (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>No verification batches yet. Paste a list above to start.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 12 }}>
                  <th style={{ padding: '8px' }}>Batch Name</th>
                  <th style={{ padding: '8px' }}>Progress</th>
                  <th style={{ padding: '8px' }}>Breakdown</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Actions & Export</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const pct = b.total_count > 0 ? Math.round((b.processed_count / b.total_count) * 100) : 0;
                  const isSel = selectedBatch?.batch_uid === b.batch_uid;
                  const hasBlocked = Number(b.blocked_count || 0) > 0;
                  const isSyncing = syncingUid === b.batch_uid;
                  return (
                    <tr key={b.batch_uid} style={{ borderBottom: '1px solid #f1f5f9', background: isSel ? '#f8fafc' : 'transparent' }}>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{b.source_name || b.batch_uid.slice(0, 8)}</div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{new Date(b.created_at).toLocaleString()}</div>
                      </td>
                      <td style={{ padding: '10px 8px', width: 190 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{b.status}</span>
                          <span>{b.processed_count}/{b.total_count} ({pct}%)</span>
                        </div>
                        <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: b.status === 'completed' ? '#16a34a' : '#2563eb', transition: 'width .3s' }} />
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 12 }}>
                        <span style={{ color: '#166534', fontWeight: 600, marginRight: 10 }}>Allow: {b.safe_count}</span>
                        <span style={{ color: '#92400e', fontWeight: 600, marginRight: 10 }}>Review: {b.review_count}</span>
                        <span style={{ color: '#991b1b', fontWeight: 600 }}>Block: {b.blocked_count}</span>
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => loadBatchDetail(b.batch_uid)}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, cursor: 'pointer', marginRight: 6 }}
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          disabled={!hasBlocked || isSyncing}
                          onClick={() => syncBlockedToSuppressions(b)}
                          title={hasBlocked ? 'Add all Block emails from this batch to global suppressions' : 'No blocked emails in this batch'}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 6,
                            border: 0,
                            background: hasBlocked ? '#dc2626' : '#e2e8f0',
                            color: hasBlocked ? '#fff' : '#94a3b8',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: hasBlocked && !isSyncing ? 'pointer' : 'not-allowed',
                            marginRight: 6
                          }}
                        >
                          {isSyncing ? 'Syncing...' : `Sync Blocked (${b.blocked_count || 0})`}
                        </button>
                        <a
                          href={`/api/v1/verify/batches/${b.batch_uid}/export.csv`}
                          style={{ display: 'inline-block', padding: '5px 10px', borderRadius: 6, background: '#0f172a', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 600, marginRight: 6 }}
                        >
                          CSV (All)
                        </a>
                        <a
                          href={`/api/v1/verify/batches/${b.batch_uid}/export.csv?verdict=allow`}
                          style={{ display: 'inline-block', padding: '5px 10px', borderRadius: 6, background: '#16a34a', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                        >
                          CSV (Safe)
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedBatch && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13.5 }}>Preview: {selectedBatch.source_name} (showing up to 200 rows)</strong>
              <button type="button" onClick={() => setSelectedBatch(null)} style={{ fontSize: 12, color: '#64748b', background: 'none', border: 0, cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '6px 10px' }}>Email</th>
                    <th style={{ padding: '6px 10px' }}>Verdict</th>
                    <th style={{ padding: '6px 10px' }}>Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {batchDetails.map((row, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{row.email}</td>
                      <td style={{ padding: '6px 10px' }}>{verdictBadge(row.verdict)}</td>
                      <td style={{ padding: '6px 10px', color: '#475569' }}>{row.risk_score ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rspamd Spam Score Inspector & Bayes Trainer</h2>
        <form onSubmit={runSpamCheck} style={{ display: "grid", gap: 8 }}>
          <input placeholder="Subject to inspect" value={sub} onChange={e => setSub(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }} />
          <textarea rows={3} placeholder="HTML or text body" value={html} onChange={e => setHtml(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", fontFamily: "monospace", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={spamBusy} style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "#0f172a", color: "#fff", cursor: "pointer" }}>{spamBusy ? "Checking..." : "Run Rspamd Check"}</button>
            <button type="button" disabled={spamBusy} onClick={() => runSpamLearn("spam")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", cursor: "pointer" }}>Learn as Spam</button>
            <button type="button" disabled={spamBusy} onClick={() => runSpamLearn("ham")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #bbf7d0", background: "#fff", color: "#15803d", cursor: "pointer" }}>Learn as Ham</button>
          </div>
        </form>
        {learnMsg && <div style={{ marginTop: 8, color: "#15803d", fontSize: 12.5 }}>{learnMsg}</div>}
        {spamRes && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 13 }}>
            <div><strong>Score:</strong> {spamRes.score} / {spamRes.required_score} — <strong>Verdict:</strong> {String(spamRes.verdict || "").toUpperCase()} ({spamRes.action})</div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(spamRes.symbols || []).filter(x => x.score !== 0).map(x => (
                <span key={x.name} title={x.description} style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 6, background: x.score > 0 ? "#fee2e2" : "#dcfce7", color: x.score > 0 ? "#991b1b" : "#166534" }}>{x.name}: {x.score > 0 ? "+" : ""}{x.score}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Campaign Preflight Readiness Check</h2>
        <form onSubmit={runPreflight} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Sender email (e.g. news@mail.yourdomain.com)" value={pfFrom} onChange={e => setPfFrom(e.target.value)} style={{ flex: 1, minWidth: 220, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }} />
            <select value={pfMode} onChange={e => setPfMode(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}>
              <option value="campaign">Campaign (Bulk)</option>
              <option value="transactional">Transactional (1-to-1)</option>
            </select>
            <button disabled={pfBusy} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{pfBusy ? "Scanning..." : "Run Preflight Check"}</button>
          </div>
        </form>
        {pfRes && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ padding: "3px 10px", borderRadius: 99, fontWeight: 700, background: pfRes.readiness === "ready" ? "#dcfce7" : pfRes.readiness === "warning" ? "#fef3c7" : "#fee2e2", color: pfRes.readiness === "ready" ? "#166534" : pfRes.readiness === "warning" ? "#92400e" : "#991b1b" }}>Readiness: {pfRes.readiness_score}/100 ({String(pfRes.readiness).toUpperCase()})</span>
              <span>Rspamd: <strong>{pfRes.spam?.score ?? 0}</strong></span>
              <span>Unsubscribe Tag: <strong>{pfRes.compliance?.has_unsubscribe ? "OK" : "Missing"}</strong></span>
            </div>
            {pfRes.issues?.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#991b1b" }}>
                {pfRes.issues.map((it, i) => <li key={i}><strong>[{it.code}]</strong> {it.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
