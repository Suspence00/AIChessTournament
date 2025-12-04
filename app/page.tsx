"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { modelOptions } from "@/lib/models";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  MatchClocks,
  MatchHistoryEntry,
  MatchMode,
  MatchMoveEvent,
  MatchResult,
  MatchStatusEvent,
  MatchStreamEvent
} from "@/lib/types";
import { ModelPicker } from "@/components/model-picker";
import { MoveLog } from "@/components/move-log";
import { HistoryPanel } from "@/components/history-panel";
import { StatusBar } from "@/components/status-bar";
import { estimateCost, estimateTokens } from "@/lib/costs";
import { EvalBar } from "@/components/eval-bar";
import { Footer } from "@/components/footer";

const Chessboard = dynamic(() => import("react-chessboard").then((mod) => mod.Chessboard), {
  ssr: false
});

const HISTORY_LIMIT = 25;

function getWinnerLabel(result: MatchResult, whiteLabel: string, blackLabel: string) {
  if (result.winner === "white") return whiteLabel;
  if (result.winner === "black") return blackLabel;
  return "Draw";
}

function getReasonLabel(result: MatchResult, whiteLabel: string, blackLabel: string) {
  const loserColor = result.winner === "white" ? "black" : result.winner === "black" ? "white" : null;
  const loserLabel = loserColor === "white" ? whiteLabel : loserColor === "black" ? blackLabel : null;
  const preferredIllegal =
    (loserColor && result.lastIllegalMoves?.[loserColor]) ||
    result.lastIllegalMoves?.black ||
    result.lastIllegalMoves?.white;

  switch (result.reason) {
    case "illegal": {
      if (!loserLabel) return "Illegal move";
      const strikes = preferredIllegal?.strikes ?? 3;
      return `${loserLabel} hit ${strikes} strikes (illegal move)`;
    }
    case "timeout":
      return loserLabel ? `${loserLabel} flagged on time` : "Timeout";
    case "resignation":
      return loserLabel ? `${loserLabel} resigned` : "Resignation";
    case "checkmate":
      return "Checkmate";
    case "stalemate":
      return "Stalemate";
    case "threefold":
      return "Threefold repetition";
    case "fifty-move":
      return "50-move rule";
    case "insufficient":
      return "Insufficient material";
    case "max-move":
      return "Move cap reached";
    default:
      return result.reason;
  }
}

function getIllegalNote(result: MatchResult, whiteLabel: string, blackLabel: string) {
  const loserColor = result.winner === "white" ? "black" : result.winner === "black" ? "white" : null;
  const detail =
    (loserColor && result.lastIllegalMoves?.[loserColor]) ||
    result.lastIllegalMoves?.black ||
    result.lastIllegalMoves?.white;
  if (!detail) return undefined;
  const who = detail.by === "white" ? whiteLabel : blackLabel;
  return `${who} tried "${detail.move}" (${detail.reason})`;
}

function migrateHistory(rawHistory: Array<MatchHistoryEntry | MatchResult> = []): MatchHistoryEntry[] {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory
    .map((entry, idx) => {
      if ((entry as MatchHistoryEntry).result && (entry as MatchHistoryEntry).winnerLabel) {
        return entry as MatchHistoryEntry;
      }
      const result = entry as MatchResult;
      if (!result || typeof result !== "object" || !("winner" in result)) return null;
      const whiteLabel = "White";
      const blackLabel = "Black";
      return {
        id: `legacy-${idx}-${result.finalFen ?? "match"}`,
        playedAt: Date.now() - idx,
        mode: "strict",
        white: { id: "unknown-white", label: whiteLabel },
        black: { id: "unknown-black", label: blackLabel },
        clockMinutes: undefined,
        result,
        winnerLabel: getWinnerLabel(result, whiteLabel, blackLabel),
        reasonLabel: getReasonLabel(result, whiteLabel, blackLabel),
        illegalNote: getIllegalNote(result, whiteLabel, blackLabel)
      };
    })
    .filter(Boolean)
    .slice(-HISTORY_LIMIT) as MatchHistoryEntry[];
}

export default function Home() {
  const [whiteModel, setWhiteModel] = useState(modelOptions[0]?.value ?? "");
  const [blackModel, setBlackModel] = useState(modelOptions[1]?.value ?? "");
  const [mode, setMode] = useState<MatchMode>("strict");
  const [fen, setFen] = useState<string>(() => new Chess().fen());
  const [moves, setMoves] = useState<MatchMoveEvent[]>([]);
  const [status, setStatus] = useState<string>("Waiting to start");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [historyRaw, setHistoryRaw] = useLocalStorage<Array<MatchHistoryEntry | MatchResult>>(
    "arena-history",
    []
  );
  const history = useMemo(() => migrateHistory(historyRaw), [historyRaw]);
  const [apiKey, setApiKey] = useLocalStorage<string>("arena-api-key", "");
  const abortRef = useRef<AbortController | null>(null);
  const [eloChart, setEloChart] = useState<Array<{ model: string; rating: number }>>([]);
  const [lastEloDelta, setLastEloDelta] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [illegalState, setIllegalState] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [lastIllegalMove, setLastIllegalMove] = useState<MatchStatusEvent["illegalMove"] | null>(null);
  const [evalScore, setEvalScore] = useState<number | null>(null);
  const [evalStatus, setEvalStatus] = useState<string>("Idle");
  const [evalEnabled, setEvalEnabled] = useState(true);
  const [clockMinutes, setClockMinutes] = useState<number>(3);
  const [clocks, setClocks] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [displayClocks, setDisplayClocks] = useState<{ white: number; black: number }>({ white: 0, black: 0 });
  const [turnStartTs, setTurnStartTs] = useState<number | null>(null);
  const [activeTurn, setActiveTurn] = useState<"white" | "black" | null>(null);
  const boardExpanded = running || moves.length > 0;
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardWidthPx, setBoardWidthPx] = useState(480);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const evalDebounceRef = useRef<number | null>(null);
  const evalControllerRef = useRef<AbortController | null>(null);
  const evalRequestIdRef = useRef(0);
  const pgnCopiedTimeoutRef = useRef<number | null>(null);
  const [pgnCopiedLabel, setPgnCopiedLabel] = useState<string | null>(null);
  const activeColorFromFen = () => (fen.split(" ")[1] === "w" ? "white" : "black");
  const activeColor = activeColorFromFen();
  const bulletInitialMs = Math.min(3, Math.max(1, clockMinutes)) * 60_000;
  const formatClock = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  const estimatedTokens = estimateTokens(moves, fen, activeColor, mode, mode === "bullet" ? {
    clockMsRemaining: clocks[activeColor],
    initialClockMs: bulletInitialMs
  } : undefined);
  const whiteModelMeta = modelOptions.find((m) => m.value === whiteModel);
  const blackModelMeta = modelOptions.find((m) => m.value === blackModel);
  const estCostWhite = estimateCost(whiteModelMeta, estimatedTokens.input, estimatedTokens.output);
  const estCostBlack = estimateCost(blackModelMeta, estimatedTokens.input, estimatedTokens.output);
  const getElo = (modelValue: string) => {
    return eloChart.find((e) => e.model === modelValue)?.rating ?? 1000;
  };
  const whiteLabel = whiteModelMeta?.label ?? "White";
  const blackLabel = blackModelMeta?.label ?? "Black";
  const currentWinnerLabel = result ? getWinnerLabel(result, whiteLabel, blackLabel) : "";
  const currentReasonLabel = result ? getReasonLabel(result, whiteLabel, blackLabel) : "";
  const currentIllegalNote = result ? getIllegalNote(result, whiteLabel, blackLabel) : undefined;

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

  const runEval = async (fenToEval: string) => {
    const requestId = ++evalRequestIdRef.current;
    evalControllerRef.current?.abort();
    const controller = new AbortController();
    evalControllerRef.current = controller;
    setEvalStatus("Evaluating...");
    try {
      const res = await fetch("https://chess-api.com/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen: fenToEval, depth: 12 }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`Eval failed (${res.status})`);
      const data = await res.json();
      if (requestId !== evalRequestIdRef.current) return;
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
      if (controller.signal.aborted || requestId !== evalRequestIdRef.current) return;
      setEvalScore(null);
      setEvalStatus(err?.message || "Eval error");
    }
  };

  const queueEvaluation = (fenToEval: string) => {
    if (!evalEnabled) {
      setEvalStatus("Eval disabled");
      return;
    }
    if (evalDebounceRef.current) {
      window.clearTimeout(evalDebounceRef.current);
    }
    evalDebounceRef.current = window.setTimeout(() => {
      runEval(fenToEval);
    }, 350);
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
    if (mode !== "bullet") {
      setDisplayClocks({ white: clocks.white, black: clocks.black });
      return;
    }
    setDisplayClocks({ white: clocks.white, black: clocks.black });
    if (!running || !activeTurn || turnStartTs === null) return;
    const tick = () => {
      setDisplayClocks(() => {
        const next = { ...clocks };
        if (activeTurn && turnStartTs !== null) {
          next[activeTurn] = Math.max(0, clocks[activeTurn] - (Date.now() - turnStartTs));
        }
        return next;
      });
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [mode, running, clocks, activeTurn, turnStartTs]);

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

  useEffect(() => {
    return () => {
      evalControllerRef.current?.abort();
      if (evalDebounceRef.current) {
        window.clearTimeout(evalDebounceRef.current);
      }
      if (pgnCopiedTimeoutRef.current) {
        window.clearTimeout(pgnCopiedTimeoutRef.current);
      }
    };
  }, []);

  const syncClocksFromEvent = (incoming?: MatchClocks, nextTurn?: "white" | "black" | null) => {
    if (mode !== "bullet" || !incoming) return;
    setClocks({ white: incoming.whiteMs, black: incoming.blackMs });
    setDisplayClocks({ white: incoming.whiteMs, black: incoming.blackMs });
    if (nextTurn !== undefined) {
      setActiveTurn(nextTurn);
      setTurnStartTs(nextTurn ? Date.now() : null);
    }
  };

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
      if (event.illegalMove) {
        setLastIllegalMove(event.illegalMove);
      }
      setStatus(event.message);
      syncClocksFromEvent(event.clocks, activeColorFromFen());
      return;
    }

    if (event.type === "move") {
      setFen(event.fen);
      setMoves((prev) => [...prev, event]);
      setIllegalState(event.illegalCounts);
      if (lastIllegalMove && event.illegalCounts && event.illegalCounts[lastIllegalMove.by] === 0) {
        setLastIllegalMove(null);
      }
      const nextTurn = event.fen.split(" ")[1] === "w" ? "white" : "black";
      syncClocksFromEvent(event.clocks, nextTurn);
      const isCapture = event.san?.includes("x");
      playSound(isCapture ? "capture" : "move");
      queueEvaluation(event.fen);
      return;
    }

    if (event.type === "end") {
      syncClocksFromEvent(event.result.clocks, null);
      setTurnStartTs(null);
      setActiveTurn(null);
      setResult(event.result);
      const winnerLabel = getWinnerLabel(event.result, whiteLabel, blackLabel);
      const reasonLabel = getReasonLabel(event.result, whiteLabel, blackLabel);
      const illegalNote = getIllegalNote(event.result, whiteLabel, blackLabel);
      const illegalFromResult =
        (event.result.winner === "white" && event.result.lastIllegalMoves?.black) ||
        (event.result.winner === "black" && event.result.lastIllegalMoves?.white) ||
        event.result.lastIllegalMoves?.black ||
        event.result.lastIllegalMoves?.white;
      if (illegalFromResult) {
        setLastIllegalMove(illegalFromResult);
      }
      setHistoryRaw((prev) => {
        const normalized = migrateHistory(prev);
        const entry: MatchHistoryEntry = {
          id: `match-${Date.now()}`,
          playedAt: Date.now(),
          mode,
          clockMinutes: mode === "bullet" ? clockMinutes : undefined,
          white: { id: whiteModel, label: whiteLabel },
          black: { id: blackModel, label: blackLabel },
          result: event.result,
          winnerLabel,
          reasonLabel,
          illegalNote
        };
        return [...normalized, entry].slice(-HISTORY_LIMIT);
      });
      setRunning(false);
      setStatus(
        event.result.winner === "draw"
          ? `Draw - ${reasonLabel}`
          : `Winner: ${winnerLabel} (${reasonLabel})`
      );
      playSound("gameover");
      setIllegalState(event.result.illegalCounts);
      queueEvaluation(event.result.finalFen);

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
    const key = apiKey.trim();
    if (!key) {
      setStatus("Add your Vercel AI Gateway API key to start a match.");
      return;
    }
    setRunning(true);
    setStatus("Launching bots via Vercel AI Gateway...");
    setMoves([]);
    setResult(null);
    setIllegalState({ white: 0, black: 0 });
    setLastIllegalMove(null);
    setPgnCopiedLabel(null);
    const startFen = new Chess().fen();
    setFen(startFen);
    if (mode === "bullet") {
      setClocks({ white: bulletInitialMs, black: bulletInitialMs });
      setDisplayClocks({ white: bulletInitialMs, black: bulletInitialMs });
      setActiveTurn("white");
      setTurnStartTs(Date.now());
    } else {
      setClocks({ white: 0, black: 0 });
      setDisplayClocks({ white: 0, black: 0 });
      setActiveTurn(null);
      setTurnStartTs(null);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const response = await fetch("/api/match", {
      method: "POST",
      body: JSON.stringify({
        whiteModel,
        blackModel,
        mode,
        clockMinutes: mode === "bullet" ? clockMinutes : undefined,
        apiKey: key
      }),
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

    if (!response.ok) {
      const body = await response.text();
      const msg = body || `Request failed (${response.status})`;
      alert(`API key error or request failed:\n${msg}`);
      setStatus("Match start failed — check your API key and try again.");
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
    setTurnStartTs(null);
    setActiveTurn(null);
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

  const showPgnCopied = (label: string) => {
    if (pgnCopiedTimeoutRef.current) {
      window.clearTimeout(pgnCopiedTimeoutRef.current);
    }
    setPgnCopiedLabel(label);
    pgnCopiedTimeoutRef.current = window.setTimeout(() => {
      setPgnCopiedLabel(null);
    }, 1800);
  };

  const copyPgnText = async (pgn: string, label: string) => {
    if (!pgn) {
      setStatus("No PGN available to export");
      return;
    }
    try {
      await navigator.clipboard.writeText(pgn);
      setStatus(`PGN copied (${label})`);
      showPgnCopied(label);
    } catch {
      try {
        const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${label.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.pgn`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus("Clipboard blocked - downloaded PGN instead");
      } catch {
        setStatus("Unable to export PGN");
      }
    }
  };

  const copyPgn = async () => {
    if (!result?.pgn) return;
    await copyPgnText(result.pgn, `${whiteLabel} vs ${blackLabel}`);
  };

  const heroSubtitle = useMemo(() => {
    if (mode === "bullet") {
      return `Bullet Mode: ${clockMinutes}-minute clocks per side. Flags lose immediately; 3 illegal moves still forfeit.`;
    }
    return mode === "strict"
      ? "Strict Mode: 3 illegal moves forfeits the match."
      : "Chaos Mode: illegal moves are executed anyway.";
  }, [mode, clockMinutes]);

  return (
    <main className="min-h-screen bg-arena-bg bg-[radial-gradient(circle_at_20%_10%,rgba(77,208,225,0.06),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(167,139,250,0.08),transparent_22%)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.3em] text-arena-accent">Vercel AI Hackathon</p>
              <h1 className="text-4xl md:text-5xl font-extrabold">AI Chess Arena</h1>
              <p className="text-slate-300 max-w-3xl">
                Two AI models, one board. Pick your models via the Vercel AI Gateway, start the match, and watch the moves stream live with automatic validation.
              </p>
            </div>
            <a
              href="/tournament"
              className="rounded-lg bg-arena-accent px-5 py-2.5 text-sm font-semibold text-black shadow-lg hover:bg-cyan-300 transition"
            >
              Tournament Mode
            </a>
          </div>
          <StatusBar status={status} running={running} />
        </header>

        <section className="space-y-4">
          <div className="glass rounded-2xl p-4 md:p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ModelPicker label="Model A (White)" value={whiteModel} onChange={setWhiteModel} options={modelOptions} />
              <ModelPicker label="Model B (Black)" value={blackModel} onChange={setBlackModel} options={modelOptions} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-200">Your Vercel AI Gateway key (BYOK)</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="vck_..."
                autoComplete="off"
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-arena-accent"
              />
              <p className="text-xs text-slate-500">Stored locally in your browser and sent only with your match requests.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={startMatch}
                disabled={running || !apiKey.trim()}
                className="rounded-md bg-arena-accent px-4 py-2 font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
              >
                {running ? "Match Running..." : !apiKey.trim() ? "Add API Key to Start" : "Start Match"}
              </button>
              <button
                onClick={stopMatch}
                disabled={!running}
                className="rounded-md border border-white/10 px-3 py-2 text-sm hover:border-arena-accent disabled:opacity-40"
              >
                Stop
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-300">Mode</span>
                <div className="flex gap-2">
                  {(["strict", "chaos", "bullet"] as MatchMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      disabled={running}
                      className={clsx(
                        "rounded-md border px-3 py-2 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed",
                        mode === m
                          ? "border-arena-accent bg-arena-accent/10 text-white"
                          : "border-white/10 text-slate-300 hover:border-arena-accent/50"
                      )}
                    >
                      {m === "strict" ? "Strict" : m === "chaos" ? "Chaos" : "Bullet"}
                    </button>
                  ))}
                </div>
                {mode === "bullet" && (
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-slate-400">Clock</span>
                    {[1, 2, 3].map((min) => (
                      <button
                        key={min}
                        onClick={() => setClockMinutes(min)}
                        disabled={running}
                        className={clsx(
                          "rounded-md border px-2 py-1 text-xs sm:text-sm transition disabled:opacity-40 disabled:cursor-not-allowed",
                          clockMinutes === min
                            ? "border-arena-accent bg-arena-accent/20 text-white"
                            : "border-white/10 text-slate-300 hover:border-arena-accent/50"
                        )}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-2xl font-semibold">Arena</h2>
                <p className="text-slate-400 text-sm">{heroSubtitle}</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">
                  {mode === "strict" ? "Strict" : mode === "chaos" ? "Chaos" : `Bullet (${clockMinutes}m)`}
                </span>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(480px,840px)_minmax(440px,1fr)] items-start">
              <div className="flex flex-col gap-3 items-start w-full">
                <div className="bg-arena-card rounded-xl p-3 shadow-card transition-all duration-300 overflow-hidden space-y-0 w-full">
                  <div className="flex items-center justify-between text-sm text-slate-200 px-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>
                        {blackLabel} | Elo {Math.round(getElo(blackModel))} | Strikes {illegalState.black}/3
                      </span>
                      {mode === "bullet" && (
                        <span
                          className={clsx(
                            "rounded-md border px-2 py-0.5 font-mono text-xs",
                            activeTurn === "black"
                              ? "border-arena-accent/80 bg-arena-accent/10 text-white"
                              : "border-white/10 bg-white/5 text-slate-200"
                          )}
                        >
                          {formatClock(displayClocks.black)}
                        </span>
                      )}
                    </div>
                    <span className="text-slate-400">{moves.length ? `Ply ${moves.length}` : ""}</span>
                  </div>
                  <div ref={boardContainerRef} className="w-full max-w-[660px] mx-auto -mb-6">
                    <div className="w-full aspect-square">
                      <Chessboard
                        id="ai-chess-arena-board"
                        position={fen}
                        arePiecesDraggable={false}
                        boardWidth={boardWidthPx}
                        animationDuration={300}
                        customBoardStyle={{
                          boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                          marginBottom: "-12px"
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-200 px-1 -mt-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>
                        {whiteLabel} | Elo {Math.round(getElo(whiteModel))} | Strikes {illegalState.white}/3
                      </span>
                      {mode === "bullet" && (
                        <span
                          className={clsx(
                            "rounded-md border px-2 py-0.5 font-mono text-xs",
                            activeTurn === "white"
                              ? "border-arena-accent/80 bg-arena-accent/10 text-white"
                              : "border-white/10 bg-white/5 text-slate-200"
                          )}
                        >
                          {formatClock(displayClocks.white)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1 px-1">
                      <span>Live evaluation</span>
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="accent-arena-accent"
                          checked={evalEnabled}
                          onChange={(e) => {
                            setEvalEnabled(e.target.checked);
                            if (!e.target.checked) {
                              evalControllerRef.current?.abort();
                              setEvalStatus("Eval disabled");
                            } else {
                              queueEvaluation(fen);
                            }
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    </div>
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
                          ? `${whiteLabel} is thinking`
                          : `${blackLabel} is thinking`}
                      </span>
                      <span className="font-mono text-xs text-slate-400">...</span>
                    </>
                  ) : result ? (
                    <span>
                      Game over: {result.winner === "draw" ? "Draw" : `${currentWinnerLabel} wins`} ({currentReasonLabel})
                    </span>
                  ) : (
                    <span>Idle</span>
                  )}
                </div>
                <MoveLog
                  moves={moves}
                  whiteName={whiteLabel}
                  blackName={blackLabel}
                  latestIllegal={lastIllegalMove ?? undefined}
                />
              </div>
            </div>
          </div>



          <div className="grid gap-4 md:grid-cols-2">
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold">Result & Elo Change</h3>
                {pgnCopiedLabel && (
                  <span className="text-[11px] rounded-full bg-arena-accent/15 text-arena-accent px-2 py-1">
                    PGN copied: {pgnCopiedLabel}
                  </span>
                )}
              </div>
              {result ? (
                <div className="space-y-2 text-sm">
                  <p className="text-xl font-bold">
                    Winner:{" "}
                    <span className="text-arena-accent">
                      {result.winner === "draw" ? "Draw" : currentWinnerLabel}
                    </span>
                  </p>
                  <p className="text-slate-400">Reason: {currentReasonLabel}</p>
                  {currentIllegalNote && (
                    <p className="text-xs text-red-200">Illegal attempt: {currentIllegalNote}</p>
                  )}
                  {result.clocks && (
                    <p className="text-xs text-slate-300">
                      Clocks: White {formatClock(result.clocks.whiteMs)} / Black {formatClock(result.clocks.blackMs)}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">Final FEN: {result.finalFen}</p>
                  <div className="text-xs text-slate-300 space-y-1">
                    <div>
                      {whiteLabel} Elo: {Math.round(getElo(whiteModel))} ({lastEloDelta.white >= 0 ? "+" : ""}{lastEloDelta.white.toFixed(1)})
                    </div>
                    <div>
                      {blackLabel} Elo: {Math.round(getElo(blackModel))} ({lastEloDelta.black >= 0 ? "+" : ""}{lastEloDelta.black.toFixed(1)})
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
              </div>
              <div className="text-sm text-slate-300 space-y-2">
                <div className="flex justify-between">
                  <span>Estimated tokens (full game)</span>
                  <span className="font-mono text-white">
                    ~{estimatedTokens.input + estimatedTokens.output} (in {estimatedTokens.input} / out {estimatedTokens.output})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{whiteLabel} est. cost</span>
                  <span className="font-mono text-arena-accent">
                    {estCostWhite ? `$${estCostWhite.toFixed(4)}` : "n/a"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{blackLabel} est. cost</span>
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
                  Estimate uses a mid/late-game average; real costs still depend on verbosity, retries, and early resigns.
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

            <HistoryPanel
              history={[...history].reverse()}
              onCopyPgn={(pgn, label) => copyPgnText(pgn, label ?? "match-history")}
            />
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
