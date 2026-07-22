# User App and public status rollout

This document is deliberately a **manual, post-approval rollout**. The source
changes in this repository are disabled by default and this document does not
authorize a Developer Portal, DNS, Pages, VPS, Discord OAuth or Top.gg change.

## Before any external change

1. Run `npm run check` and `npm run check:site` from the exact revision to be deployed.
2. Review `commandExposure()` in `src/commands/definitions.ts`. Guild-only commands
   must remain guild-only in the registered JSON, and handler-side Manage Guild,
   same-call and entitlement checks must remain in place.
3. Review `PRIVACY.md`: the status endpoint may expose only coarse component state;
   it must never include Discord IDs, guild/user/message/audio data, quotas, raw errors,
   tokens or provider endpoints.
4. Test on a non-production Discord application first. Do not use production users as
   a User App experiment.

## User App (manual Developer Portal work)

The code exposes **candidate metadata only**. It does not register User Install
commands or enable User Apps remotely. Before enabling anything in the Discord
Developer Portal, verify the then-current Discord policy and portal UI.

Initial candidate actions are informational: `/help`, `/invite`, `/vote`, `/uptime`
and `/bot-stats`. `/redeem` remains DM-safe but is intentionally not a User App
candidate because it changes a personal entitlement. No voice, queue, transcription,
translation, moderation, server configuration, Premium-pass or owner command can be
made User-App-capable without a new reviewed code and privacy change.

Acceptance checks:

- In a DM/User App context, no candidate can look up a guild, read a guild config,
  join/speak in a voice channel, scan content or access another account.
- In a guild, candidate behavior stays unchanged.
- Attempting a guild-only command from an unsupported context is prevented by Discord
  command registration and still fails safely in the handler if forged.

Rollback: disable User Install/User App capability in the Developer Portal and wait
for Discord command propagation. Do not delete database data as part of rollback.

## Public status (manual proxy/DNS work)

`PUBLIC_STATUS_ENABLED=false` is the default. With it disabled, `/status` is a 404.
With `PUBLIC_STATUS_ENABLED=true`, the **existing loopback-only** health listener can
serve `GET /status`; it does not bind a public address. `HEALTH_PORT` must also be set.

The response is intentionally minimal:

```json
{
  "status": "operational",
  "components": {
    "bot": "operational",
    "database": "operational",
    "providers": "degraded"
  }
}
```

States are only `operational`, `degraded` and `unavailable`. Missing provider health
fails closed to `unavailable`; this is not an uptime monitor, historical dashboard or
service-level agreement. `PUBLIC_STATUS_INCIDENT` is optional, flattened to one line
and capped at 240 characters.

To publish it later, put an authenticated/reviewed reverse proxy in front of the
loopback service, limit methods to `GET`, retain the existing request timeouts and
verify that only `/status` is exposed. A static Pages page may link to that route only
after the proxy URL exists; do not claim a live URL before then.

Acceptance checks:

- `GET /health` remains `{"status":"ok"}`.
- `GET /status` is 404 when disabled, and returns only the documented schema when enabled.
- Stop the gateway, make a database check fail and simulate a degraded provider: each
  produces the relevant coarse state without returning the internal error.
- Load test the proxy route and verify rate limiting/cache policy there; the bot
  listener remains loopback-only and does not promise public availability.

Rollback: remove the reverse-proxy location or set `PUBLIC_STATUS_ENABLED=false`, then
restart through the normal approved deployment procedure. Do not erase operational
aggregate rows merely to roll back a public route.
