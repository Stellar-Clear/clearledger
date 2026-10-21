# Contributing to ClearLedger

Thank you for your interest in contributing to ClearLedger! To maintain code quality, security, and developer alignment across the monorepo, please adhere to the guidelines documented below.

---

## Code of Conduct & Standards

1. **No Placeholders or Stubs**: Do not submit code containing `TODO` comments, stub methods, or mock data (unless isolated to dedicated unit test fixtures). Every PR must contain fully functional, production-ready logic.
2. **Type Safety**:
   - **TypeScript**: Enforce strict typing. Do not use `any` unless absolutely necessary and documented.
   - **Go**: Write clean, idiomatically structured Go code. Use `gofmt` and address all compiler/lint warnings before committing.
3. **Security First**: Validate all user inputs on both the frontend (via Zod schemas) and backend (via parameter validation). Sign all write operations on-chain using the Freighter wallet API wrapper.

## Pull Request Checklist

Before opening or requesting review of a pull request, confirm the following:

- [ ] Code compiles without errors (`pnpm build` / `go build -v .`)
- [ ] TypeScript type-checking passes with no errors (`pnpm typecheck`)
- [ ] Linting passes (`pnpm --filter web lint` / `go vet ./...` and `golangci-lint run`)
- [ ] Translation catalogs are complete (`pnpm check:translations`)
- [ ] All existing and new tests pass (`pnpm test` / `go test -race ./...`)
- [ ] Internal Markdown links pass (`pnpm check:links`)
- [ ] No `TODO`, stub, or placeholder code is present
- [ ] TypeScript changes use strict types (no `any`)
- [ ] New Go code is formatted with `gofmt`
- [ ] Commit messages follow Conventional Commits format
- [ ] PR description explains the change, why it is needed, and how it was tested

---

## Test command coverage

`pnpm build` covers `@clearledger/sdk`, `@clearledger/sdk-react`, `@clearledger/cli`, and `web`. `pnpm test` runs the Vitest suites for those four packages; it does not run Go tests. `pnpm lint` covers SDK and web, while `pnpm typecheck` builds SDK, SDK React, and CLI before checking TypeScript across the workspaces.

Vitest reports `Test Files` and `Tests` (the counts vary by package and checkout). For example:

```text
> pnpm --filter web test

 Test Files  18 passed (18)
      Tests  126 passed (126)
   Start at  14:32:10
   Duration  8.42s
```

Go test output uses the module path `clearledger/indexer` and its package paths. For example:

```text
> cd indexer && go test ./...
ok   clearledger/indexer/api      0.412s
ok   clearledger/indexer/config   0.018s
```

Database integration tests require `TEST_DATABASE_URL`; for Docker Compose use `postgres://postgres:<POSTGRES_PASSWORD>@localhost:5433/postgres?sslmode=disable`. Without that variable, those tests are skipped.

## Documentation links

CI checks every tracked Markdown file for broken relative links and images, missing local files and directories, and invalid heading anchors. External `http(s)` and `mailto` links are not checked.

Run the same check locally before opening a PR:

```bash
pnpm check:links
```

The checker prints each failure as `source:line -> broken target` and exits non-zero when any link is broken. Its own tests cover a valid document, a missing file and a missing anchor:

```bash
pnpm test:links
```

## Git Workflow Guidelines

We follow a strict, linear git history workflow to ensure codebase traceability.

1. **Atomic Commits**: Create one commit per logical unit of work. Do not bundle multiple unrelated changes (e.g. database schema changes and frontend styling updates) into a single commit.
2. **Never Use `git add .` or `git add -A`**: Proactively review and add files individually using:
   ```bash
   git add path/to/file.ext
   ```
3. **Commit & Push Early**: Push to your branch immediately after every local commit. This keeps remote builds in sync and facilitates continuous review.

### Commit Messages

Follow Conventional Commits format:

- `feat(web): add invoice listing cards`
- `fix(indexer): resolve database connection timeout`
- `docs: update setup documentation`
- `test(sdk): add registry client mock tests`

---

## Development Lifecycle

### 1. Build and Compile Verification

Verify compilation across all monorepo packages before submitting code:

```bash
# Build all TypeScript workspace packages
pnpm install
pnpm build

# Compile Go Indexer
cd indexer
go build -v .
```

### 2. Type-Checking

Run the TypeScript compiler in check-only mode across all packages:

```bash
pnpm typecheck
```

This runs `tsc --noEmit` recursively over every TypeScript package in the monorepo and reports type errors without emitting any output files. Fix all errors before opening a PR.

### 3. Linting & Code Quality

The root `pnpm lint` command lints the SDK and web workspaces. Run Go vet separately:

```bash
pnpm lint

# Go linter (static checks used by CI)
cd indexer
go vet ./...
golangci-lint run
```

`golangci-lint` runs the linters enabled in [`indexer/.golangci.yml`](indexer/.golangci.yml) (`errcheck`, `staticcheck`, `govet`, `ineffassign`, `unused`, `errorlint`) with a 5 minute timeout. Install it from <https://golangci-lint.run/welcome/install/> (CI pins the same version the workflow downloads), then run it from the `indexer/` directory. CI runs it on every pull request, so fix (or explicitly annotate with `//nolint:<linter> // <reason>`) every reported issue before opening a PR.

### 4. Testing

The test suite is split across two runtimes. Both must pass before opening a PR.

**TypeScript tests** (SDK, SDK React, CLI, and web, run from the repo root):

```bash
# Run all TypeScript workspace tests
pnpm test

# Run frontend tests only
pnpm --filter web test

# Run SDK tests only
pnpm --filter @clearledger/sdk test

# Check translation catalogs and the checker's fixtures
pnpm check:translations
pnpm --filter web test:translations
```

> **Note:** `pnpm test` runs the `@clearledger/sdk`, `@clearledger/sdk-react`, `@clearledger/cli`, and web Vitest suites. It does **not** run Go tests. UI copy lives in the next-intl catalogs under `apps/web/messages`; see the [i18n guide](docs/developer-guide/i18n.md) before adding a locale or a new message.

**Go tests** (indexer, run from the `indexer/` directory):

```bash
cd indexer && go test -race ./...
```

---
