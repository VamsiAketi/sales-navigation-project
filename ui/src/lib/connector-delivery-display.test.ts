import { describe, expect, it } from "vitest";
import { connectorDeliveryHeadline, connectorDeliveryPreview } from "./connector-delivery-display";

describe("connectorDeliveryHeadline", () => {
  it("uses subject and from when present", () => {
    expect(
      connectorDeliveryHeadline({
        message: { subject: "Hello", from: "a@b.com", fromName: "Ada" },
      }),
    ).toBe("Hello · Ada");
  });

  it("falls back to from only", () => {
    expect(connectorDeliveryHeadline({ message: { from: "team@co.com" } })).toBe("Message from team@co.com");
  });

  it("hides raw ids when payload has no message fields", () => {
    expect(connectorDeliveryHeadline({ eventType: "message.received" })).toBe("Inbound event");
  });
});

describe("connectorDeliveryPreview", () => {
  it("prefers body text over metadata snippet", () => {
    expect(
      connectorDeliveryPreview({
        message: { bodyText: "First line of email body here." },
        metadata: { snippet: "Short snippet" },
      }),
    ).toContain("First line");
  });

  it("uses metadata snippet when body missing", () => {
    expect(connectorDeliveryPreview({ metadata: { snippet: "Gmail snippet preview" } })).toBe("Gmail snippet preview");
  });
});
