import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server.js';
import { fetchImageFromUrl, isPrivateAddress, isPrivateHostname } from '../src/images.js';

let server;
let base;
let features = { identify: false, googleLens: false, googleShopping: false, ebay: false, demo: true };

before(async () => {
  const app = createApp({ features: () => features, searchOptions: { speed: 0 } });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function readNdjson(response) {
  const text = await response.text();
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('status reports which sources are configured', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.deepEqual((await response.json()).features, features);
});

test('the homepage is served', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Scower<\/title>/);
});

test('demo search streams newline-delimited events', async () => {
  const response = await fetch(`${base}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hint: 'size M' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /ndjson/);
  const events = await readNdjson(response);
  assert.equal(events[0].type, 'start');
  assert.equal(events.at(-1).type, 'done');
  assert.ok(events.at(-1).total > 5);
});

test('a real search needs a photo or a link', async () => {
  features = { ...features, demo: false };
  try {
    const response = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hint: 'hoodie' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /photo/);

    const bad = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,bm90IGFuIGltYWdl' }),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Couldn't read that image/);
  } finally {
    features = { ...features, demo: true };
  }
});

test('an uploaded photo with no sources configured finishes cleanly', async () => {
  features = { identify: false, googleLens: false, googleShopping: false, ebay: false, demo: false };
  try {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#222' } }).png().toBuffer();
    const response = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:image/png;base64,${png.toString('base64')}`, hint: 'supreme hoodie' }),
    });
    const events = await readNdjson(response);
    assert.deepEqual(events.map((e) => e.type), ['start', 'query', 'done']);
    assert.equal(events[1].query, 'supreme hoodie');
  } finally {
    features = { identify: false, googleLens: false, googleShopping: false, ebay: false, demo: true };
  }
});

test('unknown hosted images 404', async () => {
  assert.equal((await fetch(`${base}/img/${'a'.repeat(24)}.jpg`)).status, 404);
  assert.equal((await fetch(`${base}/img/../server.js`)).status, 404);
});

test('image links cannot point at private addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  await assert.rejects(fetchImageFromUrl('http://127.0.0.1:1/x.jpg'), /can't be used/);
  await assert.rejects(fetchImageFromUrl('http://localhost/x.jpg'), /can't be used/);
  await assert.rejects(fetchImageFromUrl('file:///etc/passwd'), /http/);
});

test('local hostnames are not treated as public', () => {
  for (const host of ['localhost', '127.0.0.1', 'my-laptop', 'box.local', '192.168.1.5']) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.equal(isPrivateHostname('scower.onrender.com'), false);
});
