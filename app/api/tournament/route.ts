import { NextRequest } from "next/server";
import { Chess } from "chess.js";
import { streamText } from "ai";
import { buildModelPrompt } from "@/lib/prompt";
import { applyChaosMove, parseUciMove } from "@/lib/chess-utils";
import {
  MatchMode,
  MatchResult,
  TournamentMatch,
  TournamentRequest,
  TournamentResult,
  TournamentStanding,
  MatchClocks
} from "@/lib/types";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_PLY = 300;
function getGatewayKey() {
  return (
    process.env.AI_GATEWAY_API_KEY ||
    process.env.AI_GATEWAY_TOKEN ||
    process.env.OPENAI_API_KEY
  );
}

const MOVE_TIMEOUT_MS = parseInt(process.env.MOVE_TIMEOUT_MS ?? "12000", 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMove(model: string, prompt: string, timeoutMs = MOVE_TIMEOUT_MS, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { textStream } = await streamText({
      model,
      prompt,
      temperature: 0.7,
      abortSignal: controller.signal
    });

    let text = "";
    for await (const chunk of textStream) {
      text += chunk;
    }
    return text.trim();
  } catch (err: any) {
    const msg = err?.message || "";
    const overloaded =
      msg.toLowerCase().includes("exhausted") ||
      msg.toLowerCase().includes("overloaded") ||
      err?.name === "AI_TypeValidationError";
    if (overloaded && attempt < 3) {
      const backoff = 1000 * attempt + 500;
      console.warn(`[fetchMove] Overload detected, retrying in ${backoff}ms (attempt ${attempt + 1})`);
      await sleep(backoff);
      return fetchMove(model, prompt, timeoutMs, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildResult(
  winner: MatchResult["winner"],
  reason: MatchResult["reason"],
  moves: string[],
  illegalCounts: MatchResult["illegalCounts"],
  chess: Chess,
  clocks?: MatchClocks
): MatchResult {
  const pgn = chess.history().length > 0 ? chess.pgn({ newline: "\n" }) : moves.join(" ");
  return {
    winner,
    reason,
    moves,
    pgn,
    illegalCounts,
    clocks,
    finalFen: chess.fen()
  };
}

function resultFromDraw(
  reason: MatchResult["reason"],
  moves: string[],
  illegalCounts: MatchResult["illegalCounts"],
  chess: Chess,
  clocks?: MatchClocks
) {
  return buildResult("draw", reason, moves, illegalCounts, chess, clocks);
}

async function playMatch(
  whiteModel: string,
  blackModel: string,
  mode: MatchMode,
  clockMinutes?: number
): Promise<MatchResult> {
  let fen = new Chess().fen();
  let chess = new Chess(fen);
  let fullmove = 1;
  const illegalCounts = { white: 0, black: 0 };
  const moves: string[] = [];
  const lastIllegal: Record<"white" | "black", { moveText?: string; reason?: string } | undefined> = {
    white: undefined,
    black: undefined
  };
  const isBullet = mode === "bullet";
  const requestedMinutes = Number(clockMinutes ?? 3);
  const safeClockMinutes = Number.isFinite(requestedMinutes) ? requestedMinutes : 3;
  const initialClockMs = isBullet ? Math.min(3, Math.max(1, safeClockMinutes)) * 60_000 : 0;
  const clocks = { white: initialClockMs, black: initialClockMs };

  for (let ply = 0; ply < MAX_PLY; ply++) {
    const activeColor = chess.turn() === "w" ? "white" : "black";
    const activeModel = activeColor === "white" ? whiteModel : blackModel;
    const opponent = activeColor === "white" ? "black" : "white";
    const prompt = buildModelPrompt({
      fen,
      history: moves,
      activeColor,
      mode,
      clockMsRemaining: isBullet ? clocks[activeColor] : undefined,
      initialClockMs: isBullet ? initialClockMs : undefined,
      lastMove: lastIllegal[activeColor]
        ? {
            wasIllegal: true,
            reason: lastIllegal[activeColor]?.reason,
            moveText: lastIllegal[activeColor]?.moveText
          }
        : undefined
    });

    let rawMove = "";
    const moveStartTime = Date.now();
    try {
      const perMoveTimeout = isBullet
        ? Math.max(500, Math.min(MOVE_TIMEOUT_MS, clocks[activeColor] || MOVE_TIMEOUT_MS))
        : MOVE_TIMEOUT_MS;
      rawMove = await fetchMove(activeModel, prompt, perMoveTimeout);
    } catch (err: any) {
      console.error("Model call failed:", err);
      const winner = activeColor === "white" ? "black" : "white";
      return buildResult(
        winner,
        "timeout",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }
    const moveTime = Date.now() - moveStartTime;
    if (isBullet) {
      clocks[activeColor] = Math.max(0, clocks[activeColor] - moveTime);
      if (clocks[activeColor] <= 0) {
        return buildResult(opponent, "timeout", moves, illegalCounts, chess, {
          whiteMs: clocks.white,
          blackMs: clocks.black
        });
      }
    }

    const rawTrimmed = rawMove.trim();
    const cleaned = rawTrimmed.toLowerCase();
    if (cleaned === "resign") {
      const winner = activeColor === "white" ? "black" : "white";
      return buildResult(
        winner,
        "resignation",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }

    let moveResult = null;
    try {
      moveResult = chess.move(rawTrimmed, { sloppy: true } as any);
    } catch (err: any) {
      console.log(
        `[Tournament] Chess.js threw error for raw move "${rawTrimmed}": ${err?.message ?? err}`
      );
      moveResult = null;
    }

    if (!moveResult) {
      illegalCounts[activeColor] += 1;
      lastIllegal[activeColor] = { moveText: rawTrimmed, reason: "Illegal move in current position" };

      if (mode === "chaos") {
        const parsedChaos = parseUciMove(cleaned);
        if (parsedChaos) {
          const chaos = applyChaosMove(fen, parsedChaos, chess.turn(), fullmove);
          fen = chaos.fen;
          chess = new Chess(fen);
          fullmove = parseInt(fen.split(" ")[5], 10) || fullmove;
          moves.push(chaos.san);
        }
      }

      if ((mode === "strict" || mode === "bullet") && illegalCounts[activeColor] >= 3) {
        return buildResult(
          opponent,
          "illegal",
          moves,
          illegalCounts,
          chess,
          isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
        );
      }

      continue;
    }

    fen = chess.fen();
    fullmove = parseInt(fen.split(" ")[5], 10) || fullmove;
    illegalCounts[activeColor] = 0;
    lastIllegal[activeColor] = undefined;
    const moveUci = `${moveResult.from}${moveResult.to}${moveResult.promotion ?? ""}`;
    moves.push(moveUci);

    if (chess.isCheckmate()) {
      return buildResult(
        activeColor,
        "checkmate",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }

    if (chess.isStalemate()) {
      return resultFromDraw(
        "stalemate",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }

    if (chess.isThreefoldRepetition()) {
      return resultFromDraw(
        "threefold",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }

    if (chess.isInsufficientMaterial()) {
      return resultFromDraw(
        "insufficient",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }

    if (chess.isDraw()) {
      return resultFromDraw(
        "fifty-move",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
    }
  }

  return resultFromDraw(
    "max-move",
    moves,
    illegalCounts,
    chess,
    isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
  );
}

const BASE_RATING = 1000;
const K_FACTOR = 24;

function updateRatings(
  ratings: Record<string, number>,
  white: string,
  black: string,
  result: MatchResult
) {
  const ra = ratings[white] ?? BASE_RATING;
  const rb = ratings[black] ?? BASE_RATING;
  const expectedA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ra - rb) / 400));

  let scoreA = 0.5;
  let scoreB = 0.5;
  if (result.winner === "white") {
    scoreA = 1;
    scoreB = 0;
  } else if (result.winner === "black") {
    scoreA = 0;
    scoreB = 1;
  }

  ratings[white] = ra + K_FACTOR * (scoreA - expectedA);
  ratings[black] = rb + K_FACTOR * (scoreB - expectedB);
}

function buildStandings(
  models: string[],
  matches: TournamentMatch[],
  ratings: Record<string, number>
): TournamentStanding[] {
  const table: Record<string, TournamentStanding> = {};
  for (const m of models) {
    table[m] = {
      model: m,
      rating: ratings[m] ?? 1000,
      games: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      checkmates: 0,
      illegalForfeits: 0,
      timeouts: 0,
      resignations: 0
    };
  }

  for (const match of matches) {
    const { white, black, result } = match;
    table[white].games += 1;
    table[black].games += 1;

    if (result.winner === "draw") {
      table[white].draws += 1;
      table[black].draws += 1;
      table[white].points += 0.5;
      table[black].points += 0.5;
    } else if (result.winner === "white") {
      table[white].wins += 1;
      table[black].losses += 1;
      table[white].points += 1;
    } else {
      table[black].wins += 1;
      table[white].losses += 1;
      table[black].points += 1;
    }

    if (result.reason === "checkmate") {
      if (result.winner === "white") table[white].checkmates += 1;
      if (result.winner === "black") table[black].checkmates += 1;
    }
    if (result.reason === "illegal") {
      if (result.winner === "white") table[black].illegalForfeits += 1;
      if (result.winner === "black") table[white].illegalForfeits += 1;
    }
    if (result.reason === "timeout") {
      if (result.winner === "white") table[black].timeouts += 1;
      if (result.winner === "black") table[white].timeouts += 1;
    }
    if (result.reason === "resignation") {
      if (result.winner === "white") table[black].resignations += 1;
      if (result.winner === "black") table[white].resignations += 1;
    }

    // update rating snapshot at end of match
    table[white].rating = ratings[white] ?? table[white].rating;
    table[black].rating = ratings[black] ?? table[black].rating;
  }

  return Object.values(table).sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.model.localeCompare(b.model);
  });
}

export async function POST(req: NextRequest) {
  const gatewayKey = getGatewayKey();
  if (!gatewayKey) {
    return new Response(
      "Server missing AI key. Set AI_GATEWAY_API_KEY (preferred) or AI_GATEWAY_TOKEN or OPENAI_API_KEY and restart.",
      { status: 500 }
    );
  }

  let body: TournamentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { models, mode, clockMinutes } = body;
  if (!Array.isArray(models) || models.length < 2) {
    return new Response("Provide at least two models", { status: 400 });
  }
  if (models.length > 8) {
    return new Response("Maximum of 8 models allowed", { status: 400 });
  }

  const matches: TournamentMatch[] = [];
  const ratings: Record<string, number> = {};
  for (const m of models) ratings[m] = BASE_RATING;

  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const asWhite = (i + j) % 2 === 0 ? models[i] : models[j];
      const asBlack = asWhite === models[i] ? models[j] : models[i];
      const result = await playMatch(asWhite, asBlack, mode, clockMinutes);
      matches.push({ white: asWhite, black: asBlack, result });
      updateRatings(ratings, asWhite, asBlack, result);
    }
  }

  const standings = buildStandings(models, matches, ratings);
  const payload: TournamentResult = { mode, matches, standings };

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" }
  });
}
