interface PromptInput {
  fen: string;
  history: string[];
  activeColor: "white" | "black";
  mode: "strict" | "chaos" | "bullet";
  clockMsRemaining?: number;
  initialClockMs?: number;
  lastMove?: {
    wasIllegal: boolean;
    reason?: string;
    moveText?: string;
  };
}

const HISTORY_CAP = 24; // limit history text to keep prompts small

export function buildModelPrompt({ fen, history, activeColor, mode, lastMove, clockMsRemaining, initialClockMs }: PromptInput) {
  const historyTail = history.slice(-HISTORY_CAP);
  const trimmedCount = history.length - historyTail.length;
  const colorText = activeColor === "white" ? "White" : "Black";
  const isChaos = mode === "chaos";
  const isBullet = mode === "bullet";
  const legality = isChaos
    ? "Chaos: illegal moves still execute, but they still count as strikes."
    : "Strict: only legal chess moves; 3 strikes forfeits.";

  const lastMoveLine =
    (lastMove?.wasIllegal)
      ? `Your previous move "${lastMove.moveText ?? "unknown"}" was ILLEGAL: ${lastMove.reason ?? "violated chess rules"}. Do not repeat it; choose a legal move now.`
      : null;

  const clockLine =
    isBullet && typeof clockMsRemaining === "number"
      ? `Bullet mode: ${Math.round((initialClockMs ?? 0) / 6000) / 10 || 3} minutes per side. Your clock: ${Math.max(0, Math.floor(clockMsRemaining / 1000))} seconds remaining. Respond immediately or you will lose on time.`
      : null;
  const speedLine = isBullet
    ? "Act fast: return only the move as a single UCI token (e.g., e2e4). Do not add commentary or code fences."
    : "Respond with exactly one move in long algebraic UCI (e.g., e2e4, g8f6, a7a8q).";

  return [
    `You are playing ${colorText} in a chess game.`,
    `Board (FEN): ${fen}`,
    `Previous moves (last ${historyTail.length}${trimmedCount > 0 ? ` of ${history.length}` : ""}): ${historyTail.length ? historyTail.join(" ") : "none"}`,
    lastMoveLine,
    clockLine,
    legality,
    speedLine,
    "If you want to resign, respond with: resign",
    "Do not include any commentary or code blocks. Output a single token with no quotes."
  ]
    .filter(Boolean)
    .join("\n");
}
