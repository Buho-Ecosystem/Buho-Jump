import { describe, it, expect } from 'vitest'
import { parseSuccessAction } from '../lib/lnurlSuccess.js'

describe('LUD-09 success actions', () => {
  it('accepts and clamps a message to 144 characters', () => {
    const action = parseSuccessAction({ tag: 'message', message: 'x'.repeat(200) }, 'https://pay.example/cb')
    expect(action.message).toHaveLength(144)
  })

  it('accepts same-domain links and degrades third-party links to text', () => {
    expect(parseSuccessAction(
      { tag: 'url', description: 'Receipt', url: 'https://pay.example/r/1' },
      'https://pay.example/cb',
    )).toMatchObject({ tag: 'url' })
    expect(parseSuccessAction(
      { tag: 'url', description: 'Thanks', url: 'https://evil.example/r/1' },
      'https://pay.example/cb',
    )).toEqual({ tag: 'message', message: 'Thanks' })
  })

  it('rejects malformed actions and accepts complete AES payloads', () => {
    expect(parseSuccessAction({ tag: 'url', url: 'javascript:alert(1)' }, 'https://pay.example/cb')).toBeNull()
    expect(parseSuccessAction({ tag: 'aes', ciphertext: 'abc', iv: 'def' }, 'https://pay.example/cb'))
      .toEqual({ tag: 'aes', description: '', ciphertext: 'abc', iv: 'def' })
  })
})
