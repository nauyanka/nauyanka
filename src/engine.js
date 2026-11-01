/**
 * Plank Walker — oyun motoru (saf mantık, UI yok).
 * Tarayıcıda ve Node'da çalışır.
 *
 * Mekanik:
 *  - Kalas N segmentten oluşur. Her segmentin bir çarpanı vardır (1.2x ... 50x+).
 *  - Oyuncu her adımda ya bir sonraki segmente güvenle geçer ya da kayar/düşer.
 *  - i. segmente ulaşma olasılığı: P(i) = (1 - HOUSE_EDGE) / M(i)
 *    Böylece oyuncu nerede cash out yaparsa yapsın beklenen getiri sabittir (RTP).
 *  - Adım hayatta kalma olasılığı: S(i) = P(i) / P(i-1)
 */

const HOUSE_EDGE = 0.04; // %4 kasa avantajı → RTP %96

// Zorluk profilleri: segment çarpanları
const DIFFICULTIES = {
  easy:   [1.15, 1.32, 1.52, 1.75, 2.02, 2.33, 2.70, 3.14, 3.66, 4.28, 5.0, 5.9, 7.0, 8.3, 10, 12, 14.5, 17.5, 21, 25],
  medium: [1.4, 1.95, 2.7, 3.8, 5.3, 7.4, 10.3, 14.4, 20, 28, 39, 55, 77, 108, 150],
  hard:   [1.9, 3.6, 6.8, 13, 25, 48, 90, 170, 325, 620],
  insane: [3.5, 12, 42, 150, 520, 1800],
};

/**
 * Verilen zorluk için her segmentin ulaşma olasılığı ve adım hayatta kalma olasılığını döndürür.
 */
function buildTrack(difficulty) {
  const mults = DIFFICULTIES[difficulty];
  if (!mults) throw new Error(`Bilinmeyen zorluk: ${difficulty}`);
  let prevReach = 1;
  return mults.map((m, i) => {
    const reach = (1 - HOUSE_EDGE) / m;          // başlangıçtan bu segmente ulaşma
    const survive = Math.min(1, reach / prevReach); // bir önceki segmentten bu segmente geçiş
    prevReach = reach;
    return { index: i, multiplier: m, reach, survive };
  });
}

/**
 * Provably fair: serverSeed + clientSeed + nonce → her adım için [0,1) sayı.
 * HMAC-SHA256 ile üretilir; her 4 byte bir adıma karşılık gelir.
 * `hmacHex` fonksiyonu dışarıdan verilir (WebCrypto veya Node crypto).
 */
async function generateStepRolls(hmacHex, serverSeed, clientSeed, nonce, steps) {
  const rolls = [];
  let round = 0;
  while (rolls.length < steps) {
    const hex = await hmacHex(serverSeed, `${clientSeed}:${nonce}:${round}`);
    for (let i = 0; i + 8 <= hex.length && rolls.length < steps; i += 8) {
      rolls.push(parseInt(hex.slice(i, i + 8), 16) / 0x100000000);
    }
    round++;
  }
  return rolls;
}

/**
 * Tur sonucunu hesaplar: adam hangi segmentte düşer (ya da hiç düşmez).
 * fallAt === track.length ise oyuncu kalasın sonuna kadar sağ salim gider.
 */
function resolveRound(track, rolls) {
  for (let i = 0; i < track.length; i++) {
    if (rolls[i] >= track[i].survive) return { fallAt: i };
  }
  return { fallAt: track.length };
}

/**
 * Kayma mı yoksa düşme mi? Sadece görsel çeşitlilik için (sonucu etkilemez).
 */
function failStyle(roll) {
  return roll > 0.5 ? 'slip' : 'fall';
}

function payout(bet, multiplier) {
  return Math.floor(bet * multiplier * 100) / 100;
}

const api = { HOUSE_EDGE, DIFFICULTIES, buildTrack, generateStepRolls, resolveRound, failStyle, payout };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlankEngine = api;
