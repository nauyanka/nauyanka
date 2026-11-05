const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const E = require('../src/engine.js');

const hmacHex = async (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');

test('sonsuz parkurda RTP her segmentte sabit %96', async () => {
  for (let n = 0; n < 200; n++) {
    const segs = await E.createRound(hmacHex, 'seed-' + n, 'client', n).take(40);
    let reach = 1, prev = 1;
    for (const seg of segs) {
      reach *= seg.survive;
      assert.ok(Math.abs(reach * seg.multiplier - (1 - E.HOUSE_EDGE)) < 1e-9, `tur ${n} seg ${seg.index}`);
      assert.ok(seg.survive > 0 && seg.survive <= 1);
      if (seg.bonus === 1 && seg.index > 1) assert.strictEqual(seg.survive, 1, 'boş kalas risksiz');
      assert.ok(seg.multiplier >= prev, 'toplam çarpan azalmaz');
      prev = seg.multiplier;
      if (seg.multiplier >= E.MAX_MULTIPLIER) break;
    }
  }
});

test('aynı seed → aynı segmentler; tembel üretim ile toplu üretim aynı', async () => {
  const a = await E.createRound(hmacHex, 'server', 'client', 7).take(30);
  const r = E.createRound(hmacHex, 'server', 'client', 7);
  const b = []; for (let i = 0; i < 30; i++) b.push(await r.segment(i));
  assert.deepStrictEqual(a, b);
  const c = await E.createRound(hmacHex, 'server', 'client', 8).take(30);
  assert.notDeepStrictEqual(a.map((s) => s.bonus), c.map((s) => s.bonus));
});

test('simülasyon: ilk çarpan kalasında cash out RTP ≈ %96', async () => {
  const N = 60000; let ret = 0;
  for (let n = 0; n < N; n++) {
    const r = E.createRound(hmacHex, 'sim', 'c', n);
    for (let i = 0; ; i++) {
      const s = await r.segment(i);
      if (s.fell) break;
      if (s.bonus > 1) { ret += s.multiplier; break; }
    }
  }
  const rtp = ret / N;
  assert.ok(Math.abs(rtp - 0.96) < 0.03, `RTP ${rtp}`);
});

test('payout, kademe ve bonus tablosu', () => {
  assert.strictEqual(E.payout(10, 2.333), 23.33);
  assert.deepStrictEqual([1.5, 2, 3, 5, 10, 50].map(E.tierOf), [0, 1, 2, 3, 4, 5]);
  assert.ok(Math.abs(E.BONUS_TABLE.reduce((a, [, w]) => a + w, 0) - 1) < 1e-9, 'bonus olasılıkları 1 etmeli');
  assert.ok(E.BONUS_TABLE[0][1] <= 0.4, 'boş kalas oranı %40ı geçmemeli');
});
