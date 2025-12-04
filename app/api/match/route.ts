import { NextRequest } from "next/server";
import { streamText } from "ai";
import { Chess } from "chess.js";
import { buildModelPrompt } from "@/lib/prompt";
import { applyChaosMove, parseUciMove } from "@/lib/chess-utils";
import { MatchRequest, MatchMode, MatchResult, MatchStreamEvent, MatchClocks } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const MAX_PLY = 400;

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
    console.log(`[fetchMove] Calling model: ${model}`);
    console.log(`[fetchMove] Prompt:\n${prompt}`);
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
    const trimmed = text.trim();
    console.log(`[fetchMove] Model ${model} returned: "${trimmed}"`);
    return trimmed;
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

function send(controller: ReadableStreamDefaultController, event: MatchStreamEvent) {
  controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
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

export async function POST(req: NextRequest) {
  const gatewayKey = getGatewayKey();
  if (!gatewayKey) {
    return new Response(
      "Server missing AI key. Set AI_GATEWAY_API_KEY (preferred) or AI_GATEWAY_TOKEN or OPENAI_API_KEY and restart.",
      { status: 500 }
    );
  }

  let body: MatchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { whiteModel, blackModel, mode, clockMinutes } = body;
  if (!whiteModel || !blackModel) {
    return new Response("whiteModel and blackModel are required", { status: 400 });
  }
  const isBullet = mode === "bullet";
  const requestedMinutes = Number(clockMinutes ?? 3);
  const safeClockMinutes = Number.isFinite(requestedMinutes) ? requestedMinutes : 3;
  const initialClockMs = isBullet ? Math.min(3, Math.max(1, safeClockMinutes)) * 60_000 : 0;

  const stream = new ReadableStream({
    async start(controller) {
      let fen = new Chess().fen();
      let chess = new Chess(fen);
      let fullmove = 1;
      const illegalCounts = { white: 0, black: 0 };
      const moves: string[] = [];
      const lastIllegal: Record<"white" | "black", { moveText?: string; reason?: string } | undefined> = {
        white: undefined,
        black: undefined
      };
      const clocks = { white: initialClockMs, black: initialClockMs };

      send(controller, {
        type: "status",
        message: "Match starting",
        clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      });

      for (let ply = 0; ply < MAX_PLY; ply++) {
        const activeColor = chess.turn() === "w" ? "white" : "black";
        const activeModel = activeColor === "white" ? whiteModel : blackModel;
        const opponent = activeColor === "white" ? "black" : "white";
        const prompt = buildModelPrompt({
          fen,
          history: moves,
          activeColor,
          mode: mode as MatchMode,
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
          const message =
            err instanceof Error ? err.message : "Model call failed or timed out";
          const result = buildResult(
            winner,
            "timeout",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "status", message: `${activeColor} error: ${message}` });
          send(controller, { type: "end", result });
          controller.close();
          return;
        }
        const moveTime = Date.now() - moveStartTime;
        if (isBullet) {
          clocks[activeColor] = Math.max(0, clocks[activeColor] - moveTime);
          if (clocks[activeColor] <= 0) {
            const clockSnapshot = { whiteMs: clocks.white, blackMs: clocks.black };
            const result = buildResult(opponent, "timeout", moves, illegalCounts, chess, clockSnapshot);
            send(controller, {
              type: "status",
              message: `${activeColor} flagged on time (${moveTime}ms used)`,
              illegalCounts,
              clocks: clockSnapshot
            });
            send(controller, { type: "end", result });
            controller.close();
            return;
          }
        }

        const rawTrimmed = rawMove.trim();
        const cleaned = rawTrimmed.toLowerCase();
        if (cleaned === "resign") {
          const winner = activeColor === "white" ? "black" : "white";
          const result = buildResult(
            winner,
            "resignation",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, {
            type: "move",
            move: "resign",
            fen,
            ply,
            activeColor,
            illegalCounts,
            clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            timestamp: moveTime
          });
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

        let moveResult = null;
        try {
          moveResult = chess.move(rawTrimmed, { sloppy: true } as any);
        } catch (err: any) {
          console.log(
            `[Match] Chess.js threw error for raw move "${rawTrimmed}": ${err.message}`
          );
          moveResult = null;
        }
        console.log(
          `[Match] Raw: "${rawMove}" -> Cleaned: "${cleaned}" -> MoveResult: ${
            moveResult
              ? JSON.stringify({
                  from: moveResult.from,
                  to: moveResult.to,
                  promotion: moveResult.promotion,
                  san: moveResult.san
                })
              : "null"
          }`
        );

        if (!moveResult) {
          illegalCounts[activeColor] += 1;
          const parsedUci = parseUciMove(cleaned);

          let reason = "Illegal move in current position";
          if (parsedUci) {
            const piece = (chess as any).get?.(parsedUci.from);
            if (!piece) {
              reason = `No piece on ${parsedUci.from}`;
            } else if (piece.color !== chess.turn()) {
              reason = `Piece on ${parsedUci.from} is not ${activeColor}`;
            } else {
              const legalMoves = chess.moves({ verbose: true }) as any[];
              const isLegal = legalMoves.some(
                (m) =>
                  m.from === parsedUci.from &&
                  m.to === parsedUci.to &&
                  (!parsedUci.promotion || m.promotion === parsedUci.promotion)
              );
              if (!isLegal) reason = "Move violates chess rules (blocked/check/etc.)";
            }
          } else {
            reason = "Could not parse move text";
          }

          console.log(
            `[Match] Chess.js rejected move "${rawTrimmed}" for ${activeColor} (${reason})`
          );

          lastIllegal[activeColor] = { moveText: rawTrimmed, reason };

          // Status only for illegal (do not log as a move to keep list aligned)
          send(controller, {
            type: "status",
            message: `${activeColor} played illegal move ${cleaned || "empty"}: ${reason} (${illegalCounts[activeColor]} strikes)`,
            illegalCounts,
            clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          });

          if (mode === "chaos") {
            const parsedChaos = parseUciMove(cleaned);
            if (parsedChaos) {
              const chaos = applyChaosMove(fen, parsedChaos, chess.turn(), fullmove);
              fen = chaos.fen;
              chess = new Chess(fen);
              fullmove = parseInt(fen.split(" ")[5], 10) || fullmove;
              moves.push(chaos.san);

              send(controller, {
                type: "move",
                move: chaos.san,
                fen,
                san: chaos.san,
                displayMoveNum: Math.floor(moves.length / 2) + 1,
                ply,
                activeColor,
                illegalCounts,
                clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
                note: "Chaos move executed despite illegality",
                timestamp: moveTime
              });
            }
          }

          if ((mode === "strict" || mode === "bullet") && illegalCounts[activeColor] >= 3) {
            const result = buildResult(
              opponent,
              "illegal",
              moves,
              illegalCounts,
              chess,
              isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
            );
            send(controller, { type: "end", result });
            controller.close();
            return;
          }

          continue;
        }

        const moveUci = `${moveResult.from}${moveResult.to}${moveResult.promotion ?? ""}`;
        const displayMoveNum = Math.floor(moves.length / 2) + 1;
        moves.push(moveUci);
        fen = chess.fen();
        fullmove = parseInt(fen.split(" ")[5], 10) || fullmove;
        illegalCounts[activeColor] = 0;
        lastIllegal[activeColor] = undefined;

        send(controller, {
          type: "move",
          move: moveUci,
          fen,
          san: moveResult.san,
          displayMoveNum,
          ply,
          activeColor,
          illegalCounts,
          clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
          timestamp: moveTime
        });

        if (chess.isCheckmate()) {
          const result = buildResult(
            activeColor,
            "checkmate",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

        if (chess.isStalemate()) {
          const result = resultFromDraw(
            "stalemate",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

        if (chess.isThreefoldRepetition()) {
          const result = resultFromDraw(
            "threefold",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

        if (chess.isInsufficientMaterial()) {
          const result = resultFromDraw(
            "insufficient",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

        if (chess.isDraw()) {
          const result = resultFromDraw(
            "fifty-move",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
          );
          send(controller, { type: "end", result });
          controller.close();
          return;
        }
      }

      const result = resultFromDraw(
        "max-move",
        moves,
        illegalCounts,
        chess,
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
      );
      send(controller, { type: "end", result });
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
}
