# Plank Walker

Stake tarzı "kalas yürüyüşü" oyunu. Oyuncu bahis yapar, adam kalas üzerinde adım adım ilerler, her adımda gökten bir çarpan (1.4×, 2.7× … 50×, 150×…) düşer ve bahis o çarpanla katlanır. İstediğin an **Cash Out** yapabilirsin; ama her adımda kayma/düşme ihtimali vardır ve düşersen bahis gider.

## Çalıştırma

```bash
npm start      # http://localhost:3000
npm test       # motor testleri (RTP, determinizm)
```

Ya da `index.html` dosyasını doğrudan tarayıcıda aç.

## Kontroller

| Tuş | İşlev |
|-----|-------|
| Boşluk | Bahis yap / Adım at |
| C | Cash out |

## Mekanik

- Dört zorluk: Kolay (20 segment, 25×'e kadar), Orta (150×), Zor (620×), Çılgın (1800×).
- Kasa avantajı %4 → **RTP %96**. i. segmente ulaşma olasılığı `0.96 / çarpan(i)` olduğu için hangi noktada cash out yaparsan yap beklenen getiri sabittir.
- **Provably fair**: tur başlamadan server seed'in SHA-256 hash'i gösterilir; adım zarları `HMAC-SHA256(serverSeed, clientSeed:nonce:round)` ile üretilir; tur bitince seed açıklanır.

## Dosyalar

- `src/engine.js` — saf oyun mantığı (tarayıcı + Node)
- `src/game.js` — canvas çizimi, animasyon, UI
- `test/engine.test.js` — RTP ve determinizm testleri
