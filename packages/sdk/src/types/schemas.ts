import { z } from "zod";
import { Profile, Invoice, PoolStats, LPPosition, Agent } from "./index.js";

// Coercion preprocessing utilities
const bigintSchema = z.preprocess((val) => {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(val);
  if (typeof val === "string") return BigInt(val);
  return 0n;
}, z.bigint());

const numberSchema = z.preprocess((val) => {
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return Number(val);
  return 0;
}, z.number());

const booleanSchema = z.preprocess((val) => {
  return !!val;
}, z.boolean());

const nullableNumberSchema = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (val === 0n || val === 0) return null;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return Number(val);
  return null;
}, z.number().nullable());

// Helper to convert snake_case to camelCase
function toCamelCase(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

// Normalizes Map or Object from scValToNative to a standard JS camelCase object
function normalize(native: unknown): Record<string, any> {
  if (!native || typeof native !== "object") return {};

  const rawObj: Record<string, any> = {};
  if (native instanceof Map) {
    for (const [key, value] of native.entries()) {
      if (typeof key === "string") {
        rawObj[key] = value;
      }
    }
  } else {
    Object.assign(rawObj, native);
  }

  const camelObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(rawObj)) {
    const camelKey = toCamelCase(key);
    camelObj[camelKey] = value;
  }
  return camelObj;
}

// Profile Schema
export const profileSchema = z.object({
  address: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address format"),
  role: z.enum(["issuer", "buyer"]),
  verified: booleanSchema,
  registeredAt: numberSchema,
});

export function parseProfile(native: unknown): Profile {
  const normalized = normalize(native);
  return profileSchema.parse(normalized);
}

// Invoice Schema
export const invoiceSchema = z.object({
  id: z.preprocess(
    (val) => {
      if (typeof val === "string") return val;
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return Buffer.from(val).toString("hex");
      }
      return String(val || "");
    },
    z.string().regex(/^[a-fA-F0-9]{64}$/, "Invalid invoice ID format"),
  ),
  issuer: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address format"),
  buyer: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address format"),
  faceValue: bigintSchema,
  asset: z.enum(["USDC", "XLM"]).default("USDC"),
  discountBps: numberSchema,
  fundedAmount: bigintSchema,
  dueDate: numberSchema,
  status: z.enum([
    "Created",
    "Listed",
    "Funded",
    "Active",
    "Confirmed",
    "Repaid",
    "Defaulted",
  ]),
  createdAt: numberSchema,
  fundedAt: nullableNumberSchema,
  shippedAt: nullableNumberSchema,
  issuerConfirmed: booleanSchema,
  buyerConfirmed: booleanSchema,
  buyerConfirmedAt: nullableNumberSchema.optional(),
  repaidAt: nullableNumberSchema,
  defaultedAt: nullableNumberSchema.optional(),
  attestationAgentId: z.string().nullable().optional(),
  riskScoreBps: z.number().nullable().optional(),
  evidenceHash: z.string().nullable().optional(),
  attestedAt: nullableNumberSchema.optional(),
});

export function parseInvoice(native: unknown): Invoice {
  const normalized = normalize(native);
  return invoiceSchema.parse(normalized);
}

// PoolStats Schema
export const poolStatsSchema = z.object({
  totalDeposits: bigintSchema,
  totalFunded: bigintSchema,
  availableLiquidity: bigintSchema,
  utilizationRateBps: numberSchema,
  totalYieldDistributed: bigintSchema,
  activeInvoiceCount: numberSchema,
  totalShares: bigintSchema,
});

export function parsePoolStats(native: unknown): PoolStats {
  const normalized = normalize(native);
  return poolStatsSchema.parse(normalized);
}

/** Parses the `paused` field returned by the versioned pool configuration. */
export function parsePoolPauseState(native: unknown): boolean {
  const normalized = normalize(native);
  if (typeof normalized.paused !== "boolean") {
    throw new Error("Pool configuration did not include a boolean pause state");
  }
  return normalized.paused;
}

// LPPosition Schema
export const lpPositionSchema = z.object({
  shares: bigintSchema,
  usdcValue: bigintSchema,
  yieldEarned: bigintSchema,
  depositCount: numberSchema,
});

export function parseLPPosition(native: unknown): LPPosition {
  const normalized = normalize(native);
  return lpPositionSchema.parse(normalized);
}

// Agent Schema
export const agentSchema = z.object({
  agentId: z.string().min(1, "Agent ID is required"),
  pubkey: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, "Invalid Stellar address format"),
  active: booleanSchema,
  registeredAt: numberSchema,
});

export function parseAgent(native: unknown): Agent {
  const normalized = normalize(native);
  return agentSchema.parse(normalized);
}
