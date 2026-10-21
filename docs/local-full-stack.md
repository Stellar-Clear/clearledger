# Run ClearLedger locally

The root `docker-compose.yml` starts the web app, indexer, and PostgreSQL. Copy `.env.docker.example` to `.env` and set the Soroban RPC and contract IDs before starting:

```sh
cp .env.docker.example .env
docker compose up --build
```

The indexer API is available at `http://localhost:8080`; the web app uses `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). The indexer health endpoint is `GET /health` and the web app is served on port 3000. Confirm both before opening the dashboard:

```sh
curl -fsS http://localhost:8080/health
curl -I http://localhost:3000
```

If the dashboard reports a network error, check that `NEXT_PUBLIC_API_URL` points to the host name visible from the browser, that the API port is published by Compose, and that `ALLOWED_ORIGINS` includes `http://localhost:3000`. A failed indexer health check usually means the database or Soroban RPC settings are missing; inspect `docker compose logs indexer` and verify `DATABASE_URL`, `SOROBAN_RPC_URL`, and the contract ID variables. This setup is for local Testnet development and makes no Mainnet or financing guarantee.
