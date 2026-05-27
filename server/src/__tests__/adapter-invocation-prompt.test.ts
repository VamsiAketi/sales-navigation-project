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

    expect(result.prompt).toContain("## Task run protocol (mandatory)");
    expect(result.prompt).toContain("Run the regular heartbeat inbox procedure.");
    expect(result.prompt.indexOf("Task run protocol")).toBeLessThan(
      result.prompt.indexOf("Run the regular heartbeat inbox procedure."),
    );
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
    expect(result.prompt).toContain("### Playbook and stage rules");
    expect(result.prompt).toContain("Lead Generation");
    expect(result.prompt).toContain("Run the regular heartbeat inbox procedure.");
    expect(result.prompt.indexOf("Playbook and stage rules")).toBeLessThan(
      result.prompt.indexOf("Run the regular heartbeat inbox procedure."),
    );
  });

  it("prepends mandatory task run protocol on normal heartbeats", () => {
    const result = buildAdapterInvocationPrompt({
      context: { wakeReason: "issue_assigned" },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).toContain("## Task run protocol (mandatory)");
    expect(result.prompt).toContain("**Role fit**");
    expect(result.prompt).toContain("**Data & dashboards (mandatory review)**");
    expect(result.prompt).toContain("**Handoff**");
    expect(result.prompt.indexOf("Task run protocol")).toBeLessThan(
      result.prompt.indexOf("Run the regular heartbeat inbox procedure."),
    );
  });

  it("nests workflow and data prompts under the task run protocol", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "issue_assigned",
        issueRunPromptDigest: "**Task:** X-1 — Do thing\n**Stage:** Verify",
      },
      promptTemplate: "Run heartbeat.",
      templateData: {},
    });

    expect(result.prompt).toContain("### Task context (this run)");
    expect(result.prompt).toContain("**Stage:** Verify");
    expect(result.prompt.indexOf("Task run protocol")).toBeLessThan(
      result.prompt.indexOf("### Task context"),
    );
  });

  it("supports legacy workflow and data prompts when digest is absent", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "issue_assigned",
        issueWorkflowPrompt: "Current stage: **Verify**",
        issueProjectDataPrompt: "Registered tables:\n- **work_items**",
      },
      promptTemplate: "Run heartbeat.",
      templateData: {},
    });

    expect(result.prompt).toContain("### Playbook and stage rules");
    expect(result.prompt).toContain("### Project data & dashboards");
  });

  it("prepends mandatory project data rules when issueProjectDataPrompt is set", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "issue_assigned",
        issueProjectDataPrompt: "Registered tables:\n- **work_items** — PK [id]; columns: title:text",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).toContain("### Project data & dashboards");
    expect(result.prompt).toContain("**work_items**");
  });

  it("does not inject task run protocol on one-shot connector wakes", () => {
    const result = buildAdapterInvocationPrompt({
      context: {
        wakeReason: "connector_event",
        wakeupPrompt: "Process this Gmail message.",
      },
      promptTemplate: "Run the regular heartbeat inbox procedure.",
      templateData: {},
    });

    expect(result.prompt).not.toContain("Task run protocol");
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
