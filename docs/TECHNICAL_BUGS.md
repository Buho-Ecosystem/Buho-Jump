# Technical findings from the application-wide UI review

2026-09-20. Recorded separately at the user's request. No technical fixes are included in this UI/UX pass.

## T1 — Relay connectivity timeout leaves the WebSocket open

- **Location:** `composables/useRelays.js`, `checkRelayStatus`.
- **Confirmed:** a deterministic simulation with a WebSocket that never opens, followed by the actual timeout callback, returned `{"status":"unreachable","socketClosed":false}`.
- **Cause:** the timeout resolves the promise without closing the socket. The socket is scoped inside the `try` block; the timeout cannot access it. The error path also does not explicitly release the connection.
- **Impact:** repeated connectivity checks against a stalled relay can retain pending connections after the UI has reported failure. The socket may also open later and run a stale handler.
- **Follow-up:** settle once, clear the timer, detach handlers, and close the socket on every terminal path. Test timeout, error, late open, and normal open. This needs a separate technical change.

## Review limits

The browser review used synthetic accounts and blocked external traffic. It did not execute real payments, signing, relay publishing, or recovery. Invalid fixture data and deliberately unavailable network services were corrected or identified as review constraints, not reported as application bugs. This is not an exhaustive functional or security audit.
