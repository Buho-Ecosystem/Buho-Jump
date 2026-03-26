import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const localesDir = path.resolve(process.cwd(), 'locales')
const baseLocale = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'))
const localeFiles = fs.readdirSync(localesDir)
  .filter((name) => name.endsWith('.json') && name !== 'en.json')
  .sort()

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function collectDiff(base, current, prefix = '', diff = { missing: [], empty: [] }) {
  if (!isPlainObject(base)) return diff

  const currentObject = isPlainObject(current) ? current : {}
  for (const key of Object.keys(base)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const baseValue = base[key]
    const currentValue = currentObject[key]

    if (isPlainObject(baseValue)) {
      collectDiff(baseValue, currentValue, fullKey, diff)
      continue
    }

    if (!(key in currentObject)) diff.missing.push(fullKey)
    else if (currentValue === '' || currentValue === null) diff.empty.push(fullKey)
  }

  return diff
}

describe('locales', () => {
  for (const file of localeFiles) {
    it(`${file} matches the English locale shape`, () => {
      const locale = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'))
      const diff = collectDiff(baseLocale, locale)

      expect(diff.missing).toEqual([])
      expect(diff.empty).toEqual([])
    })
  }
})
