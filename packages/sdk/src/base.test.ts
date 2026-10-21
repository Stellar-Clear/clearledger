import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BaseContractClient,
  SimulationError,
  MissingReturnValueError,
  TransactionSendError,
  TransactionSubmissionUnknownError,
  TransactionFailedError,
  TransactionTimeoutError,
} from "./base.js";
import * as config from "./config.js";
import { rpc, xdr, Networks, scValToNative } from "@stellar/stellar-sdk";
import * as freighter from "@stellar/freighter-api";

vi.mock("./config.js");
vi.mock("@stellar/freighter-api");
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class MockTransactionBuilder extends actual.TransactionBuilder {}
  MockTransactionBuilder.fromXDR = vi.fn().mockReturnValue("mock-tx") as any;
  return {
    ...actual,
    TransactionBuilder: MockTransactionBuilder,
    scValToNative: vi.fn((val: any) => actual.scValToNative(val)),
  };
});

class TestClient extends BaseContractClient {
  public testReadContract(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
    parse: (val: xdr.ScVal) => any,
  ) {
    return this.readContract(method, args, publicKey, parse);
  }

  public testWriteContract(
    method: string,
    args: xdr.ScVal[],
    publicKey: string,
  ) {
    return this.writeContract(method, args, publicKey);
  }
}

describe("BaseContractClient", () => {
  let client: TestClient;
  let mockServer: any;

  beforeEach(() => {
    client = new TestClient(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    );

    mockServer = {
      getAccount: vi.fn().mockResolvedValue({
        accountId: () =>
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        sequenceNumber: () => "1",
        incrementSequenceNumber: vi.fn(),
      }),
      simulateTransaction: vi.fn(),
      prepareTransaction: vi.fn().mockResolvedValue({
        toXDR: vi.fn().mockReturnValue("mock-xdr"),
      }),
      sendTransaction: vi.fn(),
      getTransaction: vi.fn(),
    };

    vi.mocked(config.getConfig).mockReturnValue({
      networkPassphrase: Networks.TESTNET,
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      contractIds: {
        registry: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        invoice: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        pool: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        escrow: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        agentRegistry:
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      },
      usdc: {
        issuer: "GBUSDC",
        assetCode: "USDC",
      },
    });

    vi.mocked(config.getSorobanServer).mockReturnValue(
      mockServer as unknown as rpc.Server,
    );
    vi.mocked(freighter.signTransaction).mockResolvedValue("signed-xdr");
    vi.mocked(freighter.getNetworkDetails).mockResolvedValue({
      network: "testnet",
    } as any);
  });

  describe("readContract", () => {
    it("successfully reads a contract", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: {
          retval: xdr.ScVal.scvU32(42),
        },
      });

      const result = await client.testReadContract(
        "test_method",
        [],
        "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        (val) => val.u32(),
      );

      expect(result).toBe(42);
      expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it("handles simulation errors", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: "Simulation failed",
      });

      await expect(
        client.testReadContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
          (val) => val.u32(),
        ),
      ).rejects.toBeInstanceOf(SimulationError);
    });

    it("throws MissingReturnValueError when simulation returns no value", async () => {
      mockServer.simulateTransaction.mockResolvedValue({ result: {} });

      await expect(
        client.testReadContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
          (val) => val.u32(),
        ),
      ).rejects.toBeInstanceOf(MissingReturnValueError);
    });
  });

  describe("writeContract", () => {
    it("successfully writes to a contract", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: {
          getReadOnly: () => [],
          getReadWrite: () => [],
        },
        minResourceFee: "100",
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "mock-hash",
      });

      mockServer.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      });

      const hash = await client.testWriteContract(
        "test_method",
        [],
        "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
      );

      expect(hash).toBe("mock-hash");
      expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
      expect(mockServer.prepareTransaction).toHaveBeenCalledTimes(1);
      expect(freighter.signTransaction).toHaveBeenCalledTimes(1);
      expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("does not retry a signed write after an ambiguous network failure", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: { getReadOnly: () => [], getReadWrite: () => [] },
        minResourceFee: "0",
      });
      mockServer.sendTransaction.mockRejectedValue(
        new TypeError("Failed to fetch"),
      );

      await expect(
        client.testWriteContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toBeInstanceOf(TransactionSubmissionUnknownError);
      expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("waits through an RPC NOT_FOUND window before reporting success", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: { getReadOnly: () => [], getReadWrite: () => [] },
        minResourceFee: "0",
      });
      mockServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "mock-hash",
      });
      mockServer.getTransaction
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS });

      vi.useFakeTimers();
      const submission = client.testWriteContract(
        "test_method",
        [],
        "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
      );
      await vi.advanceTimersByTimeAsync(1000);
      await expect(submission).resolves.toBe("mock-hash");
      expect(mockServer.getTransaction).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("handles transaction timeout error", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: {
          getReadOnly: () => [],
          getReadWrite: () => [],
        },
        minResourceFee: "100",
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "mock-hash",
      });

      mockServer.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      // To avoid actually waiting 30 seconds in tests, we could mock the retry delay
      // But testing timeout logic directly is fine too
      // However to not block the whole test run we will just simulate it
      vi.useFakeTimers();

      const promise = expect(
        client.testWriteContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toThrow(TransactionTimeoutError);

      for (let i = 0; i < 35; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await promise;

      vi.useRealTimers();
    });

    it("throws SimulationError when the write simulation fails", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: "write simulation failed",
      });

      await expect(
        client.testWriteContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toBeInstanceOf(SimulationError);
    });

    it("throws TransactionSendError when the RPC rejects the send", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: {
          getReadOnly: () => [],
          getReadWrite: () => [],
        },
        minResourceFee: "100",
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: "ERROR",
        hash: "mock-hash",
        errorResult: { toXDR: () => "AAAA//..." },
      });

      await expect(
        client.testWriteContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toBeInstanceOf(TransactionSendError);
    });

    it("throws TransactionFailedError when the transaction fails on-chain", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: {
          getReadOnly: () => [],
          getReadWrite: () => [],
        },
        minResourceFee: "100",
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "mock-hash",
      });

      mockServer.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
      });

      await expect(
        client.testWriteContract(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toBeInstanceOf(TransactionFailedError);
    });
  });

  describe("simulateTransaction", () => {
    it("returns the expected fee, footprint, and decoded result", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: xdr.ScVal.scvU32(7) },
        transactionData: {
          getReadOnly: () => Array.from({ length: 2 }),
          getReadWrite: () => Array.from({ length: 1 }),
        },
        minResourceFee: "100",
      });

      const result = await client.simulateTransaction(
        "test_method",
        [],
        "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
      );

      expect(result.functionName).toBe("test_method");
      expect(result.expectedResult).toBe(7);
      expect(result.footprintSize).toBe(3);
      // BASE_FEE (100) + minResourceFee (100) = 200 stroops => 0.00002 XLM
      expect(result.estimatedFeeXlm).toBe("0.0000200");
    });

    it.each(["void method", "optional None result"])(
      "returns no decoded value for a %s",
      async () => {
        mockServer.simulateTransaction.mockResolvedValue({
          result: { retval: xdr.ScVal.scvVoid() },
          transactionData: {
            getReadOnly: () => [],
            getReadWrite: () => [],
          },
          minResourceFee: "0",
        });

        const result = await client.simulateTransaction(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        );

        expect(result.expectedResult).toBeUndefined();
      },
    );

    it("falls back to the raw ScVal when scValToNative cannot decode the result", async () => {
      vi.mocked(scValToNative).mockImplementationOnce(() => {
        throw new Error("unsupported scval");
      });
      const retval = xdr.ScVal.scvU32(9);
      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval },
        transactionData: {
          getReadOnly: () => [],
          getReadWrite: () => [],
        },
        minResourceFee: "0",
      });

      const result = await client.simulateTransaction(
        "test_method",
        [],
        "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
      );

      expect(result.expectedResult).toBe(retval);
      expect(result.footprintSize).toBe(0);
    });

    it("throws SimulationError when the simulation fails", async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: "simulation rejected",
      });

      await expect(
        client.simulateTransaction(
          "test_method",
          [],
          "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB",
        ),
      ).rejects.toBeInstanceOf(SimulationError);
    });
  });
});
