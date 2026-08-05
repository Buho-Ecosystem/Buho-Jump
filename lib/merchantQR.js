/**
 * South African retail QR code detection and Lightning Address conversion.
 *
 * Supports EMVCo QR codes from SA retailers (Pick n Pay, Checkers, Shoprite,
 * Woolworths) converted to Lightning Addresses via CryptoQR / MoneyBadger.
 *
 * Phase 1 (emvco: true)  → convertible to Lightning Address via cryptoqr.net
 * Phase 2 (emvco: false) → recognized but not yet supported (URL-based QR codes)
 *
 * Detection uses EMVCo TLV domain strings embedded in the QR payload,
 * matching the exact patterns used by SA payment processors.
 *
 * Order matters: PnP must be checked before generic electrum (Checkers/Shoprite)
 * because PnP QRs also contain "za.co.electrum".
 *
 * Spec: https://cryptoqr.net
 */

// ── Retailer detection patterns ────────────────────────────────────
// Order is significant — more specific patterns must come before generic ones.
const RETAILERS = [
  // Phase 1: EMVCo QR codes — convertible to Lightning via cryptoqr.net
  {
    id: 'picknpay',
    name: 'Pick n Pay',
    pattern: /(.*)(za\.co\.electrum\.picknpay)(.*)/i,
    emvco: true,
    color: '#003DA5',
    logo: '/sa_retailers/picknpay.png',
  },
  {
    id: 'ecentric',
    name: 'Woolworths',
    pattern: /(.*)(za\.co\.ecentric)(.*)/i,
    emvco: true,
    color: '#1A1A1A',
    logo: '/sa_retailers/woolworths.png',
  },
  {
    id: 'checkers_shoprite',
    name: 'Checkers / Shoprite',
    // Generic electrum — matches after PnP-specific pattern above
    pattern: /(.*)(za\.co\.electrum)(.*)/i,
    emvco: true,
    color: '#E31837',
    logo: '/sa_retailers/checkers.png',
  },

  // Phase 2: URL-based QR codes — recognized but not yet convertible
  {
    id: 'snapscan',
    name: 'SnapScan',
    pattern: /(.*)snapscan(.*)/i,
    emvco: false,
    color: '#00B0FF',
    logo: '/sa_retailers/snapscan.png',
  },
  {
    id: 'yoyo',
    name: 'Yoyo',
    pattern: /(.*)(wigroup\.co|yoyogroup\.co)(.*)/i,
    emvco: false,
    color: '#F5A623',
    logo: '/sa_retailers/moneybadger.png',
  },
  {
    id: 'zapper',
    name: 'Zapper',
    pattern: /^((.*zapper\.com.*)|(.*\.wigroup\..*)|(.*payat\.io.*)|(.*zap\.pe.*)|(.*transactionjunction\.co\.za.*)|(.*(?:paynow\.netcash|paynow\.sagepay)\.co\.za.*)|(.{2}\/.{4}\/.{20})|(SK-\d{1,}-\d{23})|(\d{20})|(CRSTPC-\d+-\d+-\d+-\d+-\d+))$/i,
    emvco: false,
    color: '#FF6B00',
    logo: '/sa_retailers/zapper.png',
  },
  {
    id: 'scantopay',
    name: 'Scan to Pay',
    pattern: /scantopay\.io|^\d{10}$|payat\.io|UMPQR|\.oltio\.co\.za|easypay/i,
    emvco: false,
    color: '#2E7D32',
    logo: '/sa_retailers/scantopay.png',
  },
  {
    id: 'moneybadger',
    name: 'MoneyBadger',
    pattern: /(.*)(cryptoqr\.net)(.*)/i,
    emvco: false,
    color: '#F5A623',
    logo: '/sa_retailers/moneybadger.png',
  },
]

// QR Version 40 tops out well below this for ordinary text. Bounding before
// the legacy retailer regexes also prevents oversized hostile input from
// triggering expensive backtracking.
const MAX_RETAIL_QR_LENGTH = 8192

/**
 * Check if a QR payload matches any known SA retailer.
 * Returns the matched retailer entry or null.
 */
function matchRetailer(payload) {
  if (!payload || typeof payload !== 'string') return null
  const trimmed = payload.trim()
  if (trimmed.length > MAX_RETAIL_QR_LENGTH) return null
  for (const retailer of RETAILERS) {
    if (retailer.pattern.test(trimmed)) return retailer
  }
  return null
}

/**
 * Check if a QR payload is a supported SA retailer QR code.
 * Only returns true for EMVCo-based QRs that can be converted to Lightning.
 */
export function isSARetailerQR(payload) {
  const retailer = matchRetailer(payload)
  return retailer !== null
}

/**
 * Check if a matched retailer is convertible (Phase 1 EMVCo).
 * Phase 2 retailers are recognized but not yet supported.
 */
export function isConvertibleQR(payload) {
  const retailer = matchRetailer(payload)
  return retailer?.emvco === true
}

/**
 * Extract merchant info from a QR payload.
 * Returns { id, name, color, logo, emvco } or null if not recognized.
 */
export function getMerchantInfo(payload) {
  const retailer = matchRetailer(payload)
  if (!retailer) return null
  return {
    id: retailer.id,
    name: retailer.name,
    color: retailer.color,
    logo: retailer.logo,
    emvco: retailer.emvco,
  }
}

/**
 * Convert an EMVCo QR payload to a CryptoQR Lightning Address.
 * The full QR payload is URL-encoded and used as the username at cryptoqr.net.
 * Only valid for EMVCo (Phase 1) merchants.
 */
export function convertToLightningAddress(qrPayload) {
  if (!qrPayload) return null
  return `${encodeURIComponent(qrPayload.trim())}@cryptoqr.net`
}

/**
 * Parse ZAR amount from LNURL-pay metadata.
 * CryptoQR returns metadata like: [["text/plain", "MBadger: Pick n Pay - R125.50"]]
 *
 * @param {string|Array} metadata - The metadata JSON string or parsed array
 * @returns {{ zarAmount: number, storeName: string|null } | null}
 */
export function parseZARFromMetadata(metadata) {
  if (!metadata) return null

  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    const textEntry = parsed.find(([mime]) => mime === 'text/plain')
    if (!textEntry) return null

    return parseZARFromDescription(textEntry[1])
  } catch {
    return null
  }
}

/**
 * Parse ZAR amount from a description string.
 * Formats: "MBadger: Store Name - R125.50", "R 42.00", "ZAR 100"
 */
export function parseZARFromDescription(description) {
  if (!description) return null

  // Try "R123.45" or "R 123.45" pattern (with optional comma thousands)
  const rMatch = description.match(/R\s?([\d,]+(?:\.\d{1,2})?)/)
  if (rMatch) {
    const amount = parseFloat(rMatch[1].replace(/,/g, ''))
    if (!isNaN(amount) && amount > 0) {
      // Extract store name from "MBadger: Store Name - R125.50"
      let storeName = null
      const dashIdx = description.indexOf(' - R')
      if (dashIdx > 0) {
        storeName = description.slice(0, dashIdx)
          .replace(/^M?Badger:\s*/i, '')
          .trim() || null
      }
      return { zarAmount: amount, storeName }
    }
  }

  // Try "ZAR 123.45" pattern
  const zarMatch = description.match(/ZAR\s?([\d,]+(?:\.\d{1,2})?)/)
  if (zarMatch) {
    const amount = parseFloat(zarMatch[1].replace(/,/g, ''))
    if (!isNaN(amount) && amount > 0) {
      return { zarAmount: amount, storeName: null }
    }
  }

  return null
}

/**
 * Get merchant initials for avatar fallback.
 */
export function getMerchantInitials(name) {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export { RETAILERS }
