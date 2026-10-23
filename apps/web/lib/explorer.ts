/**
 * Stellar Expert links for transactions. A link is built only for a valid
 * 64-character hex hash and a network we recognise. Otherwise it returns null,
 * so a receipt never links to the wrong network.
 */

const EXPLORER_NETWORK: Record<string, string> = {
  mainnet: "public",
  public: "public",
  testnet: "testnet",
};

const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * @param txHash - 64-character hex transaction hash.
 * @param network - Stellar network name, defaulting to `NEXT_PUBLIC_STELLAR_NETWORK`.
 * @returns The Stellar Expert transaction URL, or null if the hash or network is not recognised.
 *
 * @example
 * ```ts
 * stellarExpertTxUrl("a".repeat(64), "testnet");
 * // "https://stellar.expert/explorer/testnet/tx/aaaa..."
 * ```
 */
export function stellarExpertTxUrl(
  txHash: string,
  network: string = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
): string | null {
  if (!TX_HASH_PATTERN.test(txHash)) return null;
  const segment = EXPLORER_NETWORK[network.toLowerCase()];
  if (!segment) return null;
  return `https://stellar.expert/explorer/${segment}/tx/${txHash.toLowerCase()}`;
}
