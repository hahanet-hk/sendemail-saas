'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

function loadAirwallexSdk() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Airwallex) return Promise.resolve(window.Airwallex);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.airwallex.com/assets/elements.bundle.min.js';
    s.async = true;
    s.onload = () => resolve(window.Airwallex);
    s.onerror = () => reject(new Error('Failed to load Airwallex SDK'));
    document.head.appendChild(s);
  });
}

export default function BillingTab({ onRefresh }) {
  const [data, setData] = useState(null);
  const [saData, setSaData] = useState(null);
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeIntent, setActiveIntent] = useState(null);
  const dropinRef = useRef(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/billing/plans');
    if (r.ok) { const j = await r.json(); setData(j); if (j.current?.billing_currency) setCurrency(j.current.billing_currency); }
    const sa = await fetch('/api/v1/superadmin/overview');
    if (sa.ok) setSaData(await sa.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!activeIntent || !dropinRef.current) return;
    let element = null, mounted = true;
    (async () => {
      try {
        const Airwallex = await loadAirwallexSdk();
        if (!mounted || !Airwallex) return;
        Airwallex.init({ env: activeIntent.env === 'prod' ? 'prod' : 'demo', origin: window.location.origin });
        element = Airwallex.createElement('dropIn', { intent_id: activeIntent.provider_intent_id, client_secret: activeIntent.client_secret, currency: activeIntent.currency });
        element.mount(dropinRef.current);
        element.on('success', async () => { setActiveIntent(null); setMsg(`Payment succeeded (${activeIntent.order_uid}). Credits/Plan will update shortly.`); await load(); if (onRefresh) await onRefresh(); });
        element.on('error', (ev) => setMsg(ev?.detail?.error?.message || 'Payment error occurred.'));
      } catch (e) { setMsg(e.message); }
    })();
    return () => { mounted = false; try { element?.destroy?.(); } catch {} };
  }, [activeIntent, load, onRefresh]);

  async function checkoutAndConfirm(payload) {
    setBusy(true); setMsg(''); setActiveIntent(null);
    try {
      const r = await fetch('/api/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, currency }) });
      const ord = await r.json();
      if (!r.ok) return setMsg(ord.message || ord.error || 'Checkout failed');
      if (ord.provider === 'airwallex' && ord.client_secret) {
        setActiveIntent(ord);
        return;
      }
      if (ord.status !== 'paid') {
        const c = await fetch(`/api/v1/billing/orders/${ord.order_uid}/confirm`, { method: 'POST' });
        if (c.ok) setMsg(`Order ${ord.order_uid} (${currency} ${ord.amount}) confirmed & fulfilled.`);
      } else { setMsg(`Plan switched to ${payload.plan_code}.`); }
      await load(); if (onRefresh) await onRefresh();
    } finally { setBusy(false); }
  }

  async function saAction(tenantId, action) {
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/superadmin/tenants/${tenantId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, add_credits: action === 'adjust' ? 5000 : 0, reason: 'SuperAdmin Console action' }) });
      if (r.ok) { await load(); if (onRefresh) await onRefresh(); }
    } finally { setBusy(false); }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
  const cur = data?.current || {};

  return (
    <div>
      {msg && <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{msg}</div>}
      {activeIntent && (
        <div style={{ ...card, border: '2px solid #2563eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>Airwallex Secure Checkout · {activeIntent.currency} {activeIntent.amount} ({activeIntent.order_uid})</strong>
            <button onClick={() => setActiveIntent(null)} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          </div>
          <div ref={dropinRef} style={{ minHeight: 280 }} />
        </div>
      )}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div><h3 style={{ margin: 0 }}>Subscription Plans (Airwallex Multi-Currency)</h3><span style={{ fontSize: 12, color: '#64748b' }}>Current Tier: <strong>{(cur.plan_tier || 'free').toUpperCase()}</strong> · Quota: {cur.used_quota || 0}/{cur.monthly_quota || 1000} · Credits: {cur.credit_balance ?? 0}</span></div>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontWeight: 600 }}><option value="USD">USD ($)</option><option value="HKD">HKD (HK$)</option><option value="TWD">TWD (NT$)</option></select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {data?.plans?.map((pl) => {
            const price = currency === 'HKD' ? pl.price_hkd : currency === 'TWD' ? pl.price_twd : pl.price_usd;
            const isCurrent = cur.plan_tier === pl.plan_code;
            return (<div key={pl.plan_code} style={{ border: isCurrent ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{pl.name}</div><div style={{ fontSize: 22, fontWeight: 800, margin: '8px 0' }}>{currency} {price}<span style={{ fontSize: 12, fontWeight: 400 }}>/mo</span></div><div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}><div>• {Number(pl.monthly_quota).toLocaleString()} emails/mo</div><div>• {Number(pl.included_verify_credits).toLocaleString()} verify credits</div></div><button disabled={busy || isCurrent} onClick={() => checkoutAndConfirm({ order_type: 'subscription', plan_code: pl.plan_code })} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: 0, background: isCurrent ? '#94a3b8' : '#0f172a', color: '#fff', cursor: isCurrent ? 'default' : 'pointer', fontSize: 12, fontWeight: 600 }}>{isCurrent ? 'Active Plan' : 'Subscribe & Pay'}</button></div>);
          })}
        </div>
      </div>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Verify Credits Top-Up Packs (Never Expire)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {data?.topup_packages && Object.entries(data.topup_packages).map(([code, pkg]) => {
            const price = currency === 'HKD' ? pkg.hkd : currency === 'TWD' ? pkg.twd : pkg.usd;
            return (<div key={code} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><strong>+{pkg.credits.toLocaleString()} Credits</strong><div style={{ fontSize: 12, color: '#64748b' }}>{currency} {price}</div></div><button disabled={busy} onClick={() => checkoutAndConfirm({ order_type: 'credit_topup', topup_package: code })} style={{ padding: '6px 12px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Buy Pack</button></div>);
          })}
        </div>
      </div>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Credit Ledger &amp; Billing Orders</h3>
        {data?.ledger?.length ? data.ledger.slice(0, 8).map((l) => (<div key={l.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><strong style={{ color: l.delta >= 0 ? '#16a34a' : '#dc2626' }}>{l.delta >= 0 ? `+${l.delta}` : l.delta}</strong> · {l.reason} (Balance: {l.balance_after})</div>)) : <p style={{ fontSize: 13, color: '#64748b' }}>No ledger entries yet.</p>}
      </div>
      {saData?.kpis && (
        <div style={{ ...card, border: '1px solid #cbd5e1', background: '#f8fafc' }}>
          <h3 style={{ marginTop: 0 }}>SuperAdmin Global Command Center</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
            <div style={card}><div style={{ fontSize: 11, color: '#64748b' }}>Total Tenants</div><div style={{ fontSize: 20, fontWeight: 700 }}>{saData.kpis.total_tenants}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#64748b' }}>Frozen Tenants</div><div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{saData.kpis.frozen_tenants}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#64748b' }}>Global Emails Sent</div><div style={{ fontSize: 20, fontWeight: 700 }}>{saData.kpis.total_emails_dispatched}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#64748b' }}>Gross Paid Revenue</div><div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>${saData.kpis.gross_revenue_paid}</div></div>
          </div>
          {saData.tenants?.map((t) => (<div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0', fontSize: 13 }}><div><strong>#{t.id} {t.name}</strong> ({t.email}) · Tier: {t.plan_tier} · Rep: {t.reputation_score} {t.sending_frozen_at ? <span style={{ color: '#dc2626', fontWeight: 700 }}>[FROZEN]</span> : ''}</div><div style={{ display: 'flex', gap: 6 }}><button disabled={busy} onClick={() => saAction(t.id, 'adjust')} style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 11 }}>+5k Credits</button>{t.sending_frozen_at ? <button disabled={busy} onClick={() => saAction(t.id, 'unfreeze')} style={{ padding: '4px 8px', borderRadius: 5, border: 0, background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 11 }}>Unfreeze</button> : <button disabled={busy} onClick={() => saAction(t.id, 'freeze')} style={{ padding: '4px 8px', borderRadius: 5, border: 0, background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 11 }}>Freeze</button>}</div></div>))}
        </div>
      )}
    </div>
  );
}
