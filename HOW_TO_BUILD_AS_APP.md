# DUCKi → Real App: Backend & True Agentic Architecture
### A meta-systems blueprint (the version that has a real backend, 100-tool agentic flow, and browser automation)

> Authored as a build spec. The current live app is a **static GitHub Pages site** —
> powerful but sandboxed. Browser automation (Playwright/Selenium), shared terminals,
> persistent multi-user state, and unbounded tool loops **require a backend**. This
> document is the exact plan to get there, plus what we already faked cleverly client-side.

---

## 0. Honest constraint map (why a static page hits a wall)

| Capability | Static page (today) | Needs backend |
|---|---|---|
| Call LLM with user's key | ✅ direct fetch | — |
| Read GitHub/Gmail via API | ✅ (CORS-friendly) | — |
| Scrape + **interact** with pages | ✅ via Firecrawl `actions` (our clever win) | Full Playwright control |
| Drive the USER's real browser / logged-in sessions | ❌ | ✅ |
| Shared terminal / pair session | ❌ | ✅ |
| 100-tool autonomous loop w/ retries, queues | ⚠️ limited (runs in tab, dies on refresh) | ✅ durable |
| Multi-user rooms presence/state | ⚠️ P2P only (PeerJS) | ✅ authoritative server |
| Secret storage (API keys safe) | ❌ keys live in localStorage | ✅ server vault |

**Creative middle path we already shipped:** `firecrawl_interact` gives DUCKi click/type/scroll/press/wait
on real pages (executed on Firecrawl's servers) — Playwright-like behavior with zero backend. Use it for
JS sites and forms. It cannot touch the user's *authenticated* sessions; that's the backend's job.

---

## 1. Target architecture (5-layer)

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (PWA)  — current UI, upgraded to talk to our backend │
│   chat · The Duck House (WebRTC) · settings · streaming view │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS + WSS (streaming tokens & tool events)
┌───────────────▼─────────────────────────────────────────────┐
│  API GATEWAY  (Node/Express or FastAPI)                      │
│   auth (JWT) · rate limit · request validation               │
└───────────────┬─────────────────────────────────────────────┘
        ┌───────┴────────┬──────────────┬──────────────┐
┌───────▼──────┐ ┌───────▼──────┐ ┌─────▼─────┐ ┌──────▼───────┐
│ AGENT CORE   │ │ TOOL RUNTIME │ │ SIGNALING │ │ SECRETS VAULT│
│ plan→act loop│ │ Playwright,  │ │ (rooms,   │ │ (per-user    │
│ up to 100    │ │ shell, http, │ │ presence, │ │  encrypted   │
│ steps, retry │ │ files, git   │ │ TURN)     │ │  keys)       │
└───────┬──────┘ └───────┬──────┘ └───────────┘ └──────────────┘
        │                │
┌───────▼──────┐ ┌───────▼──────┐
│  LLM ROUTER  │ │  BROWSER POOL│  (headless Chromium workers)
│ any provider │ │  Playwright  │
│ any model    │ │  contexts    │
└──────────────┘ └──────────────┘
        │
┌───────▼───────────────────────────────────────────────┐
│  STATE: Postgres (history, memory, jobs) + Redis (queue,│
│  presence, pub/sub) + object store (artifacts/screens)  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. The agentic core (real 100-tool flow)

**Problem today:** the loop runs in the browser tab, capped (now 40), dies on refresh, no retries/queue.

**Backend design — a durable ReAct/plan-execute loop:**
1. **Job model.** Every user turn = a `job` row (Postgres) with status `queued→running→done/failed`.
   A worker (BullMQ/Redis) owns it, so closing the tab never kills the work.
2. **Loop:** `while (step < MAX_STEPS && !final)`: call LLM → if tool_calls, run them
   (parallel where independent), append observations, repeat. **MAX_STEPS = 100+**, with:
   - **Per-tool timeout + retry/backoff** (so one flaky call doesn't stall the chain).
   - **Budget guard** (token + wall-clock ceiling) to prevent runaway loops.
   - **Reflection step** every N tools: "are we closer? re-plan." (prevents loop-thrash)
3. **Streaming.** Tokens + each tool start/end stream over **WSS** to the UI (live "DUCKi is clicking…").
4. **Parallel tool calls.** Independent calls (e.g. scrape 10 URLs) run concurrently — this is what
   "call 100 tools" should really mean: breadth + depth, not 100 serial round-trips.

**Suggested stack:** Node 20 + Express + BullMQ + Redis + Postgres (Prisma). Or Python FastAPI + Celery.

---

## 3. Tool runtime (the real hands)

Each tool is a server function with a JSON schema (same shape DUCKi already uses):

- **`browser.*` (Playwright):** `goto, click, type, select, waitFor, screenshot, extract, downloadFile,
  fillForm, loginFlow`. Runs in a **pooled headless Chromium context** per user/session. THIS is the
  real Playwright capability the static page can't have.
- **`shell.run`:** sandboxed command exec (Docker, no network unless whitelisted) for builds/scripts.
- **`fs.*`:** read/write workspace files (per-job temp dir → object store).
- **`git.*`:** clone/commit/push (already prototyped client-side as github_put_file).
- **`http.request`:** arbitrary authenticated API calls.
- **`memory.*`:** durable recall/save (Postgres + vector index for semantic memory).

**Security:** every tool runs with least privilege; shell/browser in disposable containers;
secrets injected at call-time from the vault, never exposed to the model text.

---

## 4. LLM router (fix "locked into 1 model")

A provider-agnostic router so ANY provider + ANY model works, with fallback:
```
POST /llm  { provider, model, messages, tools }
 → adapter(provider).chat(model, ...)   // openai|anthropic|gemini|deepseek|glm|qwen|kimi|openrouter|siliconflow
 → normalize tool_calls across schemas (OpenAI fn-calling vs Gemini functionDeclarations)
 → on 4xx/5xx or no-tool-support: fall back to next configured model
```
- **Model registry** per provider (we already added MODELS presets client-side — server mirrors it).
- **Capability flags:** `supportsTools`, `contextWindow`, `costPer1k` → router picks the cheapest model
  that can do tools for a given job, or honors the user's explicit choice.
- **Streaming normalization:** unify SSE/event formats to one internal stream.

---

## 5. The Duck House (production WebRTC)

Today: PeerJS cloud + public STUN/TURN (we added OpenRelay TURN). Production:
- **Signaling server** (Socket.IO): authoritative room state, presence, join/approve/kick, 6-cap.
- **Own TURN** (coturn) for reliable connectivity behind any firewall.
- **SFU upgrade path:** for >6 or recording, swap mesh → **mediasoup/LiveKit** (server forwards streams;
  scales to many participants without N² connections).
- **Presence service** (Redis pub/sub): who's online app-wide, invite by user, host moderation.

---

## 6. Secrets & auth (do this right)

- **Auth:** email/OAuth → JWT sessions. Per-user accounts.
- **Vault:** user API keys encrypted at rest (libsodium/KMS), decrypted only in the tool runtime at
  call time. **Never** ship keys to the browser again (today's localStorage model is a prototype only).
- **Gmail/Google:** a proper **Google Cloud OAuth app** (consent screen + verification) — this is the
  "$30 / going through Google" wall. With a backend you do the OAuth dance server-side and store refresh
  tokens in the vault. No way around Google's verification for sensitive scopes; budget for it.

---

## 7. Deployment

- **Frontend:** keep the PWA on GitHub Pages / Vercel / Cloudflare Pages.
- **Backend:** Render / Railway / Fly.io / a VPS (Docker Compose) — needs persistent processes for the
  worker queue, browser pool, signaling, and TURN.
- **Data:** managed Postgres + Redis (Render/Upstash). Object store: S3/R2 for artifacts & screenshots.
- **Scale:** browser pool and agent workers scale horizontally; Redis coordinates.

**Minimum viable backend (weekend build):** Node + Express + 1 Postgres + 1 Redis + BullMQ worker +
Playwright + Socket.IO signaling + coturn. That alone unlocks: durable 100-tool agent loop, real browser
automation, streaming, safe secrets, and reliable rooms.

---

## 8. Migration path (no big-bang rewrite)

1. **Phase 1 (done):** static app + Firecrawl `interact`/`extract` as pseudo-automation; client memory; multi-provider.
2. **Phase 2:** stand up the API gateway + LLM router; move the agent loop server-side (durable jobs + streaming). UI keeps working, just points at the backend.
3. **Phase 3:** add Playwright browser pool + shell/fs tools → real automation.
4. **Phase 4:** secrets vault + accounts; move keys off the client.
5. **Phase 5:** production WebRTC (own TURN, optional SFU) + app-wide presence.

---

## 9. What stays clever on the client (so the app degrades gracefully)
- Firecrawl `interact`/`extract` remain useful even with a backend (cheap, fast, no infra).
- Client memory is a great offline cache layer; server memory becomes the source of truth.
- The Duck House P2P mode is a fine fallback when the SFU is overkill (≤6 users).

— End of blueprint —
