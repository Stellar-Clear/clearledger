import { useWalletStore } from "@/store/wallet";
import { parseInvoiceResponse } from "@/lib/parsers";
import {
  AssetType,
  Invoice,
  PoolStats,
  LPPosition,
  EventLog,
  PoolSnapshot,
} from "@/types";

/**
 * Raw snake_case wire shapes returned by the indexer API. These mirror the
 * documented payloads in docs/developer-guide/indexer-api-reference.md so the
 * network boundaries in `apiFetch` are typed instead of `any`. Fields that
 * only appear for later lifecycle stages are optional; the normalization
 * helpers below tolerate their absence.
 */

/** Wire shape for `GET /invoices` and `GET /invoices/:id`. */
interface RawInvoice {
  id: string;
  issuer: string;
  buyer: string;
  face_value: string;
  funded_amount?: string;
  discount_bps?: number;
  due_date?: number;
  status?: string;
  created_at?: number;
  funded_at?: number | null;
  shipped_at?: number | null;
  repaid_at?: number | null;
  listed_at?: number | null;
  issuer_confirmed_at?: number | null;
  buyer_confirmed_at?: number | null;
  defaulted_at?: number | null;
  issuer_confirmed?: boolean;
  buyer_confirmed?: boolean;
  transaction_hashes?: unknown;
  tx_hashes?: unknown;
  created_tx_hash?: unknown;
  listed_tx_hash?: unknown;
  funded_tx_hash?: unknown;
  shipped_tx_hash?: unknown;
  issuer_confirmed_tx_hash?: unknown;
  buyer_confirmed_tx_hash?: unknown;
  repaid_tx_hash?: unknown;
  defaulted_tx_hash?: unknown;
}

/** Wire shape for `GET /pool/stats`. */
interface RawPoolStats {
  total_deposits: string;
  total_funded: string;
  available_liquidity: string;
  utilization_rate_bps: number;
  total_yield_distributed: string;
  active_invoice_count: number;
  total_shares?: string;
}

/** Wire shape for `GET /pool/position/:address`. */
interface RawLPPosition {
  shares: string;
  usdc_value: string;
  yield_earned: string;
  deposit_count: number;
}

/** Wire shape for `GET /events`. */
interface RawEventLog {
  id: number;
  event_id: string;
  contract_id: string;
  ledger: number;
  ledger_closed_at: number;
  event_type: string;
  data: Record<string, unknown>;
}

const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
};

export const apiClient = {
  token: undefined as string | undefined,
  setToken(token: string | undefined): void {
    this.token = token;
  },
  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    return apiFetch<T>(path, options);
  },
};

function initApiClientWithToken(): void {
  const token = useWalletStore.getState().token;
  apiClient.setToken(token ?? undefined);
}

export { initApiClientWithToken };

/**
 * Low-level helper that performs an authenticated `fetch` against the ClearLedger
 * API. It injects the current wallet token as a Bearer header, sets a JSON
 * `Content-Type` for POST/PUT requests, and normalizes error responses
 * (including friendly messages for 503/504 outages).
 *
 * @param path - The API path (e.g. `/invoices/123`). Prepended with the base URL.
 * @param options - Standard `fetch` `RequestInit` (method, body, headers, etc.).
 * @returns A promise resolving to the parsed JSON body, typed as `T`.
 *
 * @throws {Error} When the response is not OK. For 503/504 responses the
 *   message is "Service Temporarily Unavailable. Please try again later.".
 *
 * @example
 * ```ts
 * const stats = await apiFetch<ProtocolStats>("/stats");
 * ```
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useWalletStore.getState().token;
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (
    !headers.has("Content-Type") &&
    (options.method === "POST" || options.method === "PUT")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 503 || res.status === 504) {
      throw new Error(
        text || "Service Temporarily Unavailable. Please try again later.",
      );
    }
    let errorMessage = text;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object") {
        if ("error" in json && typeof json.error === "string") {
          errorMessage = json.error;
        } else if ("message" in json && typeof json.message === "string") {
          errorMessage = json.message;
        }
      }
    } catch {
      // Not JSON
    }
    throw new Error(errorMessage || `HTTP error! status: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBigInt(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(val);
  if (typeof val === "string") return BigInt(val);
  return 0n;
}

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return Number(val);
  return 0;
}

/**
 * Normalizes a raw pool stats payload from the API into a typed `PoolStats`.
 * Missing or invalid fields fall back to safe defaults (`0n`/`0`).
 *
 * @param raw - The untyped response object returned by the API.
 * @returns A `PoolStats` with:
 *   - `totalDeposits` — `bigint` total USDC deposited into the pool (stroops).
 *   - `totalFunded` — `bigint` total USDC used to fund invoices (stroops).
 *   - `availableLiquidity` — `bigint` USDC available for new funding (stroops).
 *   - `utilizationRateBps` — `number` utilization as basis points (10000 = 100%).
 *   - `totalYieldDistributed` — `bigint` cumulative yield paid to LPs (stroops).
 *   - `activeInvoiceCount` — `number` count of invoices currently being funded.
 *   - `totalShares` — `bigint` total LP shares outstanding.
 */
export function parseRawPoolStats(raw: unknown): PoolStats {
  const r = isRecord(raw) ? raw : {};
  return {
    totalDeposits: toBigInt(r.total_deposits),
    totalFunded: toBigInt(r.total_funded),
    availableLiquidity: toBigInt(r.available_liquidity),
    utilizationRateBps: toNumber(r.utilization_rate_bps),
    totalYieldDistributed: toBigInt(r.total_yield_distributed),
    activeInvoiceCount: toNumber(r.active_invoice_count),
    totalShares: toBigInt(r.total_shares),
  };
}

/**
 * Normalizes a raw LP position payload from the API into a typed `LPPosition`.
 * Missing or invalid fields fall back to safe defaults (`0n`/`0`).
 *
 * @param raw - The untyped response object returned by the API.
 * @returns An `LPPosition` with:
 *   - `shares` — `bigint` LP shares held by the address (stroops).
 *   - `usdcValue` — `bigint` current USDC value of the position (stroops).
 *   - `yieldEarned` — `bigint` cumulative yield earned (stroops).
 *   - `depositCount` — `number` number of deposits made by the address.
 */
export function parseRawLPPosition(raw: unknown): LPPosition {
  const r = isRecord(raw) ? raw : {};
  return {
    shares: toBigInt(r.shares),
    usdcValue: toBigInt(r.usdc_value),
    yieldEarned: toBigInt(r.yield_earned),
    depositCount: toNumber(r.deposit_count),
  };
}

/**
 * Normalizes a raw event-log entry from the API into a typed `EventLog`.
 * Missing or invalid fields fall back to safe defaults.
 *
 * @param raw - The untyped response object returned by the API.
 * @returns An `EventLog` with:
 *   - `id` — `number` numeric identifier of the event.
 *   - `event_id` — `string` on-chain event identifier.
 *   - `contract_id` — `string` Stellar contract that emitted the event.
 *   - `ledger` — `number` ledger sequence at which the event was recorded.
 *   - `ledger_closed_at` — `number` Unix timestamp when the ledger closed.
 *   - `event_type` — `string` the kind of event (e.g. `deposit`, `repay`).
 *   - `data` — `Record<string, unknown>` arbitrary event payload.
 */
export function parseRawEventLog(raw: unknown): EventLog {
  const r = isRecord(raw) ? raw : {};
  return {
    id: toNumber(r.id),
    event_id: String(r.event_id ?? ""),
    contract_id: String(r.contract_id ?? ""),
    ledger: toNumber(r.ledger),
    ledger_closed_at: toNumber(r.ledger_closed_at),
    event_type: String(r.event_type ?? ""),
    data: (r.data as Record<string, unknown>) || {},
  };
}

/**
 * Requests a Stellar auth challenge (a presigned transaction) that the user
 * must sign with their wallet to prove ownership of `address`.
 *
 * @param address - The Stellar account address requesting authentication.
 * @returns A promise resolving to:
 *   - `transaction` — `string` XDR of the challenge transaction to sign.
 *   - `network_passphrase` — `string` network passphrase used to sign it.
 *
 * @example
 * ```ts
 * const { transaction, network_passphrase } = await fetchChallenge(address);
 * const signed = await signTransaction(transaction, { networkPassphrase });
 * ```
 */
export async function fetchChallenge(
  address: string,
): Promise<{ transaction: string; network_passphrase: string }> {
  return apiFetch<{ transaction: string; network_passphrase: string }>(
    `/auth?address=${address}`,
  );
}

/**
 * Submits a wallet-signed challenge transaction to obtain an auth token.
 *
 * @param transaction - The signed challenge transaction XDR from `fetchChallenge`.
 * @returns A promise resolving to:
 *   - `token` — `string` JWT bearer token to use for authenticated requests.
 */
export async function verifyChallenge(
  transaction: string,
): Promise<{ token: string }> {
  return apiFetch<{ token: string }>("/auth", {
    method: "POST",
    body: JSON.stringify({ transaction }),
  });
}

/**
 * Creates a new invoice on-chain via the API.
 *
 * @param buyer - The Stellar address of the invoice buyer.
 * @param faceValue - The invoice face value as a decimal string (in asset units).
 * @param dueDate - Unix timestamp (seconds) when the invoice is due.
 * @param asset - The denomination asset; defaults to `"USDC"`.
 * @returns A promise resolving to:
 *   - `invoice_id` — `string` the new invoice's id.
 *   - `transaction_hash` — `string` hash of the on-chain creation transaction.
 *   - `status` — `string` initial invoice status (e.g. `"pending"`).
 *
 * @example
 * ```ts
 * const res = await createInvoice(buyer, "1000.00", dueDate);
 * ```
 */
export async function createInvoice(
  buyer: string,
  faceValue: string,
  dueDate: number,
  asset: AssetType = "USDC",
): Promise<{ invoice_id: string; transaction_hash: string; status: string }> {
  return apiFetch<{
    invoice_id: string;
    transaction_hash: string;
    status: string;
  }>("/invoices", {
    method: "POST",
    body: JSON.stringify({
      buyer,
      face_value: faceValue,
      due_date: dueDate,
      asset,
    }),
  });
}

/**
 * Fetches a single invoice by its id and normalizes it into a typed `Invoice`.
 *
 * @param id - The invoice id to fetch.
 * @returns A promise resolving to the `Invoice`, whose fields include:
 *   - `id` — `string` invoice id.
 *   - `issuer` / `buyer` — `string` Stellar addresses.
 *   - `faceValue` — `bigint` invoice face value (stroops).
 *   - `asset` — `AssetType` denomination asset.
 *   - `discountBps` — `number` discount in basis points.
 *   - `fundedAmount` — `bigint` amount funded so far (stroops).
 *   - `dueDate` — `number` Unix timestamp of the due date.
 *   - `status` — `InvoiceStatus` lifecycle status.
 *   - `createdAt` / `fundedAt` / `shippedAt` / `repaidAt` — `number | null` timestamps.
 *   - `issuerConfirmed` / `buyerConfirmed` — `boolean` confirmation flags.
 */
export async function getInvoiceByID(id: string): Promise<Invoice> {
  const raw = await apiFetch<RawInvoice>(`/invoices/${id}`);
  return parseInvoiceResponse(raw);
}

export interface PaginatedInvoices {
  data: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Fetches a paginated/filtered list of invoices and normalizes each entry.
 *
 * @param filters - Optional query filters:
 *   - `status` — `string` filter by `InvoiceStatus`.
 *   - `issuer` — `string` filter by issuer Stellar address.
 *   - `page` — `number` 1-based page index.
 *   - `limit` — `number` page size.
 * @returns A promise resolving to a `PaginatedInvoices`:
 *   - `data` — `Invoice[]` the normalized invoices for this page.
 *   - `total` — `number` total matching invoices across all pages.
 *   - `page` — `number` the current page index.
 *   - `limit` — `number` the page size.
 *   - `totalPages` — `number` total number of pages available.
 *
 * @example
 * ```ts
 * const { data, totalPages } = await getInvoices({ status: "funded", page: 1 });
 * ```
 */
export async function getInvoices(filters?: {
  status?: string;
  issuer?: string;
  page?: number;
  limit?: number;
}, signal?: AbortSignal): Promise<PaginatedInvoices> {
  const params = new URLSearchParams();
  if (filters?.status) params.append("status", filters.status);
  if (filters?.issuer) params.append("issuer", filters.issuer);
  if (filters?.page != null) params.append("page", String(filters.page));
  if (filters?.limit != null) params.append("limit", String(filters.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";

  const raw = await apiFetch<{
    data: RawInvoice[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> (`/invoices${query}`, signal ? { signal } : undefined);

  return {
    data: raw.data.map(parseInvoiceResponse),
    total: raw.total,
    page: raw.page,
    limit: raw.limit,
    totalPages: raw.totalPages,
  };
}

/**
 * Fetches aggregate pool statistics for the liquidity pool.
 *
 * @returns A promise resolving to a `PoolStats` (see `parseRawPoolStats` for
 *   the field descriptions: `totalDeposits`, `totalFunded`,
 *   `availableLiquidity`, `utilizationRateBps`, `totalYieldDistributed`,
 *   `activeInvoiceCount`, `totalShares`).
 */
export async function getPoolStats(): Promise<PoolStats> {
  const raw = await apiFetch<RawPoolStats>("/pool/stats");
  return parseRawPoolStats(raw);
}

/**
 * Fetches the liquidity-provider position for a given address.
 *
 * @param address - The Stellar address whose LP position to fetch.
 * @returns A promise resolving to an `LPPosition` (see `parseRawLPPosition`
 *   for the field descriptions: `shares`, `usdcValue`, `yieldEarned`,
 *   `depositCount`).
 */
export async function getLPPosition(address: string): Promise<LPPosition> {
  const raw = await apiFetch<RawLPPosition>(`/pool/position/${address}`);
  return parseRawLPPosition(raw);
}

/**
 * Fetches recent on-chain events, most recent first.
 *
 * @param limit - Optional maximum number of events to return.
 * @returns A promise resolving to an `EventLog[]`; each entry is described by
 *   `parseRawEventLog` (`id`, `event_id`, `contract_id`, `ledger`,
 *   `ledger_closed_at`, `event_type`, `data`).
 */
export async function getRecentEvents(limit?: number): Promise<EventLog[]> {
  const query = limit ? `?limit=${limit}` : "";
  const rawList = await apiFetch<RawEventLog[]>(`/events${query}`);
  return rawList.map(parseRawEventLog);
}

/**
 * Fetches historical pool snapshots used for charts and trend analysis.
 *
 * @returns A promise resolving to a `PoolSnapshot[]`, each with:
 *   - `timestamp` — `number` Unix timestamp of the snapshot.
 *   - `utilizationRateBps` — `number` utilization at that time (basis points).
 *   - `totalYieldDistributed` — `string` cumulative yield up to that time.
 */
export async function getPoolSnapshots(): Promise<PoolSnapshot[]> {
  return apiFetch<PoolSnapshot[]>("/pool/snapshots");
}

export interface ProtocolStats {
  total_usdc_financed: string;
  active_invoice_count: number;
  total_invoices: number;
  total_repaid: number;
  total_defaulted: number;
  average_yield_bps: number;
  pool_utilization_bps: number;
  registered_issuers: number;
}

/**
 * Fetches high-level protocol-wide statistics.
 *
 * @returns A promise resolving to a `ProtocolStats` with:
 *   - `total_usdc_financed` — `string` total USDC financed (decimal string).
 *   - `active_invoice_count` — `number` invoices currently being funded.
 *   - `total_invoices` — `number` invoices created since genesis.
 *   - `total_repaid` — `number` invoices fully repaid.
 *   - `total_defaulted` — `number` invoices defaulted.
 *   - `average_yield_bps` — `number` average realized yield (basis points).
 *   - `pool_utilization_bps` — `number` current pool utilization (basis points).
 *   - `registered_issuers` — `number` count of registered issuers.
 */
export async function getProtocolStats(): Promise<ProtocolStats> {
  return apiFetch<ProtocolStats>("/stats");
}
