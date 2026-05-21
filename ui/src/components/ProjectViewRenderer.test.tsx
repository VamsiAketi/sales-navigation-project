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

    act(() => root.unmount());
  });
});
