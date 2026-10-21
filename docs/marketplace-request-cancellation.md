# Marketplace request cancellation

Marketplace filters are applied to the current bounded invoice page. Consumers should debounce text inputs before changing query state and cancel the previous request when a new query supersedes it. This prevents a slow response for an older query from replacing the latest result; React Query handles cancellation through the request signal.
