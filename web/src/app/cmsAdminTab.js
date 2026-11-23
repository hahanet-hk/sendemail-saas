'use client';
import { useState, useEffect, useCallback } from 'react';

const SUB_TABS = [
  { id: 'vault', label: '金鑰與 Cloudflare 設定' },
  { id: 'cms', label: '多語言與網頁 CMS' },
  { id: 'seo', label: 'SEO 與 Schema.org 編輯器' },
  { id: 'currencies', label: '多幣別與定價管理' },
];

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 };
const inp = { width: '100%', padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
const btn = { padding: '7px 14px', borderRadius: 6, border: 'none', background: '#0f172a', color: '#fff', fontSize: 13, cursor: 'pointer' };

export default function CmsAdminTab() {
  const [sub, setSub] = useState('vault');
  const [msg, setMsg] = useState('');
  const [settings, setSettings] = useState([]);
  const [edits, setEdits] = useState({});
  const [cfDiag, setCfDiag] = useState(null);
  const [locales, setLocales] = useState([]);
  const [newLoc, setNewLoc] = useState({ locale_code: '', label: '', default_currency: 'USD', sort_order: 40 });
  const [pages, setPages] = useState([]);
  const [selSlug, setSelSlug] = useState('home');
  const [selLoc, setSelLoc] = useState('en');
  const [pForm, setPForm] = useState({ seo_title: '', seo_description: '', og_image_url: '', schema_jsonld: '{}', content_blocks: '{}' });
  const [currencies, setCurrencies] = useState([]);
  const [newCur, setNewCur] = useState({
    currency_code: '', symbol: '', exchange_rate_to_usd: '1.000000',
    plan_prices: '{"free":0,"starter":29,"growth":99,"enterprise":399}',
    topup_prices: '{"pack_10k":15,"pack_50k":60,"pack_200k":199}',
  });

  const loadAll = useCallback(async () => {
    const [sR, lR, pR, cR] = await Promise.all([
      fetch('/api/v1/superadmin/settings'),
      fetch('/api/v1/superadmin/cms/locales'),
      fetch('/api/v1/superadmin/cms/pages'),
      fetch('/api/v1/superadmin/currencies'),
    ]);
    if (sR.ok) { const j = await sR.json(); setSettings(j.settings || []); }
    if (lR.ok) { const j = await lR.json(); setLocales(j.locales || []); }
    if (pR.ok) { const j = await pR.json(); setPages(j.pages || []); }
    if (cR.ok) { const j = await cR.json(); setCurrencies(j.currencies || []); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const found = pages.find((p) => p.page_slug === selSlug && p.locale_code === selLoc);
    if (found) {
      setPForm({
        seo_title: found.seo_title || '',
        seo_description: found.seo_description || '',
        og_image_url: found.og_image_url || '',
        schema_jsonld: JSON.stringify(found.schema_jsonld || {}, null, 2),
        content_blocks: JSON.stringify(found.content_blocks || {}, null, 2),
      });
    } else {
      setPForm({ seo_title: '', seo_description: '', og_image_url: '', schema_jsonld: '{}', content_blocks: '{}' });
    }
  }, [selSlug, selLoc, pages]);

  async function saveSettings() {
    const payload = Object.entries(edits).map(([setting_key, value]) => {
      const orig = settings.find((s) => s.setting_key === setting_key);
      return { setting_key, setting_group: orig?.setting_group || 'general', value, is_secret: orig?.is_secret ? 1 : 0 };
    });
    if (!payload.length) return setMsg('無修改項目');
    const r = await fetch('/api/v1/superadmin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: payload }),
    });
    if (r.ok) { setEdits({}); setMsg('AES-256-GCM 加密設定已儲存並清除快取'); loadAll(); }
  }

  async function testCloudflare() {
    setMsg('正在驗證 Cloudflare Token 與 DNS...');
    const r = await fetch('/api/v1/superadmin/settings/test-cloudflare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloudflare_api_token: edits.cloudflare_api_token,
        cloudflare_zone_id: edits.cloudflare_zone_id,
      }),
    });
    const j = await r.json();
    setCfDiag(j.diagnostics || j);
    setMsg(j.ok ? 'Cloudflare 連線與權限驗證通過' : (j.error || 'Cloudflare 驗證失敗'));
  }

  async function savePage() {
    try {
      const r = await fetch('/api/v1/superadmin/cms/pages', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_slug: selSlug, locale_code: selLoc,
          seo_title: pForm.seo_title, seo_description: pForm.seo_description, og_image_url: pForm.og_image_url,
          schema_jsonld: JSON.parse(pForm.schema_jsonld),
          content_blocks: JSON.parse(pForm.content_blocks),
        }),
      });
      if (r.ok) { setMsg(`頁面 [${selSlug} / ${selLoc}] 已儲存`); loadAll(); }
    } catch (e) { setMsg('JSON 格式錯誤: ' + e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => { setSub(t.id); setMsg(''); }}
            style={{ ...btn, background: sub === t.id ? '#2563eb' : '#e2e8f0', color: sub === t.id ? '#fff' : '#1e293b' }}>
            {t.label}
          </button>
        ))}
      </div>
      {msg && <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {sub === 'vault' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong>AES-256-GCM 加密金鑰與系統設定庫</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={testCloudflare} style={{ ...btn, background: '#0284c7' }}>測試 Cloudflare 連線</button>
              <button onClick={saveSettings} style={btn}>儲存加密設定</button>
            </div>
          </div>
          {cfDiag && <pre style={{ background: '#f8fafc', padding: 10, fontSize: 12, borderRadius: 6 }}>{JSON.stringify(cfDiag, null, 2)}</pre>}
          {settings.map((s) => (
            <div key={s.setting_key} style={{ display: 'grid', gridTemplateColumns: '220px 100px 1fr', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <code>{s.setting_key}</code>
              <span style={{ color: '#64748b' }}>{s.setting_group}</span>
              <input style={inp} type={s.is_secret ? 'password' : 'text'}
                placeholder={s.value_masked || '(未設定)'}
                value={edits[s.setting_key] ?? ''}
                onChange={(e) => setEdits({ ...edits, [s.setting_key]: e.target.value })} />
            </div>
          ))}
        </div>
      )}

      {sub === 'cms' && (
        <div style={card}>
          <strong>動態多語言管理（cms_locales）</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 160px 100px 80px auto', gap: 8, margin: '10px 0' }}>
            <input style={inp} placeholder="代碼 (如 ja)" value={newLoc.locale_code} onChange={(e) => setNewLoc({ ...newLoc, locale_code: e.target.value })} />
            <input style={inp} placeholder="名稱 (如 日本語)" value={newLoc.label} onChange={(e) => setNewLoc({ ...newLoc, label: e.target.value })} />
            <input style={inp} placeholder="預設幣別" value={newLoc.default_currency} onChange={(e) => setNewLoc({ ...newLoc, default_currency: e.target.value })} />
            <input style={inp} type="number" value={newLoc.sort_order} onChange={(e) => setNewLoc({ ...newLoc, sort_order: e.target.value })} />
            <button style={btn} onClick={async () => {
              const r = await fetch('/api/v1/superadmin/cms/locales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newLoc) });
              if (r.ok) { setNewLoc({ locale_code: '', label: '', default_currency: 'USD', sort_order: 40 }); setMsg('已新增語系'); loadAll(); }
            }}>新增語系</button>
          </div>
          {locales.map((l) => (
            <div key={l.locale_code} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <span><strong>{l.locale_code}</strong> — {l.label} (預設幣別: {l.default_currency})</span>
              {l.locale_code !== 'en' && <button style={{ ...btn, background: '#dc2626', padding: '3px 8px' }} onClick={async () => {
                await fetch(`/api/v1/superadmin/cms/locales/${l.locale_code}`, { method: 'DELETE' }); loadAll();
              }}>刪除</button>}
            </div>
          ))}
        </div>
      )}

      {sub === 'seo' && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select style={{ ...inp, width: 160 }} value={selSlug} onChange={(e) => setSelSlug(e.target.value)}>
              {['home', 'pricing', 'features', 'security', 'legal'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={{ ...inp, width: 160 }} value={selLoc} onChange={(e) => setSelLoc(e.target.value)}>
              {locales.map((l) => <option key={l.locale_code} value={l.locale_code}>{l.locale_code} ({l.label})</option>)}
            </select>
            <button style={btn} onClick={savePage}>儲存頁面與 JSON-LD</button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={inp} placeholder="SEO Title" value={pForm.seo_title} onChange={(e) => setPForm({ ...pForm, seo_title: e.target.value })} />
            <input style={inp} placeholder="SEO Description" value={pForm.seo_description} onChange={(e) => setPForm({ ...pForm, seo_description: e.target.value })} />
            <input style={inp} placeholder="OG Image URL" value={pForm.og_image_url} onChange={(e) => setPForm({ ...pForm, og_image_url: e.target.value })} />
            <label style={{ fontSize: 12, color: '#475569' }}>Schema.org JSON-LD：</label>
            <textarea style={{ ...inp, height: 110, fontFamily: 'monospace' }} value={pForm.schema_jsonld} onChange={(e) => setPForm({ ...pForm, schema_jsonld: e.target.value })} />
            <label style={{ fontSize: 12, color: '#475569' }}>頁面內容區塊 JSON（content_blocks）：</label>
            <textarea style={{ ...inp, height: 110, fontFamily: 'monospace' }} value={pForm.content_blocks} onChange={(e) => setPForm({ ...pForm, content_blocks: e.target.value })} />
          </div>
        </div>
      )}

      {sub === 'currencies' && (
        <div style={card}>
          <strong>動態多幣別與自訂定價矩陣</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 80px 120px 1fr 1fr auto', gap: 8, margin: '10px 0' }}>
            <input style={inp} placeholder="EUR" value={newCur.currency_code} onChange={(e) => setNewCur({ ...newCur, currency_code: e.target.value })} />
            <input style={inp} placeholder="€" value={newCur.symbol} onChange={(e) => setNewCur({ ...newCur, symbol: e.target.value })} />
            <input style={inp} placeholder="匯率對USD" value={newCur.exchange_rate_to_usd} onChange={(e) => setNewCur({ ...newCur, exchange_rate_to_usd: e.target.value })} />
            <input style={inp} value={newCur.plan_prices} onChange={(e) => setNewCur({ ...newCur, plan_prices: e.target.value })} />
            <input style={inp} value={newCur.topup_prices} onChange={(e) => setNewCur({ ...newCur, topup_prices: e.target.value })} />
            <button style={btn} onClick={async () => {
              try {
                const r = await fetch('/api/v1/superadmin/currencies', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...newCur, plan_prices: JSON.parse(newCur.plan_prices), topup_prices: JSON.parse(newCur.topup_prices) }),
                });
                if (r.ok) { setMsg('已新增幣別'); loadAll(); }
              } catch (e) { setMsg('定價 JSON 格式錯誤'); }
            }}>新增幣別</button>
          </div>
          {currencies.map((c) => (
            <div key={c.currency_code} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <strong>{c.currency_code} ({c.symbol})</strong> · 匯率: {c.exchange_rate_to_usd} · 方案: <code>{JSON.stringify(c.plan_prices)}</code> · 點數包: <code>{JSON.stringify(c.topup_prices)}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
