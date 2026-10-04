import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { mapEbayItems, resetEbayToken, searchEbayByImage, searchEbayByKeyword } from '../src/sources/ebay.js';
import { lensQueryHint, mapLensMatches, mapShoppingResults, searchGoogleLens } from '../src/sources/serpapi.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = await handler(String(url), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return calls;
}

const LENS_RESPONSE = {
  visual_matches: [
    {
      position: 1,
      title: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size L',
      link: 'https://www.grailed.com/listings/111-supreme-collage?utm_source=lens',
      source: 'Grailed',
      price: { value: '$168*', extracted_value: 168, currency: '$' },
      in_stock: true,
      thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=1',
    },
    {
      position: 2,
      title: 'Supreme NYC Collage Zip Up Hooded Sweatshirt',
      link: 'https://www.instagram.com/p/abc',
      source: 'Instagram',
      thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=2',
    },
    { position: 3, title: 'broken', link: 'notaurl' },
  ],
  related_content: [{ query: 'Supreme NYC Collage Zip Up Hoodie' }],
};

test('mapLensMatches keeps priced and unpriced matches with valid links', () => {
  const listings = mapLensMatches(LENS_RESPONSE, 'us');
  assert.equal(listings.length, 2);
  const [grailed, insta] = listings;
  assert.equal(grailed.store, 'Grailed');
  assert.equal(grailed.price, 168);
  assert.equal(grailed.currency, 'USD');
  assert.equal(grailed.size, 'L');
  assert.equal(grailed.inStock, true);
  assert.equal(grailed.foundVia, 'visual');
  assert.equal(insta.price, null);
  assert.equal(lensQueryHint(LENS_RESPONSE), 'Supreme NYC Collage Zip Up Hoodie');
  // Without related searches, the first title is used, minus size and condition words.
  assert.equal(
    lensQueryHint({ visual_matches: [{ title: 'NWT Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size L | Grailed' }] }),
    'Supreme NYC Collage Zip Up Hooded Sweatshirt Black',
  );
});

test('searchGoogleLens calls SerpApi for products and all matches', async () => {
  const previousKey = config.serpApiKey;
  config.serpApiKey = 'test-key';
  try {
    const calls = mockFetch(() => ({ body: LENS_RESPONSE }));
    const result = await searchGoogleLens({ imageUrl: 'https://example.com/photo.jpg', timeoutMs: 1000 });
    assert.equal(calls.length, 2);
    const params = calls.map((c) => new URL(c.url).searchParams);
    assert.deepEqual(params.map((p) => p.get('type')), ['products', null]);
    for (const p of params) {
      assert.equal(p.get('engine'), 'google_lens');
      assert.equal(p.get('url'), 'https://example.com/photo.jpg');
      assert.equal(p.get('api_key'), 'test-key');
    }
    assert.equal(result.listings.length, 4); // duplicates are merged later, by the orchestrator
    assert.equal(result.queryHint, 'Supreme NYC Collage Zip Up Hoodie');
  } finally {
    config.serpApiKey = previousKey;
  }
});

test('searchGoogleLens surfaces SerpApi errors', async () => {
  mockFetch(() => ({ status: 401, body: { error: 'Invalid API key.' } }));
  await assert.rejects(searchGoogleLens({ imageUrl: 'https://example.com/a.jpg', timeoutMs: 1000 }), /Invalid API key/);
});

test('searchGoogleLens treats "no results" as an empty result', async () => {
  mockFetch(() => ({ body: { error: "Google Lens hasn't returned any results for this query." } }));
  const result = await searchGoogleLens({ imageUrl: 'https://example.com/a.jpg', timeoutMs: 1000 });
  assert.deepEqual(result.listings, []);
});

test('mapShoppingResults reads price, shipping and condition', () => {
  const listings = mapShoppingResults(
    {
      shopping_results: [
        {
          title: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black XL',
          link: 'https://stockx.com/supreme-nyc-collage-zip-up-hooded-sweatshirt-black',
          source: 'StockX',
          price: '$226.00',
          extracted_price: 226,
          delivery: '+$14.95 delivery',
          thumbnail: 'https://encrypted-tbn0.gstatic.com/s.jpg',
        },
        {
          title: 'Supreme Collage Hoodie',
          product_link: 'https://www.google.com/shopping/product/123',
          source: 'eBay',
          price: '$150.00',
          extracted_price: 150,
          delivery: 'Free delivery',
          second_hand_condition: 'used',
        },
      ],
    },
    'us',
  );
  assert.equal(listings.length, 2);
  assert.equal(listings[0].shipping, 14.95);
  assert.equal(listings[0].size, 'XL');
  assert.equal(listings[1].url, 'https://www.google.com/shopping/product/123');
  assert.equal(listings[1].shipping, 0);
  assert.equal(listings[1].condition, 'used');
  assert.equal(listings[1].foundVia, 'keyword');
});

const EBAY_RESPONSE = {
  itemSummaries: [
    {
      itemId: 'v1|123456789012|0',
      title: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size Medium FW24',
      price: { value: '189.99', currency: 'USD' },
      itemWebUrl: 'https://www.ebay.com/itm/123456789012?hash=item1',
      image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l225.jpg' },
      condition: 'New with tags',
      buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
      shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' } }],
    },
    {
      itemId: 'v1|223456789012|0',
      title: 'Supreme Collage Hoodie XL',
      currentBidPrice: { value: '95.00', currency: 'USD' },
      itemWebUrl: 'https://www.ebay.com/itm/223456789012',
      condition: 'Pre-owned',
      buyingOptions: ['AUCTION'],
      shippingOptions: [{ shippingCostType: 'CALCULATED' }],
    },
  ],
};

test('mapEbayItems handles fixed price, shipping and auctions', () => {
  const [bin, auction] = mapEbayItems(EBAY_RESPONSE, 'visual');
  assert.equal(bin.price, 189.99);
  assert.equal(bin.shipping, 0);
  assert.equal(bin.size, 'M');
  assert.equal(bin.store, 'eBay');
  assert.equal(bin.buyingFormat, null);
  assert.equal(auction.price, 95);
  assert.equal(auction.shipping, null);
  assert.equal(auction.buyingFormat, 'Auction');
});

test('eBay search gets an app token once and sends the photo as base64', async () => {
  const previous = { ...config.ebay };
  Object.assign(config.ebay, { clientId: 'id', clientSecret: 'secret', marketplace: 'EBAY_US' });
  resetEbayToken();
  try {
    const calls = mockFetch((url) =>
      url.includes('/oauth2/token') ? { body: { access_token: 'tok', expires_in: 7200 } } : { body: EBAY_RESPONSE },
    );
    const jpeg = Buffer.from('fake-jpeg');
    const byImage = await searchEbayByImage({ jpeg, timeoutMs: 1000 });
    const byKeyword = await searchEbayByKeyword({ query: 'Supreme NYC Collage Zip Up Hoodie', timeoutMs: 1000 });
    assert.equal(byImage.length, 2);
    assert.equal(byKeyword.length, 2);

    const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/token'));
    assert.equal(tokenCalls.length, 1, 'token is cached between calls');
    assert.equal(tokenCalls[0].init.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);

    const imageCall = calls.find((c) => c.url.includes('search_by_image'));
    assert.equal(imageCall.init.method, 'POST');
    assert.deepEqual(JSON.parse(imageCall.init.body), { image: jpeg.toString('base64') });
    assert.equal(imageCall.init.headers.Authorization, 'Bearer tok');
    assert.equal(imageCall.init.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
    assert.equal(new URL(imageCall.url).searchParams.get('category_ids'), '11450');

    const keywordCall = calls.find((c) => c.url.includes('/item_summary/search?'));
    assert.equal(new URL(keywordCall.url).searchParams.get('q'), 'Supreme NYC Collage Zip Up Hoodie');
  } finally {
    Object.assign(config.ebay, previous);
    resetEbayToken();
  }
});
