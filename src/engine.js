/**
 * Plank Walker — oyun motoru (saf mantık, UI yok). Tarayıcı + Node.
 *
 * Her tur rastgele bir parkur üretilir (segment sayısı, çarpanlar, yükseklikler).
 * Parkur ve adım zarları aynı provably-fair akıştan gelir; oyuncu seed'lerle doğrulayabilir.
 *
 * Adalet: i. segmente ulaşma olasılığı P(i) = (1 - HOUSE_EDGE) / M(i).
 * Böylece oyuncu nerede cash out yaparsa yapsın beklenen getiri sabittir (RTP %96).
 * Adım hayatta kalma olasılığı S(i) = P(i) / P(i-1) = M(i-1) / M(i).
 */

const HOUSE_EDGE = 0.04;
const TRACK_ROLLS = 24;   // parkur üretimi için ayrılan zar sayısı
const MAX_SEGMENTS = 18;
const MIN_SEGMENTS = 12;
const MAX_MULTIPLIER = 1000;

/**
 * Kalas bonusu tablosu: [değer, olasılık].
 * 1 = boş kalas (çarpan yok, risk yok). Çoğu kalas boş geçilir;
 * çıkan çarpanlar genelde 1.5×–4×, nadiren 10×/20×, çok nadiren 50×.
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
 * Rastgele parkur üret. rolls[0..TRACK_ROLLS) kullanılır.
 * Dönen segmentler: { index, bonus, multiplier, survive, reach }
 *  - bonus: bu kalasta düşen çarpan (1 = boş)
 *  - multiplier: buraya kadar biriken toplam çarpan (bonusların çarpımı)
 * Boş kalaslarda toplam değişmediği için geçiş riski yoktur; risk,
 * çarpan düşen kalaslarda (şimşek anında) toplanır.
 */
function generateTrack(rolls) {
  if (rolls.length < TRACK_ROLLS) throw new Error('Parkur için yetersiz zar');
  const count = MIN_SEGMENTS + Math.floor(rolls[0] * (MAX_SEGMENTS - MIN_SEGMENTS + 1));
  const bonuses = [];
  for (let i = 0; i < count; i++) bonuses.push(pickBonus(rolls[1 + i]));
  if (bonuses.every((b) => b === 1)) bonuses[count - 1] = 2; // tamamen boş parkur olmasın

  const segments = [];
  let mult = 1, prevReach = 1;
  for (let i = 0; i < count; i++) {
    mult = Math.min(MAX_MULTIPLIER, round2(mult * bonuses[i]));
    const reach = (1 - HOUSE_EDGE) / mult;
    const survive = Math.min(1, reach / prevReach);
    prevReach = reach;
    segments.push({ index: i + 1, bonus: bonuses[i], multiplier: mult, survive, reach });
    if (mult >= MAX_MULTIPLIER) break;
  }
  return segments;
}

/**
 * Provably fair: HMAC-SHA256(serverSeed, clientSeed:nonce:round) → [0,1) sayılar.
 * hmacHex dışarıdan verilir (WebCrypto veya Node crypto).
 */
async function generateRolls(hmacHex, serverSeed, clientSeed, nonce, count) {
  const rolls = [];
  let round = 0;
  while (rolls.length < count) {
    const hex = await hmacHex(serverSeed, `${clientSeed}:${nonce}:${round}`);
    for (let i = 0; i + 8 <= hex.length && rolls.length < count; i += 8) {
      rolls.push(parseInt(hex.slice(i, i + 8), 16) / 0x100000000);
    }
    round++;
  }
  return rolls;
}

/** Tam tur: parkur + adım sonuçları. */
async function createRound(hmacHex, serverSeed, clientSeed, nonce) {
  const rolls = await generateRolls(hmacHex, serverSeed, clientSeed, nonce, TRACK_ROLLS + MAX_SEGMENTS);
  const track = generateTrack(rolls);
  const stepRolls = rolls.slice(TRACK_ROLLS, TRACK_ROLLS + track.length);
  const { fallAt } = resolveRound(track, stepRolls);
  return { track, stepRolls, fallAt };
}

/** Adam hangi segmente geçerken düşer? fallAt === track.length → hiç düşmez. */
function resolveRound(track, stepRolls) {
  for (let i = 0; i < track.length; i++) {
    if (stepRolls[i] >= track[i].survive) return { fallAt: i };
  }
  return { fallAt: track.length };
}

/** Kayma mı, kalas kırılması mı? Sadece görsel. */
function failStyle(roll) { return roll > 0.5 ? 'slip' : 'break'; }

function payout(bet, multiplier) { return Math.floor(bet * multiplier * 100) / 100; }

/** Çarpan büyüklüğüne göre görsel kademe (0 = en düşük, 5 = efsanevi). */
function tierOf(m) { return m < 2 ? 0 : m < 3 ? 1 : m < 5 ? 2 : m < 10 ? 3 : m < 50 ? 4 : 5; }

const api = { HOUSE_EDGE, TRACK_ROLLS, MIN_SEGMENTS, MAX_SEGMENTS, BONUS_TABLE, generateTrack, generateRolls, createRound, resolveRound, failStyle, payout, tierOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlankEngine = api;
