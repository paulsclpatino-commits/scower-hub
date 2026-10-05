# Scower

Drop in a photo of a piece of clothing and Scower finds that exact item for sale across the internet. It lists every listing from cheapest to most expensive, with sizes, and each result links straight to the listing.

- **Upload, drag in, or paste** a photo (Ctrl/⌘+V), or paste an image link
- **AI identification** names the exact product, e.g. *Supreme NYC Collage Zip Up Hooded Sweatshirt, Black, FW24*
- **Searches several sources at once**: Google Lens reverse-image search (covers Grailed, StockX, GOAT, Depop, Poshmark, Mercari, brand stores and more), Google Shopping, and eBay (keyword search through SerpApi, or eBay's own photo and keyword search with eBay keys)
- **Cheapest first**, with sizes read from each listing, shipping costs where the store gives them, and a "Lowest price" badge
- **Filters** for size, price range, store, condition, and exact match vs. similar items
- **Match check**: AI marks each listing as an exact match, a similar item, or a different item (replicas, other colorways, lots), and hides the different ones by default
- Results **stream in** as each source answers, and repeat searches of the same photo are cached for 30 minutes

## Windows: the easy way (no typing)

1. **Install Node.js** if you don't have it yet: download the **LTS** version from [nodejs.org](https://nodejs.org) and install it with the default options.
2. **Download Scower:** on [the GitHub page](https://github.com/paulsclpatino-commits/scower-hub), click the green **Code** button, then **Download ZIP**.
3. **Unblock and extract it:** right-click the downloaded ZIP, choose **Properties**, tick **Unblock** at the bottom (if it's there), and click **OK**. Then right-click the ZIP again, choose **Extract All...**, then **Extract**. Don't run anything from inside the ZIP.
4. **Try the demo:** open the extracted folder (it may contain another folder with the same name; go into that one) and double-click **start-demo** (its type is "Windows Command Script"; the full name is `start-demo.cmd`). The first time, it spends about a minute installing packages. Then your browser opens Scower with sample listings. The demo shows the same sample hoodie listings whatever photo you use, so you can see how the site works without any accounts.
5. **Real searches:** close the demo window, then double-click **start** (`start.cmd`). The first time, it creates a settings file and opens it in Notepad. Paste your API keys after the `=` signs (see [Real searches](#real-searches) for where to get them), save, close Notepad, and double-click `start.cmd` again. To change your keys later, double-click **edit-settings** (`edit-settings.cmd`).

Good to know:
- Keep the black window open while you use Scower. Closing it stops Scower.
- Don't click inside the black window: that pauses it. If Scower seems stuck, click the window and press **Esc**.
- If Windows asks whether to run the file ("Open File - Security Warning", or "Windows protected your PC" > **More info**), choose **Run** / **Run anyway**. Unblocking the ZIP in step 3 prevents this.
- Don't double-click `server.js` or open `public/index.html` directly. Windows can't run them that way; use the `.cmd` files.

### Using a terminal instead

1. Open the Scower folder (the one containing `start.cmd`) in File Explorer, click the address bar, type `cmd`, and press **Enter**. A Command Prompt opens in that folder.
2. Run:
   ```
   npm install
   npm run demo
   ```
   Your browser opens Scower at http://localhost:3000. For real searches, use `npm run local` instead of `npm run demo`.
3. To stop Scower, press **Ctrl+C** in that window (answer **Y** if asked).

In **PowerShell**, `npm` may fail with `npm.ps1 cannot be loaded because running scripts is disabled on this system`. Type `npm.cmd` instead of `npm` (for example `npm.cmd install`). It's the same program, and PowerShell allows it. Node.js 20.9 or newer is required.

## Mac / Linux

You need [Node.js](https://nodejs.org) 20.9 or newer.

```bash
npm install
npm run demo
```

Your browser opens http://localhost:3000. Click **Find the lowest price** to see the sample results. Demo links open store search pages, not real listings.

## Real searches

1. Create your settings file, `.env`, from the example. On Windows, double-click `edit-settings.cmd` (or run `start.cmd`, which does it the first time). On Mac/Linux:
   ```bash
   cp .env.example .env
   ```
2. Add the keys you have to `.env`. Each one is optional, but more keys means better results:

   | Key | What it adds | Where to get it |
   | --- | --- | --- |
   | `SERPAPI_KEY` | Google Lens, Google Shopping and eBay: finds your photo on Grailed, StockX, Depop, Poshmark, eBay, stores and more. **Start with this one.** | [serpapi.com](https://serpapi.com) (free plan: 250 searches a month) |
   | `ANTHROPIC_API_KEY` | Names the exact item and checks which listings really match it | [console.anthropic.com](https://console.anthropic.com) (pay per use) |
   | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` | eBay's own search, including search by photo, without using SerpApi searches | [developer.ebay.com](https://developer.ebay.com) (free): create a **Production** keyset |

   With only `SERPAPI_KEY` you get Google Lens, Google Shopping and eBay results for your photo. Adding `ANTHROPIC_API_KEY` names the exact item, which makes the keyword searches more accurate, and marks which listings are look-alikes.
3. Start Scower: double-click `start.cmd` on Windows, or run `npm run local` in a terminal.

**Cost per search:** 4 SerpApi searches (2 Google Lens, 1 Google Shopping, 1 eBay), so the free plan covers about 60 photo searches a month. With eBay keys, eBay is searched through eBay's own free API instead, and each photo search uses 3 SerpApi searches. Without eBay keys, set `SERPAPI_EBAY=off` to skip eBay and save that search. Searching the same photo again within 30 minutes reuses the earlier results for free. With `ANTHROPIC_API_KEY`, each search also makes 2 Claude requests.

### About Google Lens and your photo

Your photo is uploaded straight to SerpApi for Google Lens. SerpApi's upload link expires after 10 minutes. If that upload fails, Scower falls back to:

- **Deployed online** (Render, Railway, Fly.io, etc.): the site serves the photo itself for 15 minutes.
- **Running on your computer**: a temporary upload to [litterbox.catbox.moe](https://litterbox.catbox.moe), which deletes files after 1 hour. Set `TEMP_IMAGE_HOST=off` to turn this fallback off.

Pasted image links are passed to Google Lens as they are.

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
            │    (no AI key: the words most     │             └─► Google Shopping
            │     Lens matches agree on) ───────┘
            ├──► Google Lens (photo uploaded to SerpApi): visual + product matches
            └──► eBay search-by-image (eBay keys only)
                                   │
            all listings ◄─────────┘  merged by URL (same eBay item from two sources = one card)
                 │
                 └──► Claude: exact / similar / different? ──► browser sorts & filters
                      (no AI key: keyword overlap, and titles with knock-off
                       words like "inspired" or "1:1 rep" count as different)
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
server.js              entry point (--demo, --open); checks the Node.js version
start.cmd, start-demo.cmd  Windows double-click launchers (shared checks in scripts/)
src/app.js             Express app: /api/search (NDJSON stream), /api/status, /img/:id
src/search.js          runs one search: sources in parallel, merging, match check, cache, demo
src/ai.js              Claude: identify the item, classify listings
src/sources/serpapi.js Google Lens + Google Shopping
src/sources/ebay.js    eBay Browse API (search by image, keyword search)
src/normalize.js       prices, currencies, sizes, store names, URL de-duplication
src/images.js          upload/link handling, private-network protection, public photo URLs
public/                the website (plain HTML/CSS/JS, no build step)
```
