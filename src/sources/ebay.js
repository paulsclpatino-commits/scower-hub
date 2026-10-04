// eBay Browse API: search by image and by keyword.
// Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/searchByImage

import { config } from '../config.js';
import { fetchJson } from '../http.js';
import { makeListing } from '../normalize.js';

const API = 'https://api.ebay.com';
// "Clothing, Shoes & Accessories" on ebay.com.
const CLOTHING_CATEGORY = '11450';

let cachedToken = null;

async function getAccessToken(signal) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${config.ebay.clientId}:${config.ebay.clientSecret}`).toString('base64');
  const body = await fetchJson(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    signal,
    timeoutMs: 15_000,
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 7200) * 1000 };
  return cachedToken.value;
}

export function resetEbayToken() {
  cachedToken = null;
}

function searchParams() {
  const params = new URLSearchParams({ limit: '50' });
  if (config.ebay.marketplace === 'EBAY_US') params.set('category_ids', CLOTHING_CATEGORY);
  return params;
}

async function headers(signal) {
  return {
    Authorization: `Bearer ${await getAccessToken(signal)}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': config.ebay.marketplace,
  };
}

function buyingFormat(options = []) {
  if (!options.includes('AUCTION')) return null;
  return options.includes('FIXED_PRICE') ? 'Auction or Buy It Now' : 'Auction';
}

export function mapEbayItems(body, foundVia) {
  return (body.itemSummaries || [])
    .map((item) => {
      const ship = (item.shippingOptions || [])[0];
      const shipping = ship && ship.shippingCostType !== 'CALCULATED' ? ship.shippingCost : null;
      return makeListing({
        url: item.itemWebUrl,
        title: item.title,
        image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl,
        price: item.price || item.currentBidPrice,
        shipping,
        condition: item.condition,
        store: 'eBay',
        source: 'ebay',
        foundVia,
        buyingFormat: buyingFormat(item.buyingOptions),
      });
    })
    .filter(Boolean);
}

export async function searchEbayByImage({ jpeg, signal, timeoutMs }) {
  const body = await fetchJson(`${API}/buy/browse/v1/item_summary/search_by_image?${searchParams()}`, {
    method: 'POST',
    signal,
    timeoutMs,
    headers: await headers(signal),
    body: JSON.stringify({ image: jpeg.toString('base64') }),
  });
  return mapEbayItems(body, 'visual');
}

export async function searchEbayByKeyword({ query, signal, timeoutMs }) {
  const params = searchParams();
  params.set('q', query.slice(0, 100));
  const body = await fetchJson(`${API}/buy/browse/v1/item_summary/search?${params}`, {
    signal,
    timeoutMs,
    headers: await headers(signal),
  });
  return mapEbayItems(body, 'keyword');
}
