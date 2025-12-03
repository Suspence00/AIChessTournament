import { MatchMoveEvent } from "@/lib/types";
import clsx from "clsx";

interface Props {
  moves: MatchMoveEvent[];
  whiteName?: string;
  blackName?: string;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function MoveLog({ moves, whiteName = "White", blackName = "Black" }: Props) {
  // Group moves by move number (pair white and black)
  const groupedMoves: Array<{ white?: MatchMoveEvent; black?: MatchMoveEvent; moveNum: number }> = [];
  const isIllegal = (move?: MatchMoveEvent) =>
    !!move &&
    ((move.note && (move.note.toLowerCase().includes("illegal") || move.note.toLowerCase().includes("invalid"))) ||
      (move.san?.startsWith("?") ?? false) ||
      (move.san?.startsWith("❌") ?? false));

  moves.forEach(move => {
    const moveNum = move.displayMoveNum ?? Math.floor(move.ply / 2) + 1;
    let group = groupedMoves.find(g => g.moveNum === moveNum);

    if (!group) {
      group = { moveNum };
      groupedMoves.push(group);
    }

    if (move.activeColor === "white") {
      group.white = move;
    } else {
      group.black = move;
    }
  });

  return (
    <div className="glass rounded-xl p-4 max-h-[420px] overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">Live Moves</h3>
        <span className="text-xs text-slate-400">{moves.length} plies</span>
      </div>

      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-2 items-center py-1 border-b border-white/10 text-xs text-slate-300 mb-1">
        <span className="text-slate-400 font-semibold text-right min-w-[32px]"></span>
        <span className="flex items-center gap-2">
          <span className="text-[12px]">⚪</span>
          <span className="font-semibold truncate">{whiteName}</span>
        </span>
        <span></span>
        <span className="flex items-center gap-2 border-l border-white/10 pl-2">
          <span className="text-[12px]">⚫</span>
          <span className="font-semibold truncate">{blackName}</span>
        </span>
        <span></span>
      </div>

      <div className="space-y-1 text-sm">
        {groupedMoves.map(({ white, black, moveNum }) => (
          <div
            key={moveNum}
            className="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-2 items-center py-1 border-b border-white/5"
          >
            {/* Move number */}
            <span className="text-slate-400 font-semibold text-right min-w-[32px]">{moveNum}.</span>

            {/* White move */}
            {white ? (
              <>
                <span className="flex items-center gap-2 min-w-[96px]">
                  <span className="text-xs text-white">⚪</span>
                  <span
                    title={white.note || white.san || white.move}
                    className={clsx(
                      "font-mono whitespace-nowrap truncate max-w-[96px] inline-block",
                      isIllegal(white) ? "text-red-300 line-through" : "text-white"
                    )}
                  >
                    {white.san ?? white.move}
                  </span>
                </span>
                <span className="text-xs text-slate-500 text-right min-w-[48px]">
                  {formatTime(white.timestamp)}
                </span>
              </>
            ) : (
              <>
                <span className="text-slate-600">...</span>
                <span className="text-xs text-slate-600 text-right min-w-[48px]">—</span>
              </>
            )}

            {/* Black move */}
            {black ? (
              <>
                <span className="flex items-center gap-2 min-w-[96px] border-l border-white/10 pl-2">
                  <span className="text-xs text-white">⚫</span>
                  <span
                    title={black.note || black.san || black.move}
                    className={clsx(
                      "font-mono whitespace-nowrap truncate max-w-[96px] inline-block",
                      isIllegal(black) ? "text-red-300 line-through" : "text-white"
                    )}
                  >
                    {black.san ?? black.move}
                  </span>
                </span>
                <span className="text-xs text-slate-500 text-right min-w-[48px]">
                  {formatTime(black.timestamp)}
                </span>
              </>
            ) : (
              <>
                <span></span>
                <span></span>
              </>
            )}
          </div>
        ))}

        {moves.length === 0 && (
          <div className="text-slate-400 text-sm py-2">Moves will stream in once the match starts.</div>
        )}
      </div>
    </div>
  );
}
