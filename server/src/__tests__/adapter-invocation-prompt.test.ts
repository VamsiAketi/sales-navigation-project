import { describe, expect, it } from "vitest";
import { buildAdapterInvocationPrompt } from "@paperclipai/adapter-utils/server-utils";

describe("buildAdapterInvocationPrompt", () => {
  it("uses the connector workflow prompt instead of the heartbeat template", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "connector_event",
        wakeupPrompt: "Process this Gmail message and reply if needed.",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
      leadingSections: ["Injected instructions"],
    });

    expect(result.prompt).toBe("Process this Gmail message and reply if needed.");
    expect(result.connectorWakePrompt).toBe("Process this Gmail message and reply if needed.");
    expect(result.renderedHeartbeatPrompt).toBe("");
  });

  it("appends connectorActionsGuide after the connector workflow prompt when present", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "connector_event",
        wakeupPrompt: "Do the workflow.",
        connectorActionsGuide: "## Actions\nCall the HTTP API.",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).toBe("Do the workflow.\n\n## Actions\nCall the HTTP API.");
    expect(result.connectorWakePrompt).toBe("Do the workflow.\n\n## Actions\nCall the HTTP API.");
  });

  it("keeps the heartbeat prompt for non-connector wakes", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "issue_assigned",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).toBe("Run the regular heartbeat inbox procedure.");
    expect(result.connectorWakePrompt).toBe("");
    expect(result.renderedHeartbeatPrompt).toBe("Run the regular heartbeat inbox procedure.");
  });

  it("prepends mandatory issue workflow rules when issueWorkflowPrompt is set", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "issue_assigned",
        issueWorkflowPrompt: "Current stage: **Lead Generation** — Lead Generation (API key: todo)",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
      leadingSections: ["AGENTS.md content"],
    });

    expect(result.prompt).toContain("AGENTS.md content");
    expect(result.prompt).toContain("## Current task — workflow rules (mandatory)");
    expect(result.prompt).toContain("Lead Generation (API key: todo)");
    expect(result.prompt).toContain("Run the regular heartbeat inbox procedure.");
    expect(result.prompt.indexOf("workflow rules")).toBeLessThan(
      result.prompt.indexOf("Run the regular heartbeat inbox procedure."),
    );
  });

  it("uses one-shot wake prompt for project context sync", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "project_context_sync",
        wakeupPrompt: "Refresh the project summary and workflow playbooks.",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).toBe("Refresh the project summary and workflow playbooks.");
    expect(result.renderedHeartbeatPrompt).toBe("");
  });
});
