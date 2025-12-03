import { TournamentMatch } from "@/lib/types";
import clsx from "clsx";

interface Props {
  matches: TournamentMatch[];
}

export function TournamentMatches({ matches }: Props) {
  if (!matches.length) {
    return (
      <div className="glass rounded-xl p-4 text-sm text-slate-400">
        No tournament games yet.
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Game Results</h3>
        <span className="text-xs text-slate-400">{matches.length} games</span>
      </div>
      <div className="space-y-2 text-sm">
        {matches.map((m, idx) => (
          <div
            key={`${m.white}-${m.black}-${idx}`}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.white}</span>
                <span className="text-slate-500">vs</span>
                <span className="font-semibold">{m.black}</span>
              </div>
              <span
                className={clsx(
                  "rounded-full px-2 py-1 text-xs font-semibold",
                  m.result.winner === "draw"
                    ? "bg-yellow-500/20 text-yellow-200"
                    : "bg-arena-accent/20 text-arena-accent"
                )}
              >
                {m.result.winner === "draw"
                  ? "Draw"
                  : m.result.winner === "white"
                  ? `${m.white} wins`
                  : `${m.black} wins`}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Reason: {m.result.reason} • Moves: {m.result.moves.length} • PGN length:{" "}
              {m.result.pgn.length}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
