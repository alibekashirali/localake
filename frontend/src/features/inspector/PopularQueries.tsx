import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileText, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card, IconButton, Spinner } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { useWorkspace } from "../../store/workspace";

const VISIBLE = 4;

export function PopularQueries() {
  const queryClient = useQueryClient();
  const addSqlTab = useWorkspace((state) => state.addSqlTab);
  const setSection = useWorkspace((state) => state.setSection);

  const { data, isLoading } = useQuery({
    queryKey: ["saved-queries"],
    queryFn: api.savedQueries,
  });

  const remove = useMutation({
    mutationFn: api.deleteQuery,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-queries"] }),
  });

  const duplicate = useMutation({
    mutationFn: (query: { name: string; sql: string }) =>
      api.saveQuery({ name: `${query.name} copy`, sql: query.sql }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-queries"] }),
  });

  const queries = data?.queries ?? [];

  return (
    <Card className="flex-none">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
          Saved queries
        </span>
        <button
          onClick={() => setSection("history")}
          className="text-[12.5px] font-medium text-brand-600 hover:text-brand-700"
        >
          View all
        </button>
      </div>

      <div className="max-h-[190px] overflow-auto px-2 pb-2.5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : queries.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-500">
            Saved queries show up here. Press <span className="font-medium">Save</span> above the
            editor to keep one.
          </p>
        ) : (
          queries.slice(0, VISIBLE).map((query) => (
            <div
              key={query.id}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors hover:bg-brand-50"
            >
              <FileText size={15} className="flex-none text-ink-400" strokeWidth={1.8} />
              <button
                onClick={() => addSqlTab(query.sql, query.name)}
                className="min-w-0 flex-1 truncate text-left text-ink-800 group-hover:text-brand-700"
                title={query.sql}
              >
                {query.name}
              </button>
              <IconButton
                label={`Run ${query.name}`}
                onClick={() => addSqlTab(query.sql, query.name, { run: true })}
                className="h-6 w-6 flex-none text-brand-600 opacity-0 group-hover:opacity-100"
              >
                <Play size={13} className="fill-current" />
              </IconButton>
              <Menu
                items={[
                  {
                    label: "Open in editor",
                    icon: <Pencil size={14} />,
                    onSelect: () => addSqlTab(query.sql, query.name),
                  },
                  {
                    label: "Duplicate",
                    icon: <Copy size={14} />,
                    onSelect: () => duplicate.mutate({ name: query.name, sql: query.sql }),
                  },
                  "separator",
                  {
                    label: "Delete",
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onSelect: () => remove.mutate(query.id),
                  },
                ]}
              >
                {({ toggle }) => (
                  <IconButton
                    label={`Actions for ${query.name}`}
                    onClick={toggle}
                    className="h-6 w-6 flex-none opacity-0 group-hover:opacity-100"
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                )}
              </Menu>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
