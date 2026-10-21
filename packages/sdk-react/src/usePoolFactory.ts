import { useMemo } from "react";
import { PoolFactoryClient } from "@clearledger/sdk";
import { useAsyncQuery } from "./async.js";

export interface UsePoolFactoryOptions {
  client?: PoolFactoryClient;
  contractId?: string;
}

function factoryClient(options: UsePoolFactoryOptions): PoolFactoryClient {
  if (options.client) return options.client;
  if (options.contractId) return new PoolFactoryClient(options.contractId);
  throw new Error(
    "usePoolFactory: provide an injected PoolFactoryClient or a contractId",
  );
}

/** Reads the asset addresses registered with a pool factory. */
export function usePoolFactoryAssets(
  signerPublicKey: string,
  options: UsePoolFactoryOptions,
) {
  const client = useMemo(
    () =>
      factoryClient({ client: options.client, contractId: options.contractId }),
    [options.client, options.contractId],
  );
  return useAsyncQuery(
    () => client.listAssets(signerPublicKey),
    [client, signerPublicKey],
  );
}

/** Reads a factory's pool address for an asset; missing pools return null. */
export function usePoolForAsset(
  assetAddress: string,
  signerPublicKey: string,
  options: UsePoolFactoryOptions,
) {
  const client = useMemo(
    () =>
      factoryClient({ client: options.client, contractId: options.contractId }),
    [options.client, options.contractId],
  );
  return useAsyncQuery(
    () => client.getPoolForAsset(assetAddress, signerPublicKey),
    [client, assetAddress, signerPublicKey],
  );
}

/** Reads aggregate stats from the factory, separate from a single pool. */
export function usePoolFactoryStats(
  signerPublicKey: string,
  options: UsePoolFactoryOptions,
) {
  const client = useMemo(
    () =>
      factoryClient({ client: options.client, contractId: options.contractId }),
    [options.client, options.contractId],
  );
  return useAsyncQuery(
    () => client.getAggregateStats(signerPublicKey),
    [client, signerPublicKey],
  );
}

/** Reads a pool's stats for an asset, returning null when no pool exists. */
export function usePoolStatsForAsset(
  assetAddress: string,
  signerPublicKey: string,
  options: UsePoolFactoryOptions,
) {
  const client = useMemo(
    () =>
      factoryClient({ client: options.client, contractId: options.contractId }),
    [options.client, options.contractId],
  );
  return useAsyncQuery(
    () => client.getPoolStatsForAsset(assetAddress, signerPublicKey),
    [client, assetAddress, signerPublicKey],
  );
}
