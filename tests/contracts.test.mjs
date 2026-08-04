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
