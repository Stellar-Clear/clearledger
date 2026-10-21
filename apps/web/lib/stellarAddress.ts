import { StrKey } from "@stellar/stellar-sdk";

/** Validate a public account or contract StrKey without accepting secrets. */
export function isValidStellarPublicKey(value: string): boolean {
  const candidate = value.trim();
  return candidate.length > 0 &&
    (StrKey.isValidEd25519PublicKey(candidate) || StrKey.isValidContract(candidate));
}
