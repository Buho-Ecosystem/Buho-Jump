/**
 * Phone-number to Lightning Address payout rails shared with BuhoGO.
 *
 * These providers accept Lightning and deliver local mobile money. Detection
 * is deliberately strict: only known mobile prefixes and either an explicit
 * country code or a national number beginning with zero are accepted.
 */

export const PAYOUT_COUNTRIES = [
  {
    code: 'KE', name: 'Kenya', flag: '🇰🇪', flagUrl: '/mobile-payments/flags/circle-flags--ke.svg', provider: 'Tando', logoUrl: '/mobile-payments/logos/tando.png', currency: 'KES',
    domain: 'bitcoin.co.ke', callingCode: '254', nsnLength: 9,
    hint: 'Pay a Kenyan phone number with Tando',
    operators: [
      ['Safaricom', ['110-117', '700-729', '740-743', '745-746', '748', '757-759', '768-769', '790-799']],
      ['Airtel', ['100-108', '730-739', '750-756', '762', '780-789']],
      ['Telkom', ['770-779']], ['Equitel', ['763-766']], ['Faiba', ['747']],
      ['Mobile Pay', ['760']], ['Eferio', ['761']], ['Homelands Media', ['744']],
    ],
  },
  {
    code: 'ZM', name: 'Zambia', flag: '🇿🇲', flagUrl: '/mobile-payments/flags/circle-flags--zm.svg', provider: 'Bitzed', logoUrl: '/mobile-payments/logos/bitzed.svg', currency: 'ZMW',
    domain: 'bitzed.xyz', callingCode: '260', nsnLength: 9,
    hint: 'Pay a Zambian phone number with Bitzed',
    operators: [
      ['Airtel', ['57', '77', '97']], ['MTN', ['76', '96']],
      ['Zamtel', ['75', '95']], ['Beeline', ['78', '98']],
    ],
  },
  {
    code: 'TZ', name: 'Tanzania', flag: '🇹🇿', flagUrl: '/mobile-payments/flags/circle-flags--tz.svg', provider: 'ChapSmart', logoUrl: '/mobile-payments/logos/chapsmart.png', currency: 'TZS',
    domain: 'chapsmart.com', callingCode: '255', nsnLength: 9,
    hint: 'Pay a Tanzanian M-Pesa number with ChapSmart',
    // ChapSmart currently settles only to Vodacom M-Pesa.
    operators: [['Vodacom', ['74', '75', '76', '79']]],
  },
]

export const AMBIGUOUS_DEFAULT_CODE = 'KE'

function prefixMatches(spec, value) {
  const [low, high] = spec.split('-')
  if (!high) return value.startsWith(low)
  const head = Number(value.slice(0, low.length))
  return head >= Number(low) && head <= Number(high)
}

export function matchMobileOperator(country, nsn) {
  if (!country || typeof nsn !== 'string' || nsn.length !== country.nsnLength) return null
  for (const [name, prefixes] of country.operators) {
    if (prefixes.some(prefix => prefixMatches(prefix, nsn))) return name
  }
  return null
}

function parsePhoneInput(raw) {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || !/^[+\d\s().-]+$/.test(value)) return null
  const plus = value.startsWith('+')
  let digits = value.replace(/\D/g, '')
  const doubleZero = !plus && digits.startsWith('00')
  if (doubleZero) digits = digits.slice(2)
  return digits ? { digits, international: plus || doubleZero } : null
}

function resultFor(country, nsn, confidence = 'exact') {
  const operator = matchMobileOperator(country, nsn)
  const grouped = nsn.replace(/(\d{3})(?=\d)/g, '$1 ')
  return {
    country,
    operator,
    display: `+${country.callingCode} ${grouped}`,
    e164: `+${country.callingCode}${nsn}`,
    lightningAddress: `${country.callingCode}${nsn}@${country.domain}`,
    payout: { code: country.currency },
    confidence,
    ambiguous: false,
  }
}

/** Recognize explicit international and local 0-prefixed mobile numbers. */
export function recognizePhoneNumber(raw) {
  const parsed = parsePhoneInput(raw)
  if (!parsed) return null

  for (const country of PAYOUT_COUNTRIES) {
    if (!parsed.digits.startsWith(country.callingCode)) continue
    const nsn = parsed.digits.slice(country.callingCode.length)
    if (matchMobileOperator(country, nsn)) return resultFor(country, nsn)
  }
  if (parsed.international || !parsed.digits.startsWith('0')) return null

  const nsn = parsed.digits.slice(1)
  const countries = PAYOUT_COUNTRIES.filter(country => matchMobileOperator(country, nsn))
  if (countries.length === 0) return null
  if (countries.length === 1) return resultFor(countries[0], nsn, 'high')

  const ordered = [
    ...countries.filter(country => country.code === AMBIGUOUS_DEFAULT_CODE),
    ...countries.filter(country => country.code !== AMBIGUOUS_DEFAULT_CODE),
  ]
  const candidates = ordered.map(country => ({
    ...resultFor(country, nsn, 'ambiguous'),
    ambiguous: true,
  }))
  return { ...candidates[0], candidates }
}

/** Resolve a number after the user explicitly selects a country. */
export function recognizePhoneNumberForCountry(countryCode, raw) {
  const country = PAYOUT_COUNTRIES.find(item => item.code === countryCode)
  const parsed = parsePhoneInput(raw)
  if (!country || !parsed) return null
  let nsn = parsed.digits
  if (nsn.startsWith(country.callingCode)) nsn = nsn.slice(country.callingCode.length)
  else if (parsed.international) return null
  else if (nsn.startsWith('0')) nsn = nsn.slice(1)
  if (!matchMobileOperator(country, nsn)) return null
  return resultFor(country, nsn)
}

/** Identify an already-formed address belonging to one of the payout rails. */
export function matchMobilePaymentAddress(address) {
  if (typeof address !== 'string') return null
  const at = address.lastIndexOf('@')
  if (at < 1) return null
  const country = PAYOUT_COUNTRIES.find(item => item.domain === address.slice(at + 1).toLowerCase())
  if (!country) return null
  const handle = address.slice(0, at).replace(/\D/g, '')
  const nsn = handle.startsWith(country.callingCode)
    ? handle.slice(country.callingCode.length)
    : handle.replace(/^0/, '')
  return {
    ...resultFor(country, nsn),
    lightningAddress: address,
  }
}

export function payoutCountryOptions() {
  return PAYOUT_COUNTRIES.map(({ code, name, flag, flagUrl, provider, logoUrl, currency, callingCode }) => ({
    code, name, flag, flagUrl, provider, logoUrl, currency, callingCode,
  }))
}
