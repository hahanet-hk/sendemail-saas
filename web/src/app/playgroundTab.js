'use client';
import { useState, useEffect } from 'react';

export default function PlaygroundTab({ onRefresh }) {
  const [preset, setPreset] = useState('send_template');
  const [method, setMethod] = useState('POST');
  const [path, setPath] = useState('/api/v1/send');
  const [bearerKey, setBearerKey] = useState('');
  const [templates, setTemplates] = useState([]);
  const [selectedTpl, setSelectedTpl] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [bodyText, setBodyText] = useState('');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);
  const [copiedCurl, setCopiedCurl] = useState(false);

  useEffect(() => {
    fetch('/api/v1/templates').then((r) => r.json()).then((d) => {
      const list = d.templates || [];
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTpl(list[0].template_uid);
        applyTemplatePayload(list[0], true);
      } else {
        setBodyText(JSON.stringify({
          to: ['alice@example.com'],
          from_name: 'Acme App',
          from_email: 'noreply@sendemail.ai',
          template_id: 'tpl_your_template_uid',
          variables: { first_name: 'Alice', code: '849201' },
          sandbox: true
        }, null, 2));
      }
    }).catch(() => {});
  }, []);

  function applyTemplatePayload(tpl, isSandbox = sandbox) {
    let vars = {};
    try {
      vars = typeof tpl.sample_variables === 'string' ? JSON.parse(tpl.sample_variables || '{}') : (tpl.sample_variables || {});
    } catch {}
    if (!Object.keys(vars).length && Array.isArray(tpl.variables)) {
      tpl.variables.forEach((v) => { vars[v] = `sample_${v}`; });
    }
    setBodyText(JSON.stringify({
      to: ['alice@example.com'],
      from_name: 'Acme App',
      from_email: 'noreply@sendemail.ai',
      template_id: tpl.template_uid,
      variables: vars,
      sandbox: isSandbox
    }, null, 2));
  }

  function handlePresetChange(next) {
    setPreset(next);
    setResp(null);
    if (next === 'send_template') {
      setMethod('POST'); setPath('/api/v1/send');
      const tpl = templates.find((t) => t.template_uid === selectedTpl) || templates[0];
      if (tpl) applyTemplatePayload(tpl, sandbox);
      else setBodyText(JSON.stringify({ to: ['alice@example.com'], template_id: 'tpl_your_template_uid', variables: { name: 'Alice' }, sandbox }, null, 2));
    } else if (next === 'send_raw') {
      setMethod('POST'); setPath('/api/v1/send');
      setBodyText(JSON.stringify({
        to: ['alice@example.com'],
        from_name: 'Acme App',
        from_email: 'noreply@sendemail.ai',
        subject: 'Playground Test Email',
        html: '<h1>Hello from SendEmail.ai</h1><p>Sent via interactive API Playground.</p>',
        sandbox
      }, null, 2));
    } else if (next === 'verify_batch') {
      setMethod('POST'); setPath('/api/v1/verify/batch');
      setBodyText(JSON.stringify({
        source_name: 'playground_test',
        emails: ['valid.user@gmail.com', 'test@mailinator.com']
      }, null, 2));
    } else if (next === 'preflight_check') {
      setMethod('POST'); setPath('/api/v1/tools/preflight');
      setBodyText(JSON.stringify({
        mode: 'campaign',
        from_email: 'news@mail.yourdomain.com',
        subject: 'Spring Release Notes',
        html: '<p>Explore our new features! <a href="[UNSUBSCRIBE_URL]">Unsubscribe</a></p>'
      }, null, 2));
    } else if (next === 'spam_check') {
      setMethod('POST'); setPath('/api/v1/tools/spam-check');
      setBodyText(JSON.stringify({
        from_email: 'noreply@sendemail.ai',
        to_email: 'alice@example.com',
        subject: 'Account Security Alert',
        html: '<p>Your API key was created successfully.</p>'
      }, null, 2));
    } else if (next === 'spam_learn') {
      setMethod('POST'); setPath('/api/v1/tools/spam-learn');
      setBodyText(JSON.stringify({
        type: 'ham',
        subject: 'Monthly Billing Statement',
        html: '<p>Thank you for your business. Invoice #1042 attached.</p>'
      }, null, 2));
    } else if (next === 'list_domains') {
      setMethod('GET'); setPath('/api/v1/domains'); setBodyText('');
    } else if (next === 'get_me') {
      setMethod('GET'); setPath('/api/v1/me'); setBodyText('');
    } else if (next === 'get_openapi') {
      setMethod('GET'); setPath('/api/v1/openapi.yaml'); setBodyText('');
    }
  }

  function handleTemplateSelect(uid) {
    setSelectedTpl(uid);
    const tpl = templates.find((t) => t.template_uid === uid);
    if (tpl) applyTemplatePayload(tpl, sandbox);
  }

  function handleSandboxToggle(checked) {
    setSandbox(checked);
    try {
      const obj = JSON.parse(bodyText);
      if ('sandbox' in obj) {
        obj.sandbox = checked;
        setBodyText(JSON.stringify(obj, null, 2));
      }
    } catch {}
  }

  async function sendRequest() {
    setLoading(true);
    const t0 = performance.now();
    try {
      const headers = {};
      if (bearerKey.trim()) headers['Authorization'] = `Bearer ${bearerKey.trim()}`;
      const opts = { method, headers };
      if (method !== 'GET' && method !== 'DELETE') {
        headers['Content-Type'] = 'application/json';
        opts.body = bodyText;
      }
      const r = await fetch(path, opts);
      const ms = Math.round(performance.now() - t0);
      const resHeaders = {};
      r.headers.forEach((v, k) => { resHeaders[k] = v; });
      const rawText = await r.text();
      let formatted = rawText;
      try { formatted = JSON.stringify(JSON.parse(rawText), null, 2); } catch {}
      setResp({ status: r.status, statusText: r.statusText, ms, headers: resHeaders, body: formatted });
      if (onRefresh) onRefresh();
    } catch (err) {
      setResp({ status: 0, statusText: 'Network Error', ms: Math.round(performance.now() - t0), headers: {}, body: err.message });
    } finally {
      setLoading(false);
    }
  }

  function copyCurl() {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.sendemail.ai';
    const authLine = bearerKey.trim() ? ` \\\n  -H "Authorization: Bearer ${bearerKey.trim()}"` : ' \\\n  -H "Authorization: Bearer se_live_your_api_key_here"';
    const bodyLine = (method !== 'GET' && bodyText.trim()) ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyText.replace(/'/g, "'\\''")}'` : '';
    navigator.clipboard.writeText(`curl -i -X ${method} "${origin}${path}"${authLine}${bodyLine}`);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1800);
  }

  const card = { background: '#fff', padding: 22, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)' };
  const pill = (active) => ({ padding: '6px 12px', borderRadius: 6, border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: active ? '#2563eb' : '#f1f5f9', color: active ? '#fff' : '#475569' });
  const badgeColor = !resp ? '#64748b' : resp.status >= 200 && resp.status < 300 ? '#16a34a' : '#dc2626';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 18 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Interactive API Playground</h3>
          <button type="button" onClick={copyCurl} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#334155' }}>
            {copiedCurl ? 'Copied cURL!' : 'Copy as cURL'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" style={pill(preset === 'send_template')} onClick={() => handlePresetChange('send_template')}>Send Template</button>
          <button type="button" style={pill(preset === 'send_raw')} onClick={() => handlePresetChange('send_raw')}>Send Raw HTML</button>
          <button type="button" style={pill(preset === 'verify_batch')} onClick={() => handlePresetChange('verify_batch')}>Bulk Verify</button>
          <button type="button" style={pill(preset === 'preflight_check')} onClick={() => handlePresetChange('preflight_check')}>Preflight Check</button>
          <button type="button" style={pill(preset === 'spam_check')} onClick={() => handlePresetChange('spam_check')}>Rspamd Check</button>
          <button type="button" style={pill(preset === 'spam_learn')} onClick={() => handlePresetChange('spam_learn')}>Bayes Train</button>
          <button type="button" style={pill(preset === 'list_domains')} onClick={() => handlePresetChange('list_domains')}>Domains & Channels</button>
          <button type="button" style={pill(preset === 'get_me')} onClick={() => handlePresetChange('get_me')}>Quota & Credits</button>
          <button type="button" style={pill(preset === 'get_openapi')} onClick={() => handlePresetChange('get_openapi')}>OpenAPI YAML</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span style={{ padding: '8px 12px', borderRadius: 8, background: method === 'POST' ? '#dbeafe' : '#dcfce7', color: method === 'POST' ? '#1d4ed8' : '#15803d', fontWeight: 700, fontSize: 13 }}>{method}</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: 13 }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Authorization Bearer Key (Optional — defaults to active Dashboard session)</label>
          <input value={bearerKey} onChange={(e) => setBearerKey(e.target.value)} placeholder="se_live_... or se_test_..." style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: 12.5 }} />
        </div>

        {preset === 'send_template' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Select Saved Template (Auto-fills Merge Variables)</label>
            <select value={selectedTpl} onChange={(e) => handleTemplateSelect(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}>
              {templates.length === 0 && <option value="">No saved templates yet (create one in Templates tab)</option>}
              {templates.map((t) => (
                <option key={t.template_uid} value={t.template_uid}>{t.name} ({t.template_uid})</option>
              ))}
            </select>
          </div>
        )}

        {(preset === 'send_template' || preset === 'send_raw') && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={sandbox} onChange={(e) => handleSandboxToggle(e.target.checked)} />
            <span>Enable <strong>Sandbox Mode</strong> (captures email in Sandbox tab without external delivery or quota deduction)</span>
          </label>
        )}

        {method !== 'GET' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>JSON Request Payload</label>
            <textarea rows={11} value={bodyText} onChange={(e) => setBodyText(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5, background: '#f8fafc' }} />
          </div>
        )}

        <button type="button" disabled={loading} onClick={sendRequest} style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: 0, background: loading ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Sending Request...' : `Send ${method} Request`}
        </button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>HTTP Response Inspector</h3>
          {resp && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ padding: '4px 10px', borderRadius: 999, background: badgeColor, color: '#fff', fontWeight: 700, fontSize: 12 }}>
                {resp.status} {resp.statusText}
              </span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{resp.ms} ms</span>
            </div>
          )}
        </div>

        {!resp ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 10, border: '1px dashed #cbd5e1', fontSize: 13 }}>
            Select an endpoint or template on the left and click <strong>Send Request</strong> to inspect live HTTP headers, rate-limit counters, and JSON payload.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Response Headers</div>
              <pre style={{ margin: 0, padding: 10, background: '#f1f5f9', color: '#1e293b', borderRadius: 8, fontSize: 11.5, overflowX: 'auto', maxHeight: 130 }}>
                {Object.entries(resp.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
              </pre>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Response Body</div>
              <pre style={{ margin: 0, padding: 14, background: '#0f172a', color: '#e2e8f0', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto', maxHeight: 340 }}>
                <code>{resp.body}</code>
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
