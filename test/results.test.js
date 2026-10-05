import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS, UNKNOWN_SIZE, applyFilters, compareSizes, conditionBucket, facetCounts,
  isSafeUrl, priceStats, sortListings, storeSearchLinks,
} from '../public/js/results.js';

const L = (id, price, extra = {}) => ({
  id, title: id, price, priceUsd: price, shipping: null, shippingUsd: null, size: null,
  store: 'eBay', condition: null, foundVia: 'visual', ...extra,
});

const listings = [
  L('a', 200, { size: 'L', store: 'Grailed', condition: 'Used' }),
  L('b', 150, { size: 'M', shipping: 40, shippingUsd: 40, condition: 'New with tags' }),
  L('c', 180, { size: 'L', shipping: 0, shippingUsd: 0, condition: 'Pre-owned' }),
  L('d', null, { size: 'XL', store: 'Depop' }),
  L('e', 90, { store: 'Depop' }),
];
const verdicts = { a: 'exact', b: 'exact', c: 'similar', e: 'different' };
const filters = (over = {}) => ({ ...DEFAULT_FILTERS, sizes: [], stores: [], conditions: [], ...over });

test('default filters hide different items and listings without a price', () => {
  assert.deepEqual(applyFilters(listings, verdicts, filters()).map((l) => l.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(applyFilters(listings, verdicts, filters({ match: 'exact' })).map((l) => l.id).sort(), ['a', 'b']);
  assert.equal(applyFilters(listings, verdicts, filters({ match: 'all', showNoPrice: true })).length, 5);
});

test('a multi-size listing matches any size filter', () => {
  const multi = [...listings, L('m', 120, { size: 'Several sizes' })];
  assert.ok(applyFilters(multi, verdicts, filters({ sizes: ['L'] })).some((l) => l.id === 'm'));
  assert.ok(applyFilters(multi, verdicts, filters({ sizes: ['XS'] })).some((l) => l.id === 'm'));
});

test('facet and price filters combine', () => {
  const f = filters({ sizes: ['L'], conditions: ['Used'], maxPrice: 190 });
  assert.deepEqual(applyFilters(listings, verdicts, f).map((l) => l.id), ['c']);
  const unknown = filters({ match: 'all', sizes: [UNKNOWN_SIZE] });
  assert.deepEqual(applyFilters(listings, verdicts, unknown).map((l) => l.id), ['e']);
});

test('sorting puts the cheapest first and missing prices last', () => {
  const all = filters({ match: 'all', showNoPrice: true });
  const visible = applyFilters(listings, verdicts, all);
  assert.deepEqual(sortListings(visible, verdicts, 'price_asc').map((l) => l.id), ['e', 'b', 'c', 'a', 'd']);
  assert.deepEqual(sortListings(visible, verdicts, 'price_desc').map((l) => l.id), ['a', 'c', 'b', 'e', 'd']);
  assert.deepEqual(sortListings(visible, verdicts, 'total_asc').map((l) => l.id), ['e', 'c', 'b', 'a', 'd']);
  assert.deepEqual(sortListings(visible, verdicts, 'best').map((l) => l.id), ['b', 'a', 'c', 'd', 'e']);
});

test('priceStats summarizes visible prices', () => {
  assert.deepEqual(priceStats(listings), { count: 4, min: 90, median: 165, max: 200 });
  assert.deepEqual(priceStats([]), { count: 0, min: null, median: null, max: null });
});

test('facetCounts ignores its own selection but honors the others', () => {
  const counts = facetCounts(listings, verdicts, filters({ sizes: ['M'], stores: ['eBay'] }), 'sizes');
  assert.deepEqual(Object.fromEntries(counts), { M: 1, L: 1 });
});

test('size, condition and URL helpers', () => {
  assert.deepEqual(['XL', '32', 'S', 'One Size', 'M', 'XXS', '10.5'].sort(compareSizes), ['XXS', 'S', 'M', 'XL', 'One Size', '10.5', '32']);
  assert.equal(conditionBucket('New with tags'), 'New');
  assert.equal(conditionBucket('Pre-owned'), 'Used');
  assert.equal(conditionBucket('Like New'), 'Used');
  assert.equal(conditionBucket(null), 'Unknown');
  assert.equal(isSafeUrl('https://grailed.com/x'), true);
  assert.equal(isSafeUrl('/demo/hoodie.svg'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('//evil.example'), false);
  assert.ok(storeSearchLinks('supreme hoodie').every((s) => s.url.includes('supreme%20hoodie')));
});
