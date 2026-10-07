import { Database } from "lucide-react";

export function StatusBar() {
  return (
    <footer className="flex h-9 flex-none items-center justify-between px-5 text-[11.5px] text-ink-500">
      <span className="flex items-center gap-1.5">
        <Database size={13} />
        Built with DuckDB
      </span>
      <span>Local data. Big possibilities.</span>
    </footer>
  );
}
