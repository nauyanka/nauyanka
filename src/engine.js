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
const TRACK_ROLLS = 48;   // parkur üretimi için ayrılan zar sayısı
const MAX_SEGMENTS = 14;
const MIN_SEGMENTS = 8;
const MAX_MULTIPLIER = 10000;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Rastgele parkur üret. rolls[0..TRACK_ROLLS) kullanılır.
 * Dönen segmentler: { index, multiplier, survive, reach, level, width, gap }
 *  - level: kalasın yüksekliği (-2..2, 0 = başlangıç platformu seviyesi)
 *  - width / gap: görsel çeşitlilik için göreli ölçüler (olasılığı etkilemez)
 */
function generateTrack(rolls) {
  if (rolls.length < TRACK_ROLLS) throw new Error('Parkur için yetersiz zar');
  const count = MIN_SEGMENTS + Math.floor(rolls[0] * (MAX_SEGMENTS - MIN_SEGMENTS + 1));
  const segments = [];
  let mult = 1, level = 0, prevReach = 1;

  for (let i = 0; i < count; i++) {
    const r = rolls[1 + i * 3], g = rolls[2 + i * 3], h = rolls[3 + i * 3];
    // Çarpan büyüme çarpanı: çoğunlukla küçük, ara sıra büyük sıçrama
    let growth;
    if (r < 0.55) growth = 1.18 + g * 0.5;        // 1.18–1.68
    else if (r < 0.85) growth = 1.7 + g * 1.3;    // 1.7–3.0
    else if (r < 0.96) growth = 3 + g * 3;        // 3–6
    else growth = 6 + g * 14;                     // 6–20 (nadir)
    mult = Math.min(MAX_MULTIPLIER, round2(mult * growth));

    // Yükseklik: rastgele yürüyüş, -2..2 arasında
    const dl = h < 0.22 ? -2 : h < 0.42 ? -1 : h < 0.58 ? 0 : h < 0.8 ? 1 : 2;
    level = Math.max(-2, Math.min(2, level + dl));

    const reach = (1 - HOUSE_EDGE) / mult;
    const survive = Math.min(1, reach / prevReach);
    prevReach = reach;

    segments.push({
      index: i + 1,
      multiplier: mult,
      survive,
      reach,
      level,
      width: 0.75 + ((r * 7919) % 1) * 0.35,  // 0.75–1.10
      gap: 0.6 + ((g * 104729) % 1) * 0.8,    // 0.6–1.4
    });
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
