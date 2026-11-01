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

  // ---------- Durum ----------
  const state = {
    balance: 1000,
    bet: 10,
    difficulty: 'medium',
    track: [],
    rolls: [],
    fallAt: -1,
    position: 0,          // adamın bulunduğu segment (0 = başlangıç platformu)
    playing: false,
    busy: false,
    serverSeed: randomSeed(),
    nonce: 0,
    history: [],
  };

  // ---------- Animasyon nesneleri ----------
  const anim = {
    walkerX: 0, walkerY: 0, targetX: 0, walkPhase: 0,
    drops: [],        // gökten düşen çarpan etiketleri
    particles: [],
    camX: 0,
    fail: null,       // { style: 'slip'|'fall', t }
    landed: new Set(),
  };

  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const SEG_W = 150;   // segment genişliği
  const START_X = 160;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const plankY = () => H * 0.62;
  const segX = (i) => START_X + i * SEG_W; // i=0 başlangıç platformu, i>=1 kalas segmentleri

  // ---------- UI ----------
  const fmt = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ui = {
    balance: $('#balance'), bet: $('#bet'), difficulty: $('#difficulty'),
    btnBet: $('#btn-bet'), btnStep: $('#btn-step'), btnCash: $('#btn-cashout'), cashAmt: $('#cashout-amount'),
    curMult: $('#cur-mult'), nextMult: $('#next-mult'), nextChance: $('#next-chance'),
    seedHash: $('#seed-hash'), clientSeed: $('#client-seed'), nonce: $('#nonce'), revealed: $('#revealed-seed'),
    history: $('#history'), toast: $('#toast'),
  };

  function currentMultiplier() {
    return state.position === 0 ? 1 : state.track[state.position - 1].multiplier;
  }

  function refreshUI() {
    ui.balance.textContent = fmt(state.balance);
    ui.curMult.textContent = currentMultiplier().toFixed(2) + '×';
    const next = state.track[state.position];
    ui.nextMult.textContent = next ? next.multiplier.toFixed(2) + '×' : '—';
    ui.nextChance.textContent = next ? (next.survive * 100).toFixed(1) + '%' : '—';
    const inRound = state.playing && !state.busy;
    ui.btnBet.disabled = state.playing;
    ui.btnStep.disabled = !inRound || !next;
    ui.btnCash.disabled = !inRound || state.position === 0;
    ui.cashAmt.textContent = state.playing && state.position > 0 ? fmt(E.payout(state.bet, currentMultiplier())) : '';
    ui.bet.disabled = ui.difficulty.disabled = state.playing;
    ui.nonce.textContent = state.nonce;
  }

  async function showSeedHash() { ui.seedHash.textContent = await sha256Hex(state.serverSeed); }

  function toast(text, cls) {
    ui.toast.textContent = text;
    ui.toast.className = 'toast show ' + cls;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (ui.toast.className = 'toast'), 2200);
  }

  function pushHistory(label, win) {
    state.history.unshift({ label, win });
    state.history = state.history.slice(0, 14);
    ui.history.innerHTML = state.history
      .map((h) => `<span class="chip ${h.win ? 'win' : 'lose'}">${h.label}</span>`).join('');
  }

  // ---------- Tur akışı ----------
  async function startRound() {
    const bet = parseFloat(ui.bet.value);
    if (!(bet > 0)) return toast('Geçerli bir bahis gir', 'lose');
    if (bet > state.balance) return toast('Yetersiz bakiye', 'lose');

    state.bet = Math.round(bet * 100) / 100;
    state.balance -= state.bet;
    state.difficulty = ui.difficulty.value;
    state.track = E.buildTrack(state.difficulty);
    state.nonce += 1;
    state.rolls = await E.generateStepRolls(hmacHex, state.serverSeed, ui.clientSeed.value || 'plank-walker', state.nonce, state.track.length);
    state.fallAt = E.resolveRound(state.track, state.rolls).fallAt;
    state.position = 0;
    state.playing = true;
    state.busy = false;

    anim.walkerX = anim.targetX = segX(0);
    anim.camX = 0; anim.drops = []; anim.particles = []; anim.fail = null; anim.landed = new Set();
    refreshUI();
  }

  function step() {
    if (!state.playing || state.busy) return;
    const next = state.track[state.position];
    if (!next) return;
    state.busy = true;
    refreshUI();

    const targetIndex = state.position + 1;
    const willFall = state.fallAt === state.position; // bu adımda düşüyor mu?
    anim.targetX = segX(targetIndex);
    // Çarpanı gökten düşür
    anim.drops.push({ index: targetIndex, value: next.multiplier, x: segX(targetIndex), y: -40, vy: 0, done: false, failed: willFall });

    anim.onArrive = () => {
      if (willFall) {
        anim.fail = { style: E.failStyle(state.rolls[state.position]), t: 0 };
        setTimeout(() => endRound(false), 1100);
      } else {
        state.position = targetIndex;
        burst(anim.walkerX, plankY() - 60, '#00e701');
        state.busy = false;
        if (state.position === state.track.length) { cashOut(true); return; }
        refreshUI();
      }
    };
  }

  function cashOut(auto = false) {
    if (!state.playing || (state.busy && !auto) || state.position === 0) return;
    const mult = currentMultiplier();
    const win = E.payout(state.bet, mult);
    state.balance += win;
    burst(anim.walkerX, plankY() - 60, '#ffcf3f', 60);
    toast(`${mult.toFixed(2)}× — ${fmt(win)} kazandın!`, 'win');
    pushHistory(mult.toFixed(2) + '×', true);
    endRound(true, true);
  }

  async function endRound(won, keepToast = false) {
    if (!won && !keepToast) {
      toast(`${anim.fail?.style === 'slip' ? 'Kaydın!' : 'Düştün!'} ${fmt(state.bet)} gitti`, 'lose');
      pushHistory('✕ ' + (state.position === 0 ? '1.00' : currentMultiplier().toFixed(2)) + '×', false);
    }
    state.playing = false;
    state.busy = false;
    // Seed'i açıkla, yenisini üret (provably fair rotasyonu)
    ui.revealed.textContent = state.serverSeed;
    state.serverSeed = randomSeed();
    state.nonce = 0;
    await showSeedHash();
    refreshUI();
  }

  // ---------- Çizim ----------
  function burst(x, y, color, n = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      anim.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1, color });
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1a26'); g.addColorStop(1, '#0f212e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // yıldızlar
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 60; i++) {
      const x = ((i * 137.5) % W + anim.camX * -0.05) % W, y = (i * 61.8) % (H * 0.5);
      ctx.fillRect((x + W) % W, y, 2, 2);
    }
    // uçurum / su
    const py = plankY();
    const sea = ctx.createLinearGradient(0, py + 80, 0, H);
    sea.addColorStop(0, '#0a3a4d'); sea.addColorStop(1, '#041a24');
    ctx.fillStyle = sea; ctx.fillRect(0, py + 80, W, H);
  }

  function drawPlank() {
    const py = plankY();
    ctx.save(); ctx.translate(-anim.camX, 0);
    // başlangıç platformu
    ctx.fillStyle = '#2f4553';
    ctx.fillRect(segX(0) - 110, py, 150, H - py);
    ctx.fillStyle = '#3a566a'; ctx.fillRect(segX(0) - 110, py, 150, 14);
    // kalas
    for (let i = 1; i <= state.track.length; i++) {
      const x = segX(i) - SEG_W / 2;
      const landed = anim.landed.has(i);
      const broken = anim.fail && state.fallAt === i - 1 && anim.fail.style === 'fall';
      ctx.fillStyle = broken ? '#5a3a1f' : '#8b5a2b';
      ctx.fillRect(x, py, SEG_W - 4, 22);
      ctx.fillStyle = broken ? '#3f2a16' : '#6e4420';
      ctx.fillRect(x, py + 22, SEG_W - 4, 8);
      // damar çizgileri
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 10, py + 8); ctx.lineTo(x + SEG_W - 20, py + 10); ctx.stroke();
      // segment numarası ve kalıcı çarpan etiketi
      ctx.font = 'bold 13px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillText(String(i), segX(i), py + 48);
      if (landed) {
        ctx.fillStyle = i - 1 < state.position ? '#00e701' : '#b1bad3';
        ctx.font = 'bold 18px Inter, sans-serif';
        ctx.fillText(state.track[i - 1].multiplier.toFixed(2) + '×', segX(i), py - 125);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillText(state.track[i - 1].multiplier.toFixed(2) + '×', segX(i), py - 125);
      }
    }
    // bitiş platformu
    const endX = segX(state.track.length + 1) - 40;
    ctx.fillStyle = '#2f4553'; ctx.fillRect(endX, py, 200, H - py);
    ctx.fillStyle = '#ffcf3f'; ctx.font = 'bold 16px Inter'; ctx.textAlign = 'center';
    ctx.fillText('BİTİŞ', endX + 60, py - 20);
    ctx.restore();
  }

  function drawDrops(dt) {
    const py = plankY();
    ctx.save(); ctx.translate(-anim.camX, 0);
    for (const d of anim.drops) {
      if (!d.done) {
        d.vy += 1800 * dt; d.y += d.vy * dt;
        if (d.y >= py - 125) { d.y = py - 125; d.landT = performance.now(); d.done = true; anim.landed.add(d.index); burst(d.x, py - 60, d.failed ? '#ed4163' : '#ffcf3f', 18); }
      }
      const scale = d.done ? 1 : 1.2;
      ctx.font = `bold ${Math.round(34 * scale)}px Inter, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(d.value.toFixed(2) + '×', d.x, d.y);
      ctx.fillStyle = d.failed ? '#ed4163' : (d.value >= 10 ? '#ffcf3f' : '#00e701');
      ctx.fillText(d.value.toFixed(2) + '×', d.x, d.y);
    }
    // yere inen etiketleri temizle (kalıcı olanı drawPlank çizer)
    anim.drops = anim.drops.filter((d) => !d.done || performance.now() - d.landT < 400);
    ctx.restore();
  }

  function drawWalker(dt) {
    const py = plankY();
    // hareket
    const dx = anim.targetX - anim.walkerX;
    const moving = Math.abs(dx) > 1;
    if (moving) {
      anim.walkerX += Math.sign(dx) * Math.min(Math.abs(dx), 260 * dt);
      anim.walkPhase += dt * 14;
      if (Math.abs(anim.targetX - anim.walkerX) <= 1 && anim.onArrive) { const cb = anim.onArrive; anim.onArrive = null; cb(); }
    } else anim.walkPhase *= 0.9;

    let x = anim.walkerX, y = py, rot = 0, alpha = 1;
    if (anim.fail) {
      anim.fail.t += dt;
      const t = anim.fail.t;
      if (anim.fail.style === 'slip') { rot = Math.min(1.5, t * 3); x += t * 60; y += t > 0.4 ? (t - 0.4) ** 2 * 1800 : 0; }
      else { y += t * t * 1400; rot = t * 4; }
      alpha = Math.max(0, 1 - Math.max(0, t - 0.6) * 1.5);
    }

    ctx.save(); ctx.translate(x - anim.camX, y); ctx.rotate(rot); ctx.globalAlpha = alpha;
    const swing = Math.sin(anim.walkPhase) * 0.6;
    // gölge
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 2, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    // bacaklar
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(-10 * Math.cos(swing), -4); ctx.moveTo(0, -34); ctx.lineTo(10 * Math.cos(swing), -4); ctx.stroke();
    // gövde
    ctx.fillStyle = '#00e701'; ctx.beginPath(); ctx.roundRect(-13, -72, 26, 40, 8); ctx.fill();
    // kollar
    ctx.strokeStyle = '#ffd7a8'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-12, -62); ctx.lineTo(-30, -62 + swing * 12); ctx.moveTo(12, -62); ctx.lineTo(30, -62 - swing * 12); ctx.stroke();
    // kafa
    ctx.fillStyle = '#ffd7a8'; ctx.beginPath(); ctx.arc(0, -86, 14, 0, Math.PI * 2); ctx.fill();
    // kask
    ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.arc(0, -90, 15, Math.PI, 0); ctx.fill(); ctx.fillRect(-18, -90, 36, 4);
    // göz
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6, -86, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles(dt) {
    ctx.save(); ctx.translate(-anim.camX, 0);
    for (const p of anim.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life -= dt * 1.4;
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    anim.particles = anim.particles.filter((p) => p.life > 0);
    ctx.restore();
  }

  function drawHUD() {
    if (!state.playing) {
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = 'bold 22px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Bahis yap, kalasta ilerle, düşmeden Cash Out yap', W / 2, 60);
    } else {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(currentMultiplier().toFixed(2) + '×', W / 2, 70);
      ctx.fillStyle = '#b1bad3'; ctx.font = '15px Inter, sans-serif';
      ctx.fillText(`Bahis ${fmt(state.bet)} · Olası kazanç ${fmt(E.payout(state.bet, currentMultiplier()))}`, W / 2, 96);
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // kamera adamı takip eder
    const camTarget = Math.max(0, anim.walkerX - W * 0.35);
    anim.camX += (camTarget - anim.camX) * Math.min(1, dt * 5);

    drawBackground(); drawPlank(); drawDrops(dt); drawWalker(dt); drawParticles(dt); drawHUD();
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
    if (e.code === 'Space') { e.preventDefault(); state.playing ? step() : startRound(); }
    if (e.key === 'c' || e.key === 'C') cashOut(false);
  });

  // ilk track'i göster
  state.track = E.buildTrack(state.difficulty);
  anim.walkerX = anim.targetX = segX(0);
  showSeedHash(); refreshUI();
  requestAnimationFrame(loop);
})();
