interface Props {
  status: string;
  running: boolean;
}

export function StatusBar({ status, running }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-200">
      <span className="h-2.5 w-2.5 rounded-full bg-arena-accent animate-pulse" aria-hidden />
      <span>{running ? status : "Idle — ready to start"}</span>
    </div>
  );
}
