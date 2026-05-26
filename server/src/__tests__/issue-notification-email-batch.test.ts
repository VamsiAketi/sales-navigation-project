import { describe, expect, it } from "vitest";
import { mergeIssueEmailChanges, issueEmailBatchWindowMs } from "../services/issue-notification-email-batch.js";

describe("issue notification email batch helpers", () => {
  it("returns 0 when batch window env is unset", () => {
    const previous = process.env.PAPERCLIP_EMAIL_BATCH_WINDOW_MS;
    delete process.env.PAPERCLIP_EMAIL_BATCH_WINDOW_MS;
    expect(issueEmailBatchWindowMs()).toBe(0);
    if (previous !== undefined) process.env.PAPERCLIP_EMAIL_BATCH_WINDOW_MS = previous;
  });

  it("merges field changes keeping earliest before and latest after", () => {
    expect(
      mergeIssueEmailChanges([
        { field: "Status", before: "Todo", after: "In Progress" },
        { field: "Priority", before: "Medium", after: "High" },
        { field: "Status", before: "Todo", after: "Review" },
      ]),
    ).toEqual([
      { field: "Status", before: "Todo", after: "Review" },
      { field: "Priority", before: "Medium", after: "High" },
    ]);
  });
});
