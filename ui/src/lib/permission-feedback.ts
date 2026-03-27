import { ApiError } from "../api/client";

export function isPermissionDeniedError(error: unknown) {
  return error instanceof ApiError && error.status === 403;
}

export function assigneeUpdateErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "You do not have permission to reassign this issue. Ask a company admin for tasks:assign.";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Failed to update assignee.";
}
