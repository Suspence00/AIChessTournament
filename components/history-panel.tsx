import { MatchHistoryEntry } from "@/lib/types";
import clsx from "clsx";

interface Props {
  history: MatchHistoryEntry[];
  onCopyPgn?: (pgn: string, label?: string) => void;
}

function formatPlayedAt(ts: number) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function HistoryPanel({ history, onCopyPgn }: Props) {
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
        {history.map((match) => (
          <div
            key={match.id}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <span className="truncate">{match.white.label}</span>
                  <span className="text-slate-500 font-normal">vs</span>
                  <span className="truncate">{match.black.label}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {formatPlayedAt(match.playedAt)} - {match.mode === "bullet" ? `Bullet ${match.clockMinutes ?? 3}m` : match.mode.charAt(0).toUpperCase() + match.mode.slice(1)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={clsx(
                    "rounded-full px-2 py-1 text-[11px] font-semibold",
                    match.result.winner === "draw"
                      ? "bg-yellow-500/20 text-yellow-100"
                      : "bg-arena-accent/20 text-arena-accent"
                  )}
                >
                  {match.result.winner === "draw" ? "Draw" : "Win"}
                </span>
                <span className="text-xs text-slate-300 font-semibold text-right">
                  {match.result.winner === "draw" ? "Draw" : `Winner: ${match.winnerLabel}`}
                </span>
              </div>
            </div>
            <div className="text-xs text-slate-400">
              Reason: <span className="text-slate-200">{match.reasonLabel}</span>
            </div>
            {match.illegalNote && (
              <div className="text-[11px] text-red-200">
                Illegal attempt: {match.illegalNote}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="truncate">Moves: {match.result.moves.join(" ")}</span>
              {onCopyPgn && match.result.pgn && (
                <button
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-200 hover:border-arena-accent"
                  onClick={() => onCopyPgn(match.result.pgn, `${match.white.label} vs ${match.black.label}`)}
                >
                  Copy PGN
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
