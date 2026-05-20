/** Machine-readable codes on wallet-related HTTP 402 responses and cancelled run rows. */
export const WALLET_PAYMENT_ERROR_CODE = {
  INSUFFICIENT_AVAILABLE: "wallet_insufficient_available",
  RESERVATION_INACTIVE: "wallet_reservation_inactive",
} as const;

export type WalletPaymentErrorCode =
  (typeof WALLET_PAYMENT_ERROR_CODE)[keyof typeof WALLET_PAYMENT_ERROR_CODE];

/** Single user-facing line for insufficient available wallet (toasts, API errors, cancelled run `error`). */
export const WALLET_INSUFFICIENT_AVAILABLE_MESSAGE = "Insufficient wallet balance";

/** Toast shape for insufficient available balance. */
export const WALLET_INSUFFICIENT_AVAILABLE_TOAST = {
  title: WALLET_INSUFFICIENT_AVAILABLE_MESSAGE,
  body: "Your wallet does not have enough funds.",
} as const;

/** Stored on cancelled runs (`heartbeat_runs.error`) and API error messages. */
export function walletInsufficientAvailableUserMessage(): string {
  return WALLET_INSUFFICIENT_AVAILABLE_MESSAGE;
}

export function readWalletPaymentErrorCode(details: unknown): WalletPaymentErrorCode | null {
  if (!details || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  if (code === WALLET_PAYMENT_ERROR_CODE.INSUFFICIENT_AVAILABLE) {
    return WALLET_PAYMENT_ERROR_CODE.INSUFFICIENT_AVAILABLE;
  }
  if (code === WALLET_PAYMENT_ERROR_CODE.RESERVATION_INACTIVE) {
    return WALLET_PAYMENT_ERROR_CODE.RESERVATION_INACTIVE;
  }
  return null;
}

export function isWalletInsufficientAvailableErrorCode(
  errorCode: string | null | undefined,
): boolean {
  return errorCode === WALLET_PAYMENT_ERROR_CODE.INSUFFICIENT_AVAILABLE;
}
