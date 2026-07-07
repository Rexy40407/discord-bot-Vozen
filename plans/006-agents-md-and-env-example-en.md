# Plan 006: Add a root CLAUDE.md for coding agents and translate .env.example comments to English

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fb7f916..HEAD -- .env.example CLAUDE.md package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `fb7f916`, 2026-07-07

## Why this matters

The repo has no agent-facing guidance file: every AI coding session rediscovers the same landmines (plain `npm start` in production skips the supervisor; `npm audit fix --force` downgrades discord.js; the sharding env var is deliberately NOT called `SHARDS`). A root `CLAUDE.md` encodes those once. Separately, the repo's public-facing text was recently moved to English (commit `fb7f916` "docs: public-facing text in English"), but `.env.example` — the first file any self-hoster opens — still has all comments in Portuguese. Translating it finishes that pass. Both changes are documentation-only; zero runtime risk.

## Current state

- `CLAUDE.md` — does not exist at the repo root (verified). `AGENTS.md` does not exist either.
- `.env.example` — 74 lines, ~30 Portuguese comment lines, variables with empty or safe placeholder values (no secrets). Excerpt showing the style:

  ```
  # .env.example:1-2
  # Token do bot (Discord Developer Portal -> Bot)
  DISCORD_TOKEN=
  ```

  The BOT_SHARDS naming gotcha that must survive translation intact (`.env.example:43-45`):

  ```
  # NOTA: chama-se BOT_SHARDS (nao SHARDS) de proposito — SHARDS e SHARD_COUNT sao
  # reservadas e lidas pelo proprio Client do discord.js a partir do ambiente, o que
  # partiria o `npm start` single-process. Nao renomear para SHARDS.
  ```

- Facts the CLAUDE.md content below encodes, each verified at planning time:
  - `package.json:7-16` scripts: `dev` = `tsx watch src/index.ts`, `build` = `tsc`, `test` = `vitest run`, `start` = `node dist/index.js`, `start:prod` = `npm run build && node scripts/start-prod.mjs`. The supervisor `scripts/start-prod.mjs` provides the single-instance lock, native-module (davey) preheat, auto-restart with exponential backoff, and persistent logs — plain `npm start` has none of that (see `scripts/start-prod.mjs:1-14` header comment).
  - `package.json:38` `"//overrides"` comment (Portuguese) explicitly says: do NOT run `npm audit fix --force` — it would downgrade discord.js to v13 and @discordjs/opus across a major; transitive CVEs are pinned via the `overrides` block instead.
  - `.env.example:23-27`: `TTS_ENGINE` is `'piper'` (default) or `'neural'`; `'neural'` requires `OPENAI_API_KEY` and fails fast without it.
  - `docs/ARCHITECTURE.md` exists and states it reflects the code in `src/` (the historical spec in `docs/superpowers/specs/2026-06-30-tts-bot-design.md` may diverge).
  - `tsconfig.json`: `module: NodeNext`, `strict: true`.
  - Tests: 114 `*.test.ts` files, FLAT in `tests/` (no subdirectories), named after the module under test in camelCase (e.g. `tests/playerFifo.test.ts` exercises `src/voice/player.ts`).
  - Code comments across `src/`, `scripts/`, `tools/` are in Portuguese.
  - Voice-clone sidecar: `tools/setup-clone.ps1` installs a Python venv into `tools/clone-venv/` (gitignored); the bot auto-detects `tools\clone-venv\Scripts\python.exe` — no `.env` change needed (`tools/setup-clone.ps1:1-3`).
  - Commit style from `git log`: short conventional-ish one-liners in Portuguese, e.g. `fix(games): apagar da thread nunca falha às escuras (log + fallback arquivar)`.

## Commands you will need

| Purpose          | Command                | Expected on success         |
| ---------------- | ---------------------- | --------------------------- |
| Tests (sanity)   | `npx vitest run`       | all pass (unchanged)        |
| PT-leftover grep | `git grep -nE "defeito | utilizador                  | necessari | arranc | VAZIO | proposito | lingua" -- .env.example` | no matches, exit 1 |
| Diff scope       | `git diff --stat`      | only the two in-scope files |

## Scope

**In scope** (the only files you should create/modify):

- `CLAUDE.md` (create, repo root)
- `.env.example` (translate comments only)

**Out of scope** (do NOT touch):

- `.env` — never open or edit it; it contains real secrets.
- Variable NAMES and VALUES in `.env.example` — comments only. `PIPER_PATH=piper`, `DEFAULT_VOICE=en_US-amy-medium`, etc. must survive byte-identical.
- `README.md`, `docs/**` — already handled by the English pass in `fb7f916`.
- Portuguese comments anywhere else in the codebase — they are the repo convention, not a defect.

## Git workflow

- Branch: `advisor/006-agents-md-and-env-example-en`
- Commit style: PT one-liner, e.g. `docs: CLAUDE.md para agentes + .env.example com comentários em inglês`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `CLAUDE.md` at the repo root

Write exactly this content (every fact in it was verified against the repo — see "Current state"):

```markdown
# CLAUDE.md

Guidance for AI coding agents working on Vozen (Discord TTS bot).

## Commands

- Install: `npm install`
- Build (typecheck + emit): `npm run build` (tsc)
- Tests: `npx vitest run` (suite in `tests/`)
- Dev (watch mode): `npm run dev`
- Production: `npm run start:prod` — NEVER plain `npm start` in production:
  it skips the supervisor `scripts/start-prod.mjs` (single-instance lock,
  native-module preheat, auto-restart with backoff, persistent logs).

## Hard rules

- NEVER run `npm audit fix --force`. It would downgrade discord.js to v13 and
  @discordjs/opus across a major. Transitive CVEs are handled by the
  `overrides` block in `package.json` — read the `//overrides` comment there
  before touching any dependency version.
- Code comments in this repo are written in Portuguese. Write new comments in
  Portuguese too.
- Never read or commit `.env`. Use `.env.example` as the reference.

## Environment

- Copy `.env.example` to `.env`; fill `DISCORD_TOKEN` and `CLIENT_ID`.
- The sharding variable is `BOT_SHARDS`, deliberately NOT `SHARDS` —
  `SHARDS`/`SHARD_COUNT` are read from the environment by the discord.js
  Client itself and would break single-process `npm start`. Do not rename it.
- `TTS_ENGINE=neural` requires `OPENAI_API_KEY` (the bot fails fast without
  it). The default engine is `piper` (self-hosted, free).

## Architecture

- Read `docs/ARCHITECTURE.md` — it reflects the code in `src/`. The historical
  design spec under `docs/superpowers/specs/` may diverge; the code wins.
- Optional voice-clone sidecar (Chatterbox, Python): installed by
  `tools/setup-clone.ps1` into `tools/clone-venv/` (gitignored). The bot
  auto-detects it — no `.env` change needed.

## Conventions

- TypeScript, `module: NodeNext`, `strict: true` (see `tsconfig.json`).
- Tests: vitest, flat files in `tests/` named after the module under test
  (e.g. `tests/playerFifo.test.ts` covers `src/voice/player.ts`).
- Commits: short conventional-ish one-liners in Portuguese (see `git log`).
```

**Verify**: `git grep -n "npm audit fix" -- CLAUDE.md` → 1 match; `git grep -n "BOT_SHARDS" -- CLAUDE.md` → 1 match.

### Step 2: Replace `.env.example` with the translated version

Overwrite `.env.example` with exactly the content below. It is a comment-only translation of the current file: every variable name, order, and value is unchanged; only `#` comment lines were translated (the original's internal label "Vaga 3" is rendered as "Wave 3").

```
# Bot token (Discord Developer Portal -> Bot)
DISCORD_TOKEN=
# Application/Client ID (Discord Developer Portal -> General Information)
CLIENT_ID=
# Path to the Piper binary (e.g. C:\piper\piper.exe)
PIPER_PATH=piper
# Folder with Piper's .onnx models (e.g. C:\piper\models)
MODELS_DIR=./models
# Path to the SQLite database
DB_PATH=./tts.db
# Default voice (model name without extension)
DEFAULT_VOICE=en_US-amy-medium
# Default speed (1.0 = normal; higher values = slower in Piper)
DEFAULT_SPEED=1.0
# Idle time before leaving the voice channel (ms)
INACTIVITY_MS=300000
# Maximum playback queue capacity
QUEUE_CAP=20
# Maximum number of characters per message
MAX_CHARS=300
# Per-user request limit per minute
RATE_PER_MIN=5
# TTS engine: 'piper' (default, self-host, free) or 'neural' (OpenAI tts-1, premium).
# An invalid value falls back to 'piper' with a warning. 'neural' requires OPENAI_API_KEY (fails fast if missing).
TTS_ENGINE=piper
# OpenAI API key — only needed when TTS_ENGINE=neural.
OPENAI_API_KEY=
# Minimum log level: debug | info | warn | error (default: info)
LOG_LEVEL=info
# Bot presence/activity text (shown as "Listening to ...").
# Optional: if empty, uses the brand default "type it, hear it. • /setup".
# Setting it here overrides the default. Keep it short (Discord truncates long texts).
PRESENCE_TEXT=
# Port for the optional HTTP health endpoint (GET /health -> 200 {"status":"ok"}).
# Optional: if EMPTY/absent, NO server is started (default). Setting a
# port (e.g. 8080) enables a minimal server for uptime monitors (UptimeRobot).
# Exposes no sensitive data. See docs/GO-PUBLIC.md (24/7).
HEALTH_PORT=
# Sharding (opt-in, only for scaling near ~1000+ guilds). EMPTY/absent =>
# single-process (default — you don't need to touch this). 'auto' lets Discord
# choose the count; an integer >= 2 fixes the number of shards. Only takes effect
# with `npm run start:sharded`; normal `npm start` ignores this variable.
# NOTE: it is called BOT_SHARDS (not SHARDS) on purpose — SHARDS and SHARD_COUNT
# are reserved and read from the environment by the discord.js Client itself,
# which would break single-process `npm start`. Do not rename it to SHARDS.
BOT_SHARDS=
# top.gg webhook (opt-in, P11.5) — records the bot's top.gg votes.
# DEDICATED port for the webhook server (POST /webhook/topgg). EMPTY/absent =>
# NO server is started (default). Setting a port (e.g. 8081) enables it.
# It is a SEPARATE port from HEALTH_PORT on purpose (do not reuse the same one):
# don't mix a public uptime endpoint with an authenticated webhook endpoint.
TOPGG_WEBHOOK_PORT=
# Secret that top.gg sends in the Authorization header (set in the webhook
# panel on top.gg). RECOMMENDED to always set it: without it the webhook has NO
# authentication and anyone who finds the port can forge votes. If empty, the
# server still starts but warns in the log and accepts unauthenticated requests.
TOPGG_WEBHOOK_SECRET=
# Wave 3 — top.gg API token to PUBLISH the server count (ranking/discovery).
# Different from the WEBHOOK_SECRET above: this is the API token (top.gg ->
# Edit -> Webhooks/API). EMPTY => auto-post does NOT start (opt-in). With a
# token, it publishes the server_count at startup and every 30 min.
TOPGG_TOKEN=
# Wave 3 — URL of a Discord webhook to SEND unexpected errors to (gateway/
# rejections/exceptions) for production monitoring. EMPTY => no sending (opt-in).
# Create it in: Channel settings -> Integrations -> Webhooks -> New webhook -> Copy URL.
# There is dedup (the same error does not spam the channel).
ERROR_WEBHOOK_URL=
# Per-segment multi-language synthesis (EXPERIMENTAL, P14.4). EMPTY/absent => OFF
# (default — behavior unchanged: ONE voice for the whole sentence). Only 'true' enables it.
# When ON, sentences containing more than one language are split per segment
# (detection by script/punctuation) and each chunk is synthesized with its
# language's voice, with the WAVs concatenated. Short-span detection is imperfect
# (especially between languages of the SAME script, e.g. English+French) — leave
# OFF until you validate it by ear.
MULTILINGUAL_SEGMENTS=
```

**Verify** (all three):

- `git grep -nE "defeito|utilizador|necessari|arranc|VAZIO|proposito|lingua" -- .env.example` → no matches (exit code 1).
- `git diff .env.example | grep "^-" | grep -v "^---" | grep -v "^-#"` → no output (only comment lines were removed; every removed line starts with `#`).
- `git diff .env.example | grep -E "^\+[A-Z_]+="` → no output (no variable line was added/changed).

### Step 3: Confirm nothing else changed and the suite still passes

**Verify**:

- `git diff --stat` → exactly two entries: `CLAUDE.md` (new) and `.env.example`.
- `npx vitest run` → all tests pass (documentation-only change; count unchanged).

## Test plan

No new tests — documentation-only. The greps in Step 2 are the regression check: they mechanically prove (a) no Portuguese comment survived in `.env.example`, (b) no variable line was touched.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `CLAUDE.md` exists at repo root and contains the strings `npm audit fix`, `BOT_SHARDS`, `start:prod`, `docs/ARCHITECTURE.md`
- [ ] `git grep -nE "defeito|utilizador|necessari|arranc|VAZIO|proposito|lingua" -- .env.example` → no matches
- [ ] Every removed line in `git diff .env.example` starts with `#` (comment-only change)
- [ ] `git diff --stat` touches only `CLAUDE.md` and `.env.example`
- [ ] `npx vitest run` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `.env.example` no longer matches the 74-line Portuguese version described in "Current state" (someone already translated or restructured it).
- A `CLAUDE.md` or `AGENTS.md` has appeared at the repo root since planning (merge, don't clobber — that's a judgment call, so stop).
- Any verification grep in Step 2 fails and the cause is a variable name/value difference rather than a comment.
- You find yourself needing to open `.env` for any reason — never do; stop instead.

## Maintenance notes

- If plan 005 lands (adds `npm run typecheck`) or plan 013 lands (adds `npm run lint`), extend CLAUDE.md's Commands section accordingly — one line each.
- Reviewer focus: diff of `.env.example` should show ONLY `#` lines changing; and CLAUDE.md claims should be spot-checked against `package.json` scripts.
- Deferred: translating Portuguese comments in `src/**` — that is the repo's deliberate convention, not debt.
