import { describe, it, expect, vi } from "vitest";
import { rpc, Networks } from "@stellar/stellar-sdk";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: class MockServer {
        url: string;
        constructor(url: string) {
          this.url = url;
        }
      } as any,
    },
  };
});

import {
  DEFAULT_NETWORK,
  DEFAULT_CONTRACTS,
  DEFAULT_USDC,
  configureSDK,
  getConfig,
  getSorobanServer,
  validateSDKConfiguration,
} from "./config.js";

describe("config", () => {
  describe("DEFAULT_NETWORK", () => {
    it("has sensible defaults for testnet", () => {
      expect(DEFAULT_NETWORK.network).toBe("testnet");
      expect(DEFAULT_NETWORK.horizonUrl).toBe(
        "https://horizon-testnet.stellar.org",
      );
      expect(DEFAULT_NETWORK.sorobanRpcUrl).toBe(
        "https://soroban-testnet.stellar.org",
      );
      expect(DEFAULT_NETWORK.networkPassphrase).toBe(Networks.TESTNET);
    });
  });

  describe("DEFAULT_CONTRACTS", () => {
    it("has string fallback contract IDs", () => {
      expect(DEFAULT_CONTRACTS.registry).toBeTypeOf("string");
      expect(DEFAULT_CONTRACTS.invoice).toBeTypeOf("string");
      expect(DEFAULT_CONTRACTS.pool).toBeTypeOf("string");
      expect(DEFAULT_CONTRACTS.escrow).toBeTypeOf("string");
    });
  });

  describe("DEFAULT_USDC", () => {
    it("defaults to the well-known USDC issuer and asset code", () => {
      expect(DEFAULT_USDC.issuer).toBe(
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      );
      expect(DEFAULT_USDC.assetCode).toBe("USDC");
    });
  });

  describe("configureSDK / getConfig", () => {
    it("getConfig returns the default config before any configureSDK call", () => {
      const config = getConfig();
      expect(config.horizonUrl).toBe(DEFAULT_NETWORK.horizonUrl);
      expect(config.sorobanRpcUrl).toBe(DEFAULT_NETWORK.sorobanRpcUrl);
      expect(config.networkPassphrase).toBe(DEFAULT_NETWORK.networkPassphrase);
      expect(config.contractIds).toEqual({
        registry: DEFAULT_CONTRACTS.registry,
        invoice: DEFAULT_CONTRACTS.invoice,
        pool: DEFAULT_CONTRACTS.pool,
        escrow: DEFAULT_CONTRACTS.escrow,
        agentRegistry: DEFAULT_CONTRACTS.agentRegistry,
      });
      expect(config.usdc).toEqual({
        issuer: DEFAULT_USDC.issuer,
        assetCode: DEFAULT_USDC.assetCode,
      });
    });

    it("shallow-merges top-level keys via configureSDK", () => {
      configureSDK({ horizonUrl: "https://custom-horizon.example.com" });
      const config = getConfig();
      expect(config.horizonUrl).toBe("https://custom-horizon.example.com");
      expect(config.sorobanRpcUrl).toBe(DEFAULT_NETWORK.sorobanRpcUrl);
    });

    it("deep-merges contractIds via configureSDK", () => {
      configureSDK({
        contractIds: {
          registry: "C_NEW_REG",
          invoice: "",
          pool: "",
          escrow: "",
        },
      } as any);
      const config = getConfig();
      expect(config.contractIds.registry).toBe("C_NEW_REG");
      expect(config.contractIds.invoice).toBe(DEFAULT_CONTRACTS.invoice);
      expect(config.contractIds.pool).toBe(DEFAULT_CONTRACTS.pool);
      expect(config.contractIds.escrow).toBe(DEFAULT_CONTRACTS.escrow);
    });

    it("deep-merges usdc via configureSDK", () => {
      configureSDK({
        usdc: { issuer: "G_NEW_ISSUER", assetCode: DEFAULT_USDC.assetCode },
      } as any);
      const config = getConfig();
      expect(config.usdc.issuer).toBe("G_NEW_ISSUER");
      expect(config.usdc.assetCode).toBe(DEFAULT_USDC.assetCode);
    });
  });

  describe("getSorobanServer", () => {
    it("creates an rpc.Server using the active sorobanRpcUrl", () => {
      const server = getSorobanServer();
      expect(server).toBeDefined();
      expect((server as any).url).toBe(DEFAULT_NETWORK.sorobanRpcUrl);
    });

    it("reflects a custom sorobanRpcUrl after configureSDK", () => {
      configureSDK({ sorobanRpcUrl: "https://custom-rpc.example.com" });
      const server = getSorobanServer();
      expect((server as any).url).toBe("https://custom-rpc.example.com");
    });
  });
});

describe("validateSDKConfiguration network fields", () => {
  const valid = () => ({
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    contractIds: { registry: "C1", invoice: "C2", pool: "C3", escrow: "C4", agentRegistry: "C5" },
    usdc: { issuer: "G1", assetCode: "USDC" },
  });

  it("accepts the testnet and public passphrases", () => {
    expect(() => validateSDKConfiguration(valid())).not.toThrow();
    expect(() => validateSDKConfiguration({ ...valid(), networkPassphrase: Networks.PUBLIC })).not.toThrow();
  });

  it("names networkPassphrase when it is not a known network", () => {
    expect(() => validateSDKConfiguration({ ...valid(), networkPassphrase: "Some Other Net" })).toThrow(
      /Invalid networkPassphrase/,
    );
  });

  it("names sorobanRpcUrl when it is not an http URL", () => {
    expect(() => validateSDKConfiguration({ ...valid(), sorobanRpcUrl: "ftp://rpc.example.com" })).toThrow(
      /Invalid sorobanRpcUrl/,
    );
  });

  it("names horizonUrl when it is not a URL", () => {
    expect(() => validateSDKConfiguration({ ...valid(), horizonUrl: "not a url" })).toThrow(/Invalid horizonUrl/);
  });
});
