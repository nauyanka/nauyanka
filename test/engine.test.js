const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const E = require('../src/engine.js');

const hmacHex = async (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');

test('her zorlukta RTP her segmentte ~%96', () => {
  for (const d of Object.keys(E.DIFFICULTIES)) {
    const track = E.buildTrack(d);
    let reach = 1;
    for (const seg of track) {
      reach *= seg.survive;
      assert.ok(Math.abs(reach * seg.multiplier - (1 - E.HOUSE_EDGE)) < 1e-9, `${d} seg ${seg.index}`);
      assert.ok(seg.survive > 0 && seg.survive < 1);
    }
  }
});

test('aynı seed → aynı sonuç (deterministik)', async () => {
  const track = E.buildTrack('medium');
  const a = await E.generateStepRolls(hmacHex, 'server', 'client', 1, track.length);
  const b = await E.generateStepRolls(hmacHex, 'server', 'client', 1, track.length);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(E.resolveRound(track, a), E.resolveRound(track, b));
});

test('simülasyon: ilk segmentte cash out RTP ≈ %96', async () => {
  const track = E.buildTrack('hard');
  const N = 20000; let ret = 0;
  for (let n = 0; n < N; n++) {
    const rolls = await E.generateStepRolls(hmacHex, 'sim-seed', 'c', n, track.length);
    if (E.resolveRound(track, rolls).fallAt >= 1) ret += track[0].multiplier;
  }
  const rtp = ret / N;
  assert.ok(Math.abs(rtp - 0.96) < 0.02, `RTP ${rtp}`);
});

test('payout iki ondalığa yuvarlar', () => {
  assert.strictEqual(E.payout(10, 2.333), 23.33);
});
