import { xdr } from "@stellar/stellar-sdk";

export interface SorobanEventEnvelope {
  /** Topic values encoded as base64 XDR, as returned by Soroban RPC. */
  topics: string[];
  /** Event data encoded as base64 XDR. */
  data: string;
}

export interface DecodedSorobanEvent {
  topics: xdr.ScVal[];
  data: xdr.ScVal;
}

/** Decode a Soroban event's topic and data XDR without guessing contract types. */
export function decodeSorobanEvent(
  event: SorobanEventEnvelope,
): DecodedSorobanEvent {
  if (!Array.isArray(event.topics) || event.topics.length >  topicsLimit) {
    throw new Error(`Soroban event must contain between 0 and ${topicsLimit} topics`);
  }
  if (!event.data) throw new Error("Soroban event data is required");
  try {
    return {
      topics: event.topics.map((topic) => xdr.ScVal.fromXDR(topic, "base64")),
      data: xdr.ScVal.fromXDR(event.data, "base64"),
    };
  } catch (error) {
    throw new Error("Invalid Soroban event XDR", { cause: error });
  }
}

const topicsLimit = 4;
