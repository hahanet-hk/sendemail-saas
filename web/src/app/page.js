'use client';
import { useState, useEffect } from 'react';
import AuthView from './authView';
import KeysTab from './keysTab';
import ToolsTab from './toolsTab';
import OpsRiskTab from './opsRiskTab';
import AutomationsTab from './automationsTab';
import BillingTab from './billingTab';
import CmsAdminTab from './cmsAdminTab';
import TemplatesTab from './templatesTab';
import PlaygroundTab from './playgroundTab';
import ApiDocsTab from './apiDocsTab';
import DomainsTab from './domainsTab';
import SandboxTab from './sandboxTab';
import WebhooksTab from './webhooksTab';
import OverviewAnalytics from './overviewAnalytics';
import ProfileTab from './profileTab';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  async function loadSession() {
    setLoading(true);
    const r = await fetch('/api/v1/auth/session');
    setData(r.ok ? await r.json() : null);
    setLoading(false);
  }
  useEffect(() => { loadSession(); }, []);

  async function logout() { await fetch('/api/v1/auth/logout', { method: 'POST' }); setData(null); }
  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading workspace...</div>;
  if (!data) return <AuthView onSuccess={loadSession} />;
  const { user, tenant, stats, verify_stats, recent_dispatches } = data;
  const kpi = { background: '#fff', padding: 18, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)' };
  const btn = (k) => ({ padding: '7px 11px', fontSize: 13, borderRadius: 8, border: 0, cursor: 'pointer', fontWeight: 600, background: tab === k ? '#0f172a' : '#e2e8f0', color: tab === k ? '#fff' : '#334155' });
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '28px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div><h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>SendEmail.ai Console</h1><span style={{ fontSize: 13, color: '#64748b' }}>{user.email} · {tenant.name}</span></div>
        <button onClick={logout} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Sign Out</button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
        <div style={kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Verify Credits</div><div style={{ fontSize: 22, fontWeight: 700 }}>{tenant.credit_balance}</div></div>
        <div style={kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Monthly Quota</div><div style={{ fontSize: 22, fontWeight: 700 }}>{tenant.used_quota} / {tenant.monthly_quota}</div></div>
        <div style={kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Total Sent</div><div style={{ fontSize: 22, fontWeight: 700 }}>{stats?.total_sent || 0}</div></div>
        <div style={kpi}><div style={{ fontSize: 12, color: '#64748b' }}>Deliverable Rate</div><div style={{ fontSize: 22, fontWeight: 700 }}>{verify_stats?.total_checked ? Math.round((verify_stats.deliverable_count / verify_stats.total_checked) * 100) + '%' : '—'}</div></div>
      </div>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <button style={btn('overview')} onClick={() => setTab('overview')}>Overview</button>
        <button style={btn('keys')} onClick={() => setTab('keys')}>API Keys</button>
        <button style={btn('tools')} onClick={() => setTab('tools')}>Verify & Send</button>
          <button style={btn('templates')} onClick={() => setTab('templates')}>Templates</button>
        <button style={btn('domains')} onClick={() => setTab('domains')}>Domains & Channels</button>
        <button style={btn('sandbox')} onClick={() => setTab('sandbox')}>Sandbox & Suppressions</button>
        <button style={btn('ops')} onClick={() => setTab('ops')}>Ops & Bounces</button>
        <button style={btn('automations')} onClick={() => setTab('automations')}>Automations & A/B</button>
        <button style={btn('billing')} onClick={() => setTab('billing')}>Billing & Admin</button>
        <button style={btn('cms')} onClick={() => setTab('cms')}>CMS & Vault</button>
        <button style={btn('webhooks')} onClick={() => setTab('webhooks')}>Webhooks & Events</button>
        <button style={btn('playground')} onClick={() => setTab('playground')}>API Playground</button>
        <button style={btn('apidocs')} onClick={() => setTab('apidocs')}>API Docs</button>
        <button style={btn('profile')} onClick={() => setTab('profile')}>Profile</button>
      </nav>
      {tab === 'overview' && <><OverviewAnalytics /><div style={kpi}><h3 style={{ marginTop: 0 }}>Recent Dispatches</h3>{recent_dispatches?.length ? recent_dispatches.map((d) => <div key={d.dispatch_uid} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><strong>{d.subject}</strong> · {d.mode} ({d.recipient_count}) — <span>{d.status}</span></div>) : <p style={{ color: '#64748b', fontSize: 13 }}>No dispatches yet. Use Verify & Send or your API key to start.</p>}</div></>}
      {tab === 'keys' && <KeysTab />}
      {tab === 'tools' && <ToolsTab onRefresh={loadSession} />}
        {tab === 'templates' && <TemplatesTab onRefresh={loadSession} />}
      {tab === 'domains' && <DomainsTab />}
      {tab === 'sandbox' && <SandboxTab />}
      {tab === 'ops' && <OpsRiskTab />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'billing' && <BillingTab onRefresh={loadSession} />}
      {tab === 'cms' && <CmsAdminTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'playground' && <PlaygroundTab onRefresh={loadSession} />}
      {tab === 'apidocs' && <ApiDocsTab onOpenPlayground={() => setTab('playground')} />}
      {tab === 'profile' && <ProfileTab user={user} tenant={tenant} onRefresh={loadSession} />}
    </div>
  );
}
