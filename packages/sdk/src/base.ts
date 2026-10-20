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
 * A transport failure occurred while submitting a signed transaction. The
 * network may have accepted it, so callers should check transaction history
 * before asking the user to submit again.
 */
export class TransactionSubmissionUnknownError extends Error {
  readonly method: string;
  readonly cause?: string;

  constructor(method: string, cause?: string) {
    super(
      `Could not confirm submission of ${method}. Check transaction history before retrying to avoid a duplicate.`,
    );
    this.name = "TransactionSubmissionUnknownError";
    this.method = method;
    if (cause) this.cause = cause;
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

export class BaseContractClient {
  protected contractId: string;
  private contractInstance: Contract;

  constructor(contractId: string) {
    if (!contractId) throw new Error("Contract ID is required");
    this.contractId = contractId;
    this.contractInstance = new Contract(contractId);
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
    const server = getSorobanServer();
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
    const config = getConfig();
    const server = getSorobanServer();
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
    const prepared = await withRetry(() => server.prepareTransaction(tx));
    const signed = await signTransactionCompat(prepared.toXDR(), {
      network:
        config.networkPassphrase === Networks.PUBLIC ? "PUBLIC" : "TESTNET",
      networkPassphrase: config.networkPassphrase,
      accountToSign: publicKey,
    });
    let result: Awaited<ReturnType<typeof server.sendTransaction>>;
    try {
      // Do not automatically retry a signed write after a transport failure:
      // the server may have accepted it even if the response was lost.
      result = await server.sendTransaction(
        TransactionBuilder.fromXDR(signed, config.networkPassphrase),
      );
    } catch (error) {
      if (isNetworkError(error)) {
        throw new TransactionSubmissionUnknownError(
          method,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
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
    return result.hash;
  }

  public async simulateTransaction(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ): Promise<SimulationResult> {
    const config = getConfig();
    const server = getSorobanServer();
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
    if (retval) {
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
