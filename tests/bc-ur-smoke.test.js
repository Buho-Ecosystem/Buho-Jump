import { describe, it, expect } from 'vitest'
import { UR, UREncoder, URDecoder } from '@gandlaf21/bc-ur'

// Pins the vendor API surface (UREncoder.fragmentsLength/nextPart, URDecoder
// progress) that QrDisplay.vue depends on. @gandlaf21/bc-ur is a small fork;
// this catches breaking changes on upgrade before the UI does.

describe('bc-ur library smoke test', () => {
  it('round-trips a large payload through multi-part UR fragments', () => {
    const payload = 'cashuBtest_token_payload_'.repeat(50)
    const ur = UR.fromBuffer(Buffer.from(payload))
    const encoder = new UREncoder(ur, 150, 0)
    const parts = []
    for (let i = 0; i < encoder.fragmentsLength; i++) {
      parts.push(encoder.nextPart())
    }
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].toLowerCase().startsWith('ur:bytes/')).toBe(true)

    const decoder = new URDecoder()
    for (const part of parts) decoder.receivePart(part)
    expect(decoder.isSuccess()).toBe(true)
    const decoded = new TextDecoder().decode(Uint8Array.from(decoder.resultUR().decodeCBOR()))
    expect(decoded).toBe(payload)
  })

  it('reports scan progress while parts are missing', () => {
    const payload = 'x'.repeat(2000)
    const ur = UR.fromBuffer(Buffer.from(payload))
    const encoder = new UREncoder(ur, 100, 0)
    const decoder = new URDecoder()
    decoder.receivePart(encoder.nextPart())
    expect(decoder.isComplete()).toBe(false)
    expect(decoder.expectedPartCount()).toBeGreaterThan(1)
    expect(decoder.getProgress()).toBeGreaterThan(0)
    expect(decoder.getProgress()).toBeLessThan(1)
  })
})
