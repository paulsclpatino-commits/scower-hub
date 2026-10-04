// Runs one search: identifies the item, queries every configured source in
// parallel, merges duplicate listings and streams events back as they happen.
//
// Events (one JSON object per line on the wire):
//   start    { steps: [{ id, label }], demo }
//   step     { id, status: 'running' | 'done' | 'error' | 'skipped', count?, message? }
//   item     { item }                       what the AI thinks the photo shows
//   query    { query, origin }              text used for keyword searches
//   listings { listings: [...] }            new or updated listings (upsert by id)
//   matches  { verdicts: { id: 'exact' | 'similar' | 'different' }, method }
//   done     { total, elapsedMs, cached }

import { createHash } from 'node:crypto';
import { identifyItem, classifyListings, heuristicMatches } from './ai.js';
import { config, enabledFeatures } from './config.js';
import { combineSignals, describeError } from './http.js';
import { extractSize, mergeListings } from './normalize.js';
import { searchEbayByImage, searchEbayByKeyword } from './sources/ebay.js';
import { searchGoogleLens, searchGoogleShopping } from './sources/serpapi.js';
import { DEMO_ITEM, demoListings } from './sources/demo.js';

export const defaultDeps = {
  identifyItem,
  classifyListings,
  searchGoogleLens,
  searchGoogleShopping,
  searchEbayByImage,
  searchEbayByKeyword,
};

export const STEP_LABELS = {
  identify: 'Identify item',
  google_lens: 'Google Lens',
  ebay_image: 'eBay photo match',
  ebay_keyword: 'eBay',
  google_shopping: 'Google Shopping',
  match: 'Match check',
};

const AI_TIMEOUT_MS = 90_000;

export async function runSearch(input, { emit, signal, features = enabledFeatures(), deps = defaultDeps, getImageUrl }) {
  const startedAt = Date.now();
  const { jpeg, hint } = input;
  const timeoutMs = config.sourceTimeoutMs;

  const stepIds = [];
  if (features.identify) stepIds.push('identify');
  if (features.googleLens) stepIds.push('google_lens');
  if (features.ebay) stepIds.push('ebay_image', 'ebay_keyword');
  if (features.googleShopping) stepIds.push('google_shopping');
  const hasListingSources = stepIds.some((id) => id !== 'identify');
  if (features.identify && hasListingSources) stepIds.push('match');
  emit({ type: 'start', steps: stepIds.map((id) => ({ id, label: STEP_LABELS[id] })), demo: false });

  const listings = new Map();
  function addListings(items) {
    const changed = new Map();
    for (const item of items) {
      const previous = listings.get(item.id);
      const next = previous ? mergeListings(previous, item) : item;
      listings.set(item.id, next);
      changed.set(item.id, next);
    }
    if (changed.size) emit({ type: 'listings', listings: [...changed.values()] });
    return changed.size;
  }

  // Runs one step, reporting its progress. Never throws (unless the whole
  // search was cancelled); returns the step's value or null.
  async function step(id, fn) {
    emit({ type: 'step', id, status: 'running' });
    try {
      const { value = null, count, skipped } = (await fn()) || {};
      if (skipped) emit({ type: 'step', id, status: 'skipped', message: skipped });
      else emit({ type: 'step', id, status: 'done', ...(count != null && { count }) });
      return value;
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`[search] ${id} failed:`, describeError(err));
      emit({ type: 'step', id, status: 'error', message: describeError(err) });
      return null;
    }
  }

  const identified = features.identify
    ? step('identify', async () => {
        const item = await deps.identifyItem({ jpeg, hint, signal: combineSignals(signal, AI_TIMEOUT_MS) });
        emit({ type: 'item', item });
        return { value: item };
      })
    : Promise.resolve(null);

  const lens = features.googleLens
    ? step('google_lens', async () => {
        const imageUrl = await getImageUrl();
        if (!imageUrl) return { skipped: 'Needs a public link to the photo (see PUBLIC_URL in the README)' };
        const result = await deps.searchGoogleLens({ imageUrl, signal, timeoutMs });
        return { value: result.queryHint, count: addListings(result.listings) };
      })
    : Promise.resolve(null);

  const ebayImage = features.ebay
    ? step('ebay_image', async () => ({ count: addListings(await deps.searchEbayByImage({ jpeg, signal, timeoutMs })) }))
    : Promise.resolve(null);

  const queryPromise = (async () => {
    const item = await identified;
    let query = item?.query || '';
    let origin = 'ai';
    if (!query && hint) [query, origin] = [hint, 'hint'];
    if (!query) [query, origin] = [(await lens) || '', 'lens'];
    if (query) emit({ type: 'query', query, origin });
    return { query, item };
  })();
  // Rejects only when the search is cancelled; the steps below surface that.
  queryPromise.catch(() => {});

  const ebayKeyword = features.ebay
    ? step('ebay_keyword', async () => {
        const { query, item } = await queryPromise;
        if (!query) return { skipped: 'No item name to search for' };
        let items = await deps.searchEbayByKeyword({ query, signal, timeoutMs });
        const fallback = item?.altQueries?.[0];
        if (items.length < 5 && fallback) {
          items = items.concat(await deps.searchEbayByKeyword({ query: fallback, signal, timeoutMs }));
        }
        return { count: addListings(items) };
      })
    : Promise.resolve(null);

  const shopping = features.googleShopping
    ? step('google_shopping', async () => {
        const { query } = await queryPromise;
        if (!query) return { skipped: 'No item name to search for' };
        return { count: addListings(await deps.searchGoogleShopping({ query, signal, timeoutMs })) };
      })
    : Promise.resolve(null);

  await Promise.all([identified, lens, ebayImage, ebayKeyword, shopping]);
  const { query, item } = await queryPromise;

  let matched = false;
  if (stepIds.includes('match')) {
    await step('match', async () => {
      if (!listings.size) return { skipped: 'No listings to check' };
      if (!item) return { skipped: 'Item was not identified' };
      // Check priced listings first; they're the ones that end up on screen.
      const ordered = [...listings.values()].sort((a, b) => (a.price == null) - (b.price == null));
      const verdicts = await deps.classifyListings({ item, listings: ordered, signal: combineSignals(signal, AI_TIMEOUT_MS) });
      emit({ type: 'matches', verdicts, method: 'ai' });
      matched = true;
      return { count: Object.values(verdicts).filter((v) => v === 'exact').length };
    });
  }
  if (!matched && query && listings.size) {
    const verdicts = heuristicMatches(query, [...listings.values()]);
    // Titles from an image match often skip the product name; don't hide them
    // on a keyword miss.
    for (const [id, verdict] of Object.entries(verdicts)) {
      if (verdict === 'different' && listings.get(id).foundVia === 'visual') delete verdicts[id];
    }
    emit({ type: 'matches', verdicts, method: 'keywords' });
  }

  emit({ type: 'done', total: listings.size, elapsedMs: Date.now() - startedAt, cached: false });
}

// ---------------------------------------------------------------------------
// Demo mode

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export async function runDemoSearch({ emit, signal, hint = '', speed = 1 }) {
  const startedAt = Date.now();
  const wait = (ms) => sleep(ms * speed, signal);
  const ids = ['identify', 'google_lens', 'ebay_image', 'ebay_keyword', 'google_shopping', 'match'];
  emit({ type: 'start', steps: ids.map((id) => ({ id, label: STEP_LABELS[id] })), demo: true });
  for (const id of ids.slice(0, 3)) emit({ type: 'step', id, status: 'running' });

  const all = demoListings();
  const bySource = (pred) => all.filter(pred);

  await wait(700);
  emit({ type: 'item', item: { ...DEMO_ITEM, wantedSize: extractSize(hint) || '' } });
  emit({ type: 'step', id: 'identify', status: 'done' });
  emit({ type: 'query', query: DEMO_ITEM.query, origin: 'ai' });
  emit({ type: 'step', id: 'ebay_keyword', status: 'running' });
  emit({ type: 'step', id: 'google_shopping', status: 'running' });

  const batches = [
    ['ebay_image', bySource((l) => l.sources[0] === 'ebay' && l.foundVia === 'visual'), 400],
    ['google_lens', bySource((l) => l.sources[0] === 'google_lens'), 500],
    ['ebay_keyword', bySource((l) => l.sources[0] === 'ebay' && l.foundVia === 'keyword'), 400],
    ['google_shopping', bySource((l) => l.sources[0] === 'google_shopping'), 300],
  ];
  for (const [id, listings, delay] of batches) {
    await wait(delay);
    emit({ type: 'listings', listings: listings.map(({ demoMatch, ...l }) => l) });
    emit({ type: 'step', id, status: 'done', count: listings.length });
  }

  emit({ type: 'step', id: 'match', status: 'running' });
  await wait(600);
  const verdicts = Object.fromEntries(all.map((l) => [l.id, l.demoMatch]));
  emit({ type: 'matches', verdicts, method: 'ai' });
  emit({ type: 'step', id: 'match', status: 'done', count: all.filter((l) => l.demoMatch === 'exact').length });
  emit({ type: 'done', total: all.length, elapsedMs: Date.now() - startedAt, cached: false });
}

// ---------------------------------------------------------------------------
// Cache: the same photo + note within 30 minutes replays the previous result
// instead of spending API credits again.

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

export function cacheKey(jpeg, hint) {
  return createHash('sha256').update(jpeg).update('\0').update(hint || '').digest('hex');
}

export function clearSearchCache() {
  cache.clear();
}

export async function cachedSearch(input, options) {
  const key = cacheKey(input.jpeg, input.hint);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    for (const event of hit.events) {
      options.emit(event.type === 'done' ? { ...event, cached: true } : event);
    }
    return;
  }
  const events = [];
  let anySucceeded = false;
  await runSearch(input, {
    ...options,
    emit(event) {
      events.push(event);
      if (event.type === 'step' && event.status === 'done' && event.id !== 'identify') anySucceeded = true;
      options.emit(event);
    },
  });
  if (anySucceeded && !options.signal?.aborted) {
    cache.set(key, { events, expires: Date.now() + CACHE_TTL_MS });
    while (cache.size > 100) cache.delete(cache.keys().next().value);
  }
}
