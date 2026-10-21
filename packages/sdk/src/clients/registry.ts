import { Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { BaseContractClient } from "../base.js";
import { Profile } from "../types/index.js";
import { parseProfile } from "../types/schemas.js";

export class RegistryClient extends BaseContractClient {
  /**
   * Returns the number of registered profiles for a role.
   * @param role - Registry role to count.
   * @param signerPublicKey - Public key used for the read simulation.
   */
  async roleCount(
    role: Profile["role"],
    signerPublicKey: string,
  ): Promise<number> {
    return this.readContract(
      "role_count",
      [nativeToScVal(role, { type: "symbol" })],
      signerPublicKey,
      (val) => Number(scValToNative(val)),
    );
  }

  /**
   * Lists a bounded page of profiles for a role. Limits are capped to keep
   * RPC simulations predictable.
   */
  async listProfiles(
    role: Profile["role"],
    offset: number,
    limit: number,
    signerPublicKey: string,
  ): Promise<Profile[]> {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("offset must be a non-negative integer");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer between 1 and 100");
    }

    return this.readContract(
      "list_profiles",
      [
        nativeToScVal(role, { type: "symbol" }),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ],
      signerPublicKey,
      (val) => {
        const profiles = scValToNative(val);
        if (!Array.isArray(profiles)) return [];
        return profiles.map(parseProfile);
      },
    );
  }

  /**
   * Initializes the registry contract with its admin address.
   * Side effect: stores the admin address on-chain. Can only be called once —
   * a second call panics.
   *
   * @param adminAddress - The Stellar address to set as the contract admin.
   * @param signerPublicKey - The Stellar public key that will sign the transaction. Must be the deployer/admin.
   * @returns The transaction hash of the on-chain submission.
   * @throws If the contract is already initialized, the transaction simulation fails, or on-chain submission errors.
   */
  async initialize(
    adminAddress: string,
    signerPublicKey: string,
  ): Promise<string> {
    const args = [new Address(adminAddress).toScVal()];
    return this.writeContract("initialize", args, signerPublicKey);
  }

  /**
   * Registers an issuer on-chain as a verified invoice issuer.
   * Side effects: stores a `Profile` with `role: Issuer` and `verified: true`, and emits an `issuer_registered` event.
   *
   * @param address - The Stellar address to register as an issuer. Must match `signerPublicKey`.
   * @param metadata - Arbitrary key-value metadata stored alongside the issuer profile.
   * @param signerPublicKey - The Stellar public key that will sign the transaction. `address.require_auth()` is enforced on-chain.
   * @returns The transaction hash of the on-chain submission.
   * @throws If the address is already registered (`AlreadyRegistered`), the transaction simulation fails, or on-chain submission errors.
   */
  async registerIssuer(
    address: string,
    metadata: Record<string, string>,
    signerPublicKey: string,
  ): Promise<string> {
    const args = [new Address(address).toScVal(), nativeToScVal(metadata)];
    return this.writeContract("register_issuer", args, signerPublicKey);
  }

  /**
   * Registers a buyer on-chain.
   * Side effect: stores a `Profile` with `role: Buyer` and `verified: true`.
   *
   * @param address - The Stellar address to register as a buyer. Must match `signerPublicKey`.
   * @param metadata - Arbitrary key-value metadata stored alongside the buyer profile.
   * @param signerPublicKey - The Stellar public key that will sign the transaction. `address.require_auth()` is enforced on-chain.
   * @returns The transaction hash of the on-chain submission.
   * @throws If the address is already registered (`AlreadyRegistered`), the transaction simulation fails, or on-chain submission errors.
   */
  async registerBuyer(
    address: string,
    metadata: Record<string, string>,
    signerPublicKey: string,
  ): Promise<string> {
    const args = [new Address(address).toScVal(), nativeToScVal(metadata)];
    return this.writeContract("register_buyer", args, signerPublicKey);
  }

  /**
   * Checks whether an address is verified in the on-chain registry.
   * This is a read-only (simulated) call — no on-chain side effects.
   *
   * @param address - The Stellar address to check.
   * @param signerPublicKey - The Stellar public key used to simulate the read call.
   * @returns `true` if the address is registered and verified, `false` otherwise (does not panic for unknown addresses).
   * @throws If the simulation fails.
   */
  async isVerified(address: string, signerPublicKey: string): Promise<boolean> {
    const args = [new Address(address).toScVal()];
    return this.readContract(
      "is_verified",
      args,
      signerPublicKey,
      (val) => !!scValToNative(val),
    );
  }

  /**
   * Retrieves the full on-chain profile for a registered address.
   * This is a read-only (simulated) call — no on-chain side effects.
   *
   * @param address - The Stellar address to look up.
   * @param signerPublicKey - The Stellar public key used to simulate the read call.
   * @returns The parsed {@link Profile} object containing address, role, verified status, and registration timestamp.
   * @throws If the address is not registered (`NotFound`), the simulation fails, or the return value cannot be parsed.
   */
  async getProfile(address: string, signerPublicKey: string): Promise<Profile> {
    const args = [new Address(address).toScVal()];
    return this.readContract("get_profile", args, signerPublicKey, (val) =>
      parseProfile(scValToNative(val)),
    );
  }

  /**
   * Revokes an address's verified status on-chain. Admin only.
   * Side effect: sets `verified: false` on the profile. The address can no longer participate in new invoice transactions.
   *
   * @param address - The Stellar address to revoke.
   * @param signerPublicKey - The Stellar public key that will sign the transaction. Must be the registry admin.
   * @returns The transaction hash of the on-chain submission.
   * @throws If the signer is not the admin, the address is not registered, the transaction simulation fails, or on-chain submission errors.
   */
  async revoke(address: string, signerPublicKey: string): Promise<string> {
    const args = [new Address(address).toScVal()];
    return this.writeContract("revoke", args, signerPublicKey);
  }
}
