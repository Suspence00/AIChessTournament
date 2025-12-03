import { ArenaModelOption, MatchMode, MatchMoveEvent } from "./types";
import { buildModelPrompt } from "./prompt";

// rough heuristic: tokens ~= chars/4
export function charsToTokens(chars: number) {
  return Math.ceil(chars / 4);
}

export function estimateTokens(
  moves: MatchMoveEvent[],
  fen: string,
  activeColor: "white" | "black",
  mode: MatchMode,
  clockInfo?: { clockMsRemaining?: number; initialClockMs?: number }
) {
  const history = moves.map((m) => m.move);
  const prompt = buildModelPrompt({
    fen,
    history,
    activeColor,
    mode,
    clockMsRemaining: clockInfo?.clockMsRemaining,
    initialClockMs: clockInfo?.initialClockMs
  });
  const input = charsToTokens(prompt.length);
  const output = 8; // small reply (uci string)
  return { input, output };
}

export function estimateCost(model: ArenaModelOption | undefined, inputTokens: number, outputTokens: number) {
  if (!model) return 0;
  const inRate = model.inputCostPerMTokens ?? 0;
  const outRate = model.outputCostPerMTokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * inRate +
    (outputTokens / 1_000_000) * outRate;
  return cost;
}
