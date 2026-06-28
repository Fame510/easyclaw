# DUCKi — Project Status & Changelog

**App:** DUCKi, by AEON DUX (formerly EasyClaw Console / OpenClaw fork)
**Live URL:** https://fame510.github.io/easyclaw/
**Repo:** Fame510/easyclaw — files served from the `gh-pages` branch
**Owner:** Fame510

> Note: the repository is still named `easyclaw` on purpose. All GitHub URLs,
> AppImage/snap download links, and the internal `REPO` variable depend on that
> name, so the repo was NOT renamed. Only user-facing display text was rebranded.

---

## Architecture (current)

- **index.html** — marketing/landing page (one-click installer for the desktop agent).
- **app.html** — the browser console UI (chat, sidebar connections, theme, Matrix bg).
- **console.js** — the agent engine: provider adapters, tool registry, agent loop, memory, UI render.
- **room.html + rooms.js** — standalone WebRTC video rooms (kept separate so a bug here can't break the console).
- **ducki_logo.png / favicon.ico / favicon-32.png / apple-touch-icon.png** — brand assets (duck mascot cropped from owner's artwork).

### How the agent engine works
- `TOOLS` registry → `toolSpecs()` exports OpenAI-style + Gemini function declarations.
- `runAgent()` → `step()` loop: calls the model, runs any tool calls, feeds results back, repeats up to **8 steps**, then renders the final answer.
- `buildSystem()` assembles the live system prompt = base persona + learned notes + recent memory.
- Provider adapters: `callOpenAI(baseURL)` (used by OpenAI/DeepSeek/GLM/Qwen/Kimi/OpenRouter/SiliconFlow), `callGemini()`, `callAnthropic()`.

---

## Changelog (most recent first)

### Session 8 — Power, logic, automation, and the backend blueprint
- **Agent loop cap raised 8 → 40** (MAX_STEPS) so DUCKi chains many tools without stopping early.
- **Aggressive tool-use directives** added to the system prompt (don't stop early, chain freely, research-first).
- **Model picker fixed ("locked into 1 model")**: added MODELS preset map per provider + a UI `<datalist>`
  on the model input — pick a curated model OR type any custom id, for every provider incl. SiliconFlow/OpenRouter.
- **Firecrawl massively upgraded** (it was barely used): added
  - `firecrawl_search` — real web search.
  - `firecrawl_interact` — DRIVE a browser (click/type/scroll/press/wait then read) via Firecrawl `actions`.
    This is our clever "Playwright-in-a-static-page": real DOM interaction with no backend.
  - `firecrawl_extract` — structured JSON extraction by schema.
  - Prompt now tells DUCKi it HAS browser-automation power and to use it confidently.
- **The Duck House reliability**: added free **TURN servers** (OpenRelay) to the PeerJS ICE config so
  calls connect across strict firewalls, not just STUN.
- **Room presence/invite fix**: added a visible **roster panel** (who's in the house, host badge,
  remove buttons) so the host can see and moderate everyone — fixes "can't see users to invite".
- **NEW: HOW_TO_BUILD_AS_APP.md** — full meta-systems blueprint for the real backend version
  (durable 100-tool agentic loop, Playwright browser pool, LLM router, secrets vault, production WebRTC/SFU,
  migration path). Documents honestly what needs a backend vs what we faked cleverly client-side.

> Honest note carried forward: true Playwright/Selenium control of the USER's authenticated browser and
> shared terminals require a backend (see blueprint). `firecrawl_interact` is the closest static-site equivalent.

### Session 7 — Branding the rooms
- Renamed the WebRTC video rooms to **"THE DUCK HOUSE"** and made them visible across the app:
  prominent gradient pill in the console header, a callout button on the chat welcome screen,
  and a nav link + hero button on the landing page. room.html title/header/lobby rebranded.

### Session 6 — Access, memory, smarts, Matrix bg, video rooms
- **Private repo access FIXED.** `github_list_repos` now calls
  `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member`
  with pagination (default 100). `github_me` now returns `token_scopes` +
  `can_access_private` so DUCKi can tell the user if their token lacks `repo` scope.
  > Real-world limit: private repos require a GitHub token WITH `repo` scope. A
  > fine-grained/public-only token will still only see public repos — that's a token
  > setting, not a code bug.
- **Client-side memory (on-device).** localStorage keys `ducki_memory_v1`
  (rolling turn log, capped ~1600 turns ≈ 100 conversations) and `ducki_notes_v1`
  (learned facts). `rememberTurn()` saves every user + assistant turn; survives refresh.
- **"Gets smarter" = `remember_fact` tool + persistent notes** injected into the
  system prompt each session via `buildSystem()`. (Honest scope: it cannot retrain
  model weights in-browser; it accumulates durable memory/notes and reuses them.)
- **Less robotic / more verbose** — strengthened persona instruction ("not a status terminal").
- **Floating Matrix rain background** — canvas `#matrixfx` behind chat (gold/cyan),
  respects `prefers-reduced-motion`. Added to both app.html and room.html.
- **THE DUCK HOUSE — WebRTC video rooms (room.html + rooms.js)** via PeerJS cloud signaling:
  - Up to **6 users**, peer-to-peer mesh video/audio.
  - **Anonymous nicknames**, **live presence count**.
  - **Host approval flow**: host's PeerJS id = room code; joiners send `join_request`,
    host **admits/rejects**; host can **kick** anyone (hover tile).
  - Mic mute / camera toggle / copy invite code / leave.
  - "🔴 Live Rooms" link added to the console header.
  > Real-world limit: uses public STUN only. Strict corporate/mobile NAT may fail to
  > connect without a paid TURN server. Signaling uses the free public PeerJS cloud.

### Session 5 — Hands + identity + audio
- Added **GitHub write tools**: `github_create_repo`, `github_put_file` (commit/push). Enabled write actions by default.
- **Identity lock**: hard rule "never call yourself OpenClaw/EasyClaw/Claw"; fixed UI labels to "DUCKi".
- **Per-message Copy + 🔊 TTS buttons** (browser `speechSynthesis`, no API key).

### Session 4 — Personality
- Rewrote the system prompt: DUCKi persona by AEON DUX, proactive multi-step tool use, verbose answers.
  (Root cause of "short/industrial": the old prompt literally said "Be concise and get things done.")

### Session 3 — Real duck logo + SiliconFlow
- Cropped the duck mascot from the owner's screenshot → circular badge logo; replaced the claw in
  console + landing page; added favicons sitewide.
- Added **SiliconFlow** provider (`https://api.siliconflow.com/v1`, default `deepseek-ai/DeepSeek-V3`).

### Session 2 — Rebrand to DUCKi
- Rebranded app.html, index.html, console.js to "DUCKi — Powered by AEON DUX"
  (title, meta/OG tags, wordmark, headings, theme → gold #f5a623 / cyan #4fc3f7).
- Preserved all functional URLs and download links.

### Session 1 — The original fix + providers
- **Root cause of the 404:** default model was retired `gemini-1.5-flash`. Changed to `gemini-2.0-flash`.
  (Note: `gemini-3.5-flash` is NOT a real model.)
- Added providers: **DeepSeek, Zhipu GLM-4, Alibaba Qwen, Moonshot Kimi, OpenRouter**
  (all OpenAI-compatible, wired into defaults + dispatch + verify + dropdown).

---

## LLM Providers wired
gemini (default `gemini-2.0-flash`), openai, anthropic, deepseek, glm, qwen, kimi, openrouter, siliconflow.
Each OpenAI-compatible provider verifies via `<base>/models` (`VERIFY_BASE` map).

## Agent tools available to DUCKi
github_me, github_list_repos (all incl. private), github_get_file, github_search_repos,
github_create_issue, github_create_repo, github_put_file, firecrawl_scrape,
gmail_list, gmail_get, remember_fact.

---

## Known limits / honest caveats
1. **Gmail** needs Google OAuth (Google Cloud verification — the "$30 / going through Google" wall).
   This is Google's requirement, not the app; cannot be bypassed in code.
2. **WebRTC rooms** need signaling (PeerJS cloud, free) + TURN for strict networks (not provided; STUN only).
3. **Private repos** need a GitHub token with `repo` scope.
4. **Tool-calling quality depends on the chosen model** — use strong tool-capable models
   (DeepSeek, current Gemini, GPT-4o-class, large Qwen). Tiny/free models may ignore tools.
5. Memory and learned notes are stored **only on the user's device** (localStorage); clearing
   browser data wipes them. They do not sync across devices.

## Deploy process
Commit files to the `gh-pages` branch of Fame510/easyclaw via the GitHub Contents API.
GitHub Pages rebuilds in ~30-60s. Always hard-refresh (Ctrl/Cmd+Shift+R) to clear cached JS.
