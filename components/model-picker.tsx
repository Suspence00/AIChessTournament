import { useMemo, useState } from "react";
import clsx from "clsx";
import { ArenaModelOption } from "@/lib/types";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ArenaModelOption[];
}

type SortMode = "provider" | "price";

function formatCost(model: ArenaModelOption) {
  if (model.inputCostPerMTokens === undefined || model.outputCostPerMTokens === undefined) return "n/a";
  return `$${model.inputCostPerMTokens.toFixed(2)}/M in · $${model.outputCostPerMTokens.toFixed(2)}/M out`;
}

function effectiveCost(model: ArenaModelOption) {
  const inCost = model.inputCostPerMTokens ?? Number.POSITIVE_INFINITY;
  const outCost = model.outputCostPerMTokens ?? Number.POSITIVE_INFINITY;
  return inCost + outCost;
}

export function ModelPicker({ label, value, onChange, options }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("provider");
  const grouped = useMemo(() => {
    const groups: Record<string, ArenaModelOption[]> = {};
    options.forEach((m) => {
      const provider = m.provider || "Other";
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m);
    });
    return groups;
  }, [options]);

  const sortedGroups =
    sortMode === "provider"
      ? grouped
      : {
          Cheapest: options
            .slice()
            .sort((a, b) => effectiveCost(a) - effectiveCost(b))
        };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-300 text-sm">{label}</span>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="text-xs rounded-md bg-arena-card border border-white/10 px-2 py-1 text-slate-200"
        >
          <option value="provider">Group by provider</option>
          <option value="price">Sort by price</option>
        </select>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 max-h-[520px] overflow-auto space-y-3">
        {Object.entries(sortedGroups).map(([provider, models]) => (
          <div key={provider} className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span className="font-semibold text-white text-sm">{provider}</span>
              <span>{models.length} models</span>
            </div>
            <div className="grid gap-2">
              {models.map((m) => {
                const selected = value === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => onChange(m.value)}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2 transition",
                      selected
                        ? "border-arena-accent bg-arena-accent/10 shadow-[0_0_0_1px_rgba(0,255,255,0.25)]"
                        : "border-white/10 hover:border-arena-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-white font-semibold text-sm">{m.label}</div>
                      <div className="text-[11px] text-slate-400">{m.context ?? ""}</div>
                    </div>
                    <div className="text-xs text-slate-400">{formatCost(m)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
