# AION — Adaptive Intelligence Operating Nexus

> **The kernel is not a wrapper. The kernel is enforced.**
> Every reply passes through a 7-law check and resolves to COMMIT / DEFER / REJECT.

A production-shape agentic runtime that:

- Implements the **7 Prime Operating Laws** of the AION kernel on every turn.
- Resolves every response to a **decision state** with full evidence trail.
- Streams tokens from a **provider-agnostic** LLM router with live failover.
- Ships as a **PWA** with install, offline shell, TTS, voice input, and file upload.
- Audits every decision, attempt, and error to a JSONL log.

No stubs. No fake completion. Every claim has a code path behind it.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Frontend (PWA)                                                    │
│  /workspace/aion/backend/static/                                   │
│   - index.html, styles.css, app.js                                 │
│   - sw.js (service worker, network-first / cache-first)            │
│   - manifest.webmanifest, icon.svg, icon-192/512.png               │
│                                                                    │
│  Deploy: DigitalOcean App Platform (static site)                   │
│   Spec: frontend/do-app.yaml                                       │
└────────────────────────┬───────────────────────────────────────────┘
                         │  fetch (SSE + JSON)
                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                                 │
│  /workspace/aion/backend/                                          │
│   - app/kernel.py   — 7-law enforcement + decision state machine   │
│   - app/llm.py      — provider-agnostic streaming router           │
│   - app/audit.py    — append-only JSONL audit log                  │
│   - app/main.py     — FastAPI app + SSE + CORS                     │
│   - app/settings.py — pydantic-settings, env-only config           │
│                                                                    │
│  Deploy: Render (Docker or native Python)                          │
│   Spec: backend/render.yaml                                        │
└────────────────────────┬───────────────────────────────────────────┘
                         │  HTTPS, OpenAI-compatible
                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  LLM Providers (priority chain with auto-failover)                 │
│  1. Moonshot / Kimi (api.moonshot.ai)          [optional key]      │
│  2. NVIDIA NIM (integrate.api.nvidia.com)      [11-key pool]       │
│  3. OpenRouter (openrouter.ai/api/v1)         [Kimi, Grok,        │
│                                                Qwen, DeepSeek,     │
│                                                Claude, Gemini]     │
│  4. Bitdeer AI (api-inference.bitdeer.ai)      [optional key]      │
│  5. Cloudflare Workers AI (per-account)        [optional key]      │
│  6. OpenAI direct (api.openai.com)             [optional key]      │
└────────────────────────────────────────────────────────────────────┘
```

---

## Quick start (local dev)

```bash
# 1. Install Python deps
cd backend
pip install --break-system-packages -r requirements.txt

# 2. Copy env example and fill in at least one provider key
cp .env.example .env
$EDITOR .env

# 3. Run
uvicorn app.main:app --host 127.0.0.1 --port 8765

# 4. Open
open http://127.0.0.1:8765
```

## Quick start (local E2E)

```bash
# install playwright browser deps (one-time)
# chromium binary lives in ~/.cache/ms-playwright/chromium-1223/chrome-linux/chrome

# server already running on 127.0.0.1:8765
node scripts/e2e.mjs
# 32/32 checks expected
```

---

## Deployment

### Backend → Render

1. Push the repo to GitHub.
2. Render → New → Blueprint → point at `backend/render.yaml`.
3. In the Render dashboard, set `OPENROUTER_API_KEY` (and any other provider keys) in Environment.
4. Manual deploy. Health check at `/healthz`. Live probe at `/readyz`.

### Frontend → DigitalOcean App Platform

```bash
doctl apps create --spec frontend/do-app.yaml
```

The static site reads the backend URL from the `Settings` panel in the UI
(field "Backend URL"). Default is same-origin; for split deploys paste
your Render URL.

---

## The 7 Prime Operating Laws

Enforced in `app/kernel.py` on every user turn. The system prompt sent
to the LLM is constructed from the live state of these checks.

| # | Law         | What it prevents                                  |
|---|-------------|---------------------------------------------------|
| 1 | REALITY     | Hallucinated absolutes, ungrounded guarantees     |
| 2 | CONTINUITY  | Random context, broken conversation threads       |
| 3 | FIDELITY    | Architecture breaches, kernel bypass attempts     |
| 4 | LATTICE     | Disconnected reasoning, signal-less replies       |
| 5 | EPISTEMIC   | Conflating observation / inference / speculation |
| 6 | PERPETUITY  | One-off outputs that can't be reused              |
| 7 | DECISION    | Fence-sitting, undelivered answers                |

The 8-step decision protocol runs alongside the laws:

1. goal_identification
2. constraint_analysis
3. uncertainty_estimation
4. risk_evaluation
5. leverage_detection
6. reversibility_check
7. evidence_strength
8. downstream_consequences

…and resolves to **COMMIT**, **DEFER**, or **REJECT**.

---

## API surface

| Endpoint | Method | Notes |
|---|---|---|
| `/healthz` | GET | Liveness |
| `/readyz` | GET | Liveness + live provider probe |
| `/api/decision` | POST | Run the kernel on a user input, return decision + system prompt |
| `/api/chat` | POST | SSE stream of decision → attempts → deltas → done |
| `/api/models` | GET | Configured model chain + provider health |
| `/api/continuity-pack` | GET | The AION identity signature (portable) |
| `/api/audit/recent?n=50` | GET | Last N audit events |
| `/api/tts` | POST | TTS intent endpoint (browser uses Web Speech API directly) |

---

## Frontend feature surface

- ChatGPT-style dark UI
- Streaming responses (SSE) with live cursor
- Per-message **Copy / Download / Speak / Delete** actions
- **File upload** — paperclip button, drag-and-drop, paste from clipboard
  - Images → sent as `image_url` multimodal content blocks
  - Text/JSON/MD → embedded as fenced blocks in the user message
- **Download thread** — topbar button → MD or JSON
- **Sidebar** — new chat, click to switch, per-conv delete
- **Kernel status panel** — live provider health, model chain, 7 laws, 8-step protocol
- **Settings panel** — temperature, max tokens, voice + rate, auto-TTS, backend URL
- **TTS** — Web Speech API (zero server cost, zero key)
- **Voice input** — Web Speech API recognition with interim results
- **PWA** — manifest, service worker, installable
- **Responsive** — desktop + mobile, collapsible sidebar

---

## Key rotation

For providers with tight rate limits (NVIDIA NIM, Bitdeer), set a
comma-separated pool and the router round-robins across keys:

```bash
NVIDIA_API_KEY=nvapi-AAA,nvapi-BBB,nvapi-CCC
BITDEER_API_KEY=sk-bd-AAA,sk-bd-BBB
```

The router uses each key in turn and records attempts in the audit log.
Auth failures on a key naturally rotate to the next on the next call.

---

## Security

- All keys come from env vars. No hardcoded secrets in code.
- `.env` is git-ignored (see `.gitignore`).
- CORS is wide-open by default (`*`); lock down `CORS_ORIGINS` for production.
- The audit log is append-only; the audit dir is mounted as a Render disk for persistence.
- No `eval` or `innerHTML` writes that aren't from the LLM (the LLM output
  is escaped via `escapeHtml` in the renderer).
- File uploads are size- and type-validated client-side AND server-side.

---

## Files of interest

- `backend/app/kernel.py` — 7 laws + decision protocol (the actual kernel)
- `backend/app/llm.py` — provider router with failover
- `backend/app/main.py` — FastAPI app
- `backend/static/app.js` — the entire frontend client
- `scripts/e2e.mjs` — Playwright E2E (32 checks)
- `scripts/make_icons.py` — PWA icon generator
- `artifacts/` — E2E screenshots + JSON report

---

## Status

- ✅ Kernel implemented and enforced
- ✅ 6 LLM providers wired (2 live, 4 ready-when-keyed)
- ✅ Streaming SSE chat with live failover
- ✅ PWA install + offline shell
- ✅ TTS + voice input
- ✅ File upload (multimodal for images, embedded for text)
- ✅ Per-message + per-thread download
- ✅ Per-message + per-conversation delete
- ✅ Kernel status panel
- ✅ E2E Playwright suite (32/32 passing)
- ✅ Backend ready for Render deploy (`render.yaml`)
- ✅ Frontend ready for DigitalOcean deploy (`frontend/do-app.yaml`)
