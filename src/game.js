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
  const LEVEL_H = 64;        // bir yükseklik kademesi (px)
  const BASE_SEG_W = 140;    // kalas temel genişliği
  const BASE_GAP = 90;       // kalaslar arası temel boşluk
  const START_W = 180;       // başlangıç platformu genişliği
  const BADGE_LIFT = 150;    // madalyonun kalas üstünden yüksekliği
  const WALKER_H = 96;

  // Çarpan kademeleri: büyüdükçe daha "cool" ve değerli görünüm
  const TIERS = [
    { name: 'green',   orb: ['#b6ffb0', '#1fcf3f', '#06501c'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#fdfd8c', '#9cf528'], extrude: '#c2185b', glow: '#4dff7a' },
    { name: 'blue',    orb: ['#c6ecff', '#2a8df0', '#0a2f72'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#ffffff', '#86dcff'], extrude: '#0b3f8a', glow: '#55c8ff' },
    { name: 'purple',  orb: ['#efd4ff', '#9a3cf0', '#2f0a66'], ring: ['#ffe680', '#e0a200', '#8a5a00'], text: ['#fff0ff', '#e1a2ff'], extrude: '#5a0e9e', glow: '#cf7bff' },
    { name: 'fire',    orb: ['#ffe2a0', '#ff6a1f', '#5e100a'], ring: ['#fff0a0', '#f2b300', '#8a4a00'], text: ['#fff9c8', '#ffb347'], extrude: '#8a1a0a', glow: '#ff8a2a' },
    { name: 'gold',    orb: ['#fff9d6', '#ffc400', '#6b4500'], ring: ['#ffffff', '#ffd54a', '#b07a00'], text: ['#ffffff', '#ffe36b'], extrude: '#9a5a00', glow: '#ffdd33' },
    { name: 'diamond', orb: ['#ffffff', '#86f3ff', '#1c3f8e'], ring: ['#ffffff', '#cfefff', '#5f8bb5'], text: ['#ffffff', '#b6fbff'], extrude: '#1c5fa8', glow: '#ffffff', rainbow: true },
  ];

  // ---------- Durum ----------
  const state = {
    balance: 1000, bet: 10,
    track: [], stepRolls: [], fallAt: -1,
    position: 0,              // 0 = başlangıç platformu, i = i. kalas
    playing: false, busy: false,
    serverSeed: randomSeed(), nonce: 0,
    history: [],
  };

  // Geometri: her segmentin dünya koordinatları
  let geo = { start: { x: 0, w: START_W, y: 0 }, segs: [] };
  function buildGeometry(track) {
    const segs = [];
    let cursor = START_W;
    for (const s of track) {
      const w = BASE_SEG_W * s.width;
      const gap = BASE_GAP * s.gap;
      const x = cursor + gap;
      segs.push({ ...s, x, w, cx: x + w / 2, y: -s.level * LEVEL_H });
      cursor = x + w;
    }
    const finish = { x: cursor + BASE_GAP, w: 220, y: segs.length ? segs[segs.length - 1].y : 0 };
    geo = { start: { x: 0, w: START_W, y: 0 }, segs, finish };
  }

  // ---------- Animasyon ----------
  const anim = {
    wx: START_W / 2, wy: 0, facing: 1,
    move: null,            // { from, to, t, dur, type, onDone }
    fail: null,            // { style, t, x0, y0 }
    pose: { t: 0 },
    badges: [],            // { seg, x, y, targetY, vy, state: 'wait'|'fall'|'land'|'rest'|'hit'|'dead', delay, t, bob }
    particles: [],
    sparks: [],
    cam: { x: 0, y: 0 },
    shake: 0,
    counter: { shown: 1, target: 1 },
    time: 0,
  };

  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Dünya → ekran: kamera ofseti, zemin satırı ekranın %58'inde
  const groundScreenY = () => H * 0.58;
  const sx = (x) => x - anim.cam.x;
  const sy = (y) => groundScreenY() + y - anim.cam.y;

  // ---------- UI ----------
  const fmt = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ui = {
    balance: $('#balance'), bet: $('#bet'),
    btnBet: $('#btn-bet'), btnStep: $('#btn-step'), btnCash: $('#btn-cashout'), cashAmt: $('#cashout-amount'),
    curMult: $('#cur-mult'), nextMult: $('#next-mult'), nextChance: $('#next-chance'),
    seedHash: $('#seed-hash'), clientSeed: $('#client-seed'), nonce: $('#nonce'), revealed: $('#revealed-seed'),
    history: $('#history'), toast: $('#toast'), preview: $('#track-preview'),
  };

  const currentMultiplier = () => (state.position === 0 ? 1 : state.track[state.position - 1].multiplier);

  function refreshUI() {
    ui.balance.textContent = fmt(state.balance);
    ui.curMult.textContent = currentMultiplier().toFixed(2) + '×';
    const next = state.track[state.position];
    ui.nextMult.textContent = next && state.playing ? next.multiplier.toFixed(2) + '×' : '—';
    ui.nextChance.textContent = next && state.playing ? (next.survive * 100).toFixed(1) + '%' : '—';
    const inRound = state.playing && !state.busy;
    ui.btnBet.disabled = state.playing;
    ui.btnStep.disabled = !inRound || !next;
    ui.btnCash.disabled = !inRound || state.position === 0;
    ui.cashAmt.textContent = state.playing && state.position > 0 ? fmt(E.payout(state.bet, currentMultiplier())) : '';
    ui.bet.disabled = state.playing;
    ui.nonce.textContent = state.nonce;
    ui.preview.innerHTML = state.track.map((s, i) => {
      const cls = state.fallAt === i && !state.playing && state.position <= i ? 'dead'
        : i < state.position ? 'done' : i === state.position && state.playing ? 'cur' : '';
      return `<span class="seg ${cls}">${s.multiplier.toFixed(2)}×</span>`;
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
    state.history = state.history.slice(0, 14);
    ui.history.innerHTML = state.history.map((h) => `<span class="chip ${h.win ? 'win' : 'lose'}">${h.label}</span>`).join('');
  }

  // ---------- Tur akışı ----------
  async function startRound() {
    if (state.playing) return;
    const bet = parseFloat(ui.bet.value);
    if (!(bet > 0)) return toast('Geçerli bir bahis gir', 'lose');
    if (bet > state.balance) return toast('Yetersiz bakiye', 'lose');

    state.bet = Math.round(bet * 100) / 100;
    state.balance -= state.bet;
    state.nonce += 1;
    const round = await E.createRound(hmacHex, state.serverSeed, ui.clientSeed.value || 'plank-walker', state.nonce);
    state.track = round.track; state.stepRolls = round.stepRolls; state.fallAt = round.fallAt;
    state.position = 0; state.playing = true; state.busy = true;
    buildGeometry(state.track);

    anim.wx = START_W / 2; anim.wy = 0; anim.facing = 1;
    anim.move = null; anim.fail = null; anim.particles = []; anim.sparks = [];
    anim.counter = { shown: 1, target: 1 };
    // Madalyonlar gökten sırayla düşer: küçükten büyüğe (soldan sağa)
    anim.badges = geo.segs.map((seg, i) => ({
      seg, x: seg.cx, y: seg.y - 900 - i * 60, targetY: seg.y - BADGE_LIFT, vy: 0,
      state: 'wait', delay: 0.25 + i * 0.16, t: 0, bob: Math.random() * Math.PI * 2, scale: 1,
    }));
    const total = 0.25 + geo.segs.length * 0.16 + 0.9;
    setTimeout(() => { if (state.playing) { state.busy = false; refreshUI(); } }, total * 1000);
    refreshUI();
  }

  function step() {
    if (!state.playing || state.busy) return;
    const target = geo.segs[state.position];
    if (!target) return;
    state.busy = true; refreshUI();

    const willFall = state.fallAt === state.position;
    const from = { x: anim.wx, y: anim.wy };
    const to = { x: target.cx, y: target.y };
    const dy = to.y - from.y;
    const type = dy < -20 ? 'climb' : dy > 20 ? 'drop' : 'hop';
    anim.move = {
      from, to, t: 0, type, edgeX: target.x + 14,
      dur: type === 'climb' ? 1.05 : type === 'drop' ? 0.7 : 0.6,
      onDone: () => {
        anim.wx = to.x; anim.wy = to.y;
        const badge = anim.badges[state.position];
        if (willFall) {
          const style = E.failStyle(state.stepRolls[state.position]);
          anim.fail = { style, t: 0, x0: to.x, y0: to.y, seg: target };
          if (badge) badge.state = 'dead';
          anim.shake = style === 'break' ? 12 : 5;
          setTimeout(() => endRound(false), 1300);
        } else {
          state.position += 1;
          if (badge) { badge.state = 'hit'; badge.t = 0; }
          anim.counter.target = target.multiplier;
          burst(to.x, to.y - BADGE_LIFT, TIERS[E.tierOf(target.multiplier)].glow, 36);
          anim.shake = 2;
          if (state.position === state.track.length) { setTimeout(() => cashOut(true), 500); return; }
          state.busy = false; refreshUI();
        }
      },
    };
  }

  function cashOut(auto = false) {
    if (!state.playing || (state.busy && !auto) || state.position === 0) return;
    const mult = currentMultiplier();
    const win = E.payout(state.bet, mult);
    state.balance += win;
    burst(anim.wx, anim.wy - 60, '#ffd54a', 80);
    toast(`${mult.toFixed(2)}× · ${fmt(win)} kazandın!`, 'win');
    pushHistory(mult.toFixed(2) + '×', true);
    endRound(true, true);
  }

  async function endRound(won, keepToast = false) {
    if (!won && !keepToast) {
      toast(`${anim.fail?.style === 'slip' ? 'Kaydın!' : 'Kalas kırıldı!'} ${fmt(state.bet)} gitti`, 'lose');
      pushHistory('✕ ' + state.track[state.position].multiplier.toFixed(2) + '×', false);
    }
    state.playing = false; state.busy = false;
    ui.revealed.textContent = state.serverSeed;
    state.serverSeed = randomSeed(); state.nonce = 0;
    await showSeedHash();
    refreshUI();
  }

  // ---------- Parçacıklar ----------
  function burst(x, y, color, n = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 260;
      anim.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.8 + Math.random() * 0.6, color, size: 2 + Math.random() * 4 });
    }
  }
  function updateParticles(dt) {
    for (const p of anim.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; p.life -= dt; }
    anim.particles = anim.particles.filter((p) => p.life > 0);
  }

  // ---------- Çizim: arka plan ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07111c'); g.addColorStop(0.55, '#0e2233'); g.addColorStop(1, '#061018');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // spot ışıkları (casino sahnesi)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const bx = W * (0.2 + i * 0.3) + Math.sin(anim.time * 0.4 + i) * 60 - anim.cam.x * 0.08;
      const beam = ctx.createLinearGradient(bx, 0, bx, H * 0.9);
      beam.addColorStop(0, 'rgba(120,180,255,0.10)'); beam.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(bx - 30, 0); ctx.lineTo(bx + 30, 0); ctx.lineTo(bx + 260, H * 0.9); ctx.lineTo(bx - 260, H * 0.9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // yıldızlar / altın tozu
    for (let i = 0; i < 90; i++) {
      const x = (((i * 137.5) - anim.cam.x * 0.12) % W + W) % W;
      const y = (((i * 61.8) - anim.cam.y * 0.1) % (H * 0.7) + H * 0.7) % (H * 0.7);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(anim.time * 1.5 + i));
      ctx.fillStyle = i % 7 === 0 ? `rgba(255,215,90,${tw})` : `rgba(255,255,255,${tw * 0.6})`;
      ctx.fillRect(x, y, i % 7 === 0 ? 2.5 : 1.5, i % 7 === 0 ? 2.5 : 1.5);
    }

    // uzak dağ silüeti (paralaks)
    ctx.fillStyle = '#0a1a28';
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 40; x += 40) {
      const wx = x + anim.cam.x * 0.25;
      ctx.lineTo(x, sy(0) + 40 - anim.cam.y * -0.25 + Math.sin(wx * 0.004) * 50 + Math.sin(wx * 0.013) * 25);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // uçurum sisi
    const fog = ctx.createLinearGradient(0, H * 0.55, 0, H);
    fog.addColorStop(0, 'rgba(6,16,24,0)'); fog.addColorStop(1, 'rgba(3,10,16,0.95)');
    ctx.fillStyle = fog; ctx.fillRect(0, H * 0.55, W, H * 0.45);
  }

  // ---------- Çizim: platformlar ve kalaslar ----------
  function drawPillar(x, w, topY) {
    const px = sx(x), py = sy(topY);
    const g = ctx.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0, '#22384a'); g.addColorStop(0.5, '#345064'); g.addColorStop(1, '#1b2d3c');
    ctx.fillStyle = g; ctx.fillRect(px + 8, py + 16, w - 16, H);
    // taş çizgileri
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    for (let y = py + 40; y < H; y += 34) { ctx.beginPath(); ctx.moveTo(px + 8, y); ctx.lineTo(px + w - 8, y); ctx.stroke(); }
    // alt sis
    const fade = ctx.createLinearGradient(0, py + 120, 0, py + 420);
    fade.addColorStop(0, 'rgba(6,16,24,0)'); fade.addColorStop(1, 'rgba(6,16,24,1)');
    ctx.fillStyle = fade; ctx.fillRect(px, py + 120, w, 400);
  }

  function drawPlank(seg, broken) {
    const px = sx(seg.x), py = sy(seg.y), w = seg.w;
    ctx.save();
    if (broken) {
      const t = Math.min(1, anim.fail.t * 1.6);
      // iki parça kırılıp aşağı sarkar
      ctx.translate(px + w / 2, py);
      for (const dir of [-1, 1]) {
        ctx.save(); ctx.rotate(dir * t * 0.9); ctx.translate(0, t * 20);
        drawPlankBody(dir < 0 ? -w / 2 : 0, 0, w / 2, true);
        ctx.restore();
      }
      ctx.restore(); return;
    }
    drawPlankBody(px, py, w, false);
    ctx.restore();
  }
  function drawPlankBody(x, y, w, dark) {
    const h = 24;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, dark ? '#7a4a25' : '#b87333'); g.addColorStop(0.5, dark ? '#5e361a' : '#9a5a26'); g.addColorStop(1, dark ? '#3a2010' : '#6b3c17');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    // ahşap damarları
    ctx.strokeStyle = 'rgba(40,20,5,.35)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + 8, y + 6 + i * 6);
      ctx.bezierCurveTo(x + w * 0.3, y + 4 + i * 6 + (i % 2) * 3, x + w * 0.7, y + 8 + i * 6, x + w - 8, y + 5 + i * 6);
      ctx.stroke();
    }
    // üst parlaklık ve metal bantlar
    ctx.fillStyle = 'rgba(255,220,160,.25)'; ctx.fillRect(x + 3, y + 1, w - 6, 2);
    ctx.fillStyle = '#c9a227'; ctx.fillRect(x + 6, y - 2, 6, h + 4); ctx.fillRect(x + w - 12, y - 2, 6, h + 4);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x, y + h, w, 6);
  }

  function drawStage() {
    // başlangıç platformu
    drawPillar(geo.start.x - 40, geo.start.w + 40, 0);
    const px = sx(geo.start.x - 40), py = sy(0);
    const g = ctx.createLinearGradient(0, py, 0, py + 30);
    g.addColorStop(0, '#4a6a82'); g.addColorStop(1, '#2a3f52');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(px, py, geo.start.w + 40, 30, 6); ctx.fill();
    ctx.fillStyle = '#ffd54a'; ctx.fillRect(px, py, geo.start.w + 40, 3);
    ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('BAŞLANGIÇ', px + (geo.start.w + 40) / 2, py + 20);

    // kalaslar
    geo.segs.forEach((seg, i) => {
      drawPillar(seg.x, seg.w, seg.y);
      const broken = anim.fail && anim.fail.style === 'break' && anim.fail.seg === seg;
      drawPlank(seg, broken);
      ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = i < state.position ? 'rgba(0,231,1,.7)' : 'rgba(255,255,255,.35)';
      ctx.fillText(String(i + 1), sx(seg.cx), sy(seg.y) + 44);
    });

    // bitiş platformu
    if (geo.finish) {
      drawPillar(geo.finish.x, geo.finish.w, geo.finish.y);
      const fx = sx(geo.finish.x), fy = sy(geo.finish.y);
      const fg = ctx.createLinearGradient(0, fy, 0, fy + 30);
      fg.addColorStop(0, '#5a4a1a'); fg.addColorStop(1, '#2a2410');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(fx, fy, geo.finish.w, 30, 6); ctx.fill();
      ctx.fillStyle = '#ffd54a'; ctx.fillRect(fx, fy, geo.finish.w, 3);
      ctx.font = 'bold 14px Inter, sans-serif'; ctx.fillStyle = '#ffd54a'; ctx.textAlign = 'center';
      ctx.fillText('BİTİŞ · TAM ÖDEME', fx + geo.finish.w / 2, fy - 12);
    }
  }

  // ---------- Çizim: madalyon (kanatlı çarpan) ----------
  const badgeCache = new Map();
  function badgeSprite(tier) {
    if (badgeCache.has(tier)) return badgeCache.get(tier);
    const T = TIERS[tier];
    const size = 260, c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.translate(size / 2, size / 2);
    const R = 46;

    // kanatlar
    for (const dir of [-1, 1]) {
      g.save(); g.scale(dir, 1);
      for (let f = 0; f < 5; f++) {
        const ang = -0.9 + f * 0.26, len = 70 - f * 7, wdt = 16 - f * 1.6;
        g.save(); g.translate(R + 4, 6 + f * 4); g.rotate(ang);
        const wg = g.createLinearGradient(0, 0, len, 0);
        wg.addColorStop(0, T.ring[1]); wg.addColorStop(0.6, T.ring[0]); wg.addColorStop(1, T.ring[2]);
        g.fillStyle = wg;
        g.beginPath(); g.ellipse(len / 2, 0, len / 2, wdt / 2, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(80,40,0,.35)'; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      g.restore();
    }
    // halka
    const rg = g.createLinearGradient(0, -R, 0, R);
    rg.addColorStop(0, T.ring[0]); rg.addColorStop(0.5, T.ring[1]); rg.addColorStop(1, T.ring[2]);
    g.lineWidth = 11; g.strokeStyle = rg; g.beginPath(); g.arc(0, 0, R + 5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(60,30,0,.5)'; g.beginPath(); g.arc(0, 0, R + 10.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(0, 0, R + 1, 0, Math.PI * 2); g.stroke();
    // küre
    const og = g.createRadialGradient(-R * 0.35, -R * 0.4, 4, 0, 0, R);
    og.addColorStop(0, T.orb[0]); og.addColorStop(0.5, T.orb[1]); og.addColorStop(1, T.orb[2]);
    g.fillStyle = og; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    // iç girdap
    g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 6;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(10 - i * 8, 8 - i * 6, 20 + i * 9, 0.6 + i, 2.6 + i); g.stroke(); }
    g.restore();
    // parlama
    const hg = g.createRadialGradient(-R * 0.4, -R * 0.5, 2, -R * 0.4, -R * 0.5, R * 0.6);
    hg.addColorStop(0, 'rgba(255,255,255,.75)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg; g.beginPath(); g.ellipse(-R * 0.35, -R * 0.45, R * 0.5, R * 0.3, -0.6, 0, Math.PI * 2); g.fill();

    badgeCache.set(tier, c);
    return c;
  }

  function drawBadge(b) {
    const m = b.seg.multiplier, tier = E.tierOf(m), T = TIERS[tier];
    const x = sx(b.x), y = sy(b.y);
    const pulse = b.state === 'hit' ? 1 + Math.max(0, 0.35 - b.t) * 1.4 : 1;
    const s = (0.78 + tier * 0.03) * b.scale * pulse;
    ctx.save(); ctx.translate(x, y);
    // ışıma
    if (b.state !== 'dead') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 90 * s);
      const a = 0.25 + 0.15 * Math.sin(anim.time * 3 + b.bob) + (b.state === 'hit' ? 0.4 : 0) + tier * 0.05;
      glow.addColorStop(0, hexA(T.glow, a)); glow.addColorStop(1, hexA(T.glow, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 90 * s, 0, Math.PI * 2); ctx.fill();
      if (T.rainbow) {
        ctx.rotate(anim.time * 1.2);
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          const rg = ctx.createLinearGradient(0, 0, 0, -110 * s);
          rg.addColorStop(0, `hsla(${(anim.time * 90 + i * 45) % 360},100%,70%,.35)`); rg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(0, -110 * s); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.scale(s, s);
    if (b.state === 'dead') ctx.filter = 'grayscale(1) brightness(.6)';
    ctx.drawImage(badgeSprite(tier), -130, -130, 260, 260);
    ctx.filter = 'none';
    // yazı: 3D ekstrüzyon + gradyan
    const label = (m >= 100 ? m.toFixed(0) : m.toFixed(m >= 10 ? 1 : 2)) + 'x';
    const fs = label.length > 5 ? 26 : label.length > 4 ? 30 : 36;
    ctx.font = `900 ${fs}px Inter, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let d = 5; d >= 1; d--) { ctx.fillStyle = T.extrude; ctx.fillText(label, 0, d); }
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(label, 0, 0);
    const tg = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
    tg.addColorStop(0, T.text[0]); tg.addColorStop(1, T.text[1]);
    ctx.fillStyle = tg; ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  function updateBadges(dt) {
    for (const b of anim.badges) {
      b.t += dt;
      if (b.state === 'wait') { if (b.t >= b.delay) { b.state = 'fall'; b.vy = 0; } continue; }
      if (b.state === 'fall') {
        b.vy += 2600 * dt; b.y += b.vy * dt;
        if (b.y >= b.targetY) {
          b.y = b.targetY; b.state = 'land'; b.t = 0;
          burst(b.x, b.y, TIERS[E.tierOf(b.seg.multiplier)].glow, 14 + E.tierOf(b.seg.multiplier) * 6);
          anim.shake = Math.max(anim.shake, 3 + E.tierOf(b.seg.multiplier));
        }
      } else if (b.state === 'land') {
        b.scale = 1 + Math.sin(Math.min(1, b.t / 0.35) * Math.PI) * 0.22;
        if (b.t > 0.35) { b.state = 'rest'; b.scale = 1; }
      } else if (b.state === 'rest' || b.state === 'hit') {
        b.y = b.targetY + Math.sin(anim.time * 2 + b.bob) * 5;
        if (b.state === 'hit' && b.t > 0.6) b.state = 'rest';
      }
    }
  }

  // ---------- Çizim: karakter ----------
  function updateWalker(dt) {
    anim.pose.t += dt;
    const mv = anim.move;
    if (mv) {
      mv.t += dt;
      const p = Math.min(1, mv.t / mv.dur);
      const { from, to } = mv;
      if (mv.type === 'hop') {
        anim.wx = from.x + (to.x - from.x) * p;
        anim.wy = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 55;
      } else if (mv.type === 'drop') {
        const e = p * p;
        anim.wx = from.x + (to.x - from.x) * (0.3 * p + 0.7 * Math.sqrt(p));
        anim.wy = from.y + (to.y - from.y) * e - Math.sin(p * Math.PI) * 30;
      } else { // climb: 1) kenara sıçra ve tutun 2) kendini yukarı çek
        if (p < 0.55) {
          const q = p / 0.55;
          const hangY = to.y + 58;
          anim.wx = from.x + (mv.edgeX - from.x) * q;
          anim.wy = from.y + (hangY - from.y) * q - Math.sin(q * Math.PI) * 40;
        } else {
          const q = (p - 0.55) / 0.45, eq = 1 - Math.pow(1 - q, 2);
          anim.wx = mv.edgeX + (to.x - mv.edgeX) * eq;
          anim.wy = (to.y + 58) + (to.y - (to.y + 58)) * eq;
        }
      }
      anim.facing = 1;
      if (p >= 1) { const cb = mv.onDone; anim.move = null; cb(); }
    }
    if (anim.fail) {
      const f = anim.fail; f.t += dt;
      if (f.style === 'slip') {
        anim.wx = f.x0 + Math.min(f.t, 0.45) * 160 + Math.max(0, f.t - 0.45) * 90;
        anim.wy = f.y0 + (f.t > 0.45 ? Math.pow(f.t - 0.45, 2) * 1900 : 0);
      } else {
        anim.wy = f.y0 + Math.max(0, f.t - 0.15) ** 2 * 1700;
        anim.wx = f.x0 + Math.sin(f.t * 8) * 4;
      }
    }
  }

  function drawWalker() {
    const mv = anim.move, f = anim.fail;
    const x = sx(anim.wx), y = sy(anim.wy);
    const t = anim.pose.t;
    // Poz parametreleri
    let legL = 0, legR = 0, kneeBend = 0, armL = 0.3, armR = -0.3, armsUp = 0, lean = 0, crouch = 0, rot = 0, alpha = 1;
    const breathe = Math.sin(t * 2.2) * 1.2;
    if (mv) {
      const p = Math.min(1, mv.t / mv.dur);
      if (mv.type === 'climb' && p >= 0.55) { armsUp = 1; kneeBend = 1 - (p - 0.55) / 0.45; lean = 0.15; }
      else if (mv.type === 'climb') { armsUp = Math.min(1, p * 3); kneeBend = 0.6; lean = 0.2; }
      else { kneeBend = Math.sin(p * Math.PI) * 0.9; armL = -1.2 * Math.sin(p * Math.PI); armR = 1.0 * Math.sin(p * Math.PI); lean = 0.18 * Math.sin(p * Math.PI); legL = 0.5; legR = -0.6; }
    } else if (f) {
      if (f.style === 'slip') { rot = Math.min(1.6, f.t * 2.4); armL = -2; armR = -1.8; legL = 1; legR = -0.6; }
      else { rot = Math.sin(f.t * 6) * 0.2; armL = -2.4; armR = -2.4; legL = 0.6; legR = -0.5; }
      alpha = Math.max(0, 1 - Math.max(0, f.t - 0.75) * 1.6);
    } else {
      // idle: hafif nefes, kollar sallanır
      armL = 0.25 + Math.sin(t * 2.2) * 0.05; armR = -0.25 - Math.sin(t * 2.2) * 0.05; crouch = breathe * 0.3;
    }

    ctx.save(); ctx.globalAlpha = alpha;
    // gölge (yere yakınsa)
    const groundY = sy(nearestGroundY());
    const h = Math.max(0, groundY - y);
    if (!f && h < 300) {
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.35 - h / 400)})`;
      ctx.beginPath(); ctx.ellipse(x, groundY + 2, Math.max(4, 20 - h / 30), Math.max(2, 6 - h / 100), 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.translate(x, y + crouch); ctx.rotate(rot + lean); ctx.scale(anim.facing, 1);
    const skin = '#f1c7a0', skinD = '#d9a67c', shirt = '#1fb954', shirtD = '#128a3c', pants = '#2b3a67', shoe = '#1a1a22', hair = '#3a2416';

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // --- Bacaklar (kalça -> diz -> ayak) ---
    const hipY = -44;
    for (const [side, swing] of [[-1, legL], [1, legR]]) {
      const hx = side * 7;
      const kx = hx + Math.sin(swing) * 14, ky = hipY + 22 - kneeBend * 10;
      const fx = kx + Math.sin(swing * 0.5) * 6 + kneeBend * 10 * side, fy = ky + 22 - kneeBend * 6;
      ctx.strokeStyle = pants; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      // ayakkabı
      ctx.fillStyle = shoe; ctx.beginPath(); ctx.roundRect(fx - 7, fy - 3, 18, 8, 4); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(fx - 7, fy + 3, 18, 2);
    }
    // --- Gövde ---
    const tg = ctx.createLinearGradient(-14, -84, 14, -44);
    tg.addColorStop(0, shirt); tg.addColorStop(1, shirtD);
    ctx.fillStyle = tg; ctx.beginPath(); ctx.roundRect(-15, -86, 30, 44, 9); ctx.fill();
    // kemer
    ctx.fillStyle = '#1b1b24'; ctx.fillRect(-15, -48, 30, 5); ctx.fillStyle = '#ffd54a'; ctx.fillRect(-3, -48, 6, 5);
    // yaka
    ctx.fillStyle = skin; ctx.beginPath(); ctx.moveTo(-6, -86); ctx.lineTo(6, -86); ctx.lineTo(0, -78); ctx.closePath(); ctx.fill();
    // --- Kollar (omuz -> dirsek -> el) ---
    for (const [side, a] of [[-1, armL], [1, armR]]) {
      const shx = side * 14, shy = -80;
      const ang = armsUp ? -Math.PI / 2 - side * 0.15 * (1 - armsUp) : Math.PI / 2 + a * side;
      const ex = shx + Math.cos(ang) * 18 * (armsUp ? 1 : side), ey = shy + Math.sin(ang) * 18;
      const hx2 = ex + Math.cos(ang - 0.4 * side) * 16 * (armsUp ? 1 : side), hy2 = ey + Math.sin(ang - 0.4 * side) * 16;
      ctx.strokeStyle = shirtD; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = skin; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx2, hy2); ctx.stroke();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hx2, hy2, 5, 0, Math.PI * 2); ctx.fill();
    }
    // --- Boyun ve kafa ---
    ctx.fillStyle = skinD; ctx.fillRect(-4, -94, 8, 10);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(0, -106, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
    // kulak
    ctx.fillStyle = skinD; ctx.beginPath(); ctx.arc(-11, -106, 3.5, 0, Math.PI * 2); ctx.fill();
    // saç
    ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(0, -114, 13.5, 9, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-13, -112); ctx.quadraticCurveTo(-6, -120, 4, -118); ctx.quadraticCurveTo(10, -121, 14, -112); ctx.lineTo(13, -108); ctx.quadraticCurveTo(4, -112, -12, -108); ctx.closePath(); ctx.fill();
    // yüz
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(5, -106, 3.2, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a22'; ctx.beginPath(); ctx.arc(6, -106, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hair; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(2, -111); ctx.lineTo(9, -111.5); ctx.stroke();
    ctx.strokeStyle = '#b5745a'; ctx.lineWidth = 1.4; ctx.beginPath();
    if (f) { ctx.arc(5, -97, 3, Math.PI, 0); } else { ctx.arc(5, -100, 3.5, 0.2, Math.PI - 0.6); }
    ctx.stroke();
    // kulaklık / bandana detayı (casino tarzı altın küpe)
    ctx.fillStyle = '#ffd54a'; ctx.beginPath(); ctx.arc(-11, -102, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function nearestGroundY() {
    if (anim.wx < geo.start.w + 20) return 0;
    let best = geo.segs[0]?.y ?? 0, bd = Infinity;
    for (const s of geo.segs) { const d = Math.abs(s.cx - anim.wx); if (d < bd) { bd = d; best = s.y; } }
    if (geo.finish && anim.wx > geo.finish.x) return geo.finish.y;
    return best;
  }

  // ---------- HUD ----------
  function drawHUD(dt) {
    anim.counter.shown += (anim.counter.target - anim.counter.shown) * Math.min(1, dt * 6);
    if (!state.playing && !anim.fail) {
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = 'bold 20px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Bahis yap · çarpanlar gökten düşsün · düşmeden Cash Out yap', W / 2, 56);
      return;
    }
    const m = anim.counter.shown, tier = E.tierOf(Math.max(1, m));
    ctx.textAlign = 'center';
    ctx.font = '900 54px Inter, sans-serif';
    const g = ctx.createLinearGradient(0, 30, 0, 80);
    g.addColorStop(0, TIERS[tier].text[0]); g.addColorStop(1, TIERS[tier].text[1]);
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(m.toFixed(2) + '×', W / 2, 72);
    ctx.fillStyle = g; ctx.fillText(m.toFixed(2) + '×', W / 2, 72);
    ctx.fillStyle = '#c9d3e6'; ctx.font = '600 15px Inter, sans-serif';
    ctx.fillText(`Bahis ${fmt(state.bet)} · Olası kazanç ${fmt(E.payout(state.bet, currentMultiplier()))}`, W / 2, 100);
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
    const dt = Math.min(0.05, (now - last) / 1000); last = now; anim.time += dt;

    updateBadges(dt); updateWalker(dt); updateParticles(dt);

    // kamera: adamı yatayda %38'de, düşeyde zemin çizgisinde tut
    const camTX = Math.max(0, anim.wx - W * 0.38);
    const camTY = anim.fail ? anim.cam.y : anim.wy * 0.85;
    anim.cam.x += (camTX - anim.cam.x) * Math.min(1, dt * 4);
    anim.cam.y += (camTY - anim.cam.y) * Math.min(1, dt * 4);
    anim.shake = Math.max(0, anim.shake - dt * 30);

    ctx.save();
    if (anim.shake > 0) ctx.translate((Math.random() - 0.5) * anim.shake, (Math.random() - 0.5) * anim.shake);
    drawBackground(); drawStage();
    for (const b of anim.badges) if (b.state !== 'wait') drawBadge(b);
    drawWalker(); drawParticles();
    ctx.restore();
    drawHUD(dt);
    requestAnimationFrame(loop);
  }

  // ---------- Olaylar ----------
  ui.btnBet.addEventListener('click', startRound);
  ui.btnStep.addEventListener('click', step);
  ui.btnCash.addEventListener('click', () => cashOut(false));
  document.querySelectorAll('[data-bet]').forEach((b) => b.addEventListener('click', () => {
    const v = parseFloat(ui.bet.value) || 0;
    ui.bet.value = (b.dataset.bet === 'half' ? v / 2 : v * 2).toFixed(2);
  }));
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? step() : startRound(); }
    if (e.key === 'c' || e.key === 'C') cashOut(false);
  });

  // Başlangıç: örnek bir parkur göster (bahis yapılmadan)
  (async () => {
    const demo = await E.createRound(hmacHex, 'demo', 'demo', 1);
    state.track = demo.track; buildGeometry(demo.track);
    anim.badges = geo.segs.map((seg, i) => ({ seg, x: seg.cx, y: seg.y - BADGE_LIFT, targetY: seg.y - BADGE_LIFT, vy: 0, state: 'rest', delay: 0, t: 0, bob: i, scale: 1 }));
    state.track = []; // demo parkuru önizlemede göstermeyelim
    await showSeedHash(); refreshUI();
  })();
  requestAnimationFrame(loop);
})();
