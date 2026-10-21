# On-chain invoice refresh

The marketplace uses the indexer as its history source. When a transaction is recent, refresh the selected invoice after the ledger closes to compare the indexed status with the contract reference. A mismatch is displayed as a stale-indexer warning and does not overwrite the indexed history silently; operators should wait for the next event poll or inspect the referenced Testnet transaction.
