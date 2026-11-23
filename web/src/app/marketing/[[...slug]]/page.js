import MarketingClient from '../MarketingClient';

const API = 'http://sendemail-api:8096';
async function fetchCms(slug, lang) {
  const res = await fetch(`${API}/api/v1/public/cms?slug=${encodeURIComponent(slug)}&locale=${encodeURIComponent(lang)}`, { cache: 'no-store' });
  return res.ok ? res.json() : { ok: true, locale: lang, default_currency: 'USD', locales: [], currencies: [], page: null };
}

export async function generateMetadata({ params, searchParams }) {
  const p = await params; const sp = await searchParams;
  const slug = p?.slug?.[0] || 'home'; const lang = sp?.lang || 'en';
  const data = await fetchCms(slug, lang);
  const path = slug === 'home' ? '/' : `/${slug}`;
  const langs = Object.fromEntries((data.locales || []).map((l) => [l.locale_code, `https://www.sendemail.ai${path}?lang=${l.locale_code}`]));
  return {
    title: data.page?.seo_title || 'SendEmail.ai',
    description: data.page?.seo_description || 'Enterprise Email API & Automation',
    alternates: { canonical: `https://www.sendemail.ai${path}`, languages: langs },
  };
}

export default async function MarketingPage({ params, searchParams }) {
  const p = await params; const sp = await searchParams;
  const slug = p?.slug?.[0] || 'home'; const lang = sp?.lang || 'en';
  const data = await fetchCms(slug, lang);
  const orgSchema = { '@context': 'https://schema.org', '@type': 'Organization', name: 'SendEmail.ai', url: 'https://www.sendemail.ai' };
  const schemas = data.page?.schema_jsonld ? [orgSchema, data.page.schema_jsonld] : [orgSchema];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemas) }} />
      <MarketingClient initialData={data} currentSlug={slug} />
    </>
  );
}
