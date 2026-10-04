import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { config, enabledFeatures } from './src/config.js';
import { UserError, describeError } from './src/http.js';
import { decodeDataUrl, fetchImageFromUrl, getHostedImage, normalizeImage, publicImageUrl } from './src/images.js';
import { cachedSearch, runDemoSearch } from './src/search.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Simple per-IP limit so a public deployment can't burn through API credits.
function rateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }
      return next();
    }
    if (++entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many searches. Take a breather and try again in a few minutes.' });
    }
    next();
  };
}

function trustProxySetting(value) {
  if (value == null || value === '') return 1;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}

export function createApp({ features = () => enabledFeatures(), searchOptions = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Render/Railway/Fly etc. the original host, protocol and client IP
  // arrive in X-Forwarded-* headers from one proxy hop.
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

  app.use(express.json({ limit: '22mb' }));
  app.use(express.static(path.join(here, 'public'), { extensions: ['html'] }));

  app.get('/api/status', (req, res) => {
    res.json({ features: features() });
  });

  app.get('/img/:file', (req, res) => {
    const id = req.params.file.replace(/\.jpg$/, '');
    const jpeg = /^[a-f0-9]{24}$/.test(id) ? getHostedImage(id) : null;
    if (!jpeg) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=900' }).send(jpeg);
  });

  const limit = Number(process.env.SEARCH_RATE_LIMIT) || 30;
  app.post('/api/search', rateLimiter({ limit, windowMs: 10 * 60 * 1000 }), async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    const { signal } = controller;
    const on = features();

    const hint = typeof req.body?.hint === 'string' ? req.body.hint.trim().slice(0, 200) : '';
    const imageData = typeof req.body?.image === 'string' ? req.body.image : '';
    const imageLink = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';

    let jpeg;
    let sourceImageUrl = null;
    try {
      if (on.demo) {
        // Demo mode never looks at the photo.
      } else if (imageData) {
        jpeg = await normalizeImage(decodeDataUrl(imageData));
      } else if (imageLink) {
        const { buffer, finalUrl } = await fetchImageFromUrl(imageLink, signal);
        jpeg = await normalizeImage(buffer);
        sourceImageUrl = finalUrl;
      } else {
        throw new UserError('Add a photo or an image link first.');
      }
    } catch (err) {
      if (signal.aborted) return;
      const status = err instanceof UserError ? err.status : 500;
      return res.status(status).json({ error: err instanceof UserError ? err.message : "Couldn't process that image." });
    }

    res.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const emit = (event) => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      if (on.demo) {
        await runDemoSearch({ emit, signal, hint, ...searchOptions });
      } else {
        let imageUrlPromise;
        const getImageUrl = () => {
          imageUrlPromise ??= sourceImageUrl ? Promise.resolve(sourceImageUrl) : publicImageUrl({ req, jpeg, signal });
          return imageUrlPromise;
        };
        await cachedSearch({ jpeg, hint }, { emit, signal, features: on, getImageUrl, ...searchOptions });
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error('[search] failed:', err);
        emit({ type: 'error', message: `Search failed: ${describeError(err)}` });
      }
    } finally {
      res.end();
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That image is too big (15 MB max).' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

function logStartup() {
  const f = enabledFeatures();
  const mark = (on) => (on ? 'on ' : 'off');
  console.log(`\n  Scower is running at http://localhost:${config.port}\n`);
  if (f.demo) {
    console.log('  DEMO MODE - every search returns sample data.\n');
    return;
  }
  console.log(`  [${mark(f.identify)}] AI item identification   (ANTHROPIC_API_KEY)`);
  console.log(`  [${mark(f.googleLens)}] Google Lens + Shopping    (SERPAPI_KEY)`);
  console.log(`  [${mark(f.ebay)}] eBay                      (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)`);
  if (!f.identify && !f.googleLens && !f.ebay) {
    console.log('\n  No API keys set - copy .env.example to .env and add at least one,');
    console.log('  or run `npm run demo` to try the interface with sample data.');
  }
  console.log('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(config.port, () => logStartup());
}
