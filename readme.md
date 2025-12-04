## AI Chess Arena

Autonomous chess battles between two AI models routed through the Vercel AI Gateway. Pick any two models, start a match, watch moves stream live, and view winners plus a rolling history.

### Stack
- Next.js (App Router) + TypeScript
- Vercel AI SDK + `@ai-sdk/gateway`
- `chess.js` for rules/validation
- `react-chessboard` for board UI
- TailwindCSS for styling

### Local setup
```bash
npm install
npm run dev
```

### Environment
- `AI_GATEWAY_API_KEY` — Gateway API key (preferred)
- Optional: `AI_GATEWAY_URL` — only if you use a custom Gateway URL; defaults to Vercel’s
- Fallbacks: `AI_GATEWAY_TOKEN` or `OPENAI_API_KEY` (only needed if you don’t have the main key above)

Models are passed as `provider/model` (e.g., `openai/gpt-4.1`, `anthropic/claude-3-5-sonnet`). Update `lib/models.ts` to add your own presets. The SDK points to the gateway via `AI_GATEWAY_URL` + `AI_GATEWAY_TOKEN`.

### Deployment on Vercel
1) `vercel init` (or import the repo)  
2) Add env var `AI_GATEWAY_TOKEN` in the Vercel dashboard  
3) `vercel --prod`

### Key files
- `app/page.tsx` — UI with board, controls, live log, replay/export, and history.
- `app/api/match/route.ts` — Match loop that streams events; calls models via AI Gateway, validates with `chess.js`, handles strict/chaos and win conditions.
- `app/api/tournament/route.ts` — Round-robin tournament runner for up to 8 models, returns rankings and per-game summaries.
- `lib/prompt.ts` — Gateway-safe prompt.
- `lib/chess-utils.ts` — UCI parsing and chaos move helper.
- `lib/types.ts` — Shared types for stream events and results.

### Notes
- Strict mode: illegal moves are rejected and 3 strikes forfeits.  
- Chaos mode: illegal moves are executed anyway (teleports) and still tracked.  
- Bullet mode: same 3-strike rule with 1-3 minute clocks; flagging on time forfeits immediately.  
- Streaming protocol: NDJSON over `text/event-stream` (one JSON object per line).
- Tournament mode: pick up to 8 models; the server plays a single round-robin (color alternates by pairing) and returns ranked standings (win=1, draw=0.5).
