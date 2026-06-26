# Your Private Key Never Touches the Browser

## How Buho Jump implements NIP-46 remote signing - and why it matters

---

Here's the uncomfortable truth about most Nostr browser extensions: they store your private key in the browser. Your nsec sits there, encrypted sure, but still *inside* the one piece of software that runs untrusted code from every website you visit.

We built Buho Jump to solve this. Not by making encryption stronger (though we did that too), but by making the private key optional.

### The two types of accounts

When you set up Buho Jump, you pick one of three paths:

- **Create new** - generates a key pair locally. Standard approach. Your nsec is encrypted with AES-256-GCM and stored in the extension.
- **Import** - paste an existing nsec. Same deal.
- **External Signer** - this is the interesting one. Your private key stays on your phone or in a dedicated signer app. The extension never sees it.

That third option is NIP-46.

### How it actually works

NIP-46 is a protocol where two Nostr clients talk to each other over relays. One is the "client" (Buho Jump in your browser), the other is the "signer" (nsec.app on your phone, Amber, whatever you trust to hold your keys).

When a website asks Buho Jump to sign an event, instead of signing it locally, the extension sends a request to your signer through a relay. The signer signs it and sends the signature back. The website gets its signed event. Your nsec never left your phone.

We implemented two connection flows:

**Flow 1: Paste a bunker URI.**
Your signer app gives you a `bunker://` link. Paste it into Buho Jump. Done. The extension connects to the signer's relay, does a handshake, and you're live.

**Flow 2: Scan a QR code.**
Buho Jump generates a `nostrconnect://` URI and displays it as a QR code. Open your signer app, scan the code, approve the connection. The extension waits up to 90 seconds for the signer to respond - with a countdown so you know what's happening - and when it does, the session is established.

Behind the scenes, the extension listens on the relay for a NIP-46 "connect" request (kind 24133), decrypts it with NIP-04, verifies the shared secret, sends an "ack" response, then initiates a full handshake. If the signer reports "already connected" on the re-handshake - which some signers do - we treat that as success. The session is valid either way.

### What happens after connection

Once connected, the extension stores:
- A client-side keypair (not your nsec - a separate key generated per NIP-46 account)
- The bunker URI (encrypted at rest with your master password)
- The signer's public key

That's it. No nsec. No secret hex. If someone extracts your extension storage, they get a client keypair that can't sign anything without your signer being online and approving.

The extension then fetches your profile from relays and uses your display name and picture - so it feels exactly like a local account. Same wallet. Same chat. Same permissions. Same everything. The signing just happens remotely.

### Proactive reconnection

Here's a detail that matters for daily use: Chrome kills service workers aggressively. Every time the extension wakes up, it needs to reconnect to your signer. We handle this automatically - on startup, the extension checks if the active account is NIP-46 mode and silently reconnects in the background. No QR rescanning. No manual intervention.

If reconnection fails (signer offline, relay down), the extension stores the error and the popup can show it. Next time the signer comes online, it reconnects on the next retry.

### The one trade-off

NIP-17 private DMs require the secret key to create gift wraps (encrypted containers). NIP-46 accounts can't do NIP-17 - they fall back to NIP-04 encrypted DMs. This is a protocol-level limitation. The signer would need to implement gift wrap creation natively for this to work. It's on the roadmap for the Nostr ecosystem, not something we can fix in the extension.

Everything else - signing events, encrypting/decrypting messages, publishing profiles, relay auth - works identically through the remote signer.

### Why this matters

If you're a casual user, a local key is fine. The encryption is solid.

But if you're holding meaningful amounts of Bitcoin through your Nostr identity, or if you're signing events that carry legal weight, or if you just believe in defense in depth - NIP-46 means your browser extension is a *client*, not a *vault*. The vault is wherever you keep your signer, and that's something you control.

Your keys. Your rules. For real this time.

---

*Buho Jump supports nsec.app, Amber, Primal, and any NIP-46 compatible signer. Set up takes about 30 seconds.*
