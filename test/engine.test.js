const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const E = require('../src/engine.js');

const hmacHex = async (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');

test('rastgele parkurlarda RTP her segmentte sabit %96', async () => {
  for (let n = 0; n < 200; n++) {
    const { track } = await E.createRound(hmacHex, 'seed-' + n, 'client', n);
    assert.ok(track.length >= 1 && track.length <= E.MAX_SEGMENTS);
    let reach = 1, prev = 1;
    for (const seg of track) {
      reach *= seg.survive;
      assert.ok(Math.abs(reach * seg.multiplier - (1 - E.HOUSE_EDGE)) < 1e-9, `tur ${n} seg ${seg.index}`);
      assert.ok(seg.survive > 0 && seg.survive < 1);
      assert.ok(seg.multiplier > prev, 'çarpanlar artmalı');
      prev = seg.multiplier;
    }
  }
});

test('aynı seed → aynı parkur ve aynı sonuç', async () => {
  const a = await E.createRound(hmacHex, 'server', 'client', 7);
  const b = await E.createRound(hmacHex, 'server', 'client', 7);
  assert.deepStrictEqual(a, b);
  const c = await E.createRound(hmacHex, 'server', 'client', 8);
  assert.notDeepStrictEqual(a.track.map((s) => s.multiplier), c.track.map((s) => s.multiplier));
});

test('simülasyon: ilk segmentte cash out RTP ≈ %96', async () => {
  const N = 60000; let ret = 0;
  for (let n = 0; n < N; n++) {
    const { track, fallAt } = await E.createRound(hmacHex, 'sim', 'c', n);
    if (fallAt >= 1) ret += track[0].multiplier;
  }
  const rtp = ret / N;
  assert.ok(Math.abs(rtp - 0.96) < 0.03, `RTP ${rtp}`);
});

test('payout ve kademe', () => {
  assert.strictEqual(E.payout(10, 2.333), 23.33);
  assert.deepStrictEqual([1.5, 3, 7, 15, 60, 250].map(E.tierOf), [0, 1, 2, 3, 4, 5]);
});
