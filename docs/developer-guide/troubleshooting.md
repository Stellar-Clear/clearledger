# Troubleshooting Local Development

Use this guide when the steps in [Local Setup](local-setup.md) do not produce a
working frontend and indexer. Run commands from the repository root unless a
section says otherwise.

## Indexer won't start

### PostgreSQL is unavailable

The indexer must connect to PostgreSQL before it starts serving requests. Check
that the container is running and healthy:

```bash
docker compose ps
docker compose logs db
```

Start it with `docker compose up -d`, then confirm that `DATABASE_URL` points to
the same host, port, user, password, and database configured in
`docker-compose.yml`. The default local URL is:

```text
postgresql://postgres:postgres@localhost:5432/clearledger?sslmode=disable
```

If the indexer reports `failed to ping database`, fix the connection before
restarting it. A port conflict usually means another PostgreSQL instance is
already listening on port 5432; stop that instance or update both the Compose
port mapping and `DATABASE_URL`.

### A migration fails

The indexer automatically applies unapplied `*.sql` files from
`indexer/db/migrations` in filename order and records each filename in the
`schema_migrations` table. Do not rename or edit a migration that has already
been applied. Add a new migration with the next numeric prefix instead.

If startup reports that it cannot locate the migration directory, run the
indexer from either the repository root or `indexer/`, or set
`INDEXER_MIGRATIONS_DIR` to the migrations directory. If SQL fails, read the
named migration in the error and compare it with the applied list:

```bash
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

Back up important data before changing migration records or schemas. For a
disposable local database, recreating the container and volume is often safer
than manually forcing a partially applied migration.

## Freighter is not detected

1. Install and unlock the [Freighter browser extension](https://www.freighter.app/).
2. Allow the extension to run on `http://localhost:3000` and refresh the page.
3. Make sure Freighter and the app are both using Stellar Testnet.
4. Disable other Stellar wallet extensions temporarily if more than one is
   injecting a wallet provider.
5. Try a normal browser window. Extensions are commonly disabled in private
   windows unless explicitly allowed.

After changing extension permissions or networks, reload the page and connect
again. ClearLedger intentionally does not restore a wallet session from browser
storage after a reload.

## CORS errors between the frontend and indexer

The frontend defaults to `http://localhost:8080` for the indexer. Set
`NEXT_PUBLIC_API_BASE_URL` if the indexer uses another origin, and restart the
Next.js dev server after changing the value.

The indexer accepts origins listed in the comma-separated `ALLOWED_ORIGINS`
environment variable (the legacy `CORS_ALLOWED_ORIGINS` name is also accepted).
For local development, include the exact frontend origin:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
ALLOWED_ORIGINS=http://localhost:3000
```

Origins must match exactly, including scheme and port. For example,
`http://127.0.0.1:3000` and `http://localhost:3000` are different origins. Restart
the indexer after updating its environment. A `403` response to an `OPTIONS`
request usually means the request origin is not in `ALLOWED_ORIGINS`.

## Soroban RPC errors and timeouts

Testnet RPC can be temporarily unavailable or rate limited. Check that the
frontend and indexer URLs both target Testnet:

```dotenv
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

Also verify that Freighter is set to Testnet and that the configured contract
IDs belong to the same network. Network mismatches commonly appear as missing
contracts, failed simulations, or invalid transaction errors.

For intermittent `429`, timeout, or `5xx` responses, wait briefly and retry.
Avoid repeatedly restarting the indexer, because each restart resumes RPC
polling. If failures persist, check the Stellar status page and RPC response
directly:

```bash
curl -sS https://soroban-testnet.stellar.org/health
```

Use an alternative compatible Testnet RPC provider only after updating both
frontend and indexer configuration so they remain on the same network.

For retry/backoff behavior, safe restarts, reorg halts, database restores,
ledger-gap backfills, and webhook replays, use the
[Indexer Operations Runbook](indexer-operations.md).
