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
const TRACK_ROLLS = 40;   // parkur üretimi için ayrılan zar sayısı
const MAX_SEGMENTS = 18;
const MIN_SEGMENTS = 12;
const MAX_MULTIPLIER = 1000;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Rastgele parkur üret. rolls[0..TRACK_ROLLS) kullanılır.
 * Dönen segmentler: { index, multiplier, survive, reach }
 * Çarpanlar oyuncuya gizlidir; adam kalasa basınca açıklanır.
 */
function generateTrack(rolls) {
  if (rolls.length < TRACK_ROLLS) throw new Error('Parkur için yetersiz zar');
  const count = MIN_SEGMENTS + Math.floor(rolls[0] * (MAX_SEGMENTS - MIN_SEGMENTS + 1));
  const segments = [];
  let mult = 1, prevReach = 1;

  for (let i = 0; i < count; i++) {
    const r = rolls[1 + i * 2], g = rolls[2 + i * 2];
    // Çarpan büyüme çarpanı: çoğunlukla küçük adımlar, ara sıra sıçrama.
    // Büyüme hızı = düşme riski; yavaş büyüme uzun ve gerilimli turlar demek.
    let growth;
    if (r < 0.75) growth = 1.05 + g * 0.15;       // 1.05–1.20  (geçiş şansı ~%83–95)
    else if (r < 0.95) growth = 1.20 + g * 0.20;  // 1.20–1.40
    else if (r < 0.995) growth = 1.4 + g * 0.4;   // 1.4–1.8
    else growth = 1.8 + g * 0.7;                  // 1.8–2.5 (nadir)
    mult = Math.min(MAX_MULTIPLIER, round2(mult * growth));

    const reach = (1 - HOUSE_EDGE) / mult;
    const survive = Math.min(1, reach / prevReach);
    prevReach = reach;

    segments.push({ index: i + 1, multiplier: mult, survive, reach });
    if (mult >= MAX_MULTIPLIER) break; // tavana ulaşıldı, parkur burada biter
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
function tierOf(m) { return m < 2 ? 0 : m < 5 ? 1 : m < 10 ? 2 : m < 25 ? 3 : m < 100 ? 4 : 5; }

const api = { HOUSE_EDGE, TRACK_ROLLS, MIN_SEGMENTS, MAX_SEGMENTS, generateTrack, generateRolls, createRound, resolveRound, failStyle, payout, tierOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlankEngine = api;
