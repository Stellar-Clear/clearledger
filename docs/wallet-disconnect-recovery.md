# Wallet disconnect recovery

If Freighter disconnects while a transaction is being prepared, abort the request, clear the pending simulation, and return the action to its idle state. A subsequent connection must rebuild the transaction from current account and network data; cached unsigned transactions must never be submitted after an account change.

## Account changes while connected

When the account selected in Freighter changes (Stellar Testnet), the web app treats the new public key as a different session:

- Only a valid classic account StrKey (`G...`) is adopted. Empty, malformed, secret-seed or contract values are ignored.
- All react-query caches scoped to the previous address (balances, LP position, transaction history, profile, verification) are cancelled and removed, and the SEP-10 token is dropped. Data for the new address loads fresh; a late response for the old address cannot overwrite it.
- If Freighter reports an empty address (wallet locked) the app returns to the disconnected state.
- Detection uses the polling watcher in `useWallet` plus a re-check on window focus and tab visibility (`useAccountChangeRefresh`, mounted in `app/providers.tsx`). A failed re-check leaves the current state unchanged.
