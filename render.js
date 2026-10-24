// 繪圖：主機和客機用同一份狀態畫出畫面
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = 'system-ui,-apple-system,"Microsoft JhengHei","PingFang TC",sans-serif';

let staticLayer = null;

function roundRect(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
}

// 文字和 emoji 每一幀重畫很慢（手機 Safari 特別明顯），所以第一次畫好就存成小圖，之後直接貼上
const spriteCache = new Map();
const measureCtx = document.createElement('canvas').getContext('2d');
let spriteScale = 2;    // 小圖的解析度，跟著畫面縮放調整

function sprite(key, build) {
  const k = key + '@' + spriteScale;
  let s = spriteCache.get(k);
  if (!s) {
    if (spriteCache.size > 500) spriteCache.clear();
    const { w, h, draw } = build();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * spriteScale));
    c.height = Math.max(1, Math.ceil(h * spriteScale));
    const g = c.getContext('2d');
    g.scale(spriteScale, spriteScale);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    draw(g);
    s = { c, w, h };
    spriteCache.set(k, s);
  }
  return s;
}

function emoji(g, ch, x, y, size) {
  const s = sprite(`e|${ch}|${size}`, () => {
    const w = size * 1.6;
    return {
      w, h: w, draw: sg => {
        sg.font = `${size}px ${EMOJI_FONT}`;
        sg.fillStyle = '#000';   // 彩色 emoji 也會吃到填色的透明度，要設成不透明
        sg.fillText(ch, w / 2, w / 2);
      },
    };
  });
  g.drawImage(s.c, x - s.w / 2, y - s.h / 2, s.w, s.h);
}

function label(g, text, x, y, size, color, bg) {
  const s = sprite(`l|${text}|${size}|${color}|${bg || ''}`, () => {
    const font = `bold ${size}px ${UI_FONT}`;
    measureCtx.font = font;
    const w = measureCtx.measureText(text).width + 8, h = size + 8;
    return {
      w, h, draw: sg => {
        sg.font = font;
        if (bg) {
          roundRect(sg, 0, 1, w, h - 2, 4, bg);
        } else {
          sg.lineWidth = 3;
          sg.strokeStyle = 'rgba(0,0,0,0.65)';
          sg.strokeText(text, w / 2, h / 2);
        }
        sg.fillStyle = color;
        sg.fillText(text, w / 2, h / 2);
      },
    };
  });
  g.drawImage(s.c, x - s.w / 2, y - s.h / 2, s.w, s.h);
}

// 不會變的地形先畫在一張離屏畫布上
function buildStatic() {
  const SCALE = 2, W = COLS * TILE, H = ROWS * TILE;
  spriteScale = SCALE;
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d');
  g.scale(SCALE, SCALE);

  g.fillStyle = '#8bc34a';
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#7cb342';
  for (let i = 0; i < 260; i++) g.fillRect(rnd() * W, rnd() * H, 2, 3);

  // 小路和店門口的街道
  g.fillStyle = '#e6dcc3';
  g.fillRect(10 * TILE, 0, 4 * TILE, H);
  g.fillRect(10 * TILE, (SHOP.y1 + 1) * TILE, W - 10 * TILE, H - (SHOP.y1 + 1) * TILE);

  // 牧場：泥地加木頭圍欄，每種動物一欄
  roundRect(g, PEN.x0 * TILE, PEN.y0 * TILE, (PEN.x1 - PEN.x0 + 2) * TILE, (PEN.y1 - PEN.y0 + 1) * TILE, 6, '#c8a97e');
  g.strokeStyle = '#6d4c41';
  g.lineWidth = 3;
  g.strokeRect(PEN.x0 * TILE + 1.5, PEN.y0 * TILE + 1.5, (PEN.x1 - PEN.x0 + 2) * TILE - 3, (PEN.y1 - PEN.y0 + 1) * TILE - 3);
  g.lineWidth = 2;
  for (const k of ANIMAL_KEYS.slice(1)) {
    const x = ANIMALS[k].x * TILE;
    g.beginPath(); g.moveTo(x, PEN.y0 * TILE + 3); g.lineTo(x, (PEN.y1 + 1) * TILE - 3); g.stroke();
  }

  // 農地
  roundRect(g, TILE + 4, 2 * TILE + 4, 9 * TILE - 8, 9 * TILE - 8, 10, '#d7b98e');
  for (const y of PLOT_YS) for (const x of PLOT_XS) {
    roundRect(g, x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4, 5, '#6d4c41');
    g.fillStyle = '#5d4037';
    for (let i = 1; i <= 3; i++) g.fillRect(x * TILE + 5, y * TILE + i * 8 - 1, TILE - 10, 2);
  }

  // 店內地板、牆、門
  g.fillStyle = '#f3dcb2';
  g.fillRect((SHOP.x0 + 1) * TILE, (SHOP.y0 + 1) * TILE, (SHOP.x1 - SHOP.x0 - 1) * TILE, (SHOP.y1 - SHOP.y0) * TILE);
  g.fillStyle = '#e5c993';
  for (let y = (SHOP.y0 + 1) * TILE; y < (SHOP.y1 + 1) * TILE; y += 8) g.fillRect((SHOP.x0 + 1) * TILE, y, (SHOP.x1 - SHOP.x0 - 1) * TILE, 1);
  // 後場改成磁磚地板，跟客人區分開
  const bx = (SHOP.x0 + 1) * TILE, by = (SHOP.y0 + 1) * TILE, bw = (SHOP.x1 - SHOP.x0 - 1) * TILE, bh = (COUNTER.y - SHOP.y0 - 1) * TILE;
  g.fillStyle = '#d7ccc8';
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = '#c9bcb7';
  for (let x = bx; x < bx + bw; x += 16) g.fillRect(x, by, 1, bh);
  for (let y = by; y < by + bh; y += 16) g.fillRect(bx, y, bw, 1);
  for (let y = SHOP.y0; y <= SHOP.y1; y++) for (let x = SHOP.x0; x <= SHOP.x1; x++) {
    if (!isWall(x, y)) continue;
    g.fillStyle = '#795548';
    g.fillRect(x * TILE, y * TILE, TILE, TILE);
    g.fillStyle = '#8d6e63';
    g.fillRect(x * TILE, y * TILE, TILE, 6);
  }
  g.fillStyle = '#f3dcb2';
  g.fillRect(SIDE_DOOR[0] * TILE, SIDE_DOOR[1] * TILE, TILE, TILE);
  g.fillStyle = '#c62828';
  g.fillRect(DOOR[0] * TILE + 4, DOOR[1] * TILE + 20, TILE - 8, 8);
  g.fillRect(SIDE_DOOR[0] * TILE + 2, SIDE_DOOR[1] * TILE + 4, 8, TILE - 8);
  // 側門外的小路，從農場直接接到店裡
  g.fillStyle = '#e6dcc3';
  g.fillRect(10 * TILE, SIDE_DOOR[1] * TILE, 4 * TILE, TILE);

  // 櫃台
  g.fillStyle = '#a1887f';
  g.fillRect(COUNTER.x0 * TILE, COUNTER.y * TILE + 4, (COUNTER.x1 - COUNTER.x0 + 1) * TILE, TILE - 8);
  g.fillStyle = '#bcaaa4';
  g.fillRect(COUNTER.x0 * TILE, COUNTER.y * TILE + 4, (COUNTER.x1 - COUNTER.x0 + 1) * TILE, 4);

  // 打水的井
  roundRect(g, WELL.x * TILE + 2, WELL.y * TILE + 2, TILE - 4, TILE - 4, 12, '#90a4ae');
  roundRect(g, WELL.x * TILE + 7, WELL.y * TILE + 7, TILE - 14, TILE - 14, 8, '#4fc3f7');
  emoji(g, '💧', (WELL.x + 0.5) * TILE, (WELL.y + 0.5) * TILE, 12);

  // 招牌和樹
  label(g, '🌾 農場', 5.5 * TILE, 1.1 * TILE, 15, '#fff');
  label(g, '🐮 牧場', 5 * TILE, 15.5 * TILE, 15, '#fff');
  label(g, '🏪 小店', (SHOP.doorX + 0.5) * TILE, 1.1 * TILE, 15, '#fff');
  label(g, '後場（員工）', 25.5 * TILE, 7.5 * TILE, 10, 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.3)');
  for (const [x, y] of [[0, 1], [0, 6], [0, 10], [31, 1], [31, 5], [31, 9], [9, 0], [0, 15], [9, 15], [31, 13]]) {
    emoji(g, '🌳', (x + 0.5) * TILE, (y + 0.5) * TILE, 24);
  }
  return c;
}

// 每一季蓋在地圖上的顏色
const SEASON_TINT = [null, 'rgba(255,214,0,0.07)', 'rgba(230,120,20,0.14)', 'rgba(235,245,255,0.38)'];

function drawPlots(g, S, time) {
  const sprinkler = upgValue(S, 'sprinkler') > 0;
  for (const pl of S.plots) {
    const x = pl.x * TILE, y = pl.y * TILE, cx = x + TILE / 2, cy = y + TILE / 2;
    if (pl.crop && (pl.wet > 0 || sprinkler)) roundRect(g, x + 2, y + 2, TILE - 4, TILE - 4, 5, 'rgba(20,50,110,0.35)');
    if (!pl.crop) continue;
    if (pl.dead) {
      emoji(g, '🥀', cx, cy - 2, 18);
    } else if (pl.g >= 1) {
      emoji(g, CROPS[pl.crop].emoji, cx, cy - 2 + Math.sin(time * 4 + pl.x) * 1.5, 20);
    } else {
      emoji(g, pl.g < 0.4 ? '🌱' : '🌿', cx, cy - 3, pl.g < 0.4 ? 14 : 18);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(cx - 11, cy + 9, 22, 4);
      g.fillStyle = '#aed581';
      g.fillRect(cx - 11, cy + 9, 22 * pl.g, 4);
      // 缺水時閃一個水滴，快枯萎時閃得更快
      if (pl.wet <= 0 && !sprinkler) {
        g.globalAlpha = 0.5 + Math.sin(time * (pl.dry > WITHER_TIME / 2 ? 12 : 5)) * 0.5;
        emoji(g, '💧', x + TILE - 6, y + 6, 11);
        g.globalAlpha = 1;
      }
    }
  }
}

function drawShopObjects(g, S, time) {
  // 共用貨架：每一格放兩種有貨的東西，放不下就在最後一格顯示還有幾種
  const stocked = ITEM_KEYS.filter(k => S.shelves[k] > 0);
  const slots = SHELF_TILES.length * 2;
  SHELF_TILES.forEach(([sx, sy], i) => {
    const x = sx * TILE, y = sy * TILE;
    roundRect(g, x + 1, y + 1, TILE - 2, TILE - 2, 3, '#8d6e63');
    for (let j = 0; j < 2; j++) {
      const n = i * 2 + j, k = stocked[n];
      if (!k) continue;
      const iy = y + 8 + j * 15;
      if (n === slots - 1 && stocked.length > slots) { label(g, `+${stocked.length - slots + 1}`, x + TILE / 2, iy, 9, '#fff'); continue; }
      emoji(g, ITEMS[k].emoji, x + 9, iy, 11);
      label(g, String(S.shelves[k]), x + 23, iy, 9, '#fff');
    }
  });
  if (!stocked.length) label(g, '貨架是空的', (SHELF_TILES[2][0] + 0.5) * TILE, (SHELF_TILES[2][1] + 0.5) * TILE, 9, '#fff');

  MACHINES.forEach((def, i) => {
    const m = S.machines[i], prod = PRODUCTS[def.product], x = def.x * TILE, y = def.y * TILE;
    if (!S.unlocked[def.product]) {
      roundRect(g, x + 1, y + 1, TILE - 2, TILE - 2, 4, 'rgba(84,110,122,0.55)');
      g.globalAlpha = 0.4;
      emoji(g, def.icon, x + TILE / 2, y + TILE / 2, 15);
      g.globalAlpha = 1;
      emoji(g, '🔒', x + TILE - 7, y + 7, 10);
      return;
    }
    roundRect(g, x + 1, y + 1, TILE - 2, TILE - 2, 4, '#78909c');
    const working = m.input >= prod.need && m.out < MACHINE_OUT;
    emoji(g, def.icon, x + TILE / 2, y + 11 + (working ? Math.sin(time * 20) * 0.8 : 0), 15);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 4, y + TILE - 6, TILE - 8, 3);
    g.fillStyle = '#ffca28';
    g.fillRect(x + 4, y + TILE - 6, (TILE - 8) * m.p, 3);
    // 機器裡的原料數→成品數；靠上牆的寫在下面，靠右牆的寫在左邊
    const info = `${m.input}→${m.out}${m.out ? prod.emoji : ''}`;
    const below = def.y === SHOP.y0 + 1;
    label(g, info, below ? x + TILE / 2 : x - 12, below ? y + TILE + 6 : y + TILE / 2, 9, m.out ? '#ffe082' : '#fff', 'rgba(0,0,0,0.55)');
  });

  // 買了的裝潢
  for (const k of DECOR_KEYS) {
    if (!S.decor[k]) continue;
    for (const [dx, dy] of DECOR[k].spots) emoji(g, DECOR[k].icon, (dx + 0.5) * TILE, (dy + 0.5) * TILE, 20);
  }
  if (S.decor.music) {
    const [mx, my] = DECOR.music.spots[0];
    label(g, '♪', (mx + 0.5) * TILE + Math.sin(time * 3) * 6, (my - 0.4) * TILE - (time * 10 % 10), 11, '#fff');
  }

  // 特殊訂單板：有訂單時框會閃
  const bx = BOARD.x * TILE, by = BOARD.y * TILE, o = S.order;
  roundRect(g, bx + 2, by + 2, TILE - 4, TILE - 4, 4, '#a1887f');
  emoji(g, o && o.done ? '✅' : '📋', bx + TILE / 2, by + TILE / 2, 17);
  if (o && !o.done && !o.failed) {
    g.strokeStyle = `rgba(255,202,40,${0.5 + Math.sin(time * 4) * 0.4})`;
    g.lineWidth = 2;
    g.strokeRect(bx + 1, by + 1, TILE - 2, TILE - 2);
  }

  const rx = (REGISTER.x + 0.5) * TILE, ry = (REGISTER.y + 0.5) * TILE;
  if (frontCustomer(S)) {
    g.strokeStyle = `rgba(255,202,40,${0.5 + Math.sin(time * 6) * 0.4})`;
    g.lineWidth = 2;
    g.strokeRect(REGISTER.x * TILE + 1, REGISTER.y * TILE + 1, TILE - 2, TILE - 2);
  }
  emoji(g, '💰', rx, ry, 16);
}

// 牧場：動物在自己的欄裡慢慢晃，旁邊顯示產出數量和要不要餵
function drawAnimals(g, S, time) {
  for (const k of ANIMAL_KEYS) {
    const def = ANIMALS[k], a = S.animals[k];
    const x0 = def.x * TILE, y0 = PEN.y0 * TILE, w = 2 * TILE, h = (PEN.y1 - PEN.y0 + 1) * TILE;
    if (!a.count) {
      g.globalAlpha = 0.35;
      emoji(g, def.emoji, x0 + w / 2, y0 + h / 2 - 4, 22);
      g.globalAlpha = 1;
      emoji(g, '🔒', x0 + w / 2 + 12, y0 + h / 2 - 14, 11);
      continue;
    }
    for (let i = 0; i < a.count; i++) {
      const s = i * 2.3 + def.x;
      const ax = x0 + w / 2 + Math.sin(time * 0.6 + s) * (w / 2 - 14);
      const ay = y0 + h / 2 + (i ? 14 : -10) + Math.sin(time * 0.9 + s * 1.7) * 6;
      emoji(g, def.emoji, ax, ay, 22);
    }
    const good = ITEMS[def.good];
    if (a.ready) label(g, `${good.emoji}${a.ready}`, x0 + w / 2, y0 + 8, 11, '#ffe082', 'rgba(0,0,0,0.6)');
    else if (a.fed <= 0) {
      g.globalAlpha = 0.55 + Math.sin(time * 5) * 0.45;
      label(g, '🍽️ 要餵', x0 + w / 2, y0 + 8, 10, '#fff', 'rgba(198,40,40,0.75)');
      g.globalAlpha = 1;
    } else {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x0 + 8, y0 + 4, w - 16, 4);
      g.fillStyle = '#ffca28';
      g.fillRect(x0 + 8, y0 + 4, (w - 16) * a.prog, 4);
    }
  }
}

function drawThief(g, th, time) {
  const cx = (th.x + 0.5) * TILE, cy = (th.y + 0.5) * TILE;
  emoji(g, th.caught ? '😵' : '🥷', cx, cy + Math.sin(time * 12) * (th.state === 'flee' ? 2 : 0), 22);
  if (th.state === 'flee') return;
  label(g, '小偷！點我', cx, cy - 22, 10, '#fff', 'rgba(198,40,40,0.85)');
  if (th.state === 'steal') {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(cx - 14, cy + 14, 28, 4);
    g.fillStyle = '#ef5350';
    g.fillRect(cx - 14, cy + 14, 28 * th.t, 4);
  }
}

function drawCustomer(g, c, x, y) {
  const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath(); g.ellipse(cx, cy + 10, 9, 3, 0, 0, Math.PI * 2); g.fill();
  emoji(g, c.face, cx, cy, 20);
  if (c.state === 'leave') return;
  const tag = (CUSTOMER_TYPES[c.type] || CUSTOMER_TYPES.normal).tag;
  const text = (tag ? tag + ' ' : '') + ITEM_KEYS.filter(k => c.want[k]).map(k => ITEMS[k].emoji + c.want[k]).join(' ');
  const bubble = sprite(`b|${text}`, () => {
    measureCtx.font = `bold 11px ${UI_FONT}`;
    const w = measureCtx.measureText(text).width + 10;
    return {
      w, h: 20, draw: sg => {
        roundRect(sg, 0, 0, w, 20, 5, 'rgba(255,255,255,0.92)');
        sg.font = `bold 11px ${UI_FONT}`;
        sg.fillStyle = '#333';
        sg.fillText(text, w / 2, 8);
      },
    };
  });
  const w = bubble.w, bx = cx + 11, by = cy - 20;
  g.drawImage(bubble.c, bx, by, w, 20);
  const r = Math.max(0, c.patience / c.maxPatience);
  g.fillStyle = '#ddd';
  g.fillRect(bx + 4, by + 15, w - 8, 3);
  g.fillStyle = r > 0.5 ? '#66bb6a' : r > 0.25 ? '#ffb74d' : '#ef5350';
  g.fillRect(bx + 4, by + 15, (w - 8) * r, 3);
}

function drawPlayer(g, p, x, y, isMe) {
  const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
  g.globalAlpha = p.connected ? 1 : 0.45;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(cx, cy + 11, 10, 3.5, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2);
  g.fillStyle = p.color; g.fill();
  g.lineWidth = isMe ? 3 : 2;
  g.strokeStyle = isMe ? '#ffca28' : '#fff';
  g.stroke();
  label(g, [...p.name][0] || '?', cx, cy + 1, 12, '#fff', p.color);
  label(g, p.name + (isMe ? '（你）' : p.connected ? '' : '（離線）'), cx, cy - 19, 10, '#fff', 'rgba(0,0,0,0.55)');
  const carry = ITEM_KEYS.filter(k => p.carry[k]).map(k => ITEMS[k].emoji + p.carry[k]).join('');
  if (carry) label(g, carry, cx, cy + 19, 10, '#fff', 'rgba(0,0,0,0.55)');
  g.globalAlpha = 1;
}

// 快捷聊天的對話框，畫在所有東西上面
function drawChat(g, p, x, y) {
  if (!p.chat) return;
  g.globalAlpha = Math.min(1, p.chat.ttl / 0.4);
  label(g, '💬 ' + p.chat.text, (x + 0.5) * TILE, (y + 0.5) * TILE - 38, 12, '#222', 'rgba(255,255,255,0.95)');
  g.globalAlpha = 1;
}

function drawGame(g, S, view, meId, disp, tapMark, time) {
  if (!staticLayer) staticLayer = buildStatic();
  const { tilePx, camX, camY, cw, ch, dpr } = view;
  spriteScale = Math.ceil(dpr * tilePx / TILE * 2) / 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.save();
  g.translate(-camX, -camY);
  g.scale(tilePx / TILE, tilePx / TILE);
  g.drawImage(staticLayer, 0, 0, COLS * TILE, ROWS * TILE);
  const tint = SEASON_TINT[seasonOf(S.day)];
  if (tint) { g.fillStyle = tint; g.fillRect(0, 0, COLS * TILE, ROWS * TILE); }

  drawPlots(g, S, time);
  drawAnimals(g, S, time);
  drawShopObjects(g, S, time);

  if (tapMark) {
    g.strokeStyle = `rgba(255,255,255,${tapMark.ttl})`;
    g.lineWidth = 2;
    g.strokeRect(tapMark.x * TILE + 2, tapMark.y * TILE + 2, TILE - 4, TILE - 4);
  }

  const ents = [
    ...S.customers.map(c => ({ e: c, d: disp['c' + c.id] || c, draw: drawCustomer })),
    ...Object.values(S.players).map(p => ({ e: p, d: disp['p' + p.id] || p, draw: (g, e, x, y) => drawPlayer(g, e, x, y, e.id === meId) })),
  ].sort((a, b) => a.d.y - b.d.y);
  for (const { e, d, draw } of ents) draw(g, e, d.x, d.y);
  if (S.thief) { const d = disp.thief || S.thief; drawThief(g, { ...S.thief, x: d.x, y: d.y }, time); }

  for (const f of S.fx) {
    if (!f.text) continue;
    g.globalAlpha = Math.max(0, Math.min(1, f.ttl / 0.5));
    label(g, f.text, (f.x + 0.5) * TILE, (f.y + 0.5) * TILE - (1.6 - f.ttl) * 14, 12, f.color);
  }
  g.globalAlpha = 1;
  for (const p of Object.values(S.players)) { const d = disp['p' + p.id] || p; drawChat(g, p, d.x, d.y); }
  g.restore();

  // 早晚的天色
  const h = gameHour(S.t);
  const dark = h >= 18 ? Math.min(0.4, (h - 18) / 4 * 0.4) : h < 7 ? (7 - h) * 0.25 : 0;
  if (dark > 0) {
    g.fillStyle = `rgba(25,35,90,${dark})`;
    g.fillRect(0, 0, cw, ch);
  }

  // 達成目標的橫幅
  if (S.banner) {
    g.globalAlpha = Math.min(1, S.banner.ttl);
    label(g, S.banner.text, cw / 2, 30, 16, '#ffca28', 'rgba(0,0,0,0.8)');
    g.globalAlpha = 1;
  }
}
