# ClearLedger Indexer API Documentation

The OpenAPI 3.0 specification for the Go indexer/API lives in [`indexer.yaml`](./indexer.yaml).

## Routes covered

| Method | Path                       | Auth | Description                       |
| ------ | -------------------------- | ---- | --------------------------------- |
| GET    | `/health`                  | None | Health check                      |
| GET    | `/live`                    | None | Process liveness                  |
| GET    | `/ready`                   | None | PostgreSQL, Soroban, and listener readiness |
| GET    | `/diagnostics`             | JWT  | API connection diagnostics        |
| GET    | `/metrics`                 | None | Prometheus metrics                |
| GET    | `/auth`                    | None | Create SEP-10 challenge           |
| POST   | `/auth`                    | None | Exchange signed challenge for JWT |
| GET    | `/stats`                   | None | Protocol statistics               |
| GET    | `/events`                  | None | List indexed Soroban events       |
| GET    | `/invoices`                | None | List invoices (paginated)         |
| POST   | `/invoices`                | JWT  | Create invoice                    |
| GET    | `/invoices/{id}`           | None | Get invoice by ID                 |
| GET    | `/pool/stats`              | None | Liquidity pool statistics         |
| GET    | `/pool/snapshots`          | None | Historical pool snapshots         |
| GET    | `/pool/position/{address}` | None | LP position by address            |
| POST   | `/webhooks`                | JWT  | Create webhook subscription       |
| GET    | `/webhooks`                | JWT  | List webhook subscriptions        |
| POST   | `/webhooks/{id}/rotate`    | JWT  | Rotate webhook signing secret     |
| DELETE | `/webhooks/{id}`           | JWT  | Delete webhook subscription       |

## Linting

Validate the spec with [Redocly CLI](https://redocly.com/docs/cli/):

```bash
npx @redocly/cli lint docs/openapi/indexer.yaml
```

## Route coverage test

Verify every registered route appears in the spec:

```bash
cd indexer && go test ./api -run TestOpenAPISpecCoversRouterRoutes -v
```

Use any OpenAPI-compatible viewer, such as Swagger UI, Redoc, or Stoplight, to preview the API contract locally.
