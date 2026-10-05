import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { mapEbayItems, resetEbayToken, searchEbayByImage, searchEbayByKeyword } from '../src/sources/ebay.js';
import {
  lensQueryHint, mapLensMatches, mapSerpApiEbayResults, mapShoppingResults, searchEbayViaSerpApi,
  searchGoogleLens, uploadImageToSerpApi,
} from '../src/sources/serpapi.js';

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

test('lensQueryHint keeps the words most matching titles agree on', () => {
  const vm = (titles) => ({ visual_matches: titles.map((title) => ({ title })) });
  assert.equal(
    lensQueryHint(vm([
      'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size L | Grailed',
      'Supreme Collage Zip Up Hoodie Black XL - Depop',
      'Supreme NYC Collage Zip-Up Hooded Sweatshirt FW24',
      'SUPREME NYC COLLAGE ZIP UP HOODED SWEATSHIRT BLACK MEDIUM',
      "Men's Hoodie Graphic Print Black",
    ])),
    'Supreme NYC Collage Zip Up Hooded Sweatshirt Black',
  );
  // Words shared by the top-ranked matches survive even when look-alikes outnumber them.
  const lookAlikes = Array.from({ length: 16 }, (_, i) => `Kapital Denim Jacket Indigo Style ${i}`);
  assert.equal(
    lensQueryHint(vm([
      'Kapital Kountry Boro Patchwork Denim Jacket Indigo',
      'Kapital Kountry Boro Patchwork Denim Jacket Indigo XL',
      'Kapital Kountry Boro Patchwork Denim Jacket Indigo',
      'Kapital Boro Patchwork Denim Jacket',
      ...lookAlikes,
    ])),
    'Kapital Kountry Boro Patchwork Denim Jacket Indigo',
  );
  // Brand words that look like filler survive.
  assert.equal(
    lensQueryHint(vm(['New Balance 550 White Green Size 10', 'NEW Balance 550 White Green', 'New Balance 550 Sneakers White/Green NWT'])),
    'New Balance 550 White Green',
  );
  // Titles from both Lens searches count, and Google's related search wins.
  assert.equal(lensQueryHint(vm(['a b']), { related_content: [{ query: 'supreme collage hoodie' }] }), 'supreme collage hoodie');
  assert.equal(lensQueryHint({}), null);
});

test('uploadImageToSerpApi posts the photo and returns its image_id', async () => {
  const previousKey = config.serpApiKey;
  config.serpApiKey = 'test-key';
  try {
    const calls = mockFetch(() => ({ body: { message: 'Image uploaded successfully.', image_id: 'img123' } }));
    const id = await uploadImageToSerpApi(Buffer.from('jpeg-bytes'));
    assert.equal(id, 'img123');
    assert.equal(calls[0].url, 'https://serpapi.com/image');
    assert.equal(calls[0].init.method, 'POST');
    const form = calls[0].init.body;
    assert.equal(form.get('api_key'), 'test-key');
    assert.equal(Buffer.from(await form.get('image').arrayBuffer()).toString(), 'jpeg-bytes');

    mockFetch(() => ({ status: 400, body: { error: 'File is too large.' } }));
    await assert.rejects(uploadImageToSerpApi(Buffer.from('x')), /too large/);
  } finally {
    config.serpApiKey = previousKey;
  }
});

test('searchGoogleLens searches by image_id when the photo was uploaded', async () => {
  const calls = mockFetch(() => ({ body: LENS_RESPONSE }));
  await searchGoogleLens({ imageId: 'img123', timeoutMs: 1000 });
  for (const call of calls) {
    const params = new URL(call.url).searchParams;
    assert.equal(params.get('image_id'), 'img123');
    assert.equal(params.has('url'), false);
  }
});

const SERPAPI_EBAY_RESPONSE = {
  organic_results: [
    {
      title: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size Large',
      link: 'https://www.ebay.com/itm/334455667788?hash=item1',
      condition: 'Pre-Owned',
      price: { raw: '$165.00', extracted: 165 },
      shipping: '+$12.50 shipping',
      thumbnail: 'https://i.ebayimg.com/thumbs/images/g/a/s-l300.jpg',
    },
    {
      title: 'Supreme Collage Zip Up Hoodie Black - Sizes S M L XL',
      link: 'https://www.ebay.com/itm/998877665544',
      condition: 'Brand New',
      price: { from: { raw: '$190.00', extracted: 190 }, to: { raw: '$240.00', extracted: 240 } },
      shipping: 'Free 4 day shipping',
      buy_it_now: true,
    },
    {
      title: 'Supreme Collage Hoodie Auction',
      link: 'https://www.ebay.com/itm/112233445566',
      price: { raw: '$80.00', extracted: 80 },
      bids: 3,
      shipping: { raw: '+$9.00 shipping', extracted: 9 },
    },
  ],
};

test('mapSerpApiEbayResults reads prices, price ranges, shipping and auctions', () => {
  const [used, range, auction] = mapSerpApiEbayResults(SERPAPI_EBAY_RESPONSE, 'us');
  assert.equal(used.price, 165);
  assert.equal(used.shipping, 12.5);
  assert.equal(used.size, 'L');
  assert.equal(used.store, 'eBay');
  assert.deepEqual(used.sources, ['ebay']);
  assert.equal(range.price, 190);
  assert.equal(range.size, 'Several sizes');
  // A range from colour variants keeps the size the title states.
  const [colours] = mapSerpApiEbayResults({
    organic_results: [{ title: 'Nike Tech Fleece Hoodie Size M - Choose Colour', link: 'https://www.ebay.com/itm/121212121212', price: { from: { raw: '$80.00', extracted: 80 }, to: { raw: '$95.00', extracted: 95 } } }],
  }, 'us');
  assert.equal(colours.size, 'M');
  // Localized shipping text on European eBay sites.
  const [de1, de2] = mapSerpApiEbayResults({
    organic_results: [
      { title: 'a', link: 'https://www.ebay.de/itm/1', price: { raw: 'EUR 165,00', extracted: 165 }, shipping: '+EUR 4,99 Versand' },
      { title: 'b', link: 'https://www.ebay.de/itm/2', price: { raw: 'EUR 167,00', extracted: 167 }, shipping: 'Kostenloser Versand' },
    ],
  }, 'de');
  assert.equal(de1.currency, 'EUR');
  assert.equal(de1.shipping, 4.99);
  assert.equal(de2.shipping, 0);
  assert.equal(range.shipping, 0);
  assert.equal(range.buyingFormat, null);
  assert.equal(auction.price, 80);
  assert.equal(auction.shipping, 9);
  assert.equal(auction.buyingFormat, 'Auction');
});

test('countries without their own eBay site read ebay.com prices as US dollars', async () => {
  const previous = config.country;
  config.country = 'nz';
  try {
    mockFetch(() => ({ body: SERPAPI_EBAY_RESPONSE }));
    const [first] = await searchEbayViaSerpApi({ query: 'hoodie', timeoutMs: 1000 });
    assert.equal(first.currency, 'USD');
    assert.equal(first.priceUsd, 165);
  } finally {
    config.country = previous;
  }
});

test('searchEbayViaSerpApi searches ebay.com clothing', async () => {
  const calls = mockFetch(() => ({ body: SERPAPI_EBAY_RESPONSE }));
  const listings = await searchEbayViaSerpApi({ query: 'Supreme NYC Collage Zip Up Hoodie', timeoutMs: 1000 });
  assert.equal(listings.length, 3);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('engine'), 'ebay');
  assert.equal(params.get('_nkw'), 'Supreme NYC Collage Zip Up Hoodie');
  assert.equal(params.get('ebay_domain'), 'ebay.com');
  assert.equal(params.get('category_id'), '11450');
});
