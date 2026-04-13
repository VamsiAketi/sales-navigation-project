import {
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Boxes,
  Repeat,
  Settings,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { useSidebar } from "../context/SidebarContext";
import { cn } from "../lib/utils";
import { Link } from "@/lib/router";
import { azureSidebarIcon } from "../lib/sidebar-icon-tints";
import { SidebarPrimaryNav, SidebarCompanyNavSection } from "./SidebarSortableNav";

// export function Sidebar() {
//   const { openNewIssue } = useDialog();
//   const { selectedCompanyId, selectedCompany } = useCompany();
//   const inboxBadge = useInboxBadge(selectedCompanyId);
//   const { data: liveRuns } = useQuery({
//     queryKey: queryKeys.liveRuns(selectedCompanyId!),
//     queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
//     enabled: !!selectedCompanyId,
//     refetchInterval: 10_000,
//   });
//   const liveRunCount = liveRuns?.length ?? 0;

//   function openSearch() {
//     document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
//   }

//   const pluginContext = {
//     companyId: selectedCompanyId,
//     companyPrefix: selectedCompany?.issuePrefix ?? null,
//   };

//   return (
//     <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
//       {/* Top bar: Company name (bold) + Search — aligned with top sections (no visible border) */}
//       <div className="flex items-center gap-1 px-3 h-12 shrink-0">
//         {selectedCompany?.brandColor && (
//           <div
//             className="w-4 h-4 rounded-sm shrink-0 ml-1"
//             style={{ backgroundColor: selectedCompany.brandColor }}
//           />
//         )}
//         {selectedCompany && (
//           <CompanyPatternIcon
//             companyName={selectedCompany.name}
//             logoUrl={selectedCompany.logoUrl}
//             brandColor={selectedCompany.brandColor}
//             logoAssetId={selectedCompany.logoAssetId}
//             className={cn(
//               "w-9 h-9",
//               "rounded-[10px]"
//             )}
//           />
//         )}
//         <span className="flex-1 text-sm font-bold text-foreground truncate pl-1">
//           {selectedCompany?.name ?? "Select company"}
//         </span>
//         <Button
//           variant="ghost"
//           size="icon-sm"
//           className="text-muted-foreground shrink-0"
//           onClick={openSearch}
//         >
//           <Search className="h-4 w-4" />
//         </Button>
//       </div>

//       <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
//         <div className="flex flex-col gap-0.5">
//           {/* New Issue button aligned with nav items */}
//           <button
//             onClick={() => openNewIssue()}
//             className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
//           >
//             <SquarePen className="h-4 w-4 shrink-0" />
//             <span className="truncate">New Task</span>
//           </button>
//           <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
//           <SidebarNavItem
//             to="/inbox"
//             label="Inbox"
//             icon={Inbox}
//             badge={inboxBadge.inbox}
//             badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
//             alert={inboxBadge.failedRuns > 0}
//           />
//           <PluginSlotOutlet
//             slotTypes={["sidebar"]}
//             context={pluginContext}
//             className="flex flex-col gap-0.5"
//             itemClassName="text-[13px] font-medium"
//             missingBehavior="placeholder"
//           />
//         </div>

//         <SidebarSection label="Work">
//           <SidebarNavItem to="/issues" label="Tasks" icon={CircleDot} />
//           <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
//           <SidebarNavItem to="/goals" label="Goals" icon={Target} />
//         </SidebarSection>

//         <SidebarProjects />

//         <SidebarAgents />

//         <SidebarSection label="Company">
//           <SidebarNavItem to="/company/people" label="Teams" icon={Users} />
//           <SidebarNavItem to="/org" label="Org" icon={Network} />
//           <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
//           <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
//           <SidebarNavItem to="/activity" label="Activity" icon={History} />
//           <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
//         </SidebarSection>

//         <PluginSlotOutlet
//           slotTypes={["sidebarPanel"]}
//           context={pluginContext}
//           className="flex flex-col gap-3"
//           itemClassName="rounded-lg border border-border p-3"
//           missingBehavior="placeholder"
//         />
//       </nav>
//     </aside>
//   );
// }



export function Sidebar() {
  const { sidebarCompact } = useSidebar();
  const { companies, selectedCompanyId, selectedCompany } = useCompany();
  const compactCompanyLink =
    sidebarCompact && companies.filter((c) => c.status !== "archived").length > 1;
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  return (
    <aside className="w-full h-full min-h-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
      {/* Top bar: workspace title + search */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-sidebar-border",
          sidebarCompact ? "flex-col justify-center px-0.5 py-2 min-h-[3rem]" : "h-12 px-3",
        )}
      >
        {sidebarCompact ? (
          selectedCompany ? (
            compactCompanyLink ? (
              <Link
                to="/companies"
                title="Switch company"
                className="shrink-0 rounded-lg ring-1 ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CompanyPatternIcon
                  companyName={selectedCompany.name}
                  logoUrl={selectedCompany.logoUrl}
                  brandColor={selectedCompany.brandColor}
                  className="h-8 w-8 rounded-lg text-sm"
                />
              </Link>
            ) : (
              <CompanyPatternIcon
                companyName={selectedCompany.name}
                logoUrl={selectedCompany.logoUrl}
                brandColor={selectedCompany.brandColor}
                className={cn("shrink-0 ring-1 ring-border/60", "h-8 w-8 rounded-lg text-sm")}
              />
            )
          ) : (
            <div className="shrink-0 h-8 w-8 rounded-lg bg-muted ring-1 ring-border/60" aria-hidden />
          )
        ) : selectedCompany ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <CompanyPatternIcon
              companyName={selectedCompany.name}
              logoUrl={selectedCompany.logoUrl}
              brandColor={selectedCompany.brandColor}
              className="h-8 w-8 shrink-0 rounded-lg text-sm ring-1 ring-border/60"
            />
            <span className="min-w-0 truncate text-sm font-medium text-sidebar-foreground">
              {selectedCompany.name}
            </span>
          </div>
        ) : (
          <div className="flex-1 text-sm text-sidebar-foreground/70">No company</div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(azureSidebarIcon.search, "shrink-0 hover:opacity-90")}
          onClick={openSearch}
          title="Search"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <nav
        className={cn(
          "flex flex-1 min-h-0 flex-col gap-0 overflow-y-auto py-3 scrollbar-auto-hide [&>*]:shrink-0",
          sidebarCompact ? "px-0.5" : "px-0",
        )}
      >
        <SidebarPrimaryNav liveRunCount={liveRunCount} pluginContext={pluginContext} />

        <SidebarProjects />

        <SidebarAgents />

        <SidebarCompanyNavSection />

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex shrink-0 flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
