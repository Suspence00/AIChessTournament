"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { modelOptions } from "@/lib/models";
import { useLocalStorage } from "@/lib/use-local-storage";
import { MatchMode, MatchMoveEvent, MatchResult, MatchStreamEvent } from "@/lib/types";
import { ModelPicker } from "@/components/model-picker";
import { MoveLog } from "@/components/move-log";
import { HistoryPanel } from "@/components/history-panel";
import { StatusBar } from "@/components/status-bar";
import { estimateCost, estimateTokens } from "@/lib/costs";
import { EvalBar } from "@/components/eval-bar";

const Chessboard = dynamic(() => import("react-chessboard").then((mod) => mod.Chessboard), {
  ssr: false
});

export default function Home() {
  const [whiteModel, setWhiteModel] = useState(modelOptions[0]?.value ?? "");
  const [blackModel, setBlackModel] = useState(modelOptions[1]?.value ?? "");
  const [mode, setMode] = useState<MatchMode>("strict");
  const [fen, setFen] = useState<string>("start");
  const [moves, setMoves] = useState<MatchMoveEvent[]>([]);
  const [status, setStatus] = useState<string>("Waiting to start");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [history, setHistory] = useLocalStorage<MatchResult[]>("arena-history", []);
  const abortRef = useRef<AbortController | null>(null);
  const [eloChart, setEloChart] = useState<Array<{ model: string; rating: number }>>([]);
  const [lastEloDelta, setLastEloDelta] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [illegalState, setIllegalState] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [evalScore, setEvalScore] = useState<number | null>(null);
  const [evalStatus, setEvalStatus] = useState<string>("Idle");
  const boardExpanded = running || moves.length > 0;
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidthPx, setBoardWidthPx] = useState(480);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeColorFromFen = () => (fen.split(" ")[1] === "w" ? "white" : "black");
  const perMoveTokens = estimateTokens(moves, fen, activeColorFromFen(), mode);
  const expectedPlies = Math.max(80, moves.length + 10); // rough full-game projection
  const estimatedTokens = {
    input: perMoveTokens.input * expectedPlies,
    output: perMoveTokens.output * expectedPlies
  };
  const whiteModelMeta = modelOptions.find((m) => m.value === whiteModel);
  const blackModelMeta = modelOptions.find((m) => m.value === blackModel);
  const estCostWhite = estimateCost(whiteModelMeta, estimatedTokens.input, estimatedTokens.output);
  const estCostBlack = estimateCost(blackModelMeta, estimatedTokens.input, estimatedTokens.output);
  const getElo = (modelValue: string) => {
    return eloChart.find((e) => e.model === modelValue)?.rating ?? 1000;
  };

  const playSound = (type: "move" | "capture" | "gameover" | "illegal") => {
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      const ctx = audioCtxRef.current ?? new Ctor();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = type === "capture" ? 520 : type === "gameover" ? 260 : type === "illegal" ? 320 : 440;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + (type === "gameover" ? 0.35 : 0.12));
    } catch {
      // ignore audio errors
    }
  };

  const evaluatePosition = async (fenToEval: string) => {
    setEvalStatus("Evaluating...");
    try {
      const res = await fetch("https://chess-api.com/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: fenToEval, depth: 12 })
      });
      if (!res.ok) throw new Error(`Eval failed (${res.status})`);
      const data = await res.json();
      if (typeof data.eval === "number") {
        setEvalScore(data.eval);
        setEvalStatus(data.text || "OK");
      } else if (data.centipawns) {
        const pawns = parseFloat(data.centipawns) / 100;
        setEvalScore(pawns);
        setEvalStatus(data.text || "OK");
      } else {
        setEvalScore(null);
        setEvalStatus("No eval");
      }
    } catch (err: any) {
      setEvalStatus(err?.message || "Eval error");
    }
  };

  useEffect(() => {
    const updateBoardWidth = () => {
      const containerWidth = boardContainerRef.current?.clientWidth ?? 480;
      const cap = 600;
      setBoardWidthPx(Math.min(containerWidth, cap));
    };
    updateBoardWidth();
    window.addEventListener("resize", updateBoardWidth);
    return () => window.removeEventListener("resize", updateBoardWidth);
  }, [boardExpanded]);

  useEffect(() => {
    if (history.length > 25) {
      setHistory(history.slice(-25));
    }
  }, [history, setHistory]);

  useEffect(() => {
    const toLabel = (id: string) => modelOptions.find((m) => m.value === id)?.label ?? id;
    const stored = localStorage.getItem("elo-standings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Array<{ model: string; rating: number }>;
        if (Array.isArray(parsed)) {
          setEloChart(parsed.sort((a, b) => b.rating - a.rating));
          return;
        }
      } catch {
        // ignore
      }
    }
    const baseline = modelOptions.map((m) => ({ model: m.value, rating: 1000 }));
    setEloChart(baseline);
  }, []);

  const handleEvent = (event: MatchStreamEvent) => {
    if (event.type === "status") {
      if (event.illegalCounts) {
        setIllegalState((prev) => {
          const incWhite = event.illegalCounts!.white > prev.white;
          const incBlack = event.illegalCounts!.black > prev.black;
          if (incWhite || incBlack) playSound("illegal");
          return event.illegalCounts!;
        });
      }
      setStatus(event.message);
      return;
    }

    if (event.type === "move") {
      setFen(event.fen);
      setMoves((prev) => [...prev, event]);
      setIllegalState(event.illegalCounts);
      const isCapture = event.san?.includes("x");
      playSound(isCapture ? "capture" : "move");
      evaluatePosition(event.fen);
      return;
    }

    if (event.type === "end") {
      setResult(event.result);
      setHistory((prev) => [...prev, event.result]);
      setRunning(false);
      setStatus(`Winner: ${event.result.winner} via ${event.result.reason}`);
      playSound("gameover");
      setIllegalState(event.result.illegalCounts);
      evaluatePosition(event.result.finalFen);

      // Elo update and delta
      const applyElo = (elo: Array<{ model: string; rating: number }>, whiteId: string, blackId: string, result: MatchResult) => {
        const K = 24;
        const ra = elo.find((e) => e.model === whiteId)?.rating ?? 1000;
        const rb = elo.find((e) => e.model === blackId)?.rating ?? 1000;
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
        const newRa = ra + K * (scoreA - expectedA);
        const newRb = rb + K * (scoreB - expectedB);
        return {
          updated: [
            { model: whiteId, rating: newRa },
            { model: blackId, rating: newRb },
            ...elo.filter((e) => e.model !== whiteId && e.model !== blackId)
          ].sort((a, b) => b.rating - a.rating),
          delta: { white: newRa - ra, black: newRb - rb }
        };
      };

      const { updated, delta } = applyElo(eloChart, whiteModel, blackModel, event.result);
      setEloChart(updated);
      setLastEloDelta({ white: delta.white, black: delta.black });
      try {
        localStorage.setItem("elo-standings", JSON.stringify(updated));
      } catch {
        // ignore
      }
    }
  };

  const startMatch = async () => {
    setRunning(true);
    setStatus("Launching bots via Vercel AI Gateway...");
    setMoves([]);
    setResult(null);
    setFen("start");

    const controller = new AbortController();
    abortRef.current = controller;

    const response = await fetch("/api/match", {
      method: "POST",
      body: JSON.stringify({ whiteModel, blackModel, mode }),
      headers: { "Content-Type": "application/json" },
      signal: controller.signal
    }).catch((err) => {
      setStatus(`Failed to start match: ${err}`);
      setRunning(false);
      return null;
    });

    if (!response || !response.body) {
      setStatus("No stream received from server.");
      setRunning(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as MatchStreamEvent;
            handleEvent(parsed);
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStatus("Match stopped");
      } else {
        setStatus(`Stream error: ${err}`);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const stopMatch = () => {
    abortRef.current?.abort();
    setRunning(false);
    setStatus("Match stopped");
  };

  const replayMoves = async () => {
    if (!moves.length) return;
    setRunning(true);
    setStatus("Replaying match...");
    for (const move of moves) {
      setFen(move.fen);
      await new Promise((res) => setTimeout(res, 600));
    }
    setRunning(false);
    setStatus("Replay finished");
  };

  const copyPgn = async () => {
    if (!result?.pgn) return;
    await navigator.clipboard.writeText(result.pgn);
    setStatus("PGN copied to clipboard");
  };

  const heroSubtitle = useMemo(
    () =>
      mode === "strict"
        ? "Strict Mode: 3 illegal moves forfeits the match."
        : "Chaos Mode: illegal moves are executed anyway.",
    [mode]
  );

  return (
    <main className="min-h-screen bg-arena-bg bg-[radial-gradient(circle_at_20%_10%,rgba(77,208,225,0.06),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(167,139,250,0.08),transparent_22%)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-arena-accent">Vercel AI Hackathon</p>
          <h1 className="text-4xl md:text-5xl font-extrabold">AI Chess Arena</h1>
          <p className="text-slate-300 max-w-3xl">
            Two AI models, one board. Pick your models via the Vercel AI Gateway, start the match, and watch the moves stream live with automatic validation.
          </p>
          <StatusBar status={status} running={running} />
        </header>

        <section className="space-y-4">
          <div className="glass rounded-2xl p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-2xl font-semibold">Arena</h2>
                <p className="text-slate-400 text-sm">{heroSubtitle}</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">
                  {mode === "strict" ? "Strict" : "Chaos"}
                </span>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(480px,840px)_minmax(440px,1fr)] items-start">
              <div className="flex flex-col gap-3 items-start w-full">
                <div className="bg-arena-card rounded-xl p-3 shadow-card transition-all duration-300 overflow-hidden space-y-2 w-full">
                  <div className="flex items-center justify-between text-sm text-slate-200 px-1">
                    <span className="font-semibold">
                      {blackModelMeta?.label ?? "Black"} · Elo {Math.round(getElo(blackModel))} · Strikes {illegalState.black}/3
                    </span>
                    <span className="text-slate-400">{moves.length ? `Ply ${moves.length}` : ""}</span>
                  </div>
                  <div ref={boardContainerRef} className="w-full max-w-[660px] mx-auto">
                    <div className="w-full aspect-square">
                      <Chessboard
                        id="ai-chess-arena-board"
                        position={fen}
                        arePiecesDraggable={false}
                        boardWidth={boardWidthPx}
                        animationDuration={300}
                        customBoardStyle={{
                          borderRadius: "12px",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.35)"
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-200 px-1 mt-2">
                    <span className="font-semibold">
                      {whiteModelMeta?.label ?? "White"} · Elo {Math.round(getElo(whiteModel))} · Strikes {illegalState.white}/3
                    </span>
                  </div>
                  <div className="pt-2">
                    <EvalBar orientation="horizontal" evalScore={evalScore} status={evalStatus} />
                  </div>
                </div>
              </div>

              <div className="glass rounded-xl p-3 self-start space-y-2 min-w-[380px] md:min-w-[460px]">
                <div className="flex items-center justify-between text-sm text-slate-300 px-1">
                  {running ? (
                    <>
                      <span>
                        {activeColorFromFen() === "white"
                          ? `${whiteModelMeta?.label ?? "White"} is thinking`
                          : `${blackModelMeta?.label ?? "Black"} is thinking`}
                      </span>
                      <span className="font-mono text-xs text-slate-400">...</span>
                    </>
                  ) : result ? (
                    <span>
                      Game over: {result.winner === "draw" ? "Draw" : `${result.winner} wins`} ({result.reason})
                    </span>
                  ) : (
                    <span>Idle</span>
                  )}
                </div>
                <MoveLog
                  moves={moves}
                  whiteName={whiteModelMeta?.label ?? "White"}
                  blackName={blackModelMeta?.label ?? "Black"}
                />
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ModelPicker label="Model A (White)" value={whiteModel} onChange={setWhiteModel} options={modelOptions} />
              <ModelPicker label="Model B (Black)" value={blackModel} onChange={setBlackModel} options={modelOptions} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={startMatch}
                disabled={running}
                className="rounded-md bg-arena-accent px-4 py-2 font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
              >
                {running ? "Match Running..." : "Start Match"}
              </button>
              <button
                onClick={() => setMode(mode === "strict" ? "chaos" : "strict")}
                className="rounded-md border border-white/10 px-3 py-2 text-sm hover:border-arena-accent"
              >
                Toggle {mode === "strict" ? "Chaos" : "Strict"}
              </button>
              <button
                onClick={stopMatch}
                disabled={!running}
                className="rounded-md border border-white/10 px-3 py-2 text-sm hover:border-arena-accent disabled:opacity-40"
              >
                Stop
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="glass rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-2">Result & Elo Change</h3>
              {result ? (
                <div className="space-y-2 text-sm">
                  <p className="text-xl font-bold">
                    Winner:{" "}
                    <span className="text-arena-accent">
                      {result.winner === "draw" ? "Draw" : result.winner}
                    </span>
                  </p>
                  <p className="text-slate-400">Reason: {result.reason}</p>
                  <p className="text-xs text-slate-500">Final FEN: {result.finalFen}</p>
                  <div className="text-xs text-slate-300 space-y-1">
                    <div>
                      {whiteModelMeta?.label ?? "White"} Elo: {Math.round(getElo(whiteModel))} ({lastEloDelta.white >= 0 ? "+" : ""}{lastEloDelta.white.toFixed(1)})
                    </div>
                    <div>
                      {blackModelMeta?.label ?? "Black"} Elo: {Math.round(getElo(blackModel))} ({lastEloDelta.black >= 0 ? "+" : ""}{lastEloDelta.black.toFixed(1)})
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={replayMoves}
                      className="rounded-md border border-white/10 px-3 py-2 text-xs hover:border-arena-accent"
                    >
                      Replay Game
                    </button>
                    <button
                      onClick={copyPgn}
                      className="rounded-md border border-white/10 px-3 py-2 text-xs hover:border-arena-accent"
                    >
                      Export PGN
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-sm">Run a match to see the winner.</p>
              )}
            </div>

            <div className="glass rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Token & Cost Estimate</h3>
                <a href="/tournament" className="text-xs text-arena-accent hover:underline">
                  Go to Tournament
                </a>
              </div>
              <div className="text-sm text-slate-300 space-y-2">
                <div className="flex justify-between">
                  <span>Estimated tokens (full game)</span>
                  <span className="font-mono text-white">
                    ~{estimatedTokens.input + estimatedTokens.output} (in {estimatedTokens.input} / out {estimatedTokens.output})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{whiteModelMeta?.label ?? "White model"} est. cost</span>
                  <span className="font-mono text-arena-accent">
                    {estCostWhite ? `$${estCostWhite.toFixed(4)}` : "n/a"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{blackModelMeta?.label ?? "Black model"} est. cost</span>
                  <span className="font-mono text-arena-accent">
                    {estCostBlack ? `$${estCostBlack.toFixed(4)}` : "n/a"}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Total (both sides)</span>
                  <span className="font-mono text-white">
                    {estCostWhite || estCostBlack ? `$${(estCostWhite + estCostBlack).toFixed(4)}` : "n/a"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Estimates use a rough token heuristic; actual usage depends on model responses.
                </p>
              </div>
            </div>

            <div className="glass rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-3">Elo Leaderboard</h3>
              <div className="space-y-2">
                {eloChart.slice(0, 10).map((row, idx) => {
                  const max = eloChart[0]?.rating || 1000;
                  const width = Math.max(10, Math.min(100, Math.round((row.rating / max) * 100)));
                  return (
                    <div key={row.model} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-400 w-5 text-right">{idx + 1}.</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{row.model}</span>
                          <span className="font-mono text-white">{Math.round(row.rating)}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-arena-accent"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!eloChart.length && <p className="text-slate-400 text-sm">No Elo data yet.</p>}
              </div>
            </div>

            <HistoryPanel history={[...history].reverse()} />
          </div>
        </section>
      </div>
    </main>
  );
}
