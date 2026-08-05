# AION frontend 2.4.0

Static Progressive Web App for the authenticated AION backend.
Pairs with `aion-backend-v2` (Python) and `Aion-Brain` (Node.js
decision kernel). AION is the heavy lifter — the frontend only ever
talks to the AION Python backend. Aion-Brain is server-side; the
frontend never knows about it.

## Backend origin (triple-locked)

The AION Python backend origin is set in **three places**. Update
all three together if the backend domain changes.

| File | Field |
|------|-------|
| `config.js` | `window.AION_CONFIG.apiBase` |
| `index.html` | `<meta http-equiv="Content-Security-Policy" content="... connect-src 'self' https://<origin> ...">` |
| `.do/app.yaml` | static-site `headers` for `Content-Security-Policy` |

The DO App Platform also serves the same `Content-Security-Policy`
header from the static site spec — so the browser sees it from both
the meta tag and the HTTP header, with the same value.

`Aion-Brain` is **not** in the frontend's allowlist. The frontend
talks to the AION Python backend; AION talks to Aion-Brain via
`AION_BRAIN_URL` (server-side only). The frontend never makes a
direct call to Brain.

## Security defaults

- The API origin is locked by `config.js`; users cannot redirect
  the API key to an arbitrary server unless a build explicitly
  enables custom origins (`allowCustomApiBase: true`).
- The API key is stored in `localStorage` (persists across tab
  close) with an opt-in "Forget on close" toggle that switches it
  to `sessionStorage`.
- Chat-history persistence is off by default. When enabled, GitHub
  file contents are excluded from stored tool history.
- Notes are excluded from model context by default and require
  explicit opt-in.
- Attachments are bounded by count, per-file size, and aggregate
  bytes.
- The deployment spec delivers CSP and anti-framing headers; API
  traffic is never handled by the service-worker cache.

## Local dev (chat-only Brain target)

Set `allowCustomApiBase: true` in `config.js` **only for local
dev** to point the API origin at a Brain instance for chat-only
smoke tests. Media / Notes / GitHub / Vault will not work
against Brain (those live on AION). Never enable this flag in
a production DO build.

## Live

- Production frontend: https://aion-frontend-flu8n.ondigitalocean.app
- Production backend:  https://aion-backend-v2-jszgl.ondigitalocean.app
