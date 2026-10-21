import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import * as freighterApi from "@stellar/freighter-api";
import { getConfig, getSorobanServer } from "./config.js";

const signTransactionFn =
  (
    freighterApi as unknown as {
      signTransaction?: (
        transactionXdr: string,
        opts?: {
          network?: string;
          networkPassphrase?: string;
          accountToSign?: string;
        },
      ) => Promise<string>;
      default?: {
        signTransaction?: (
          transactionXdr: string,
          opts?: {
            network?: string;
            networkPassphrase?: string;
            accountToSign?: string;
          },
        ) => Promise<string>;
      };
    }
  ).signTransaction ||
  (
    freighterApi as unknown as {
      default?: {
        signTransaction?: (
          transactionXdr: string,
          opts?: {
            network?: string;
            networkPassphrase?: string;
            accountToSign?: string;
          },
        ) => Promise<string>;
      };
    }
  ).default?.signTransaction;

if (!signTransactionFn) {
  throw new Error(
    "The installed @stellar/freighter-api package does not expose signTransaction",
  );
}

const signTransactionCompat = signTransactionFn as (
  transactionXdr: string,
  opts?: {
    network?: string;
    networkPassphrase?: string;
    accountToSign?: string;
  },
) => Promise<string>;

const MAX_TRANSACTION_POLL_ATTEMPTS = 30;
const activeWrites = new Set<string>();

/** Thrown when the same contract action is already awaiting confirmation. */
export class TransactionInProgressError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`A transaction for ${method} is already in progress`);
    this.name = "TransactionInProgressError";
    this.method = method;
  }
}

/** Thrown when Freighter is not on the network configured for the SDK. */
export class WalletNetworkMismatchError extends Error {
  readonly expectedNetwork: string;
  readonly actualNetwork: string | null;

  constructor(expectedNetwork: string, actualNetwork: string | null) {
    super(
      actualNetwork
        ? `Wallet network mismatch: expected ${expectedNetwork}, got ${actualNetwork}`
        : `Unable to verify wallet network; reconnect Freighter to ${expectedNetwork}`,
    );
    this.name = "WalletNetworkMismatchError";
    this.expectedNetwork = expectedNetwork;
    this.actualNetwork = actualNetwork;
  }
}

async function assertWalletNetwork(networkPassphrase: string): Promise<void> {
  const expectedNetwork =
    networkPassphrase === Networks.PUBLIC
      ? "public"
      : networkPassphrase === Networks.TESTNET
        ? "testnet"
        : null;
  if (!expectedNetwork) {
    throw new WalletNetworkMismatchError("the configured Stellar network", null);
  }

  const getNetworkDetails = (
    freighterApi as unknown as {
      getNetworkDetails?: () => Promise<{ network?: string }>;
    }
  ).getNetworkDetails;
  if (!getNetworkDetails) {
    throw new WalletNetworkMismatchError(expectedNetwork, null);
  }

  const details = await getNetworkDetails();
  const actualNetwork = details.network?.trim().toLowerCase() || null;
  if (actualNetwork !== expectedNetwork) {
    throw new WalletNetworkMismatchError(expectedNetwork, actualNetwork);
  }
}

export class TransactionTimeoutError extends Error {
  readonly txHash: string;

  constructor(txHash: string) {
    super(`Transaction confirmation timed out for hash: ${txHash}`);
    this.name = "TransactionTimeoutError";
    this.txHash = txHash;
  }
}

/**
 * Thrown when a contract method simulation is rejected by the Soroban RPC
 * before anything is signed or submitted.
 */
export class SimulationError extends Error {
  /** Contract method whose simulation failed. */
  readonly method: string;
  /** Underlying Soroban error message, when the RPC returned one. */
  readonly cause?: string;

  constructor(method: string, message?: string) {
    super(
      message
        ? `Simulation failed for ${method}: ${message}`
        : `Simulation failed for ${method}`,
    );
    this.name = "SimulationError";
    this.method = method;
    if (message) this.cause = message;
  }
}

/**
 * Thrown when a simulation succeeds but returns no result value for the
 * contract method.
 */
export class MissingReturnValueError extends Error {
  /** Contract method that produced no return value. */
  readonly method: string;

  constructor(method: string) {
    super(`No return value from simulation for ${method}`);
    this.name = "MissingReturnValueError";
    this.method = method;
  }
}

/**
 * Thrown when the signed transaction is rejected at submission time by the
 * Soroban RPC.
 */
export class TransactionSendError extends Error {
  /** Contract method whose transaction was rejected on send. */
  readonly method: string;
  /** Underlying Soroban error result, when the RPC returned one. */
  readonly sorobanError?: string;

  constructor(method: string, sorobanError?: string) {
    super(
      sorobanError
        ? `Send failed for ${method}: ${sorobanError}`
        : `Send failed for ${method}`,
    );
    this.name = "TransactionSendError";
    this.method = method;
    if (sorobanError) this.sorobanError = sorobanError;
  }
}

/**
 * Thrown when a submitted transaction is confirmed on-chain as FAILED.
 */
export class TransactionFailedError extends Error {
  /** Contract method whose transaction failed on-chain. */
  readonly method: string;

  constructor(method: string) {
    super(`Transaction failed on-chain for ${method}`);
    this.name = "TransactionFailedError";
    this.method = method;
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("eai_again") ||
    msg.includes("etimedout")
  );
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isNetworkError(err) || attempt === maxAttempts) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)),
      );
    }
  }

  throw lastError;
}

/**
 * Result type returned by transaction simulations.
 */
export interface SimulationResult {
  /** Estimated fee in XLM (formatted to 7 decimal places) */
  estimatedFeeXlm: string;
  /** Name of the contract method being simulated */
  functionName: string;
  /** Decoded return value from the simulation, or undefined if none */
  expectedResult: unknown;
  /** Number of ledger entries accessed (read-only + read-write) */
  footprintSize: number;
}

/** Result of a submitted transaction, including structured failure details. */
export type TransactionSubmissionResult =
  | {
      transactionHash: string;
      status: "SUCCESS";
      returnValue?: unknown;
    }
  | {
      transactionHash: null;
      status: "ERROR";
      error: { name: string; message: string; method: string };
    };

export class BaseContractClient {
  protected contractId: string;
  private contractInstance: Contract;
  private readonly rpcServer?: rpc.Server;

  constructor(contractId: string, rpcServer?: rpc.Server) {
    if (!contractId) throw new Error("Contract ID is required");
    this.contractId = contractId;
    this.contractInstance = new Contract(contractId);
    this.rpcServer = rpcServer;
  }

  /** Returns the per-client transport, falling back to the configured RPC URL. */
  protected getRpcServer(): rpc.Server {
    return this.rpcServer ?? getSorobanServer();
  }

  protected get contract(): Contract {
    return this.contractInstance;
  }

  protected async readContract<T>(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
    parse: (val: xdr.ScVal) => T,
  ): Promise<T> {
    const config = getConfig();
    const server = this.getRpcServer();
    const account = await withRetry(() => server.getAccount(publicKey));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await withRetry(() => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      throw new SimulationError(method, sim.error);
    }
    const resultVal = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
      ?.retval;
    if (!resultVal) throw new MissingReturnValueError(method);
    return parse(resultVal);
  }

  protected async writeContract(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<string> {
    const result = await this.writeContractDetailed(method, args, publicKey);
    return result.transactionHash;
  }

  /** Submits a contract call and returns its confirmed result without throwing. */
  public async submitTransaction(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<TransactionSubmissionResult> {
    try {
      return await this.writeContractDetailed(method, args, publicKey);
    } catch (error) {
      return {
        transactionHash: null,
        status: "ERROR",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          method,
        },
      };
    }
  }

  private async writeContractDetailed(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<Extract<TransactionSubmissionResult, { status: "SUCCESS" }>> {
    const writeKey = `${this.contractId}:${publicKey}:${method}`;
    if (activeWrites.has(writeKey)) {
      throw new TransactionInProgressError(method);
    }

    activeWrites.add(writeKey);
    try {
      return await this.performWriteContractDetailed(method, args, publicKey);
    } finally {
      // Release after success, rejection, RPC failure, or timeout so a retry
      // is possible once this submission has reached a terminal state.
      activeWrites.delete(writeKey);
    }
  }

  private async performWriteContractDetailed(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<Extract<TransactionSubmissionResult, { status: "SUCCESS" }>> {
    const config = getConfig();
    const server = this.getRpcServer();
    const account = await withRetry(() => server.getAccount(publicKey));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await withRetry(() => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim))
      throw new SimulationError(method, sim.error);
    const retval = sim.result?.retval;
    let returnValue: unknown;
    if (retval && retval.switch() !== xdr.ScValType.scvVoid()) {
      try {
        returnValue = scValToNative(retval);
      } catch {
        returnValue = retval;
      }
    }
    const prepared = await withRetry(() => server.prepareTransaction(tx));
    // Re-check at the signing boundary: Freighter can change networks after
    // initial connection or while simulation is running.
    await assertWalletNetwork(config.networkPassphrase);
    const signed = await signTransactionCompat(prepared.toXDR(), {
      network:
        config.networkPassphrase === Networks.PUBLIC ? "PUBLIC" : "TESTNET",
      networkPassphrase: config.networkPassphrase,
      accountToSign: publicKey,
    });
    const result = await withRetry(() =>
      server.sendTransaction(
        TransactionBuilder.fromXDR(signed, config.networkPassphrase),
      ),
    );
    if (result.status === "ERROR")
      throw new TransactionSendError(
        method,
        result.errorResult?.toXDR().toString("base64"),
      );
    let response = await withRetry(() => server.getTransaction(result.hash));
    let attempts = 1;
    while (
      response.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < MAX_TRANSACTION_POLL_ATTEMPTS
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await withRetry(() => server.getTransaction(result.hash));
      attempts++;
    }
    if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND)
      throw new TransactionTimeoutError(result.hash);
    if (response.status === rpc.Api.GetTransactionStatus.FAILED)
      throw new TransactionFailedError(method);
    return {
      transactionHash: result.hash,
      status: "SUCCESS",
      ...(returnValue === undefined ? {} : { returnValue }),
    };
  }

  public async simulateTransaction(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<SimulationResult> {
    const config = getConfig();
    const server = this.getRpcServer();
    const account = await withRetry(() => server.getAccount(publicKey));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await withRetry(() => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim))
      throw new SimulationError(method, sim.error);
    const footprintSize = sim.transactionData
      ? sim.transactionData.getReadOnly().length +
        sim.transactionData.getReadWrite().length
      : 0;
    const retval = sim.result?.retval;
    let expectedResult: unknown = undefined;
    // Soroban encodes both `()` and `None` as scvVoid. Treat these as a
    // successful invocation with no decoded value instead of passing them to
    // the generic native-value decoder.
    if (retval && retval.switch() !== xdr.ScValType.scvVoid()) {
      try {
        expectedResult = scValToNative(retval);
      } catch {
        expectedResult = retval;
      }
    }
    const totalStroops = BigInt(BASE_FEE) + BigInt(sim.minResourceFee || "0");
    return {
      estimatedFeeXlm: (Number(totalStroops) / 10_000_000).toFixed(7),
      functionName: method,
      expectedResult,
      footprintSize,
    };
  }
}
