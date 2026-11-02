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

- Her tur **rastgele parkur**: 12–18 kalas. Kalasların %60'ı **boş** geçilir; kalanında çarpan düşer: genelde 1.5×–2×, sık sık 3×–4×, nadiren 5×/10×/20×, çok nadiren 50×. Toplam çarpan düşen çarpanların **çarpımı**dır (1.5× · 2× = 3×).
- Çarpanlar **gizlidir**; her kalasın üstünde "?" madalyonu durur. Adam kalasa basınca kısa bir gerilim olur: ya "?" sönüp **BOŞ** geçilir, ya gökten **şimşek** çakıp çarpan kanatlı madalyon halinde düşer, ya da şimşek adamı düşürür / kalası kırar ve bahis gider.
- Madalyon rengi çarpana göre: 1.5× yeşil, 2× mavi, 3×–4× mor, 5× ateş, 10×–20× altın, 50× elmas.
- Boş kalaslar risksizdir; risk çarpan düşen kalaslarda toplanır (büyük çarpan = o kalasta büyük düşme ihtimali).
- Kasa avantajı %4 → **RTP %96**. i. kalasa ulaşma olasılığı `0.96 / çarpan(i)` olduğu için hangi noktada cash out yaparsan yap beklenen getiri sabittir. Büyük çarpan sıçraması = düşük geçiş şansı.
- **Provably fair**: tur başlamadan server seed'in SHA-256 hash'i gösterilir; parkur ve adım zarları `HMAC-SHA256(serverSeed, clientSeed:nonce:round)` ile üretilir; tur bitince seed açıklanır.

## Dosyalar

- `src/engine.js` — saf oyun mantığı (tarayıcı + Node)
- `src/game.js` — canvas çizimi, animasyon, UI
- `test/engine.test.js` — RTP ve determinizm testleri
- `scripts/build.js` — tek dosyalık `dist/plank-walker.html` üretir
