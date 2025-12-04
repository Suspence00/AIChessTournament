"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { getGroupedModels } from "@/lib/models";
import { MatchMode, MatchMoveEvent, MatchResult } from "@/lib/types";

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
};

const MAX_PARALLEL = 3;
const BASE_ELO = 1000;
const K_FACTOR = 24;
const LONG_STATUS_THRESHOLD = 80;

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
  const [clockMinutes, setClockMinutes] = useState(3);
  const [selected, setSelected] = useState<string[]>([]);
  const [matches, setMatches] = useState<MatchCardState[]>([]);
  const [tStatus, setTStatus] = useState("Pick players and start the arena.");
  const [busy, setBusy] = useState(false);
  const [elo, setElo] = useState<Record<string, number>>({});
  const eloStorageKey = "elo-standings";

  const toggleSelect = (model: string) => {
    setSelected((prev) => (prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]));
  };

  const formatStatus = (message?: string) => {
    const cleaned = (message ?? "").trim().replace(/\s+/g, " ");
    if (!cleaned) return "";
    if (cleaned.length > LONG_STATUS_THRESHOLD || cleaned.includes("\n")) {
      return "non single token response";
    }
    return cleaned;
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

  const runMatch = async (cardId: string, white: string, black: string, mode: MatchMode) => {
    const controller = new AbortController();
    const bulletMinutes = Math.min(3, Math.max(1, clockMinutes));
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
        body: JSON.stringify({
          whiteModel: white,
          blackModel: black,
          mode,
          clockMinutes: mode === "bullet" ? bulletMinutes : undefined
        }),
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
                prev.map((m) =>
                  m.id === cardId
                    ? {
                        ...m,
                        status: formatStatus(evt.message) || "Status update",
                        error: undefined
                      }
                    : m
                )
              );
            } else if (evt.type === "move") {
              setMatches((prev) =>
                prev.map((m) =>
                  m.id === cardId
                    ? {
                        ...m,
                        fen: evt.fen,
                        moves: [...m.moves, evt],
                        status: formatStatus(evt.note) || `Move ${evt.move}`
                      }
                    : m
                )
              );
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
      running: false
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

  const records = useMemo(() => {
    const map: Record<string, { wins: number; losses: number; draws: number }> = {};
    const ensure = (model: string) => {
      if (!map[model]) {
        map[model] = { wins: 0, losses: 0, draws: 0 };
      }
      return map[model];
    };
    matches.forEach((m) => {
      ensure(m.white);
      ensure(m.black);
      if (!m.result) return;
      if (m.result.winner === "white") {
        map[m.white].wins += 1;
        map[m.black].losses += 1;
      } else if (m.result.winner === "black") {
        map[m.black].wins += 1;
        map[m.white].losses += 1;
      } else {
        map[m.white].draws += 1;
        map[m.black].draws += 1;
      }
    });
    return Object.entries(map)
      .map(([model, rec]) => ({ model, ...rec }))
      .sort(
        (a, b) =>
          b.wins - a.wins || a.losses - b.losses || b.draws - a.draws || a.model.localeCompare(b.model)
      );
  }, [matches]);

  const rounds = useMemo(() => {
    const groups: MatchCardState[][] = [];
    matches.forEach((match, idx) => {
      const roundIdx = Math.floor(idx / 3);
      if (!groups[roundIdx]) groups[roundIdx] = [];
      groups[roundIdx].push(match);
    });
    return groups;
  }, [matches]);

  return (
    <main className="min-h-screen bg-arena-bg bg-[radial-gradient(circle_at_20%_10%,rgba(77,208,225,0.06),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(167,139,250,0.08),transparent_22%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.3em] text-arena-accent">Tournament Mode</p>
              <h1 className="text-4xl md:text-5xl font-extrabold">Multi-Board Showdown</h1>
              <p className="text-slate-300 max-w-3xl">
                Pick your engines by provider, spin up parallel matches, and watch every board live.
              </p>
            </div>
            <a
              href="/"
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white border border-white/20 hover:border-arena-accent hover:bg-arena-accent/20 transition"
            >
              Single Game Mode
            </a>
          </div>
        </header>

        <section className="flex flex-col gap-6">
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

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-300">Mode</span>
                  <div className="flex gap-2">
                    {(["strict", "chaos", "bullet"] as MatchMode[]).map((m) => (
                      <button
                        key={m}
                        disabled={busy}
                        onClick={() => setMode(m)}
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
                </div>
                {mode === "bullet" && (
                  <div className="flex items-center gap-1 text-xs sm:text-sm">
                    <span className="text-slate-400">Clock</span>
                    {[1, 2, 3].map((min) => (
                      <button
                        key={min}
                        disabled={busy}
                        onClick={() => setClockMinutes(min)}
                        className={clsx(
                          "rounded-md border px-2 py-1 transition disabled:opacity-40 disabled:cursor-not-allowed",
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

            <p className="text-xs text-slate-400">
              {mode === "bullet" ? `${tStatus} - Bullet ${clockMinutes}m clocks` : tStatus}
            </p>
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

            {rounds.map((roundMatches, roundIdx) => (
              <div key={`round-${roundIdx}`} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Round {roundIdx + 1}</span>
                    <span className="text-[11px] text-slate-400">
                      {roundMatches.filter((m) => m.running).length} live / {roundMatches.length} games
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {roundMatches.every((m) => m.result) ? "Finished" : "In progress"}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {roundMatches.map((m) => {
                    const winnerName =
                      m.result?.winner === "white"
                        ? m.white
                        : m.result?.winner === "black"
                        ? m.black
                        : "Draw";
                    const winnerLabel = m.result ? (m.result.winner === "draw" ? "Draw" : `${winnerName} wins`) : "";

                    return (
                      <div
                        key={m.id}
                        className={clsx(
                          "rounded-xl border bg-white/5 p-3 flex flex-col gap-3 shadow-card transition-shadow",
                          m.running && "border-arena-accent/60 shadow-[0_0_0_1px_rgba(125,249,255,0.2)]",
                          m.result ? "border-green-400/40 ring-1 ring-green-300/40" : "border-white/10"
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 pr-2">
                            <p className="text-sm text-slate-200 leading-snug line-clamp-2">
                              <span
                                className={clsx(
                                  "font-semibold",
                                  m.result?.winner === "white" && "text-white"
                                )}
                              >
                                {m.white} (Elo {Math.round(elo[m.white] ?? BASE_ELO)})
                              </span>
                              <span className="text-slate-500"> vs </span>
                              <span
                                className={clsx(
                                  "font-semibold",
                                  m.result?.winner === "black" && "text-white"
                                )}
                              >
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

                        {m.result && (
                          <div
                            className={clsx(
                              "rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide self-start",
                              m.result.winner === "draw"
                                ? "bg-yellow-500/20 text-yellow-100"
                                : "bg-green-500/20 text-green-100"
                            )}
                          >
                            {winnerLabel}
                          </div>
                        )}

                        <div className="flex flex-col gap-2">
                          <div className="text-[11px] text-slate-300 flex items-center justify-between px-1">
                            <span
                              className={clsx(
                                "truncate",
                                m.result?.winner === "black" && "text-white font-semibold"
                              )}
                            >
                              Black: {m.black}
                            </span>
                            <span className="font-mono text-slate-400">
                              {Math.round(elo[m.black] ?? BASE_ELO)}
                            </span>
                          </div>
                          <div className="w-full mx-auto max-w-[260px] flex items-center justify-center p-1">
                            <Chessboard
                              id={`board-${m.id}`}
                              position={m.fen}
                              arePiecesDraggable={false}
                              boardWidth={220}
                              animationDuration={200}
                              customBoardStyle={{
                                boxShadow: "0 6px 18px rgba(0,0,0,0.35)"
                              }}
                            />
                          </div>
                          <div className="text-[11px] text-slate-300 flex items-center justify-between px-1">
                            <span
                              className={clsx(
                                "truncate",
                                m.result?.winner === "white" && "text-white font-semibold"
                              )}
                            >
                              White: {m.white}
                            </span>
                            <span className="font-mono text-slate-400">
                              {Math.round(elo[m.white] ?? BASE_ELO)}
                            </span>
                          </div>
                        </div>

                        {m.result && (
                          <div className="text-xs text-slate-300 rounded-lg border border-white/10 bg-white/5 px-2 py-2">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">Result</span>
                              <span
                                className={clsx(
                                  "rounded-full px-2 py-1 text-[11px]",
                                  m.result.winner === "draw"
                                    ? "bg-yellow-500/20 text-yellow-100"
                                    : "bg-arena-accent/20 text-arena-accent font-semibold"
                                )}
                              >
                                {winnerLabel}
                              </span>
                            </div>
                            <div className="text-slate-400 mt-1">Reason: {m.result.reason}</div>
                          </div>
                        )}

                        {m.error && <div className="text-xs text-red-300">Error: {m.error}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="glass rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Bracket & Records</h2>
                <p className="text-slate-400 text-sm">Quick snapshot of each pairing and running W/L/D.</p>
              </div>
              <span className="text-xs text-slate-400">
                {matches.filter((m) => m.result).length}/{matches.length} finished
              </span>
            </div>

            {rounds.length === 0 && (
              <div className="text-slate-400 text-sm">No bracket yet. Add players and start a tournament.</div>
            )}

            {rounds.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-3">
                  {rounds.map((roundMatches, idx) => (
                    <div key={`bracket-${idx}`} className="space-y-2">
                      <div className="text-sm font-semibold text-white">Round {idx + 1}</div>
                      <div className="space-y-2">
                        {roundMatches.map((m) => {
                          const winnerName =
                            m.result?.winner === "white"
                              ? m.white
                              : m.result?.winner === "black"
                              ? m.black
                              : "Draw";
                          const statusLabel = m.result
                            ? m.result.winner === "draw"
                              ? "Draw"
                              : `${winnerName} wins`
                            : m.running
                            ? "Live"
                            : "Pending";
                          return (
                            <div
                              key={`bracket-match-${m.id}`}
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between"
                            >
                              <div className="flex flex-col text-sm text-slate-200 gap-1">
                                <span className="truncate">
                                  {m.white} <span className="text-slate-500">vs</span> {m.black}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {m.result ? `Reason: ${m.result.reason}` : m.status}
                                </span>
                              </div>
                              <span
                                className={clsx(
                                  "rounded-full px-2 py-1 text-[11px] font-semibold",
                                  m.result
                                    ? m.result.winner === "draw"
                                      ? "bg-yellow-500/20 text-yellow-100"
                                      : "bg-green-500/20 text-green-100"
                                    : m.running
                                    ? "bg-arena-accent/20 text-arena-accent"
                                    : "bg-slate-700 text-slate-200"
                                )}
                              >
                                {statusLabel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="text-sm font-semibold text-white">W/L/D by Bot</span>
                    <span className="text-[11px] text-slate-400">{records.length} bots</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {records.map((rec) => (
                      <div
                        key={`record-${rec.model}`}
                        className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm text-slate-200"
                      >
                        <span className="truncate text-white">{rec.model}</span>
                        <span className="text-green-200 font-semibold">W {rec.wins}</span>
                        <span className="text-yellow-200">D {rec.draws}</span>
                        <span className="text-red-200">L {rec.losses}</span>
                      </div>
                    ))}
                    {records.length === 0 && (
                      <div className="px-3 py-3 text-sm text-slate-400">No results yet.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
