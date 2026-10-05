import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyListings, heuristicMatches, identifyItem, looksLikeKnockoff, setAnthropicClient } from '../src/ai.js';

afterEach(() => setAnthropicClient(null));

function fakeClient(responses) {
  const requests = [];
  const client = {
    beta: {
      messages: {
        create: async (params, options) => {
          requests.push({ params, options });
          const next = responses.shift();
          return typeof next === 'function' ? next(params) : next;
        },
      },
    },
  };
  setAnthropicClient(client);
  return requests;
}

const textResponse = (obj, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
  ...extra,
});

const IDENTIFIED = {
  is_fashion_item: true,
  brand: 'Supreme',
  product_name: 'NYC Collage Zip Up Hooded Sweatshirt',
  category: 'Hoodie',
  colorway: 'Black',
  season: 'FW24',
  search_query: 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black',
  alt_queries: ['Supreme Collage Zip Up Hoodie', '', 'extra', 'too many'],
  key_details: ['all-over collage print'],
  confidence: 'high',
  wanted_size: 'large',
};

test('identifyItem sends the photo with structured output and fallbacks', async () => {
  const requests = fakeClient([textResponse(IDENTIFIED)]);
  const item = await identifyItem({ jpeg: Buffer.from('jpeg-bytes'), hint: 'size large' });

  const { params } = requests[0];
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.equal('thinking' in params, false);
  const [image, text] = params.messages[0].content;
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, Buffer.from('jpeg-bytes').toString('base64'));
  assert.match(text.text, /size large/);

  assert.equal(item.brand, 'Supreme');
  assert.equal(item.query, 'Supreme NYC Collage Zip Up Hooded Sweatshirt Black');
  assert.deepEqual(item.altQueries, ['Supreme Collage Zip Up Hoodie', 'extra']);
  assert.equal(item.wantedSize, 'L');
});

test('identifyItem reports refusals instead of parsing them', async () => {
  fakeClient([{ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }]);
  await assert.rejects(identifyItem({ jpeg: Buffer.from('x'), hint: '' }), /declined/);
});

test('classifyListings maps verdicts back to listing ids', async () => {
  const requests = fakeClient([
    (params) => {
      const payload = JSON.parse(params.messages[0].content[0].text);
      assert.equal(payload.listings.length, 3);
      return textResponse({
        results: [
          { i: 0, verdict: 'exact' },
          { i: 1, verdict: 'different' },
          { i: 2, verdict: 'similar' },
          { i: 99, verdict: 'exact' },
        ],
      });
    },
  ]);
  const listings = [
    { id: 'a', title: 'Supreme NYC Collage Zip Up Black L', store: 'Grailed' },
    { id: 'b', title: 'Collage hoodie (inspired)', store: 'Depop' },
    { id: 'c', title: 'Supreme Collage Zip Up Navy', store: 'eBay' },
  ];
  const verdicts = await classifyListings({ item: { brand: 'Supreme', name: 'Collage', keyDetails: [] }, listings });
  assert.deepEqual(verdicts, { a: 'exact', b: 'different', c: 'similar' });
  assert.equal(requests[0].params.output_config.effort, 'low');
});

test('heuristicMatches scores titles by query overlap', () => {
  const verdicts = heuristicMatches('Supreme NYC Collage Zip Up Hoodie', [
    { id: 'a', title: 'Supreme NYC Collage Zip Up Hoodie Black L' },
    { id: 'b', title: 'Supreme Collage Hoodie' },
    { id: 'c', title: 'Nike Tech Fleece' },
  ]);
  assert.deepEqual(verdicts, { a: 'exact', b: 'similar', c: 'different' });
});

test('heuristicMatches marks knock-offs and lots as different', () => {
  const verdicts = heuristicMatches('Supreme NYC Collage Zip Up Hoodie', [
    { id: 'a', title: 'Collage graffiti zip hoodie (inspired) Supreme NYC style' },
    { id: 'b', title: 'Supreme NYC Collage Zip Up Hoodie 1:1 rep' },
    { id: 'c', title: 'Lot of 3 Supreme NYC Collage Zip Up Hoodie' },
    { id: 'd', title: 'Supreme NYC Collage Zip Up Hoodie Black Large' },
  ]);
  assert.deepEqual(verdicts, { a: 'different', b: 'different', c: 'different', d: 'exact' });
  assert.equal(looksLikeKnockoff('Faux fake fur trim parka'), false);
  assert.equal(looksLikeKnockoff('Represent Clo hoodie, has a lot of life left'), false);
  assert.equal(looksLikeKnockoff('Supreme box logo FAKE'), true);
});

test('looksLikeKnockoff leaves real products, brands and negations alone', () => {
  // Maison Margiela sells genuine "Replica" sneakers: the word is in the search itself.
  assert.equal(looksLikeKnockoff('Maison Margiela Replica GAT Sneakers White', 'Maison Margiela Replica Sneakers'), false);
  assert.equal(looksLikeKnockoff('HOMAGE Chicago Bulls Tee'), false);
  assert.equal(looksLikeKnockoff('Unbranded Black Zip Hoodie Mens L'), false);
  assert.equal(looksLikeKnockoff('Supreme Box Logo Hoodie 100% Authentic Not Fake'), false);
  assert.equal(looksLikeKnockoff('Supreme hoodie, no reps'), false);
  assert.equal(looksLikeKnockoff('Supreme 1:1 rep hoodie', 'Supreme hoodie'), true);
  const verdicts = heuristicMatches('Maison Margiela Replica Sneakers', [
    { id: 'a', title: 'Maison Margiela Replica GAT Sneakers White' },
    { id: 'b', title: 'Maison Margiela Replica Low Top Sneakers' },
  ]);
  assert.notEqual(verdicts.a, 'different');
  assert.notEqual(verdicts.b, 'different');
});
