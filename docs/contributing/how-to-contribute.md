# How to Contribute

ClearLedger is an open-source testnet project. Contributions that improve transaction safety, usability, protocol documentation and developer tooling are welcome.

### Find an issue

Start with the issue tracker for the repository you are contributing to. If the change is not tracked yet, open an issue describing the problem and proposed scope before beginning a larger implementation.

Issues are labeled by complexity:

- `complexity:low` — isolated scope, good starting point
- `complexity:medium` — touches 2–3 components
- `complexity:high` — architectural changes

Assign yourself to an issue before starting work. If two people are working on
the same issue, only one PR will be merged.

### Setup

Follow the local setup guide for the repo you are contributing to:

- [App repo setup](../developer-guide/local-setup.md)
- Contracts repo setup

### Branch naming

```
feat/123-short-description
fix/456-short-description
docs/short-description
test/short-description
```

### Commit format

```
feat(web): add invoice status timeline component
fix(sdk): handle soroban rpc timeout with retry
test(pool): add yield distribution unit tests
docs(api): add indexer pagination reference
```

### PR checklist

Before opening a PR:

- [ ] All existing tests pass
- [ ] New tests written for new functionality
- [ ] TypeScript compiles with no errors (`tsc --noEmit`)
- [ ] No `console.log` left in production code
- [ ] Internal Markdown links pass (`pnpm check:links`)
- [ ] Commit messages follow the format above

### Documentation links

Documentation changes must keep relative links working. CI runs a checker over all tracked Markdown files that validates local file and directory targets, image paths, and heading anchors. External `http(s)` and `mailto` links are ignored.

Run it locally before opening a PR:

```bash
pnpm check:links
```

Failures are printed as `source:line -> broken target`, and the command exits non-zero. To verify the checker itself, run `pnpm test:links`.

### Contact

For security concerns, follow the instructions in the repository’s `SECURITY.md`.
