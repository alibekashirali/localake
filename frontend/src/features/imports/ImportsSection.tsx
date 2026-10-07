import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { Button, Card } from "../../components/ui";
import { useWorkspace } from "../../store/workspace";

export function ImportsSection() {
  const queryClient = useQueryClient();
  const selectDataset = useWorkspace((state) => state.selectDataset);
  const openDatasetTab = useWorkspace((state) => state.openDatasetTab);
  const setSection = useWorkspace((state) => state.setSection);
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState("raw");
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: () => api.importFile(file!, target),
    onSuccess: () => {
      queryClient.invalidateQueries(); // tree, datasets and project stats
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const result = upload.data;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
      <div className="mx-auto w-full max-w-2xl py-4">
        <Card>
          <div className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
            <Download size={16} className="text-ink-400" />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
              Import data
            </span>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4">
            <p className="text-[12.5px] leading-relaxed text-ink-600">
              Upload a Parquet, CSV or JSON file into a folder inside the project. It is
              registered as a queryable dataset right away — the same as dropping it into the
              folder yourself.
            </p>

            <label className="flex items-start justify-between gap-6">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink-800">Target folder</span>
                <span className="block text-[11.5px] text-ink-500">
                  Relative to the project root.
                </span>
              </span>
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="raw"
                className="h-8 w-56 rounded-lg border border-line px-2.5 text-[12.5px] text-ink-900 outline-none focus:border-brand-400"
              />
            </label>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-slate-50/60 px-4 py-8 text-center transition-colors hover:border-line-strong">
              <FileUp size={20} className="text-ink-400" />
              <span className="text-[13px] font-medium text-ink-700">
                {file ? file.name : "Choose a file"}
              </span>
              {file ? (
                <span className="num text-[11.5px] text-ink-500">{formatBytes(file.size)}</span>
              ) : (
                <span className="text-[11.5px] text-ink-400">Click to browse</span>
              )}
              <input
                ref={inputRef}
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>

            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                icon={<FileUp size={14} />}
                onClick={() => upload.mutate()}
                disabled={!file}
                loading={upload.isPending}
              >
                Import file
              </Button>
              {upload.isError ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-danger">
                  <TriangleAlert size={13} />
                  {upload.error instanceof ApiError ? upload.error.message : "Upload failed"}
                </span>
              ) : null}
            </div>

            {result ? (
              <div className="rounded-lg border border-line bg-slate-50/60 px-3.5 py-3 text-[12.5px]">
                <div className="text-ink-700">
                  Saved <span className="font-medium">{result.filename}</span> into{" "}
                  <code className="rounded bg-slate-100 px-1">{result.path}</code> (
                  {formatBytes(result.sizeBytes)})
                </div>
                {result.dataset ? (
                  <button
                    onClick={() => {
                      selectDataset(result.dataset!.id);
                      openDatasetTab(result.dataset!.id, result.dataset!.name);
                      setSection("sql");
                    }}
                    className="mt-2 font-medium text-brand-600 hover:text-brand-700"
                  >
                    Open {result.dataset.qualifiedName} →
                  </button>
                ) : (
                  <div className="mt-2 text-ink-500">
                    Saved as a file; this extension is not treated as a dataset.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
