import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const localesDir = path.join(repoRoot, 'locales')
const sourceLocale = 'en.json'

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function mergeLocaleShape(base, current) {
  if (isPlainObject(base)) {
    const result = {}
    const currentObject = isPlainObject(current) ? current : {}

    for (const key of Object.keys(base)) {
      result[key] = mergeLocaleShape(base[key], currentObject[key])
    }

    for (const key of Object.keys(currentObject)) {
      if (!(key in result)) {
        result[key] = currentObject[key]
      }
    }

    return result
  }

  if (current === '' || current === null || typeof current === 'undefined') {
    return '' // A missing translation must never be disguised as completed English copy.
  }

  return current
}

function flatten(object, prefix = '') {
  return Object.fromEntries(Object.entries(object).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key
    return isPlainObject(value) ? Object.entries(flatten(value, name)) : [[name, value]]
  }))
}

// Product names and locale-independent formats are intentional, not translations.
const sharedText = new Set(['Lightning Login', 'Nostr Wallet Connect', 'Buho Jump', 'Buho Jump v{version}', 'Version {version}'])
function copiedEnglish(base, current) {
  return Object.entries(flatten(base)).filter(([key, value]) => {
    if (flattenedValue(current, key) !== value || sharedText.has(value)) return false
    const words = value.replace(/\{[^}]*\}/g, '').match(/[A-Za-z]+/g) || []
    return words.length > 1
  }).map(([key]) => key)
}
function flattenedValue(object, key) {
  return key.split('.').reduce((value, part) => value?.[part], object)
}
function placeholderErrors(base, current) {
  const placeholders = value => [...new Set(String(value).match(/\{\w+\}/g) || [])].sort().join(',')
  return Object.entries(flatten(base)).filter(([key, value]) =>
    placeholders(value) !== placeholders(flattenedValue(current, key)),
  ).map(([key]) => key)
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const localeFiles = (await fs.readdir(localesDir))
    .filter((name) => name.endsWith('.json') && name !== sourceLocale)
    .sort()

  const basePath = path.join(localesDir, sourceLocale)
  const baseLocale = await readJson(basePath)
  let failing = false

  for (const file of localeFiles) {
    const filePath = path.join(localesDir, file)
    const locale = await readJson(filePath)
    const diff = collectDiff(baseLocale, locale)
    const copied = copiedEnglish(baseLocale, locale)
    const placeholders = placeholderErrors(baseLocale, locale)
    const issueCount = diff.missing.length + diff.empty.length + copied.length + placeholders.length

    if (issueCount === 0) continue

    failing = true
    console.log(`${file}: ${diff.missing.length} missing, ${diff.empty.length} empty, ${copied.length} copied English, ${placeholders.length} placeholder errors`)
    if (copied.length) console.log(`  Translate: ${copied.join(', ')}`)
    if (placeholders.length) console.log(`  Preserve variables: ${placeholders.join(', ')}`)

    if (checkOnly) continue

    const merged = mergeLocaleShape(baseLocale, locale)
    await writeJson(filePath, merged)
  }

  if (checkOnly && failing) {
    process.exitCode = 1
    return
  }

  if (!failing) {
    console.log('Locale keys, variables, and copied-English checks passed. Translation quality still requires language review.')
  }
}

await main()
