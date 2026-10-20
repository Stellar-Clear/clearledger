/** Stable SDK identifiers for contract errors documented by ClearLedger. */
export const CLEARLEDGER_ERROR_CODES = {
  ALREADY_REGISTERED: "ALREADY_REGISTERED",
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  OVERFLOW: "OVERFLOW",
  UNTRUSTED_SIGNER: "UNTRUSTED_SIGNER",
} as const;

export type ClearLedgerErrorCode =
  (typeof CLEARLEDGER_ERROR_CODES)[keyof typeof CLEARLEDGER_ERROR_CODES];

export interface DecodedSorobanError {
  /** Stable ClearLedger code, or `null` when the raw error is not recognized. */
  code: ClearLedgerErrorCode | null;
  /** Human-readable message for known ClearLedger errors. */
  message: string;
  /** Original RPC error text, kept intact for logs and further inspection. */
  raw: string;
}

const KNOWN_ERRORS: Array<{
  pattern: RegExp;
  code: ClearLedgerErrorCode;
  message: string;
}> = [
  {
    pattern: /AlreadyRegistered/i,
    code: CLEARLEDGER_ERROR_CODES.ALREADY_REGISTERED,
    message: "This address is already registered.",
  },
  {
    pattern: /NotFound/i,
    code: CLEARLEDGER_ERROR_CODES.PROFILE_NOT_FOUND,
    message: "The requested registry profile was not found.",
  },
  {
    pattern: /Overflow/i,
    code: CLEARLEDGER_ERROR_CODES.OVERFLOW,
    message: "The contract could not safely represent this value.",
  },
  {
    pattern: /UntrustedSigner/i,
    code: CLEARLEDGER_ERROR_CODES.UNTRUSTED_SIGNER,
    message: "The transaction signer is not trusted by the contract.",
  },
];

/** Decodes documented ClearLedger Soroban errors without discarding the raw RPC response. */
export function decodeSorobanError(raw: string): DecodedSorobanError {
  const known = KNOWN_ERRORS.find((entry) => entry.pattern.test(raw));
  return {
    code: known?.code ?? null,
    message: known?.message ?? "Unknown Soroban contract error.",
    raw,
  };
}
