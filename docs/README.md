# ClearLedger Documentation

ClearLedger is an open-source Stellar testnet prototype for coordinating invoice finance among SMEs, their trade buyers and USDC liquidity providers. This guide explains the participant workflows, protocol mechanics and developer tools.

**Local app:** http://localhost:3000
**Network:** Stellar Testnet

## Start here

- [Stellar Testnet quickstart](QUICKSTART.md)
- [What ClearLedger does](introduction/what-is-clearledger.md)
- [How the workflow operates](introduction/how-it-works.md)
- [The trade finance problem](introduction/the-problem.md)

## Participant guides

- [SME onboarding](for-smes/getting-started.md)
- [Create and list an invoice](for-smes/create-your-first-invoice.md)
- [Understand invoice discounts](for-smes/understanding-the-discount.md)
- [Liquidity provider onboarding](for-lps/getting-started.md)
- [Deposits and withdrawals](for-lps/deposit-usdc.md)
- [Pool returns and risks](for-lps/understanding-yield.md)

## Protocol and development

- [Architecture](ARCHITECTURE.md)
- [Production readiness gates](PRODUCTION_READINESS.md)
- [Invoice lifecycle](protocol/invoice-lifecycle.md)
- [Liquidity pool mechanics](protocol/liquidity-pool.md)
- [Economic model and default risk](protocol/economic-model.md)
- [Analytics metrics and on-chain sources](ANALYTICS_METRICS.md)
- [Local development setup](developer-guide/local-setup.md)
- [Indexer API reference](developer-guide/indexer-api-reference.md)
- [How to contribute](contributing/how-to-contribute.md)

## Accessibility

- [Accessibility statement](ACCESSIBILITY.md) — tested keyboard flows, known
  limitations and how to report an accessibility problem.

## Testnet notice

The application and contracts are experimental and have not been formally audited. Testnet activity is for evaluation only; it is not a live financing offer, and no yield or repayment is guaranteed. Never deposit real funds. See [production readiness gates](PRODUCTION_READINESS.md) for the work still required before any Mainnet deployment.
