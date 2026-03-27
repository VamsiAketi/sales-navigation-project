export function toggleIssueLabelSelection(current: string[], labelId: string): string[] {
  if (current.includes(labelId)) {
    return current.filter((id) => id !== labelId);
  }
  return [...current, labelId];
}

export type IssueLabelEditState = {
  draftIds: string[];
  persistedIds: string[];
  isSaving: boolean;
  error: string | null;
};

export function createIssueLabelEditState(persistedIds: string[]): IssueLabelEditState {
  return {
    draftIds: persistedIds,
    persistedIds,
    isSaving: false,
    error: null,
  };
}

export function withToggledDraftLabel(state: IssueLabelEditState, labelId: string): IssueLabelEditState {
  return {
    ...state,
    draftIds: toggleIssueLabelSelection(state.draftIds, labelId),
    error: null,
  };
}

export function withSavingLabels(state: IssueLabelEditState): IssueLabelEditState {
  return {
    ...state,
    isSaving: true,
    error: null,
  };
}

export function withSaveLabelsError(state: IssueLabelEditState, message: string): IssueLabelEditState {
  return {
    ...state,
    isSaving: false,
    error: message,
  };
}

export function withSaveLabelsSuccess(state: IssueLabelEditState): IssueLabelEditState {
  return {
    draftIds: state.draftIds,
    persistedIds: state.draftIds,
    isSaving: false,
    error: null,
  };
}

export function withResetDraft(state: IssueLabelEditState): IssueLabelEditState {
  return {
    ...state,
    draftIds: state.persistedIds,
    error: null,
  };
}

export function isIssueLabelDraftDirty(state: IssueLabelEditState): boolean {
  if (state.draftIds.length !== state.persistedIds.length) return true;
  return state.draftIds.some((id, index) => id !== state.persistedIds[index]);
}
