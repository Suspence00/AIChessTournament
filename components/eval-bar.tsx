type Orientation = "vertical" | "horizontal";

interface Props {
  evalScore: number | null; // in pawns (positive = white better, negative = black better)
  status?: string;
  orientation?: Orientation;
}

function normalize(evalScore: number) {
  // clamp and convert to 0-1; +50 pawns = 1, -50 = 0
  const clamped = Math.max(-50, Math.min(50, evalScore));
  return (clamped + 50) / 100;
}

export function EvalBar({ evalScore, status, orientation = "vertical" }: Props) {
  const fraction = evalScore === null ? 0.5 : normalize(evalScore);
  const whitePerc = Math.round(fraction * 100);
  const blackPerc = 100 - whitePerc;

  if (orientation === "horizontal") {
    return (
      <div className="flex flex-col gap-2 text-xs text-slate-300 w-full">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Black</span>
          <span>White</span>
        </div>
        <div className="relative w-full h-3 rounded-full bg-slate-900 overflow-hidden border border-white/15 shadow-card">
          <div
            className="absolute inset-y-0 left-0 bg-black transition-all duration-300"
            style={{ width: `${blackPerc}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-white transition-all duration-300"
            style={{ width: `${whitePerc}%` }}
          />
        </div>
        <div className="text-[11px] text-slate-400 text-center leading-tight">
          {evalScore === null ? "N/A" : `${evalScore.toFixed(2)} pawns`}
        </div>
        {status && <div className="text-[10px] text-slate-500 text-center w-full line-clamp-2">{status}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-xs text-slate-300 w-16">
      <span className="text-[11px] text-slate-400">Black</span>
      <div className="relative w-10 h-72 rounded-xl bg-slate-900 overflow-hidden border border-white/15 shadow-card">
        <div
          className="absolute bottom-0 left-0 right-0 bg-white transition-all duration-300"
          style={{ height: `${whitePerc}%` }}
        />
        <div
          className="absolute top-0 left-0 right-0 bg-black transition-all duration-300"
          style={{ height: `${blackPerc}%` }}
        />
      </div>
      <span className="text-[11px] text-slate-400">White</span>
      <div className="text-[11px] text-slate-400 text-center w-full leading-tight">
        {evalScore === null ? "N/A" : `${evalScore.toFixed(2)} pawns`}
      </div>
      {status && <div className="text-[10px] text-slate-500 text-center w-full line-clamp-2">{status}</div>}
    </div>
  );
}
