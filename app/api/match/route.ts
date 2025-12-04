import { NextRequest } from "next/server";
import { streamText } from "ai";
import { Chess } from "chess.js";
import { buildModelPrompt } from "@/lib/prompt";
import { applyChaosMove, parseUciMove } from "@/lib/chess-utils";
import {
  MatchRequest,
  MatchMode,
  MatchResult,
  MatchStreamEvent,
  MatchClocks,
  IllegalMoveSummary
} from "@/lib/types";
import { createGateway } from "@ai-sdk/gateway";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const MAX_PLY = 400;

const ANSI = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m"
} as const;

const log = {
  info: (scope: string, message: string) => console.log(`${ANSI.cyan}${scope}${ANSI.reset} ${message}`),
  warn: (scope: string, message: string) => console.warn(`${ANSI.yellow}${scope}${ANSI.reset} ${message}`),
  error: (scope: string, message: string, err?: unknown) =>
    err ? console.error(`${ANSI.red}${scope}${ANSI.reset} ${message}`, err) : console.error(`${ANSI.red}${scope}${ANSI.reset} ${message}`),
  debug: (scope: string, message: string) => console.log(`${ANSI.magenta}${scope}${ANSI.reset} ${message}`)
};

function getGatewayKey(override?: string) {
  const fromRequest = override?.trim();
  if (fromRequest) return fromRequest;
  return process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_TOKEN || process.env.OPENAI_API_KEY;
}

const MOVE_TIMEOUT_MS = parseInt(process.env.MOVE_TIMEOUT_MS ?? "12000", 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMove(
  model: string,
  gatewayProvider: ReturnType<typeof createGateway>,
  prompt: string,
  timeoutMs = MOVE_TIMEOUT_MS,
  attempt = 1
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    log.info("[Match][fetchMove]", `model=${model} attempt=${attempt} timeout=${timeoutMs}ms`);
    log.debug("[Match][fetchMove]", `prompt (full):\n${prompt}`);
    const { textStream } = await streamText({
      model: gatewayProvider(model),
      prompt,
      temperature: 0.35,
      maxOutputTokens: 8, // keep responses short (UCI + optional promotion)
      stopSequences: [" ", "\n"], // stop early if model tries to add commentary
      abortSignal: controller.signal
    });

    let text = "";
    for await (const chunk of textStream) {
      text += chunk;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      const reason = `Empty response from model=${model} attempt=${attempt}`;
      log.warn("[Match][fetchMove]", reason);
      if (attempt < 3) {
        const backoff = 800 * attempt + 400;
        log.warn("[Match][fetchMove]", `Retrying after empty response in ${backoff}ms`);
        await sleep(backoff);
        return fetchMove(model, gatewayProvider, prompt, timeoutMs, attempt + 1);
      }
      throw new Error("Model returned an empty move");
    }
    log.info("[Match][fetchMove]", `model=${model} response="${trimmed}"`);
    return trimmed;
  } catch (err: any) {
    const msg = err?.message || "";
    const overloaded =
      msg.toLowerCase().includes("exhausted") ||
      msg.toLowerCase().includes("overloaded") ||
      err?.name === "AI_TypeValidationError";
    if (overloaded && attempt < 3) {
      const backoff = 1000 * attempt + 500;
      log.warn("[Match][fetchMove]", `Overload detected, retrying in ${backoff}ms (attempt ${attempt + 1})`);
      await sleep(backoff);
      return fetchMove(model, gatewayProvider, prompt, timeoutMs, attempt + 1);
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
  clocks?: MatchClocks,
  lastIllegalMoves?: Partial<Record<"white" | "black", IllegalMoveSummary>>
): MatchResult {
  const pgn = chess.history().length > 0 ? chess.pgn({ newline: "\n" }) : moves.join(" ");
  return {
    winner,
    reason,
    moves,
    pgn,
    illegalCounts,
    clocks,
    finalFen: chess.fen(),
    lastIllegalMoves
  };
}

function resultFromDraw(
  reason: MatchResult["reason"],
  moves: string[],
  illegalCounts: MatchResult["illegalCounts"],
  chess: Chess,
  clocks?: MatchClocks,
  lastIllegalMoves?: Partial<Record<"white" | "black", IllegalMoveSummary>>
) {
  return buildResult("draw", reason, moves, illegalCounts, chess, clocks, lastIllegalMoves);
}

export async function POST(req: NextRequest) {
  let body: MatchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { whiteModel, blackModel, mode, clockMinutes, apiKey: apiKeyFromBody } = body;
  const gatewayKey = getGatewayKey(apiKeyFromBody);
  if (!gatewayKey) {
    return new Response(
      "Missing AI key. Provide apiKey in the request body or set AI_GATEWAY_API_KEY (preferred) / AI_GATEWAY_TOKEN / OPENAI_API_KEY.",
      { status: 401 }
    );
  }
  const gatewayProvider = createGateway({ apiKey: gatewayKey });
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
      const lastIllegalMoves: Partial<Record<"white" | "black", IllegalMoveSummary>> = {};
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
        let fetchErr: any = null;
        try {
          const perMoveTimeout = isBullet
            ? Math.max(500, Math.min(MOVE_TIMEOUT_MS, clocks[activeColor] || MOVE_TIMEOUT_MS))
            : MOVE_TIMEOUT_MS;
          rawMove = await fetchMove(activeModel, gatewayProvider, prompt, perMoveTimeout);
        } catch (err: any) {
          fetchErr = err;
        }
        const moveTime = Date.now() - moveStartTime;

        if (fetchErr) {
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

          const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          const emptyMove = message?.toLowerCase().includes("empty move");

          if (emptyMove) {
            illegalCounts[activeColor] += 1;
            const reason = "Model returned an empty move";
            lastIllegal[activeColor] = { moveText: "(empty)", reason };
            lastIllegalMoves[activeColor] = {
              by: activeColor,
              move: "(empty)",
              reason,
              strikes: illegalCounts[activeColor],
              ply
            };

            log.warn("[Match][fetchMove-empty]", `ply=${ply} color=${activeColor} strikes=${illegalCounts[activeColor]} msg="${message}"`);

            send(controller, {
              type: "status",
              message: `${activeColor} produced an empty move (${illegalCounts[activeColor]} strikes)`,
              illegalCounts,
              clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
              illegalMove: lastIllegalMoves[activeColor]
            });

            if ((mode === "strict" || mode === "bullet") && illegalCounts[activeColor] >= 3) {
              const result = buildResult(
                opponent,
                "illegal",
                moves,
                illegalCounts,
                chess,
                isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
                lastIllegalMoves
              );
              send(controller, { type: "end", result });
              controller.close();
              return;
            }

            continue;
          }

          log.error("[Match][error]", "Model call failed:", fetchErr);
          const winner = activeColor === "white" ? "black" : "white";
          const result = buildResult(
            winner,
            "timeout",
            moves,
            illegalCounts,
            chess,
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
          );
          send(controller, { type: "status", message: `${activeColor} error: ${message || "Model call failed or timed out"}` });
          send(controller, { type: "end", result });
          controller.close();
          return;
        }

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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
      log.warn(
        "[Match][legal-check]",
        `ply=${ply} color=${activeColor} raw="${rawTrimmed}" error="${err?.message ?? err}"`
      );
      moveResult = null;
    }
    log.info(
      "[Match][move-parse]",
      `ply=${ply} color=${activeColor} raw="${rawMove}" cleaned="${cleaned}" result=${
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

      log.warn(
        "[Match][illegal]",
        `ply=${ply} color=${activeColor} raw="${rawTrimmed}" reason="${reason}"`
      );

          lastIllegal[activeColor] = { moveText: rawTrimmed, reason };
          lastIllegalMoves[activeColor] = {
            by: activeColor,
            move: rawTrimmed || "(empty move)",
            reason,
            strikes: illegalCounts[activeColor],
            ply
          };

          // Status only for illegal (do not log as a move to keep list aligned)
          send(controller, {
            type: "status",
            message: `${activeColor} played illegal move ${cleaned || "empty"}: ${reason} (${illegalCounts[activeColor]} strikes)`,
            illegalCounts,
            clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            illegalMove: lastIllegalMoves[activeColor]
          });

          if (mode === "chaos") {
            const parsedChaos = parseUciMove(cleaned);
            if (parsedChaos) {
              const chaos = applyChaosMove(fen, parsedChaos, chess.turn(), fullmove);
              fen = chaos.fen;
              try {
                chess = new Chess(fen);
              } catch (err: any) {
                log.error(
                  "[Match][chaos-invalid-fen]",
                  `ply=${ply} color=${activeColor} fen="${fen}" error="${err?.message ?? err}"`
                );
                const result = buildResult(
                  opponent,
                  "illegal",
                  moves,
                  illegalCounts,
                  chess,
                  isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
                  lastIllegalMoves
                );
                send(controller, {
                  type: "status",
                  message: `Chaos move produced invalid board: ${err?.message ?? "invalid FEN"}`,
                  illegalCounts,
                  clocks: isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined
                });
                send(controller, { type: "end", result });
                controller.close();
                return;
              }
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
              isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
              lastIllegalMoves
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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
            isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
            lastIllegalMoves
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
        isBullet ? { whiteMs: clocks.white, blackMs: clocks.black } : undefined,
        lastIllegalMoves
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
