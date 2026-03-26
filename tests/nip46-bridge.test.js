/**
 * Tests for lib/nip46-bridge.js — URI creation, connection URI parsing.
 *
 * Network-dependent functions (connectBunker, awaitNostrConnect) require
 * relay mocks and are tested via URI format and parameter validation only.
 */

import { describe, it, expect } from 'vitest'
import { createNostrConnectURI, parseConnectionURI } from '../lib/nip46-bridge.js'

// ── createNostrConnectURI ───────────────────────────────────────

describe('createNostrConnectURI', () => {
  const CLIENT_PUBKEY = 'a'.repeat(64)
  const RELAY_URL = 'wss://relay.example.com'

  it('generates valid nostrconnect:// URI', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
    })
    expect(uri).toMatch(/^nostrconnect:\/\//)
    expect(uri).toContain(CLIENT_PUBKEY)
    expect(uri).toContain(encodeURIComponent(RELAY_URL))
  })

  it('includes relay parameter', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
    })
    const url = new URL(uri)
    expect(url.searchParams.get('relay')).toBe(RELAY_URL)
  })

  it('includes optional secret', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
      secret: 'mysecret123',
    })
    const url = new URL(uri)
    expect(url.searchParams.get('secret')).toBe('mysecret123')
  })

  it('includes optional name', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
      name: 'Buho Jump',
    })
    const url = new URL(uri)
    expect(url.searchParams.get('name')).toBe('Buho Jump')
  })

  it('includes optional url and image', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
      url: 'https://buho.app',
      image: 'https://buho.app/icon.png',
    })
    const url = new URL(uri)
    expect(url.searchParams.get('url')).toBe('https://buho.app')
    expect(url.searchParams.get('image')).toBe('https://buho.app/icon.png')
  })

  it('omits unset optional parameters', () => {
    const uri = createNostrConnectURI({
      clientPubkey: CLIENT_PUBKEY,
      relayUrl: RELAY_URL,
    })
    const url = new URL(uri)
    expect(url.searchParams.has('secret')).toBe(false)
    expect(url.searchParams.has('name')).toBe(false)
    expect(url.searchParams.has('url')).toBe(false)
    expect(url.searchParams.has('image')).toBe(false)
  })
})

// ── parseConnectionURI ──────────────────────────────────────────

describe('parseConnectionURI', () => {
  it('re-exports parseConnectionURI from nostr-core', () => {
    expect(typeof parseConnectionURI).toBe('function')
  })

  it('parses bunker:// URI', () => {
    const remotePubkey = 'b'.repeat(64)
    const uri = `bunker://${remotePubkey}?relay=wss://relay.test&secret=s123`
    const parsed = parseConnectionURI(uri)
    expect(parsed.remotePubkey).toBe(remotePubkey)
    expect(parsed.relayUrls).toContain('wss://relay.test')
    expect(parsed.secret).toBe('s123')
  })

  it('parses nostrconnect:// URI', () => {
    const pubkey = 'c'.repeat(64)
    const uri = `nostrconnect://${pubkey}?relay=wss://r.test`
    const parsed = parseConnectionURI(uri)
    expect(parsed.remotePubkey).toBe(pubkey)
  })
})
