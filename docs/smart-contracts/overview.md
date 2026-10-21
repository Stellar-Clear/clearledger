# Smart Contracts Overview

ClearLedger runs on four Soroban contracts deployed on Stellar testnet. They call each
other in a defined pattern — the dependency order is fixed and enforced by stored
contract addresses, not off-chain access control.

### Deployed addresses (Stellar testnet)

| Contract          | Address                                                    |
| ----------------- | ---------------------------------------------------------- |
| registry_contract | `CCGHK4XJA23BVPTADPCOUV76G2KYAAAKQIKPF35FN5RFP2TT47TXWQNT` |
| invoice_contract  | `CCZN4GM5O7D6RGI4P4FCKIB5HMRKDWOWY7M3YZ637XZFCGM7SXGIVAZ6` |
| escrow_contract   | `CC3EDR7B64Y5KZEJETATNVUWYGPHGUAR2V2QYTUCDOZJMYY3XEVAIGQB` |
| pool_contract     | `CDBJEGCV3IENZJKCK3LYYOSA7B5NZSPELBE7FPFHUKLG74LRJTCQIZ45` |

These match the `NEXT_PUBLIC_*_CONTRACT_ID` values in the root `.env.example`
and `apps/web/.env.example`. For a guided Testnet walkthrough using the pool
contract, see the [Stellar Testnet quickstart](../QUICKSTART.md).

### Call graph

```
pool_contract ──── is_verified() ──────► registry_contract
invoice_contract ── is_verified() ──────► registry_contract
pool_contract ──── lock() ──────────────► escrow_contract
pool_contract ──── release_to_issuer() ─► escrow_contract
pool_contract ──── mark_funded() ───────► invoice_contract
invoice_contract ── receive_repayment() ─► pool_contract
```

### Key implementation details

**All amounts in stroops.** 1 USDC = 10,000,000 stroops. The frontend SDK converts
to human-readable values. Contracts never use decimals.

**TTL extension on every write.** Every `persistent().set()` is immediately followed
by `extend_ttl()`. Soroban storage entries expire — skipping TTL extension causes
data loss.

**Auth enforced on-chain.** `pool_contract` is the only address authorized to call
`escrow_contract` write functions and `invoice_contract.mark_funded()`. This is
enforced by comparing `require_auth()` against a stored contract address — not an
API key or off-chain rule.

**Dual delivery confirmation.** Both issuer and buyer must call `confirm_delivery()`
independently. Neither can complete the confirmation alone.
