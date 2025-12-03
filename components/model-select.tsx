import { ArenaModelOption } from "@/lib/types";
import { getGroupedModels } from "@/lib/models";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ArenaModelOption[];
}

export function ModelSelect({ label, value, onChange, options }: Props) {
  const grouped = getGroupedModels();

  return (
    <label className="flex flex-col gap-2 text-sm w-full">
      <span className="text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md bg-arena-card border border-white/10 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-arena-accent min-w-[200px]"
      >
        {Object.entries(grouped).map(([provider, models]) => (
          <optgroup key={provider} label={provider} className="bg-arena-bg text-slate-400 font-semibold">
            {models.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-arena-bg text-white pl-4">
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
