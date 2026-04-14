import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSidebar } from "../context/SidebarContext";

export interface PageTabItem {
  value: string;
  label: ReactNode;
}

interface PageTabBarProps {
  items: PageTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  align?: "center" | "start";
  /** Azure portal–style tabs: blue underline, neutral label typography. */
  variant?: "default" | "azure";
}

export function PageTabBar({
  items,
  value,
  onValueChange,
  align = "center",
  variant = "default",
}: PageTabBarProps) {
  const { isMobile } = useSidebar();

  if (isMobile && value !== undefined && onValueChange) {
    return (
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 py-1 text-base focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {typeof item.label === "string" ? item.label : item.value}
          </option>
        ))}
      </select>
    );
  }

  return (
    <TabsList
      variant="line"
      className={cn(
        (align === "start" || variant === "azure") && "justify-start",
        variant === "azure" &&
          "w-full min-h-10 border-b border-[#edebe9] bg-transparent p-0 dark:border-white/10",
      )}
    >
      {items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          className={
            variant === "azure"
              ? "h-10 rounded-none px-4 py-2 text-[13px] font-normal text-[#605e5c] hover:text-[#323130] data-[state=active]:text-[#0078d4] dark:text-muted-foreground dark:hover:text-foreground dark:data-[state=active]:text-[#4cc2ff] after:bottom-0 after:h-0.5 after:!bg-[#0078d4] dark:after:!bg-[#4cc2ff]"
              : undefined
          }
        >
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
