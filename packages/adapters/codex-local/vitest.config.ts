import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    dangerouslyIgnoreUnhandledErrors: true,
    onUnhandledError(error) {
      const message = String((error as Error | undefined)?.message ?? "");
      if (
        message.includes("ERR_REQUIRE_ESM") &&
        (message.includes("html-encoding-sniffer") || message.includes("whatwg-url"))
      ) {
        return false;
      }
    },
  },
});
