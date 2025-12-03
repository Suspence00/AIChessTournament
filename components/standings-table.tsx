import { TournamentStanding } from "@/lib/types";

interface Props {
  standings: TournamentStanding[];
}

export function StandingsTable({ standings }: Props) {
  if (!standings.length) {
    return (
      <div className="glass rounded-xl p-4 text-sm text-slate-400">
        Run a tournament to see rankings.
      </div>
    );
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="text-lg font-semibold">Tournament Rankings</h3>
        <span className="text-xs text-slate-400">{standings.length} models</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-center">Elo</th>
              <th className="px-3 py-2 text-center">Pts</th>
              <th className="px-3 py-2 text-center">W</th>
              <th className="px-3 py-2 text-center">D</th>
              <th className="px-3 py-2 text-center">L</th>
              <th className="px-3 py-2 text-center">Mate</th>
              <th className="px-3 py-2 text-center">Illegal</th>
              <th className="px-3 py-2 text-center">TO</th>
              <th className="px-3 py-2 text-center">Resign</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => (
              <tr key={row.model} className="odd:bg-arena-card/60">
                <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                <td className="px-3 py-2 font-semibold">{row.model}</td>
                <td className="px-3 py-2 text-center font-mono">{Math.round(row.rating)}</td>
                <td className="px-3 py-2 text-center font-mono">{row.points.toFixed(1)}</td>
                <td className="px-3 py-2 text-center">{row.wins}</td>
                <td className="px-3 py-2 text-center">{row.draws}</td>
                <td className="px-3 py-2 text-center text-slate-400">{row.losses}</td>
                <td className="px-3 py-2 text-center">{row.checkmates}</td>
                <td className="px-3 py-2 text-center">{row.illegalForfeits}</td>
                <td className="px-3 py-2 text-center">{row.timeouts}</td>
                <td className="px-3 py-2 text-center">{row.resignations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
