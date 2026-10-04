// Getting the shopper's photo in (upload or link), normalizing it, and giving
// Google Lens a public URL it can fetch.

import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.js';
import { UserError, combineSignals } from './http.js';

const MAX_INPUT_BYTES = 15 * 1024 * 1024;

// Loaded on first use, so demo mode still works if the image library failed to
// install (e.g. packages installed with a too-old Node.js).
let sharpModule;
async function loadSharp() {
  try {
    sharpModule ??= (await import('sharp')).default;
    return sharpModule;
  } catch {
    throw new UserError(
      "Scower's image library isn't installed correctly. Close Scower and start it again with start.cmd, " +
        'or run "npm.cmd install" in the Scower folder.',
      500,
    );
  }
}

/** Re-encode any supported image as an upright JPEG no larger than 1280px. */
export async function normalizeImage(buffer) {
  const sharp = await loadSharp();
  try {
    return await sharp(buffer, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86 })
      .toBuffer();
  } catch {
    throw new UserError("Couldn't read that image. Try a JPG, PNG or WebP photo.");
  }
}

export function decodeDataUrl(dataUrl) {
  const match = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!match) throw new UserError('The upload must be an image.');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) throw new UserError('The uploaded image is empty.');
  if (buffer.length > MAX_INPUT_BYTES) throw new UserError('That image is too big (15 MB max).', 413);
  return buffer;
}

// ---------------------------------------------------------------------------
// Fetching an image from a pasted link, without letting the link reach this
// server's private network.

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UserError("That doesn't look like a valid link.");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('Image links must start with http:// or https://');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  } catch {
    throw new UserError("Couldn't reach that link.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new UserError("That link can't be used.");
  }
  return url;
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_INPUT_BYTES) throw new UserError('That image is too big (15 MB max).', 413);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new UserError('That image is too big (15 MB max).', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Returns { buffer, finalUrl }. Follows up to 4 redirects, re-checking each hop. */
export async function fetchImageFromUrl(rawUrl, signal) {
  let current = rawUrl;
  for (let hop = 0; hop < 5; hop++) {
    const url = await assertPublicHttpUrl(current);
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: combineSignals(signal, 15_000),
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; ScowerBot/1.0; +https://github.com/paulsclpatino-commits/scower-hub)',
        },
      });
    } catch {
      throw new UserError("Couldn't download that image link.");
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new UserError(`That image link returned an error (${response.status}).`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) {
      throw new UserError("That link is a web page, not an image. Right-click the photo and choose \"Copy image address\".");
    }
    return { buffer: await readLimited(response), finalUrl: url.href };
  }
  throw new UserError('That image link redirects too many times.');
}

// ---------------------------------------------------------------------------
// Public URLs for Google Lens

const hosted = new Map();
const HOSTED_TTL_MS = 15 * 60 * 1000;

function pruneHosted() {
  const now = Date.now();
  for (const [id, entry] of hosted) if (entry.expires < now) hosted.delete(id);
  while (hosted.size > 200) hosted.delete(hosted.keys().next().value);
}

export function hostImage(jpeg) {
  pruneHosted();
  const id = randomBytes(12).toString('hex');
  hosted.set(id, { jpeg, expires: Date.now() + HOSTED_TTL_MS });
  return id;
}

export function getHostedImage(id) {
  const entry = hosted.get(id);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.jpeg;
}

export function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  return host === 'localhost' || !host.includes('.') || /\.(?:localhost|local|internal|lan|home|test)$/.test(host);
}

/** The site's public origin as seen by this request, or null when it's local. */
export function publicOriginFor(req) {
  if (config.publicUrl) return config.publicUrl;
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '');
  if (isPrivateHostname(hostname)) return null;
  return `${req.protocol}://${host}`;
}

async function uploadToLitterbox(jpeg, signal) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '1h');
  form.append('fileToUpload', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
  const response = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body: form,
    signal: combineSignals(signal, 20_000),
  });
  const text = (await response.text()).trim();
  if (!response.ok || !/^https:\/\/\S+$/.test(text)) throw new Error('Temporary image upload failed');
  return text;
}

/**
 * A URL Google can fetch the photo from: this server's own /img route when it's
 * on the public internet, otherwise a temporary upload (or null if disabled).
 */
export async function publicImageUrl({ req, jpeg, signal }) {
  const origin = publicOriginFor(req);
  if (origin) return `${origin}/img/${hostImage(jpeg)}.jpg`;
  if (config.tempImageHost === 'litterbox') return uploadToLitterbox(jpeg, signal);
  return null;
}
