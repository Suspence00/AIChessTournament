# AI Chess Arena Technical Guide

## Overview
- Single game mode (`app/page.tsx`) drives a live match between two AI models via the Vercel AI Gateway. The client opens a streaming POST to `/api/match` and renders incoming NDJSON events (one JSON per line) into the board, clocks, move log, and result panel.
- Tournament mode (`app/tournament/page.tsx`) builds pairings from a selected model set and plays multiple matches in parallel (up to 3 at a time) against `/api/match`, updating Elo and per-pairing status cards as streams finish.
- Core state helpers: `lib/prompt.ts` builds the model prompt, `lib/chess-utils.ts` parses/executes chaos moves, `lib/costs.ts` estimates tokens/cost, `lib/models.ts` lists presets, and `lib/types.ts` shares event/result types across server and client.

## Modes and rules
- `strict`: Illegal moves increment a strike counter; 3 strikes forfeits. Legal play only.
- `chaos`: Illegal moves are still executed via `applyChaosMove` (teleport-like), but strikes are tracked.
- `bullet`: Same strike rule as strict, plus per-side clocks (1-3 minute options, clamped). A move taking longer than the remaining clock forfeits on time.
- Max plies: `/api/match` stops at 400 plies, `/api/tournament` at 300 plies, resolving as `max-move` draws.

## Streaming contract (`/api/match`)
- Content-Type: `text/event-stream` with NDJSON.
- Event union (`type`):
  - `status`: `{ message, illegalCounts?, clocks? }` - informational updates.
  - `move`: `{ move, fen, san?, displayMoveNum?, ply, activeColor, illegalCounts, clocks?, note?, timestamp? }`
  - `end`: `{ result }` where `result` is `MatchResult`.
- `MatchResult`: `{ winner: "white"|"black"|"draw", reason, moves, pgn, illegalCounts, clocks?, finalFen }`.
- Bullet clocks are reported as `{ whiteMs, blackMs }` when enabled. Illegal counts are always cumulative per color.

## API endpoints
- `POST /api/match`: Streams one game; uses `streamText` to call the selected models. Requires `AI_GATEWAY_API_KEY` (preferred), or `AI_GATEWAY_TOKEN`/`OPENAI_API_KEY`.
- `POST /api/tournament`: Runs a single round-robin (color alternates per pairing) for up to 8 models; returns `TournamentResult` with matches + standings.
- `GET /api/test`: Sanity call to verify the gateway key by asking `gpt-4o-mini` for `e2e4`.

## Client components (high level)
- `ModelPicker`: Lists models (grouped or cost-sorted) and emits selection changes.
- `MoveLog`: Renders plies grouped by move number with timing and illegal indicators.
- `EvalBar`: Displays a white/black advantage bar (vertical or horizontal).
- `HistoryPanel`: Shows recent finished matches from local storage.
- `StandingsTable` / `TournamentMatches`: Render tournament standings and per-game summaries.
- `StatusBar`: Compact running/idle indicator.

## Persistent storage keys
- `arena-history`: Array of recent `MatchResult`s for the single-game view (trimmed to 25).
- `elo-standings`: Array of `{ model, rating }` snapshots used for Elo charts in single-game and tournament views.

## Cost and token estimation
- `lib/costs.estimateTokens` builds synthetic mid/late-game prompts to approximate per-game input/output token totals (heuristic, not model-aware).
- `lib/costs.estimateCost` multiplies estimated tokens by the per-million rates from `lib/models.ts` and surfaces per-side and combined totals in the UI.

## External services
- AI inference: Vercel AI Gateway via `streamText` (model identifiers like `provider/model`).
- Client-side evaluation bar: `https://chess-api.com/v1` is called from the browser for on-demand position evals (depth 12).

## Reliability and UX notes
- Match streams are abortable via `AbortController` (`Stop` button or page unmount). Tournament cards also hold their own controllers for per-match cancellation.
- Illegal moves: Counts reset after a legal move; chaos mode still increments strikes while executing the move on the board.
- Timeouts: Bullet games decrement remaining clock by actual model think time; hitting 0 forfeits immediately with a `timeout` result.
- Live evaluation calls to `chess-api.com` are debounced and can be toggled off to avoid excess network churn; only the latest FEN response updates the bar.
