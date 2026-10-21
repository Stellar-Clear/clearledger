# Wallet disconnect recovery

If Freighter disconnects while a transaction is being prepared, abort the request, clear the pending simulation, and return the action to its idle state. A subsequent connection must rebuild the transaction from current account and network data; cached unsigned transactions must never be submitted after an account change.
