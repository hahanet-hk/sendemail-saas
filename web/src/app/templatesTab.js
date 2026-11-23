'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';

const getVars = (s) => [...new Set([...String(s || '').matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((m) => m[1]))];
const renderTpl = (s, v) => String(s || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) => (v?.[k] ? String(v[k]) : `{{${k}}}`));

export default function TemplatesTab({ onRefresh }) {
  const [list, setList] = useState([]);
  const [uid, setUid] = useState(null);
  const [name, setName] = useState('Welcome Email');
  const [sub, setSub] = useState('Welcome to {{company}}, {{name}}!');
  const [html, setHtml] = useState('<div style="font-family:sans-serif"><h2>Hi {{name}},</h2><p>Welcome to <b>{{company}}</b>!</p></div>');
  const [vars, setVars] = useState({ name: 'Alex', company: 'SendEmail.ai' });
  const [msg, setMsg] = useState('');
  const [testTo, setTestTo] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [testRes, setTestRes] = useState(null);

  const detected = useMemo(() => getVars(`${sub}\n${html}`), [sub, html]);
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/templates');
    if (r.ok) setList((await r.json()).templates || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    const r = await fetch(uid ? `/api/v1/templates/${uid}` : '/api/v1/templates', {
      method: uid ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject_template: sub, html_template: html, sample_variables: vars })
    });
    const d = await r.json();
    if (r.ok) { setUid(d.template.template_uid); setMsg(`Saved: ${d.template.template_uid}`); load(); }
    else setMsg(d.error || 'Error');
  }

  async function sendTest(e) {
    e.preventDefault();
    const r = await fetch('/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testTo.split(',').map((s) => s.trim()).filter(Boolean), template_id: uid, variables: vars, sandbox })
    });
    setTestRes(await r.json());
    onRefresh?.();
  }

  const card = { background: '#fff', padding: 18, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)', marginBottom: 14 };
  const inp = { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 8, fontSize: 13 };

  return (
    <div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong>Templates ({list.length})</strong>
          <button type="button" onClick={() => { setUid(null); setName('New Template'); setMsg(''); }} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>+ New</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {list.map((t) => (
            <div key={t.template_uid} style={{ border: uid === t.template_uid ? '1.5px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
              <div><strong>{t.name}</strong> <code>({t.template_uid})</code></div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => { setUid(t.template_uid); setName(t.name); setSub(t.subject_template); setHtml(t.html_template); setVars(t.sample_variables || {}); setTestRes(null); }} style={{ fontSize: 11, cursor: 'pointer' }}>Edit</button>
                <button type="button" onClick={async () => { await fetch(`/api/v1/templates/${t.template_uid}`, { method: 'DELETE' }); if (uid === t.template_uid) setUid(null); load(); }} style={{ fontSize: 11, color: '#dc2626', cursor: 'pointer' }}>Del</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <form onSubmit={save} style={card}>
          <h4 style={{ marginTop: 0 }}>{uid ? `Edit ${uid}` : 'Create Template'}</h4>
          <input style={inp} placeholder="Template Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input style={inp} placeholder="Subject ({{var}})" value={sub} onChange={(e) => setSub(e.target.value)} required />
          <textarea rows={7} style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }} value={html} onChange={(e) => setHtml(e.target.value)} required />
          <button style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Save Template</button>
          {msg && <span style={{ marginLeft: 10, fontSize: 12, color: '#166534' }}>{msg}</span>}
        </form>

        <div>
          <div style={card}>
            <h4 style={{ marginTop: 0 }}>Variables & Live Preview</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              {detected.map((k) => (
                <input key={k} style={{ ...inp, marginBottom: 0, fontSize: 12 }} placeholder={k} value={vars[k] ?? ''} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
              ))}
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}><strong>{renderTpl(sub, vars)}</strong></div>
              <iframe title="Preview" srcDoc={renderTpl(html, vars)} style={{ width: '100%', height: 170, border: 0 }} />
            </div>
          </div>

          {uid && (
            <form onSubmit={sendTest} style={card}>
              <h4 style={{ marginTop: 0 }}>Test Dispatch ({uid})</h4>
              <input style={inp} placeholder="Recipient email" value={testTo} onChange={(e) => setTestTo(e.target.value)} required />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}><input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} /> Sandbox mode</label>
              <button style={{ padding: '7px 14px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Send Template</button>
              {testRes && <pre style={{ fontSize: 11, background: '#f8fafc', padding: 8, marginTop: 8 }}>{JSON.stringify(testRes, null, 2)}</pre>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
