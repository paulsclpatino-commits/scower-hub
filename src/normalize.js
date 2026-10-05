// Helpers that turn messy marketplace data (price strings, listing titles, URLs)
// into the uniform listing shape the frontend renders.

import { createHash } from 'node:crypto';

// Longest prefixes first so "CA$" wins over "$".
const CURRENCY_SYMBOLS = [
  ['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'],
  ['NZ$', 'NZD'], ['HK$', 'HKD'], ['S$', 'SGD'], ['R$', 'BRL'], ['MX$', 'MXN'],
  ['$', 'USD'], ['£', 'GBP'], ['€', 'EUR'], ['¥', 'JPY'], ['₩', 'KRW'], ['₹', 'INR'],
  ['zł', 'PLN'], ['kr', 'SEK'],
];

const ISO_CODES = new Set([
  'USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'BRL', 'MXN', 'GBP', 'EUR', 'JPY',
  'KRW', 'INR', 'PLN', 'SEK', 'CHF', 'DKK', 'NOK',
]);

// Rough rates, used only to sort results that come back in mixed currencies.
// Prices are always displayed in their original currency.
const APPROX_USD_RATES = {
  USD: 1, EUR: 1.1, GBP: 1.3, CAD: 0.72, AUD: 0.66, NZD: 0.6, HKD: 0.13,
  SGD: 0.76, BRL: 0.18, MXN: 0.054, JPY: 0.0068, KRW: 0.00073, INR: 0.012,
  PLN: 0.26, SEK: 0.095, CHF: 1.15, DKK: 0.15, NOK: 0.095,
};

export function detectCurrency(text, fallback = 'USD') {
  if (!text) return fallback;
  const str = String(text).trim();
  const code = str.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (code && ISO_CODES.has(code[1])) return code[1];
  for (const [symbol, iso] of CURRENCY_SYMBOLS) {
    if (str.includes(symbol)) return iso;
  }
  return fallback;
}

function parseNumber(raw) {
  let s = raw.replace(/[\s ']/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/\.(?=.*\.)/g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot !== -1 && /\.\d{3}$/.test(s) && !/^0\./.test(s)) {
    // "1.250" - prices never carry three decimals, so it's a thousands separator.
    s = s.replace(/\./g, '');
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a price from a number, a string like "$1,299.00" / "1.299,00 €", or an
 * eBay-style { value, currency } object. Returns { value, currency } or null.
 */
export function parsePrice(input, fallbackCurrency = 'USD') {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? { value: input, currency: fallbackCurrency } : null;
  }
  if (typeof input === 'object') {
    const currency = input.currency ? detectCurrency(input.currency, fallbackCurrency) : fallbackCurrency;
    const inner = parsePrice(input.value ?? input.extracted_value, currency);
    return inner ? { value: inner.value, currency } : null;
  }
  const text = String(input);
  const match = text.match(/\d[\d.,\s ']*/);
  if (!match) return null;
  const value = parseNumber(match[0].trim());
  if (value == null || value < 0) return null;
  return { value, currency: detectCurrency(text, fallbackCurrency) };
}

export function toApproxUsd(value, currency) {
  if (value == null) return null;
  const rate = APPROX_USD_RATES[currency];
  return rate ? Math.round(value * rate * 100) / 100 : null;
}

export function formatPrice(value, currency = 'USD') {
  if (value == null) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// Sizes

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

const SIZE_WORDS = [
  [/^(?:xx[\s-]?small|2x[\s-]?small)$/i, 'XXS'],
  [/^(?:x[\s-]?small|extra[\s-]small)$/i, 'XS'],
  [/^small$/i, 'S'],
  [/^(?:medium|med)$/i, 'M'],
  [/^large$/i, 'L'],
  [/^(?:x[\s-]?large|extra[\s-]large)$/i, 'XL'],
  [/^(?:xx[\s-]?large|2x[\s-]?large|2x)$/i, 'XXL'],
  [/^(?:xxx[\s-]?large|3x[\s-]?large|3x)$/i, 'XXXL'],
  [/^(?:one[\s-]?size|os|o\/s)$/i, 'One Size'],
];

const WORD_SIZE_PATTERN =
  '(?:xx[\\s-]?small|2x[\\s-]?small|x[\\s-]?small|extra[\\s-]small|small|medium|large|x[\\s-]?large|extra[\\s-]large|xx[\\s-]?large|2x[\\s-]?large|xxx[\\s-]?large|3x[\\s-]?large)';
const LETTER_PATTERN = '(?:XXXL|XXL|XL|XXS|XS|[2-5]XL|S|M|L)';

function normalizeSizeToken(token) {
  const t = token.trim().replace(/\.$/, '');
  const upper = t.toUpperCase().replace(/\s+/g, '');
  if (upper === '2XL') return 'XXL';
  if (upper === '3XL') return 'XXXL';
  if (LETTER_SIZES.includes(upper)) return upper;
  for (const [re, label] of SIZE_WORDS) if (re.test(t)) return label;
  const waist = t.match(/^(\d{2})\s*[xX/]\s*L?(\d{2})$/);
  if (waist) return `${waist[1]}x${waist[2]}`;
  if (/^\d{1,2}(?:\.5)?$/.test(t)) return t;
  return null;
}

// Words that turn "Small"/"S" into part of a product name ("Small Box Logo",
// "S Logo") rather than a size.
const NOT_A_SIZE_AFTER = /^\s*(?:box|bogo|logo|print|graphic|patch|pocket|arc|script|text|letters?|font|emblem|embroider\w*|tag|fit|batch|business|world|wave|stripe|check)/i;

/** Best-effort size extraction from a listing title. Returns e.g. "L", "XL", "32x30", "10.5" or null. */
export function extractSize(title) {
  if (!title) return null;
  const text = ` ${title} `;

  // A title listing several sizes ("S M L XL", "S/M/L") is one listing for many sizes.
  const listed = text.match(/(?<![\w&'.-])(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL)(?![\w&'.-])/g) || [];
  if (new Set(listed).size >= 3) return null;

  // 1. Explicit "Size L", "Sz: XL", "Tagged M", "size 32x30", "size 10.5"
  const explicit = text.match(
    new RegExp(
      `\\b(?:size|sz|sze|tag(?:ged)?(?:\\s+size)?)\\b\\.?\\s*[:#-]?\\s*(${WORD_SIZE_PATTERN}|${LETTER_PATTERN}|one\\s?size|os|\\d{2}\\s*[xX/]\\s*\\d{2}|\\d{1,2}(?:\\.5)?)(?![\\w&'])`,
      'i',
    ),
  );
  if (explicit) {
    const size = normalizeSizeToken(explicit[1]);
    if (size) return size;
  }

  // 2. "Men's Large", "Mens XL", "Womens S"
  const gendered = text.match(
    new RegExp(`\\b(?:men'?s|mens|women'?s|womens|unisex|adult)\\s+(${WORD_SIZE_PATTERN}|${LETTER_PATTERN})\\b(?![&'/.])`, 'i'),
  );
  if (gendered && !NOT_A_SIZE_AFTER.test(text.slice(gendered.index + gendered[0].length))) {
    const size = normalizeSizeToken(gendered[1]);
    if (size) return size;
  }

  // 3. Unambiguous letter codes anywhere: XL, XXL, 2XL, XS ...
  const code = text.match(/(?<![\w/&'.-])(XXXL|XXL|XL|XXS|XS|[2-5]XL)(?![\w/&'.-])/i);
  if (code) return normalizeSizeToken(code[1]);

  // 4. Spelled-out sizes: "X-Large", "Medium" (but not "Small Box Logo")
  const wordRe = new RegExp(`\\b(${WORD_SIZE_PATTERN})\\b`, 'gi');
  for (const m of text.matchAll(wordRe)) {
    if (NOT_A_SIZE_AFTER.test(text.slice(m.index + m[0].length))) continue;
    const size = normalizeSizeToken(m[1]);
    if (size) return size;
  }

  // 5. Waist sizes: W32, 32x30
  const waist = text.match(/\bW\s?(\d{2})(?:\s?[xX/]\s?L\s?(\d{2}))?\b/) || text.match(/\b(2[6-9]|3\d|4[0-4])\s?[xX]\s?(2[6-9]|3[0-6])\b/);
  if (waist) return waist[2] ? `${waist[1]}x${waist[2]}` : waist[1];

  // 6. A lone uppercase S / M / L, e.g. "Supreme Hoodie Black M"
  for (const m of text.matchAll(/(?<=[\s([|])(S|M|L)(?=[\s,|)\]]|$)/g)) {
    const before = text.slice(0, m.index);
    if (/[/&'.]\s*$/.test(before)) continue;
    if (NOT_A_SIZE_AFTER.test(text.slice(m.index + 1))) continue;
    return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stores & URLs

const STORE_NAMES = [
  ['ebay.', 'eBay'], ['grailed.com', 'Grailed'], ['depop.com', 'Depop'],
  ['poshmark.', 'Poshmark'], ['mercari.com', 'Mercari'], ['stockx.com', 'StockX'],
  ['goat.com', 'GOAT'], ['vinted.', 'Vinted'], ['therealreal.com', 'The RealReal'],
  ['vestiairecollective.com', 'Vestiaire Collective'], ['farfetch.com', 'Farfetch'],
  ['ssense.com', 'SSENSE'], ['supremenewyork.com', 'Supreme'], ['supreme.com', 'Supreme'],
  ['flightclub.com', 'Flight Club'], ['stadiumgoods.com', 'Stadium Goods'],
  ['kickscrew.com', 'KicksCrew'], ['etsy.com', 'Etsy'], ['amazon.', 'Amazon'],
  ['walmart.com', 'Walmart'], ['thredup.com', 'thredUP'], ['nordstrom.com', 'Nordstrom'],
  ['nordstromrack.com', 'Nordstrom Rack'], ['endclothing.com', 'END.'],
  ['mrporter.com', 'MR PORTER'], ['facebook.com', 'Facebook Marketplace'],
  ['offerup.com', 'OfferUp'], ['tradesy.com', 'Tradesy'], ['curtsyapp.com', 'Curtsy'],
  ['laced.com', 'Laced'], ['klekt.com', 'KLEKT'], ['novelship.com', 'Novelship'],
  ['kream.co.kr', 'KREAM'], ['mercari.jp', 'Mercari JP'], ['2ndstreet', '2nd Street'],
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function storeFromUrl(url, fallback) {
  const host = hostOf(url);
  for (const [needle, name] of STORE_NAMES) {
    if (host === needle || host.includes(needle)) return name;
  }
  return fallback || host || 'Unknown store';
}

const TRACKING_PARAMS = /^(?:utm_|srsltid$|gclid$|gbraid$|wbraid$|fbclid$|mkevt$|mkcid$|mkrid$|campid$|toolid$|customid$|_trkparms$|_trksid$|hash$|amdata$|ref$|ref_$|tag$|var$)/i;

/** Canonical form of a listing URL, used to spot the same listing found by two sources. */
export function canonicalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url || '');
  }
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const ebayItem = host.startsWith('ebay.') && u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
  if (ebayItem) return `ebay/itm/${ebayItem[1]}`;
  const keep = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = keep.length ? `?${new URLSearchParams(keep)}` : '';
  return `${host}${u.pathname.replace(/\/+$/, '')}${query}`;
}

export function listingId(url) {
  return createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 14);
}

export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function cleanText(value, max = 300) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Build a listing in the shape the frontend expects. Returns null for entries
 * without a usable link.
 */
export function makeListing({
  url, title, image, price, shipping, currency, condition, store, source,
  foundVia, inStock, buyingFormat, extra,
}) {
  if (!isHttpUrl(url)) return null;
  const cleanTitle = cleanText(title, 220);
  const parsed = parsePrice(price, currency || 'USD');
  const parsedShipping = shipping == null ? null : parsePrice(shipping, parsed?.currency || currency || 'USD');
  const listing = {
    id: listingId(url),
    url,
    title: cleanTitle || 'Untitled listing',
    image: isHttpUrl(image) ? image : null,
    price: parsed ? Math.round(parsed.value * 100) / 100 : null,
    currency: parsed?.currency || currency || 'USD',
    shipping: parsedShipping ? Math.round(parsedShipping.value * 100) / 100 : null,
    size: extractSize(cleanTitle),
    condition: cleanText(condition, 40) || null,
    store: cleanText(store, 60) || storeFromUrl(url),
    storeHost: hostOf(url),
    sources: [source],
    foundVia: foundVia || 'visual',
    inStock: typeof inStock === 'boolean' ? inStock : null,
    buyingFormat: buyingFormat || null,
    match: null,
    ...extra,
  };
  listing.priceUsd = toApproxUsd(listing.price, listing.currency);
  listing.shippingUsd = toApproxUsd(listing.shipping, listing.currency);
  return listing;
}

// Higher wins when two sources report the same listing: eBay's own API knows
// shipping, condition and the live price; Lens only knows what Google indexed.
const SOURCE_PRIORITY = { ebay: 3, google_shopping: 2, google_lens: 1, demo: 0 };

function priorityOf(listing) {
  return Math.max(...listing.sources.map((s) => SOURCE_PRIORITY[s] ?? 0));
}

export function mergeListings(existing, incoming) {
  const [primary, secondary] = priorityOf(incoming) > priorityOf(existing) ? [incoming, existing] : [existing, incoming];
  const merged = { ...secondary, ...primary };
  for (const key of Object.keys(secondary)) {
    if (merged[key] == null || merged[key] === '') merged[key] = secondary[key];
  }
  merged.sources = [...new Set([...existing.sources, ...incoming.sources])];
  // An item found by image search is a stronger signal than a keyword hit.
  if (existing.foundVia === 'visual' || incoming.foundVia === 'visual') merged.foundVia = 'visual';
  merged.id = existing.id;
  merged.match = existing.match ?? incoming.match ?? null;
  return merged;
}

const COUNTRY_CURRENCY = {
  us: 'USD', ca: 'CAD', au: 'AUD', nz: 'NZD', gb: 'GBP', uk: 'GBP', ie: 'EUR', de: 'EUR',
  fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR', jp: 'JPY', kr: 'KRW', in: 'INR', hk: 'HKD',
  sg: 'SGD', mx: 'MXN', br: 'BRL', ch: 'CHF', se: 'SEK', pl: 'PLN',
};

export function currencyForCountry(country) {
  return COUNTRY_CURRENCY[String(country || '').toLowerCase()] || 'USD';
}

/** Treat a bare "$" as the local dollar (CAD in Canada, AUD in Australia...). */
export function resolveCurrency(symbolOrCode, country) {
  const local = currencyForCountry(country);
  if (!symbolOrCode) return local;
  if (symbolOrCode.trim() === '$') return local.endsWith('D') ? local : 'USD';
  return detectCurrency(symbolOrCode, local);
}
