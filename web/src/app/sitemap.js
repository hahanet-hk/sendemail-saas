export default async function sitemap() {
  const routes = ['', '/pricing', '/features', '/security', '/docs'];
  return routes.map((r) => ({ url: `https://www.sendemail.ai${r}`, lastModified: new Date(), changeFrequency: 'weekly', priority: r === '' ? 1.0 : 0.8 }));
}
