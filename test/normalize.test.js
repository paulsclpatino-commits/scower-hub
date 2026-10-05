import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError, SourceError } from '../src/http.js';
import {
  canonicalUrl, extractSize, listingId, makeListing, mergeListings, parsePrice,
  resolveCurrency, storeFromUrl,
} from '../src/normalize.js';

test('parsePrice handles common formats', () => {
  assert.deepEqual(parsePrice('$1,299.00'), { value: 1299, currency: 'USD' });
  assert.deepEqual(parsePrice('1.299,00 €'), { value: 1299, currency: 'EUR' });
  assert.deepEqual(parsePrice('£250'), { value: 250, currency: 'GBP' });
  assert.deepEqual(parsePrice('US $189.99'), { value: 189.99, currency: 'USD' });
  assert.deepEqual(parsePrice('CA$ 199.99'), { value: 199.99, currency: 'CAD' });
  assert.deepEqual(parsePrice('$29*'), { value: 29, currency: 'USD' });
  assert.deepEqual(parsePrice('$0.99'), { value: 0.99, currency: 'USD' });
  assert.deepEqual(parsePrice({ value: '250.00', currency: 'USD' }), { value: 250, currency: 'USD' });
  assert.deepEqual(parsePrice(42), { value: 42, currency: 'USD' });
  assert.equal(parsePrice('Free'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});

test('resolveCurrency maps a bare $ to the local dollar', () => {
  assert.equal(resolveCurrency('$', 'us'), 'USD');
  assert.equal(resolveCurrency('$', 'ca'), 'CAD');
  assert.equal(resolveCurrency('$', 'gb'), 'USD');
  assert.equal(resolveCurrency('£', 'us'), 'GBP');
  assert.equal(resolveCurrency('', 'gb'), 'GBP');
});

test('extractSize reads sizes out of listing titles', () => {
  const cases = [
    ['Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size L', 'L'],
    ['SUPREME COLLAGE ZIP UP HOODIE SZ XL', 'XL'],
    ['Supreme Hoodie Mens X-Large Black', 'XL'],
    ['Supreme NYC Collage Zip Up Hoodie Black Medium', 'M'],
    ['Supreme 2XL hoodie', 'XXL'],
    ['Supreme Hoodie Black (L)', 'L'],
    ['Supreme Hoodie | M | Black', 'M'],
    ['Tagged XL Supreme hoodie', 'XL'],
    ['Levis 501 Jeans 32x30 Blue', '32x30'],
    ['Nike Air Force 1 size 10.5', '10.5'],
    ['Supreme Small Box Logo Tee White M', 'M'],
    ['Supreme x The North Face S Logo Jacket XL', 'XL'],
    ['Supreme Box Logo Hoodie Large Black FW24', 'L'],
  ];
  for (const [title, size] of cases) assert.equal(extractSize(title), size, title);
});

test('extractSize does not invent sizes', () => {
  for (const title of [
    'Supreme NYC Collage Zip Up Hooded Sweatshirt',
    'Supreme Hooded Sweatshirt M&M Black',
    'Supreme S/S Top Black',
    'Harley Davidson Tee L.A. Black',
    'Supreme Large Logo Hoodie',
    'Vintage 1994 Supreme Tee',
    'Supreme Collage Zip Up Hoodie Black - Sizes S M L XL',
    'Supreme Hoodie S/M/L available',
  ]) {
    assert.equal(extractSize(title), null, title);
  }
});

test('canonicalUrl collapses tracking params and eBay URL variants', () => {
  assert.equal(
    canonicalUrl('https://www.ebay.com/itm/Supreme-hoodie/123456789012?hash=item1&var=0'),
    canonicalUrl('https://ebay.com/itm/123456789012'),
  );
  assert.equal(
    canonicalUrl('https://www.grailed.com/listings/123-supreme/?utm_source=google&srsltid=abc'),
    'grailed.com/listings/123-supreme',
  );
  assert.notEqual(listingId('https://www.grailed.com/listings/1'), listingId('https://www.grailed.com/listings/2'));
});

test('storeFromUrl names known stores and falls back to the host', () => {
  assert.equal(storeFromUrl('https://www.grailed.com/listings/1'), 'Grailed');
  assert.equal(storeFromUrl('https://www.ebay.co.uk/itm/1'), 'eBay');
  assert.equal(storeFromUrl('https://shop.example.com/p/1'), 'shop.example.com');
});

test('makeListing builds the frontend shape and drops bad links', () => {
  const listing = makeListing({
    url: 'https://www.grailed.com/listings/1',
    title: '  Supreme   Collage Hoodie  Size L ',
    image: 'javascript:alert(1)',
    price: { value: 150, currency: 'USD' },
    shipping: 12,
    source: 'google_lens',
  });
  assert.equal(listing.title, 'Supreme Collage Hoodie Size L');
  assert.equal(listing.size, 'L');
  assert.equal(listing.store, 'Grailed');
  assert.equal(listing.image, null);
  assert.equal(listing.price, 150);
  assert.equal(listing.shipping, 12);
  assert.equal(listing.priceUsd, 150);
  assert.equal(makeListing({ url: 'not a url', title: 'x', source: 'google_lens' }), null);
});

test('mergeListings prefers eBay API data over a Lens hit for the same item', () => {
  const lens = makeListing({
    url: 'https://www.ebay.com/itm/123456789012?mkevt=1',
    title: 'Supreme Collage Hoodie',
    image: 'https://encrypted-tbn0.gstatic.com/x.jpg',
    price: { value: 200, currency: 'USD' },
    source: 'google_lens',
    foundVia: 'visual',
  });
  const ebay = makeListing({
    url: 'https://www.ebay.com/itm/123456789012',
    title: 'Supreme NYC Collage Zip Up Hoodie Black Size M',
    price: { value: 185, currency: 'USD' },
    shipping: { value: 0, currency: 'USD' },
    condition: 'New with tags',
    source: 'ebay',
    foundVia: 'keyword',
  });
  assert.equal(lens.id, ebay.id);
  const merged = mergeListings(lens, ebay);
  assert.equal(merged.price, 185);
  assert.equal(merged.shipping, 0);
  assert.equal(merged.size, 'M');
  assert.equal(merged.condition, 'New with tags');
  assert.equal(merged.image, 'https://encrypted-tbn0.gstatic.com/x.jpg');
  assert.equal(merged.foundVia, 'visual');
  assert.deepEqual(merged.sources.sort(), ['ebay', 'google_lens']);
});

test('describeError explains network failures instead of "fetch failed"', () => {
  const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  assert.match(describeError(dns), /internet connection/);
  const tls = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
  assert.match(describeError(tls), /antivirus or a proxy/);
  const odd = Object.assign(new TypeError('fetch failed'), { cause: { code: 'EWEIRD' } });
  assert.equal(describeError(odd), 'Network error: EWEIRD');
  assert.equal(describeError(new SourceError('HTTP 401: Invalid API key.')), 'HTTP 401: Invalid API key.');
  assert.equal(describeError(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'Timed out');
});
