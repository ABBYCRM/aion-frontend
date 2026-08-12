# Notes

## 2026-08-12 — AION system review (Claude)

Ran a cross-repo health review of the AION system (aion-backend-v2,
aion-frontend, aion-brain) and applied fixes here:

- Fixed stale version header in `README.md` (was `2.4.0`, now matches
  `config.js`'s `2.8.11`).
- Consolidated four independent copies of `escapeHtml()`
  (`app-render-b.js`, `app-gallery-vault.js`, `app-code.js`,
  `app-tools.js`) into a single shared implementation in `app-core.js`,
  using the most correct of the four variants (null/undefined-only
  blanking, no over-blanking of falsy values like `0`/`false`/`''`).
- Removed a duplicate `/app-core.js` entry in `sw.js`'s precache list.
- Deleted `app.js`, confirmed dead (not referenced by `index.html` or
  anything else in the repo).
- Verified: `node --test tests/*.test.mjs` — 19/19 contract tests pass.

Also flagged, but deliberately **not** changed pending independent
verification: `.github/workflows/grok-review.yml` checks out full git
history and curl-pipes-and-runs xAI's Grok Build CLI with a
`pull-requests: write` / `checks: write` token on every PR. A public,
technically-detailed third-party report
(`cereblab/grok-build-exfil-repro`) claims this CLI uploads the entire
repo + history to xAI's cloud regardless of instructions. Unverified —
worth checking independently before continuing to run this workflow.

All changes are on branch `claude/aion-system-analysis-htqn5i`.
