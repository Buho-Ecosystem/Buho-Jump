# Chat Enhancement Plan — Buho Jump

> Reference: Vlad's xyz chat app (Telegram-like Nostr client)
> Goal: Adopt best patterns, enhance UX, stick to nostr-core, clean maintainable code

---

## Phase 1 — Quick Wins (UX Polish)

- [x] **1.1** Day separators in ChatThread (sticky "Today", "Yesterday", "Jan 15" headers between message groups) — ALREADY IMPLEMENTED
- [x] **1.2** Message relay status tracking (pending → published → failed) with dot indicator on each bubble — ALREADY IMPLEMENTED (sending/sent/failed + relay count pill)
- [x] **1.3** Subscription signature caching in useChat/useGroups to prevent duplicate relay subscriptions
- [x] **1.4** Startup restore throttling — EOSE sync token already prevents premature notifications; signature caching prevents redundant subscribes

## Phase 2 — Core Chat Features

- [x] **2.1** Message reactions (NIP-7 emoji reactions wrapped in NIP-17 gift wrap)
  - [x] Quick reaction buttons on message hover/long-press (5 preset + picker) — ALREADY IN MessageActions.vue
  - [x] Reaction chips displayed below message bubble
  - [x] Pending reaction queue (queue until target message arrives)
- [x] **2.2** Message deletion (NIP-5 delete events wrapped in NIP-17)
  - [x] Delete own messages (action menu) — ALREADY IN MessageActions.vue
  - [x] Show "[deleted]" placeholder for deleted messages
  - [x] Pending deletion queue (queue until target arrives)
- [x] **2.3** Reply threading improvements
  - [x] Visual reply preview bar in ChatBubble (quoted text) — ALREADY IMPLEMENTED
  - [ ] Tap reply preview to scroll to original message — DEFERRED (nice-to-have)
  - [x] Reply composer preview strip — ALREADY IMPLEMENTED

## Phase 3 — Composer & Input Polish

- [x] **3.1** Emoji autocomplete (`:` trigger with fuzzy search from emoji list)
  - `lib/emojiData.js` — ~120 emojis with searchable names
  - `:query` detection in composer, arrow/enter/tab/escape navigation
  - Suggestion popup above input bar with highlighted selection
- [x] **3.2** Draft persistence per conversation (save unsent text to sessionStorage)
- [x] **3.3** Message retry on failure (tap failed message to resend) — ALREADY IMPLEMENTED
- [x] **3.4** Typing area improvements — ALREADY IMPLEMENTED (auto-grow + char count)

## Phase 4 — Data & Sync

- [ ] **4.1** Per-contact read cursors via `kind:30078` (publish read-up-to watermark) — DEFERRED (complex, low ROI for extension)
- [x] **4.2** Profile cache persistence (chrome.storage with debounced writes, restored on init)
- [x] **4.3** Message dedup hardening — verified: ID sets rebuilt from storage on load, signature caching prevents duplicate subs
- [x] **4.4** nostr-core adoption audit — all protocol code uses nostr-core (nip59, nip17, nip04, nip44, nip02, nip05, nip09, nip25, nip19). No hand-rolled crypto.

## Phase 5 — Group Chat Enhancements

### 5A — UX Polish (No protocol changes)
- [x] **5A.1** Group reactions — MessageActions + reaction chips wired into GroupBubble
- [x] **5A.2** Group message deletion — delete + "[deleted]" display wired into GroupBubble
- [x] **5A.3** Group muting — mutedGroups in useMuteList, mute/unmute in GroupInfo, filtered in ChatHome
- [x] **5A.4** Invite link generation — copy button in GroupInfo for relay/channel groups
- [x] **5A.5** Group preview before joining — "Preview group" button fetches metadata, shows name/about/members/status card before committing
- [x] **5A.6** Emoji autocomplete in GroupThread (reuse ChatThread pattern)
- [x] **5A.7** Draft persistence for GroupThread (reuse ChatThread pattern)

### 5B — Member Management
- [x] **5B.1** Private group: add members post-creation — ALREADY IMPLEMENTED (invite form in GroupInfo)
- [x] **5B.2** Private group: remove members post-creation — ALREADY IMPLEMENTED (remove button + confirm sheet)
- [x] **5B.3** Relay group: cache members/admins (5-minute TTL in useGroups, avoids refetch on every GroupInfo open)
- [ ] **5B.4** Relay group: permission management UI (add/remove permissions via NIP-29 kinds 9003/9004) — DEFERRED
- [ ] **5B.5** Member online indicator — DEFERRED (no reliable last-seen data in Nostr)
- [x] **5B.6** Bulk invite — multi-select from contacts with chips + manual input fallback

### 5C — Admin & Moderation
- [x] **5C.1** NIP-29 message deletion (kind 9005) — `deleteGroupMessage()` in useGroups
- [x] **5C.2** Channel metadata editing (kind 41) — `updateChannelMetadata()` in useGroups
- [x] **5C.3** Channel message hiding (kind 43) — `hideChannelMessage()` in useGroups
- [ ] **5C.4** Channel user muting (kind 44) — DEFERRED (needs per-channel mute UI)
- [ ] **5C.5** Admin transfer — DEFERRED (NIP-29 doesn't have a clean transfer mechanism)

### 5D — Discovery & Onboarding
- [ ] **5D.1** Relay group discovery — DEFERRED (requires NIP-50 relay support, not widely available)
- [x] **5D.2** Invitation accept/decline — functional banner with accept/decline buttons
- [x] **5D.3** Group creation wizard — confirmation step + relay health check (WebSocket ping with status indicator)
- [ ] **5D.4** Deep linking — DEFERRED (requires content script integration)

### 5E — Architecture
- [ ] **5E.1** NIP-171 epoch model — PLANNED, see `/NIP171_EPOCH_PLAN.md` (8 phases, E1-E8)
  - Current private groups are broken: member removal is cosmetic, not enforced
  - Epoch rotation gives true forward secrecy + cryptographic membership proof
  - All primitives available in nostr-core, no NDK needed
- [ ] **5E.2** Message pagination — load older messages on scroll (beyond 500 cap)
- [ ] **5E.3** Offline message queue — queue and retry when relay comes back

---

## Approval Checklist (Post-Implementation)

### Phase 1
- [ ] Day separators render correctly with "Today"/"Yesterday"/date format
- [ ] Message status dot shows pending (yellow) → sent (green) → failed (red)
- [ ] No duplicate subscriptions created on tab switch or reconnect
- [ ] Startup loads messages without hammering relays

### Phase 2
- [ ] Can react to a message with emoji, reaction shows below bubble
- [ ] Can delete own message, shows "[deleted]" to both parties
- [ ] Reactions/deletions for not-yet-received messages are queued and applied on arrival
- [ ] Reply preview shows quoted content and sender name

### Phase 3
- [ ] Typing `:sm` shows emoji suggestions, selecting inserts emoji
- [ ] Closing chat and reopening preserves draft text
- [ ] Failed messages show retry button, tapping resends
- [ ] Composer textarea grows smoothly, doesn't jump

### Phase 4
- [ ] Read state syncs across sessions (reload shows correct unread counts)
- [ ] Profile cache persists across extension restart
- [ ] No duplicate messages after relay reconnect
- [ ] All hand-rolled NIP code replaced with nostr-core where available

### Phase 5A (UX)
- [ ] Can react to group messages with emoji
- [ ] Can delete own group messages
- [ ] Can mute group conversations
- [ ] Invite link copyable from group info
- [ ] Emoji autocomplete works in group threads
- [ ] Drafts preserved in group threads

### Phase 5B (Members)
- [ ] Can add members to private group after creation
- [ ] Can remove members from private group
- [ ] Relay group members/admins load from cache
- [ ] Can manage relay group permissions

### Phase 5C (Admin)
- [ ] Admin can delete messages in relay groups
- [ ] Channel metadata editable after creation
- [ ] Admin transfer works

### Phase 5D (Discovery)
- [ ] Can search/browse public relay groups
- [ ] Invitation flow shows group preview before accepting
- [ ] Group creation checks relay health

---

## Architecture Notes

- **Library**: nostr-core is primary. Only use Vlad's NDK patterns as reference or when nostr-core is not fitting our needs.
- **State**: Keep singleton composable pattern (useChat, useGroups). Don't add Pinia.
- **Storage**: chrome.storage.local with account-scoped keys. Consider IndexedDB.
- **Encryption**: NIP-17 (gift wrap) for DMs, NIP-44 preferred, NIP-04 fallback for NIP-46 accounts.
- **Components**: Small, focused components. No 10K-line monoliths.
