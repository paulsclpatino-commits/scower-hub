// Google Lens (reverse image search) and Google Shopping, both via SerpApi.
// Docs: https://serpapi.com/google-lens-api, https://serpapi.com/google-shopping-api

import { config } from '../config.js';
import { fetchJson, SourceError } from '../http.js';
import { makeListing, parsePrice, resolveCurrency } from '../normalize.js';

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

/** Guess a text query from Lens results, used when Claude isn't configured. */
export function lensQueryHint(body) {
  const related = (body.related_content || []).map((r) => r.query).find(Boolean);
  if (related) return related;
  const title = (body.visual_matches || []).map((m) => m.title).find(Boolean);
  return title ? title.replace(/\s*[|–—-]\s*[^|–—-]*$/, '').slice(0, 80) : null;
}

/**
 * Reverse-image search. Runs Lens twice - "products" (shopping results with
 * prices) and the default search (everything Google matched visually).
 */
export async function searchGoogleLens({ imageUrl, signal, timeoutMs }) {
  const base = { engine: 'google_lens', url: imageUrl, hl: 'en', country: config.country };
  const settled = await Promise.allSettled([
    serpApi({ ...base, type: 'products' }, { signal, timeoutMs }),
    serpApi(base, { signal, timeoutMs }),
  ]);
  const bodies = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!bodies.length) throw settled[0].reason;
  return {
    listings: bodies.flatMap((body) => mapLensMatches(body)),
    queryHint: bodies.map(lensQueryHint).find(Boolean) || null,
  };
}

function shippingFrom(text) {
  if (!text || !/ship|deliver/i.test(text)) return null;
  if (/free/i.test(text)) return 0;
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
