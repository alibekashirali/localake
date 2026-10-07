import { ChartsSection } from "../charts/ChartsSection";
import { CatalogSection } from "../explorer/CatalogSection";
import { HomeSection } from "../home/HomeSection";
import { ImportsSection } from "../imports/ImportsSection";
import { LineageSection } from "../lineage/LineageSection";
import { NotebooksSection } from "../notebooks/NotebooksSection";
import type { Section } from "../../store/workspace";
import { SettingsSection } from "../settings/SettingsSection";
import { HistorySection } from "./HistorySection";
import { WorkspaceLayout } from "./Workspace";

/** One screen per sidebar entry — no two entries render the same thing. */
export function SectionRouter({ section }: { section: Section }) {
  switch (section) {
    case "home":
      return <HomeSection />;
    case "explorer":
      return <CatalogSection />;
    case "sql":
      return <WorkspaceLayout />;
    case "notebooks":
      return <NotebooksSection />;
    case "charts":
      return <ChartsSection />;
    case "lineage":
      return <LineageSection />;
    case "imports":
      return <ImportsSection />;
    case "history":
      return <HistorySection />;
    case "settings":
      return <SettingsSection />;
    default:
      return <WorkspaceLayout />;
  }
}
