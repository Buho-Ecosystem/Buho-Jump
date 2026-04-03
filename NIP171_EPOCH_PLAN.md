# NIP-171 Epoch-Ticketed Private Groups — Implementation Plan

> Replaces current "broadcast list" private groups with cryptographically enforced membership.
> Reference: Vlad's xyz implementation + NIP-171 spec

---

## Why This Matters

Current private groups are broken: removing a member is cosmetic. Other members' clients
don't know about the removal and keep sending messages to the removed person.

NIP-171 epochs fix this with key rotation: when someone is removed, a new encryption key
is generated and distributed only to remaining members. The removed person cannot decrypt
future messages. Period.

---

## Data Model

```
Group Identity:
  { groupPubkey, groupPrivkey (owner only), name, about }

Epoch:
  { epochNumber, epochPubkey, epochPrivkey (encrypted), invitationCreatedAt }

Epoch Ticket (kind 1014):
  pubkey: groupPubkey
  content: epochPrivkey (hex)
  tags: [['p', memberPubkey], ['epoch', epochNumber]]
  sig: groupSignature (membership proof)

Group Message (kind 14 rumor):
  tags: [
    ['p', epochPubkey],          // addressed to epoch, not group
    ['h', groupPubkey],          // group identity reference
    ['epoch', epochNumber],
    ['invited_at', ticketCreatedAt],
    ['invitation_proof', ticketSig]
  ]
```

---

## Implementation Phases

### E1 — Storage & Key Management
- [x] `lib/epoch.js` — generate epoch keypair, encrypt/decrypt epoch privkey with account key
- [x] Group storage shape extended: `epochs: [{ number, pubkey, privkeyEncrypted }]`, `currentEpoch`, `groupPubkey`, `groupPrivkeyEncrypted`
- [ ] Migrate existing private groups to epoch 0 (generate initial epoch, keep members)

### E2 — Group Creation with Epoch
- [x] `createPrivateGroup()`: generate group keypair + epoch 0 keypair
- [x] Create kind 1014 epoch tickets signed by group key
- [x] Gift-wrap tickets to each member + self
- [x] Publish to chat relays
- [x] Store group secret + epoch 0 in local storage (encrypted)

### E3 — Receiving Epoch Tickets
- [x] Detect kind 1014 inside unwrapped gift wrap rumor
- [x] Parse and validate epoch ticket fields
- [x] Store epoch in group's epoch list, update currentEpoch if newer
- [x] Re-subscribe to include new epoch pubkey

### E4 — Sending Group Messages via Epoch
- [x] Address messages to current epoch pubkey (not group pubkey)
- [x] Include `h`, `epoch` tags (group identity + epoch number)
- [x] Gift-wrap to epoch pubkey + self-copy
- [x] Self-copy addressed to sender pubkey (for read-back)

### E5 — Receiving Group Messages via Epoch
- [x] Subscribe to all known epoch pubkeys + own pubkey
- [x] Determine correct decrypt key per epoch pubkey
- [x] Parse `h` tag to route to correct group
- [x] Handle kind 14 (message), kind 1014 (epoch ticket)

### E6 — Epoch Rotation (Member Removal)
- [x] `removeMemberFromPrivateGroup()`: generate new epoch, increment number
- [x] Send tickets to remaining members + owner only (removed member excluded)
- [x] Re-subscribe to new epoch pubkey
- [x] Old epoch stays for decrypting history

### E7 — Adding Members
- [x] `addMemberToPrivateGroup()`: send current epoch ticket to new member
- [x] Decrypt group + epoch keys, create ticket, publish

### E8 — UI Updates
- [x] Epoch separator in GroupThread — green pill "Encryption keys updated" between messages from different epochs
- [x] Owner badge in GroupInfo — "Owner" + "End-to-end encrypted" pills on group card
- [x] Toast on member removal — "Member removed. New encryption keys distributed."
- [x] Loading state on member removal — "Securing group..." with spinner on remove button

### Tests
- [x] 14 unit tests in `tests/epoch.test.js` — key generation, encryption roundtrip, ticket creation/parsing, message tags

---

## nostr-core Functions Needed

All available:
- `nip59.createRumor()`, `createSeal()`, `createWrap()`, `unwrap()`
- `nip44.encrypt()`, `decrypt()`, `getConversationKey()`
- `finalizeEvent(template, secretKey)`
- `getPublicKey(secretKey)`
- `hexToBytes()`, `bytesToHex()`, `randomBytes()`

NOT needed from NDK:
- No `NDKPrivateKeySigner` — use raw `finalizeEvent` with secret key bytes
- No `NDKRelaySet` — use our `RelayPool`
- No `giftWrap()` — use our `nip59.createRumor/Seal/Wrap`

---

## Migration Strategy

Existing private groups (no epochs) continue to work as-is during rollout.
New private groups get epoch 0 automatically.
Optionally: prompt owners to "upgrade" existing groups to epoch model.

---

## Estimated Scope

- E1-E3: Foundation (new file + storage changes + subscription changes)
- E4-E5: Message flow (modify send/receive in useGroups)  
- E6-E7: Membership changes (modify add/remove + rotation logic)
- E8: UI polish (separators, badges, loading states)

Each phase is independently testable. Can ship E1-E5 first (creation + messaging),
then E6-E7 (rotation), then E8 (polish).
