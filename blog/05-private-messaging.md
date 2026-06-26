# Private Messaging Without the BS

## Encrypted DMs. No phone number. No email. No account creation.

---

look i get it. another messaging thing. you've got Signal, you've got Telegram, you've got whatever WhatsApp is doing these days. why would anyone need another chat?

because all of those require a phone number. or an email. or both. and then your messages live on someone else's server.

Buho Jump does messaging differently.

### how it works

you have a Nostr identity (a keypair). someone else has a Nostr identity. you can send them an encrypted message. that's it. no signup. no phone number. no server that stores your conversations.

the messages are encrypted end-to-end using NIP-17 gift wraps. in plain english: your message gets encrypted, wrapped in another encrypted layer, and sent to relays. even the metadata (who sent it, who received it) is hidden inside the wrapping. relays see encrypted blobs. they can't tell who's talking to who.

### what it looks like

telegram. literally telegram. message bubbles, timestamps inside bubbles, typing indicators, date pills, reply threads. we didn't reinvent UI - we took what works and put Nostr underneath it.

you get 1:1 DMs, encrypted end-to-end with NIP-17 (with NIP-04 fallback for older clients). all in the extension. no separate app.

### the small things that matter

**reactions.** long-press a message, tap an emoji. done.

**replies.** tap reply, see the quoted text, send your response. shows in the thread with the original message preview.

**content warnings.** sending something sensitive? toggle the CW button, add a reason. recipients see "sensitive content - tap to reveal" instead of the raw message.

**expiring messages.** set a timer (5 min, 1 hour, 24 hours). message disappears after it expires. not from the relay (can't control that) but from the UI. recipients won't see it after the time passes.

**nostr: links.** if someone sends you a `nostr:npub1...` reference, it renders as a clickable @mention that opens on njump.me. not raw bech32 soup.

**relay info.** sent a message? see a little pill showing how many relays it was published to. tap it for the full list. like whatsapp's double checkmark but for relay nerds.

### who is this for

people who want to message without creating an account anywhere. people who don't want their chat provider knowing who they talk to. people who are already on Nostr and want DMs in the same extension they use for signing and payments.

it's not going to replace Signal. it's not trying to. but for quick encrypted conversations between people who value sovereignty over their identity - yeah, it works.

no phone number. no email. no BS.

---

*all messages encrypted with NIP-17 gift wraps. account-scoped storage - switch accounts, conversations stay separate. mute list synced with relays.*
