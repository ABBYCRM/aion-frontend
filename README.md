# AION frontend 2.1

Static Progressive Web App for the authenticated AION backend.

## Security defaults

- The API origin is locked by `config.js`; users cannot redirect the API key to
  an arbitrary server unless a build explicitly enables custom origins.
- The API key remains in `sessionStorage`.
- Chat-history persistence is off by default. When enabled, GitHub file contents
  are excluded from stored tool history.
- Notes are excluded from model context by default and require explicit opt-in.
- Attachments are bounded by count, per-file size, and aggregate bytes.
- The deployment spec delivers CSP and anti-framing headers; API traffic is
  never handled by the service-worker cache.

The production backend origin appears in `config.js`, `index.html`, and
`.do/app.yaml`. Update all three together if the backend domain changes.
