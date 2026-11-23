export default function robots() {
  return {
    rules: [
      { userAgent: '*', allow: ['/', '/pricing', '/features', '/security', '/docs'], disallow: ['/api/', '/dns-share/'] },
    ],
    sitemap: 'https://www.sendemail.ai/sitemap.xml',
  };
}
