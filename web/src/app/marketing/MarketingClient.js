'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MarketingClient({ initialData, currentSlug }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(initialData.default_currency || 'USD');
  const { locale, locales = [], currencies = [], page } = initialData;
  const blocks = page?.content_blocks || {};
  const cur = currencies.find((c) => c.currency_code === currency) || currencies[0] || { symbol: '$', plan_prices: {} };
  const base = currentSlug === 'home' ? '/' : `/${currentSlug}`;
  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#f8fafc', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 1100, margin: '0 auto 40px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href={`/?lang=${locale}`} style={{ fontWeight: 800, fontSize: 20, color: '#38bdf8', textDecoration: 'none' }}>SendEmail.ai</a>
          {['home', 'features', 'pricing', 'security', 'docs'].map((s) => (
            <a key={s} href={`${s === 'home' ? '/' : '/' + s}?lang=${locale}`} style={{ color: currentSlug === s ? '#38bdf8' : '#cbd5e1', textDecoration: 'none', fontSize: 14 }}>{s.toUpperCase()}</a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={locale} onChange={(e) => router.push(`${base}?lang=${e.target.value}`)} style={{ background: '#0f172a', color: '#fff', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px' }}>
            {locales.map((l) => <option key={l.locale_code} value={l.locale_code}>{l.label}</option>)}
          </select>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ background: '#0f172a', color: '#fff', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px' }}>
            {currencies.map((c) => <option key={c.currency_code} value={c.currency_code}>{c.currency_code} ({c.symbol})</option>)}
          </select>
          <a href="https://app.sendemail.ai" style={{ background: '#0284c7', color: '#fff', padding: '6px 12px', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>Console</a>
        </div>
      </header>
      <main style={{ maxWidth: 1000, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 38, fontWeight: 800 }}>{blocks.hero_title || blocks.title || page?.seo_title}</h1>
        <p style={{ color: '#94a3b8', fontSize: 17, marginBottom: 32 }}>{blocks.hero_subtitle || blocks.subtitle || page?.seo_description}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {['free', 'starter', 'growth', 'enterprise'].map((t) => (
            <div key={t} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 20 }}>
              <div style={{ color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}>{t}</div>
              <div style={{ fontSize: 28, fontWeight: 800, margin: '10px 0' }}>{cur.symbol}{cur.plan_prices?.[t] ?? 0}</div>
              <a href="https://app.sendemail.ai" style={{ color: '#fff', background: '#1e293b', display: 'block', padding: 8, borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>Start</a>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
