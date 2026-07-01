(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hudHealth = document.getElementById('hudHealth');
  const hudAmmo = document.getElementById('hudAmmo');
  const hudEnemies = document.getElementById('hudEnemies');
  const hudStatus = document.getElementById('hudStatus');
  const message = document.getElementById('message');
  const messageTitle = document.getElementById('messageTitle');
  const messageText = document.getElementById('messageText');
  const restartButton = document.getElementById('restartButton');

  const WORLD_W = 4300;
  const GROUND_Y = 300;
  const GRAVITY = 1250;
  const PLAYER_MAX_HP = 6;
  const PLAYER_MAX_AMMO = 6;
  const ACTIONS = ['left', 'right', 'jump', 'shoot', 'reload'];
  const PALETTE = {
    sky: '#55c7e8',
    skyLow: '#f7b267',
    ink: '#090a10',
    coat: '#11131b',
    coatHi: '#32364a',
    hair: '#050509',
    skin: '#d98f5f',
    skinHi: '#ffd19a',
    gun: '#1a1d22',
    stock: '#7d4936',
    boot: '#08080d',
    red: '#db3a34',
    yellow: '#ffd166',
    green: '#48d597',
    cyan: '#9fe7ff',
    purple: '#5c4b9b'
  };

  let view = { w: 1, h: 1, dpr: 1 };
  let atlas;
  let game;
  let lastTime = 0;
  let rng = mulberry32(0x5eed1234);

  const input = {
    key: Object.create(null),
    touch: Object.create(null),
    last: Object.create(null),
    pointers: new Map()
  };

  const keyMap = new Map([
    ['ArrowLeft', 'left'], ['KeyA', 'left'],
    ['ArrowRight', 'right'], ['KeyD', 'right'],
    ['ArrowUp', 'jump'], ['KeyW', 'jump'], ['Space', 'jump'],
    ['KeyJ', 'shoot'], ['KeyX', 'shoot'],
    ['KeyR', 'reload']
  ]);

  function mulberry32(seed) {
    return function next() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function sign(v) {
    return v < 0 ? -1 : 1;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function actionDown(name) {
    return !!input.key[name] || !!input.touch[name];
  }

  function actionPressed(name) {
    return actionDown(name) && !input.last[name];
  }

  function finishInputFrame() {
    for (const action of ACTIONS) input.last[action] = actionDown(action);
  }

  function resize() {
    view.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    view.w = Math.max(320, Math.floor(window.innerWidth));
    view.h = Math.max(240, Math.floor(window.innerHeight));
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function installInput() {
    window.addEventListener('keydown', (event) => {
      const action = keyMap.get(event.code);
      if (!action) return;
      input.key[action] = true;
      event.preventDefault();
      if (game && game.state !== 'playing' && (action === 'jump' || action === 'shoot')) resetGame();
    });

    window.addEventListener('keyup', (event) => {
      const action = keyMap.get(event.code);
      if (!action) return;
      input.key[action] = false;
      event.preventDefault();
    });

    document.querySelectorAll('.touch-btn').forEach((button) => {
      const action = button.dataset.action;
      const press = (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        input.pointers.set(event.pointerId, { action, button });
        input.touch[action] = true;
        button.classList.add('is-down');
        if (game && game.state !== 'playing' && (action === 'jump' || action === 'shoot')) resetGame();
      };
      const release = (event) => {
        event.preventDefault();
        const held = input.pointers.get(event.pointerId);
        if (!held) return;
        input.pointers.delete(event.pointerId);
        held.button.classList.remove('is-down');
        input.touch[held.action] = false;
        for (const pointer of input.pointers.values()) {
          if (pointer.action === held.action) input.touch[held.action] = true;
        }
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    });

    restartButton.addEventListener('click', resetGame);
    window.addEventListener('resize', resize);
    window.addEventListener('blur', () => {
      for (const action of ACTIONS) {
        input.key[action] = false;
        input.touch[action] = false;
        input.last[action] = false;
      }
      input.pointers.clear();
      document.querySelectorAll('.touch-btn').forEach((button) => button.classList.remove('is-down'));
    });
  }

  function buildAtlas() {
    const sheet = document.createElement('canvas');
    sheet.width = 1024;
    sheet.height = 1024;
    const aCtx = sheet.getContext('2d');
    aCtx.imageSmoothingEnabled = false;
    const frames = {};
    let x = 0;
    let y = 0;
    let rowH = 0;

    function alloc(w, h) {
      if (x + w > sheet.width) {
        x = 0;
        y += rowH + 2;
        rowH = 0;
      }
      const frame = { x, y, w, h };
      x += w + 2;
      rowH = Math.max(rowH, h);
      return frame;
    }

    function make(name, state, count, w, h, draw) {
      frames[name] ||= {};
      frames[name][state] = [];
      for (let i = 0; i < count; i += 1) {
        const frame = alloc(w, h);
        aCtx.save();
        aCtx.translate(frame.x, frame.y);
        draw(aCtx, i, w, h);
        aCtx.restore();
        frames[name][state].push(frame);
      }
    }

    make('player', 'idle', 4, 54, 52, (c, i) => drawPlayerSprite(c, 'idle', i));
    make('player', 'walk', 6, 54, 52, (c, i) => drawPlayerSprite(c, 'walk', i));
    make('player', 'jump', 1, 54, 52, (c, i) => drawPlayerSprite(c, 'jump', i));
    make('player', 'fall', 1, 54, 52, (c, i) => drawPlayerSprite(c, 'fall', i));
    make('player', 'shoot', 3, 62, 52, (c, i) => drawPlayerSprite(c, 'shoot', i));
    make('player', 'reload', 5, 54, 52, (c, i) => drawPlayerSprite(c, 'reload', i));
    make('player', 'hurt', 2, 54, 52, (c, i) => drawPlayerSprite(c, 'hurt', i));
    make('player', 'death', 4, 62, 52, (c, i) => drawPlayerSprite(c, 'death', i));

    make('grunt', 'walk', 4, 42, 44, (c, i) => drawEnemySprite(c, 'grunt', 'walk', i));
    make('grunt', 'shoot', 2, 48, 44, (c, i) => drawEnemySprite(c, 'grunt', 'shoot', i));
    make('grunt', 'hurt', 1, 42, 44, (c, i) => drawEnemySprite(c, 'grunt', 'hurt', i));
    make('bruiser', 'walk', 4, 48, 48, (c, i) => drawEnemySprite(c, 'bruiser', 'walk', i));
    make('bruiser', 'attack', 2, 54, 48, (c, i) => drawEnemySprite(c, 'bruiser', 'attack', i));
    make('bruiser', 'hurt', 1, 48, 48, (c, i) => drawEnemySprite(c, 'bruiser', 'hurt', i));
    make('boss', 'walk', 4, 70, 62, (c, i) => drawEnemySprite(c, 'boss', 'walk', i));
    make('boss', 'shoot', 3, 76, 62, (c, i) => drawEnemySprite(c, 'boss', 'shoot', i));
    make('boss', 'hurt', 1, 70, 62, (c, i) => drawEnemySprite(c, 'boss', 'hurt', i));
    make('pickup', 'health', 1, 24, 24, drawHealthPickup);
    make('pickup', 'shells', 1, 24, 24, drawShellPickup);

    return { sheet, frames };
  }

  function fill(c, color, x, y, w, h) {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawPlayerSprite(c, state, i) {
    const walk = state === 'walk';
    const runStep = walk ? Math.sin((i / 6) * Math.PI * 2) : 0;
    const idleBob = state === 'idle' ? (i === 1 || i === 2 ? -1 : 0) : 0;
    const hurt = state === 'hurt';
    const death = state === 'death';
    const shoot = state === 'shoot';
    const reload = state === 'reload';
    const jump = state === 'jump';
    const fall = state === 'fall';
    const flap = walk ? Math.round(runStep * 3) : reload ? i - 2 : shoot ? 2 : 0;
    const hairSwing = walk ? Math.round(-runStep * 2) : jump ? 2 : fall ? -2 : reload ? i % 2 : 0;

    if (death && i >= 2) {
      fill(c, '#09090d', 8, 37, 42, 8);
      fill(c, PALETTE.coat, 14, 29, 31, 13);
      fill(c, PALETTE.coatHi, 16, 31, 24, 2);
      fill(c, PALETTE.hair, 34, 24, 12, 11);
      fill(c, PALETTE.skin, 44, 27, 8, 8);
      fill(c, PALETTE.gun, 4, 35, 26, 3);
      fill(c, '#5a1f2f', 23, 27, 5, 4);
      return;
    }

    const ox = hurt ? -2 : 0;
    const y = 1 + idleBob + (death ? i * 3 : 0);
    const crouch = reload ? Math.min(i, 2) : 0;
    const headY = y + 7 + crouch;
    const bodyY = y + 20 + crouch;
    const legY = y + 38 + crouch;

    fill(c, PALETTE.boot, 17 + Math.max(0, runStep * 3), legY + 7, 8, 5);
    fill(c, PALETTE.boot, 27 + Math.min(0, runStep * 3), legY + 7, 8, 5);
    fill(c, '#222437', 18 + runStep * 2, legY, 7, 9);
    fill(c, '#181a29', 27 - runStep * 2, legY, 7, 9);

    fill(c, PALETTE.coat, 13 + ox, bodyY - 2, 24, 23);
    fill(c, '#07080d', 11 + ox - flap, bodyY + 7, 12, 21);
    fill(c, '#191b27', 28 + ox + flap, bodyY + 5, 11, 23);
    fill(c, PALETTE.coatHi, 31 + ox, bodyY, 3, 20);
    fill(c, '#2c3044', 16 + ox, bodyY + 1, 14, 2);
    fill(c, '#0d0e15', 12 + ox, bodyY - 4, 27, 6);

    fill(c, PALETTE.hair, 12 + ox + hairSwing, headY + 1, 15, 22);
    fill(c, PALETTE.hair, 18 + ox, headY - 2, 15, 11);
    fill(c, PALETTE.skin, 24 + ox, headY + 2, 10, 11);
    fill(c, PALETTE.skinHi, 30 + ox, headY + 5, 5, 4);
    fill(c, PALETTE.hair, 23 + ox, headY - 1, 7, 5);
    fill(c, '#111', 32 + ox, headY + 6, 2, 2);

    if (hurt) {
      fill(c, PALETTE.red, 28 + ox, bodyY + 2, 6, 4);
      fill(c, '#ffffff', 34 + ox, headY + 1, 4, 3);
    }

    if (reload) {
      fill(c, PALETTE.coat, 33 + ox, bodyY + 6, 7, 11);
      fill(c, PALETTE.skin, 36 + ox, bodyY + 15, 6, 5);
      fill(c, PALETTE.stock, 28 + ox, bodyY + 18 - i, 10, 4);
      fill(c, PALETTE.gun, 36 + ox, bodyY + 11 - i, 4, 19);
      fill(c, PALETTE.yellow, 42 + ox, bodyY + 17 - i, 3, 5);
      return;
    }

    if (shoot) {
      fill(c, PALETTE.coat, 34 + ox, bodyY + 4, 11, 6);
      fill(c, PALETTE.skin, 43 + ox, bodyY + 5, 5, 5);
      fill(c, PALETTE.stock, 27 + ox, bodyY + 7, 12, 6);
      fill(c, PALETTE.gun, 38 + ox, bodyY + 6, 20, 4);
      if (i < 2) {
        fill(c, '#fff8b8', 58 + ox, bodyY + 4, 4, 8);
        fill(c, PALETTE.yellow, 62 + ox, bodyY + 6, 5, 4);
        fill(c, '#ff7a3d', 67 + ox, bodyY + 7, 3, 2);
      }
      return;
    }

    const armLift = jump ? -4 : fall ? 2 : 0;
    fill(c, PALETTE.coat, 33 + ox, bodyY + 6 + armLift, 10, 6);
    fill(c, PALETTE.skin, 41 + ox, bodyY + 7 + armLift, 5, 5);
    fill(c, PALETTE.stock, 27 + ox, bodyY + 11 + armLift, 11, 5);
    fill(c, PALETTE.gun, 37 + ox, bodyY + 10 + armLift, 17, 3);
  }

  function drawEnemySprite(c, type, state, i) {
    const step = Math.sin((i / 4) * Math.PI * 2);
    const hurt = state === 'hurt';
    if (type === 'boss') {
      const y = hurt ? 3 : 0;
      fill(c, '#120f19', 20, 45 + y, 12, 6);
      fill(c, '#120f19', 40, 45 + y, 12, 6);
      fill(c, '#3a2d5c', 19 + step, 34 + y, 12, 14);
      fill(c, '#30264d', 40 - step, 34 + y, 12, 14);
      fill(c, '#4b304d', 18, 19 + y, 36, 23);
      fill(c, '#7b3f58', 21, 18 + y, 30, 5);
      fill(c, '#14151c', 24, 8 + y, 25, 15);
      fill(c, '#d69262', 30, 11 + y, 15, 11);
      fill(c, '#050509', 22, 6 + y, 22, 9);
      fill(c, hurt ? PALETTE.red : PALETTE.cyan, 45, 13 + y, 3, 3);
      fill(c, '#30251c', 40, 25 + y, 12, 8);
      fill(c, PALETTE.gun, 50, 25 + y, 24, 5);
      if (state === 'shoot') fill(c, PALETTE.yellow, 73, 23 + y, 7, 8);
      return;
    }

    const big = type === 'bruiser';
    const baseY = big ? 8 : 10;
    const body = big ? '#355c4a' : '#803039';
    fill(c, PALETTE.boot, 13 + step, 36, 8, 5);
    fill(c, PALETTE.boot, 25 - step, 36, 8, 5);
    fill(c, big ? '#273d38' : '#4a2830', 14 + step, 28, 7, 10);
    fill(c, big ? '#223631' : '#39242b', 25 - step, 28, 7, 10);
    fill(c, hurt ? PALETTE.red : body, 12, 18, big ? 25 : 21, big ? 18 : 16);
    fill(c, '#222335', 15, 13, big ? 20 : 16, 8);
    fill(c, PALETTE.skin, 18, baseY, 13, 10);
    fill(c, '#111', 25, baseY + 4, 2, 2);
    fill(c, '#c22536', 13, baseY - 1, 22, 4);
    if (big) {
      fill(c, '#6f3d2d', 31, 20, 7, 19);
      fill(c, '#c8954d', 36, state === 'attack' ? 11 : 17, 5, 24);
    } else {
      fill(c, '#572c24', 28, 23, 8, 5);
      fill(c, PALETTE.gun, 35, 22, 15, 3);
      if (state === 'shoot') fill(c, PALETTE.yellow, 49, 20, 6, 6);
    }
  }

  function drawHealthPickup(c) {
    fill(c, '#ffffff', 5, 5, 14, 14);
    fill(c, PALETTE.red, 10, 7, 4, 10);
    fill(c, PALETTE.red, 7, 10, 10, 4);
    fill(c, '#7a2530', 4, 19, 16, 3);
  }

  function drawShellPickup(c) {
    fill(c, '#40342c', 3, 8, 18, 11);
    for (let i = 0; i < 4; i += 1) {
      fill(c, PALETTE.red, 5 + i * 4, 5, 3, 11);
      fill(c, PALETTE.yellow, 5 + i * 4, 4, 3, 2);
    }
    fill(c, '#241d19', 3, 18, 18, 3);
  }

  function createSolids() {
    return [
      { x: -200, y: GROUND_Y, w: WORLD_W + 400, h: 120, kind: 'ground' },
      { x: 430, y: 252, w: 165, h: 18, kind: 'platform' },
      { x: 760, y: 220, w: 170, h: 18, kind: 'platform' },
      { x: 1090, y: 260, w: 70, h: 40, kind: 'cover' },
      { x: 1235, y: 238, w: 185, h: 18, kind: 'platform' },
      { x: 1570, y: 260, w: 82, h: 40, kind: 'cover' },
      { x: 1820, y: 222, w: 210, h: 18, kind: 'platform' },
      { x: 2160, y: 252, w: 160, h: 18, kind: 'platform' },
      { x: 2460, y: 260, w: 85, h: 40, kind: 'cover' },
      { x: 2740, y: 225, w: 190, h: 18, kind: 'platform' },
      { x: 3140, y: 260, w: 105, h: 40, kind: 'cover' },
      { x: 3360, y: 220, w: 185, h: 18, kind: 'platform' }
    ];
  }

  function createEnemies() {
    return [
      enemy('grunt', 610, 170, 485, 760),
      enemy('bruiser', 1020, 230, 970, 1180),
      enemy('grunt', 1380, 190, 1240, 1480),
      enemy('grunt', 1865, 174, 1760, 2040),
      enemy('bruiser', 2290, 222, 2140, 2410),
      enemy('grunt', 2830, 177, 2700, 2980),
      enemy('boss', 3660, 238, 3460, 3870)
    ];
  }

  function enemy(type, x, y, min, max) {
    const boss = type === 'boss';
    const bruiser = type === 'bruiser';
    return {
      type,
      x,
      y,
      w: boss ? 46 : bruiser ? 34 : 28,
      h: boss ? 54 : bruiser ? 40 : 36,
      vx: 0,
      vy: 0,
      dir: -1,
      min,
      max,
      hp: boss ? 16 : bruiser ? 5 : 3,
      maxHp: boss ? 16 : bruiser ? 5 : 3,
      speed: boss ? 44 : bruiser ? 58 : 70,
      cooldown: 0.5 + rng(),
      attackPose: 0,
      hurt: 0,
      dead: false,
      grounded: false,
      anim: 0
    };
  }

  function createPickups() {
    return [
      { type: 'shells', x: 510, y: 226, w: 22, h: 22, taken: false },
      { type: 'health', x: 1265, y: 212, w: 22, h: 22, taken: false },
      { type: 'shells', x: 2210, y: 226, w: 22, h: 22, taken: false },
      { type: 'health', x: 2870, y: 199, w: 22, h: 22, taken: false },
      { type: 'shells', x: 3300, y: 276, w: 22, h: 22, taken: false }
    ];
  }

  function createDecals() {
    const decors = [];
    const local = mulberry32(0x90a5);
    for (let x = 80; x < WORLD_W; x += 130 + Math.floor(local() * 120)) {
      decors.push({
        x,
        h: 30 + Math.floor(local() * 70),
        w: 20 + Math.floor(local() * 35),
        color: local() > 0.55 ? '#26324e' : '#343051'
      });
    }
    return decors;
  }

  function resetGame() {
    rng = mulberry32(0x5eed1234);
    game = {
      state: 'playing',
      time: 0,
      status: 'Reach the extraction sign.',
      solids: createSolids(),
      enemies: createEnemies(),
      pickups: createPickups(),
      decals: createDecals(),
      pellets: [],
      particles: [],
      flashes: [],
      enemyShots: [],
      camera: { x: 0, y: 0 },
      shake: 0,
      finish: { x: WORLD_W - 210, y: GROUND_Y - 90, w: 96, h: 90 },
      player: {
        x: 76,
        y: GROUND_Y - 46,
        w: 30,
        h: 46,
        vx: 0,
        vy: 0,
        facing: 1,
        health: PLAYER_MAX_HP,
        ammo: PLAYER_MAX_AMMO,
        reload: 0,
        shootCd: 0,
        shootPose: 0,
        hurt: 0,
        invuln: 0,
        grounded: false,
        dead: false,
        deathT: 0,
        anim: 0
      }
    };
    message.classList.add('hidden');
    syncHud();
  }

  function update(dt) {
    game.time += dt;
    game.shake = Math.max(0, game.shake - dt * 22);

    if (game.state === 'playing') {
      updatePlayer(dt);
      updateEnemies(dt);
      updatePickups();
      updateProjectiles(dt);
      checkFinish();
    } else if (game.state === 'dead') {
      const p = game.player;
      p.deathT += dt;
      p.anim += dt;
      if (p.deathT > 0.55) p.vx *= Math.pow(0.001, dt);
    }

    updateParticles(dt);
    updateCamera();
    syncHud();
    finishInputFrame();
  }

  function updatePlayer(dt) {
    const p = game.player;
    p.anim += dt;
    p.shootCd = Math.max(0, p.shootCd - dt);
    p.shootPose = Math.max(0, p.shootPose - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    const move = (actionDown('right') ? 1 : 0) - (actionDown('left') ? 1 : 0);
    if (move) {
      p.facing = move;
      p.vx += move * 980 * dt;
    } else {
      p.vx *= Math.pow(0.0009, dt);
    }
    p.vx = clamp(p.vx, -190, 190);

    if (actionPressed('jump') && p.grounded) {
      p.vy = -500;
      p.grounded = false;
      emitDust(p.x + p.w / 2, p.y + p.h, 7);
    }

    if (actionPressed('reload')) startReload();
    if (p.ammo <= 0 && p.reload <= 0) startReload();
    if (p.reload > 0) {
      p.reload -= dt;
      if (p.reload <= 0) {
        p.reload = 0;
        p.ammo = PLAYER_MAX_AMMO;
        popText(p.x + 12, p.y - 10, 'loaded', PALETTE.cyan);
      }
    }

    if (actionDown('shoot') && p.shootCd <= 0) shootShotgun();

    p.vy += GRAVITY * dt;
    moveEntity(p, dt);
    p.x = clamp(p.x, 8, WORLD_W - p.w - 8);
    if (p.y > GROUND_Y + 120) damagePlayer(PLAYER_MAX_HP, -p.facing);
  }

  function startReload() {
    const p = game.player;
    if (p.reload > 0 || p.ammo >= PLAYER_MAX_AMMO || p.dead) return;
    p.reload = 0.88;
    p.shootPose = 0;
  }

  function shootShotgun() {
    const p = game.player;
    if (p.reload > 0 || p.dead) return;
    if (p.ammo <= 0) {
      startReload();
      return;
    }
    p.ammo -= 1;
    p.shootCd = 0.42;
    p.shootPose = 0.2;
    p.vx -= p.facing * 84;
    game.shake = Math.max(game.shake, 7);

    const muzzleX = p.x + (p.facing > 0 ? 53 : -21);
    const muzzleY = p.y + 24;
    for (let i = 0; i < 9; i += 1) {
      const spread = (rng() - 0.5) * 0.55;
      game.pellets.push({
        x: muzzleX,
        y: muzzleY + (rng() - 0.5) * 5,
        vx: p.facing * (780 + rng() * 230),
        vy: spread * 360,
        life: 0.22 + rng() * 0.08,
        damage: i < 3 ? 2 : 1,
        owner: 'player',
        w: 5,
        h: 3
      });
    }
    for (let i = 0; i < 15; i += 1) {
      particle(muzzleX, muzzleY, p.facing * (90 + rng() * 280), (rng() - 0.5) * 180, rng() > 0.35 ? PALETTE.yellow : '#ff7a3d', 0.08 + rng() * 0.15, 2 + rng() * 4);
    }
  }

  function updateEnemies(dt) {
    const p = game.player;
    for (const e of game.enemies) {
      if (e.dead) continue;
      e.anim += dt;
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.hurt = Math.max(0, e.hurt - dt);
      e.attackPose = Math.max(0, e.attackPose - dt);

      const dx = (p.x + p.w / 2) - (e.x + e.w / 2);
      const near = Math.abs(dx) < (e.type === 'boss' ? 760 : 560) && Math.abs(p.y - e.y) < 120;
      if (near) e.dir = sign(dx);

      if (e.type === 'grunt') {
        if (near && Math.abs(dx) < 520) {
          e.vx *= Math.pow(0.02, dt);
          if (e.cooldown <= 0) enemyShoot(e, 1);
        } else {
          patrol(e, dt);
        }
      } else if (e.type === 'bruiser') {
        if (near) {
          e.vx += e.dir * 520 * dt;
          e.vx = clamp(e.vx, -e.speed, e.speed);
          if (Math.abs(dx) < 46 && e.cooldown <= 0) enemyMelee(e);
        } else {
          patrol(e, dt);
        }
      } else {
        if (near) {
          e.vx += e.dir * 250 * dt;
          e.vx = clamp(e.vx, -e.speed, e.speed);
          if (Math.abs(dx) < 74 && e.cooldown <= 0) enemyMelee(e);
          if (Math.abs(dx) > 110 && e.cooldown <= 0) enemyShoot(e, 3);
        } else {
          patrol(e, dt);
        }
      }

      e.vy += GRAVITY * dt;
      moveEntity(e, dt);
      if (e.x < e.min) {
        e.x = e.min;
        e.dir = 1;
      }
      if (e.x > e.max) {
        e.x = e.max;
        e.dir = -1;
      }
    }
  }

  function patrol(e, dt) {
    e.vx += e.dir * e.speed * 8 * dt;
    e.vx = clamp(e.vx, -e.speed, e.speed);
    if (e.x <= e.min + 2) e.dir = 1;
    if (e.x >= e.max - 2) e.dir = -1;
  }

  function enemyShoot(e, count) {
    e.cooldown = e.type === 'boss' ? 1.25 : 1.35 + rng() * 0.6;
    e.attackPose = 0.25;
    const px = game.player.x + game.player.w / 2;
    const py = game.player.y + game.player.h * 0.45;
    const muzzleX = e.x + e.w / 2 + e.dir * (e.type === 'boss' ? 42 : 27);
    const muzzleY = e.y + (e.type === 'boss' ? 25 : 20);
    for (let i = 0; i < count; i += 1) {
      const dy = clamp((py - muzzleY) * 1.2, -120, 120);
      game.enemyShots.push({
        x: muzzleX,
        y: muzzleY + i * 4 - count * 2,
        vx: e.dir * (260 + rng() * 80),
        vy: dy + (rng() - 0.5) * 110,
        life: 2.3,
        damage: e.type === 'boss' ? 2 : 1,
        w: 7,
        h: 4
      });
    }
    for (let i = 0; i < 7; i += 1) {
      particle(muzzleX, muzzleY, e.dir * (80 + rng() * 130), (rng() - 0.5) * 90, PALETTE.yellow, 0.1, 2 + rng() * 2);
    }
  }

  function enemyMelee(e) {
    e.cooldown = e.type === 'boss' ? 1.05 : 0.9;
    e.attackPose = 0.35;
    const hit = {
      x: e.x + (e.dir > 0 ? e.w - 4 : -26),
      y: e.y + 12,
      w: 32,
      h: 24
    };
    if (rectsOverlap(hit, game.player)) damagePlayer(e.type === 'boss' ? 2 : 1, e.dir);
    for (let i = 0; i < 5; i += 1) {
      particle(hit.x + hit.w / 2, hit.y + hit.h / 2, e.dir * (60 + rng() * 120), (rng() - 0.5) * 120, '#c8954d', 0.16, 2 + rng() * 3);
    }
  }

  function moveEntity(e, dt) {
    const prevX = e.x;
    e.x += e.vx * dt;
    for (const s of game.solids) {
      if (s.kind === 'platform') continue;
      if (!rectsOverlap(e, s)) continue;
      if (prevX + e.w <= s.x) e.x = s.x - e.w;
      else if (prevX >= s.x + s.w) e.x = s.x + s.w;
      e.vx = 0;
    }

    const prevY = e.y;
    e.y += e.vy * dt;
    e.grounded = false;
    for (const s of game.solids) {
      if (!rectsOverlap(e, s)) continue;
      const wasAbove = prevY + e.h <= s.y;
      const wasBelow = prevY >= s.y + s.h;
      if (wasAbove && e.vy >= 0) {
        e.y = s.y - e.h;
        e.vy = 0;
        e.grounded = true;
      } else if (wasBelow && e.vy < 0 && s.kind !== 'platform') {
        e.y = s.y + s.h;
        e.vy = 0;
      } else if (s.kind !== 'platform') {
        if (e.y + e.h / 2 < s.y + s.h / 2) {
          e.y = s.y - e.h;
          e.vy = 0;
          e.grounded = true;
        } else {
          e.y = s.y + s.h;
          e.vy = Math.max(0, e.vy);
        }
      }
    }
  }

  function updatePickups() {
    const p = game.player;
    for (const pick of game.pickups) {
      if (pick.taken || !rectsOverlap(p, pick)) continue;
      pick.taken = true;
      if (pick.type === 'health') {
        p.health = Math.min(PLAYER_MAX_HP, p.health + 2);
        popText(pick.x, pick.y - 8, '+HP', PALETTE.green);
      } else {
        p.ammo = PLAYER_MAX_AMMO;
        p.reload = 0;
        popText(pick.x, pick.y - 8, 'shells', PALETTE.yellow);
      }
      for (let i = 0; i < 14; i += 1) {
        particle(pick.x + 11, pick.y + 11, (rng() - 0.5) * 130, -40 - rng() * 100, pick.type === 'health' ? PALETTE.green : PALETTE.yellow, 0.22, 2 + rng() * 3);
      }
    }
  }

  function updateProjectiles(dt) {
    for (const b of game.pellets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.vy += 140 * dt;
      const box = { x: b.x, y: b.y, w: b.w, h: b.h };
      for (const s of game.solids) {
        if (s.kind === 'platform') continue;
        if (rectsOverlap(box, s)) {
          b.life = 0;
          impact(b.x, b.y, '#d7d7c1');
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const e of game.enemies) {
        if (e.dead || !rectsOverlap(box, e)) continue;
        b.life = 0;
        damageEnemy(e, b.damage, sign(b.vx));
        break;
      }
    }
    game.pellets = game.pellets.filter((b) => b.life > 0);

    for (const b of game.enemyShots) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const box = { x: b.x, y: b.y, w: b.w, h: b.h };
      for (const s of game.solids) {
        if (s.kind === 'platform') continue;
        if (rectsOverlap(box, s)) {
          b.life = 0;
          impact(b.x, b.y, '#ff9f6e');
          break;
        }
      }
      if (b.life > 0 && rectsOverlap(box, game.player)) {
        b.life = 0;
        damagePlayer(b.damage, sign(b.vx));
      }
    }
    game.enemyShots = game.enemyShots.filter((b) => b.life > 0);
  }

  function damageEnemy(e, amount, fromDir) {
    e.hp -= amount;
    e.hurt = 0.16;
    e.vx += fromDir * 120;
    game.shake = Math.max(game.shake, e.type === 'boss' ? 6 : 4);
    for (let i = 0; i < 8; i += 1) {
      particle(e.x + e.w / 2, e.y + e.h / 2, fromDir * (60 + rng() * 170), (rng() - 0.5) * 170, rng() > 0.3 ? PALETTE.red : '#ffffff', 0.16 + rng() * 0.18, 2 + rng() * 3);
    }
    if (e.hp <= 0) {
      e.dead = true;
      e.vx = fromDir * 90;
      for (let i = 0; i < 18; i += 1) {
        particle(e.x + e.w / 2, e.y + e.h / 2, (rng() - 0.5) * 260, -40 - rng() * 240, e.type === 'boss' ? PALETTE.purple : PALETTE.red, 0.3 + rng() * 0.4, 2 + rng() * 4);
      }
      popText(e.x, e.y - 12, e.type === 'boss' ? 'boss down' : 'down', PALETTE.yellow);
    }
  }

  function damagePlayer(amount, fromDir) {
    const p = game.player;
    if (p.invuln > 0 || p.dead || game.state !== 'playing') return;
    p.health = Math.max(0, p.health - amount);
    p.hurt = 0.44;
    p.invuln = 0.8;
    p.vx += fromDir * 230;
    p.vy = Math.min(p.vy, -170);
    game.shake = Math.max(game.shake, 9);
    for (let i = 0; i < 14; i += 1) {
      particle(p.x + p.w / 2, p.y + p.h / 2, fromDir * (70 + rng() * 170), (rng() - 0.5) * 210, rng() > 0.35 ? PALETTE.red : '#ffffff', 0.2, 2 + rng() * 3);
    }
    if (p.health <= 0) {
      p.dead = true;
      p.deathT = 0;
      p.shootPose = 0;
      p.reload = 0;
      game.state = 'dead';
      showMessage('Shot Down', 'The extraction route ate all your shells. Press restart or shoot/jump to try again.');
    }
  }

  function checkFinish() {
    const p = game.player;
    const bossAlive = game.enemies.some((e) => e.type === 'boss' && !e.dead);
    if (bossAlive && p.x > game.finish.x - 130) {
      game.status = 'Defeat the coat-breaker before extraction.';
    } else {
      game.status = 'Reach the extraction sign.';
    }
    if (!bossAlive && rectsOverlap(p, game.finish)) {
      game.state = 'won';
      game.shake = Math.max(game.shake, 6);
      showMessage('Extracted', 'You cleared the block, beat the tough enemy, and made it out alive.');
    }
  }

  function particle(x, y, vx, vy, color, life, size) {
    game.particles.push({ x, y, vx, vy, color, life, maxLife: life, size, text: '' });
  }

  function popText(x, y, text, color) {
    game.particles.push({ x, y, vx: 0, vy: -34, color, life: 0.7, maxLife: 0.7, size: 1, text });
  }

  function impact(x, y, color) {
    for (let i = 0; i < 5; i += 1) {
      particle(x, y, (rng() - 0.5) * 130, (rng() - 0.5) * 130, color, 0.14 + rng() * 0.1, 1 + rng() * 3);
    }
  }

  function emitDust(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      particle(x, y, (rng() - 0.5) * 120, -20 - rng() * 60, '#b08a68', 0.2 + rng() * 0.15, 2 + rng() * 3);
    }
  }

  function updateParticles(dt) {
    for (const p of game.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 280 * dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);
  }

  function updateCamera() {
    const p = game.player;
    const maxX = Math.max(0, WORLD_W - view.w);
    const targetX = clamp(p.x + p.w / 2 - view.w * 0.42, 0, maxX);
    game.camera.x += (targetX - game.camera.x) * 0.12;
    game.camera.y = GROUND_Y - view.h + 68;
  }

  function showMessage(title, text) {
    messageTitle.textContent = title;
    messageText.textContent = text;
    message.classList.remove('hidden');
  }

  function syncHud() {
    const p = game.player;
    const aliveEnemies = game.enemies.filter((e) => !e.dead).length;
    hudHealth.textContent = `${p.health}/${PLAYER_MAX_HP}`;
    hudAmmo.textContent = p.reload > 0 ? `reloading ${Math.ceil(p.reload * 10)}` : `${p.ammo}/${PLAYER_MAX_AMMO}`;
    hudEnemies.textContent = `${aliveEnemies}`;
    hudStatus.textContent = game.state === 'won' ? 'Extraction complete.' : game.state === 'dead' ? 'Restart to try again.' : game.status;
  }

  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, view.w, view.h);
    drawBackground();

    const shake = game.shake > 0 ? game.shake : 0;
    const sx = shake ? Math.round((rng() - 0.5) * shake) : 0;
    const sy = shake ? Math.round((rng() - 0.5) * shake) : 0;
    ctx.save();
    ctx.translate(Math.round(-game.camera.x + sx), Math.round(-game.camera.y + sy));
    drawLevel();
    drawFinish();
    drawPickups();
    drawProjectiles();
    drawEnemies();
    drawPlayer();
    drawParticles();
    ctx.restore();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, PALETTE.sky);
    g.addColorStop(0.52, '#6ed0d9');
    g.addColorStop(1, PALETTE.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    const horizon = view.h - 130;
    drawParallaxBlocks(0.12, horizon - 70, '#496184', 24, 2);
    drawParallaxBlocks(0.22, horizon - 42, '#27385d', 36, 3);
    drawParallaxBlocks(0.34, horizon - 10, '#19223a', 54, 5);

    ctx.fillStyle = 'rgba(255, 248, 214, 0.35)';
    for (let i = 0; i < 9; i += 1) {
      const x = Math.floor((i * 211 - game.camera.x * 0.08) % (view.w + 140)) - 70;
      const y = 24 + (i % 4) * 23;
      ctx.fillRect(x, y, 34, 6);
      ctx.fillRect(x + 10, y - 6, 28, 6);
      ctx.fillRect(x + 42, y + 2, 22, 6);
    }
  }

  function drawParallaxBlocks(rate, baseY, color, baseH, stride) {
    ctx.fillStyle = color;
    const offset = -game.camera.x * rate;
    for (let i = -1; i < Math.ceil(view.w / 72) + 3; i += 1) {
      const x = Math.floor(i * 72 + (offset % 72));
      const h = baseH + ((i * stride) % 5) * 12;
      ctx.fillRect(x, baseY - h, 52, h);
      ctx.fillRect(x + 10, baseY - h - 12, 25, 12);
    }
  }

  function drawLevel() {
    for (const d of game.decals) {
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x, GROUND_Y - d.h, d.w, d.h);
      ctx.fillStyle = '#f4d35e';
      for (let y = GROUND_Y - d.h + 8; y < GROUND_Y - 8; y += 18) {
        if ((d.x + y) % 3 === 0) ctx.fillRect(d.x + 5, y, 4, 4);
      }
    }

    for (const s of game.solids) {
      if (s.kind === 'ground') {
        ctx.fillStyle = '#6b5b4d';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#3c342f';
        ctx.fillRect(s.x, s.y + 18, s.w, s.h - 18);
        ctx.fillStyle = '#9f7f5f';
        for (let x = Math.floor(game.camera.x / 32) * 32 - 32; x < game.camera.x + view.w + 64; x += 32) {
          ctx.fillRect(x, s.y + 8 + ((x / 32) % 2) * 4, 18, 4);
        }
      } else if (s.kind === 'cover') {
        ctx.fillStyle = '#7a4f36';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#3b231a';
        ctx.fillRect(s.x, s.y, s.w, 5);
        ctx.fillRect(s.x, s.y + s.h - 6, s.w, 6);
        ctx.fillRect(s.x + 7, s.y + 6, 6, s.h - 12);
        ctx.fillStyle = '#b67845';
        ctx.fillRect(s.x + 16, s.y + 10, s.w - 28, 5);
      } else {
        ctx.fillStyle = '#43515f';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = '#202631';
        ctx.fillRect(s.x, s.y + s.h - 5, s.w, 5);
        ctx.fillStyle = '#a6c4c6';
        for (let x = s.x + 7; x < s.x + s.w - 6; x += 22) ctx.fillRect(x, s.y + 4, 10, 3);
      }
    }
  }

  function drawFinish() {
    const f = game.finish;
    const bossAlive = game.enemies.some((e) => e.type === 'boss' && !e.dead);
    ctx.fillStyle = bossAlive ? 'rgba(219,58,52,0.2)' : 'rgba(72,213,151,0.24)';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = bossAlive ? PALETTE.red : PALETTE.green;
    ctx.fillRect(f.x + 8, f.y + 8, 8, f.h - 8);
    ctx.fillRect(f.x + 8, f.y + 8, 60, 24);
    ctx.fillStyle = '#071014';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(bossAlive ? 'LOCKED' : 'EXIT', f.x + 18, f.y + 24);
  }

  function drawPickups() {
    for (const pick of game.pickups) {
      if (pick.taken) continue;
      const bob = Math.sin(game.time * 5 + pick.x) * 3;
      drawFrame('pickup', pick.type, 0, pick.x - 1, pick.y + bob - 1, 1, false);
    }
  }

  function drawProjectiles() {
    for (const b of game.pellets) {
      ctx.fillStyle = '#fff3a6';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), 7, 3);
    }
    for (const b of game.enemyShots) {
      ctx.fillStyle = '#ff6b4a';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), 8, 4);
      ctx.fillStyle = '#fff0a3';
      ctx.fillRect(Math.round(b.x + 1), Math.round(b.y + 1), 4, 2);
    }
  }

  function drawEnemies() {
    for (const e of game.enemies) {
      if (e.dead) continue;
      const state = e.hurt > 0 ? 'hurt' : e.attackPose > 0 ? (e.type === 'bruiser' ? 'attack' : 'shoot') : 'walk';
      const list = atlas.frames[e.type][state] || atlas.frames[e.type].walk;
      const frameIndex = Math.floor(e.anim * 8) % list.length;
      const yOff = e.type === 'boss' ? 8 : 6;
      drawFrame(e.type, state, frameIndex, e.x - (e.type === 'boss' ? 12 : 7), e.y - yOff, e.dir, e.hurt > 0);
      drawEnemyHealth(e);
    }
  }

  function drawEnemyHealth(e) {
    if (e.hp >= e.maxHp || e.dead) return;
    const w = e.type === 'boss' ? 54 : 34;
    const x = e.x + e.w / 2 - w / 2;
    const y = e.y - 9;
    ctx.fillStyle = '#140b12';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = e.type === 'boss' ? PALETTE.purple : PALETTE.red;
    ctx.fillRect(x, y, Math.ceil(w * (e.hp / e.maxHp)), 4);
  }

  function drawPlayer() {
    const p = game.player;
    const state = playerVisualState(p);
    const list = atlas.frames.player[state];
    let frameIndex = Math.floor(p.anim * (state === 'walk' ? 12 : 8)) % list.length;
    if (state === 'shoot') frameIndex = clamp(Math.floor((0.2 - p.shootPose) * 18), 0, list.length - 1);
    if (state === 'reload') frameIndex = clamp(Math.floor((0.88 - p.reload) / 0.88 * list.length), 0, list.length - 1);
    if (state === 'death') frameIndex = clamp(Math.floor(p.deathT * 5), 0, list.length - 1);
    const flicker = p.invuln > 0 && Math.floor(game.time * 24) % 2 === 0;
    if (!flicker) drawFrame('player', state, frameIndex, p.x - 13, p.y - 6, p.facing, p.hurt > 0);
  }

  function playerVisualState(p) {
    if (p.dead || game.state === 'dead') return 'death';
    if (p.hurt > 0.18) return 'hurt';
    if (p.reload > 0) return 'reload';
    if (p.shootPose > 0) return 'shoot';
    if (!p.grounded) return p.vy < 0 ? 'jump' : 'fall';
    if (Math.abs(p.vx) > 22) return 'walk';
    return 'idle';
  }

  function drawParticles() {
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left';
    for (const p of game.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.text) {
        ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
      } else {
        const s = Math.max(1, Math.round(p.size * a));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawFrame(name, state, index, x, y, facing, tint) {
    const frame = atlas.frames[name][state][index] || atlas.frames[name][state][0];
    ctx.save();
    if (facing < 0) {
      ctx.scale(-1, 1);
      ctx.drawImage(atlas.sheet, frame.x, frame.y, frame.w, frame.h, Math.round(-x - frame.w), Math.round(y), frame.w, frame.h);
    } else {
      ctx.drawImage(atlas.sheet, frame.x, frame.y, frame.w, frame.h, Math.round(x), Math.round(y), frame.w, frame.h);
    }
    if (tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#ffffff';
      if (facing < 0) ctx.fillRect(Math.round(-x - frame.w), Math.round(y), frame.w, frame.h);
      else ctx.fillRect(Math.round(x), Math.round(y), frame.w, frame.h);
    }
    ctx.restore();
  }

  function loop(time) {
    const dt = Math.min(0.033, (time - lastTime) / 1000 || 0.016);
    lastTime = time;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function snapshot() {
    const alive = game.enemies.filter((e) => !e.dead);
    return {
      state: game.state,
      playerCount: game.player.dead ? 0 : 1,
      enemyCount: alive.length,
      player: {
        x: Math.round(game.player.x),
        y: Math.round(game.player.y),
        health: game.player.health,
        ammo: game.player.ammo,
        reloading: game.player.reload > 0
      },
      enemies: alive.map((e) => ({ type: e.type, x: Math.round(e.x), hp: e.hp }))
    };
  }

  window.__gameDebug = {
    get state() { return game?.state || 'booting'; },
    get playerCount() { return game && !game.player.dead ? 1 : 0; },
    get enemyCount() { return game ? game.enemies.filter((e) => !e.dead).length : 0; },
    get totalEnemies() { return game ? game.enemies.length : 0; },
    snapshot,
    restart: resetGame
  };

  resize();
  installInput();
  atlas = buildAtlas();
  resetGame();
  requestAnimationFrame(loop);
})();
