"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { getGroupedModels } from "@/lib/models";
import { MatchMode, MatchMoveEvent, MatchResult } from "@/lib/types";
import { EvalBar } from "@/components/eval-bar";

const Chessboard = dynamic(() => import("react-chessboard").then((mod) => mod.Chessboard), {
  ssr: false
});

type MatchCardState = {
  id: string;
  white: string;
  black: string;
  fen: string;
  moves: MatchMoveEvent[];
  status: string;
  running: boolean;
  result?: MatchResult;
  error?: string;
  controller?: AbortController;
  evalScore?: number | null;
  evalStatus?: string;
  lastEvalTs?: number;
};

const MAX_PARALLEL = 3;
const BASE_ELO = 1000;
const K_FACTOR = 24;

function buildPairings(models: string[]) {
  const pairs: Array<{ white: string; black: string; id: string }> = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const asWhite = (i + j) % 2 === 0 ? models[i] : models[j];
      const asBlack = asWhite === models[i] ? models[j] : models[i];
      pairs.push({ white: asWhite, black: asBlack, id: `${asWhite}_vs_${asBlack}_${pairs.length}` });
    }
  }
  return pairs;
}

function applyEloUpdate(
  elo: Record<string, number>,
  white: string,
  black: string,
  result: MatchResult
): Record<string, number> {
  const ra = elo[white] ?? BASE_ELO;
  const rb = elo[black] ?? BASE_ELO;
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
  return {
    ...elo,
    [white]: ra + K_FACTOR * (scoreA - expectedA),
    [black]: rb + K_FACTOR * (scoreB - expectedB)
  };
}

export default function TournamentPage() {
  const groupedModels = getGroupedModels();
  const [mode, setMode] = useState<MatchMode>("strict");
  const [selected, setSelected] = useState<string[]>([]);
  const [matches, setMatches] = useState<MatchCardState[]>([]);
  const [tStatus, setTStatus] = useState("Pick players and start the arena.");
  const [busy, setBusy] = useState(false);
  const [elo, setElo] = useState<Record<string, number>>({});
  const eloStorageKey = "elo-standings";

  const toggleSelect = (model: string) => {
    setSelected((prev) => (prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]));
  };

  const stopAll = () => {
    setMatches((prev) => {
      prev.forEach((m) => m.controller?.abort());
      return prev.map((m) => ({ ...m, running: false, controller: undefined, status: "Stopped" }));
    });
    setBusy(false);
    setTStatus("Tournament stopped.");
  };

  useEffect(() => {
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(eloStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Array<{ model: string; rating: number }>;
        if (Array.isArray(parsed)) {
          const mapped: Record<string, number> = {};
          parsed.forEach((row) => {
            mapped[row.model] = row.rating;
          });
          setElo(mapped);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const maybeEval = async (cardId: string, fen: string) => {
    let shouldEval = false;
    const now = Date.now();
    setMatches((prev) =>
      prev.map((m) => {
        if (m.id !== cardId) return m;
        if ((m.lastEvalTs ?? 0) + 5000 > now) return m;
        shouldEval = true;
        return { ...m, evalStatus: "Evaluating...", lastEvalTs: now };
      })
    );
    if (!shouldEval) return;
    try {
      const res = await fetch("https://chess-api.com/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen, depth: 12 })
      });
      if (!res.ok) throw new Error(`Eval failed (${res.status})`);
      const data = await res.json();
      let score: number | null = null;
      if (typeof data.eval === "number") score = data.eval;
      else if (data.centipawns) score = parseFloat(data.centipawns) / 100;
      setMatches((prev) =>
        prev.map((m) =>
          m.id === cardId
            ? {
                ...m,
                evalScore: score,
                evalStatus: data.text || "OK"
              }
            : m
        )
      );
    } catch (err: any) {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === cardId
            ? {
                ...m,
                evalStatus: err?.message || "Eval error"
              }
            : m
        )
      );
    }
  };

  const runMatch = async (cardId: string, white: string, black: string, mode: MatchMode) => {
    const controller = new AbortController();
    setMatches((prev) =>
      prev.map((m) =>
        m.id === cardId
          ? {
              ...m,
              controller,
              running: true,
              status: "Starting..."
            }
          : m
      )
    );

    try {
      const response = await fetch("/api/match", {
        method: "POST",
        body: JSON.stringify({ whiteModel: white, blackModel: black, mode }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Match failed to start (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "status") {
              setMatches((prev) =>
                prev.map((m) => (m.id === cardId ? { ...m, status: evt.message, error: undefined } : m))
              );
            } else if (evt.type === "move") {
              setMatches((prev) =>
                prev.map((m) =>
                  m.id === cardId
                    ? {
                        ...m,
                        fen: evt.fen,
                        moves: [...m.moves, evt],
                        status: evt.note ? evt.note : `Move ${evt.move}`
                      }
                    : m
                )
              );
              if (evt.fen) {
                maybeEval(cardId, evt.fen);
              }
            } else if (evt.type === "end") {
              setMatches((prev) =>
                prev.map((m) =>
                  m.id === cardId
                    ? {
                        ...m,
                        result: evt.result,
                        status: `Winner: ${evt.result.winner} (${evt.result.reason})`,
                        running: false,
                        controller: undefined,
                        fen: evt.result.finalFen
                      }
                    : m
                )
              );
              if (evt.result?.finalFen) {
                maybeEval(cardId, evt.result.finalFen);
              }
              setElo((prev) => {
                const updated = applyEloUpdate(prev, white, black, evt.result);
                const standings = Object.entries(updated)
                  .map(([model, rating]) => ({ model, rating }))
                  .sort((a, b) => b.rating - a.rating);
                try {
                  localStorage.setItem(eloStorageKey, JSON.stringify(standings));
                } catch {
                  // ignore
                }
                return updated;
              });
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMatches((prev) =>
          prev.map((m) =>
            m.id === cardId ? { ...m, running: false, controller: undefined, status: "Aborted" } : m
          )
        );
      } else {
        setMatches((prev) =>
          prev.map((m) =>
            m.id === cardId
              ? { ...m, running: false, controller: undefined, status: "Error", error: String(err) }
              : m
          )
        );
      }
    }
  };

  const startTournament = async () => {
    if (selected.length < 2) {
      setTStatus("Pick at least two players.");
      return;
    }
    const pairings = buildPairings(selected);
    if (!pairings.length) {
      setTStatus("No pairings generated.");
      return;
    }
    setElo((prev) => {
      const next = { ...prev };
      selected.forEach((m) => {
        if (next[m] === undefined) next[m] = BASE_ELO;
      });
      return next;
    });
    const initial: MatchCardState[] = pairings.map((p) => ({
      id: p.id,
      white: p.white,
      black: p.black,
      fen: "start",
      moves: [],
      status: "Queued",
      running: false,
      evalScore: null,
      evalStatus: "Idle",
      lastEvalTs: 0
    }));
    setMatches(initial);
    setBusy(true);
    setTStatus(`Running ${pairings.length} matches (${Math.min(MAX_PARALLEL, pairings.length)} at a time)...`);

    let cursor = 0;
    let active = 0;

    const runNext = async (): Promise<void> => {
      if (cursor >= pairings.length) return;
      const pairing = pairings[cursor++];
      active += 1;
      await runMatch(pairing.id, pairing.white, pairing.black, mode);
      active -= 1;
      if (cursor < pairings.length) {
        await runNext();
      }
    };

    const starters = Array.from({ length: Math.min(MAX_PARALLEL, pairings.length) }, () => runNext());
    await Promise.all(starters);
    setBusy(false);
    setTStatus("Tournament finished.");
  };

  const allCompleted = useMemo(
    () => matches.length > 0 && matches.every((m) => !m.running && !!m.result),
    [matches]
  );

  return (
    <main className="min-h-screen bg-arena-bg bg-[radial-gradient(circle_at_20%_10%,rgba(77,208,225,0.06),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(167,139,250,0.08),transparent_22%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-arena-accent">Tournament Mode</p>
          <h1 className="text-4xl md:text-5xl font-extrabold">Multi-Board Showdown</h1>
          <p className="text-slate-300 max-w-3xl">
            Pick your engines by provider, spin up parallel matches, and watch every board live.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Players</h2>
                <p className="text-slate-400 text-sm">Grouped by provider for quick picks.</p>
              </div>
              <span className="text-xs text-slate-400">{selected.length} selected</span>
            </div>

            <div className="space-y-3 max-h-[420px] overflow-auto pr-2">
              {Object.entries(groupedModels).map(([provider, list]) => (
                <div key={provider} className="rounded-lg border border-white/5 bg-white/5 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-white">{provider}</span>
                    <span className="text-[11px] text-slate-400">{list.length} models</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {list.map((m) => (
                      <label
                        key={m.value}
                        className={clsx(
                          "flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer border transition",
                          selected.includes(m.value)
                            ? "border-arena-accent/60 bg-arena-accent/10"
                            : "border-white/5 hover:border-arena-accent/40"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="accent-arena-accent"
                          checked={selected.includes(m.value)}
                          onChange={() => toggleSelect(m.value)}
                        />
                        <span className="text-sm text-white flex-1">
                          {m.label}{" "}
                          <span className="text-[11px] text-slate-400">Elo {Math.round(elo[m.value] ?? BASE_ELO)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setMode(mode === "strict" ? "chaos" : "strict")}
                className="rounded-md border border-white/10 px-3 py-2 text-sm hover:border-arena-accent"
              >
                Mode: {mode === "strict" ? "Strict" : "Chaos"}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={stopAll}
                  className="rounded-md border border-white/10 px-3 py-2 text-sm hover:border-arena-accent disabled:opacity-50"
                  disabled={matches.length === 0}
                >
                  Stop All
                </button>
                <button
                  onClick={startTournament}
                  disabled={busy}
                  className="rounded-md bg-arena-accent px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-50"
                >
                  {busy ? "Running..." : "Start Tournament"}
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-400">{tStatus}</p>
          </div>

          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Live Boards</h2>
                <p className="text-slate-400 text-sm">
                  Watching {matches.filter((m) => m.running).length}/{matches.length} active matches.
                </p>
              </div>
              {allCompleted && <span className="text-xs text-arena-accent">Complete</span>}
            </div>

            {matches.length === 0 && (
              <div className="text-slate-400 text-sm">Select players to generate pairings.</div>
            )}

            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
            {matches.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col gap-2 shadow-card"
              >
                <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-300">
                        <span className="text-white font-semibold">
                          {m.white} (Elo {Math.round(elo[m.white] ?? BASE_ELO)})
                        </span>{" "}
                        vs{" "}
                        <span className="text-white font-semibold">
                          {m.black} (Elo {Math.round(elo[m.black] ?? BASE_ELO)})
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">{m.status}</p>
                    </div>
                    <span
                      className={clsx(
                        "text-[11px] px-2 py-1 rounded-full border",
                        m.running
                          ? "border-arena-accent text-arena-accent"
                          : m.result
                          ? "border-green-300 text-green-200"
                          : "border-slate-500 text-slate-400"
                      )}
                    >
                      {m.running ? "Live" : m.result ? "Done" : "Queued"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <EvalBar evalScore={m.evalScore ?? null} status={m.evalStatus ?? "Idle"} />
                    <div className="flex flex-col gap-1">
                      <div className="text-[11px] text-slate-300 flex items-center justify-between px-1">
                        <span className="truncate">Black: {m.black}</span>
                        <span className="font-mono text-slate-400">{Math.round(elo[m.black] ?? BASE_ELO)}</span>
                      </div>
                      <div className="w-full mx-auto max-w-[220px] aspect-square rounded-lg bg-arena-card flex items-center justify-center p-2 overflow-hidden">
                        <Chessboard
                          id={`board-${m.id}`}
                          position={m.fen}
                          arePiecesDraggable={false}
                          boardWidth={180}
                          animationDuration={200}
                          customBoardStyle={{
                            borderRadius: "10px",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.35)"
                          }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-300 flex items-center justify-between px-1">
                        <span className="truncate">White: {m.white}</span>
                        <span className="font-mono text-slate-400">{Math.round(elo[m.white] ?? BASE_ELO)}</span>
                      </div>
                    </div>
                  </div>

                  {m.result && (
                    <div className="text-xs text-slate-300">
                      <div>
                        Winner:{" "}
                        <span className="text-arena-accent">
                          {m.result.winner === "draw" ? "Draw" : m.result.winner}
                        </span>
                      </div>
                      <div className="text-slate-400">Reason: {m.result.reason}</div>
                    </div>
                  )}

                  {m.error && <div className="text-xs text-red-300">Error: {m.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
