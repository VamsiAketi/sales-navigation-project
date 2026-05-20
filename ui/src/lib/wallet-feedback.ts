import {
  WALLET_INSUFFICIENT_AVAILABLE_TOAST,
  isWalletInsufficientAvailableErrorCode,
  readWalletPaymentErrorCode,
} from "@paperclipai/shared";
import type { ToastInput } from "../context/ToastContext";

export function walletInsufficientAvailableToastInput(
  dedupeKey?: string,
): ToastInput {
  return {
    title: WALLET_INSUFFICIENT_AVAILABLE_TOAST.title,
    body: WALLET_INSUFFICIENT_AVAILABLE_TOAST.body,
    tone: "warn",
    ttlMs: 12_000,
    dedupeKey: dedupeKey ?? "wallet:insufficient-available",
  };
}

export function walletCancelledRunToastInput(payload: {
  errorCode?: string | null;
}): ToastInput | null {
  if (!isWalletInsufficientAvailableErrorCode(payload.errorCode ?? undefined)) {
    return null;
  }
  return walletInsufficientAvailableToastInput(`wallet:cancelled:${payload.errorCode}`);
}

export { readWalletPaymentErrorCode, isWalletInsufficientAvailableErrorCode };
