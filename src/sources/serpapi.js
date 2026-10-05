// Google Lens (reverse image search), Google Shopping and eBay, all via SerpApi.
// Docs: https://serpapi.com/google-lens-api, https://serpapi.com/image-api,
// https://serpapi.com/google-shopping-api, https://serpapi.com/ebay-search-api

import { config } from '../config.js';
import { fetchJson, SourceError } from '../http.js';
import { extractSize, makeListing, parsePrice, resolveCurrency } from '../normalize.js';

const ENDPOINT = 'https://serpapi.com/search.json';

async function serpApi(params, { signal, timeoutMs }) {
  const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: config.serpApiKey })}`;
  const body = await fetchJson(url, { signal, timeoutMs });
  // SerpApi reports "no results" as an error string on a 200 response.
  if (body.error && !/hasn't returned any results|no results/i.test(body.error)) {
    throw new SourceError(body.error);
  }
  return body;
}

const currencySymbol = (priceText) => String(priceText || '').replace(/[\d.,\s*]/g, '');

function lensPrice(match, country) {
  if (match.price && typeof match.price === 'object') {
    const value = match.price.extracted_value ?? parsePrice(match.price.value)?.value;
    return value == null ? null : { value, currency: resolveCurrency(match.price.currency, country) };
  }
  if (match.extracted_price != null) {
    return { value: match.extracted_price, currency: resolveCurrency(currencySymbol(match.price), country) };
  }
  return null;
}

export function mapLensMatches(body, country = config.country) {
  const matches = [
    ...(body.visual_matches || []),
    ...(body.exact_matches || []),
    ...(body.products || []),
  ];
  return matches
    .map((m) =>
      makeListing({
        url: m.link,
        title: m.title,
        image: m.thumbnail || m.image,
        price: lensPrice(m, country),
        condition: m.condition,
        store: m.source,
        source: 'google_lens',
        foundVia: 'visual',
        inStock: m.in_stock,
      }),
    )
    .filter(Boolean);
}

function cleanTitle(title) {
  return title
    .replace(/\s*[|–—]\s*[^|–—]*$/, '') // " | Grailed"
    .replace(/\s+-\s+[^-]*$/, '') // " - eBay"
    .replace(/\b(?:size|sz|tagged)\.?\s*[:#-]?\s*\S+/gi, '') // a seller's size narrows the search
    .replace(/\b(?:XXS|XS|XL|XXL|XXXL|[2-5]XL)\b/g, '')
    .replace(/\b(?:nwt|bnwt|ds|vnds|euc|guc|preowned|pre-owned|used|authentic|rare|vintage)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const wordKey = (word) => word.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Guess a text query from Lens results, used when Claude isn't configured.
 * Prefers Google's own related search; otherwise keeps the words that most of
 * the matching listing titles agree on, so one seller's odd title doesn't
 * steer the keyword searches.
 */
export function lensQueryHint(...bodies) {
  const related = bodies.flatMap((b) => b.related_content || []).map((r) => r.query).find(Boolean);
  if (related) return related;

  const titles = bodies
    .flatMap((b) => [...(b.visual_matches || []), ...(b.products || [])])
    .map((m) => m.title)
    .filter(Boolean)
    .slice(0, 20)
    .map(cleanTitle)
    .filter(Boolean);
  if (!titles.length) return null;

  // In how many titles does each word appear?
  const counts = new Map();
  for (const title of titles) {
    for (const key of new Set(title.split(/\s+/).map(wordKey).filter(Boolean))) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  // Lens ranks the closest matches first and fills the rest with look-alikes, so
  // words shared by the top three titles (the model name, say) are kept even
  // when most of the other titles lack them.
  const topCounts = new Map();
  for (const title of titles.slice(0, 3)) {
    for (const key of new Set(title.split(/\s+/).map(wordKey).filter(Boolean))) {
      topCounts.set(key, (topCounts.get(key) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(titles.length * 0.3));
  const common = (word) =>
    (counts.get(wordKey(word)) || 0) >= threshold || (topCounts.get(wordKey(word)) || 0) >= 2;
  // The title sharing the most common words is the best phrasing; earlier wins ties.
  const score = (title) => title.split(/\s+/).filter(common).length;
  const best = titles.reduce((a, b) => (score(b) > score(a) ? b : a));
  if (titles.length < 3) return best.slice(0, 80);

  const kept = [];
  for (const word of best.split(/\s+/)) {
    if (common(word) && wordKey(word) !== wordKey(kept.at(-1) || '')) kept.push(word);
  }
  return (kept.length >= 2 ? kept.join(' ') : best).slice(0, 80);
}

/**
 * Upload a photo for Google Lens. Returns an image_id that is valid for 10
 * minutes. The image must be JPG/PNG/WebP and at most 500 KB.
 */
export async function uploadImageToSerpApi(jpeg, { signal, timeoutMs = 20_000 } = {}) {
  const form = new FormData();
  form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('api_key', config.serpApiKey);
  const body = await fetchJson('https://serpapi.com/image', { method: 'POST', body: form, signal, timeoutMs });
  if (!body.image_id) throw new SourceError(body.error || 'SerpApi did not return an image_id');
  return body.image_id;
}

/**
 * Reverse-image search. Runs Lens twice - "products" (shopping results with
 * prices) and the default search (everything Google matched visually).
 */
export async function searchGoogleLens({ imageUrl, imageId, signal, timeoutMs }) {
  const base = { engine: 'google_lens', hl: 'en', country: config.country, ...(imageId ? { image_id: imageId } : { url: imageUrl }) };
  const settled = await Promise.allSettled([
    serpApi({ ...base, type: 'products' }, { signal, timeoutMs }),
    serpApi(base, { signal, timeoutMs }),
  ]);
  const bodies = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!bodies.length) throw settled[0].reason;
  return {
    listings: bodies.flatMap((body) => mapLensMatches(body)),
    queryHint: lensQueryHint(...bodies),
  };
}

function shippingFrom(text) {
  if (text && typeof text === 'object') return text.extracted ?? parsePrice(text.raw)?.value ?? null;
  // English plus the eBay sites in EBAY_DOMAINS (German, French, Italian, Spanish, Dutch).
  if (!text || !/ship|deliver|postage|versand|livraison|frais de port|envoi|spedizione|env[ií]o|verzend/i.test(text)) return null;
  if (/free|kostenlo|gratu|gratis/i.test(text)) return 0;
  return parsePrice(text)?.value ?? null;
}

export function mapShoppingResults(body, country = config.country) {
  const results = [
    ...(body.shopping_results || []),
    ...(body.inline_shopping_results || []),
    ...(body.categorized_shopping_results || []).flatMap((c) => c.shopping_results || []),
  ];
  return results
    .map((r) => {
      const currency = resolveCurrency(currencySymbol(r.price), country);
      return makeListing({
        url: r.link || r.product_link,
        title: r.title,
        image: r.thumbnail || r.serpapi_thumbnail,
        price: r.extracted_price != null ? { value: r.extracted_price, currency } : r.price,
        currency,
        shipping: shippingFrom(r.delivery),
        condition: r.second_hand_condition || (Array.isArray(r.extensions) ? r.extensions.find((e) => /used|pre-?owned|refurb/i.test(e)) : null),
        store: r.source,
        source: 'google_shopping',
        foundVia: 'keyword',
      });
    })
    .filter(Boolean);
}

export async function searchGoogleShopping({ query, signal, timeoutMs }) {
  const body = await serpApi(
    { engine: 'google_shopping', q: query, gl: config.country, hl: 'en' },
    { signal, timeoutMs },
  );
  return mapShoppingResults(body);
}

// eBay keyword search through SerpApi, for when there are no eBay developer keys.
const EBAY_DOMAINS = {
  us: 'ebay.com', gb: 'ebay.co.uk', uk: 'ebay.co.uk', ca: 'ebay.ca', au: 'ebay.com.au', de: 'ebay.de',
  fr: 'ebay.fr', it: 'ebay.it', es: 'ebay.es', ie: 'ebay.ie', nl: 'ebay.nl', at: 'ebay.at', ch: 'ebay.ch',
};

export function mapSerpApiEbayResults(body, country = config.country) {
  return (body.organic_results || [])
    .map((r) => {
      const price = r.price?.extracted != null ? r.price : r.price?.from;
      const currency = resolveCurrency(currencySymbol(price?.raw), country);
      const auctionOnly = r.bids != null && !r.buy_it_now;
      return makeListing({
        url: r.link,
        title: r.title,
        image: r.thumbnail,
        price: price?.extracted != null ? { value: price.extracted, currency } : null,
        currency,
        shipping: shippingFrom(r.shipping),
        condition: r.condition,
        store: 'eBay',
        source: 'ebay',
        foundVia: 'keyword',
        buyingFormat: auctionOnly ? 'Auction' : null,
        // A price range usually means one listing selling several sizes. Colour
        // variants also make ranges, so keep a size the title states.
        extra: r.price?.from && !extractSize(r.title) ? { size: 'Several sizes' } : undefined,
      });
    })
    .filter(Boolean);
}

export async function searchEbayViaSerpApi({ query, signal, timeoutMs }) {
  const domain = EBAY_DOMAINS[config.country] || 'ebay.com';
  const params = { engine: 'ebay', _nkw: query.slice(0, 100), ebay_domain: domain, _ipg: '50' };
  // "Clothing, Shoes & Accessories" on ebay.com.
  if (domain === 'ebay.com') params.category_id = '11450';
  // Countries without their own eBay site search ebay.com, whose "$" prices are US dollars.
  const country = EBAY_DOMAINS[config.country] ? config.country : 'us';
  return mapSerpApiEbayResults(await serpApi(params, { signal, timeoutMs }), country);
}
