'use client';
import { useState, useEffect } from 'react';

export default function OverviewAnalytics() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [resetLogs, setResetLogs] = useState([]);

  useEffect(() => {
    fetch("/api/v1/billing/reset-logs").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && Array.isArray(d.logs)) setResetLogs(d.logs); }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/analytics?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && d) setData(d); });
    return () => { active = false; };
  }, [days]);

  const card = { background: '#fff', padding: 20, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginBottom: 18 };
  if (!data) return <div style={{ ...card, color: '#64748b', fontSize: 13 }}>Loading analytics...</div>;

  const { series, suppressions, summary } = data;
  const maxVal = Math.max(1, ...series.map((d) => d.sent + d.failed + d.queued));
  const totalSup = suppressions.reduce((acc, s) => acc + s.count, 0);

  const reasonColors = {
    hard_bounce: '#ef4444',
    complaint: '#f97316',
    unsubscribe: '#eab308',
    manual: '#64748b'
  };

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 18 }}>
      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Dispatch Volume & Delivery</h3>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Delivery Rate: <strong>{summary.delivery_rate !== null ? `${summary.delivery_rate}%` : '—'}</strong> · Webhook Success: <strong>{summary.webhook_success_rate !== null ? `${summary.webhook_success_rate}%` : '—'}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  background: days === d ? '#0f172a' : '#f1f5f9',
                  color: days === d ? '#fff' : '#475569'
                }}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, paddingTop: 12, borderBottom: '1px solid #e2e8f0' }}>
          {series.map((item) => {
            const sentH = Math.round((item.sent / maxVal) * 124);
            const failH = Math.round(((item.failed + item.queued) / maxVal) * 124);
            return (
              <div key={item.date} title={`${item.date}: Sent ${item.sent}, Failed/Queued ${item.failed + item.queued}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', maxWidth: 26, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  {failH > 0 && <div style={{ height: Math.max(failH, 4), background: '#f87171', borderRadius: sentH > 0 ? '4px 4px 0 0' : 4 }} />}
                  {sentH > 0 && <div style={{ height: Math.max(sentH, 4), background: '#2563eb', borderRadius: failH > 0 ? '0 0 4px 4px' : 4 }} />}
                  {sentH === 0 && failH === 0 && <div style={{ height: 3, background: '#e2e8f0', borderRadius: 2 }} />}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
          <span>{series[0]?.label}</span>
          <span style={{ display: 'flex', gap: 14, color: '#475569' }}>
            <span><i style={{ display: 'inline-block', width: 8, height: 8, background: '#2563eb', borderRadius: 2, marginRight: 4 }} />Sent ({summary.sent_recipients})</span>
            <span><i style={{ display: 'inline-block', width: 8, height: 8, background: '#f87171', borderRadius: 2, marginRight: 4 }} />Failed/Blocked ({summary.failed_recipients})</span>
          </span>
          <span>{series[series.length - 1]?.label}</span>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: 16, color: '#0f172a' }}>Suppression Breakdown</h3>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Total suppressed: <strong>{totalSup}</strong></div>

        {suppressions.length === 0 ? (
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 28 }}>No suppressed addresses yet. Clean sender reputation.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {suppressions.map((s) => {
              const pct = totalSup > 0 ? Math.round((s.count / totalSup) * 100) : 0;
              return (
                <div key={s.reason}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#334155', textTransform: 'capitalize' }}>{s.reason.replace('_', ' ')}</span>
                    <span style={{ color: '#64748b' }}>{s.count} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: reasonColors[s.reason] || '#3b82f6', borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: "#0f172a" }}>Monthly Billing Cycle Reset Audit Logs</h3>
          <span style={{ fontSize: 12, color: "#64748b" }}>Automated UTC monthly quota resets protected by idempotent cycle locks</span>
        </div>
        <span style={{ fontSize: 11.5, padding: "3px 9px", borderRadius: 999, background: "#f0fdf4", color: "#15803d", fontWeight: 600 }}>Auto-Scheduler Active</span>
      </div>
      {resetLogs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>No billing cycle reset records logged yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b", fontSize: 12 }}>
                <th style={{ padding: "8px 6px" }}>Billing Cycle</th>
                <th style={{ padding: "8px 6px" }}>Tenants Reset</th>
                <th style={{ padding: "8px 6px" }}>Total Quota Cleared</th>
                <th style={{ padding: "8px 6px" }}>Executed At</th>
              </tr>
            </thead>
            <tbody>
              {resetLogs.map((l) => (
                <tr key={l.cycle_key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 700, fontFamily: "monospace", color: "#0f172a" }}>{l.cycle_key}</td>
                  <td style={{ padding: "8px 6px", color: "#334155" }}>{l.tenants_reset_count}</td>
                  <td style={{ padding: "8px 6px", color: "#2563eb", fontWeight: 600 }}>{Number(l.total_quota_cleared || 0).toLocaleString()} emails</td>
                  <td style={{ padding: "8px 6px", color: "#64748b" }}>{new Date(l.executed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
}
