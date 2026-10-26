# Indexer signing: trust boundary and key rotation

This page describes which requests the indexer signs, how the server key must
be protected, what is and is not audited, and how to replace the signer. It
reflects the code as of this checkout; where a capability does not exist yet,
this page says so.

## Keys the indexer holds

| Key | Setting | Used for |
| --- | --- | --- |
| Server Stellar keypair | `SERVER_SEED` (a `S...` seed) | Signing `POST /invoices` transactions; read-only Soroban simulations |
| JWT signing secret | `JWT_SECRET` | Issuing and verifying API session tokens |
| Webhook signing secret | per subscription, stored in `webhook_subscriptions` | HMAC-SHA256 signatures on webhook deliveries |

The webhook secret is per subscriber and is not the server key. Rotating it is
covered in [Webhooks](../webhooks.md) and
[Indexer operations, section 5](indexer-operations.md#5-webhook-replay-for-failed-subscribers).

## What the server keypair signs

1. **Invoice creation (`POST /invoices`).** The handler in
   `indexer/api/create_invoice.go` builds the `create_invoice` call, simulates
   it, grafts the simulated Soroban data and resource fee onto the envelope
   (`signCreateInvoiceTx`), signs it with `SERVER_SEED`, and submits it
   (`submitAndConfirm`). The signed envelope is the only transaction the
   server signs for a user request.
2. **Read-only simulations.** The listener and the pool-stats sync use the
   server keypair's address as the source account for `get_stats` and similar
   reads (`indexer/listener/handlers.go`, `indexer/soroban/rpc.go`). Nothing is
   submitted.

Listing and funding are signed by the user's wallet (SME or LP), not by the
server. See [ARCHITECTURE.md](../ARCHITECTURE.md).

## Protecting the server key

- **Production requires `SERVER_SEED`.** When `APP_ENV=production` the indexer
  refuses to start without it (`indexer/config/config.go`). Outside production
  it generates a random keypair at startup, which is not persisted, so it
  cannot be used across restarts.
- **Never use a placeholder.** `SERVER_SEED` is parsed as a real Stellar seed at
  startup (`keypair.ParseFull` in `indexer/listener/soroban.go`), so a value
  such as `change_me` stops the process.
- **Store the seed in a secret manager.** Do not commit it, log it, or put it
  in an image. `.env.example` documents the variable; leave the value empty
  there.
- **Fund the account only as much as needed.** It pays the fees for invoice
  creation. Keep the balance under review, because a drained account stops
  invoice creation.
- **Testnet only.** Nothing in this page makes the server key safe for real
  value. Do not use it on Mainnet until a separate review has signed off.

## Audit logging

- The indexer does **not** write a dedicated audit record for each signature.
  Failures in invoice creation are logged with the server-generated
  `X-Request-Id` (`indexer/api/create_invoice.go`). The transaction hash is
  returned to the caller; this code does not store it in the database.
- Operators who need a signing audit trail should record the transaction
  hashes from the API responses and match them against the request logs, and
  keep them under their own retention policy.
- Adding a per-signature audit event is a code change and is not part of this
  checkout.

## Replacing the signer

There is no online rotation. The server account is the source of invoice
transactions, so changing the key means moving to a new account.

1. Generate a new Stellar keypair in the secret manager. Do not reuse the old
   seed.
2. Fund the new account on the same network.
3. Check whether the deployed contracts restrict which accounts may call them,
   and add the new account if so. The indexer does not verify this.
4. Stop the indexer, set `SERVER_SEED` to the new seed, and start it again.
5. Send one test invoice on Testnet and confirm it is submitted from the new
   account.
6. Keep the old seed offline until no transaction from it is still pending,
   then destroy it.

Between steps 4 and 5 invoice creation is unavailable. Existing invoices and
their on-chain state are not affected by the change.

## Verification

- Check that `.env.example` leaves `SERVER_SEED` empty and documents it as
  required in production.
- Confirm the startup refusal in production by unsetting `SERVER_SEED` with
  `APP_ENV=production` in a disposable environment.
- The links in this page are checked by `pnpm check:links`.
