import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, SUBPROTOCOL } from "../src/index";

describe("protocol version (7.1, 7.6)", () => {
  it("speaks envelope v1 over the pehchaan.v1 WebSocket subprotocol", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(SUBPROTOCOL).toBe("pehchaan.v1");
  });
});
