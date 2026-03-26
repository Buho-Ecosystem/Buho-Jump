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
    return base
  }

  return current
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
    const issueCount = diff.missing.length + diff.empty.length

    if (issueCount === 0) continue

    failing = true
    console.log(`${file}: ${diff.missing.length} missing, ${diff.empty.length} empty`)

    if (checkOnly) continue

    const merged = mergeLocaleShape(baseLocale, locale)
    await writeJson(filePath, merged)
  }

  if (checkOnly && failing) {
    process.exitCode = 1
    return
  }

  if (!failing) {
    console.log('All locale files are complete.')
  }
}

await main()
