import { Address, scValToNative } from "@stellar/stellar-sdk";
import { BaseContractClient } from "../base.js";
import { PoolStats } from "../types/index.js";
import { parsePoolStats } from "../types/schemas.js";
import { PoolClient } from "./pool.js";

function asAddress(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Address) return value.toString();
  if (typeof value === "string") return new Address(value).toString();
  throw new Error("Pool factory returned an invalid contract address");
}

/** Read-only client for a multi-asset pool factory contract. */
export class PoolFactoryClient extends BaseContractClient {
  /** Returns the asset addresses registered with the factory. */
  async listAssets(signerPublicKey: string): Promise<string[]> {
    return this.readContract("list_assets", [], signerPublicKey, (value) => {
      const assets = scValToNative(value);
      if (!Array.isArray(assets)) {
        throw new Error("Pool factory returned an invalid asset list");
      }
      return assets.map((asset) => {
        const address = asAddress(asset);
        if (!address) throw new Error("Pool factory returned an empty asset");
        return address;
      });
    });
  }

  /** Returns the pool contract for an asset, or null when no pool is deployed. */
  async getPoolForAsset(
    assetAddress: string,
    signerPublicKey: string,
  ): Promise<string | null> {
    const args = [new Address(assetAddress).toScVal()];
    return this.readContract(
      "get_pool_for_asset",
      args,
      signerPublicKey,
      (value) => asAddress(scValToNative(value)),
    );
  }

  /** Returns aggregate statistics reported by the factory contract. */
  async getAggregateStats(signerPublicKey: string): Promise<PoolStats> {
    return this.readContract(
      "get_aggregate_stats",
      [],
      signerPublicKey,
      (value) => parsePoolStats(scValToNative(value)),
    );
  }

  /** Reads a pool's stats, returning null when the asset has no pool instance. */
  async getPoolStatsForAsset(
    assetAddress: string,
    signerPublicKey: string,
  ): Promise<PoolStats | null> {
    const poolAddress = await this.getPoolForAsset(
      assetAddress,
      signerPublicKey,
    );
    if (!poolAddress) return null;
    return new PoolClient(poolAddress).getStats(signerPublicKey);
  }
}
