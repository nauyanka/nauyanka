/* Plank Walker — oyun döngüsü, canvas çizimi ve UI bağlama */
(() => {
  const E = window.PlankEngine;
  const $ = (s) => document.querySelector(s);

  // ---------- Provably fair yardımcıları (WebCrypto) ----------
  const enc = new TextEncoder();
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha256Hex = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  const hmacHex = async (key, msg) => {
    const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  };
  const randomSeed = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

  // ---------- Sabitler ----------
  const SEG_W = 170;         // bir kalas bölümünün uzunluğu
  const START_W = 240;       // başlangıç platformu
  const BADGE_LIFT = 215;    // madalyonun kalas üstünden yüksekliği
  const WALK_SPEED = 150;    // px/sn
  const PLANK_H = 22;

  // Çarpan kademeleri: büyüdükçe daha "cool" ve değerli görünüm
  const TIERS = [
    { orb: ['#b6ffb0', '#1fcf3f', '#06501c'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#fdfd8c', '#9cf528'], extrude: '#c2185b', glow: '#4dff7a' },
    { orb: ['#c6ecff', '#2a8df0', '#0a2f72'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#ffffff', '#86dcff'], extrude: '#0b3f8a', glow: '#55c8ff' },
    { orb: ['#efd4ff', '#9a3cf0', '#2f0a66'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#fff0ff', '#e1a2ff'], extrude: '#5a0e9e', glow: '#cf7bff' },
    { orb: ['#ffe2a0', '#ff6a1f', '#5e100a'], ring: ['#fff0a0', '#f2b300', '#8a4a00'], text: ['#fff9c8', '#ffb347'], extrude: '#8a1a0a', glow: '#ff8a2a' },
    { orb: ['#fff9d6', '#ffc400', '#6b4500'], ring: ['#ffffff', '#ffd54a', '#b07a00'], text: ['#ffffff', '#ffe36b'], extrude: '#9a5a00', glow: '#ffdd33' },
    { orb: ['#ffffff', '#86f3ff', '#1c3f8e'], ring: ['#ffffff', '#cfefff', '#5f8bb5'], text: ['#ffffff', '#b6fbff'], extrude: '#1c5fa8', glow: '#ffffff', rainbow: true },
  ];
  const MYSTERY = { orb: ['#5a6f82', '#2b3d4d', '#101c26'], ring: ['#8a98a8', '#56667a', '#2f3a48'], text: ['#dfe7f0', '#8fa3b8'], extrude: '#1a2430', glow: '#6b8fb0' };
  const DEAD = { orb: ['#7a4a55', '#4a1f2a', '#1a0a0e'], ring: ['#6b6b6b', '#3f3f3f', '#222'], text: ['#ff8aa0', '#ed4163'], extrude: '#3a0a14', glow: '#ed4163' };

  // ---------- Durum ----------
  const state = {
    balance: 1000, bet: 10,
    round: null,            // E.Round — sonsuz, tembel segment akışı
    track: [],              // şimdiye kadar üretilen segmentler (round.segments)
    position: 0,            // 0 = başlangıç platformu, i = i. kalas
    playing: false, busy: false,
    serverSeed: randomSeed(), nonce: 0,
    history: [],
    auto: { running: false, cash: false, target: 1.1 },
    walkTimer: null,        // bir sonraki kalasa otomatik yürüyüş zamanlayıcısı
  };
  const PAUSE_AFTER_BONUS = 1500;  // çarpan açıldıktan sonra duraklama (ms) — Bahis Bozdur fırsatı
  const PAUSE_AFTER_EMPTY = 900;

  const segCenter = (i) => START_W + i * SEG_W + SEG_W / 2;   // i: 0 tabanlı kalas indeksi
  // Madalyon durumu kalas başına; sonsuz parkur için lazım oldukça oluşturulur
  const badgeAt = (i) => (anim.badges[i] ??= { state: 'hidden', y: -BADGE_LIFT, t: 0, bob: i * 1.3 });
  const visibleRange = () => {
    const first = Math.max(0, Math.floor((anim.camX - START_W) / SEG_W) - 1);
    const last = Math.ceil((anim.camX + LW - START_W) / SEG_W) + 1;
    return [first, last];
  };

  // ---------- Animasyon ----------
  const anim = {
    wx: START_W / 2, wy: 0,
    walk: null,            // { from, to, t, dur, onDone }
    phase: 0,              // yürüme döngüsü fazı
    walkBlend: 0,          // 0 = duruyor, 1 = yürüyor
    strike: null,          // { seg, t, x, fail }
    bolt: null,            // { pts, branches, t }
    flash: 0,
    fail: null,            // { style, t, x0 }
    celebrate: 0,
    badges: [],            // kalas başına: { state: 'hidden'|'drop'|'land'|'rest'|'dead', y, t, bob }
    debris: [],            // kırılan kalas parçaları
    particles: [],
    floaters: [],          // yükselen küçük yazılar ("BOŞ")
    camX: 0, shake: 0,
    counter: { shown: 1, target: 1 },
    time: 0,
  };

  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  let Z = 1, LW = 0, LH = 0;   // Z: dünya ölçeği (dar ekranda küçülür); LW/LH: mantıksal görünüm
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    Z = W < 640 ? 0.68 : W < 900 ? 0.85 : 1;
    LW = W / Z; LH = H / Z;
  }
  window.addEventListener('resize', resize);
  resize();

  const groundY = () => LH * 0.66;
  const sx = (x) => x - anim.camX;
  const sy = (y) => groundY() + y;

  // ---------- UI ----------
  const MIN_BET = 0.2;
  const fmt = (n) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TRY';
  const ui = {
    balance: $('#balance'), bet: $('#bet'), betLabel: $('#bet-label'), betMinus: $('#bet-minus'), betPlus: $('#bet-plus'),
    btnBet: $('#btn-bet'), btnCash: $('#btn-cashout'), cashAmt: $('#cashout-amount'), roundActions: $('#round-actions'),
    tabs: document.querySelectorAll('.tab'), autoRow: $('#auto-row'), autoBet: $('#auto-bet'), autoCash: $('#auto-cash'), autoTarget: $('#auto-target'), autoClear: $('#auto-clear'),
    curMult: $('#cur-mult'), potential: $('#potential'), remaining: $('#remaining'),
    seedHash: $('#seed-hash'), clientSeed: $('#client-seed'), nonce: $('#nonce'), revealed: $('#revealed-seed'),
    history: $('#history'), toast: $('#toast'), preview: $('#track-preview'),
  };

  const currentMultiplier = () => (state.position === 0 ? 1 : state.track[state.position - 1].multiplier);
  const betValue = () => Math.max(0, Math.round((parseFloat(ui.bet.value) || 0) * 100) / 100);
  function setBet(v) {
    v = Math.max(MIN_BET, Math.round(v * 100) / 100);
    ui.bet.value = v.toFixed(2);
    if (!state.playing) refreshUI();
  }
  const betStep = (v) => (v < 1 ? 0.1 : v < 10 ? 0.5 : v < 100 ? 1 : 10);
  const bonusLabel = (b) => (Number.isInteger(b) ? b : b.toFixed(1)) + 'x';

  function refreshUI() {
    ui.balance.textContent = fmt(state.balance);
    ui.curMult.textContent = currentMultiplier().toFixed(2) + '×';
    ui.potential.textContent = state.playing ? fmt(E.payout(state.bet, currentMultiplier())) : fmt(0);
    ui.remaining.textContent = state.playing ? String(state.position) : '—';
    const autoRunning = state.auto.running;
    ui.btnBet.hidden = state.playing && !autoRunning;
    ui.roundActions.hidden = !state.playing;
    ui.btnBet.classList.toggle('compact', state.playing && autoRunning);
    ui.btnBet.classList.toggle('stop', autoRunning);
    ui.btnBet.innerHTML = autoRunning ? 'Durdur<small>Oto bahis açık</small>' : `Bahis<small><span id="bet-label">${betValue().toFixed(2)}</span> TRY</small>`;
    ui.btnCash.disabled = !state.playing || state.position === 0 || !!anim.fail;
    ui.cashAmt.textContent = state.playing && state.position > 0 ? fmt(E.payout(state.bet, currentMultiplier())) : '—';
    ui.bet.disabled = ui.betMinus.disabled = ui.betPlus.disabled = state.playing;
    document.querySelectorAll('.quick button').forEach((b) => (b.disabled = state.playing));
    ui.nonce.textContent = state.nonce;
    const shown = state.track.slice(Math.max(0, state.position - 11), state.position + 1);
    const offset = Math.max(0, state.position - 11);
    ui.preview.innerHTML = shown.map((s, k) => {
      const i = offset + k, b = anim.badges[i];
      const dead = b && b.state === 'dead';
      const revealed = i < state.position || dead;
      const cls = dead ? 'dead' : i < state.position ? (s.bonus > 1 ? 'done' : 'empty') : i === state.position && state.playing ? 'cur' : '';
      const label = dead ? '✕' : !revealed ? '?' : s.bonus > 1 ? bonusLabel(s.bonus) : '—';
      return `<span class="seg ${cls}">${label}</span>`;
    }).join('');
  }

  async function showSeedHash() { ui.seedHash.textContent = await sha256Hex(state.serverSeed); }

  function toast(text, cls) {
    ui.toast.textContent = text;
    ui.toast.className = 'toast show ' + cls;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (ui.toast.className = 'toast'), 2400);
  }

  function pushHistory(label, win) {
    state.history.unshift({ label, win });
    state.history = state.history.slice(0, 10);
    ui.history.innerHTML = state.history.map((h) => `<span class="chip ${h.win ? 'win' : 'lose'}">${h.label}</span>`).join('');
  }

  // ---------- Tur akışı ----------
  async function startRound() {
    if (state.playing) return;
    const bet = betValue();
    if (!(bet >= MIN_BET)) { stopAuto(); return toast(`En az ${fmt(MIN_BET)} bahis gir`, 'lose'); }
    if (bet > state.balance) { stopAuto(); return toast('Yetersiz bakiye', 'lose'); }

    state.bet = Math.round(bet * 100) / 100;
    state.balance -= state.bet;
    state.nonce += 1;
    state.round = E.createRound(hmacHex, state.serverSeed, ui.clientSeed.value || 'plank-walker', state.nonce);
    state.track = state.round.segments;
    state.position = 0; state.playing = true; state.busy = false;

    anim.wx = START_W / 2; anim.wy = 0; anim.phase = 0;
    anim.walk = null; anim.strike = null; anim.bolt = null; anim.fail = null; anim.debris = []; anim.particles = []; anim.floaters = [];
    anim.counter = { shown: 1, target: 1 }; anim.celebrate = 0;
    anim.badges = [];
    refreshUI();
    scheduleStep(500); // bahisten sonra adam kendiliğinden yürür
  }

  function scheduleStep(ms) {
    clearTimeout(state.walkTimer);
    state.walkTimer = setTimeout(() => { if (state.playing && !state.busy) step(); }, ms);
  }

  async function step() {
    if (!state.playing || state.busy) return;
    const i = state.position;
    state.busy = true; refreshUI();
    const seg = await state.round.segment(i); // segment seed'den lazım oldukça üretilir
    const to = segCenter(i);
    anim.walk = {
      from: anim.wx, to, t: 0, dur: Math.abs(to - anim.wx) / WALK_SPEED,
      onDone: () => {
        anim.wx = to;
        // Boş kalaslarda gerilim kısa; çarpan ya da düşüş varsa uzun
        anim.strike = { seg: i, t: 0, x: to, fail: seg.fell, delay: seg.fell || seg.bonus > 1 ? 0.75 : 0.35 };
      },
    };
  }

  // Şimşek çarpar, çarpan açıklanır (ya da adam düşer)
  function resolveStrike(s) {
    const i = s.seg, seg = state.track[i], badge = badgeAt(i);
    if (s.fail) {
      // Kayıp her zaman aynı: şimşek kalası vurur, altındaki tahtalar kırılır, adam düşer
      badge.state = 'dead'; badge.t = 0;
      anim.fail = { t: 0, x0: anim.wx };
      anim.shake = 16;
      spawnDebris(i);
      burst(anim.wx, 0, '#c9a227', 30);
      burst(anim.wx, -BADGE_LIFT, '#ed4163', 30);
      setTimeout(() => endRound(false), 1500);
    } else if (seg.bonus === 1) {
      // Boş kalas: "?" madalyonu sönüp dağılır, adam yoluna devam eder
      state.position = i + 1;
      badge.state = 'empty'; badge.t = 0;
      anim.floaters.push({ x: anim.wx, y: -BADGE_LIFT, t: 0, text: 'BOŞ' });
      burst(anim.wx, -BADGE_LIFT, '#6b8fb0', 12);
      setTimeout(() => afterReveal(), 250);
    } else {
      state.position = i + 1;
      badge.state = 'drop'; badge.t = 0; badge.y = -LH;
      anim.counter.target = seg.multiplier;
      anim.celebrate = 0.9;
      anim.shake = 6 + E.tierOf(seg.bonus) * 2;
      if (seg.multiplier >= E.MAX_MULTIPLIER) { toast('Maksimum çarpan! Otomatik ödeme', 'win'); setTimeout(() => cashOut(true), 900); return; }
      setTimeout(() => afterReveal(), 450);
    }
    refreshUI();
  }

  // Kalas çözüldükten sonra: oto para çekme hedefi tutuyorsa çek, oto bahis açıksa yürümeye devam et
  function afterReveal() {
    if (!state.playing) return;
    state.busy = false; refreshUI();
    if (state.auto.cash && state.position > 0 && currentMultiplier() >= state.auto.target) { cashOut(true); return; }
    // Her kalasta kısa bir duraklama: oyuncu Bahis Bozdur'a basabilir; sonra adam yoluna devam eder
    const lastBonus = state.track[state.position - 1]?.bonus ?? 1;
    scheduleStep(lastBonus > 1 ? PAUSE_AFTER_BONUS : PAUSE_AFTER_EMPTY);
  }

  function stopAuto() {
    state.auto.running = false;
    ui.autoBet.checked = false;
    refreshUI();
  }

  function cashOut(auto = false) {
    // Yürürken de bozdurulabilir: adam durur, o ana kadar AÇILMIŞ çarpan ödenir (açılmamış kalas sayılmaz)
    if (!state.playing || state.position === 0 || anim.fail) return;
    if (anim.strike && anim.strike.hit && anim.strike.fail) return; // şimşek çoktan düşürdü
    clearTimeout(state.walkTimer);
    anim.walk = null; anim.strike = null;
    const mult = currentMultiplier();
    const win = E.payout(state.bet, mult);
    state.balance += win;
    burst(anim.wx, -70, '#ffd54a', 90);
    anim.celebrate = 1.5;
    toast(`${mult.toFixed(2)}× · ${fmt(win)} kazandın!`, 'win');
    pushHistory(mult.toFixed(2) + '×', true);
    endRound(true, true);
  }

  async function endRound(won, keepToast = false) {
    if (!won && !keepToast) {
      toast(`Kalas kırıldı! ${fmt(state.bet)} gitti`, 'lose');
      pushHistory('✕ ' + currentMultiplier().toFixed(2) + '×', false);
    }
    state.playing = false; state.busy = false; clearTimeout(state.walkTimer);
    ui.revealed.textContent = state.serverSeed;
    state.serverSeed = randomSeed(); state.nonce = 0;
    await showSeedHash();
    refreshUI();
    if (state.auto.running) setTimeout(() => { if (state.auto.running && !state.playing) startRound(); }, 1600);
  }

  // ---------- Parçacıklar / enkaz ----------
  function burst(x, y, color, n = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 280;
      anim.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 140, life: 0.7 + Math.random() * 0.7, color, size: 2 + Math.random() * 4 });
    }
  }
  function spawnDebris(i) {
    const x0 = START_W + i * SEG_W;
    const n = 6, w = SEG_W / n;
    for (let k = 0; k < n; k++) {
      const c = k - (n - 1) / 2;
      anim.debris.push({ x: x0 + k * w, y: 0, w, vx: c * 55, vy: -90 - Math.random() * 60 + Math.abs(c) * 10, rot: 0, vr: c * 2.5 + (Math.random() - 0.5) * 3 });
    }
  }
  function updateParticles(dt) {
    for (const p of anim.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; p.life -= dt; }
    anim.particles = anim.particles.filter((p) => p.life > 0);
    for (const d of anim.debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 1300 * dt; d.rot += d.vr * dt; }
    for (const f of anim.floaters) f.t += dt;
    anim.floaters = anim.floaters.filter((f) => f.t < 1.2);
  }

  // ---------- Şimşek ----------
  function makeBolt(x, yTopScreen, yBottom) {
    const pts = [{ x, y: yTopScreen }];
    const n = 14;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push({ x: x + (Math.random() - 0.5) * 70 * (1 - t * 0.6), y: yTopScreen + (yBottom - yTopScreen) * t });
    }
    pts[n].x = x;
    const branches = [];
    for (let b = 0; b < 3; b++) {
      const start = pts[3 + Math.floor(Math.random() * 7)];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const bp = [start];
      for (let k = 1; k <= 4; k++) bp.push({ x: start.x + dir * k * (14 + Math.random() * 10), y: start.y + k * (12 + Math.random() * 14) });
      branches.push(bp);
    }
    return { pts, branches, t: 0 };
  }
  function drawBolt(b) {
    const a = Math.max(0, 1 - b.t / 0.4);
    if (a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const path = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); };
    for (const [w, col] of [[18, `rgba(120,190,255,${0.25 * a})`], [8, `rgba(180,225,255,${0.6 * a})`], [3, `rgba(255,255,255,${a})`]]) {
      ctx.lineWidth = w; ctx.strokeStyle = col; path(b.pts); ctx.stroke();
      for (const br of b.branches) { ctx.lineWidth = w * 0.5; path(br); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ---------- Güncelleme ----------
  function update(dt) {
    anim.time += dt;
    // yürüyüş → duruş geçişi
    anim.walkBlend += ((anim.walk ? 1 : 0) - anim.walkBlend) * Math.min(1, dt * 9);
    // yürüyüş
    if (anim.walk) {
      const w = anim.walk; w.t += dt;
      const p = Math.min(1, w.t / w.dur);
      anim.wx = w.from + (w.to - w.from) * p;
      anim.phase += dt * (WALK_SPEED / 15.5); // adım uzunluğu ≈ 47px → faz hızı yere uyar
      if (p >= 1) { const cb = w.onDone; anim.walk = null; cb(); }
    } else {
      // dururken bacaklar toplanır (walkBlend → 0)
    }
    // şimşek gerilimi → çarpma
    if (anim.strike) {
      const s = anim.strike; s.t += dt;
      if (!s.hit && s.t >= s.delay) {
        s.hit = true;
        if (s.fail || state.track[s.seg].bonus > 1) {
          anim.bolt = makeBolt(sx(s.x), -20, s.fail ? sy(0) : sy(-BADGE_LIFT));
          anim.flash = 1;
        }
        resolveStrike(s);
      }
      if (s.t > 1.2) anim.strike = null;
    }
    if (anim.bolt) { anim.bolt.t += dt; if (anim.bolt.t > 0.5) anim.bolt = null; }
    anim.flash = Math.max(0, anim.flash - dt * 4);
    anim.celebrate = Math.max(0, anim.celebrate - dt);
    // madalyonlar
    for (const b of anim.badges) {
      if (!b) continue;
      b.t += dt;
      if (b.state === 'empty') continue;
      if (b.state === 'drop') {
        b.y += 2400 * dt;
        if (b.y >= -BADGE_LIFT) { b.y = -BADGE_LIFT; b.state = 'land'; b.t = 0; }
      } else if (b.state === 'land') {
        if (b.t > 0.4) b.state = 'rest';
      }
    }
    // düşüş
    if (anim.fail) {
      const f = anim.fail; f.t += dt;
      anim.wy = f.t > 0.1 ? Math.pow(f.t - 0.1, 2) * 1700 : 0;
    }
    // kamera
    const camT = Math.max(0, anim.wx - LW * 0.4);
    anim.camX += (camT - anim.camX) * Math.min(1, dt * 4);
    anim.shake = Math.max(0, anim.shake - dt * 28);
    anim.counter.shown += (anim.counter.target - anim.counter.shown) * Math.min(1, dt * 5);
    updateParticles(dt);
  }

  // ---------- Çizim: arka plan ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, '#060e18'); g.addColorStop(0.5, '#0e2233'); g.addColorStop(1, '#050c12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);

    // fırtına bulutları (gerilim anında aydınlanır)
    const tension = anim.strike ? Math.min(1, anim.strike.t / 0.75) : 0;
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const cx = (((i * 311) - anim.camX * 0.15) % (LW + 300) + LW + 300) % (LW + 300) - 150;
      const cy = 30 + (i % 3) * 28;
      const cg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 150);
      const lum = 0.1 + tension * 0.18 + anim.flash * 0.5;
      cg.addColorStop(0, `rgba(120,150,200,${lum})`); cg.addColorStop(1, 'rgba(120,150,200,0)');
      ctx.fillStyle = cg; ctx.fillRect(cx - 160, cy - 160, 320, 320);
    }
    ctx.restore();

    // spot ışıkları
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const bx = LW * (0.2 + i * 0.3) + Math.sin(anim.time * 0.35 + i * 2) * 70 - anim.camX * 0.06;
      const beam = ctx.createLinearGradient(bx, 0, bx, LH * 0.9);
      beam.addColorStop(0, 'rgba(255,215,120,0.07)'); beam.addColorStop(1, 'rgba(255,215,120,0)');
      ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(bx - 30, 0); ctx.lineTo(bx + 30, 0); ctx.lineTo(bx + 240, LH * 0.9); ctx.lineTo(bx - 240, LH * 0.9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // yıldız / altın tozu
    for (let i = 0; i < 80; i++) {
      const x = (((i * 137.5) - anim.camX * 0.12) % LW + LW) % LW, y = (i * 61.8) % (LH * 0.62);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(anim.time * 1.5 + i));
      ctx.fillStyle = i % 6 === 0 ? `rgba(255,215,90,${tw})` : `rgba(255,255,255,${tw * 0.5})`;
      ctx.fillRect(x, y, i % 6 === 0 ? 2.5 : 1.5, i % 6 === 0 ? 2.5 : 1.5);
    }

    // uzak dağlar
    ctx.fillStyle = '#0a1826';
    ctx.beginPath(); ctx.moveTo(0, LH);
    for (let x = 0; x <= LW + 40; x += 40) {
      const wx = x + anim.camX * 0.25;
      ctx.lineTo(x, sy(30) + Math.sin(wx * 0.004) * 50 + Math.sin(wx * 0.013) * 25);
    }
    ctx.lineTo(LW, LH); ctx.closePath(); ctx.fill();

    // uçurum sisi
    const fog = ctx.createLinearGradient(0, sy(40), 0, LH);
    fog.addColorStop(0, 'rgba(5,12,18,0)'); fog.addColorStop(1, 'rgba(3,8,14,0.97)');
    ctx.fillStyle = fog; ctx.fillRect(0, sy(40), LW, LH);
  }

  // ---------- Çizim: platformlar ve kalas ----------
  function drawPillar(x, w) {
    const px = sx(x), py = sy(0);
    const g = ctx.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0, '#22384a'); g.addColorStop(0.5, '#345064'); g.addColorStop(1, '#1b2d3c');
    ctx.fillStyle = g; ctx.fillRect(px, py + 12, w, LH);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    for (let y = py + 44; y < LH; y += 34) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + w, y); ctx.stroke(); }
  }
  function drawPlatform(x, w, label, colors) {
    drawPillar(x, w);
    const px = sx(x), py = sy(0);
    const g = ctx.createLinearGradient(0, py, 0, py + 30);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(px, py - 4, w, 34, 6); ctx.fill();
    ctx.fillStyle = '#ffd54a'; ctx.fillRect(px, py - 4, w, 3);
    ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText(label, px + w / 2, py + 18);
  }
  function drawPlankSegment(x, w, y, rot, broken) {
    ctx.save(); ctx.translate(sx(x) + w / 2, sy(y)); ctx.rotate(rot); ctx.translate(-w / 2, 0);
    const h = PLANK_H;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, broken ? '#7a4a25' : '#b87333'); g.addColorStop(0.5, broken ? '#5e361a' : '#9a5a26'); g.addColorStop(1, broken ? '#3a2010' : '#6b3c17');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(40,20,5,.35)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(4, 5 + i * 6);
      ctx.bezierCurveTo(w * 0.3, 3 + i * 6 + (i % 2) * 3, w * 0.7, 8 + i * 6, w - 4, 5 + i * 6); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,220,160,.25)'; ctx.fillRect(2, 1, w - 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, h, w, 5);
    ctx.restore();
  }
  function drawRope(x) {
    const px = sx(x), py = sy(0);
    ctx.strokeStyle = '#6b5436'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, -10); ctx.lineTo(px, py); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px - 1, -10); ctx.lineTo(px - 1, py); ctx.stroke();
    ctx.fillStyle = '#c9a227'; ctx.fillRect(px - 5, py - 6, 10, PLANK_H + 10);
  }

  function drawStage() {
    const [first, last] = visibleRange();
    const brokenIdx = anim.fail ? state.position : -1;
    for (let i = first; i <= last; i++) {
      if (i === brokenIdx) continue;
      drawPlankSegment(START_W + i * SEG_W, SEG_W, 0, 0, false);
    }
    for (let i = first; i <= last + 1; i++) drawRope(START_W + i * SEG_W);
    for (const d of anim.debris) drawPlankSegment(d.x, d.w, d.y, d.rot, true);
    drawPlatform(0, START_W, 'BAŞLANGIÇ', ['#4a6a82', '#2a3f52']);
    // numaralar
    ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center';
    for (let i = first; i <= last; i++) {
      ctx.fillStyle = i < state.position ? 'rgba(0,231,1,.75)' : 'rgba(255,255,255,.3)';
      ctx.fillText(String(i + 1), sx(segCenter(i)), sy(0) + 44);
    }
  }

  // ---------- Çizim: madalyon ----------
  const spriteCache = new Map();
  function badgeSprite(key, T) {
    if (spriteCache.has(key)) return spriteCache.get(key);
    const size = 260, c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.translate(size / 2, size / 2);
    const R = 46;
    for (const dir of [-1, 1]) {
      g.save(); g.scale(dir, 1);
      for (let f = 0; f < 5; f++) {
        const ang = -0.9 + f * 0.26, len = 70 - f * 7, wdt = 16 - f * 1.6;
        g.save(); g.translate(R + 4, 6 + f * 4); g.rotate(ang);
        const wg = g.createLinearGradient(0, 0, len, 0);
        wg.addColorStop(0, T.ring[1]); wg.addColorStop(0.6, T.ring[0]); wg.addColorStop(1, T.ring[2]);
        g.fillStyle = wg; g.beginPath(); g.ellipse(len / 2, 0, len / 2, wdt / 2, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      g.restore();
    }
    const rg = g.createLinearGradient(0, -R, 0, R);
    rg.addColorStop(0, T.ring[0]); rg.addColorStop(0.5, T.ring[1]); rg.addColorStop(1, T.ring[2]);
    g.lineWidth = 11; g.strokeStyle = rg; g.beginPath(); g.arc(0, 0, R + 5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(0, 0, R + 10.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, 0, R + 1, 0, Math.PI * 2); g.stroke();
    const og = g.createRadialGradient(-R * 0.35, -R * 0.4, 4, 0, 0, R);
    og.addColorStop(0, T.orb[0]); og.addColorStop(0.5, T.orb[1]); og.addColorStop(1, T.orb[2]);
    g.fillStyle = og; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 6;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(10 - i * 8, 8 - i * 6, 20 + i * 9, 0.6 + i, 2.6 + i); g.stroke(); }
    g.restore();
    const hg = g.createRadialGradient(-R * 0.4, -R * 0.5, 2, -R * 0.4, -R * 0.5, R * 0.6);
    hg.addColorStop(0, 'rgba(255,255,255,.75)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg; g.beginPath(); g.ellipse(-R * 0.35, -R * 0.45, R * 0.5, R * 0.3, -0.6, 0, Math.PI * 2); g.fill();
    spriteCache.set(key, c);
    return c;
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  function drawBadge(i) {
    const b = badgeAt(i), seg = state.track[i];
    const hidden = b.state === 'hidden' || b.state === 'empty';
    const tier = seg ? E.tierOf(seg.bonus) : 0;
    const T = b.state === 'dead' ? DEAD : hidden ? MYSTERY : TIERS[tier];
    const key = b.state === 'dead' ? 'dead' : hidden ? 'mystery' : tier;
    const bobY = (hidden || b.state === 'rest') ? Math.sin(anim.time * 2 + b.bob) * 5 : 0;
    const x = sx(segCenter(i)), y = sy(b.y) + bobY;
    let s = hidden ? 0.52 : 0.8 + tier * 0.03;
    if (b.state === 'land') s *= 1 + Math.sin(Math.min(1, b.t / 0.4) * Math.PI) * 0.3;
    if (b.state === 'dead') s *= 0.8;
    let fade = 1;
    if (b.state === 'empty') { if (b.t > 0.45) return; fade = 1 - b.t / 0.45; s *= 1 - b.t / 0.45 * 0.5; }
    const tension = anim.strike && anim.strike.seg === i && !anim.strike.hit ? Math.min(1, anim.strike.t / 0.75) : 0;

    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = fade;
    // ışıma
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ga = hidden ? 0.08 + tension * 0.5 + Math.sin(anim.time * 10) * tension * 0.2 : 0.22 + 0.12 * Math.sin(anim.time * 3 + b.bob) + (b.state === 'land' ? 0.5 : 0) + (typeof key === 'number' ? key * 0.04 : 0);
    const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 95 * s);
    glow.addColorStop(0, hexA(T.glow, ga)); glow.addColorStop(1, hexA(T.glow, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 95 * s, 0, Math.PI * 2); ctx.fill();
    if (T.rainbow && !hidden) {
      ctx.rotate(anim.time * 1.2);
      for (let k = 0; k < 8; k++) {
        ctx.rotate(Math.PI / 4);
        const rg = ctx.createLinearGradient(0, 0, 0, -115 * s);
        rg.addColorStop(0, `hsla(${(anim.time * 90 + k * 45) % 360},100%,70%,.35)`); rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(0, -115 * s); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();

    ctx.scale(s, s);
    ctx.drawImage(badgeSprite(key, T), -130, -130, 260, 260);
    const label = hidden || !seg ? '?' : b.state === 'dead' ? '✕' : bonusLabel(seg.bonus);
    const fs = hidden ? 54 : label.length > 4 ? 30 : label.length > 3 ? 36 : 42;
    ctx.font = `900 ${fs}px Inter, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let d = 5; d >= 1; d--) { ctx.fillStyle = T.extrude; ctx.fillText(label, 0, d); }
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(label, 0, 0);
    const tg = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
    tg.addColorStop(0, T.text[0]); tg.addColorStop(1, T.text[1]);
    ctx.fillStyle = tg; ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  // ---------- Çizim: karakter (çubuk adam, biyomekanik yürüyüş) ----------
  // Uzuv boyları (px, karakter ölçeği öncesi). Ayaklar yerde y=0.
  const S = { thigh: 27, shin: 27, foot: 11, torso: 36, neck: 7, head: 10.5, upperArm: 20, foreArm: 18, pelvis: 5, shoulder: 7 };
  const WALKER_SCALE = 1.15;
  const STICK = { line: '#f3f6fb', outline: '#0b1118', width: 5.5 };

  /**
   * Yürüme döngüsü: φ ∈ [0, 2π) sol bacağın bir adım döngüsü (0 = topuk vuruşu, π = parmak ucu itişi).
   * Sağ bacak π kaymalı. Açılar radyan; kalça/kol: dikeyden öne doğru pozitif; diz/dirsek: bükülme.
   */
  function gaitLeg(φ) {
    φ = ((φ % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const stance = φ < Math.PI;
    const hip = 0.40 * Math.cos(φ) - 0.05;
    const knee = stance
      ? 0.12 * Math.sin(2 * φ) ** 2 + 0.45 * Math.max(0, Math.sin(φ - Math.PI / 2)) ** 2   // yük kabulü + itiş öncesi
      : 0.45 * Math.cos((φ - Math.PI) / 2) ** 2 + 1.0 * Math.sin(φ - Math.PI);              // salınımda yüksek bükülme
    const pitch = stance ? -0.28 * Math.cos(φ) : 0.15 * Math.sin(φ - Math.PI) - 0.1;        // topuk vuruşu / parmak itişi
    return { hip, knee, pitch };
  }
  function gaitArm(φ) {
    // Kol aynı taraftaki bacağın tersine salınır; öndeyken dirsek daha bükük
    const a = -0.42 * Math.cos(φ);
    const bend = 0.35 + 0.45 * (1 - Math.cos(φ)) / 2;
    return { a, bend };
  }

  const STAND = { legL: { hip: 0.02, knee: 0.02, pitch: 0 }, legR: { hip: -0.02, knee: 0.02, pitch: 0 }, armL: { a: 0.08, bend: 0.25 }, armR: { a: -0.08, bend: 0.25 }, lean: 0, head: 0 };
  const mix = (a, b, t) => a + (b - a) * t;
  const mixObj = (A, B, t) => Object.fromEntries(Object.keys(A).map((k) => [k, typeof A[k] === 'object' ? mixObj(A[k], B[k], t) : mix(A[k], B[k], t)]));

  function buildPose() {
    const walking = !!anim.walk, f = anim.fail, t = anim.time;
    const tension = anim.strike && !anim.strike.hit ? Math.min(1, anim.strike.t / 0.75) : 0;
    const cheer = anim.celebrate > 0 ? Math.min(1, anim.celebrate / 0.25) : 0;
    const φ = anim.phase;
    const walk = { legL: gaitLeg(φ), legR: gaitLeg(φ + Math.PI), armL: gaitArm(φ), armR: gaitArm(φ + Math.PI), lean: 0.07, head: 0.02 };
    let pose = mixObj(STAND, walk, anim.walkBlend);
    let rot = 0, alpha = 1, lift = 0;

    if (f) {
      const k = Math.min(1, f.t / 0.5);
      pose = {
        legL: { hip: 0.9 * k + Math.sin(f.t * 14) * 0.2, knee: 0.8, pitch: 0.3 },
        legR: { hip: -0.4 * k + Math.sin(f.t * 14 + 1) * 0.2, knee: 0.5, pitch: 0.2 },
        armL: { a: 2.6 + Math.sin(f.t * 18) * 0.3, bend: 0.2 }, armR: { a: 2.4 - Math.sin(f.t * 18) * 0.3, bend: 0.2 },
        lean: 0.2, head: -0.3,
      };
      rot = Math.sin(f.t * 5) * 0.3;
      alpha = Math.max(0, 1 - Math.max(0, f.t - 0.8) * 1.5);
    } else if (cheer > 0 && !walking) {
      const hop = Math.abs(Math.sin(t * 9));
      pose = mixObj(pose, {
        legL: { hip: 0.15, knee: 0.25 - hop * 0.2, pitch: 0 }, legR: { hip: -0.15, knee: 0.25 - hop * 0.2, pitch: 0 },
        armL: { a: 2.9 + Math.sin(t * 12) * 0.15, bend: -0.4 }, armR: { a: 2.9 - Math.sin(t * 12) * 0.15, bend: -0.4 },
        lean: -0.05, head: -0.12,
      }, cheer);
      lift = hop * 6 * cheer;
    } else if (tension > 0 && !walking) {
      // Yukarı bakar, sağ elini alnına siper eder, hafif titrer
      pose = mixObj(pose, {
        legL: { hip: 0.05, knee: 0.05, pitch: 0 }, legR: { hip: -0.08, knee: 0.08, pitch: 0 },
        armL: { a: 0.15, bend: 0.3 }, armR: { a: 2.45, bend: -1.9 }, lean: -0.08, head: -0.45,
      }, tension);
      lift = Math.sin(t * 24) * tension * 0.6;
    } else if (!walking) {
      // Boşta: hafif nefes salınımı
      pose.armL.a += Math.sin(t * 2) * 0.03; pose.armR.a -= Math.sin(t * 2) * 0.03;
      lift = Math.sin(t * 2) * 0.6;
    }
    return { pose, rot, alpha, lift };
  }

  // İleri kinematik: bacak (kalça → diz → bilek → topuk/parmak)
  function legPoints(px, py, L) {
    const kx = px + Math.sin(L.hip) * S.thigh, ky = py + Math.cos(L.hip) * S.thigh;
    const a2 = L.hip - L.knee;
    const ax = kx + Math.sin(a2) * S.shin, ay = ky + Math.cos(a2) * S.shin;
    const heel = [ax - Math.cos(L.pitch) * 3, ay - Math.sin(L.pitch) * 3 + 2];
    const toe = [ax + Math.cos(L.pitch) * S.foot, ay + Math.sin(L.pitch) * S.foot + 2];
    return { knee: [kx, ky], ankle: [ax, ay], heel, toe };
  }
  function armPoints(sx0, sy0, A) {
    const ex = sx0 + Math.sin(A.a) * S.upperArm, ey = sy0 + Math.cos(A.a) * S.upperArm;
    const a2 = A.a + A.bend;
    return { elbow: [ex, ey], hand: [ex + Math.sin(a2) * S.foreArm, ey + Math.cos(a2) * S.foreArm] };
  }

  function strokePath(pts, width, color) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }

  function drawWalker() {
    const { pose, rot, alpha, lift } = buildPose();
    const x = sx(anim.wx), y = sy(anim.wy);

    // Pelvis yüksekliğini, yere basan (en alçak) ayağa göre ayarla → doğal yükselip alçalma, kayma yok
    const pelvisY0 = -(S.thigh + S.shin + 2);
    const lL = legPoints(-S.pelvis / 2, pelvisY0, pose.legL), lR = legPoints(S.pelvis / 2, pelvisY0, pose.legR);
    const lowest = Math.max(lL.heel[1], lL.toe[1], lR.heel[1], lR.toe[1]);
    const dy = anim.fail ? 0 : -lowest;
    const pelvisY = pelvisY0 + dy - lift;
    const legL = legPoints(-S.pelvis / 2, pelvisY, pose.legL), legR = legPoints(S.pelvis / 2, pelvisY, pose.legR);

    // Gövde, omuz, baş
    const shX = Math.sin(pose.lean) * S.torso, shY = pelvisY - Math.cos(pose.lean) * S.torso;
    const neckX = shX + Math.sin(pose.lean + pose.head) * S.neck, neckY = shY - Math.cos(pose.lean + pose.head) * S.neck;
    const headX = neckX + Math.sin(pose.lean + pose.head) * S.head, headY = neckY - Math.cos(pose.lean + pose.head) * S.head;
    const armL = armPoints(shX - S.shoulder / 2, shY, pose.armL), armR = armPoints(shX + S.shoulder / 2, shY, pose.armR);

    ctx.save(); ctx.globalAlpha = alpha;
    if (!anim.fail) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(x, sy(0) + 2, 16, 4.5, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.translate(x, y); ctx.scale(WALKER_SCALE, WALKER_SCALE); ctx.rotate(rot);

    const segs = [
      [[-S.pelvis / 2, pelvisY], ...Object.values({ k: legL.knee, a: legL.ankle }), legL.heel], [legL.ankle, legL.toe],
      [[S.pelvis / 2, pelvisY], legR.knee, legR.ankle, legR.heel], [legR.ankle, legR.toe],
      [[-S.pelvis / 2, pelvisY], [S.pelvis / 2, pelvisY]],
      [[0, pelvisY], [shX, shY]],
      [[shX - S.shoulder / 2, shY], [shX + S.shoulder / 2, shY]],
      [[shX - S.shoulder / 2, shY], armL.elbow, armL.hand],
      [[shX + S.shoulder / 2, shY], armR.elbow, armR.hand],
      [[shX, shY], [neckX, neckY]],
    ];
    // Arka uzuvlar (sol) biraz koyu, ön uzuvlar (sağ) parlak: derinlik hissi
    const back = new Set([0, 1, 7]);
    for (const [i, p] of segs.entries()) strokePath(p, STICK.width + 4, STICK.outline);
    ctx.beginPath(); ctx.arc(headX, headY, S.head + 2, 0, Math.PI * 2); ctx.fillStyle = STICK.outline; ctx.fill();
    for (const [i, p] of segs.entries()) strokePath(p, STICK.width, back.has(i) ? '#c3cbd8' : STICK.line);
    ctx.beginPath(); ctx.arc(headX, headY, S.head, 0, Math.PI * 2); ctx.fillStyle = STICK.line; ctx.fill();
    // Eklem noktaları
    ctx.fillStyle = STICK.line;
    for (const j of [legL.knee, legR.knee, armL.elbow, armR.elbow]) { ctx.beginPath(); ctx.arc(j[0], j[1], STICK.width / 2 + 0.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // ---------- HUD ----------
  function drawHUD() {
    ctx.textAlign = 'center';
    if (!state.playing && !anim.fail && anim.celebrate <= 0) {
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `bold ${W < 640 ? 13 : 18}px Inter, sans-serif`;
      ctx.fillText(W < 640 ? 'Bahis yap · adam yürüsün · düşmeden bozdur' : 'Bahis yap · adam yürüsün · şimşek çarpan getirsin · düşmeden Bahis Bozdur', W / 2, W < 640 ? 80 : 60);
      return;
    }
    const m = anim.counter.shown, T = TIERS[E.tierOf(Math.max(1, m))];
    const narrow = W < 640, fs = narrow ? 36 : 54, y = narrow ? 92 : 74;
    ctx.font = `900 ${fs}px Inter, sans-serif`;
    const g = ctx.createLinearGradient(0, y - fs * 0.8, 0, y + fs * 0.1);
    g.addColorStop(0, T.text[0]); g.addColorStop(1, T.text[1]);
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(m.toFixed(2) + '×', W / 2, y);
    ctx.fillStyle = g; ctx.fillText(m.toFixed(2) + '×', W / 2, y);
    ctx.fillStyle = '#c9d3e6'; ctx.font = `600 ${narrow ? 12 : 14}px Inter, sans-serif`;
    ctx.fillText(`Bahis ${fmt(state.bet)} · Olası kazanç ${fmt(E.payout(state.bet, currentMultiplier()))}`, W / 2, y + (narrow ? 22 : 26));
  }

  function drawFloaters() {
    for (const f of anim.floaters) {
      const a = f.t < 0.9 ? 1 : 1 - (f.t - 0.9) / 0.3;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = '900 20px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(f.text, sx(f.x), sy(f.y) - f.t * 40);
      ctx.fillStyle = '#b1bad3'; ctx.fillText(f.text, sx(f.x), sy(f.y) - f.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of anim.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color; ctx.fillRect(sx(p.x), sy(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Ana döngü ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    ctx.save(); ctx.scale(Z, Z);
    if (anim.shake > 0) ctx.translate((Math.random() - 0.5) * anim.shake, (Math.random() - 0.5) * anim.shake);
    drawBackground(); drawStage();
    { const [first, last] = visibleRange(); for (let i = first; i <= last; i++) drawBadge(i); }
    if (anim.bolt) drawBolt(anim.bolt);
    drawWalker(); drawParticles(); drawFloaters();
    ctx.restore();
    if (anim.flash > 0) { ctx.fillStyle = `rgba(220,235,255,${anim.flash * 0.55})`; ctx.fillRect(0, 0, W, H); }
    drawHUD();
    requestAnimationFrame(loop);
  }

  // ---------- Olaylar ----------
  ui.btnBet.addEventListener('click', () => { if (state.auto.running) stopAuto(); else startRound(); });
  ui.btnCash.addEventListener('click', () => cashOut(false));
  ui.betMinus.addEventListener('click', () => { const v = betValue(); setBet(v - betStep(v - 0.001)); });
  ui.betPlus.addEventListener('click', () => { const v = betValue(); setBet(v + betStep(v)); });
  ui.bet.addEventListener('input', () => { if (!state.playing) refreshUI(); });
  ui.bet.addEventListener('change', () => setBet(betValue()));
  document.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => setBet(parseFloat(b.dataset.amt))));
  // Sekmeler
  ui.tabs.forEach((t) => t.addEventListener('click', () => {
    ui.tabs.forEach((x) => x.classList.toggle('active', x === t));
    ui.autoRow.hidden = t.dataset.tab !== 'auto';
  }));
  // Oto bahis / oto para çekme
  ui.autoBet.addEventListener('change', () => {
    state.auto.running = ui.autoBet.checked;
    refreshUI();
    if (state.auto.running && !state.playing) startRound();
  });
  const readTarget = () => { const v = parseFloat(ui.autoTarget.value); state.auto.target = v >= 1.01 ? v : 1.1; };
  ui.autoCash.addEventListener('change', () => { state.auto.cash = ui.autoCash.checked; readTarget(); });
  ui.autoTarget.addEventListener('change', () => { readTarget(); ui.autoTarget.value = state.auto.target.toFixed(2); });
  ui.autoClear.addEventListener('click', () => { ui.autoTarget.value = '1.10'; readTarget(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? cashOut(false) : startRound(); }
    if (e.key === 'c' || e.key === 'C') cashOut(false);
  });

  showSeedHash(); refreshUI();
  requestAnimationFrame(loop);
})();
