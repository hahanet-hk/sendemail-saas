'use client';
import { useState, useEffect, useMemo } from 'react';

function yamlBlockToObj(lines, baseIndent) {
  const firstLine = lines[0]?.trim() || '';
  if (firstLine.startsWith('- ')) {
    const arr = [];
    for (const raw of lines) {
      const t = raw.trim();
      if (t.startsWith('- ')) {
        let v = t.slice(2).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        arr.push(v);
      }
    }
    return arr;
  }
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const indent = raw.search(/\S/);
    const t = raw.trim();
    const colonIdx = t.indexOf(':');
    if (colonIdx === -1) { i++; continue; }
    const key = t.slice(0, colonIdx).trim();
    const rest = t.slice(colonIdx + 1).trim();
    if (rest === '') {
      const sub = [];
      i++;
      while (i < lines.length && lines[i].search(/\S/) > indent) {
        sub.push(lines[i]);
        i++;
      }
      obj[key] = sub.length ? yamlBlockToObj(sub, indent + 2) : {};
    } else {
      let val = rest;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
      else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      obj[key] = val;
      i++;
    }
  }
  return obj;
}

function parseOpenApiYaml(yaml) {
  const lines = yaml.split(/\r?\n/);
  const info = { title: 'SendEmail.ai API', version: '1.0.0', description: '' };
  const servers = [];
  const endpoints = [];
  let section = '';
  let curServer = null;
  let curPath = '';
  let curOp = null;
  let subMode = '';
  let curStatus = '';
  let exampleLines = [];

  function flushExample() {
    if (curOp && exampleLines.length > 0) {
      try {
        const parsed = yamlBlockToObj(exampleLines, 14);
        curOp.requestBodyJson = JSON.stringify(parsed, null, 2);
      } catch {
        curOp.requestBodyJson = exampleLines.join('\n');
      }
      exampleLines = [];
    }
  }

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.search(/\S/);
    const line = raw.trim();

    if (subMode === 'example') {
      if (indent >= 14) {
        exampleLines.push(raw);
        continue;
      } else {
        flushExample();
        subMode = '';
      }
    }

    if (indent === 0) {
      subMode = '';
      curOp = null;
      if (line.startsWith('info:')) section = 'info';
      else if (line.startsWith('servers:')) section = 'servers';
      else if (line.startsWith('paths:')) section = 'paths';
      else section = '';
      continue;
    }

    if (section === 'info') {
      if (line.startsWith('title:')) info.title = line.slice(6).trim();
      else if (line.startsWith('version:')) info.version = line.slice(8).trim();
      else if (line.startsWith('description:')) info.description = line.slice(12).trim();
    } else if (section === 'servers') {
      if (line.startsWith('- url:')) {
        curServer = { url: line.slice(6).trim(), description: '' };
        servers.push(curServer);
      } else if (line.startsWith('description:') && curServer) {
        curServer.description = line.slice(12).trim();
      }
    } else if (section === 'paths') {
      if (indent === 2 && line.endsWith(':')) {
        curPath = line.slice(0, -1);
        curOp = null;
        subMode = '';
      } else if (indent === 4 && /^(get|post|put|patch|delete):$/i.test(line)) {
        const method = line.slice(0, -1).toUpperCase();
        const pathParams = [...curPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
        curOp = {
          id: `${method} ${curPath}`,
          method,
          path: curPath,
          summary: '',
          public: false,
          params: pathParams,
          requestRequired: false,
          requestBodyJson: '',
          responses: []
        };
        endpoints.push(curOp);
        subMode = '';
      } else if (curOp && indent === 6) {
        if (line.startsWith('summary:')) {
          curOp.summary = line.slice(8).trim();
          subMode = '';
        } else if (line.startsWith('security:')) {
          if (line.includes('[]')) curOp.public = true;
          subMode = '';
        } else if (line === 'requestBody:') {
          subMode = 'requestBody';
        } else if (line === 'responses:') {
          subMode = 'responses';
        } else {
          subMode = '';
        }
      } else if (curOp && subMode === 'requestBody') {
        if (indent === 8 && line.startsWith('required:')) {
          curOp.requestRequired = line.includes('true');
        } else if (indent === 12 && line === 'example:') {
          subMode = 'example';
          exampleLines = [];
        }
      } else if (curOp && subMode === 'responses') {
        if (indent === 8 && line.endsWith(':')) {
          curStatus = line.slice(0, -1).replace(/['"]/g, '');
        } else if (indent === 10 && line.startsWith('description:')) {
          curOp.responses.push({ code: curStatus, description: line.slice(12).trim() });
        }
      }
    }
  }
  flushExample();
  return { info, servers, endpoints };
}

export default function ApiDocsTab({ onOpenPlayground }) {
  const [rawYaml, setRawYaml] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [expanded, setExpanded] = useState({ 'POST /send': true });
  const [showRaw, setShowRaw] = useState(false);
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    fetch('/api/v1/openapi.yaml')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => {
        setRawYaml(txt);
        setLoading(false);
      })
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }, []);

  const spec = useMemo(() => parseOpenApiYaml(rawYaml), [rawYaml]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return spec.endpoints.filter((ep) => {
      if (methodFilter !== 'ALL' && ep.method !== methodFilter) return false;
      if (!q) return true;
      const inResp = ep.responses.some((r) => r.code.includes(q) || r.description.toLowerCase().includes(q));
      const inBody = ep.requestBodyJson.toLowerCase().includes(q);
      return ep.path.toLowerCase().includes(q) || ep.summary.toLowerCase().includes(q) || inResp || inBody;
    });
  }, [spec.endpoints, search, methodFilter]);

  function toggleRow(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function copyText(key, text) {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(''), 1800);
  }

  function downloadYaml() {
    const blob = new Blob([rawYaml], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sendemail-openapi.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }

  const methodStyle = (m) => {
    const map = {
      GET: { bg: '#dcfce7', fg: '#15803d' },
      POST: { bg: '#dbeafe', fg: '#1d4ed8' },
      PUT: { bg: '#fef3c7', fg: '#b45309' },
      DELETE: { bg: '#fee2e2', fg: '#b91c1c' }
    };
    const c = map[m] || { bg: '#f1f5f9', fg: '#334155' };
    return { background: c.bg, color: c.fg, padding: '4px 10px', borderRadius: 6, fontWeight: 700, fontSize: 12, minWidth: 56, textAlign: 'center', fontFamily: 'monospace' };
  };

  const statusColor = (code) => {
    if (code.startsWith('2')) return '#16a34a';
    if (code === '402' || code === '429') return '#dc2626';
    return '#d97706';
  };

  const card = { background: '#fff', padding: 22, borderRadius: 12, boxShadow: '0 2px 10px rgba(15,23,42,.04)' };
  const miniBtn = { padding: '4px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' };

  if (loading) return <div style={card}>Loading live OpenAPI 3.0 specification from <code>/api/v1/openapi.yaml</code>...</div>;
  if (err) return <div style={{ ...card, color: '#dc2626' }}>Failed to load OpenAPI spec: {err}</div>;

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 16, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{spec.info.title}</h3>
            <span style={{ padding: '2px 8px', borderRadius: 999, background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 700 }}>OAS 3.0.3 · v{spec.info.version}</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569' }}>{spec.info.description}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setShowRaw(!showRaw)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: showRaw ? '#0f172a' : '#f8fafc', color: showRaw ? '#fff' : '#334155', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {showRaw ? 'Interactive View' : 'View Raw YAML'}
          </button>
          <button type="button" onClick={downloadYaml} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Download openapi.yaml
          </button>
        </div>
      </div>

      {spec.servers.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {spec.servers.map((s) => (
            <div key={s.url} style={{ padding: '6px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12 }}>
              <strong style={{ color: '#334155' }}>{s.description || 'Server'}:</strong>{' '}
              <code style={{ color: '#2563eb' }}>{s.url}</code>
            </div>
          ))}
        </div>
      )}

      {showRaw ? (
        <pre style={{ margin: 0, padding: 16, background: '#0f172a', color: '#e2e8f0', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto', maxHeight: 540 }}>
          <code>{rawYaml}</code>
        </pre>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search endpoints, payload fields, or status codes (e.g. /send, template_id, 402)..."
              style={{ flex: 1, minWidth: 260, padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {['ALL', 'GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethodFilter(m)}
                  style={{
                    padding: '7px 11px',
                    borderRadius: 8,
                    border: 0,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    background: methodFilter === m ? '#2563eb' : '#f1f5f9',
                    color: methodFilter === m ? '#fff' : '#475569'
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No matching API endpoints found.</div>
            )}
            {filtered.map((ep) => {
              const isOpen = !!expanded[ep.id];
              const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.sendemail.ai';
              const bodySnippet = ep.requestBodyJson
                ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${ep.requestBodyJson.replace(/'/g, "'\\''")}'`
                : '';
              const curlCmd = ep.public
                ? `curl -i "${origin}/api/v1${ep.path}"`
                : `curl -i -X ${ep.method} "${origin}/api/v1${ep.path}" \\\n  -H "Authorization: Bearer se_live_your_api_key_here"${bodySnippet}`;

              return (
                <div key={ep.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => toggleRow(ep.id)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', background: isOpen ? '#f8fafc' : '#fff', cursor: 'pointer', flexWrap: 'wrap' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={methodStyle(ep.method)}>{ep.method}</span>
                      <code style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>/api/v1{ep.path}</code>
                      <span style={{ fontSize: 13, color: '#475569' }}>{ep.summary}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {ep.requestBodyJson && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>
                          JSON Body
                        </span>
                      )}
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: ep.public ? '#dcfce7' : '#f1f5f9', color: ep.public ? '#15803d' : '#475569', fontWeight: 600 }}>
                        {ep.public ? 'Public' : 'Bearer Auth'}
                      </span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ padding: '14px 16px', borderTop: '1px solid #e2e8f0', background: '#fff', fontSize: 13 }}>
                      {ep.params.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 12, color: '#334155', marginBottom: 6 }}>Path Parameters</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {ep.params.map((p) => (
                              <span key={p} style={{ padding: '4px 10px', borderRadius: 6, background: '#fef3c7', color: '#92400e', fontFamily: 'monospace', fontSize: 12 }}>
                                {p} <span style={{ fontFamily: 'sans-serif', fontWeight: 600 }}>(string, required)</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {ep.requestBodyJson && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Request Body</span>
                              <code style={{ fontSize: 11.5, color: '#2563eb', background: '#eff6ff', padding: '1px 6px', borderRadius: 4 }}>application/json</code>
                              <span style={{ fontSize: 11, color: ep.requestRequired ? '#dc2626' : '#64748b', fontWeight: 600 }}>
                                {ep.requestRequired ? 'required' : 'optional'}
                              </span>
                            </div>
                            <button type="button" onClick={() => copyText(`${ep.id}:body`, ep.requestBodyJson)} style={miniBtn}>
                              {copiedId === `${ep.id}:body` ? 'Copied JSON!' : 'Copy JSON'}
                            </button>
                          </div>
                          <pre style={{ margin: 0, padding: 12, background: '#f8fafc', color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto' }}>
                            <code>{ep.requestBodyJson}</code>
                          </pre>
                        </div>
                      )}

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#334155', marginBottom: 6 }}>HTTP Responses</div>
                        {ep.responses.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {ep.responses.map((r) => (
                              <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ padding: '2px 8px', borderRadius: 6, background: statusColor(r.code), color: '#fff', fontWeight: 700, fontSize: 11.5, fontFamily: 'monospace' }}>{r.code}</span>
                                <span style={{ color: '#334155', fontSize: 12.5 }}>{r.description}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: 12 }}>200 OK — Standard JSON response</span>
                        )}
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Quick cURL Example</span>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={() => copyText(`${ep.id}:curl`, curlCmd)} style={miniBtn}>
                              {copiedId === `${ep.id}:curl` ? 'Copied cURL!' : 'Copy cURL'}
                            </button>
                            {onOpenPlayground && (
                              <button type="button" onClick={onOpenPlayground} style={{ padding: '4px 10px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                                Try in API Playground →
                              </button>
                            )}
                          </div>
                        </div>
                        <pre style={{ margin: 0, padding: 10, background: '#0f172a', color: '#e2e8f0', borderRadius: 8, fontSize: 12, lineHeight: 1.45, overflowX: 'auto' }}>
                          <code>{curlCmd}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
