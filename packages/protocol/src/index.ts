// @pehchaan/protocol: the wire format shared by the app and the relay (spec section 7). Both import these
// schemas from here; there are no copies (PRO-03).
export const PROTOCOL_VERSION = 1 as const;
/** The WebSocket subprotocol: the client sends it, the relay echoes it; anything else → HTTP 426 (7.1). */
export const SUBPROTOCOL = "pehchaan.v1" as const;

export * from "./limits";
export * from "./codes";
export * from "./ulid";
export * from "./fields";
export * from "./payloads";
export * from "./client";
export * from "./relay";
