/**
 * Plank Walker — oyun motoru (saf mantık, UI yok). Tarayıcı + Node.
 *
 * Kalas SONSUZDUR. Segmentler lazım oldukça aynı provably-fair akıştan üretilir;
 * oyuncu seed'lerle her segmenti doğrulayabilir.
 *
 * Adalet: i. segmente ulaşma olasılığı P(i) = (1 - HOUSE_EDGE) / M(i).
 * Böylece oyuncu nerede cash out yaparsa yapsın beklenen getiri sabittir (RTP %96).
 * Adım hayatta kalma olasılığı S(i) = P(i) / P(i-1) = M(i-1) / M(i).
 * Boş kalaslarda M değişmez → risk yok; risk çarpan düşen kalaslarda toplanır.
 */

const HOUSE_EDGE = 0.04;
const MAX_MULTIPLIER = 5000;   // bu toplama ulaşınca tur otomatik ödenir

/**
 * Kalas bonusu tablosu: [değer, olasılık].
 * 1 = boş kalas. Çoğu kalas boş geçilir; çıkan çarpanlar genelde 1.5×–4×,
 * nadiren 10×/20×, çok nadiren 50×.
 */
const BONUS_TABLE = [
  [1, 0.60], [1.5, 0.16], [2, 0.12], [3, 0.06], [4, 0.03],
  [5, 0.015], [10, 0.008], [20, 0.005], [50, 0.002],
];
function pickBonus(r) {
  let acc = 0;
  for (const [v, w] of BONUS_TABLE) { acc += w; if (r < acc) return v; }
  return 1;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Bir tur: sonsuz, tembel üretilen segment akışı.
 * Zar k = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${floor(k/8)}`) içindeki (k%8). 4 bayt.
 * Segment j: bonus zarı = zar[2j], adım zarı = zar[2j+1].
 */
class Round {
  constructor(hmacHex, serverSeed, clientSeed, nonce) {
    Object.assign(this, { hmacHex, serverSeed, clientSeed, nonce });
    this.rolls = []; this.segments = [];
    this.mult = 1; this.prevReach = 1;
  }
  async roll(k) {
    while (this.rolls.length <= k) {
      const chunk = this.rolls.length / 8;
      const hex = await this.hmacHex(this.serverSeed, `${this.clientSeed}:${this.nonce}:${chunk}`);
      for (let i = 0; i + 8 <= hex.length; i += 8) this.rolls.push(parseInt(hex.slice(i, i + 8), 16) / 0x100000000);
    }
    return this.rolls[k];
  }
  /** i. segment (0 tabanlı). { index, bonus, multiplier, survive, fell, stepRoll } */
  async segment(i) {
    while (this.segments.length <= i) {
      const j = this.segments.length;
      const bonus = pickBonus(await this.roll(2 * j));
      const stepRoll = await this.roll(2 * j + 1);
      this.mult = Math.min(MAX_MULTIPLIER, round2(this.mult * bonus));
      const reach = (1 - HOUSE_EDGE) / this.mult;
      const survive = Math.min(1, reach / this.prevReach);
      this.prevReach = reach;
      this.segments.push({ index: j + 1, bonus, multiplier: this.mult, survive, fell: stepRoll >= survive, stepRoll });
    }
    return this.segments[i];
  }
  /** Doğrulama / test: ilk n segmenti üret. */
  async take(n) { await this.segment(n - 1); return this.segments.slice(0, n); }
}

function createRound(hmacHex, serverSeed, clientSeed, nonce) { return new Round(hmacHex, serverSeed, clientSeed, nonce); }

/** Kayma mı, kalas kırılması mı? Sadece görsel. */
function failStyle(roll) { return roll > 0.5 ? 'slip' : 'break'; }

function payout(bet, multiplier) { return Math.floor(bet * multiplier * 100) / 100; }

/** Çarpan büyüklüğüne göre görsel kademe (0 = en düşük, 5 = efsanevi). */
function tierOf(m) { return m < 2 ? 0 : m < 3 ? 1 : m < 5 ? 2 : m < 10 ? 3 : m < 50 ? 4 : 5; }

const api = { HOUSE_EDGE, MAX_MULTIPLIER, BONUS_TABLE, Round, createRound, failStyle, payout, tierOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlankEngine = api;
