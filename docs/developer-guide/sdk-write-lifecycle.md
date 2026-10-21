# Wallet-signed Soroban writes

ClearLedger write clients load the signer account, simulate the contract call,
ask Freighter to authorize the prepared transaction, submit the signed XDR once,
and poll Soroban RPC until it is confirmed, failed, or times out. A transport
error after submission is reported as unknown because the network may have
accepted the transaction; signed writes are never automatically resubmitted.

The web app renders these stages through its pending, confirmed, failed, and
unknown transaction states. Relevant implementation files are
`packages/sdk/src/base.ts`, `apps/web/components/shared/TransactionPending.tsx`,
and `apps/web/hooks/useInvoices.ts`. The examples target Stellar Testnet and do
not imply Mainnet readiness.
