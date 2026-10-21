# Authentication rate limits

SEP-10 challenge and transaction submission endpoints apply per-account and
per-client limits. A rejected request returns status 429 with consistent limit,
remaining, and reset headers; successful requests consume one unit and the
window resets deterministically.
