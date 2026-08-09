// Screenshot all 5 skins via Playwright with proper localStorage
// pre-injection. Each skin gets a clean user-data-dir so the boot
// never carries over state from a previous run.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'https://aion-frontend-flu8n.ondigitalocean.app/';
const OUT = '/workspace/aion-frontend-git/docs/screenshots-v2.8.8';
mkdirSync(OUT, { recursive: true });

const SKINS = [
  { id: 'default',       file: 'skin-1-default.png' },
  { id: 'umbrella-corp', file: 'skin-2-umbrella-corp.png' },
  { id: 'cyberdine',     file: 'skin-3-cyberdine.png' },
  { id: 'retro95',       file: 'skin-4-retro95.png' },
  { id: 'capybara',      file: 'skin-5-capybara.png' },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const skin of SKINS) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // Block the service worker so the screenshot is always fresh
  await page.route('**/sw.js', (route) => route.abort());
  // Block the health check so the API-key-required dialog never opens
  await page.route('**/healthz', (route) => route.fulfill({ status: 200, body: '{"ok":true}' }));
  // First visit: set localStorage AND a fake API key so the welcome
  // state renders instead of the Settings auto-open dialog.
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => {
    localStorage.setItem('aion.skin.v1', id);
    localStorage.setItem('aion.settings.v2', JSON.stringify({ skin: id }));
    // Fake API key — only used client-side to suppress the gate.
    // The key doesn't have to be valid; we just need the front-end
    // to think one is configured.
    localStorage.setItem('aion.apiKey.local', 'aion_screenshot_demo_key_not_real');
  }, skin.id);
  // Reload with both the skin + demo flag for defense in depth
  await page.goto(`${URL}?skin=${skin.id}&demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.brand-mark', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const path = `${OUT}/${skin.file}`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✓ ${skin.id.padEnd(14)} → ${path}`);
  await context.close();
}

await browser.close();
console.log('done');
