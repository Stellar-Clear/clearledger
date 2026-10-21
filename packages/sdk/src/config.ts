import { Networks, rpc } from "@stellar/stellar-sdk";

export const DEFAULT_NETWORK = {
  network:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_STELLAR_NETWORK) ||
    "testnet",
  horizonUrl:
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_HORIZON_URL) ||
    "https://horizon-testnet.stellar.org",
  sorobanRpcUrl:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_SOROBAN_RPC_URL) ||
    "https://soroban-testnet.stellar.org",
  networkPassphrase:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_NETWORK_PASSPHRASE) ||
    Networks.TESTNET,
};

export const DEFAULT_CONTRACTS = {
  registry:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_REGISTRY_CONTRACT_ID) ||
    "",
  invoice:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_INVOICE_CONTRACT_ID) ||
    "",
  pool:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_POOL_CONTRACT_ID) ||
    "",
  escrow:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_ESCROW_CONTRACT_ID) ||
    "",
  agentRegistry:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_AGENT_REGISTRY_CONTRACT_ID) ||
    "",
};

export const DEFAULT_USDC = {
  issuer:
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_USDC_ISSUER) ||
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  assetCode:
    (typeof process !== "undefined" &&
      process.env?.NEXT_PUBLIC_USDC_ASSET_CODE) ||
    "USDC",
};

export interface SDKConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  contractIds: {
    registry: string;
    invoice: string;
    pool: string;
    escrow: string;
    agentRegistry: string;
  };
  usdc: {
    issuer: string;
    assetCode: string;
  };
}

export class SDKConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SDKConfigurationError";
  }
}

export function validateSDKConfiguration(config: SDKConfig = activeConfig): void {
  if (!config.networkPassphrase || !config.sorobanRpcUrl) {
    throw new SDKConfigurationError("Stellar network configuration is incomplete");
  }
  const missing = Object.entries(config.contractIds)
    .filter(([, contractId]) => !contractId)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new SDKConfigurationError(`Missing contract IDs: ${missing.join(", ")}`);
  }
}

let activeConfig: SDKConfig = {
  horizonUrl: DEFAULT_NETWORK.horizonUrl,
  sorobanRpcUrl: DEFAULT_NETWORK.sorobanRpcUrl,
  networkPassphrase: DEFAULT_NETWORK.networkPassphrase,
  contractIds: {
    registry: DEFAULT_CONTRACTS.registry,
    invoice: DEFAULT_CONTRACTS.invoice,
    pool: DEFAULT_CONTRACTS.pool,
    escrow: DEFAULT_CONTRACTS.escrow,
    agentRegistry: DEFAULT_CONTRACTS.agentRegistry,
  },
  usdc: {
    issuer: DEFAULT_USDC.issuer,
    assetCode: DEFAULT_USDC.assetCode,
  },
};

export function configureSDK(config: Partial<SDKConfig>) {
  activeConfig = {
    ...activeConfig,
    ...config,
    contractIds: {
      ...activeConfig.contractIds,
      ...config.contractIds,
    },
    usdc: {
      ...activeConfig.usdc,
      ...config.usdc,
    },
  };
}

export function getConfig(): SDKConfig {
  return activeConfig;
}

export function getSorobanServer(): rpc.Server {
  return new rpc.Server(activeConfig.sorobanRpcUrl);
}
