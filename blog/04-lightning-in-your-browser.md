# Lightning in Your Browser

## Send and receive Bitcoin from any website. No app switching. No copy-paste.

---

You know those tip buttons on blogs? The "pay with Lightning" prompts on news sites? The zap buttons on Nostr clients?

They all use the same thing under the hood: **WebLN**. It's a simple API that websites use to talk to your Lightning wallet. When a site calls `window.webln.sendPayment(invoice)`, your wallet extension picks it up, shows you the amount, and lets you approve.

Buho Jump puts a full WebLN provider in your browser. Connect any Lightning wallet via NWC (Nostr Wallet Connect), and every WebLN-enabled site just works.

### How to set it up

1. Install Buho Jump
2. Create or import a Nostr identity (takes 10 seconds)
3. Go to your wallet app - LNbits, Alby Hub, Coinos, wherever your sats live
4. Copy the NWC connection string (starts with `nostr+walletconnect://`)
5. Paste it into Buho Jump's wallet settings

That's it. Your browser now has a Lightning wallet.

### What you can do

**Pay invoices.** Any website that shows a Lightning invoice or uses WebLN - click pay, confirm, done.

**Set budgets.** Tell Buho Jump "allow example.com to spend up to 1,000 sats without asking." Small tips auto-approve. Big payments still prompt you.

**Receive sats.** Generate an invoice from the extension. Share the QR code. Get paid.

**Zap people.** On any Nostr client, the zap button uses your connected wallet. One tap.

**Track spending.** See your recent transactions, balance in sats or your local currency (19 currencies supported), and spending per site.

### Why not just use a wallet app?

Because switching apps is friction. You're reading a blog post, you want to leave a 100 sat tip, you don't want to open a separate app, scan a QR code, confirm, switch back.

With Buho Jump, you click the tip button and approve. Two seconds. You stay on the page.

That's what a browser extension should do - remove friction from things you do on the web.

### Multiple wallets

Got sats in different places? Add multiple NWC wallets and switch between them. Each one is encrypted separately. Name them whatever you want. "Daily spending." "Savings." "Business."

The active wallet handles all WebLN requests. Switch wallets, the next payment goes through the new one. Simple.

---

*Works with LNbits, Alby Hub, Coinos, Mutiny, and any NWC-compatible wallet. Your sats stay where they are - the extension just connects to them.*
