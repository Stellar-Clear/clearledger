# Operator replay of failed webhooks

Replay must address one stored delivery at a time and retain the original
event identifier. The delivery attempt is appended to audit history, while the
same event and destination remain idempotent so a retry cannot create a second
business action. Operators should replay only after correcting the recorded
failure cause.
