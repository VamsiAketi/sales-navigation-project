import { Download, PanelRightClose, PanelRightOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SALES_NAV_IMPORT_TEMPLATE_FILENAME,
  SALES_NAV_IMPORT_TEMPLATE_PATH,
} from "@/lib/sales-navigation/import-template";

export function SalesNavPageToolbar({
  canWrite,
  importPending,
  sourceFileName,
  companyLabel,
  showImportHelp,
  intelPanelOpen,
  onUpload,
  onToggleIntelPanel,
}: {
  canWrite: boolean;
  importPending: boolean;
  sourceFileName?: string | null;
  companyLabel?: string | null;
  showImportHelp: boolean;
  intelPanelOpen: boolean;
  onUpload: () => void;
  onToggleIntelPanel: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-card/50 px-2 py-1.5 md:px-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">Sales Navigation</h1>
        {companyLabel ? (
          <p className="truncate text-[11px] font-medium text-muted-foreground" title={companyLabel}>
            {companyLabel}
          </p>
        ) : null}
        {sourceFileName ? (
          <p className="truncate text-[10px] text-muted-foreground" title={sourceFileName}>
            {sourceFileName}
          </p>
        ) : showImportHelp ? (
          <p className="text-[10px] text-muted-foreground">Upload PODIUM Lead Intelligence (.xlsx)</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {showImportHelp ? (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
            <a href={SALES_NAV_IMPORT_TEMPLATE_PATH} download={SALES_NAV_IMPORT_TEMPLATE_FILENAME}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only md:not-sr-only md:ml-1.5">Template</span>
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={!canWrite || importPending}
          onClick={onUpload}
        >
          <Upload className="h-3.5 w-3.5 md:mr-1.5" aria-hidden />
          <span className="hidden sm:inline">{importPending ? "Importing…" : "Upload Excel"}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={onToggleIntelPanel}
          aria-expanded={intelPanelOpen}
          aria-label={intelPanelOpen ? "Hide intelligence panel" : "Show intelligence panel"}
          title={intelPanelOpen ? "Hide intelligence" : "Show intelligence"}
        >
          {intelPanelOpen ? (
            <PanelRightClose className="h-4 w-4" aria-hidden />
          ) : (
            <PanelRightOpen className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
