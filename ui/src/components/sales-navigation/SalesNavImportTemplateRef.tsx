import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SALES_NAV_IMPORT_COLUMNS,
  SALES_NAV_IMPORT_TEMPLATE_FILENAME,
  SALES_NAV_IMPORT_TEMPLATE_PATH,
} from "@/lib/sales-navigation/import-template";

export function SalesNavImportTemplateRef() {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 rounded-lg border border-border/80 bg-muted/15">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden />
          <span>
            Upload a <strong>PODIUM Lead Intelligence</strong> workbook (.xlsx) or the simple import template.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={SALES_NAV_IMPORT_TEMPLATE_PATH} download={SALES_NAV_IMPORT_TEMPLATE_FILENAME}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Download template
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-touch-target="compact"
            className="text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            Column reference
            <ChevronDown
              className={cn("ml-1 h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            <strong>PODIUM files</strong> (sheet &quot;Lead Intelligence&quot;): imports Company, Point of Contact,
            Title, LinkedIn, Score/10, Status, Warm Intro Path, and strategy notes into the battle map. Simple
            template columns are listed below.
          </p>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-2 py-1.5 font-semibold">Column</th>
                  <th className="px-2 py-1.5 font-semibold">Required</th>
                  <th className="px-2 py-1.5 font-semibold">Description</th>
                  <th className="px-2 py-1.5 font-semibold">Example</th>
                </tr>
              </thead>
              <tbody>
                {SALES_NAV_IMPORT_COLUMNS.map((col) => (
                  <tr key={col.header} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">{col.header}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{col.required ? "Yes" : "No"}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{col.description}</td>
                    <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                      {col.examples ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
