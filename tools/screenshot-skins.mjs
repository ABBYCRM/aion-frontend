// Capture a screenshot of each of the 5 AION skins in their actual
// rendered state. The PWA lives at https://aion-frontend-flu8n.on...
// and the skin is applied via `document.documentElement.dataset.skin`
// which styles-skins.css reacts to.
//
// We hit the live PWA, set localStorage.aion.skin.v1 to the skin id
// we're capturing, then reload so styles-skins.css binds to the
// right [data-skin="..."] block. We take a 1280x900 desktop screenshot
// of the welcome state (no auth required to view the shell).
//
// All 5 screenshots land in /workspace/aion-frontend-git/docs/screenshots-v2.8.8/

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'https://aion-frontend-flu8n.ondigitalocean.app/';
const OUT = '/workspace/aion-frontend-git/docs/screenshots-v2.8.8';
mkdirSync(OUT, { recursive: true });

const SKINS = [
  { id: 'default',       file: 'skin-1-default.png',       label: 'AION Z.ai (default)' },
  { id: 'umbrella-corp', file: 'skin-2-umbrella-corp.png', label: 'Umbrella Corp' },
  { id: 'cyberdine',     file: 'skin-3-cyberdine.png',     label: 'Cyberdine' },
  { id: 'retro95',       file: 'skin-4-retro95.png',       label: 'Retro 95' },
  { id: 'capybara',      file: 'skin-5-capybara.png',      label: 'Capybara' },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  userAgent: 'AION-SkinScreenshot/1.0 (Playwright)',
});
const page = await context.newPage();

for (const skin of SKINS) {
  // Pre-set the skin so the very first paint is already themed.
  await context.clearCookies();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => {
    localStorage.setItem('aion.skin.v1', id);
    localStorage.setItem('aion.settings.v2', JSON.stringify({ skin: id }));
  }, skin.id);
  // Reload so the page boots with the skin already active.
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Wait for the brand mark + welcome text to confirm the shell rendered.
  await page.waitForSelector('.brand-mark', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const path = `${OUT}/${skin.file}`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✓ ${skin.label.padEnd(20)} → ${path}`);
}

await browser.close();
console.log('done');
