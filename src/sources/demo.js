// Sample data for `npm run demo`, so the interface can be tried without any API
// keys. Every listing links to that store's search page, not a real listing.

import { makeListing } from '../normalize.js';

export const DEMO_ITEM = {
  isFashionItem: true,
  brand: 'Supreme',
  name: 'NYC Collage Zip Up Hooded Sweatshirt',
  category: 'Hoodie',
  colorway: 'Black',
  season: 'FW24',
  query: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black',
  altQueries: ['Supreme NYC Collage Zip Up Hoodie'],
  keyDetails: ['all-over NYC collage print', 'full zip', 'red box logo tab on hood'],
  confidence: 'high',
  wantedSize: '',
  demo: true,
};

const q = encodeURIComponent(DEMO_ITEM.query);
const SEARCH_PAGES = {
  eBay: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sop=15`,
  Grailed: `https://www.grailed.com/shop?query=${q}`,
  StockX: `https://stockx.com/search?s=${q}`,
  GOAT: `https://www.goat.com/search?query=${q}`,
  Depop: `https://www.depop.com/search/?q=${q}`,
  Poshmark: `https://poshmark.com/search?query=${q}`,
  Mercari: `https://www.mercari.com/search/?keyword=${q}`,
};

// [store, title, price, shipping, condition, source, foundVia, match]
const ROWS = [
  ['Grailed', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size L', 168, 15, 'Used', 'google_lens', 'visual', 'exact'],
  ['eBay', 'Supreme NYC Collage Zip Up Hoodie Black FW24 Size Medium NWT', 189.99, 0, 'New with tags', 'ebay', 'visual', 'exact'],
  ['StockX', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black', 214, 14.95, 'New', 'google_lens', 'visual', 'exact'],
  ['Depop', 'supreme collage zip hoodie black XL worn twice', 155, 8, 'Used', 'google_lens', 'visual', 'exact'],
  ['GOAT', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size S', 231, 12, 'New', 'google_lens', 'visual', 'exact'],
  ['eBay', 'SUPREME NYC COLLAGE ZIP UP HOODED SWEATSHIRT BLACK SZ XXL DS', 205, 9.5, 'New with tags', 'ebay', 'keyword', 'exact'],
  ['Poshmark', 'Supreme Collage Zip Up Hoodie Mens Large Black', 175, 7.97, 'Used', 'google_lens', 'visual', 'exact'],
  ['Mercari', 'Supreme NYC Collage Zip-Up Hoodie Black M', 149, null, 'Used', 'google_lens', 'visual', 'exact'],
  ['eBay', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Navy Size L', 182, 0, 'New with tags', 'ebay', 'keyword', 'similar'],
  ['Grailed', 'Supreme Collage Hooded Sweatshirt (pullover) Black XL', 140, 12, 'Used', 'google_lens', 'visual', 'similar'],
  ['eBay', 'Supreme Box Logo Hoodie Black Large', 420, 0, 'Pre-owned', 'ebay', 'keyword', 'different'],
  ['Depop', 'Collage graffiti print zip hoodie black (inspired)', 38, 6, 'New', 'google_lens', 'visual', 'different'],
  ['StockX', 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black Size XL', 226, 14.95, 'New', 'google_shopping', 'keyword', 'exact'],
  ['Grailed', 'Supreme NYC Collage Zip Up — Black — M', null, null, null, 'google_lens', 'visual', 'exact'],
];

export function demoListings() {
  return ROWS.map(([store, title, price, shipping, condition, source, foundVia, match], i) => {
    const listing = makeListing({
      url: `${SEARCH_PAGES[store]}&demo_listing=${i + 1}`,
      title,
      price: price == null ? null : { value: price, currency: 'USD' },
      shipping: shipping == null ? null : { value: shipping, currency: 'USD' },
      condition,
      store,
      source,
      foundVia,
    });
    listing.image = `/demo/hoodie.svg`;
    listing.demoMatch = match;
    return listing;
  });
}
