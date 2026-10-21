# Soroban authorization errors

The UI should preserve the RPC error code and map common failures to actionable text: authorization failures ask the user to reconnect and sign again, missing contract entries suggest checking the selected Testnet, and resource or budget failures suggest retrying after refreshing the transaction simulation. Raw XDR remains available in diagnostics for support; messages must not imply a transaction succeeded.
