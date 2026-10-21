# Reduced-motion behavior

Shared transition and transaction-feedback components must honor
`prefers-reduced-motion: reduce`. In that mode transitions complete without
continuous movement while status and error text remain visible. The preference
is client-side only and does not change transaction state or timing.
