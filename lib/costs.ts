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
  const projectedPlies = Math.max(120, moves.length + 30); // closer to typical game length
  const history = moves.map((m) => m.move);

  const syntheticMove = "e2e4";
  const midHistory = [
    ...history,
    ...Array.from({ length: Math.max(0, Math.floor(projectedPlies / 2) - history.length) }, () => syntheticMove)
  ];
  const lateHistory = [
    ...history,
    ...Array.from({ length: Math.max(0, projectedPlies - history.length) }, () => syntheticMove)
  ];

  const promptStart = buildModelPrompt({
    fen,
    history,
    activeColor,
    mode,
    clockMsRemaining: clockInfo?.clockMsRemaining,
    initialClockMs: clockInfo?.initialClockMs
  });
  const promptMid = buildModelPrompt({
    fen,
    history: midHistory,
    activeColor,
    mode,
    clockMsRemaining: clockInfo?.clockMsRemaining,
    initialClockMs: clockInfo?.initialClockMs
  });
  const promptLate = buildModelPrompt({
    fen,
    history: lateHistory,
    activeColor,
    mode,
    clockMsRemaining: clockInfo?.clockMsRemaining,
    initialClockMs: clockInfo?.initialClockMs
  });

  // Use an average of start/mid/late prompts to approximate total prompt cost over time.
  const avgPromptTokens =
    (charsToTokens(promptStart.length) +
      charsToTokens(promptMid.length) +
      charsToTokens(promptLate.length)) /
    3;

  const gatewayOverhead = 256; // smaller but non-zero buffer for system/routing text
  const perCallInput = avgPromptTokens + gatewayOverhead;
  const perCallOutput = 32; // UCI with a small safety margin

  const safety = 1.2; // modest cushion
  const input = Math.ceil(perCallInput * projectedPlies * safety);
  const output = Math.ceil(perCallOutput * projectedPlies * safety);

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
