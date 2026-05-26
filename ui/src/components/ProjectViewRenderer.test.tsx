// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectViewWidget } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectViewRenderer } from "./ProjectViewRenderer";

function makeWidget(overrides: Partial<ProjectViewWidget>): ProjectViewWidget {
  return {
    id: "widget-1",
    companyId: "company-1",
    projectId: "project-1",
    projectViewId: "view-1",
    title: "Widget",
    normalizedTitle: "widget",
    type: "table",
    position: 0,
    queryRef: null,
    config: null,
    layout: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Row ${i + 1}`, value: i + 1 }));
}

describe("ProjectViewRenderer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders KPI widget from first numeric value", () => {
    const root = createRoot(container);
    const widgets = [makeWidget({ id: "kpi-1", type: "kpi", title: "Revenue" })];
    const widgetDataById = {
      "kpi-1": {
        rows: [{ revenue: 3200, label: "today" }],
        error: null,
      },
    };

    act(() => {
      root.render(<ProjectViewRenderer widgets={widgets} widgetDataById={widgetDataById} />);
    });

    expect(container.textContent).toContain("Revenue");
    expect(container.textContent).toContain("3200");

    act(() => root.unmount());
  });

  it("shows markdown content and widget query error", () => {
    const root = createRoot(container);
    const widgets = [
      makeWidget({
        id: "md-1",
        type: "markdown",
        title: "Notes",
        config: { markdown: "## Summary\nhello" },
        layout: { maxHeight: 200 },
      }),
      makeWidget({ id: "tbl-1", type: "table", title: "Table widget" }),
    ];
    const widgetDataById = {
      "md-1": { rows: [], error: null },
      "tbl-1": { rows: [], error: "Invalid widget queryRef configuration" },
    };

    act(() => {
      root.render(<ProjectViewRenderer widgets={widgets} widgetDataById={widgetDataById} />);
    });

    expect(container.textContent).toContain("Summary");
    expect(container.textContent).toContain("Invalid widget queryRef configuration");
    const scroll = container.querySelector("[style*='max-height']");
    expect(scroll).toBeTruthy();

    act(() => root.unmount());
  });

  it("paginates table rows using config.pageSize", () => {
    const root = createRoot(container);
    const widgets = [
      makeWidget({
        id: "tbl-1",
        type: "table",
        title: "Leads",
        config: { pageSize: 5 },
      }),
    ];
    const widgetDataById = {
      "tbl-1": { rows: makeRows(12), error: null },
    };

    act(() => {
      root.render(<ProjectViewRenderer widgets={widgets} widgetDataById={widgetDataById} />);
    });

    expect(container.textContent).toContain("Row 1");
    expect(container.textContent).not.toContain("Row 6");
    expect(container.textContent).toContain("1–5 of 12");

    const next = container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
    act(() => next.click());

    expect(container.textContent).toContain("Row 6");
    expect(container.textContent).toContain("6–10 of 12");

    act(() => root.unmount());
  });

  it("applies colSpan layout classes for wide widgets", () => {
    const root = createRoot(container);
    const widgets = [
      makeWidget({
        id: "tbl-1",
        type: "table",
        layout: { colSpan: 2 },
      }),
    ];
    const widgetDataById = {
      "tbl-1": { rows: makeRows(1), error: null },
    };

    act(() => {
      root.render(<ProjectViewRenderer widgets={widgets} widgetDataById={widgetDataById} />);
    });

    expect(container.querySelector(".sm\\:col-span-2")).toBeTruthy();

    act(() => root.unmount());
  });
});
