import { describe, it, expect } from 'vitest'
import { hexToBytes, getPublicKey, randomBytes, bytesToHex } from 'nostr-core'
import {
  createEpoch, createGroupIdentity,
  encryptEpochPrivkey, decryptEpochPrivkey,
  createEpochTicket, parseEpochTicket,
  createEpochTicketsForMembers,
  buildEpochMessageTags, parseGroupMessageTags,
} from '../lib/epoch.js'

describe('epoch key management', () => {
  it('createEpoch generates valid keypair', () => {
    const epoch = createEpoch(0)
    expect(epoch.number).toBe(0)
    expect(epoch.privkey).toHaveLength(64)
    expect(epoch.pubkey).toHaveLength(64)
    // Verify pubkey derives from privkey
    expect(getPublicKey(hexToBytes(epoch.privkey))).toBe(epoch.pubkey)
  })

  it('createGroupIdentity generates group + epoch 0', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    expect(groupPrivkey).toHaveLength(64)
    expect(groupPubkey).toHaveLength(64)
    expect(getPublicKey(hexToBytes(groupPrivkey))).toBe(groupPubkey)
    expect(epoch.number).toBe(0)
    expect(epoch.pubkey).toHaveLength(64)
  })

  it('epoch numbers increment correctly', () => {
    const e0 = createEpoch(0)
    const e1 = createEpoch(1)
    const e5 = createEpoch(5)
    expect(e0.number).toBe(0)
    expect(e1.number).toBe(1)
    expect(e5.number).toBe(5)
    // Each epoch has a unique keypair
    expect(e0.pubkey).not.toBe(e1.pubkey)
  })
})

describe('epoch encryption', () => {
  it('encrypt and decrypt epoch privkey roundtrips', () => {
    const accountKey = randomBytes(32)
    const epoch = createEpoch(0)

    const encrypted = encryptEpochPrivkey(epoch.privkey, accountKey)
    expect(encrypted).not.toBe(epoch.privkey) // should be encrypted
    expect(typeof encrypted).toBe('string')

    const decrypted = decryptEpochPrivkey(encrypted, epoch.pubkey, accountKey)
    expect(decrypted).toBe(epoch.privkey)
  })

  it('wrong key cannot decrypt', () => {
    const accountKey = randomBytes(32)
    const wrongKey = randomBytes(32)
    const epoch = createEpoch(0)

    const encrypted = encryptEpochPrivkey(epoch.privkey, accountKey)
    expect(() => decryptEpochPrivkey(encrypted, epoch.pubkey, wrongKey)).toThrow()
  })
})

describe('epoch tickets', () => {
  it('createEpochTicket produces valid kind 1014 event', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    const memberPubkey = getPublicKey(randomBytes(32))

    const ticket = createEpochTicket({
      groupPrivkey, groupPubkey,
      epochNumber: epoch.number, epochPrivkey: epoch.privkey,
      memberPubkey,
    })

    expect(ticket.kind).toBe(1014)
    expect(ticket.pubkey).toBe(groupPubkey) // signed by group key
    expect(ticket.content).toBe(epoch.privkey) // contains epoch privkey
    expect(ticket.tags).toContainEqual(['p', memberPubkey])
    expect(ticket.tags).toContainEqual(['epoch', '0'])
    expect(ticket.sig).toHaveLength(128)
  })

  it('parseEpochTicket extracts correct fields from wrapped ticket', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    const memberPubkey = getPublicKey(randomBytes(32))

    const ticket = createEpochTicket({
      groupPrivkey, groupPubkey,
      epochNumber: epoch.number, epochPrivkey: epoch.privkey,
      memberPubkey,
    })

    // Simulate unwrapped rumor with invitation_proof tag (as wrapEpochTicket adds)
    const rumor = {
      kind: 1014,
      pubkey: groupPubkey,
      content: epoch.privkey,
      tags: [['p', memberPubkey], ['epoch', '0'], ['invitation_proof', ticket.sig]],
      created_at: ticket.created_at,
    }

    const parsed = parseEpochTicket(rumor, groupPubkey)
    expect(parsed).not.toBeNull()
    expect(parsed.groupPubkey).toBe(groupPubkey)
    expect(parsed.epochNumber).toBe(0)
    expect(parsed.epochPrivkey).toBe(epoch.privkey)
    expect(parsed.epochPubkey).toBe(epoch.pubkey)
    expect(parsed.memberPubkey).toBe(memberPubkey)
    expect(parsed.invitationProof).toBe(ticket.sig)
  })

  it('parseEpochTicket rejects invalid kind', () => {
    const result = parseEpochTicket({ kind: 14, tags: [], content: 'x' })
    expect(result).toBeNull()
  })

  it('parseEpochTicket rejects missing tags', () => {
    const result = parseEpochTicket({ kind: 1014, tags: [], content: 'x'.repeat(64), pubkey: 'a'.repeat(64) })
    expect(result).toBeNull()
  })

  it('parseEpochTicket rejects wrong group pubkey', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    const memberPubkey = getPublicKey(randomBytes(32))
    const ticket = createEpochTicket({ groupPrivkey, groupPubkey, epochNumber: 0, epochPrivkey: epoch.privkey, memberPubkey })
    const rumor = {
      kind: 1014, pubkey: groupPubkey, content: epoch.privkey,
      tags: [['p', memberPubkey], ['epoch', '0'], ['invitation_proof', ticket.sig]],
      created_at: ticket.created_at,
    }
    // Pass a different expected group pubkey
    const wrongGroup = getPublicKey(randomBytes(32))
    expect(parseEpochTicket(rumor, wrongGroup)).toBeNull()
  })

  it('parseEpochTicket preserves invitation_proof for audit', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    const memberPubkey = getPublicKey(randomBytes(32))
    const ticket = createEpochTicket({ groupPrivkey, groupPubkey, epochNumber: 0, epochPrivkey: epoch.privkey, memberPubkey })

    const rumor = {
      kind: 1014, pubkey: groupPubkey, content: epoch.privkey,
      tags: [['p', memberPubkey], ['epoch', '0'], ['invitation_proof', ticket.sig]],
      created_at: ticket.created_at,
    }
    const parsed = parseEpochTicket(rumor, groupPubkey)
    expect(parsed).not.toBeNull()
    expect(parsed.invitationProof).toBe(ticket.sig)
  })

  it('createEpochTicketsForMembers creates tickets for all members', () => {
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()
    const senderKey = randomBytes(32)
    const members = [getPublicKey(randomBytes(32)), getPublicKey(randomBytes(32)), getPublicKey(randomBytes(32))]

    const tickets = createEpochTicketsForMembers({
      groupPrivkey, groupPubkey,
      epochNumber: epoch.number, epochPrivkey: epoch.privkey,
      memberPubkeys: members,
      senderSecretKey: senderKey,
    })

    expect(tickets).toHaveLength(3)
    for (const t of tickets) {
      expect(t.wrap).toBeDefined()
      expect(t.wrap.kind).toBe(1059) // gift wrap
      expect(t.memberPubkey).toBeTruthy()
      expect(t.ticketSig).toHaveLength(128)
    }
  })
})

describe('epoch message tags', () => {
  it('buildEpochMessageTags creates correct tag array', () => {
    const tags = buildEpochMessageTags({
      epochPubkey: 'epoch_pk',
      groupPubkey: 'group_pk',
      epochNumber: 3,
      ticketCreatedAt: 1700000000,
      ticketSig: 'sig123',
      replyTo: 'event123',
    })

    expect(tags).toContainEqual(['p', 'epoch_pk'])
    expect(tags).toContainEqual(['h', 'group_pk'])
    expect(tags).toContainEqual(['epoch', '3'])
    expect(tags).toContainEqual(['invited_at', '1700000000'])
    expect(tags).toContainEqual(['invitation_proof', 'sig123'])
    expect(tags).toContainEqual(['e', 'event123', '', 'reply'])
  })

  it('buildEpochMessageTags omits optional fields when absent', () => {
    const tags = buildEpochMessageTags({
      epochPubkey: 'ep', groupPubkey: 'gp', epochNumber: 0,
    })

    expect(tags).toHaveLength(3) // p, h, epoch — no invited_at, invitation_proof, reply
  })

  it('parseGroupMessageTags extracts fields', () => {
    const tags = [
      ['p', 'epoch_pk'], ['h', 'group_pk'], ['epoch', '2'],
      ['invited_at', '1700000000'], ['invitation_proof', 'sig'],
      ['e', 'reply_id', '', 'reply'],
    ]
    const parsed = parseGroupMessageTags(tags)
    expect(parsed.groupPubkey).toBe('group_pk')
    expect(parsed.epochNumber).toBe(2)
    expect(parsed.invitedAt).toBe('1700000000')
    expect(parsed.invitationProof).toBe('sig')
    expect(parsed.replyTo).toBe('reply_id')
  })

  it('parseGroupMessageTags returns null without h tag', () => {
    expect(parseGroupMessageTags([['p', 'x']])).toBeNull()
  })
})
