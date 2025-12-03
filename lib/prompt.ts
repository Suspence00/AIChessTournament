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

export function buildModelPrompt({ fen, history, activeColor, mode, lastMove, clockMsRemaining, initialClockMs }: PromptInput) {
  const colorText = activeColor === "white" ? "White" : "Black";
  const isChaos = mode === "chaos";
  const isBullet = mode === "bullet";
  const legality = isChaos
    ? "Illegal moves will be executed anyway, but still prefer a strong legal move."
    : "Only return a legal chess move that obeys the rules.";
  const illegalNote = isChaos
    ? "Illegal moves will still be played (chaos mode), but you should avoid them."
    : "If you repeat illegal moves you will forfeit after 3 strikes.";

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
    `Previous moves (UCI): ${history.length ? history.join(", ") : "none"}`,
    lastMoveLine,
    clockLine,
    legality,
    illegalNote,
    speedLine,
    "If you want to resign, respond with: resign",
    "Do not include any commentary or code blocks. Output a single token with no quotes."
  ]
    .filter(Boolean)
    .join("\n");
}
