interface PromptInput {
  fen: string;
  history: string[];
  activeColor: "white" | "black";
  mode: "strict" | "chaos";
  lastMove?: {
    wasIllegal: boolean;
    reason?: string;
    moveText?: string;
  };
}

export function buildModelPrompt({ fen, history, activeColor, mode, lastMove }: PromptInput) {
  const colorText = activeColor === "white" ? "White" : "Black";
  const legality = mode === "strict"
    ? "Only return a legal chess move that obeys the rules."
    : "Illegal moves will be executed anyway, but still prefer a strong legal move.";
  const illegalNote = mode === "strict"
    ? "If you repeat illegal moves you will forfeit after 3 strikes."
    : "Illegal moves will still be played (chaos mode), but you should avoid them.";

  const lastMoveLine =
    (lastMove?.wasIllegal)
      ? `Your previous move "${lastMove.moveText ?? "unknown"}" was ILLEGAL: ${lastMove.reason ?? "violated chess rules"}. Do not repeat it; choose a legal move now.`
      : null;

  return [
    `You are playing ${colorText} in a chess game.`,
    `Board (FEN): ${fen}`,
    `Previous moves (UCI): ${history.length ? history.join(", ") : "none"}`,
    lastMoveLine,
    legality,
    illegalNote,
    "Respond with exactly one move in long algebraic UCI (e.g., e2e4, g8f6, a7a8q).",
    "If you want to resign, respond with: resign",
    "Do not include any commentary or code blocks. Output a single token with no quotes."
  ]
    .filter(Boolean)
    .join("\n");
}
