import { MatchResult } from "@/lib/types";
import clsx from "clsx";

interface Props {
  history: MatchResult[];
}

export function HistoryPanel({ history }: Props) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Recent Matches</h3>
        <span className="text-xs text-slate-400">{history.length} stored</span>
      </div>
      <div className="space-y-2 text-sm">
        {history.length === 0 && (
          <p className="text-slate-400">Play a match to see it logged here.</p>
        )}
        {history.map((match, idx) => (
          <div
            key={`${match.finalFen}-${idx}`}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "h-2.5 w-2.5 rounded-full",
                    match.winner === "draw" ? "bg-yellow-400" : "bg-arena-accent"
                  )}
                />
                <span className="font-semibold">
                  Winner: {match.winner === "draw" ? "Draw" : match.winner}
                </span>
              </div>
              <span className="text-xs text-slate-400">{match.reason}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400 truncate">
              Moves: {match.moves.join(" ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
