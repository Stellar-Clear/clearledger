export type StellarNetwork = "testnet" | "mainnet" | "futurenet";

/** Normalize names reported by Freighter and the app's environment config. */
export function normalizeStellarNetwork(value?: string | null): string | null {
  const network = value?.trim().toLowerCase();
  if (!network) return null;
  if (network === "public" || network === "mainnet") return "mainnet";
  if (network === "testnet" || network === "futurenet") return network;
  return network;
}

export function getConfiguredStellarNetwork(): StellarNetwork {
  const configured = normalizeStellarNetwork(
    process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  );
  return configured === "mainnet" || configured === "futurenet"
    ? configured
    : "testnet";
}

export function stellarNetworkLabel(network?: string | null): string {
  const normalized = normalizeStellarNetwork(network);
  if (normalized === "mainnet") return "Mainnet";
  if (normalized === "testnet") return "Testnet";
  if (normalized === "futurenet") return "Futurenet";
  return normalized
    ? normalized.replace(/\b\w/g, (character) => character.toUpperCase())
    : "Unknown";
}

/** Freighter names the public Stellar network `PUBLIC`. */
export function freighterNetworkName(network: StellarNetwork): string {
  return network === "mainnet" ? "PUBLIC" : network.toUpperCase();
}
