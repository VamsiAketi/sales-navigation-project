import { describe, expect, it } from "vitest";
import {
  createIssueLabelEditState,
  isIssueLabelDraftDirty,
  toggleIssueLabelSelection,
  withResetDraft,
  withSaveLabelsError,
  withSaveLabelsSuccess,
  withSavingLabels,
  withToggledDraftLabel,
} from "./issue-labels-state";

describe("toggleIssueLabelSelection", () => {
  it("adds a label id when it is not selected", () => {
    expect(toggleIssueLabelSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes a label id when it is already selected", () => {
    expect(toggleIssueLabelSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("issue label edit state transitions", () => {
  it("tracks dirty state and can reset to persisted values", () => {
    const initial = createIssueLabelEditState(["one"]);
    const toggled = withToggledDraftLabel(initial, "two");
    expect(isIssueLabelDraftDirty(toggled)).toBe(true);
    expect(toggled.error).toBeNull();

    const reset = withResetDraft(toggled);
    expect(reset.draftIds).toEqual(["one"]);
    expect(isIssueLabelDraftDirty(reset)).toBe(false);
  });

  it("preserves unsaved intent on save error and supports retry success", () => {
    const initial = createIssueLabelEditState(["one"]);
    const edited = withToggledDraftLabel(initial, "two");
    const saving = withSavingLabels(edited);

    expect(saving.isSaving).toBe(true);
    expect(saving.draftIds).toEqual(["one", "two"]);

    const failed = withSaveLabelsError(saving, "network error");
    expect(failed.isSaving).toBe(false);
    expect(failed.error).toBe("network error");
    expect(failed.draftIds).toEqual(["one", "two"]);
    expect(failed.persistedIds).toEqual(["one"]);

    const retried = withSavingLabels(failed);
    const saved = withSaveLabelsSuccess(retried);
    expect(saved.isSaving).toBe(false);
    expect(saved.error).toBeNull();
    expect(saved.persistedIds).toEqual(["one", "two"]);
    expect(isIssueLabelDraftDirty(saved)).toBe(false);
  });
});
