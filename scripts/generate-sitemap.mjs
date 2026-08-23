import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function normalizeSiteUrl(value) {
  const site = String(value || '').trim().replace(/\/$/, '');
  if (!site) return '';
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

function resolveSiteUrl() {
  // Explicit project URL always wins when configured.
  const explicit = normalizeSiteUrl(process.env.PUBLIC_SITE_URL || process.env.VITE_PUBLIC_SITE_URL);
  if (explicit) return explicit;

  // Vercel exposes the canonical production domain and deployment URL automatically.
  const production = normalizeSiteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) return production;

  const deployment = normalizeSiteUrl(process.env.VERCEL_URL);
  if (deployment) return deployment;

  // Fail closed in CI/production: a real canonical domain must be configured.
  if (process.env.CI === 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_SITE_URL (or VERCEL_PROJECT_PRODUCTION_URL) is required to generate a canonical sitemap.');
  }
  // Local development fallback only.
  return 'http://localhost:8080';
}

const site = resolveSiteUrl();
const urls = ['/', '/reserve'];
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
  .map((path) => `  <url><loc>${site}${path}</loc></url>`)
  .join('\n')}\n</urlset>\n`;

writeFileSync(resolve('public/sitemap.xml'), xml, 'utf8');
console.log(`Generated sitemap for ${site}`);
