(() => {
  'use strict';

  // ───────── 상수 ─────────
  const W = 1280, H = 720, WORLD_W = 2600;
  const F1 = 520, F2 = 285, LEDGE = 402, LEDGE_W = 200;   // 1층 바닥, 2층 바닥, 중간 발판
  const GRAV = 2500, JUMP = 880, SPEED = 300;
  const MAX_LV = 500, KILLS_PER_LV = 3, MOB_TARGET = 9;
  const NPC_X = 340, PORTAL_L = 90, PORTAL_R = WORLD_W - 90;
  const SAVE_KEY = 'oilstory-save-v1';
  const JOBS = [[500, '석유왕'], [400, '임원'], [300, '부장'], [200, '차장'], [100, '과장'], [30, '대리'], [10, '사원'], [1, '수습사원']];
  const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const coarse = matchMedia('(pointer: coarse)').matches;

  const Q = coarse ? 1 : 2;   // 캔버스 해상도 배율
  const cv = $('game'), ctx = cv.getContext('2d');
  cv.width = W * Q; cv.height = H * Q;
  const mini = $('mini'), mctx = mini.getContext('2d');
  const npcImg = new Image(); npcImg.src = 'oil.jpg';

  // ───────── 저장 ─────────
  let save = { kills: 0, seen: {}, map: 0, met: false };
  try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) { /* 저장 불가 환경 */ }
  if (!MAPS[save.map]) save.map = 0;
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ } };

  const lvl = () => Math.min(MAX_LV, 1 + Math.floor(save.kills / KILLS_PER_LV));
  const hpMax = () => 100 + lvl() * 12;
  const mpMax = () => 50 + lvl() * 6;
  const atkBase = () => 20 + lvl() * 7;
  const seenCount = cat => TERMS.filter(t => (cat == null || t.cat === cat) && save.seen[t.id]).length;

  // ───────── 상태 ─────────
  const player = { x: 220, y: F1, vx: 0, vy: 0, face: 1, ground: true, atkT: 0, skill: false, inv: 0, kbT: 0, kbV: 0, drop: 0, dead: 0, hp: hpMax(), mp: mpMax(), walk: 0, lvT: 0 };
  let monsters = [], items = [], fx = [], respawn = [], surfs = [];
  let camX = 0, time = 0, bannerT = 0, huntTime = 0, huntKills = 0, hudT = 0, tipT = 18;
  let modal = null, modalAt = 0;
  const keys = {}, pressed = {};

  // ───────── 입력 ─────────
  const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Space: 'jump', AltLeft: 'jump', AltRight: 'jump', KeyC: 'jump', KeyZ: 'atk', ControlLeft: 'atk', ControlRight: 'atk', KeyX: 'skill' };
  const kd = k => { if (!keys[k]) pressed[k] = true; keys[k] = true; };
  const ku = k => { keys[k] = false; };

  addEventListener('keydown', e => {
    if (modal) {
      if (e.repeat || performance.now() - modalAt < 300) { e.preventDefault(); return; }
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); modal.ok(); }
      else if (e.code === 'Escape') (modal.esc || modal.ok)();
      return;
    }
    const k = KEYMAP[e.code];
    if (k) { e.preventDefault(); if (!e.repeat) kd(k); }
    else if (e.code === 'KeyI') openCodex();
    else if (e.code === 'KeyH') openHelp();
  });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) ku(k); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  document.querySelectorAll('[data-key]').forEach(b => {
    const k = b.dataset.key;
    const up = () => { ku(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (!modal) { kd(k); b.classList.add('on'); } });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  });
  ['btnCodex', 'qCodex', 'tCodex'].forEach(id => $(id).addEventListener('click', () => { if (!modal) openCodex(); }));
  ['btnHelp', 'qHelp', 'tHelp'].forEach(id => $(id).addEventListener('click', () => { if (!modal) openHelp(); }));
  addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('pointerdown', e => {
    if (modal) return;
    const r = cv.getBoundingClientRect();
    const gx = (e.clientX - r.left) / r.width * W + camX, gy = (e.clientY - r.top) / r.height * H;
    if (Math.abs(gx - NPC_X) < 100 && gy > F1 - 170 && gy < F1 + 10) openNpc();
  });

  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    $('stage').style.transform = `translate(-50%,-50%) scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  // ───────── 로그 / HUD ─────────
  function addChat(cls, html) {
    const log = $('chatlog'), p = document.createElement('p');
    p.className = cls; p.innerHTML = html; log.appendChild(p);
    while (log.children.length > 4) log.firstChild.remove();
  }
  function addLoot(text, gold) {
    const box = $('loot'), p = document.createElement('p');
    if (gold) p.className = 'gold';
    p.textContent = text; box.appendChild(p);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => p.remove(), 5000);
  }
  let toastTimer;
  function toast(html) {
    const t = $('toast'); t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
  const fmtTime = s => [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');

  function hud() {
    const L = lvl(), p = player;
    $('lv').innerHTML = String(L).split('').map(d => `<i>${d}</i>`).join('');
    $('job').textContent = JOBS.find(j => L >= j[0])[1];
    $('hptxt').textContent = `[${Math.ceil(p.hp)}/${hpMax()}]`;
    $('mptxt').textContent = `[${Math.floor(p.mp)}/${mpMax()}]`;
    $('hpbar').style.width = clamp(p.hp / hpMax() * 100, 0, 100) + '%';
    $('mpbar').style.width = clamp(p.mp / mpMax() * 100, 0, 100) + '%';
    const k = save.kills % KILLS_PER_LV, max = L >= MAX_LV;
    const expTxt = max ? 'MAX' : `${k} / ${KILLS_PER_LV} [${(k / KILLS_PER_LV * 100).toFixed(2)}%]`;
    $('exptxt').textContent = expTxt;
    $('expbar').style.width = (max ? 100 : k / KILLS_PER_LV * 100) + '%';
    $('hExp').textContent = expTxt;
    $('hTime').textContent = fmtTime(huntTime);
    $('hKill').textContent = `${huntKills} 마리 (누적 ${save.kills})`;
    $('hSeen').textContent = `${seenCount()} / ${TERMS.length}`;
  }

  // ───────── 창(모달) ─────────
  function setModal(m) {
    modal = m; modalAt = performance.now();
    $('dim').classList.toggle('hidden', !m);
    for (const k in keys) keys[k] = false;
    for (const k in pressed) pressed[k] = false;
  }

  function openScroll(t, isNew, after) {
    $('scBadge').textContent = isNew ? 'NEW! 비밀의 두루마리' : '비밀의 두루마리';
    $('scBadge').classList.toggle('new', !!isNew);
    $('scCat').textContent = `${MAPS[t.cat].sub} · ${MAPS[t.cat].name}`;
    $('scName').textContent = t.name;
    $('scEn').textContent = t.en;
    $('scShort').textContent = t.short;
    $('scDesc').textContent = t.desc;
    $('scTip').textContent = t.tip;
    $('scroll').classList.remove('hidden');
    setModal({ ok: () => { $('scroll').classList.add('hidden'); setModal(null); if (after) after(); } });
  }
  $('scOk').addEventListener('click', () => modal && modal.ok());

  function openDialog(pages, after) {
    let i = 0;
    const end = () => { $('dialog').classList.add('hidden'); setModal(null); if (after) after(); };
    const show = () => {
      $('dlgText').innerHTML = pages[i];
      $('dlgNext').firstChild.textContent = i < pages.length - 1 ? '다음 ' : '확인 ';
    };
    show();
    $('dialog').classList.remove('hidden');
    setModal({ ok: () => { if (++i >= pages.length) end(); else show(); }, esc: end });
  }
  $('dlgNext').addEventListener('click', () => modal && modal.ok());
  $('dlgEnd').addEventListener('click', () => modal && (modal.esc || modal.ok)());

  const CONTROLS = coarse
    ? '화면 왼쪽 <b>◀ ▶</b> 버튼으로 움직이고, 오른쪽 <b>점프·공격·스킬</b> 버튼으로 싸워. <b>▲</b>는 나와 대화하거나 포탈을 탈 때, <b>▼+점프</b>는 아래층으로 내려갈 때 써.'
    : '<kbd>←</kbd><kbd>→</kbd> 이동, <kbd>Space</kbd> 점프, <kbd>Z</kbd> 공격, <kbd>X</kbd> 스킬이야. <kbd>↑</kbd>는 나와 대화하거나 포탈을 탈 때, <kbd>↓</kbd>+<kbd>Space</kbd>는 아래층으로 내려갈 때 써.';

  function openHelp() {
    openDialog([
      CONTROLS,
      '몬스터 몸에는 <b>산업 용어</b>가 적혀 있어. 잡으면 <b>비밀의 두루마리</b>가 떨어지고, 주우면 그 용어의 설명이 펼쳐져!',
      `몬스터 <b>${KILLS_PER_LV}마리</b>를 잡을 때마다 <b>1레벨</b>씩 올라. 최대 레벨은 <b>${MAX_LV}</b>! 읽은 두루마리는 <b>도감</b>${coarse ? '(📜)' : '(<kbd>I</kbd>)'}에서 언제든 다시 볼 수 있어.`,
      '맵 양쪽 끝의 <b>포탈</b>을 타면 다른 분야의 맵으로 갈 수 있어. 진행 상황은 이 브라우저에 자동으로 저장돼.'
    ]);
  }

  function openNpc() {
    const M = MAPS[save.map], n = seenCount(save.map), total = TERMS.filter(t => t.cat === save.map).length;
    const tail = n >= total
      ? `이 맵의 두루마리 <b>${total}개</b>를 전부 모았네, 대단해! ${save.map < MAPS.length - 1 ? '오른쪽 끝 포탈로 다음 맵에 가보자.' : '이제 넌 어디 가서도 정유·석유화학 얘기에 낄 수 있어!'}`
      : `지금 이 맵의 두루마리는 <b>${n} / ${total}</b>개 모았어. 아직 못 본 용어 몬스터를 찾아봐!`;
    openDialog([...M.intro, tail]);
  }

  let cxTab = 0;
  function openCodex(tab) {
    if (tab != null) cxTab = tab; else cxTab = save.map;
    renderCodex();
    $('codex').classList.remove('hidden');
    const close = () => { $('codex').classList.add('hidden'); setModal(null); };
    setModal({ ok: close, esc: close });
  }
  function renderCodex() {
    $('cxCount').textContent = `수집 ${seenCount()} / ${TERMS.length}`;
    $('cxTabs').innerHTML = MAPS.map((m, i) => `<button class="${i === cxTab ? 'on' : ''}" data-tab="${i}">${m.sub} ${seenCount(i)}/${TERMS.filter(t => t.cat === i).length}</button>`).join('');
    $('cxGrid').innerHTML = TERMS.filter(t => t.cat === cxTab).map(t => save.seen[t.id]
      ? `<button data-id="${t.id}"><em>${t.tag}</em>${t.name}<small>처치 ${save.seen[t.id]}회</small></button>`
      : '<button class="lock"><em>?</em>미발견</button>').join('');
  }
  $('cxTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { cxTab = +b.dataset.tab; renderCodex(); } });
  $('cxGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const t = TERMS.find(x => x.id === b.dataset.id), tab = cxTab;
    $('codex').classList.add('hidden');
    openScroll(t, false, () => openCodex(tab));
  });
  $('cxClose').addEventListener('click', () => modal && modal.ok());
  $('cxReset').addEventListener('click', () => {
    if (!confirm('레벨과 도감 기록이 모두 지워집니다. 처음부터 다시 시작할까요?')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ }
    location.reload();
  });

  // ───────── 맵 / 몬스터 ─────────
  function enterMap(i, fromRight) {
    save.map = i; persist();
    const M = MAPS[i];
    surfs = [{ x: 0, y: F1, w: WORLD_W }, { x: 0, y: F2, w: WORLD_W }, ...M.ledges.map(x => ({ x, y: LEDGE, w: LEDGE_W, ledge: true }))];
    monsters = []; items = []; fx = []; respawn = [];
    Object.assign(player, { x: fromRight ? PORTAL_R - 110 : PORTAL_L + 130, y: F1, vx: 0, vy: 0, face: fromRight ? -1 : 1, ground: true, kbT: 0 });
    camX = clamp(player.x - W / 2, 0, WORLD_W - W);
    for (let n = 0; n < MOB_TARGET; n++) spawnMonster();
    bannerT = 3.2;
    $('mapname').textContent = M.name; $('mapsub').textContent = M.sub;
    $('mapicon').style.background = `linear-gradient(135deg, ${M.beamHi}, ${M.accent})`;
    addChat('sys', `[이동] ${M.name} (${M.sub})에 입장했습니다.`);
    hud();
  }

  function spawnMonster() {
    const pool = TERMS.filter(t => t.cat === save.map);
    // 화면에 덜 나와 있고, 아직 못 본 용어일수록 먼저 등장한다
    const score = t => monsters.filter(m => m.t === t && m.dieT <= 0).length * 10 + (save.seen[t.id] ? 2 : 0) + Math.random() * 3;
    const t = pool.slice().sort((a, b) => score(a) - score(b))[0];
    const upper = monsters.filter(m => m.y === F2).length < monsters.filter(m => m.y === F1).length;
    let x;
    for (let n = 0; n < 12; n++) { x = rand(480, WORLD_W - 220); if (Math.abs(x - player.x) > 280) break; }
    const max = atkBase() * 3;
    const palette = MAPS[t.cat].palette;
    monsters.push({ t, x, y: upper ? F2 : F1, dir: Math.random() < .5 ? -1 : 1, turnT: rand(1, 3), hp: max, max, hitT: 0, dieT: 0, kb: 0, aggro: 0, phase: rand(0, 6), spawnT: .5, col: t.c || palette[pool.indexOf(t) % palette.length] });
  }

  function attack(skill) {
    const p = player;
    if (skill) {
      if (p.mp < 12) { addLoot('MP가 부족합니다.'); return; }
      p.mp -= 12;
    }
    p.atkT = skill ? .45 : .32; p.skill = skill;
    const reach = skill ? 220 : 120;
    monsters
      .filter(m => m.dieT <= 0 && Math.abs(m.y - p.y) < 110 && (m.x - p.x) * p.face > -35 && (m.x - p.x) * p.face < reach)
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))
      .slice(0, skill ? 4 : 1)
      .forEach(m => hit(m, skill ? 1.5 : 1));
    fx.push({ type: 'slash', x: p.x + p.face * (skill ? 110 : 62), y: p.y - 48, face: p.face, big: skill, t: 0, life: .22 });
  }

  function hit(m, mult) {
    const crit = Math.random() < .2;
    const d = Math.round(atkBase() * mult * rand(.85, 1.15) * (crit ? 1.5 : 1));
    m.hp -= d; m.hitT = .25; m.kb = player.face * 240; m.aggro = 6;
    fx.push({ type: 'num', x: m.x + rand(-10, 10), y: m.y - 100, text: d, crit, t: 0, life: .9 });
    if (m.hp <= 0) kill(m);
  }

  function kill(m) {
    const before = lvl();
    m.dieT = .5; m.hp = 0;
    save.kills++; huntKills++;
    addLoot('경험치를 얻었습니다 (+1)');
    items.push({ t: m.t, x: m.x, y: m.y - 40, vy: -560, base: m.y, age: 0 });
    respawn.push(2.5);
    if (lvl() > before) levelUp();
    persist(); hud();
  }

  function levelUp() {
    const p = player, L = lvl();
    p.lvT = 1.8; p.hp = hpMax(); p.mp = mpMax();
    addChat('notice', `[레벨 업] <b>Lv.${L}</b> 달성! ${L >= MAX_LV ? '최고 레벨에 도달했습니다. 당신이 바로 석유왕!' : ''}`);
    if (L >= MAX_LV) toast('<b>Lv.500</b> 달성! 당신이 바로 석유왕!');
  }

  function pickup(t) {
    const first = !save.seen[t.id];
    save.seen[t.id] = (save.seen[t.id] || 0) + 1;
    persist(); hud();
    addLoot(`아이템을 얻었습니다 (비밀의 두루마리 : ${t.name})`, true);
    if (first) openScroll(t, true);
    else {
      addChat('study', `[복습] <b>${t.name}</b> : ${t.short}`);
      toast(`<b>${t.name}</b> · ${t.short}`);
    }
  }

  function hurt(m) {
    const p = player, d = Math.round(hpMax() * .08);
    p.hp -= d; p.inv = 1.3; p.vy = -420; p.ground = false;
    p.kbV = (p.x >= m.x ? 1 : -1) * 260; p.kbT = .25;
    fx.push({ type: 'num', x: p.x, y: p.y - 110, text: d, hurt: true, t: 0, life: .9 });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = 2.4;
      addChat('sys', '[알림] 쓰러졌습니다. 잠시 후 오일이 곁에서 다시 일어납니다. (패널티 없음)');
    }
  }

  function interact() {
    const p = player;
    if (p.y !== F1 || !p.ground) return;
    if (Math.abs(p.x - NPC_X) < 100) { save.met = true; persist(); openNpc(); }
    else if (p.x < PORTAL_L + 70 && save.map > 0) enterMap(save.map - 1, true);
    else if (p.x > PORTAL_R - 70 && save.map < MAPS.length - 1) enterMap(save.map + 1, false);
  }

  // ───────── 업데이트 ─────────
  function update(dt) {
    time += dt; huntTime += dt;
    const p = player;

    if (p.dead > 0) {
      p.dead -= dt; p.vx = 0;
      if (p.dead <= 0) { p.x = NPC_X + 110; p.y = F1; p.vy = 0; p.hp = hpMax(); p.mp = mpMax(); p.inv = 2; }
    } else {
      const ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (p.kbT > 0) { p.kbT -= dt; p.vx = p.kbV; }
      else { p.vx = ax * SPEED; if (ax) p.face = ax; }
      if (pressed.jump && p.ground) {
        if (keys.down && p.y !== F1) p.drop = .28;
        else p.vy = -JUMP;
        p.ground = false;
      }
      if (pressed.atk && p.atkT <= 0) attack(false);
      if (pressed.skill && p.atkT <= 0) attack(true);
      if (pressed.up) interact();
      p.hp = Math.min(hpMax(), p.hp + hpMax() * .012 * dt);
      p.mp = Math.min(mpMax(), p.mp + mpMax() * .04 * dt);
    }
    for (const k in pressed) pressed[k] = false;
    if (modal) return;   // 대화·포탈로 창이 열렸으면 이번 프레임은 여기까지

    p.atkT -= dt; p.inv -= dt; p.drop -= dt; p.lvT -= dt;
    if (p.ground && p.vx) p.walk += dt;

    // 물리: 발판은 위에서 내려올 때만 밟힌다
    const prevY = p.y;
    p.vy += GRAV * dt;
    p.x = clamp(p.x + p.vx * dt, 30, WORLD_W - 30);
    p.y += p.vy * dt;
    p.ground = false;
    if (p.vy >= 0) {
      for (const s of surfs) {
        if (s.y !== F1 && p.drop > 0) continue;
        if (prevY <= s.y + 1 && p.y >= s.y && p.x > s.x - 12 && p.x < s.x + s.w + 12) { p.y = s.y; p.vy = 0; p.ground = true; break; }
      }
    }

    // 몬스터
    for (const m of monsters) {
      if (m.dieT > 0) { m.dieT -= dt; if (m.dieT <= 0) m.gone = true; continue; }
      m.phase += dt * 6; m.hitT -= dt; m.spawnT -= dt;
      m.x += m.kb * dt; m.kb *= Math.pow(.01, dt);
      let speed = 45;
      if (m.aggro > 0) {
        m.aggro -= dt; speed = 100;
        if (Math.abs(p.y - m.y) < 80 && Math.abs(p.x - m.x) > 20) m.dir = Math.sign(p.x - m.x);
      } else if ((m.turnT -= dt) <= 0) { m.dir = [-1, 0, 1][Math.floor(Math.random() * 3)]; m.turnT = rand(1, 3.5); }
      m.x += m.dir * speed * dt;
      if (m.x < 420) { m.x = 420; m.dir = 1; }
      if (m.x > WORLD_W - 180) { m.x = WORLD_W - 180; m.dir = -1; }
      if (m.spawnT <= 0 && p.dead <= 0 && p.inv <= 0 && Math.abs(p.x - m.x) < 44 && Math.abs(p.y - m.y) < 60) hurt(m);
    }
    monsters = monsters.filter(m => !m.gone);
    for (let i = respawn.length - 1; i >= 0; i--) if ((respawn[i] -= dt) <= 0) { respawn.splice(i, 1); spawnMonster(); }

    // 두루마리: 떨어졌다가 플레이어에게 빨려 들어온다
    for (const it of items) {
      it.age += dt;
      if (it.age < .7 || p.dead > 0) {
        it.vy += GRAV * dt; it.y += it.vy * dt;
        if (it.y > it.base - 16) { it.y = it.base - 16; it.vy = 0; }
      } else {
        const dx = p.x - it.x, dy = p.y - 45 - it.y, d = Math.hypot(dx, dy);
        if (d < 36) { it.gone = true; pickup(it.t); if (modal) break; }
        else { it.x += dx / d * 760 * dt; it.y += dy / d * 760 * dt; }
      }
    }
    items = items.filter(it => !it.gone);

    for (const f of fx) f.t += dt;
    fx = fx.filter(f => f.t < f.life);

    camX += (clamp(p.x - W / 2, 0, WORLD_W - W) - camX) * Math.min(1, dt * 8);
    bannerT -= dt;

    // 오일이가 채팅으로 이미 배운 용어를 다시 짚어 준다
    if ((tipT -= dt) <= 0) {
      tipT = 28;
      const known = TERMS.filter(t => save.seen[t.id]);
      if (known.length) {
        const t = known[Math.floor(Math.random() * known.length)];
        addChat('npc', `오일이 : 기억나? <b>${t.name}</b>은(는) "${t.short}"!`);
      } else addChat('npc', '오일이 : 몬스터를 잡으면 비밀의 두루마리가 떨어져. 일단 한 마리 잡아봐!');
    }
    if ((hudT -= dt) <= 0) { hudT = .25; hud(); }
  }

  // ───────── 그리기 도구 ─────────
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function poly(cx, cy, r, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath();
  }
  function label(text, x, y, size, fill, stroke, lw) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = lw || 4; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y); }
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  function nameTag(text, x, y, color) {
    ctx.font = `14px ${FONT}`;
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(0,0,0,.62)'; rr(x - w / 2, y, w, 20, 5);
    label(text, x, y + 11, 14, color || '#fff');
  }

  // ───────── 배경 ─────────
  const BAY = 380;
  function drawDeco(M, i, cx, fy) {
    const kind = i % 2 === 0 ? 'window' : M.deco;
    ctx.save(); ctx.translate(cx, fy);
    if (kind === 'window') {
      ctx.fillStyle = M.beam; poly(0, -150, 70, 8, Math.PI / 8); ctx.fill();
      ctx.fillStyle = M.beamHi; poly(0, -150, 60, 8, Math.PI / 8); ctx.fill();
      ctx.fillStyle = M.accent; poly(0, -150, 50, 8, Math.PI / 8); ctx.fill();
      ctx.save(); poly(0, -150, 50, 8, Math.PI / 8); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
      for (let k = -3; k <= 3; k++) {
        ctx.beginPath(); ctx.moveTo(k * 20, -210); ctx.lineTo(k * 20, -90); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-60, -150 + k * 20); ctx.lineTo(60, -150 + k * 20); ctx.stroke();
      }
      ctx.restore();
    } else if (kind === 'barrel') {
      [[-52, '#2f4f7a'], [0, '#8a2f2a'], [52, '#2f4f7a'], [-26, '#3a3a40', -62], [26, '#8a6a2a', -62]].forEach(([x, c, y = 0]) => {
        ctx.fillStyle = c; rr(x - 24, y - 62, 48, 62, 6);
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x - 24, y - 46, 48, 4); ctx.fillRect(x - 24, y - 20, 48, 4);
      });
    } else if (kind === 'gauge') {
      ctx.fillStyle = M.beam; ctx.fillRect(-150, -128, 300, 14); ctx.fillRect(-150, -92, 300, 10);
      ctx.fillStyle = '#3a4350'; circle(0, -150, 58);
      ctx.fillStyle = '#f4f7fa'; circle(0, -150, 49);
      ctx.strokeStyle = '#3a4350'; ctx.lineWidth = 3;
      for (let k = 0; k <= 8; k++) { const a = Math.PI * .75 + k * Math.PI * 1.5 / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 38, -150 + Math.sin(a) * 38); ctx.lineTo(Math.cos(a) * 46, -150 + Math.sin(a) * 46); ctx.stroke(); }
      const a = Math.PI * 1.4 + Math.sin(time * 1.3 + i) * .5;
      ctx.strokeStyle = '#d9412b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -150); ctx.lineTo(Math.cos(a) * 36, -150 + Math.sin(a) * 36); ctx.stroke();
      ctx.fillStyle = '#3a4350'; circle(0, -150, 6);
    } else if (kind === 'drum') {
      ctx.fillStyle = M.beam; rr(-110, -200, 220, 200, 4);
      ctx.fillStyle = M.wall; ctx.fillRect(-100, -190, 200, 84); ctx.fillRect(-100, -96, 200, 90);
      const cols = ['#3d8bd9', '#e0a92e', '#d9603d', '#5aa85a'];
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
        ctx.fillStyle = cols[(k + r + i) % 4]; rr(-94 + k * 48, r ? -70 : -164, 40, r ? 64 : 58, 5);
        ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(-94 + k * 48, r ? -48 : -142, 40, 4);
      }
    } else if (kind === 'flask') {
      ctx.fillStyle = M.beam; rr(-80, -215, 160, 150, 6);
      ctx.fillStyle = '#fffdf6'; ctx.fillRect(-72, -207, 144, 134);
      ctx.strokeStyle = M.accent; ctx.lineWidth = 5; poly(0, -148, 36, 6, Math.PI / 6); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -148, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = M.beam; label(i % 4 === 1 ? 'C6H6' : 'C=C', 0, -92, 15, M.beam);
    } else if (kind === 'chart') {
      ctx.fillStyle = '#2a2f3a'; rr(-100, -215, 200, 135, 8);
      ctx.fillStyle = '#10141c'; ctx.fillRect(-90, -205, 180, 115);
      for (let k = 0; k < 9; k++) {
        const h = 22 + ((k * 37 + i * 13) % 40), up = (k + i) % 3 !== 0, y = -110 - k * 6 - h;
        ctx.fillStyle = up ? '#e0443a' : '#3a7be0';
        ctx.fillRect(-78 + k * 19, y + (up ? 0 : 10), 10, h); ctx.fillRect(-74 + k * 19, y - 8, 2, h + 18);
      }
    }
    ctx.restore();
  }

  function drawFloor(M, fy) {
    ctx.fillStyle = M.beam; ctx.fillRect(0, fy, W, 34);
    ctx.fillStyle = M.beamHi; ctx.fillRect(0, fy, W, 9);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, fy + 28, W, 6);
    for (let x = -(camX % 190); x < W + 20; x += 190) {
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, fy, 3, 9);
      ctx.fillStyle = '#2a2f3a'; circle(x + 95, fy + 20, 7);
      ctx.fillStyle = '#6d7482'; circle(x + 94, fy + 19, 3);
    }
  }

  function drawBg() {
    const M = MAPS[save.map];
    ctx.fillStyle = M.wall; ctx.fillRect(0, 0, W, H);
    for (const fy of [F2, F1]) {   // 허리벽
      ctx.fillStyle = M.low; ctx.fillRect(0, fy - 62, W, 62);
      ctx.fillStyle = 'rgba(0,0,0,.14)';
      for (let x = -(camX % 38); x < W; x += 38) ctx.fillRect(x, fy - 62, 3, 62);
      ctx.fillStyle = M.beam; ctx.fillRect(0, fy - 70, W, 10);
    }
    const first = Math.floor(camX / BAY);
    for (let i = first; i <= first + 4; i++) {
      const x = i * BAY - camX;
      drawDeco(M, i, x + BAY / 2, F1);
      drawDeco(M, i + 1, x + BAY / 2, F2);
    }
    for (let i = first; i <= first + 4; i++) {   // 기둥
      const x = i * BAY - camX;
      ctx.fillStyle = M.beam; ctx.fillRect(x - 17, 0, 34, F1);
      ctx.fillStyle = M.beamHi; ctx.fillRect(x - 17, 0, 7, F1);
    }
    ctx.fillStyle = M.beam; ctx.fillRect(0, 28, W, 26);
    ctx.fillStyle = M.beamHi; ctx.fillRect(0, 28, W, 6);
    drawFloor(M, F2); drawFloor(M, F1);
    ctx.fillStyle = '#17120e'; ctx.fillRect(0, F1 + 34, W, H);

    for (const s of surfs) if (s.ledge) {   // 중간 발판
      const x = s.x - camX;
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x + 14, s.y + 16, 10, F1 - s.y - 16); ctx.fillRect(x + s.w - 24, s.y + 16, 10, F1 - s.y - 16);
      ctx.fillStyle = M.beam; rr(x, s.y, s.w, 18, 4);
      ctx.fillStyle = M.beamHi; rr(x, s.y, s.w, 7, 3);
    }
  }

  function drawPortal(x, name) {
    const sx = x - camX; if (sx < -120 || sx > W + 120) return;
    ctx.save(); ctx.translate(sx, F1);
    for (let k = 0; k < 4; k++) {
      ctx.globalAlpha = .25 + k * .15;
      ctx.fillStyle = ['#2a6bff', '#4ea0ff', '#9ad4ff', '#ffffff'][k];
      ellipse(0, -62, 44 - k * 9 + Math.sin(time * 4 + k) * 3, 66 - k * 13);
    }
    ctx.globalAlpha = 1; ctx.restore();
    nameTag(`${name} ${coarse ? '▲' : '↑'}`, sx, F1 - 158, '#bfe3ff');
  }

  function drawNpc() {
    const sx = NPC_X - camX; if (sx < -150 || sx > W + 150) return;
    // 원본 그림의 흰 배경을 살리려고 안내 부스 안에 세운다
    const M = MAPS[save.map], bw = 196, bh = 172;
    ctx.fillStyle = M.beam; rr(sx - bw / 2 - 8, F1 - bh - 8, bw + 16, bh + 8, 16);
    ctx.fillStyle = '#fff'; rr(sx - bw / 2, F1 - bh, bw, bh, 10);
    if (npcImg.complete && npcImg.naturalWidth) {
      const h = 158, w = h * npcImg.naturalWidth / npcImg.naturalHeight;
      ctx.save();
      ctx.beginPath(); ctx.rect(sx - bw / 2, F1 - bh, bw, bh); ctx.clip();
      ctx.drawImage(npcImg, sx - w / 2, F1 - h - 4 + Math.sin(time * 2) * 2, w, h);
      ctx.restore();
    }
    ctx.fillStyle = M.accent; rr(sx - 52, F1 - bh - 26, 104, 28, 8);
    label('용어 안내소', sx, F1 - bh - 11, 16, '#fff');
    nameTag('오일이', sx, F1 + 8, '#ffe14a');
    const near = Math.abs(player.x - NPC_X) < 100 && player.y === F1;
    const by = F1 - 236 + Math.sin(time * 4) * 4;
    if (near) nameTag(coarse ? '▲ 를 눌러 대화' : '↑ 키로 대화', sx, by, '#fff');
    else { ctx.fillStyle = '#ffd21a'; circle(sx, by + 6, 15); label('!', sx, by + 7, 22, '#7a3c00'); }
  }

  // ───────── 캐릭터 ─────────
  function drawPlayer() {
    const p = player, x = p.x - camX, y = p.y;
    if (p.lvT > 0) {
      const g = ctx.createLinearGradient(0, y - 420, 0, y);
      g.addColorStop(0, 'rgba(255,240,140,0)'); g.addColorStop(1, `rgba(255,240,140,${Math.min(.7, p.lvT)})`);
      ctx.fillStyle = g; ctx.fillRect(x - 60, y - 420, 120, 420);
      label('LEVEL UP!', x, y - 150 - (1.8 - p.lvT) * 30, 40, '#ffe14a', '#a84a00', 7);
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ellipse(x, F1 === y || F2 === y || p.ground ? y + 2 : y + 2, 24, 6);
    if (p.dead > 0) {   // 묘비
      ctx.fillStyle = '#9aa3b3'; rr(x - 22, y - 56, 44, 56, 18);
      label('휴식', x, y - 28, 15, '#4a5568');
      return;
    }
    if (p.inv > 0 && Math.floor(time * 18) % 2) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(p.face, 1);
    const sw = p.ground && p.vx ? Math.sin(p.walk * 16) * 7 : 0;
    ctx.fillStyle = '#27406b'; rr(-13 + sw * .6, -24, 11, 22, 4); rr(2 - sw * .6, -24, 11, 22, 4);
    ctx.fillStyle = '#3a2a1c'; rr(-15 + sw * .6, -7, 16, 7, 3); rr(1 - sw * .6, -7, 16, 7, 3);
    ctx.fillStyle = '#2f6fd1'; rr(-17, -54, 34, 34, 9);
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(-17, -38, 34, 5);
    ctx.fillStyle = '#ffd9b3'; circle(0, -72, 22);
    ctx.fillStyle = '#5a3a22'; ctx.beginPath(); ctx.arc(-3, -72, 22, Math.PI * .55, Math.PI * 1.25); ctx.fill();
    ctx.fillStyle = '#2a1c12'; ellipse(7, -70, 3, 5.5); ellipse(17, -70, 2.5, 5.5);
    ctx.fillStyle = '#ff9d9d'; ellipse(3, -61, 5, 3);
    ctx.fillStyle = '#ffc21a'; ctx.beginPath(); ctx.arc(0, -78, 23, Math.PI, 0); ctx.fill(); rr(-25, -81, 55, 7, 3);
    ctx.fillStyle = '#e0a000'; rr(-4, -103, 8, 22, 4);
    // 팔과 렌치
    const dur = p.skill ? .45 : .32, prog = p.atkT > 0 ? 1 - p.atkT / dur : 0;
    const ang = p.atkT > 0 ? -2.9 + prog * 2.4 : -.45 + sw * .02;
    ctx.translate(6, -48); ctx.rotate(ang);
    ctx.fillStyle = '#2459ad'; rr(-5, 0, 10, 22, 5);
    ctx.fillStyle = p.skill && p.atkT > 0 ? '#ffd21a' : '#c9d2de'; rr(-3, 18, 6, 36, 2);
    ctx.beginPath(); ctx.arc(0, 58, 11, Math.PI * .75, Math.PI * 2.25); ctx.lineTo(0, 58); ctx.fill();
    ctx.fillStyle = '#ffd9b3'; circle(0, 22, 6);
    ctx.restore();
    nameTag('신입사원', x, y + 8);
  }

  // 분야별 몬스터 몸통. 발끝이 (0,0), 눈 높이와 글자 높이를 돌려준다
  const BODY = [
    c => {   // 원유 방울
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, -98); ctx.bezierCurveTo(6, -78, 40, -64, 40, -40);
      ctx.arc(0, -40, 40, 0, Math.PI); ctx.bezierCurveTo(-40, -64, -6, -78, 0, -98); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ellipse(-18, -58, 7, 12);
      return [-46, -18];
    },
    c => {   // 증류탑
      ctx.fillStyle = '#4a5360'; ctx.fillRect(10, -98, 12, 22); ctx.fillRect(30, -56, 12, 8); ctx.fillRect(36, -56, 6, 46);
      ctx.fillStyle = c; rr(-30, -82, 60, 82, 12);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-30, -68, 60, 4); ctx.fillRect(-30, -34, 60, 4);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(-24, -78, 6, 70);
      ctx.fillStyle = 'rgba(230,235,240,.75)'; circle(18 + Math.sin(time * 3) * 3, -108 - (time * 20 % 14), 7);
      return [-52, -18];
    },
    c => {   // 드럼통
      ctx.fillStyle = '#3a3a40'; rr(-10, -78, 20, 12, 3);
      ctx.fillStyle = c; rr(-34, -70, 68, 70, 12);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-34, -60, 68, 4); ctx.fillRect(-34, -32, 68, 4);
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(-27, -66, 6, 60);
      return [-46, -16];
    },
    c => {   // 분자(벤젠 고리)
      ctx.fillStyle = c; poly(0, -44, 44, 6, Math.PI / 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 3; poly(0, -44, 35, 6, Math.PI / 6); ctx.stroke();
      ctx.fillStyle = '#fff'; circle(-38, -66, 8); circle(38, -66, 8);
      ctx.fillStyle = c; circle(-38, -66, 5); circle(38, -66, 5);
      return [-52, -24];
    },
    c => {   // 동전
      ctx.fillStyle = '#8a6a10'; circle(0, -40, 42);
      ctx.fillStyle = c; circle(0, -42, 40);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -42, 32, 0, Math.PI * 2); ctx.stroke();
      return [-52, -24];
    }
  ];

  function drawMonster(m) {
    const x = m.x - camX; if (x < -90 || x > W + 90) return;
    const dying = m.dieT > 0, flash = m.hitT > .12;
    ctx.save();
    ctx.globalAlpha = dying ? m.dieT / .5 : Math.min(1, 1 - m.spawnT / .5);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ellipse(x, m.y + 2, 34, 7);
    ctx.translate(x + (m.hitT > 0 ? Math.sin(time * 90) * 3 : 0), m.y - (dying ? (.5 - m.dieT) * 50 : 0));
    const sq = 1 + Math.sin(m.phase) * .05; ctx.scale(1 / sq, sq);
    const [ey, ty] = BODY[m.t.cat](flash ? '#ffffff' : m.col);
    const look = (m.dir || 0) * 3;
    ctx.fillStyle = '#fff'; ellipse(-13, ey, 9, 11); ellipse(13, ey, 9, 11);
    ctx.fillStyle = '#16181f'; circle(-13 + look, ey + 1, 4.5); circle(13 + look, ey + 1, 4.5);
    if (m.aggro > 0) {
      ctx.strokeStyle = '#16181f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-24, ey - 16); ctx.lineTo(-5, ey - 9); ctx.moveTo(24, ey - 16); ctx.lineTo(5, ey - 9); ctx.stroke();
    }
    label(m.t.tag, 0, ty, m.t.tag.length > 4 ? 15 : 18, '#fff', 'rgba(0,0,0,.75)', 4);
    ctx.restore();
    if (dying) return;
    nameTag(m.t.name, x, m.y + 8, '#fff');
    if (m.hp < m.max) {
      ctx.fillStyle = '#16181f'; rr(x - 34, m.y - 122, 68, 9, 3);
      ctx.fillStyle = '#e62222'; ctx.fillRect(x - 32, m.y - 120, 64 * clamp(m.hp / m.max, 0, 1), 5);
    }
  }

  function drawItem(it) {
    const x = it.x - camX, y = it.y + (it.vy === 0 ? Math.sin(time * 5 + it.x) * 3 : 0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.35);
    ctx.fillStyle = '#f3dfa6'; rr(-17, -9, 34, 18, 3);
    ctx.fillStyle = '#b3262e'; rr(-21, -11, 8, 22, 3); rr(13, -11, 8, 22, 3);
    ctx.fillStyle = '#b08a4a'; ctx.fillRect(-8, -3, 16, 2); ctx.fillRect(-8, 2, 12, 2);
    ctx.restore();
  }

  function drawFx(f) {
    const x = f.x - camX, k = f.t / f.life;
    ctx.save(); ctx.globalAlpha = k > .6 ? (1 - k) / .4 : 1;
    if (f.type === 'num') {
      const y = f.y - k * 55, size = f.crit ? 40 : 32;
      if (f.hurt) label(f.text, x, y, 30, '#d8a2ff', '#3d0d6b', 6);
      else label(f.text + (f.crit ? '!' : ''), x, y, size, f.crit ? '#ff7ac8' : '#ffd21a', f.crit ? '#7a0d4a' : '#a83a00', 7);
    } else {   // 휘두른 궤적
      ctx.translate(x, f.y); ctx.scale(f.face, 1);
      ctx.strokeStyle = f.big ? '#ffe14a' : '#ffffff'; ctx.lineWidth = f.big ? 16 : 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(f.big ? -70 : -40, 0, f.big ? 130 : 80, -1.0 + k * .4, .7 + k * .2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMini() {
    const w = mini.width, h = mini.height, sx = w / WORLD_W, M = MAPS[save.map];
    const my = y => (y === F1 ? 60 : y === F2 ? 28 : 44);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = M.beamHi; mctx.fillRect(0, 60, w, 4); mctx.fillRect(0, 28, w, 4);
    for (const s of surfs) if (s.ledge) mctx.fillRect(s.x * sx, 44, s.w * sx, 3);
    const dot = (x, y, c, r) => { mctx.fillStyle = c; mctx.beginPath(); mctx.arc(x * sx, y, r, 0, 7); mctx.fill(); };
    if (save.map > 0) dot(PORTAL_L, 56, '#4ea0ff', 4);
    if (save.map < MAPS.length - 1) dot(PORTAL_R, 56, '#4ea0ff', 4);
    dot(NPC_X, 56, '#5ae05a', 3.5);
    for (const m of monsters) if (m.dieT <= 0) dot(m.x, my(m.y) - 4, '#ff5a4a', 2.5);
    dot(player.x, clamp(28 + (player.y - F2) / (F1 - F2) * 32, 6, 60) - 4, '#ffe14a', 3.5);
  }

  function render() {
    ctx.setTransform(Q, 0, 0, Q, 0, 0);
    drawBg();
    if (save.map > 0) drawPortal(PORTAL_L, MAPS[save.map - 1].name);
    if (save.map < MAPS.length - 1) drawPortal(PORTAL_R, MAPS[save.map + 1].name);
    drawNpc();
    monsters.forEach(drawMonster);
    items.forEach(drawItem);
    drawPlayer();
    fx.forEach(drawFx);
    if (bannerT > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, bannerT);
      label(MAPS[save.map].name, W / 2, 120, 52, '#fff', 'rgba(20,24,40,.85)', 9);
      label(`- ${MAPS[save.map].sub} -`, W / 2, 168, 24, '#ffe38a', 'rgba(20,24,40,.85)', 6);
      ctx.restore();
    }
    drawMini();
  }

  // ───────── 시작 ─────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.033, (now - last) / 1000); last = now;
    if (!modal) update(dt); else time += dt;
    render();
    requestAnimationFrame(frame);
  }

  enterMap(save.map, false);
  addChat('notice', `[공지] 몬스터 ${KILLS_PER_LV}마리를 잡을 때마다 레벨이 1 오릅니다. 최대 레벨은 ${MAX_LV}!`);
  if (!save.met) {
    save.met = true; persist();
    openDialog([
      '안녕, 신입사원! 난 <b>오일이</b>야. 정유·석유화학 용어가 너무 낯설지? 걱정 마, 여기선 <b>사냥하면서</b> 배울 수 있어!',
      '몬스터 몸에는 <b>산업 용어</b>가 적혀 있어. 잡으면 <b>비밀의 두루마리</b>가 떨어지고, 주우면 용어 설명이 펼쳐져.',
      CONTROLS,
      `몬스터 <b>${KILLS_PER_LV}마리</b>마다 <b>1레벨</b>! 최대 <b>Lv.${MAX_LV}</b>까지 올릴 수 있어. 궁금한 게 생기면 언제든 나한테 말을 걸어줘!`
    ]);
  }
  requestAnimationFrame(frame);
})();
