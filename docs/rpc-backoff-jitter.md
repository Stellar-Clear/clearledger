# RPC polling backoff

Polling retries use bounded exponential backoff with configurable jitter. The
delay remains within the catch-up ceiling while jitter prevents many listeners
from retrying in lockstep. Tests should inject a deterministic random source.
