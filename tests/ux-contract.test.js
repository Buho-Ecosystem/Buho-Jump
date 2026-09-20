import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { themes } from '../themes/tokens.js'
import { accountProfile } from '../lib/accountProfile.js'
import { setSitePermission, setPermission, checkPermission } from '../lib/permissions.js'
import { resetStorage } from './setup.js'

function luminance(hex) {
  const parts = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return parts[0] * .2126 + parts[1] * .7152 + parts[2] * .0722
}
function contrast(a,b) { const values = [luminance(a),luminance(b)].sort((x,y) => x-y); return (values[1]+.05)/(values[0]+.05) }

describe('review regressions', () => {
  it('status text remains readable on plain and tinted surfaces in every theme', () => {
    const mix = (base, fill) => '#' + base.slice(1).match(/../g).map((part, i) =>
      Math.round(parseInt(part, 16) * .85 + parseInt(fill.slice(1).match(/../g)[i], 16) * .15).toString(16).padStart(2, '0')
    ).join('')
    for (const theme of Object.values(themes)) for (const mode of ['light', 'dark']) {
      const tokens = theme[mode]
      for (const status of ['success', 'error', 'warning', 'info', 'incoming', 'outgoing']) {
        for (const surface of ['surface-base', 'surface-card', 'surface-elevated']) {
          for (const background of [tokens[surface], mix(tokens[surface], tokens[`semantic-${status}`])]) {
            expect(contrast(tokens[`status-${status}`], background)).toBeGreaterThanOrEqual(4.5)
          }
        }
        expect(contrast(tokens[`on-${status}`], tokens[`semantic-${status}`])).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('blocking a site overrides old per-kind grants and stays scoped to the account and exact origin', async () => {
    resetStorage()
    await setPermission('https://example.com', 'signEvent', 'allow', 1, 'alice')
    await setPermission('https://example.com', 'signEvent', 'allow', 1, 'bob')
    await setSitePermission('https://example.com', ['getPublicKey','signEvent'], 'deny', 'alice')
    expect(await checkPermission('https://example.com','signEvent',1,'alice')).toBe('deny')
    expect(await checkPermission('https://example.com','signEvent',1,'bob')).toBe('allow')
    expect(await checkPermission('http://example.com','signEvent',1,'alice')).toBeNull()
    expect(await checkPermission('https://example.com:8443','signEvent',1,'alice')).toBeNull()
    await setSitePermission('https://example.com', ['getPublicKey','signEvent'], 'allow', 'alice')
    expect(await checkPermission('https://example.com','signEvent',1,'alice')).toBe('allow')
    expect(await checkPermission('https://example.com','weblnSendPayment',null,'alice')).toBeNull()
    expect(await checkPermission('https://example.com','weblnKeysend',null,'alice')).toBeNull()
  })

  it('simultaneous site choices cannot overwrite another site block', async () => {
    resetStorage()
    await Promise.all([
      setSitePermission('https://blocked.example', ['signEvent','weblnSendPayment'], 'deny', 'alice'),
      setPermission('https://allowed.example', 'signEvent', 'allow', 1, 'alice'),
    ])
    expect(await checkPermission('https://blocked.example','signEvent',1,'alice')).toBe('deny')
    expect(await checkPermission('https://blocked.example','weblnSendPayment',null,'alice')).toBe('deny')
    expect(await checkPermission('https://allowed.example','signEvent',1,'alice')).toBe('allow')
  })

  it('untrusted profile data cannot become an unsafe image or unbounded label', () => {
    expect(accountProfile(null)).toBeNull()
    expect(accountProfile([])).toBeNull()
    for (const picture of ['javascript:alert(1)', 'file:///secret', 'http://example.com/avatar', 'data:image/svg+xml,a']) expect(accountProfile({picture}).picture).toBe('')
    expect(accountProfile({ name:'x'.repeat(400), display_name:{}, picture:'https://example.com/avatar' })).toMatchObject({ name:'x'.repeat(80), display_name:'', picture:'https://example.com/avatar' })
  })

  for (const [name,theme] of Object.entries(themes)) {
    for (const mode of ['dark','light']) {
      it(`${name} ${mode} text and primary controls meet AA contrast`, () => {
        const tokens = theme[mode]
        for (const foreground of ['text-muted','text-secondary','brand-primary','brand-hover']) {
          for (const background of ['surface-base','surface-card','surface-elevated','surface-hover']) expect(contrast(tokens[foreground],tokens[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('UI captions never introduce an explicit font size below 12px', () => {
    const visit = dir => readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? visit(`${dir}/${entry.name}`) : entry.name.endsWith('.vue') ? [`${dir}/${entry.name}`] : [])
    for (const file of [...visit('components'),...visit('entrypoints')]) expect(readFileSync(file,'utf8').match(/text-\[(?:[0-9]|1[01])px\]/g),file).toBeNull()
  })
})
