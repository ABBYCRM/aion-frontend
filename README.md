# AION frontend

Static PWA client for the authenticated AION backend.

## Runtime configuration

The backend URL lives in one place: `config.js`.

```js
window.AION_CONFIG = Object.freeze({
  apiBase: 'https://your-backend.example.com',
  appVersion: '2.0.0',
});
```

The user enters an AION API key in Settings. It is kept in `sessionStorage`; it is not committed, included in notes, or written into conversation history.

## Features

- SSE chat with visible provider failover errors
- Provider/model pair selection
- Per-turn Brave web search with source cards
- GitHub repository, issue, file, and code-search panel
- Owner-scoped non-secret notes
- Image and text attachments with client and server size limits
- Local text history without storing image payloads
- Versioned service-worker cache that never caches API responses

PDF upload is intentionally absent until a real PDF extraction or provider-file pipeline is implemented. Binary PDFs are not read as text.

## Local development

Serve the repository over HTTP; service workers do not run from `file://`.

```bash
python -m http.server 5173
```

Open `http://localhost:5173`, set the backend URL and API key, and ensure the backend’s `CORS_ORIGINS` contains that exact origin.

## Deployment

`.do/app.yaml` deploys the repository root as a DigitalOcean static site. The JavaScript modules, `config.js`, and `sw.js` use no-cache headers so fixes propagate instead of remaining trapped in the old PWA shell.
