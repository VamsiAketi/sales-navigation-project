import { describe, expect, it } from "vitest";
import { HttpError, unprocessable } from "../errors.js";
import { isGmailAuthSyncFailure, isGmailTransientSyncFailure } from "../services/gmail-sync-errors.js";

describe("gmail-sync-errors", () => {
  it("treats Gmail 401 as auth failure", () => {
    const err = Object.assign(new Error("Request had invalid authentication credentials."), { status: 401 });
    expect(isGmailAuthSyncFailure(err)).toBe(true);
    expect(isGmailTransientSyncFailure(err)).toBe(false);
  });

  it("treats Gmail 403 rate limit as transient", () => {
    const err = Object.assign(new Error("User-rate limit exceeded"), { status: 403 });
    expect(isGmailAuthSyncFailure(err)).toBe(false);
    expect(isGmailTransientSyncFailure(err)).toBe(true);
  });

  it("treats Gmail 403 without rate wording as auth failure", () => {
    const err = Object.assign(new Error("Insufficient Permission"), { status: 403 });
    expect(isGmailAuthSyncFailure(err)).toBe(true);
  });

  it("treats fetch / network errors as transient", () => {
    const err = new TypeError("fetch failed");
    expect(isGmailAuthSyncFailure(err)).toBe(false);
    expect(isGmailTransientSyncFailure(err)).toBe(true);
  });

  it("treats invalid_grant style messages as auth failure", () => {
    const err = unprocessable("invalid_grant: Token has been expired or revoked.");
    expect(isGmailAuthSyncFailure(err)).toBe(true);
  });

  it("treats OAuth HttpError 422 without token wording as transient", () => {
    const err = new HttpError(422, "Something went wrong");
    expect(isGmailAuthSyncFailure(err)).toBe(false);
  });

  it("treats OAuth HttpError 422 about refresh as auth failure", () => {
    const err = unprocessable("Failed to refresh Gmail access token");
    expect(isGmailAuthSyncFailure(err)).toBe(true);
  });
});
