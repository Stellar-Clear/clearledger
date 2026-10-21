# @clearledger/sdk-react

Developer guide for the SDK.

## Cancelling RPC operations

Long-running SDK reads and transaction confirmation polling accept an
`AbortSignal` through `ContractCallOptions`. Aborting stops pending retry and
polling timers and rejects with an error whose name is `AbortError`.

```ts
const controller = new AbortController();
const pending = client.submitTransaction("process_invoice", args, publicKey, {
  signal: controller.signal,
});

// Cancel from a timeout, unmount handler, or user action.
controller.abort();
```

Without a signal, the existing retry and confirmation behavior is unchanged.
