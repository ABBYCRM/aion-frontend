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
