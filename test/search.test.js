import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeListing } from '../src/normalize.js';
import { cachedSearch, clearSearchCache, runDemoSearch, runSearch } from '../src/search.js';

const ALL_ON = { identify: true, googleLens: true, googleShopping: true, ebay: true, demo: false };
const ITEM = {
  isFashionItem: true,
  brand: 'Supreme',
  name: 'NYC Collage Zip Up Hooded Sweatshirt',
  colorway: 'Black',
  query: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black',
  altQueries: ['Supreme Collage Zip Up Hoodie'],
  keyDetails: [],
  confidence: 'high',
  wantedSize: '',
};

function listing(url, title, price, source = 'google_lens', foundVia = 'visual') {
  return makeListing({ url, title, price: { value: price, currency: 'USD' }, source, foundVia });
}

function fakeDeps(overrides = {}) {
  const calls = { ebayKeyword: [], shopping: [] };
  const deps = {
    identifyItem: async () => ITEM,
    searchGoogleLens: async () => ({
      listings: [
        listing('https://www.grailed.com/listings/1', 'Supreme NYC Collage Zip Up Hoodie Black L', 160),
        listing('https://www.ebay.com/itm/123456789012?mkevt=1', 'Supreme Collage Hoodie', 210),
      ],
      queryHint: 'Supreme Collage Zip Up',
    }),
    searchEbayByImage: async () => [
      listing('https://www.ebay.com/itm/123456789012', 'Supreme NYC Collage Zip Up Hoodie Black Size M', 199, 'ebay'),
    ],
    searchEbayByKeyword: async ({ query }) => {
      calls.ebayKeyword.push(query);
      return [listing('https://www.ebay.com/itm/999999999999', 'Supreme NYC Collage Zip Up Black XL', 230, 'ebay', 'keyword')];
    },
    searchGoogleShopping: async ({ query }) => {
      calls.shopping.push(query);
      return [listing('https://stockx.com/supreme-collage', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black', 226, 'google_shopping', 'keyword')];
    },
    classifyListings: async ({ listings }) => Object.fromEntries(listings.map((l) => [l.id, 'exact'])),
    ...overrides,
  };
  return { deps, calls };
}

async function collect(fn) {
  const events = [];
  await fn((event) => events.push(event));
  return events;
}

const getImageUrl = async () => 'https://example.com/photo.jpg';

beforeEach(() => clearSearchCache());

test('runSearch streams identification, listings from every source, then matches', async () => {
  const { deps, calls } = fakeDeps();
  const events = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit, features: ALL_ON, deps, getImageUrl }),
  );

  assert.equal(events[0].type, 'start');
  assert.deepEqual(events[0].steps.map((s) => s.id), ['identify', 'google_lens', 'ebay_image', 'ebay_keyword', 'google_shopping', 'match']);
  assert.ok(events.some((e) => e.type === 'item' && e.item.brand === 'Supreme'));
  assert.ok(events.some((e) => e.type === 'query' && e.query === ITEM.query && e.origin === 'ai'));
  assert.deepEqual(calls.shopping, [ITEM.query]);
  // Keyword search returned fewer than 5 results, so the AI's fallback query ran too.
  assert.deepEqual(calls.ebayKeyword, [ITEM.query, ITEM.altQueries[0]]);

  const latest = new Map();
  for (const e of events.filter((e) => e.type === 'listings')) for (const l of e.listings) latest.set(l.id, l);
  // The eBay item found by both Lens and eBay's photo search is one listing.
  assert.equal(latest.size, 4);
  const ebayItem = [...latest.values()].find((l) => l.url.includes('123456789012'));
  assert.deepEqual(ebayItem.sources.sort(), ['ebay', 'google_lens']);
  assert.equal(ebayItem.price, 199);

  const matches = events.find((e) => e.type === 'matches');
  assert.equal(matches.method, 'ai');
  assert.equal(Object.keys(matches.verdicts).length, 4);

  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.total, 4);
  const finished = events.filter((e) => e.type === 'step' && e.status === 'done').map((e) => e.id);
  assert.deepEqual(finished.sort(), ['ebay_image', 'ebay_keyword', 'google_lens', 'google_shopping', 'identify', 'match']);
});

test('one failing source is reported without stopping the others', async () => {
  const { deps } = fakeDeps({
    searchEbayByImage: async () => {
      throw new Error('HTTP 500: eBay is down');
    },
  });
  const events = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit, features: ALL_ON, deps, getImageUrl }),
  );
  const failed = events.find((e) => e.type === 'step' && e.id === 'ebay_image' && e.status === 'error');
  assert.match(failed.message, /eBay is down/);
  assert.equal(events.at(-1).type, 'done');
  assert.ok(events.at(-1).total >= 3);
});

test('without Claude, the shopper note (or Lens) supplies the keyword query', async () => {
  const features = { ...ALL_ON, identify: false };
  const { deps, calls } = fakeDeps();
  const withHint = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: 'supreme collage hoodie' }, { emit, features, deps, getImageUrl }),
  );
  assert.deepEqual(calls.shopping, ['supreme collage hoodie']);
  assert.ok(withHint.some((e) => e.type === 'query' && e.origin === 'hint'));
  assert.ok(!withHint.some((e) => e.type === 'step' && e.id === 'match'));
  const matches = withHint.find((e) => e.type === 'matches');
  assert.equal(matches.method, 'keywords');

  const { deps: deps2, calls: calls2 } = fakeDeps();
  const fromLens = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit, features, deps: deps2, getImageUrl }),
  );
  assert.deepEqual(calls2.shopping, ['Supreme Collage Zip Up']);
  assert.ok(fromLens.some((e) => e.type === 'query' && e.origin === 'lens'));
});

test('a failed AI match check falls back to keyword matching', async () => {
  const { deps } = fakeDeps({
    classifyListings: async () => {
      throw new Error('HTTP 529: overloaded');
    },
  });
  const events = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit, features: ALL_ON, deps, getImageUrl }),
  );
  assert.ok(events.some((e) => e.type === 'step' && e.id === 'match' && e.status === 'error'));
  const matches = events.find((e) => e.type === 'matches');
  assert.equal(matches.method, 'keywords');
  assert.ok(Object.keys(matches.verdicts).length > 0);
});

test('Lens is skipped with a reason when there is no public photo URL', async () => {
  const { deps } = fakeDeps();
  const events = await collect((emit) =>
    runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit, features: ALL_ON, deps, getImageUrl: async () => null }),
  );
  const lens = events.find((e) => e.type === 'step' && e.id === 'google_lens' && e.status !== 'running');
  assert.equal(lens.status, 'skipped');
  assert.match(lens.message, /public link/);
});

test('cancelling a search stops it', async () => {
  const controller = new AbortController();
  const { deps } = fakeDeps({
    identifyItem: ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  });
  const run = runSearch({ jpeg: Buffer.from('x'), hint: '' }, { emit: () => {}, signal: controller.signal, features: ALL_ON, deps, getImageUrl });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(run);
});

test('cachedSearch replays a repeat search without calling sources again', async () => {
  let lensCalls = 0;
  const { deps } = fakeDeps({
    searchGoogleLens: async () => {
      lensCalls++;
      return { listings: [listing('https://www.grailed.com/listings/1', 'Supreme Collage', 160)], queryHint: null };
    },
  });
  const input = { jpeg: Buffer.from('same-photo'), hint: '' };
  const first = await collect((emit) => cachedSearch(input, { emit, features: ALL_ON, deps, getImageUrl }));
  const second = await collect((emit) => cachedSearch(input, { emit, features: ALL_ON, deps, getImageUrl }));
  assert.equal(lensCalls, 1);
  assert.equal(second.length, first.length);
  assert.equal(second.at(-1).cached, true);
});

test('demo search emits a complete result set', async () => {
  const events = await collect((emit) => runDemoSearch({ emit, hint: 'size L', speed: 0 }));
  assert.equal(events[0].demo, true);
  assert.equal(events.find((e) => e.type === 'item').item.wantedSize, 'L');
  const count = events.filter((e) => e.type === 'listings').reduce((n, e) => n + e.listings.length, 0);
  assert.equal(events.at(-1).total, count);
  for (const e of events.filter((e) => e.type === 'listings')) {
    for (const l of e.listings) assert.equal('demoMatch' in l, false);
  }
});
