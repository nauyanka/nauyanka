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
| Boşluk | Bahis yap / Yürü |
| C | Cash out |

## Mekanik

- Her tur **rastgele parkur**: 8–14 kalas, çarpanlar küçükten büyüğe (1.2× … 10000×). Çarpanlar **gizlidir**; her kalasın üstünde "?" madalyonu durur.
- Adam kalasta normal yürür. Kalasa basınca gökten **şimşek** çakar ve çarpan sürpriz olarak kanatlı madalyon halinde düşer. Çarpan büyüdükçe madalyonun rengi değişir: yeşil → mavi → mor → ateş → altın → elmas (100×+).
- Şimşek bazen kötü haber getirir: adam kayar ya da kalas kırılır, bahis gider.
- Kasa avantajı %4 → **RTP %96**. i. kalasa ulaşma olasılığı `0.96 / çarpan(i)` olduğu için hangi noktada cash out yaparsan yap beklenen getiri sabittir. Büyük çarpan sıçraması = düşük geçiş şansı.
- **Provably fair**: tur başlamadan server seed'in SHA-256 hash'i gösterilir; parkur ve adım zarları `HMAC-SHA256(serverSeed, clientSeed:nonce:round)` ile üretilir; tur bitince seed açıklanır.

## Dosyalar

- `src/engine.js` — saf oyun mantığı (tarayıcı + Node)
- `src/game.js` — canvas çizimi, animasyon, UI
- `test/engine.test.js` — RTP ve determinizm testleri
- `scripts/build.js` — tek dosyalık `dist/plank-walker.html` üretir
