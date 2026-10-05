// Pure helpers for filtering, sorting and summarizing listings. No DOM access,
// so the same file runs in the browser and in the Node tests.

export const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL', 'One Size'];
export const UNKNOWN_SIZE = 'Not listed';
// One listing offering several sizes (e.g. an eBay listing with a price range).
export const MULTI_SIZE = 'Several sizes';

export function sizeRank(size) {
  const index = SIZE_ORDER.indexOf(size);
  if (index >= 0) return index;
  const numeric = Number.parseFloat(size);
  if (Number.isFinite(numeric)) return 100 + numeric;
  return 10_000;
}

export function compareSizes(a, b) {
  return sizeRank(a) - sizeRank(b) || String(a).localeCompare(String(b));
}

export function conditionBucket(condition) {
  if (!condition) return 'Unknown';
  if (/pre-?owned|used|worn|refurb|like new|good|fair|excellent|gently/i.test(condition)) return 'Used';
  if (/new|deadstock|\bds\b|nwt|unworn/i.test(condition)) return 'New';
  return 'Unknown';
}

const VERDICT_RANK = { exact: 0, similar: 1, null: 2, different: 3 };

function verdictRank(verdicts, id) {
  return VERDICT_RANK[verdicts[id] ?? 'null'];
}

export function totalPrice(listing) {
  if (listing.priceUsd == null) return null;
  return listing.priceUsd + (listing.shippingUsd ?? 0);
}

export const DEFAULT_FILTERS = Object.freeze({
  match: 'close', // 'exact' | 'close' (hide different) | 'all'
  sizes: [],
  stores: [],
  conditions: [],
  minPrice: null,
  maxPrice: null,
  showNoPrice: false,
});

/**
 * Apply filters. `skip` names one facet to ignore, so a facet's own menu can
 * show counts for the options the user hasn't picked yet.
 */
export function applyFilters(listings, verdicts, filters, skip = null) {
  const sizes = new Set(filters.sizes);
  const stores = new Set(filters.stores);
  const conditions = new Set(filters.conditions);
  return listings.filter((l) => {
    const verdict = verdicts[l.id] ?? null;
    if (filters.match === 'exact' && verdict !== 'exact') return false;
    if (filters.match === 'close' && verdict === 'different') return false;
    if (!filters.showNoPrice && l.price == null) return false;
    if (skip !== 'sizes' && sizes.size && !sizes.has(l.size ?? UNKNOWN_SIZE) && l.size !== MULTI_SIZE) return false;
    if (skip !== 'stores' && stores.size && !stores.has(l.store)) return false;
    if (skip !== 'conditions' && conditions.size && !conditions.has(conditionBucket(l.condition))) return false;
    if (skip !== 'price') {
      if (filters.minPrice != null && (l.priceUsd == null || l.priceUsd < filters.minPrice)) return false;
      if (filters.maxPrice != null && (l.priceUsd == null || l.priceUsd > filters.maxPrice)) return false;
    }
    return true;
  });
}

function byNumber(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export const SORTS = {
  price_asc: 'Price: low to high',
  total_asc: 'Price + shipping: low to high',
  price_desc: 'Price: high to low',
  best: 'Best match',
};

export function sortListings(listings, verdicts, sort = 'price_asc') {
  const list = [...listings];
  const tieBreak = (a, b) => verdictRank(verdicts, a.id) - verdictRank(verdicts, b.id) || a.title.localeCompare(b.title);
  switch (sort) {
    case 'price_desc':
      return list.sort((a, b) => {
        if (a.priceUsd == null || b.priceUsd == null) return byNumber(a.priceUsd, b.priceUsd);
        return b.priceUsd - a.priceUsd || tieBreak(a, b);
      });
    case 'total_asc':
      return list.sort((a, b) => byNumber(totalPrice(a), totalPrice(b)) || tieBreak(a, b));
    case 'best':
      return list.sort(
        (a, b) =>
          verdictRank(verdicts, a.id) - verdictRank(verdicts, b.id) ||
          (a.foundVia === 'visual' ? 0 : 1) - (b.foundVia === 'visual' ? 0 : 1) ||
          byNumber(a.priceUsd, b.priceUsd),
      );
    case 'price_asc':
    default:
      return list.sort((a, b) => byNumber(a.priceUsd, b.priceUsd) || tieBreak(a, b));
  }
}

export function priceStats(listings) {
  const prices = listings.map((l) => l.priceUsd).filter((p) => p != null).sort((a, b) => a - b);
  if (!prices.length) return { count: 0, min: null, median: null, max: null };
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return { count: prices.length, min: prices[0], median, max: prices[prices.length - 1] };
}

/** { value: count } for one facet, honoring every other active filter. */
export function facetCounts(listings, verdicts, filters, facet) {
  const pool = applyFilters(listings, verdicts, filters, facet);
  const counts = new Map();
  for (const l of pool) {
    const key = facet === 'sizes' ? l.size ?? UNKNOWN_SIZE : facet === 'stores' ? l.store : conditionBucket(l.condition);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Keep selected options visible even when nothing else matches them.
  for (const value of filters[facet] || []) if (!counts.has(value)) counts.set(value, 0);
  return counts;
}

export function formatMoney(value, currency = 'USD') {
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

/** Search pages on resale sites, for checking places the APIs don't cover. */
export function storeSearchLinks(query) {
  const q = encodeURIComponent(query);
  return [
    { name: 'Grailed', url: `https://www.grailed.com/shop?query=${q}` },
    { name: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sop=15` },
    { name: 'Depop', url: `https://www.depop.com/search/?q=${q}` },
    { name: 'Poshmark', url: `https://poshmark.com/search?query=${q}` },
    { name: 'Mercari', url: `https://www.mercari.com/search/?keyword=${q}` },
    { name: 'StockX', url: `https://stockx.com/search?s=${q}` },
    { name: 'GOAT', url: `https://www.goat.com/search?query=${q}` },
    { name: 'Vinted', url: `https://www.vinted.com/catalog?search_text=${q}` },
  ];
}

export function isSafeUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
