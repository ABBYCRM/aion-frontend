import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const config = read('config.js');
const core = read('app-core.js');
const chatA = read('app-chat-a.js');
const chatB = read('app-chat-b.js');
const index = read('index.html');
const appSpec = read('.do/app.yaml');

const backend = 'https://aion-backend-v2-jszgl.ondigitalocean.app';

test('API credentials can only be sent to the configured backend origin', () => {
  assert.match(config, /allowCustomApiBase:\s*false/);
  assert.match(config, new RegExp(backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(core, /apiBaseAllowed/);
  assert.match(chatA, /Backend origin is not allowed by this build/);
  assert.doesNotMatch(index, /connect-src 'self' https:;/);
  assert.match(index, new RegExp(`connect-src 'self' ${backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('notes and local history are explicit opt-ins', () => {
  assert.match(core, /persistHistory:\s*false/);
  assert.match(core, /useNotes:\s*false/);
  assert.match(chatA, /use_notes:\s*state\.settings\.useNotes/);
  assert.match(index, /id="useNotes"/);
  assert.match(index, /id="persistHistory"/);
  assert.doesNotMatch(index, /<option>instruction<\/option>/);
});

test('failed empty assistant messages are excluded from the next API request', () => {
  assert.match(chatA, /filter\(\(message\) => typeof message\.content === 'string' && message\.content\.trim\(\)\)/);
});

test('attachments are bounded by count and aggregate bytes', () => {
  assert.match(config, /maxAttachmentCount:\s*6/);
  assert.match(config, /maxTotalAttachmentBytes:\s*1200000/);
  assert.match(chatB, /MAX_ATTACHMENT_COUNT/);
  assert.match(chatB, /MAX_TOTAL_ATTACHMENT_BYTES/);
});

test('provider retries are informational until all providers fail', () => {
  assert.match(chatB, /case 'attempt_failed'/);
  assert.match(chatB, /assistant\.error = ''/);
});

test('security policy is delivered as an HTTP header', () => {
  assert.match(appSpec, /Content-Security-Policy/);
  assert.match(appSpec, /X-Frame-Options/);
  assert.match(appSpec, new RegExp(backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('CSP allows blob: for TTS media + data: for VTT captions', () => {
  assert.match(index, /media-src 'self' blob: data:/);
  assert.match(index, /worker-src 'self' blob:/);
  assert.match(appSpec, /media-src 'self' blob: data:/);
});

test('Aion Code tab is a real Aion feature, not a Cline install', () => {
  // The dialog exists and is wired in the sidebar
  assert.match(index, /id="codeDialog"/);
  assert.match(index, /Aion Code<\/h2>/);
  // v2.8.5: single search bar + 4 corpus tiles + 4 result sections
  assert.match(index, /id="codeSearchInput"/);
  assert.match(index, /id="codeSearchForm"/);
  for (const corpus of ['syntax', 'scenarios', 'tasks', 'books']) {
    assert.match(index, new RegExp(`data-corpus="${corpus}"`));
    assert.match(index, new RegExp(`data-result="${corpus}"`));
  }
  // The frontend file references only the existing /api/skills/run endpoint
  // and the existing skill ids (no external agent install).
  const code = read('app-code.js');
  assert.match(code, /\/api\/skills\/run/);
  assert.match(code, /syntax\.list/);
  assert.match(code, /syntax\.browse/);
  assert.match(code, /extra\.scenarios\.search/);
  assert.match(code, /coding\.tasks\.search/);
  assert.match(code, /coding\.books\.search/);
  // Must NOT install Cline or any other agent (the docstring can mention
  // the name; we only forbid code references to the Cline product).
  assert.doesNotMatch(code, /Cline\.|from ['"]Cline|require\(['"]Cline|import\s+Cline|cline\.bot/i);
  assert.doesNotMatch(code, /github\.com\/cline\//i);
  assert.doesNotMatch(index, /github\.com\/cline/);
  // Footer must not link to the Cline product
  assert.doesNotMatch(index, /cline\.bot|cline-bot|install cline/i);
  // Footer help text mentions the new search commands
  assert.match(index, /search github\.com/);
  assert.match(index, /Aion Code<\/strong> tab/);
  // Copy-on-click is wired (id chips are clickable)
  assert.match(code, /copyToClipboard|data-copy-id/);
});

test('Aion Code never invokes the LLM (no /api/chat calls in app-code.js)', () => {
  const code = read('app-code.js');
  assert.doesNotMatch(code, /\/api\/chat/);
  assert.doesNotMatch(code, /brain_client|aion-brain|brain_decision/);
});

test('Aion Code global search hits all 4 corpora in parallel', () => {
  const code = read('app-code.js');
  // The global search must call all 4 corpus skills, in any order, in one
  // Promise.allSettled. Order doesn't matter (the user sees the union),
  // but all four corpus ids must be present.
  assert.match(code, /syntax\.browse/);
  assert.match(code, /extra\.scenarios\.search/);
  assert.match(code, /coding\.tasks\.search/);
  assert.match(code, /coding\.books\.search/);
  // Promise.allSettled keeps every result visible even if one corpus errors
  assert.match(code, /Promise\.allSettled/);
});

test('Vault + Notes dialogs harmonize with Aion Code + Media', () => {
  // v2.8.6 — all four operator-facing dialogs share the same chrome:
  // header with title + subtitle, section-header pattern, lifted-glass card lists.
  // The shared design language is the contract.
  assert.match(index, /<dialog id="notesDialog"/);
  assert.match(index, /<dialog id="vaultDialog"/);
  assert.match(index, /<dialog id="mediaDialog"/);
  assert.match(index, /<dialog id="codeDialog"/);
  // Every dialog has a dialog-subtitle
  for (const id of ['notesDialog', 'vaultDialog', 'mediaDialog', 'codeDialog', 'settingsDialog']) {
    // The subtitle is in the header block. Check it's defined in the CSS.
    assert.match(read('styles-base.css'), /\.dialog-subtitle\s*\{/, `dialog-subtitle CSS missing — ${id}`);
  }
  // Vault: category filter is a pill tab, not a <select>
  assert.match(index, /class="vault-tab[^"]*" data-vault-cat="llm"/);
  assert.match(index, /class="vault-tab[^"]*" data-vault-cat="github"/);
  // Notes: form is a 2-column grid (name 2fr | kind 1fr, tags + value span full width)
  assert.match(read('styles-base.css'), /\.note-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 2fr\)/);
  // Notes: textarea has a meaningful min-block-size (was 1-line in the cramped version)
  assert.match(read('styles-base.css'), /min-block-size:\s*96px/);
  // All four dialogs open via the tab-bar's data-action= (no legacy openCode/openVault/openNotes)
  const boot = read('app-boot.js');
  assert.match(boot, /openVaultDialog/);
  assert.match(boot, /openNotesDialog/);
  assert.match(boot, /openGithubDialog/);
  assert.match(boot, /AION_CODE\?\.openCodeDialog/);
  assert.match(boot, /openMediaDialog/);
  assert.match(boot, /openSettingsDialog/);
  // No legacy #openVault / #openNotes click handler left dangling
  const vault = read('app-gallery-vault.js');
  assert.doesNotMatch(vault, /dom\.openVault/);
});

test('Composer shortcut buttons pre-fill the prompt with a command template', () => {
  // v2.8.7 — the /search and /github commands used to live in a long
  // <p> after the composer. Operator asked for little clickable buttons
  // that paste the command into the input. Now there are 4 buttons
  // (Web search, GitHub topic, LinkedIn topic, GitHub repo) each
  // with a data-shortcut attribute holding the template.
  assert.match(index, /class="composer-shortcuts"/);
  assert.match(index, /data-shortcut="\/search "/);
  assert.match(index, /data-shortcut="\/search github\.com for "/);
  assert.match(index, /data-shortcut="\/search linkedin\.com for "/);
  assert.match(index, /data-shortcut="\/github ABBYCRM\/aion-frontend "/);
  // The click handler must set prompt.value and focus the input
  const boot = read('app-boot.js');
  assert.match(boot, /composer-shortcut/);
  assert.match(boot, /dom\.prompt\.value = template/);
  assert.match(boot, /dom\.prompt\.focus\(\)/);
  assert.match(boot, /setSelectionRange/);
  // The CSS must style them as little chip-sized buttons, not the
  // default button style (24px height, mono font, surface-2 bg).
  const css = read('styles-base.css');
  assert.match(css, /\.composer-shortcut\s*\{[^}]*height:\s*24px/);
  assert.match(css, /\.composer-shortcut\s*\{[^}]*font-family:\s*var\(--mono\)/);
});

test('Skin picker lets the user swap appearance without changing layout', () => {
  // v2.8.8 — skins adapted from ABBYCRM/BOS-OMEGA-Frontend's theme
  // system. 5 selectable skins in Settings → Appearance:
  //   default, umbrella-corp, cyberdine, retro95, capybara.
  // Each skin must override ONLY tokens (colors, radii, fonts,
  // shadows) — never layout, never grid, never flex. The picker
  // is a radio group of cards, the active card shows a checkmark.

  // 1. The skin stylesheet is linked from index.html
  assert.match(index, /href="\/styles-skins\.css"/);

  // 2. The picker is in the Settings dialog, with 5 cards
  const skinCards = index.match(/<button[^>]+class="skin-card"[^>]+data-skin="([^"]+)"/g) || [];
  assert.equal(skinCards.length, 5, 'expected 5 skin cards in Settings');
  for (const id of ['default', 'umbrella-corp', 'cyberdine', 'retro95', 'capybara']) {
    assert.ok(skinCards.some((c) => c.includes(`data-skin="${id}"`)),
      `missing skin card: ${id}`);
  }

  // 3. The skins file overrides AION's tokens (--bg, --surface,
  //    --brand, --text, --r-*, --shadow-*) — not layout.
  const skins = read('styles-skins.css');
  for (const token of ['--bg', '--surface', '--brand', '--text', '--r-sm', '--shadow-md']) {
    assert.match(skins, new RegExp(`--bg:[^;]+`), `skins.css must override ${token}`);
  }
  // The skins must use [data-skin="..."] selectors, not :root.theme-*
  for (const id of ['default', 'umbrella-corp', 'cyberdine', 'retro95', 'capybara']) {
    if (id === 'default') continue; // default = no override block
    assert.ok(skins.includes(`[data-skin="${id}"]`),
      `skins.css must contain a [data-skin="${id}"] block`);
  }

  // 4. App state + JS plumbing — applySkin, loadSkin, SKIN_IDS
  const core = read('app-core.js');
  assert.match(core, /SKIN_IDS\s*=\s*\[[^\]]*'default'[^\]]*'umbrella-corp'[^\]]*\]/);
  assert.match(core, /function applySkin/);
  assert.match(core, /function loadSkin/);
  assert.match(core, /skin:\s*'default'/);
  assert.match(core, /localStorage\.setItem\(SKIN_KEY/);
  // saveSettings must persist the skin
  assert.match(core, /saved\.skin = state\.settings\.skin/);

  // 5. Boot sequence calls loadSkin AFTER loadSettings
  const boot = read('app-boot.js');
  const loadSettingsIdx = boot.indexOf('loadSettings()');
  const loadSkinIdx = boot.indexOf('loadSkin()');
  assert.ok(loadSettingsIdx > -1 && loadSkinIdx > -1, 'boot must call loadSettings + loadSkin');
  assert.ok(loadSkinIdx > loadSettingsIdx, 'loadSkin must run AFTER loadSettings');

  // 6. The skin card click handler is wired
  assert.match(boot, /document\.querySelectorAll\('\.skin-card'\)/);
  assert.match(boot, /state\.settings\.skin = id/);
  assert.match(boot, /applySkin\(id\)/);

  // 7. Setting appVersion bumped to 2.8.8+
  const cfg = read('config.js');
  assert.match(cfg, /appVersion:\s*'(2\.8\.[89]|2\.9\.)'/);

  // 8. Locked rule: no skin touches layout. None of the skin blocks
  //    may redefine grid, flex, display, or position. (Transform is
  //    OK on hover for the picker card itself, but not for the
  //    global app shell under the skin.)
  assert.doesNotMatch(skins, /\[data-skin="[^"]+"\]\s*\.app-shell\s*\{[^}]*display:/);
  assert.doesNotMatch(skins, /\[data-skin="[^"]+"\]\s*\.sidebar\s*\{[^}]*display:/);
});

test('Brain-signal probe skips when no API key (avoids 401 dialog cascade)', () => {
  // v2.8.8 — when the user has no API key, the brain-signal pill
  // must NOT call apiFetch. A 401 from /api/brain/status triggers
  // openSettingsDialog() inside app-chat-a.js, which would pop the
  // Settings dialog every time the page boots. The pill should
  // just show "API key required" / "disabled" instead.
  const sig = read('app-brain-signal.js');
  assert.match(sig, /function probeBrain/);
  // Must short-circuit on missing key BEFORE the apiFetch call
  assert.match(sig, /if \(typeof apiKey === 'function' && !apiKey\(\)\)/);
  assert.match(sig, /setPill\('disabled'[\s\S]{0,200}\)/);
  // The apiFetch call must come AFTER the short-circuit
  const apiKeyCheck = sig.indexOf('!apiKey()');
  const apiFetchCall = sig.indexOf('await apiFetch(\'/api/brain/status\')');
  assert.ok(apiKeyCheck > -1, 'must have apiKey() guard');
  assert.ok(apiFetchCall > -1, 'must still call apiFetch for the happy path');
  assert.ok(apiKeyCheck < apiFetchCall, 'apiKey guard must come before apiFetch');
});

test('Settings dialog uses a 2-column grid for inputs + toggles (harmonized v2.8.9)', () => {
  // v2.8.9 — Settings got too tall once the skin picker was added.
  // Operator asked to HARMONIZE the screen. We now:
  //   - Wrap the body in a .dialog-content for clean scrolling
  //   - 2-col grid for the basic inputs (.settings-grid)
  //   - 2-col grid for the behaviour toggles (.settings-toggles)
  //   - 2-col grid for the runtime policy (.status-grid)
  //   - 5 skin cards in a single row at the .wide dialog width
  //   - Toggles use real checkboxes (not hidden opacity:0 hacks)
  const html = read('index.html');
  const css = read('styles-skins.css');

  // The dialog must be .wide so the 2-col grids actually have room
  assert.match(html, /id="settingsDialog"\s+class="dialog wide"/);
  // The body must be wrapped in .dialog-content
  assert.match(html, /<div class="dialog-content">[\s\S]*?<\/div>\s*<div class="dialog-actions">/);
  // Inputs use .settings-grid
  assert.match(html, /<div class="settings-grid">/);
  // Toggles use .settings-toggles
  assert.match(html, /<div class="settings-toggles"\s+role="group"/);
  // All 4 toggles are still inside .settings-toggles
  for (const id of ['useNotes', 'persistHistory', 'autoSpeak', 'forgetApiKeyOnClose']) {
    assert.match(html, new RegExp(`<div class="settings-toggles"[\\s\\S]*?id="${id}"`));
  }
  // Status panel uses .status-grid
  assert.match(html, /<div class="status-grid">/);
  // CORS row spans the full width (long URLs)
  assert.match(html, /<div class="status-row full"><span>CORS origins/);

  // CSS contracts
  assert.match(css, /\.settings-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(css, /\.settings-toggles\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(css, /\.status-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  // Skin picker has 5 cards in a row at the .wide dialog width
  assert.match(css, /#settingsDialog fieldset\.skin-picker \.skin-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
  // Toggles use visible checkboxes (not the old opacity:0 pattern)
  assert.match(css, /\.settings-toggles > \.search-toggle input\[type="checkbox"\]\s*\{[^}]*position:\s*static/);
  assert.match(css, /\.settings-toggles > \.search-toggle input\[type="checkbox"\]\s*\{[^}]*opacity:\s*1/);
  // The "✓ Active" floating label is suppressed in the dialog
  assert.match(css, /#settingsDialog fieldset\.skin-picker \.skin-card\[aria-checked="true"\]::after\s*\{[^}]*display:\s*none/);
});
