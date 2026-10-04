import {
  DEFAULT_FILTERS,
  SORTS,
  UNKNOWN_SIZE,
  applyFilters,
  compareSizes,
  conditionBucket,
  facetCounts,
  formatMoney,
  isSafeUrl,
  priceStats,
  sortListings,
  storeSearchLinks,
} from './results.js';

const $ = (selector, root = document) => root.querySelector(selector);

const els = {
  hero: $('#hero'),
  results: $('#results'),
  form: $('#searchForm'),
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  preview: $('#preview'),
  dzEmpty: $('.dz-empty'),
  dzFilled: $('.dz-filled'),
  urlInput: $('#urlInput'),
  hintInput: $('#hintInput'),
  searchButton: $('#searchButton'),
  formError: $('#formError'),
  setupNotice: $('#setupNotice'),
  demoBanner: $('#demoBanner'),
  queryImage: $('#queryImage'),
  itemEyebrow: $('#itemEyebrow'),
  itemName: $('#itemName'),
  itemMeta: $('#itemMeta'),
  itemNotice: $('#itemNotice'),
  steps: $('#steps'),
  newSearch: $('#newSearch'),
  stats: $('#stats'),
  filters: $('#filters'),
  minPrice: $('#minPrice'),
  maxPrice: $('#maxPrice'),
  showNoPrice: $('#showNoPrice'),
  sortSelect: $('#sortSelect'),
  activeFilters: $('#activeFilters'),
  grid: $('#grid'),
  emptyState: $('#emptyState'),
  hiddenNote: $('#hiddenNote'),
  moreSites: $('#moreSites'),
  moreSitesQuery: $('#moreSitesQuery'),
  moreSitesLinks: $('#moreSitesLinks'),
  sourceStatus: $('#sourceStatus'),
  cardTemplate: $('#cardTemplate'),
};

const FACETS = ['sizes', 'stores', 'conditions'];
const CONDITION_ORDER = ['New', 'Used', 'Unknown'];

const state = {
  features: null,
  image: null, // data URL of the prepared upload
  controller: null,
  started: false,
  done: false,
  demo: false,
  item: null,
  query: '',
  steps: new Map(),
  listings: new Map(),
  verdicts: {},
  filters: freshFilters(),
  sort: readSavedSort(),
};

function freshFilters() {
  return { ...DEFAULT_FILTERS, sizes: [], stores: [], conditions: [] };
}

function readSavedSort() {
  try {
    const saved = localStorage.getItem('scower:sort');
    return saved && SORTS[saved] ? saved : 'price_asc';
  } catch {
    return 'price_asc';
  }
}

function saveSort(sort) {
  try {
    localStorage.setItem('scower:sort', sort);
  } catch {
    // Storage can be unavailable (private mode); sorting still works.
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

// ---------------------------------------------------------------------------
// Picking a photo

async function prepareImage(file) {
  // Shrink big phone photos before upload; the server re-encodes anyway.
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.9);
}

function showPreview(src) {
  if (!src) {
    els.preview.removeAttribute('src');
    els.dzFilled.hidden = true;
    els.dzEmpty.hidden = false;
    els.dropzone.classList.remove('has-image');
    return;
  }
  els.preview.src = src;
  els.dzFilled.hidden = false;
  els.dzEmpty.hidden = true;
  els.dropzone.classList.add('has-image');
}

async function useFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showFormError("That file isn't an image.");
    return;
  }
  hideFormError();
  try {
    state.image = await prepareImage(file);
    els.urlInput.value = '';
    showPreview(state.image);
  } catch {
    showFormError("Couldn't read that image. Try a JPG or PNG.");
  }
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

function hideFormError() {
  els.formError.hidden = true;
}

// ---------------------------------------------------------------------------
// Running a search

function resetResults() {
  state.started = false;
  state.done = false;
  state.demo = false;
  state.item = null;
  state.query = '';
  state.steps = new Map();
  state.listings = new Map();
  state.verdicts = {};
  state.filters = freshFilters();
  cards.clear();
  menuSignatures.clear();
  els.minPrice.value = '';
  els.maxPrice.value = '';
  els.showNoPrice.checked = false;
  els.filters.querySelector('input[name="match"][value="close"]').checked = true;
  els.itemEyebrow.textContent = 'Looking at your photo…';
  els.itemName.textContent = 'Identifying item…';
  els.itemMeta.replaceChildren();
  els.itemNotice.hidden = true;
  els.steps.replaceChildren();
  els.moreSites.hidden = true;
  els.demoBanner.hidden = true;
}

function showResultsView(imageSrc) {
  els.hero.hidden = true;
  els.results.hidden = false;
  if (imageSrc) els.queryImage.src = imageSrc;
  else els.queryImage.removeAttribute('src');
  els.queryImage.hidden = !imageSrc;
  window.scrollTo({ top: 0 });
}

function showSearchView() {
  state.controller?.abort();
  els.results.hidden = true;
  els.hero.hidden = false;
  window.scrollTo({ top: 0 });
}

async function readEvents(response, onEvent) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

async function startSearch({ image, imageUrl, hint, previewSrc }) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  resetResults();
  setBusy(true);

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, imageUrl, hint }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Search failed (${response.status}).`);
    }
    showResultsView(previewSrc);
    render();
    await readEvents(response, handleEvent);
    if (!state.done) handleEvent({ type: 'error', message: 'The search stopped early. Try again.' });
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!state.started) {
      showSearchView();
      showFormError(err.message || 'Search failed. Try again.');
    } else {
      handleEvent({ type: 'error', message: err.message || 'Search failed.' });
    }
  } finally {
    if (state.controller === controller) setBusy(false);
  }
}

function setBusy(busy) {
  els.searchButton.disabled = busy;
  els.searchButton.classList.toggle('is-loading', busy);
  els.searchButton.querySelector('.btn-label').textContent = busy ? 'Searching…' : 'Find the lowest price';
}

function handleEvent(event) {
  switch (event.type) {
    case 'start':
      state.started = true;
      state.demo = Boolean(event.demo);
      els.demoBanner.hidden = !state.demo;
      if (state.demo && !els.queryImage.getAttribute('src')) {
        els.queryImage.src = '/demo/hoodie.svg';
        els.queryImage.hidden = false;
      }
      for (const { id, label } of event.steps) state.steps.set(id, { label, status: 'pending' });
      if (!state.steps.has('identify')) {
        els.itemEyebrow.textContent = 'Searching';
        els.itemName.textContent = 'Finding listings for your photo…';
      }
      renderSteps();
      break;
    case 'step': {
      const step = state.steps.get(event.id);
      if (step) Object.assign(step, { status: event.status, count: event.count, message: event.message });
      if (event.id === 'identify' && event.status === 'error') {
        els.itemEyebrow.textContent = 'Couldn’t identify the item';
        els.itemName.textContent = 'Showing photo matches instead';
      }
      renderSteps();
      break;
    }
    case 'item':
      state.item = event.item;
      if (event.item.wantedSize && !state.filters.sizes.length) state.filters.sizes = [event.item.wantedSize];
      renderItem();
      scheduleRender();
      break;
    case 'query':
      state.query = event.query;
      if (!state.item) {
        els.itemEyebrow.textContent = event.origin === 'hint' ? 'Searching for' : 'Closest match';
        els.itemName.textContent = event.query;
      }
      renderMoreSites();
      break;
    case 'listings':
      for (const listing of event.listings) state.listings.set(listing.id, listing);
      scheduleRender();
      break;
    case 'matches':
      state.verdicts = { ...state.verdicts, ...event.verdicts };
      scheduleRender();
      break;
    case 'done':
      state.done = true;
      for (const step of state.steps.values()) if (step.status === 'running' || step.status === 'pending') step.status = 'skipped';
      renderSteps();
      render();
      break;
    case 'error':
      state.done = true;
      els.itemNotice.textContent = event.message;
      els.itemNotice.hidden = false;
      els.itemNotice.classList.add('is-error');
      render();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Rendering

function renderItem() {
  const item = state.item;
  if (!item) return;
  const name = [item.brand, item.name].filter(Boolean).join(' ') || item.query || 'Unknown item';
  els.itemEyebrow.textContent = item.confidence === 'low' ? 'Best guess' : 'Looks like';
  els.itemName.textContent = name;
  const chips = [item.colorway, item.season, item.category].filter(Boolean).map((text) => el('span', { class: 'chip', text }));
  if (item.confidence) {
    const label = `${item.confidence[0].toUpperCase()}${item.confidence.slice(1)} confidence`;
    chips.push(el('span', { class: `chip chip-confidence is-${item.confidence}`, text: label }));
  }
  els.itemMeta.replaceChildren(...chips);
  if (!item.isFashionItem) {
    els.itemNotice.textContent = "This photo doesn't look like clothing, so results may be off. A clear photo of the item works best.";
    els.itemNotice.hidden = false;
  }
}

const STEP_ICONS = { pending: '', running: '', done: '✓', error: '!', skipped: '–' };

function renderSteps() {
  const items = [...state.steps.entries()].map(([id, step]) => {
    let detail = '';
    if (step.status === 'done' && step.count != null) {
      detail = id === 'match' ? `${step.count} exact` : `${step.count}`;
    }
    const li = el(
      'li',
      { class: `step is-${step.status}`, title: step.message || null },
      el('span', { class: 'step-icon', 'aria-hidden': 'true', text: STEP_ICONS[step.status] }),
      el('span', { class: 'step-label', text: step.label }),
      detail ? el('span', { class: 'step-count', text: detail }) : null,
    );
    li.setAttribute('aria-label', `${step.label}: ${step.status}${step.message ? ` (${step.message})` : ''}`);
    return li;
  });
  els.steps.replaceChildren(...items);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const all = [...state.listings.values()];
  const visible = applyFilters(all, state.verdicts, state.filters);
  const sorted = sortListings(visible, state.verdicts, state.sort);
  renderStats(visible);
  renderFacetMenus(all);
  renderActiveFilters();
  renderGrid(sorted, all);
  renderHiddenNote(all, visible);
}

function renderStats(visible) {
  const stats = priceStats(visible);
  const parts = [];
  if (!state.done) parts.push(el('span', { class: 'stat stat-live' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Searching'));
  parts.push(el('span', { class: 'stat' }, el('b', { text: String(visible.length) }), visible.length === 1 ? ' listing' : ' listings'));
  if (stats.count) {
    parts.push(
      el('span', { class: 'stat stat-low' }, 'Lowest ', el('b', { text: formatMoney(stats.min) })),
      el('span', { class: 'stat' }, 'Median ', el('b', { text: formatMoney(Math.round(stats.median)) })),
      el('span', { class: 'stat' }, 'Highest ', el('b', { text: formatMoney(stats.max) })),
    );
  }
  els.stats.replaceChildren(...parts);
}

const menuSignatures = new Map();

function renderFacetMenus(all) {
  for (const facet of FACETS) {
    const counts = facetCounts(all, state.verdicts, state.filters, facet);
    let entries = [...counts.entries()];
    if (facet === 'sizes') {
      entries.sort(([a], [b]) => (a === UNKNOWN_SIZE) - (b === UNKNOWN_SIZE) || compareSizes(a, b));
    } else if (facet === 'conditions') {
      entries.sort(([a], [b]) => CONDITION_ORDER.indexOf(a) - CONDITION_ORDER.indexOf(b));
    } else {
      entries.sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    }
    const selected = new Set(state.filters[facet]);
    const signature = JSON.stringify([entries, [...selected]]);
    const menu = els.filters.querySelector(`[data-menu="${facet}"]`);
    const summary = menu.parentElement.querySelector('summary');
    summary.dataset.count = selected.size || '';
    if (menuSignatures.get(facet) === signature) continue;
    menuSignatures.set(facet, signature);
    menu.replaceChildren(
      ...(entries.length
        ? entries.map(([value, count]) =>
            el(
              'label',
              { class: 'option' },
              el('input', { type: 'checkbox', value, checked: selected.has(value), 'data-facet': facet }),
              el('span', { text: facet === 'conditions' && value === 'Unknown' ? 'Not stated' : value }),
              el('span', { class: 'option-count', text: String(count) }),
            ),
          )
        : [el('p', { class: 'menu-empty', text: 'Nothing yet' })]),
    );
  }
  const priceSummary = els.filters.querySelector('[data-facet="price"] summary');
  priceSummary.dataset.count = state.filters.minPrice != null || state.filters.maxPrice != null ? '1' : '';
  const matchSummary = els.filters.querySelector('[data-facet="match"] summary');
  matchSummary.dataset.count = state.filters.match === 'close' ? '' : '1';
  const hasVerdicts = Object.keys(state.verdicts).length > 0;
  const exactOption = els.filters.querySelector('input[name="match"][value="exact"]');
  exactOption.disabled = !hasVerdicts;
  exactOption.closest('label').title = hasVerdicts ? '' : 'Available once listings have been checked';
}

function renderActiveFilters() {
  const f = state.filters;
  const chips = [];
  const chip = (label, onRemove) =>
    el('button', { type: 'button', class: 'filter-chip', onclick: onRemove, 'aria-label': `Remove filter ${label}` }, label, el('span', { 'aria-hidden': 'true', text: '×' }));

  for (const size of f.sizes) chips.push(chip(size === UNKNOWN_SIZE ? 'Size not listed' : `Size ${size}`, () => toggleFacet('sizes', size, false)));
  for (const store of f.stores) chips.push(chip(store, () => toggleFacet('stores', store, false)));
  for (const condition of f.conditions) chips.push(chip(condition === 'Unknown' ? 'Condition not stated' : condition, () => toggleFacet('conditions', condition, false)));
  if (f.minPrice != null || f.maxPrice != null) {
    const label = f.minPrice != null && f.maxPrice != null
      ? `${formatMoney(f.minPrice)}–${formatMoney(f.maxPrice)}`
      : f.minPrice != null ? `Over ${formatMoney(f.minPrice)}` : `Under ${formatMoney(f.maxPrice)}`;
    chips.push(chip(label, () => {
      f.minPrice = f.maxPrice = null;
      els.minPrice.value = els.maxPrice.value = '';
      render();
    }));
  }
  if (f.match === 'exact') chips.push(chip('Exact matches only', () => setMatch('close')));
  if (f.match === 'all') chips.push(chip('Everything found', () => setMatch('close')));
  if (f.showNoPrice) chips.push(chip('Including no-price listings', () => setShowNoPrice(false)));

  if (chips.length) {
    chips.push(el('button', { type: 'button', class: 'link-btn', text: 'Clear all', onclick: clearFilters }));
  }
  els.activeFilters.replaceChildren(...chips);
}

const cards = new Map();

function renderGrid(sorted, all) {
  if (!sorted.length) {
    if (!state.done && !all.length) {
      els.grid.replaceChildren(...Array.from({ length: 10 }, () => skeletonCard()));
      els.emptyState.hidden = true;
      return;
    }
    els.grid.replaceChildren();
    renderEmptyState(all);
    return;
  }
  els.emptyState.hidden = true;

  const lowestId = cheapestId(sorted);
  // When the cheapest listing isn't the exact item, also flag the cheapest one that is.
  const lowestExactId = state.verdicts[lowestId] === 'exact' ? null : cheapestId(sorted.filter((l) => state.verdicts[l.id] === 'exact'));

  const nodes = sorted.map((listing) => {
    const verdict = state.verdicts[listing.id] ?? null;
    const highlight = listing.id === lowestId ? 'lowest' : listing.id === lowestExactId ? 'lowest-exact' : null;
    const key = JSON.stringify([listing, verdict, highlight]);
    let entry = cards.get(listing.id);
    if (!entry || entry.key !== key) {
      entry = { key, node: buildCard(listing, verdict, highlight) };
      cards.set(listing.id, entry);
    }
    return entry.node;
  });
  els.grid.replaceChildren(...nodes);
}

function cheapestId(listings) {
  let best = null;
  for (const l of listings) {
    if (l.priceUsd != null && (best == null || l.priceUsd < best.priceUsd)) best = l;
  }
  return best?.id ?? null;
}

function skeletonCard() {
  return el('div', { class: 'card card-skeleton', 'aria-hidden': 'true' }, el('div', { class: 'thumb' }), el('div', { class: 'card-body' }, el('div', { class: 'sk-line' }), el('div', { class: 'sk-line sk-short' })));
}

function placeholderThumb(label) {
  return el('div', { class: 'thumb-placeholder', 'aria-hidden': 'true' }, el('span', { text: label }));
}

function buildCard(listing, verdict, highlight) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  node.href = isSafeUrl(listing.url) ? listing.url : '#';
  node.title = `${listing.title}\nOpens ${listing.store} in a new tab`;

  const img = $('img', node);
  if (listing.image && isSafeUrl(listing.image)) {
    img.src = listing.image;
    img.alt = listing.title;
    img.addEventListener('error', () => img.replaceWith(placeholderThumb(listing.store)), { once: true });
  } else {
    img.replaceWith(placeholderThumb(listing.store));
  }

  const badges = $('.badges', node);
  if (highlight === 'lowest') badges.append(el('span', { class: 'badge badge-low', text: 'Lowest price' }));
  if (highlight === 'lowest-exact') badges.append(el('span', { class: 'badge badge-low', text: 'Cheapest exact match' }));
  if (verdict === 'exact' && highlight !== 'lowest-exact') badges.append(el('span', { class: 'badge badge-exact', text: 'Exact match' }));
  else if (verdict === 'similar') badges.append(el('span', { class: 'badge badge-similar', text: 'Similar' }));
  else if (verdict === 'different') badges.append(el('span', { class: 'badge badge-different', text: 'Different item?' }));
  if (listing.buyingFormat === 'Auction') badges.append(el('span', { class: 'badge', text: 'Auction' }));

  const condition = conditionBucket(listing.condition);
  $('.card-store', node).append(el('span', { class: 'store-name', text: listing.store }));
  if (condition !== 'Unknown') {
    $('.card-store', node).append(el('span', { class: 'store-condition', text: ` · ${condition}` }));
  }
  $('.card-title', node).textContent = listing.title;
  const size = $('.card-size', node);
  size.textContent = listing.size ? `Size ${listing.size}` : 'Size not listed';
  size.classList.toggle('is-unknown', !listing.size);

  const price = $('.price', node);
  if (listing.price != null) {
    price.textContent = formatMoney(listing.price, listing.currency);
    if (listing.currency !== 'USD' && listing.priceUsd != null) {
      price.append(el('span', { class: 'approx', text: ` ≈ ${formatMoney(Math.round(listing.priceUsd))}` }));
    }
  } else {
    price.textContent = 'See price';
    price.classList.add('is-missing');
  }
  const ship = $('.ship', node);
  if (listing.shipping === 0) ship.textContent = 'Free shipping';
  else if (listing.shipping > 0) ship.textContent = `+ ${formatMoney(listing.shipping, listing.currency)} shipping`;
  return node;
}

function renderEmptyState(all) {
  const children = [];
  const hasListingSources = [...state.steps.keys()].some((id) => id !== 'identify' && id !== 'match');
  if (!all.length && !hasListingSources && !state.demo) {
    children.push(
      el('h3', { text: 'No listing sources connected yet' }),
      el('p', { text: 'Add a SerpApi or eBay key (see the README) to see listings here. Meanwhile, the buttons below search each site for this item.' }),
    );
  } else if (!all.length) {
    children.push(
      el('h3', { text: 'No listings found' }),
      el('p', { text: 'Try a clearer photo of just the item, or add its name in the note box (for example “Supreme NYC Collage Zip Up Hoodie”).' }),
    );
  } else {
    children.push(
      el('h3', { text: 'Nothing matches these filters' }),
      el('p', { text: `${all.length} listings were found, but your filters hide all of them.` }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Clear filters', onclick: clearFilters }),
    );
  }
  els.emptyState.replaceChildren(...children);
  els.emptyState.hidden = false;
}

function renderHiddenNote(all, visible) {
  const f = state.filters;
  // Only count listings that the size/store/price filters would otherwise show.
  const pool = applyFilters(all, state.verdicts, { ...f, match: 'all', showNoPrice: true });
  const different = f.match !== 'all' ? pool.filter((l) => state.verdicts[l.id] === 'different').length : 0;
  const noPrice = !f.showNoPrice ? pool.filter((l) => l.price == null && state.verdicts[l.id] !== 'different').length : 0;
  const parts = [];
  if (different) parts.push(`${different} looked like a different item`);
  if (noPrice) parts.push(`${noPrice} didn't show a price`);
  if (!parts.length || !state.done || !visible.length) {
    els.hiddenNote.hidden = true;
    return;
  }
  els.hiddenNote.replaceChildren(
    `Also hidden: ${parts.join(', and ')}. `,
    el('button', {
      type: 'button',
      class: 'link-btn',
      text: 'Show them',
      onclick: () => {
        if (different) setMatch('all');
        if (noPrice) setShowNoPrice(true);
      },
    }),
  );
  els.hiddenNote.hidden = false;
}

function renderMoreSites() {
  if (!state.query) return;
  els.moreSitesQuery.textContent = state.query;
  els.moreSitesLinks.replaceChildren(
    ...storeSearchLinks(state.query).map(({ name, url }) =>
      el('a', { class: 'site-link', href: url, target: '_blank', rel: 'noopener noreferrer', text: name }),
    ),
  );
  els.moreSites.hidden = false;
}

// ---------------------------------------------------------------------------
// Filter actions

function toggleFacet(facet, value, on) {
  const set = new Set(state.filters[facet]);
  if (on) set.add(value);
  else set.delete(value);
  state.filters[facet] = [...set];
  render();
}

function setMatch(value) {
  state.filters.match = value;
  const radio = els.filters.querySelector(`input[name="match"][value="${value}"]`);
  if (radio) radio.checked = true;
  render();
}

function setShowNoPrice(on) {
  state.filters.showNoPrice = on;
  els.showNoPrice.checked = on;
  render();
}

function clearFilters() {
  state.filters = freshFilters();
  els.minPrice.value = '';
  els.maxPrice.value = '';
  els.showNoPrice.checked = false;
  els.filters.querySelector('input[name="match"][value="close"]').checked = true;
  render();
}

function readPriceInput(input) {
  if (input.value === '') return null;
  const value = Number(input.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Setup & wiring

function renderSourceStatus(features) {
  const items = [
    ['AI identification', features.identify],
    ['Google Lens', features.googleLens],
    ['Google Shopping', features.googleShopping],
    ['eBay', features.ebay],
  ];
  els.sourceStatus.replaceChildren(
    'Sources: ',
    ...items.flatMap(([label, on], i) => [
      i ? ' · ' : '',
      el('span', { class: on ? 'is-on' : 'is-off', title: on ? 'Connected' : 'Not configured', text: `${label} ${on ? '●' : '○'}` }),
    ]),
  );
  if (features.demo) els.sourceStatus.textContent = 'Running in demo mode with sample data.';
}

async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const { features } = await response.json();
    state.features = features;
    renderSourceStatus(features);
    const anySource = features.identify || features.googleLens || features.ebay;
    els.setupNotice.hidden = anySource || features.demo;
  } catch {
    // The page still works; the server will report problems on search.
  }
}

function closeOtherDropdowns(except) {
  for (const details of els.filters.querySelectorAll('details[open]')) {
    if (details !== except) details.open = false;
  }
}

function wire() {
  els.sortSelect.replaceChildren(...Object.entries(SORTS).map(([value, label]) => el('option', { value, text: label })));
  els.sortSelect.value = state.sort;
  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    saveSort(state.sort);
    render();
  });

  els.fileInput.addEventListener('change', () => {
    useFile(els.fileInput.files[0]);
    els.fileInput.value = '';
  });
  els.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  els.urlInput.addEventListener('input', () => {
    hideFormError();
    const url = els.urlInput.value.trim();
    if (/^https?:\/\/\S+$/i.test(url)) {
      state.image = null;
      showPreview(url);
    } else if (!state.image) {
      showPreview(null);
    }
  });
  els.preview.addEventListener('error', () => {
    // Some sites block hotlinking; the server can usually still fetch the image.
    if (!state.image) els.dropzone.classList.add('preview-failed');
  });
  els.preview.addEventListener('load', () => els.dropzone.classList.remove('preview-failed'));

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      if (els.hero.hidden) showSearchView();
      useFile(file);
    }
  });

  // Paste an image (or an image link) from the clipboard.
  document.addEventListener('paste', (event) => {
    const target = event.target;
    const typingInField = target instanceof HTMLInputElement && target !== els.urlInput;
    const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      if (els.hero.hidden) showSearchView();
      useFile(file);
      return;
    }
    const text = event.clipboardData?.getData('text')?.trim();
    if (!typingInField && target !== els.urlInput && text && /^https?:\/\/\S+$/i.test(text)) {
      event.preventDefault();
      if (els.hero.hidden) showSearchView();
      els.urlInput.value = text;
      els.urlInput.dispatchEvent(new Event('input'));
    }
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideFormError();
    const imageUrl = els.urlInput.value.trim();
    const hint = els.hintInput.value.trim();
    if (!state.image && !imageUrl && !state.features?.demo) {
      showFormError('Add a photo or paste an image link first.');
      return;
    }
    if (!state.image && imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
      showFormError('Image links should start with https://');
      return;
    }
    startSearch({
      image: state.image || undefined,
      imageUrl: state.image ? undefined : imageUrl || undefined,
      hint,
      previewSrc: state.image || imageUrl || null,
    });
  });

  els.newSearch.addEventListener('click', () => {
    showSearchView();
    setBusy(false);
  });

  // Filters
  els.filters.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.facet) toggleFacet(input.dataset.facet, input.value, input.checked);
    else if (input.name === 'match') setMatch(input.value);
    else if (input === els.showNoPrice) setShowNoPrice(input.checked);
    else if (input === els.minPrice || input === els.maxPrice) {
      state.filters.minPrice = readPriceInput(els.minPrice);
      state.filters.maxPrice = readPriceInput(els.maxPrice);
      render();
    }
  });
  for (const details of els.filters.querySelectorAll('details')) {
    details.addEventListener('toggle', () => {
      if (details.open) closeOtherDropdowns(details);
    });
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) closeOtherDropdowns(null);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOtherDropdowns(null);
  });
}

wire();
loadStatus();
