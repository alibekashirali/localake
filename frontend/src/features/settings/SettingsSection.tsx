import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Info, RefreshCw, ShieldAlert, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Button, Card, Spinner } from "../../components/ui";

export function SettingsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.settings });

  const [memoryLimit, setMemoryLimit] = useState("");
  const [threads, setThreads] = useState(0);
  const [rowLimit, setRowLimit] = useState(1000);
  const [watchFiles, setWatchFiles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setMemoryLimit(data.engine.memoryLimit);
    setThreads(data.engine.threads);
    setRowLimit(data.workspace.defaultRowLimit);
    setWatchFiles(data.workspace.watchFiles);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveSettings({ memoryLimit, threads, defaultRowLimit: rowLimit, watchFiles }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not save settings"),
  });

  const lockDown = useMutation({
    mutationFn: () => api.saveSettings({ externalAccess: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (isLoading || !data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
        <Group icon={<Cpu size={16} />} title="Engine" note="Applied to DuckDB immediately.">
          <Field
            label="Memory limit"
            hint="How much DuckDB may hold before spilling to disk. Accepts 4GB, 512MB or 80%."
          >
            <input
              value={memoryLimit}
              onChange={(event) => setMemoryLimit(event.target.value)}
              className={INPUT}
            />
          </Field>
          <Field label="Threads" hint="Parallelism within a single query.">
            <input
              type="number"
              min={1}
              max={256}
              value={threads}
              onChange={(event) => setThreads(Number(event.target.value))}
              className={INPUT}
            />
          </Field>
          <Field
            label="Spill directory"
            hint="Where large joins and sorts overflow. Keep free space here."
          >
            <code className="block truncate rounded-lg border border-line bg-slate-50 px-2.5 py-1.5 text-[12px] text-ink-600">
              {data.engine.tempDirectory}
            </code>
          </Field>
        </Group>

        <Group icon={<Table2 size={16} />} title="Queries">
          <Field label="Default row limit" hint="Pre-filled in the editor's Limit control.">
            <input
              type="number"
              min={1}
              value={rowLimit}
              onChange={(event) => setRowLimit(Number(event.target.value))}
              className={INPUT}
            />
          </Field>
        </Group>

        <Group icon={<RefreshCw size={16} />} title="Workspace">
          <label className="flex items-start justify-between gap-6">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink-800">
                Watch for file changes
              </span>
              <span className="block text-[11.5px] text-ink-500">
                Rescan the project automatically when files are added, changed or removed.
              </span>
            </span>
            <input
              type="checkbox"
              checked={watchFiles}
              onChange={(event) => setWatchFiles(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
          </label>
        </Group>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save changes
          </Button>
          {error ? <span className="text-[12.5px] text-danger">{error}</span> : null}
          {save.isSuccess && !error ? (
            <span className="text-[12.5px] text-ok">Saved</span>
          ) : null}
        </div>

        <Group icon={<ShieldAlert size={16} />} title="File access">
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            The SQL editor can read and write any file this process can reach — that is what
            makes <code className="rounded bg-slate-100 px-1">read_csv('…')</code> work on
            paths outside the project. Turning it off restricts DuckDB to what is already
            registered.
          </p>
          <p className="text-[12px] text-ink-500">
            DuckDB only allows tightening this within a running process, so switching it back
            on needs a restart.
          </p>
          {data.engine.externalAccess ? (
            <Button variant="danger" onClick={() => lockDown.mutate()} loading={lockDown.isPending}>
              Restrict to this project
            </Button>
          ) : (
            <span className="text-[12.5px] font-medium text-ok">
              Restricted — external file access is off
            </span>
          )}
        </Group>

        <Group icon={<Info size={16} />} title="About">
          <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-[12.5px]">
            <Row label="Localake" value={data.about.localake} />
            <Row label="DuckDB" value={data.about.duckdb} />
            <Row label="Datasets" value={String(data.about.datasets)} />
            <Row label="Project" value={data.about.project} mono />
            <Row label="Metadata" value={data.about.metadata} mono />
          </dl>
        </Group>
      </div>
    </div>
  );
}

const INPUT =
  "h-8 w-56 rounded-lg border border-line px-2.5 text-[12.5px] text-ink-900 outline-none focus:border-brand-400";

function Group({
  icon, title, note, children,
}: { icon: React.ReactNode; title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="flex-none">
      <div className="flex items-baseline gap-2 border-b border-line px-4 py-3">
        <span className="text-ink-400">{icon}</span>
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink-900">{title}</span>
        {note ? <span className="text-[11.5px] text-ink-500">{note}</span> : null}
      </div>
      <div className="flex flex-col gap-3.5 px-4 py-3.5">{children}</div>
    </Card>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-start justify-between gap-6">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-800">{label}</span>
        {hint ? <span className="block text-[11.5px] text-ink-500">{hint}</span> : null}
      </span>
      <span className="flex-none">{children}</span>
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-500">{label}</dt>
      <dd className={mono ? "truncate font-mono text-[11.5px] text-ink-700" : "text-ink-800"}>
        {value}
      </dd>
    </>
  );
}
