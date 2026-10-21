# Wallet adapter contract checks

Wallet adapter tests should cover a connected account changing, a network changing away from Testnet, and a disconnect during an in-flight request. Each transition must clear stale account state and require the next transaction to be explicitly authorized on the selected network.
