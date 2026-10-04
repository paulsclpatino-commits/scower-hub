# Scower

Drop in a photo of a piece of clothing and Scower finds that exact item for sale across the internet. It lists every listing from cheapest to most expensive, with sizes, and each result links straight to the listing.

- **Upload, drag in, or paste** a photo (Ctrl/⌘+V), or paste an image link
- **AI identification** names the exact product, e.g. *Supreme NYC Collage Zip Up Hooded Sweatshirt, Black, FW24*
- **Searches several sources at once**: Google Lens reverse-image search (covers Grailed, StockX, GOAT, Depop, Poshmark, Mercari, brand stores and more), Google Shopping, and eBay (photo match and keyword search)
- **Cheapest first**, with sizes read from each listing, shipping costs where the store gives them, and a "Lowest price" badge
- **Filters** for size, price range, store, condition, and exact match vs. similar items
- **Match check**: AI marks each listing as an exact match, a similar item, or a different item (replicas, other colorways, lots), and hides the different ones by default
- Results **stream in** as each source answers, and repeat searches of the same photo are cached for 30 minutes

## Try it in 1 minute (no keys needed)

You need [Node.js](https://nodejs.org) 20.3 or newer.

```bash
npm install
npm run demo
```

Open http://localhost:3000 and click **Find the lowest price**. Demo mode returns sample listings so you can see how the site works. Demo links open store search pages, not real listings.

## Real searches

1. Copy the example settings file:
   ```bash
   cp .env.example .env
   ```
2. Add the keys you have to `.env`. Each one is optional, but more keys means better results:

   | Key | What it adds | Where to get it |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | Identifies the exact item and checks which listings really match | [console.anthropic.com](https://console.anthropic.com) |
   | `SERPAPI_KEY` | Google Lens + Google Shopping, the widest coverage | [serpapi.com](https://serpapi.com) (has a free tier) |
   | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` | eBay photo search + keyword search | [developer.ebay.com](https://developer.ebay.com): create a **Production** keyset |

   Recommended setup: all three. With only `SERPAPI_KEY` you still get Google Lens results. With only `ANTHROPIC_API_KEY` the item is identified, and you get links to search each resale site.
3. Start the server:
   ```bash
   npm start
   ```
4. Open http://localhost:3000.

**Cost per search:** 3 SerpApi searches (2 Lens + 1 Shopping), 2 Claude requests, and a few eBay API calls, which are free within eBay's daily limits.

### About Google Lens and your photo

Google Lens can only search a photo it can download from a public link:

- **Deployed online** (Render, Railway, Fly.io, etc.): the site serves the photo itself for 15 minutes. Nothing to configure.
- **Running on your computer**: the photo is uploaded to [litterbox.catbox.moe](https://litterbox.catbox.moe), a temporary host that deletes files after 1 hour. Set `TEMP_IMAGE_HOST=off` to turn this off. Lens is then skipped for uploaded photos, but pasted image links still work.

## Put it online

Any Node host works. For example, on [Render](https://render.com):

1. Push this repo to GitHub, then create a **Web Service** from it on Render.
2. Build command: `npm install`. Start command: `npm start`.
3. Add your keys under **Environment**.

The site works out its own public address from the request. If photo search via Lens doesn't work, set `PUBLIC_URL` to your site's address (e.g. `https://scower.onrender.com`).

A public site spends your API credits on every visitor's search. A built-in limit allows 30 searches per visitor per 10 minutes; change it with `SEARCH_RATE_LIMIT`.

## How it works

```
photo ──► normalize (upright JPEG, ≤1280px)
            │
            ├──► Claude: what is this? ──► keyword query ──► eBay keyword search
            │                                             └─► Google Shopping
            ├──► Google Lens (via SerpApi): visual + product matches
            └──► eBay search-by-image
                                   │
            all listings ◄─────────┘  merged by URL (same eBay item from two sources = one card)
                 │
                 └──► Claude: exact / similar / different? ──► browser sorts & filters
```

The server streams progress to the browser as newline-delimited JSON, so listings appear while slower sources are still running. If one source fails, the others still return results, and the failed source shows a red chip with the reason.

Sizes come from listing titles ("Size L", "Sz XL", "Mens Large", "32x30", ...). When a seller leaves the size out of the title, the card says **Size not listed**.

## Limitations

- **Prices change.** Listings come from each store's search results at that moment and can be out of date, especially Google's copies. Always check the listing.
- **Coverage depends on Google and eBay.** Sites without a public API (Grailed, Depop, StockX, ...) are found through Google Lens and Google Shopping. If Google hasn't indexed a listing, Scower won't see it. The **Check these sites too** buttons open each site's own search for the identified item.
- **Mixed currencies** are sorted using rough built-in exchange rates and marked with "≈".

## Development

```bash
npm run dev   # restarts on file changes
npm test      # unit + integration tests (no network needed)
```

```
server.js              Express app: /api/search (NDJSON stream), /api/status, /img/:id
src/search.js          runs one search: sources in parallel, merging, match check, cache, demo
src/ai.js              Claude: identify the item, classify listings
src/sources/serpapi.js Google Lens + Google Shopping
src/sources/ebay.js    eBay Browse API (search by image, keyword search)
src/normalize.js       prices, currencies, sizes, store names, URL de-duplication
src/images.js          upload/link handling, private-network protection, public photo URLs
public/                the website (plain HTML/CSS/JS, no build step)
```
