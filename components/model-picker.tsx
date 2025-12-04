import { useMemo, useState, useRef, useEffect } from "react";
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
  return `$${model.inputCostPerMTokens.toFixed(2)}/M · $${model.outputCostPerMTokens.toFixed(2)}/M`;
}

function effectiveCost(model: ArenaModelOption) {
  const inCost = model.inputCostPerMTokens ?? Number.POSITIVE_INFINITY;
  const outCost = model.outputCostPerMTokens ?? Number.POSITIVE_INFINITY;
  return inCost + outCost;
}

export function ModelPicker({ label, value, onChange, options }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("provider");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedModel = options.find((m) => m.value === value);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const lower = search.toLowerCase();
    return options.filter(
      (m) =>
        m.label.toLowerCase().includes(lower) ||
        m.value.toLowerCase().includes(lower) ||
        m.provider?.toLowerCase().includes(lower)
    );
  }, [options, search]);

  const grouped = useMemo(() => {
    if (sortMode === "price") {
      return {
        "All Models": filteredOptions.slice().sort((a, b) => effectiveCost(a) - effectiveCost(b))
      };
    }
    const groups: Record<string, ArenaModelOption[]> = {};
    filteredOptions.forEach((m) => {
      const provider = m.provider || "Other";
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m);
    });
    return groups;
  }, [filteredOptions, sortMode]);

  return (
    <div className="flex flex-col gap-2 relative" ref={dropdownRef}>
      <span className="text-slate-300 text-sm font-medium">{label}</span>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          "flex items-center justify-between w-full rounded-xl border px-4 py-3 text-left transition-all",
          isOpen
            ? "border-arena-accent bg-arena-accent/5 ring-1 ring-arena-accent/50"
            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
        )}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-white text-base">
            {selectedModel?.label || "Select Model"}
          </span>
          <span className="text-xs text-slate-400">
            {selectedModel?.provider || "Unknown"} · {selectedModel?.context || "?"} context
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs font-mono text-arena-accent/80">
            {selectedModel ? formatCost(selectedModel) : ""}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={clsx("w-5 h-5 text-slate-400 transition-transform", isOpen && "rotate-180")}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl flex flex-col max-h-[400px] overflow-hidden animate-fade-in">
          <div className="p-3 border-b border-white/10 bg-white/5 flex gap-2">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-slate-500"
            />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="bg-transparent text-xs text-slate-400 outline-none cursor-pointer hover:text-white"
            >
              <option value="provider">By Provider</option>
              <option value="price">By Price</option>
            </select>
          </div>

          <div className="overflow-y-auto p-2 space-y-4">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div className="px-2 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider sticky top-0 bg-[#1a1a1a]/95 backdrop-blur-sm z-10">
                  {group}
                </div>
                <div className="space-y-1 mt-1">
                  {items.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => {
                        onChange(m.value);
                        setIsOpen(false);
                      }}
                      className={clsx(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group",
                        value === m.value
                          ? "bg-arena-accent/10 text-white"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      <div className="flex flex-col">
                        <span className={clsx("font-medium", value === m.value && "text-arena-accent")}>
                          {m.label}
                        </span>
                        <span className="text-[10px] text-slate-500 group-hover:text-slate-400">
                          {m.context} · {m.provider}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-500 group-hover:text-slate-300">
                        {m.inputCostPerMTokens !== undefined ? `$${m.inputCostPerMTokens}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(grouped).length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500">
                No models found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
