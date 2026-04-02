import { X } from "lucide-react";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function PropertiesPanel() {
  const { panelContent, panelVisible, setPanelVisible } = usePanel();
  const { selectedCompany } = useCompany();

  if (!panelContent) return null;

  const logoAssetId = selectedCompany?.logoAssetId ?? null;
  const logoSrc = logoAssetId ? `/api/assets/${logoAssetId}/content` : null;

  return (
    <aside
      className="hidden md:flex border-l border-border bg-card flex-col shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out"
      style={{ width: panelVisible ? 320 : 0, opacity: panelVisible ? 1 : 0 }}
    >
      <div className="w-80 flex-1 flex flex-col min-w-[320px]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex min-w-0 items-center gap-2">
            {logoSrc && (
              <img
                src={logoSrc}
                alt={selectedCompany?.name ? `${selectedCompany.name} logo` : "Company logo"}
                className="h-6 w-6 rounded object-contain bg-background"
                onError={(e) => {
                  // Hide broken logos without breaking panel layout.
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <span className="text-sm font-medium truncate">
              {selectedCompany?.name ? `${selectedCompany.name} • Properties` : "Properties"}
            </span>
          </div>
          {/* <Button variant="ghost" size="icon-xs" onClick={() => setPanelVisible(false)}>
            <X className="h-4 w-4" />
          </Button> */}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4">{panelContent}</div>
        </ScrollArea>
      </div>
    </aside>
  );
}
