---
name: verify
description: How to launch and drive Diff Dad for runtime verification — daemon on a scratch port, config/test-connection API, and the single-PR server.
---

# Verifying Diff Dad changes at runtime

## Launch a server with the current source

The daemon is the easiest surface — it registers the shared config routes and
runs straight from source (no rebuild needed for CLI-side changes; frontend
changes need `bun run build` first since the server serves `packages/web/dist`).

```sh
# background it; --no-open suppresses the browser
bun packages/cli/src/cli.ts daemon --port=45677 --no-open

# readiness probe
curl -s http://localhost:45677/api/config
```

Check nothing is already on the port first (`lsof -iTCP:45677 -sTCP:LISTEN`).
Kill when done: `lsof -tiTCP:45677 -sTCP:LISTEN | xargs kill`.

## Useful endpoints

- `GET  /api/config` — redacted saved config (secrets become `*Set` booleans).
- `POST /api/config/test` — what the settings page "Test connection" buttons call.
  Always returns 200 with `{ok, detail}`; candidate fields overlay the saved config,
  so an omitted `aiApiKey` uses the stored one:
  ```sh
  curl -s -X POST http://localhost:45677/api/config/test \
    -H 'content-type: application/json' \
    -d '{"kind":"ai","aiProvider":"anthropic","aiModel":"claude-sonnet-5"}'
  ```
  `{"kind":"github"}` tests the effective GitHub token instead.
- `PUT /api/config` — merge-patch save (broadcasts over SSE `config` event).

## Gotchas

- `POST /api/config/test` with `kind: ai` makes ONE real API call against the
  user's stored key (16-token ping) — cheap, but it's live.
- The AI test has a 15s timeout; the local-CLI path (`defaultCli`) is much slower
  than the API path and can hit it.
- Config lives in the dataDir (see `getConfigPath()` in `packages/cli/src/config.ts`);
  the daemon reads it fresh per request, so config edits don't need a restart —
  but code edits do.
