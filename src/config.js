import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read .env from the project folder, whichever folder the server was started from.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const env = process.env;

function flag(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

export const config = {
  port: Number(env.PORT) || 3000,

  // Public base URL of this site (e.g. https://scower.onrender.com). Google Lens
  // needs a public link to the uploaded photo; when this is unset the server
  // works it out from the request, or falls back to a temporary image host.
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),

  // Where uploaded photos go when this server isn't reachable from the internet
  // (e.g. running on localhost). "litterbox" = litterbox.catbox.moe, files
  // auto-delete after 1 hour. "off" = skip Google Lens for uploads.
  tempImageHost: (env.TEMP_IMAGE_HOST || 'litterbox').toLowerCase(),

  anthropic: {
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  },

  serpApiKey: env.SERPAPI_KEY || '',

  ebay: {
    clientId: env.EBAY_CLIENT_ID || '',
    clientSecret: env.EBAY_CLIENT_SECRET || '',
    marketplace: env.EBAY_MARKETPLACE || 'EBAY_US',
  },

  // Two-letter country used for Google results (prices come back in that
  // country's currency).
  country: (env.SEARCH_COUNTRY || 'us').toLowerCase(),

  demo: flag(env.DEMO_MODE) || process.argv.includes('--demo'),

  sourceTimeoutMs: Number(env.SOURCE_TIMEOUT_MS) || 25_000,
};

export function enabledFeatures() {
  return {
    identify: config.anthropic.enabled,
    googleLens: Boolean(config.serpApiKey),
    googleShopping: Boolean(config.serpApiKey),
    ebay: Boolean(config.ebay.clientId && config.ebay.clientSecret),
    demo: config.demo,
  };
}
