// 共用常數與遊戲模擬。只有主機（建房間的人）會跑 step()，其他人只負責顯示主機傳來的狀態。
const TILE = 32, COLS = 32, ROWS = 16;
const DAY_LEN = 240;              // 一天 240 秒 = 遊戲裡 06:00–22:00
const OPEN_HOUR = 8, CLOSE_HOUR = 20;
const CUSTOMER_SPEED = 2.5;
const PATIENCE = 60;
const MAX_PLAYERS = 4;
const WET_TIME = 30;              // 澆一次水能撐幾秒
const WITHER_TIME = 60;           // 沒水超過幾秒就枯萎

// 季節：每 SEASON_LEN 天換一季
const SEASONS = [
  { name: '春', icon: '🌸' },
  { name: '夏', icon: '☀️' },
  { name: '秋', icon: '🍁' },
  { name: '冬', icon: '❄️' },
];
const SEASON_LEN = 7;

// seasons：哪幾季可以種（0 春 1 夏 2 秋 3 冬）
const CROPS = {
  tomato: { name: '番茄', emoji: '🍅', seed: 3, price: 10, grow: 15, yield: 2, seasons: [0, 1] },
  carrot: { name: '紅蘿蔔', emoji: '🥕', seed: 6, price: 18, grow: 25, yield: 2, seasons: [0, 2, 3] },
  strawberry: { name: '草莓', emoji: '🍓', seed: 8, price: 24, grow: 30, yield: 2, seasons: [0, 1] },
  corn: { name: '玉米', emoji: '🌽', seed: 10, price: 28, grow: 35, yield: 2, seasons: [1, 2] },
  wheat: { name: '小麥', emoji: '🌾', seed: 4, price: 8, grow: 20, yield: 3, seasons: [2, 3] },
  pumpkin: { name: '南瓜', emoji: '🎃', seed: 15, price: 60, grow: 50, yield: 1, seasons: [1, 2] },
};
const CROP_KEYS = Object.keys(CROPS);

// 動物：餵飽之後每 interval 秒（一隻的情況）產出一個 good；每種能養幾隻看「牧場擴建」升級
const ANIMALS = {
  chicken: { name: '雞', emoji: '🐔', good: 'egg', interval: 20, cost: 150, cost2: 220, x: 1 },
  cow: { name: '牛', emoji: '🐄', good: 'milk', interval: 30, cost: 300, cost2: 420, x: 3 },
  pig: { name: '豬', emoji: '🐖', good: 'pork', interval: 40, cost: 250, cost2: 360, x: 5 },
  sheep: { name: '羊', emoji: '🐑', good: 'wool', interval: 45, cost: 280, cost2: 400, x: 7 },
};
const ANIMAL_KEYS = Object.keys(ANIMALS);
const FEED_COST = 3, FED_TIME = 90;
const animalMax = S => upgValue(S, 'barn');
const readyCap = a => 2 + 2 * a.count;     // 產出最多先放幾個在欄裡等人收

// 雇來的農場幫手
const WORKER = { hireCost: 300, wage: 25, speed: 3.5, spawn: [11, 9] };

// 動物產出的東西。生肉不能直接賣，要煮熟
const GOODS = {
  egg: { name: '雞蛋', emoji: '🥚', price: 14, animal: 'chicken' },
  milk: { name: '牛奶', emoji: '🥛', price: 22, animal: 'cow' },
  pork: { name: '生豬肉', emoji: '🥩', price: 0, animal: 'pig', noDemand: true },
  wool: { name: '羊毛', emoji: '🧶', price: 48, animal: 'sheep' },
};

// 店裡加工出來的商品：need 個 from → 1 個成品，要花 time 秒。noDemand = 客人不會直接買（中間材料）
const PRODUCTS = {
  ketchup: { name: '番茄醬', emoji: '🥫', price: 35, from: 'tomato', need: 2, time: 12 },
  juice: { name: '紅蘿蔔汁', emoji: '🧃', price: 50, from: 'carrot', need: 2, time: 15 },
  jam: { name: '草莓果醬', emoji: '🍯', price: 70, from: 'strawberry', need: 2, time: 18 },
  soup: { name: '玉米濃湯', emoji: '🥣', price: 80, from: 'corn', need: 2, time: 20 },
  flour: { name: '麵粉', emoji: '🧂', price: 30, from: 'wheat', need: 3, time: 10, noDemand: true },
  bread: { name: '麵包', emoji: '🍞', price: 75, from: 'flour', need: 1, time: 20 },
  cheese: { name: '起司', emoji: '🧀', price: 70, from: 'milk', need: 2, time: 22 },
  roast: { name: '烤豬排', emoji: '🍖', price: 75, from: 'pork', need: 1, time: 16 },
};
const PRODUCT_KEYS = Object.keys(PRODUCTS);
const ITEMS = { ...CROPS, ...GOODS, ...PRODUCTS };      // 所有能拿、能上架、能賣的東西
const ITEM_KEYS = Object.keys(ITEMS);
const zeroItems = () => Object.fromEntries(ITEM_KEYS.map(k => [k, 0]));

// 每一季客人特別愛買的東西（需求變 3 倍），都是那一季種得出來的
const SEASON_HOT = [
  ['strawberry', 'jam', 'juice'],
  ['ketchup', 'corn', 'pumpkin'],
  ['pumpkin', 'soup', 'bread'],
  ['juice', 'bread', 'carrot'],
];

// 加工機：每台做一種商品，放得下 MACHINE_IN 個原料、MACHINE_OUT 個成品。全部放在店的後場
const MACHINES = [
  { product: 'ketchup', name: '醬料鍋', icon: '🍲', x: 23, y: 3 },
  { product: 'juice', name: '果汁機', icon: '🥤', x: 24, y: 3 },
  { product: 'jam', name: '果醬鍋', icon: '🫙', x: 25, y: 3 },
  { product: 'soup', name: '湯鍋', icon: '♨️', x: 26, y: 3 },
  { product: 'flour', name: '磨粉機', icon: '🌀', x: 27, y: 3 },
  { product: 'bread', name: '烤箱', icon: '🔥', x: 28, y: 3 },
  { product: 'cheese', name: '起司桶', icon: '⚗️', x: 29, y: 4 },
  { product: 'roast', name: '烤肉架', icon: '🍳', x: 29, y: 5 },
];
const MACHINE_IN = 6, MACHINE_OUT = 4;

// 一開始就有的作物和機器；其他要花錢解鎖（requires = 要先解鎖或先買的東西，可以是動物）
const START_UNLOCKED = ['tomato', 'carrot', 'ketchup', 'juice'];
const UNLOCKS = {
  strawberry: { cost: 120 },
  corn: { cost: 150 },
  wheat: { cost: 100 },
  pumpkin: { cost: 250 },
  jam: { cost: 150, requires: 'strawberry' },
  soup: { cost: 180, requires: 'corn' },
  flour: { cost: 120, requires: 'wheat' },
  bread: { cost: 200, requires: 'flour' },
  cheese: { cost: 180, requires: 'cow' },
  roast: { cost: 160, requires: 'pig' },
};
const UNLOCK_KEYS = Object.keys(UNLOCKS);

// 全隊共用的升級：costs[i] 是從 Lv(i+1) 升到 Lv(i+2) 的價錢，values[i] 是 Lv(i+1) 的數值
const UPGRADES = {
  speed: { name: '走路速度', icon: '🏃', costs: [50, 100, 180, 300], values: [4, 5, 6, 7, 8] },
  // show = 按鈕上要顯示目前的數值；Infinity 會顯示成「無限」
  shelf: { name: '貨架容量', icon: '🗄️', show: true, costs: [40, 90, 160, 260, 400, 600, 900, 1300, 2000], values: [10, 20, 30, 45, 60, 80, 100, 150, 250, Infinity] },
  bag: { name: '背包容量', icon: '🎒', show: true, costs: [60, 120, 200, 320, 480], values: [10, 14, 18, 24, 30, 40] },
  feed: { name: '飼養技術', icon: '🌾', show: true, unit: '倍產量', costs: [100, 200, 350, 550], values: [1, 1.5, 2, 2.5, 3] },
  barn: { name: '牧場擴建', icon: '🏚️', show: true, unit: '隻／種', costs: [200, 400, 700], values: [2, 3, 4, 5] },
  machine: { name: '加工速度', icon: '⚙️', costs: [60, 120, 200, 320], values: [1, 1.3, 1.6, 2, 2.5] },
  can: { name: '水壺容量', icon: '🪣', costs: [30, 70, 130, 220], values: [5, 8, 12, 16, 24] },
  soil: { name: '肥料', icon: '🌱', costs: [60, 120, 200, 320], values: [1, 1.25, 1.5, 1.75, 2] },
  sprinkler: { name: '灑水器', icon: '💦', costs: [500], values: [0, 1], labels: ['未安裝', '已安裝'] },
};
const UPGRADE_KEYS = Object.keys(UPGRADES);

// 客人種類：weight = 出現機率權重，patience / pay / tip 是倍率，rating = 評價影響倍率
const CUSTOMER_TYPES = {
  normal: { name: '一般客人', tag: '', weight: 1, patience: 1, pay: 1, tip: 1, rating: 1 },
  hurry: { name: '急躁客', tag: '⚡', weight: 0.18, patience: 0.55, pay: 1, tip: 2, rating: 1, faces: ['😤', '🏃'] },
  big: { name: '大戶', tag: '💎', weight: 0.06, patience: 1.4, pay: 1, tip: 1.5, rating: 1.5, faces: ['🤑', '🤵'] },
  gourmet: { name: '美食家', tag: '🎩', weight: 0.12, patience: 1.1, pay: 1.5, tip: 1, rating: 2, faces: ['🧐', '🤓'] },
};

// 全店的價格設定：mult = 售價倍率，spawn = 客人間隔倍率（越小客人越多），patience、rating = 耐心和評價成長倍率
const PRICE_LEVELS = [
  { name: '特價', mult: 0.8, spawn: 0.75, patience: 1.15, rating: 1.3 },
  { name: '便宜', mult: 0.9, spawn: 0.88, patience: 1.07, rating: 1.15 },
  { name: '普通', mult: 1, spawn: 1, patience: 1, rating: 1 },
  { name: '小貴', mult: 1.15, spawn: 1.15, patience: 0.92, rating: 0.8 },
  { name: '高價', mult: 1.3, spawn: 1.35, patience: 0.85, rating: 0.6 },
];
const PRICE_DEFAULT = 2;

// 店面裝潢：在結算畫面買，買了就一直有效（x, y 是擺在哪裡，只是裝飾不會擋路）
const DECOR = {
  plant: { name: '盆栽', icon: '🪴', cost: 80, desc: '客人耐心 +10%', spots: [[15, 9], [15, 12], [28, 12]] },
  seats: { name: '座位區', icon: '🪑', cost: 150, desc: '客人耐心 +15%、評價成長變快', spots: [[26, 10], [27, 10], [26, 11], [27, 11]] },
  sign: { name: '大招牌', icon: '🪧', cost: 120, desc: '客人變多', spots: [[20, 14]] },
  music: { name: '音樂', icon: '📻', cost: 200, desc: '小費 +30%', spots: [[28, 9]] },
};
const DECOR_KEYS = Object.keys(DECOR);

// 快捷聊天
const CHAT = ['缺貨了！', '我去顧櫃台', '機器做好了', '幫忙澆水', '我去收成', '等我一下', '👍 好', '謝啦！'];

// 長期目標：達成就領獎金；final = 最終目標
const GOALS = [
  { id: 'money1k', text: '存到 $1,000', reward: 100, check: S => S.money >= 1000 },
  { id: 'served50', text: '服務 50 位客人', reward: 100, check: S => S.served >= 50 },
  { id: 'orders5', text: '完成 5 張特殊訂單', reward: 150, check: S => S.ordersDone >= 5 },
  { id: 'star4', text: '評價達到 ⭐4', reward: 150, check: S => S.rating >= 4 },
  { id: 'recipes', text: '解鎖全部配方', reward: 200, check: S => PRODUCT_KEYS.every(k => S.unlocked[k]) },
  { id: 'decor', text: '買齊全部裝潢', reward: 200, check: S => DECOR_KEYS.every(k => S.decor[k]) },
  { id: 'ranch', text: '四種動物都養', reward: 200, check: S => ANIMAL_KEYS.every(k => S.animals[k].count > 0) },
  { id: 'thief3', text: '抓到 3 個小偷', reward: 150, check: S => S.thievesCaught >= 3 },
  { id: 'star5', text: '評價達到 ⭐5', reward: 300, check: S => S.rating >= 4.95 },
  { id: 'final', text: '最終目標：第 30 天結束前存到 $5,000', reward: 0, final: true, check: S => S.money >= 5000 && S.day <= 30 },
];
const FINAL_DAY = 30;

const COLORS = ['#43a047', '#1e88e5', '#e53935', '#fb8c00', '#8e24aa', '#00897b'];
const SPAWNS = [[11, 6], [12, 6], [11, 7], [12, 7]];

// 地圖配置（座標都是格子）
// 店分成兩半：上面是後場（貨架、加工機、訂單板，只有員工進得去），下面是客人區，中間隔著櫃台
const SHOP = { x0: 14, x1: 30, y0: 2, y1: 13, doorX: 22 };   // 牆壁在邊界上
const SIDE_DOOR = [SHOP.x0, 5];                              // 面向農場的側門，直接進後場
const COUNTER = { y: 8, x0: 15, x1: 28 };                   // x = 29 留空，員工從這裡走到客人區
const REGISTER = { x: 22, y: 8 };
const SHELF_TILES = [[15, 3], [16, 3], [17, 3], [18, 3], [19, 3], [20, 3], [21, 3]];   // 一整排共用的貨架
const BOARD = { x: 15, y: 7 };                              // 特殊訂單板
const WELL = { x: 10, y: 8 };                               // 打水的井
const QUEUE = [[22, 9], [22, 10], [22, 11], [20, 10], [24, 10], [20, 11]];
const DOOR = [SHOP.doorX, SHOP.y1];
const STREET_Y = 15.3;
const PEN = { x0: 1, x1: 8, y0: 12, y1: 14 };               // 牧場（圍欄裡面），每種動物佔兩格寬
const THIEF_SPOT = [23, 9];                                 // 小偷會溜到收銀台旁邊
const PLOT_XS = [2, 4, 6, 8], PLOT_YS = [3, 5, 7, 9];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FACES = ['🙂', '😊', '🧐', '😃', '🤠', '👵', '👴', '🧒'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const carryTotal = carry => ITEM_KEYS.reduce((n, k) => n + (carry[k] || 0), 0);
const upgValue = (S, k) => UPGRADES[k].values[S.upg[k]];
const carryCap = S => upgValue(S, 'bag');
const nameOf = k => (ITEMS[k] || ANIMALS[k]).name;
const emojiOf = k => (ITEMS[k] || ANIMALS[k]).emoji;
// 已經擁有：作物、機器看有沒有解鎖；動物看有沒有買
const owns = (S, k) => ANIMALS[k] ? S.animals[k].count > 0 : !!S.unlocked[k];
const seasonOf = day => Math.floor((day - 1) / SEASON_LEN) % SEASONS.length;
const inSeason = (S, crop) => CROPS[crop].seasons.includes(seasonOf(S.day));
const machineIndex = product => MACHINES.findIndex(m => m.product === product);
const itemList = (items, sep = ' ') => ITEM_KEYS.filter(k => items[k]).map(k => ITEMS[k].emoji + items[k]).join(sep);

function gameHour(t) { return 6 + t / DAY_LEN * 16; }

// 手上、貨架上、機器裡（還沒拿走的成品）總共有幾個
function stockOf(S, k) {
  let n = S.shelves[k] || 0;
  for (const p of Object.values(S.players)) n += p.carry[k] || 0;
  if (S.worker) n += S.worker.carry[k] || 0;
  const mi = machineIndex(k);
  if (mi >= 0) n += S.machines[mi].out;
  return n;
}

// 現在拿得到的東西：作物要「這一季能種」或「還有存貨／田裡正在長」；
// 加工品要「還有存貨」或「原料拿得到」（麵包 → 麵粉 → 小麥 會一路往回查）
// 動物產品要有養那種動物
function obtainable(S, k) {
  if (stockOf(S, k) > 0) return true;
  if (GOODS[k]) return S.animals[GOODS[k].animal].count > 0;
  if (!S.unlocked[k]) return false;
  if (CROPS[k]) return inSeason(S, k) || S.plots.some(pl => pl.crop === k && !pl.dead);
  const mi = machineIndex(k);
  if (mi >= 0 && S.machines[mi].input >= PRODUCTS[k].need) return true;   // 機器裡正在做
  return obtainable(S, PRODUCTS[k].from);
}

// 客人會直接買、而且現在拿得到的東西（中間材料像麵粉、生肉不算）
function sellable(S, k) {
  return !ITEMS[k].noDemand && obtainable(S, k);
}

function isWall(x, y) {
  const onX = (x === SHOP.x0 || x === SHOP.x1) && y >= SHOP.y0 && y <= SHOP.y1;
  const onY = (y === SHOP.y0 || y === SHOP.y1) && x >= SHOP.x0 && x <= SHOP.x1;
  const isDoor = (x === DOOR[0] && y === DOOR[1]) || (x === SIDE_DOOR[0] && y === SIDE_DOOR[1]);
  return (onX || onY) && !isDoor;
}

const isAt = (o, x, y) => o.x === x && o.y === y;
const isShelf = (x, y) => SHELF_TILES.some(([sx, sy]) => sx === x && sy === y);

function isBlocked(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  if (isWall(x, y)) return true;
  if (y === COUNTER.y && x >= COUNTER.x0 && x <= COUNTER.x1) return true;
  if (isShelf(x, y) || isAt(BOARD, x, y) || isAt(WELL, x, y)) return true;
  if (x >= PEN.x0 && x <= PEN.x1 + 1 && y >= PEN.y0 && y <= PEN.y1) return true;   // 牧場圍欄
  return MACHINES.some(m => isAt(m, x, y));
}

// 點到牧場的哪一格就是哪種動物
function penAt(x, y) {
  if (x < PEN.x0 || x > PEN.x1 || y < PEN.y0 || y > PEN.y1) return null;
  return ANIMAL_KEYS.find(k => x === ANIMALS[k].x || x === ANIMALS[k].x + 1) || null;
}

function plotIndex(x, y) {
  const cx = PLOT_XS.indexOf(x), cy = PLOT_YS.indexOf(y);
  return cx < 0 || cy < 0 ? -1 : cy * PLOT_XS.length + cx;
}

function objectAt(x, y) {
  const i = plotIndex(x, y);
  if (i >= 0) return { kind: 'plot', i, x, y };
  if (isAt(REGISTER, x, y)) return { kind: 'register', x, y };
  if (isShelf(x, y)) return { kind: 'shelf', x, y };
  if (isAt(BOARD, x, y)) return { kind: 'board', x, y };
  if (isAt(WELL, x, y)) return { kind: 'well', x, y };
  const mi = MACHINES.findIndex(m => isAt(m, x, y));
  if (mi >= 0) return { kind: 'machine', i: mi, x, y };
  const animal = penAt(x, y);
  if (animal) return { kind: 'pen', animal, x, y };
  return null;
}

// 當天的統計，結算畫面用
function newStats() {
  return {
    income: 0, served: 0, angry: 0, seedSpent: 0, upgradeSpent: 0, sold: zeroItems(), withered: 0,
    order: null, orderReward: 0, goals: [], ratingStart: null, thief: null, stolen: 0, wage: 0,
  };
}

const newAnimals = () => Object.fromEntries(ANIMAL_KEYS.map(k => [k, { count: 0, fed: 0, prog: 0, ready: 0 }]));

// 每天早上決定今天會不會有小偷、幾點來（前兩天不會有）
function rollThief(S) {
  S.thiefAt = S.day >= 3 && Math.random() < 0.33 ? 10 + Math.random() * 8 : null;
}

function newState() {
  const plots = [];
  for (const y of PLOT_YS) for (const x of PLOT_XS) plots.push({ x, y, crop: null, g: 0, wet: 0, dry: 0, dead: false });
  return {
    phase: 'lobby',               // 'lobby' = 準備畫面，'play' = 遊戲中，'summary' = 當天結算
    day: 1, t: 0, money: 50, served: 0,
    stats: newStats(),
    upg: Object.fromEntries(UPGRADE_KEYS.map(k => [k, 0])),
    unlocked: Object.fromEntries(START_UNLOCKED.map(k => [k, true])),
    plots,
    shelves: zeroItems(),
    machines: MACHINES.map(() => ({ input: 0, out: 0, p: 0 })),
    order: null,
    rating: 3,                    // 商店評價 1～5 星
    priceLv: PRICE_DEFAULT,
    decor: {},
    goals: {},                    // 達成的目標：id → 第幾天達成
    ordersDone: 0,
    animals: newAnimals(),
    thief: null, thiefAt: null, thievesCaught: 0,
    worker: null,
    players: {},
    customers: [], nextId: 1, spawnT: 3,
    fx: [], fxSeq: 0,
  };
}

const decorBonus = S => ({
  patience: 1 + (S.decor.plant ? 0.1 : 0) + (S.decor.seats ? 0.15 : 0),
  rating: S.decor.seats ? 1.3 : 1,
  spawn: S.decor.sign ? 0.85 : 1,
  tip: S.decor.music ? 1.3 : 1,
});
const priceLevel = S => PRICE_LEVELS[S.priceLv];
const priceOf = (S, k) => Math.round(ITEMS[k].price * priceLevel(S).mult);

function changeRating(S, d) {
  S.rating = Math.max(1, Math.min(5, S.rating + d));
}

function freeColor(S, except) {
  const taken = Object.values(S.players).filter(p => p !== except && p.connected).map(p => p.color);
  return COLORS.find(c => !taken.includes(c)) || COLORS[0];
}

function addPlayer(S, id, name) {
  if (S.players[id]) return S.players[id];
  const n = Object.keys(S.players).length;
  const [x, y] = SPAWNS[n % SPAWNS.length];
  return S.players[id] = {
    id, name: cleanName(name) || `玩家${n + 1}`, color: freeColor(S), x, y, path: [], action: null,
    carry: zeroItems(), water: upgValue(S, 'can'), seed: 'tomato', connected: true, ready: false,
  };
}

function cleanName(name) { return typeof name === 'string' ? name.trim().slice(0, 8) : ''; }

// 飄字特效；snd = 每台裝置收到時要播的音效
function addFx(S, x, y, text, color, snd) {
  S.fx.push({ id: ++S.fxSeq, x, y, text, color: color || '#fff', ttl: 1.6, snd });
}

function say(S, p, text) { if (!p.npc) addFx(S, p.x, p.y - 0.7, text, '#ffe082', 'tick'); }

// 廣度優先搜尋，回傳不含起點的路徑；走不到回傳 null
function findPath(sx, sy, goals) {
  const key = (x, y) => y * COLS + x;
  const start = key(sx, sy);
  const goalSet = new Set(goals.map(([x, y]) => key(x, y)));
  if (goalSet.has(start)) return [];
  const prev = new Map([[start, -1]]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || isBlocked(nx, ny)) continue;
      prev.set(k, key(x, y));
      if (goalSet.has(k)) {
        const path = [];
        for (let c = k; c !== start; c = prev.get(c)) path.unshift([c % COLS, Math.floor(c / COLS)]);
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

// 從位置 (x, y) 點了某一格：算出走過去的路線和到了要做的動作；走不到回傳 null
// 客機也會用它先在自己畫面上預測走路，不用等主機回應
function planTap(x, y, tx, ty) {
  const obj = objectAt(tx, ty);
  let goals;
  // 牧場：走到那一欄圍欄上方的走道
  if (obj && obj.kind === 'pen') goals = [[ANIMALS[obj.animal].x, PEN.y0 - 1], [ANIMALS[obj.animal].x + 1, PEN.y0 - 1]];
  else if (obj && obj.kind !== 'plot') goals = DIRS.map(([dx, dy]) => [tx + dx, ty + dy]).filter(([gx, gy]) => !isBlocked(gx, gy));
  else if (!isBlocked(tx, ty)) goals = [[tx, ty]];
  else return null;
  const path = findPath(Math.round(x), Math.round(y), goals);
  return path && { path, obj };
}

function handleTap(S, pid, tx, ty) {
  const p = S.players[pid];
  // 點到小偷：追過去抓
  const th = S.thief;
  if (th && th.state !== 'flee' && Math.round(th.x) === tx && Math.round(th.y) === ty) {
    const goals = [[tx, ty], ...DIRS.map(([dx, dy]) => [tx + dx, ty + dy])].filter(([gx, gy]) => !isBlocked(gx, gy));
    const path = findPath(Math.round(p.x), Math.round(p.y), goals);
    if (path) { p.path = path; p.action = { kind: 'catch' }; }
    return;
  }
  // 點到隊友：走到他旁邊把身上的東西交給他
  const mate = Object.values(S.players).find(o => o !== p && o.connected && Math.round(o.x) === tx && Math.round(o.y) === ty);
  if (mate) {
    const goals = [[tx, ty], ...DIRS.map(([dx, dy]) => [tx + dx, ty + dy])].filter(([gx, gy]) => !isBlocked(gx, gy));
    const path = findPath(Math.round(p.x), Math.round(p.y), goals);
    if (path) { p.path = path; p.action = { kind: 'give', id: mate.id }; }
    return;
  }
  const plan = planTap(p.x, p.y, tx, ty);
  if (!plan) return;
  p.path = plan.path;
  p.action = plan.obj;
}

// 沿著路線走 move 格的距離
function moveAlong(p, move) {
  while (move > 0 && p.path.length) {
    const [tx, ty] = p.path[0];
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d <= move) { p.x = tx; p.y = ty; p.path.shift(); move -= d; }
    else { p.x += dx / d * move; p.y += dy / d * move; move = 0; }
  }
}

function buyUpgrade(S, p, k) {
  const u = UPGRADES[k];
  if (!u) return;
  const lv = S.upg[k];
  if (lv >= u.costs.length) return say(S, p, '已經滿級了');
  if (S.money < u.costs[lv]) return say(S, p, '錢不夠升級');
  S.money -= u.costs[lv];
  S.stats.upgradeSpent += u.costs[lv];
  S.upg[k]++;
  addFx(S, p.x, p.y - 0.7, `${u.icon} ${u.name} ${u.labels ? u.labels[S.upg[k]] : 'Lv' + (S.upg[k] + 1)}！`, '#ffca28', 'up');
}

const animalCost = (S, k) => S.animals[k].count === 0 ? ANIMALS[k].cost : ANIMALS[k].cost2;

// ---------- 農場幫手 ----------
function newWorker() {
  const [x, y] = WORKER.spawn;
  return { npc: true, name: '幫手', color: '#8d6e63', connected: true, x, y, path: [], action: null, carry: zeroItems(), water: 99, seed: 'tomato', think: 0, off: false };
}

function setWorker(S, p, hire) {
  if (hire && !S.worker) {
    if (S.money < WORKER.hireCost) return say(S, p, '錢不夠雇幫手');
    S.money -= WORKER.hireCost;
    S.stats.upgradeSpent += WORKER.hireCost;
    S.worker = newWorker();
    addFx(S, S.worker.x, S.worker.y - 0.7, '👨‍🌾 幫手來上班了！', '#ffca28', 'up');
  } else if (!hire && S.worker) {
    // 解雇前把他身上的東西放回貨架
    for (const k of ITEM_KEYS) S.shelves[k] += S.worker.carry[k];
    S.worker = null;
    addFx(S, p.x, p.y - 0.7, '幫手下班了', '#ffe082', 'tick');
  }
}

// 現在能種的作物裡，存貨（加上田裡正在長的）最少的那一種
function workerCrop(S) {
  const growing = k => S.plots.filter(pl => pl.crop === k && !pl.dead).length * CROPS[k].yield;
  const opts = CROP_KEYS.filter(k => S.unlocked[k] && inSeason(S, k) && S.money >= CROPS[k].seed);
  opts.sort((a, b) => (stockOf(S, a) + growing(a)) - (stockOf(S, b) + growing(b)));
  return opts[0] || null;
}

// 幫手每隔一下想一次要做什麼：拿滿了去上架 → 收成熟的 → 清枯掉的 → 澆水 → 種最缺的 → 有東西就上架
function planWorker(S, w) {
  const dist = pl => Math.abs(pl.x - w.x) + Math.abs(pl.y - w.y);
  const nearest = list => list.sort((a, b) => dist(a) - dist(b))[0];
  const total = carryTotal(w.carry), full = total >= carryCap(S) - 1;
  const sprinkler = upgValue(S, 'sprinkler') > 0;
  const ripe = S.plots.filter(pl => pl.crop && !pl.dead && pl.g >= 1);
  const dead = S.plots.filter(pl => pl.dead);
  const thirsty = sprinkler ? [] : S.plots.filter(pl => pl.crop && !pl.dead && pl.g < 1 && pl.wet <= 0);
  const empty = S.plots.filter(pl => !pl.crop);
  let target = null;
  if (!full && ripe.length) target = nearest(ripe);
  else if (dead.length) target = nearest(dead);
  else if (thirsty.length) target = nearest(thirsty);
  else if (empty.length && !full) {
    const crop = workerCrop(S);
    if (crop) { w.seed = crop; target = nearest(empty); }
  }
  if (!target && total > 0) target = { x: SHELF_TILES[0][0], y: SHELF_TILES[0][1] };
  if (full && ripe.length) target = { x: SHELF_TILES[0][0], y: SHELF_TILES[0][1] };
  if (!target) return;
  const plan = planTap(w.x, w.y, target.x, target.y);
  if (plan) { w.path = plan.path; w.action = plan.obj; }
}

function stepWorker(S, dt) {
  const w = S.worker;
  if (!w || w.off) return;
  moveAlong(w, WORKER.speed * dt);
  if (w.path.length) return;
  if (w.action) {
    const a = w.action;
    w.action = null;
    w.water = 99;              // 幫手自己會去打水，不用管
    if (a.kind === 'plot') tapPlot(S, w, S.plots[a.i]);
    else if (a.kind === 'shelf') tapShelf(S, w, a);
    w.think = 0.3;
    return;
  }
  if ((w.think -= dt) <= 0) { w.think = 0.5; planWorker(S, w); }
}

function buyAnimal(S, p, k) {
  const def = ANIMALS[k];
  if (!def) return;
  const a = S.animals[k];
  if (a.count >= animalMax(S)) return say(S, p, `${def.name}已經養滿 ${animalMax(S)} 隻了，可以升級牧場擴建`);
  const cost = animalCost(S, k);
  if (S.money < cost) return say(S, p, `錢不夠買${def.name}`);
  S.money -= cost;
  S.stats.upgradeSpent += cost;
  a.count++;
  addFx(S, p.x, p.y - 0.7, `${def.emoji} 買了一隻${def.name}！`, '#ffca28', 'up');
}

function buyDecor(S, p, k) {
  const d = DECOR[k];
  if (!d || S.decor[k]) return;
  if (S.money < d.cost) return say(S, p, '錢不夠買裝潢');
  S.money -= d.cost;
  S.stats.upgradeSpent += d.cost;
  S.decor[k] = true;
  addFx(S, p.x, p.y - 0.7, `${d.icon} ${d.name}擺好了！`, '#ffca28', 'up');
}

function giveItems(S, p, mate) {
  if (!mate || !mate.connected) return;
  if (Math.hypot(mate.x - p.x, mate.y - p.y) > 1.6) return say(S, p, `${mate.name}走掉了`);
  const room = carryCap(S) - carryTotal(mate.carry);
  if (!carryTotal(p.carry)) return say(S, p, '身上沒有東西可以給');
  if (room <= 0) return say(S, p, `${mate.name}拿不下了`);
  let left = room;
  const moved = {};
  for (const k of ITEM_KEYS) {
    const n = Math.min(p.carry[k], left);
    if (n > 0) { p.carry[k] -= n; mate.carry[k] += n; moved[k] = n; left -= n; }
  }
  addFx(S, mate.x, mate.y - 0.7, `收到 ${itemList(moved)}`, '#c5e1a5', 'give');
}

function buyUnlock(S, p, k) {
  const u = UNLOCKS[k];
  if (!u || S.unlocked[k]) return;
  if (u.requires && !owns(S, u.requires)) return say(S, p, `要先${ANIMALS[u.requires] ? '養' : '解鎖'}${nameOf(u.requires)}`);
  if (S.money < u.cost) return say(S, p, '錢不夠解鎖');
  S.money -= u.cost;
  S.stats.upgradeSpent += u.cost;
  S.unlocked[k] = true;
  addFx(S, p.x, p.y - 0.7, `解鎖 ${ITEMS[k].emoji}${ITEMS[k].name}！`, '#ffca28', 'up');
}

function setProfile(S, p, msg) {
  const name = cleanName(msg.name);
  if (name) p.name = name;
  if (COLORS.includes(msg.color) && !Object.values(S.players).some(o => o !== p && o.connected && o.color === msg.color)) {
    p.color = msg.color;
  }
}

function applyInput(S, pid, msg) {
  const p = S.players[pid];
  if (!msg || !p) return;
  if (msg.t === 'tap') { if (S.phase === 'play') handleTap(S, pid, msg.x | 0, msg.y | 0); }
  else if (msg.t === 'seed') { if (CROPS[msg.c] && S.unlocked[msg.c]) p.seed = msg.c; }
  else if (msg.t === 'upgrade') { if (S.phase !== 'lobby') buyUpgrade(S, p, msg.k); }
  else if (msg.t === 'unlock') { if (S.phase !== 'lobby') buyUnlock(S, p, msg.k); }
  else if (msg.t === 'decor') { if (S.phase !== 'lobby') buyDecor(S, p, msg.k); }
  else if (msg.t === 'animal') { if (S.phase !== 'lobby') buyAnimal(S, p, msg.k); }
  else if (msg.t === 'worker') { if (S.phase !== 'lobby') setWorker(S, p, !!msg.v); }
  else if (msg.t === 'price') { if (PRICE_LEVELS[msg.v]) S.priceLv = msg.v; }
  else if (msg.t === 'chat') {
    if (CHAT[msg.i]) { p.chat = { text: CHAT[msg.i], ttl: 3.5 }; addFx(S, p.x, p.y, '', null, 'chat'); }
  }
  else if (msg.t === 'profile') setProfile(S, p, msg);
  else if (msg.t === 'ready') p.ready = !!msg.v;
}

const onlinePlayers = S => Object.values(S.players).filter(p => p.connected);
const allReady = S => onlinePlayers(S).every(p => p.ready);

function frontCustomer(S) {
  const c = S.customers.find(c => c.state !== 'leave' && c.qi === 0);
  return c && Math.hypot(c.x - QUEUE[0][0], c.y - QUEUE[0][1]) < 0.3 ? c : null;
}

function sendAway(c) {
  c.state = 'leave';
  c.wp = [[DOOR[0], DOOR[1]], [DOOR[0], STREET_Y + 1]];
}

// ---------- 特殊訂單 ----------
function newOrder(S) {
  // 跟客人一樣隨機挑，當季熱門的比較容易被選到
  const kinds = new Set();
  for (let i = 0; i < (S.day >= 6 ? 3 : 2); i++) { const k = pickWanted(S, kinds); if (k) kinds.add(k); }
  const need = {};
  let value = 0;
  for (const k of kinds) {
    const n = PRODUCTS[k] ? randInt(2, 2 + Math.min(3, Math.floor(S.day / 3))) : randInt(4, Math.min(12, 4 + S.day));
    need[k] = n;
    value += n * ITEMS[k].price;
  }
  return { need, got: {}, reward: Math.round(value * 1.5 / 5) * 5, done: false, failed: false };
}

const orderLeft = (o, k) => o.need[k] - (o.got[k] || 0);

function deliverOrder(S, p) {
  const o = S.order;
  if (!o || o.done || o.failed) return say(S, p, '今天沒有訂單了');
  let moved = 0;
  for (const k in o.need) {
    // 先交身上的，不夠再從貨架拿
    for (const src of [p.carry, S.shelves]) {
      const n = Math.min(orderLeft(o, k), src[k]);
      if (n > 0) { src[k] -= n; o.got[k] = (o.got[k] || 0) + n; moved += n; }
    }
  }
  if (Object.keys(o.need).every(k => orderLeft(o, k) <= 0)) {
    o.done = true;
    S.money += o.reward;
    S.stats.income += o.reward;
    S.stats.order = 'done';
    S.stats.orderReward = o.reward;
    S.ordersDone++;
    changeRating(S, 0.2);
    addFx(S, BOARD.x, BOARD.y - 0.6, `訂單完成！+$${o.reward}`, '#ffca28', 'order');
  } else if (moved) {
    addFx(S, BOARD.x, BOARD.y - 0.6, `交了 ${moved} 個`, '#c5e1a5', 'give');
  } else {
    const left = {};
    for (const k in o.need) if (orderLeft(o, k) > 0) left[k] = orderLeft(o, k);
    say(S, p, '還需要 ' + itemList(left));
  }
}

// ---------- 點了東西之後要做的事 ----------
function tapPlot(S, p, pl) {
  if (!pl.crop) {
    const c = CROPS[p.seed];
    if (!S.unlocked[p.seed]) return say(S, p, `還沒解鎖${c.name}`);
    if (!inSeason(S, p.seed)) return say(S, p, `${SEASONS[seasonOf(S.day)].name}天不能種${c.name}`);
    if (S.money < c.seed) return say(S, p, '錢不夠買種子');
    S.money -= c.seed;
    S.stats.seedSpent += c.seed;
    Object.assign(pl, { crop: p.seed, g: 0, wet: 0, dry: 0, dead: false });
    addFx(S, pl.x, pl.y - 0.4, `-$${c.seed}`, '#ef9a9a', 'plant');
    if (p.water > 0 && !upgValue(S, 'sprinkler')) { p.water--; pl.wet = WET_TIME; }   // 有水就順便澆
  } else if (pl.dead) {
    Object.assign(pl, { crop: null, g: 0, wet: 0, dry: 0, dead: false });
    say(S, p, '清掉枯萎的作物');
  } else if (pl.g >= 1) {
    const room = carryCap(S) - carryTotal(p.carry);
    if (room <= 0) return say(S, p, '拿不下了');
    const c = CROPS[pl.crop], n = Math.min(room, c.yield);
    p.carry[pl.crop] += n;
    addFx(S, pl.x, pl.y - 0.4, `+${n}${c.emoji}`, '#c5e1a5', 'harvest');
    Object.assign(pl, { crop: null, g: 0, wet: 0, dry: 0 });
  } else if (pl.wet > 0 || upgValue(S, 'sprinkler')) {
    say(S, p, `長大中 ${Math.floor(pl.g * 100)}%`);
  } else if (p.water > 0) {
    p.water--;
    pl.wet = WET_TIME;
    pl.dry = 0;
    addFx(S, pl.x, pl.y - 0.4, '💧', '#81d4fa', 'water');
  } else {
    say(S, p, '水壺空了，去 💧 井打水');
  }
}

// 點貨架：把身上所有東西都上架（滿了的留在身上）
function tapShelf(S, p, a) {
  const cap = upgValue(S, 'shelf'), moved = {};
  for (const k of ITEM_KEYS) {
    const n = Math.min(p.carry[k], cap - S.shelves[k]);
    if (n > 0) { p.carry[k] -= n; S.shelves[k] += n; moved[k] = n; }
  }
  if (Object.keys(moved).length) addFx(S, a.x, a.y + 0.6, '上架 ' + itemList(moved), '#c5e1a5', 'give');
  else say(S, p, carryTotal(p.carry) ? '貨架滿了' : '身上沒有東西');
}

// 有成品就拿走成品；沒有的話從貨架拿一份原料（不夠才用身上的）開始加工
function tapMachine(S, p, a) {
  const m = S.machines[a.i], def = MACHINES[a.i], prod = PRODUCTS[def.product], raw = prod.from;
  if (!S.unlocked[def.product]) return say(S, p, `${def.name}還沒解鎖`);
  if (m.out > 0) {
    const take = Math.min(m.out, carryCap(S) - carryTotal(p.carry));
    if (take <= 0) return say(S, p, '拿不下了');
    m.out -= take;
    p.carry[def.product] += take;
    return addFx(S, a.x, a.y - 0.6, `+${take}${prod.emoji}`, '#c5e1a5', 'harvest');
  }
  if (m.input + prod.need > MACHINE_IN) return say(S, p, `${def.name}排滿了`);
  const fromShelf = S.shelves[raw] >= prod.need;
  if (!fromShelf && p.carry[raw] < prod.need) return say(S, p, `架上的${ITEMS[raw].name}不夠（要 ${prod.need} 個）`);
  if (fromShelf) S.shelves[raw] -= prod.need;
  else p.carry[raw] -= prod.need;
  m.input += prod.need;
  addFx(S, a.x - 1, a.y - 0.3, `${ITEMS[raw].emoji}×${prod.need} → ${prod.emoji}`, '#c5e1a5', 'plant');
}

function tapRegister(S, p) {
  const c = frontCustomer(S);
  if (!c) return say(S, p, '櫃台前沒有客人');
  const missing = ITEM_KEYS.filter(k => (c.want[k] || 0) > S.shelves[k]);
  if (missing.length) return say(S, p, '架上缺' + missing.map(k => ITEMS[k].name).join('、'));
  const type = CUSTOMER_TYPES[c.type] || CUSTOMER_TYPES.normal;
  let total = 0;
  for (const k in c.want) {
    S.shelves[k] -= c.want[k];
    S.stats.sold[k] += c.want[k];
    total += c.want[k] * priceOf(S, k);
  }
  total = Math.round(total * type.pay);
  const ratio = c.patience / c.maxPatience;
  // 評價越高小費越多；音樂裝潢、急躁客也會多給
  const tip = Math.round(total * 0.3 * ratio * type.tip * decorBonus(S).tip * (0.6 + 0.12 * S.rating));
  S.money += total + tip;
  S.stats.income += total + tip;
  S.stats.served++;
  S.served++;
  changeRating(S, 0.05 * (0.5 + ratio * 0.5) * type.rating * priceLevel(S).rating * decorBonus(S).rating);
  c.face = '😄';
  sendAway(c);
  addFx(S, REGISTER.x, REGISTER.y - 0.6, `+$${total}` + (tip ? ` 小費$${tip}` : ''), '#a5d6a7', 'coin');
}

// 點牧場：有產出就收；沒吃東西就餵（每隻 $FEED_COST）；吃飽了就看進度
function tapPen(S, p, k) {
  const a = S.animals[k], def = ANIMALS[k], good = ITEMS[def.good];
  if (!a.count) return say(S, p, `還沒養${def.name}（在每天的結算畫面買）`);
  if (a.ready > 0) {
    const take = Math.min(a.ready, carryCap(S) - carryTotal(p.carry));
    if (take <= 0) return say(S, p, '拿不下了');
    a.ready -= take;
    p.carry[def.good] += take;
    return addFx(S, p.x, p.y - 0.7, `+${take}${good.emoji}`, '#c5e1a5', 'harvest');
  }
  if (a.fed <= 0) {
    const cost = FEED_COST * a.count;
    if (S.money < cost) return say(S, p, '錢不夠買飼料');
    S.money -= cost;
    S.stats.seedSpent += cost;
    a.fed = FED_TIME;
    return addFx(S, p.x, p.y - 0.7, `餵${def.name} -$${cost}`, '#ef9a9a', 'plant');
  }
  say(S, p, `${def.name}吃飽了，${good.name} ${Math.floor(a.prog * 100)}%`);
}

function catchThief(S, p) {
  const th = S.thief;
  if (!th || th.state === 'flee') return;
  if (Math.hypot(th.x - p.x, th.y - p.y) > 1.6) return say(S, p, '小偷跑掉了，再點他一次');
  th.state = 'flee';
  th.caught = true;
  th.wp = [[DOOR[0], DOOR[1]], [DOOR[0], STREET_Y + 1.5]];
  S.money += 30;
  S.thievesCaught++;
  S.stats.thief = 'caught';
  changeRating(S, 0.1);
  addFx(S, th.x, th.y - 0.7, '抓到小偷！+$30', '#ffca28', 'order');
}

function doAction(S, p, a) {
  if (a.kind === 'plot') tapPlot(S, p, S.plots[a.i]);
  else if (a.kind === 'shelf') tapShelf(S, p, a);
  else if (a.kind === 'machine') tapMachine(S, p, a);
  else if (a.kind === 'register') tapRegister(S, p);
  else if (a.kind === 'board') deliverOrder(S, p);
  else if (a.kind === 'give') giveItems(S, p, S.players[a.id]);
  else if (a.kind === 'pen') tapPen(S, p, a.animal);
  else if (a.kind === 'catch') catchThief(S, p);
  else if (a.kind === 'well') {
    p.water = upgValue(S, 'can');
    addFx(S, WELL.x, WELL.y - 0.6, `💧 裝滿了（${p.water}）`, '#81d4fa', 'water');
  }
}

function stepPlayer(S, p, dt) {
  moveAlong(p, upgValue(S, 'speed') * dt);
  if (!p.path.length && p.action) {
    const a = p.action;
    p.action = null;
    doAction(S, p, a);
  }
}

function stepPlots(S, dt) {
  const sprinkler = upgValue(S, 'sprinkler') > 0, soil = upgValue(S, 'soil');
  for (const pl of S.plots) {
    if (pl.wet > 0) pl.wet = Math.max(0, pl.wet - dt);
    if (!pl.crop || pl.dead || pl.g >= 1) continue;
    if (sprinkler || pl.wet > 0) {
      pl.g = Math.min(1, pl.g + dt * soil / CROPS[pl.crop].grow);
      pl.dry = 0;
    } else if ((pl.dry += dt) > WITHER_TIME) {
      pl.dead = true;
      S.stats.withered++;
      addFx(S, pl.x, pl.y - 0.4, '枯萎了…', '#ef9a9a', 'bad');
    }
  }
}

// 隨機挑客人想買的東西：只會挑已經解鎖的，當季熱門的機率比較高
function pickWanted(S, exclude) {
  const hot = SEASON_HOT[seasonOf(S.day)];
  const pool = ITEM_KEYS.filter(k => sellable(S, k) && !exclude.has(k));
  if (!pool.length) return null;
  const weight = k => (hot.includes(k) ? 3 : 1) * (PRODUCTS[k] ? 1.2 : 1);
  let r = Math.random() * pool.reduce((s, k) => s + weight(k), 0);
  for (const k of pool) if ((r -= weight(k)) <= 0) return k;
  return pool[pool.length - 1];
}

function pickCustomerType(S) {
  const canGourmet = PRODUCT_KEYS.some(k => sellable(S, k));
  const w = {
    normal: CUSTOMER_TYPES.normal.weight,
    hurry: CUSTOMER_TYPES.hurry.weight,
    big: CUSTOMER_TYPES.big.weight * (0.5 + S.rating * 0.3),     // 評價越高越多大戶
    gourmet: canGourmet ? CUSTOMER_TYPES.gourmet.weight * (0.5 + S.rating * 0.2) : 0,
  };
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const k in w) if ((r -= w[k]) <= 0) return k;
  return 'normal';
}

function spawnCustomer(S) {
  const type = pickCustomerType(S), def = CUSTOMER_TYPES[type];
  const want = {};
  if (type === 'gourmet') {
    // 美食家只買加工品
    const pool = PRODUCT_KEYS.filter(k => sellable(S, k));
    want[pick(pool)] = 1;
    if (pool.length > 1 && Math.random() < 0.4) want[pick(pool)] = 1;
  } else {
    const kinds = new Set(), first = pickWanted(S, kinds);
    if (!first) return;          // 現在什麼都拿不到就先不來客人
    kinds.add(first);
    const extra = type === 'big' ? 2 : Math.random() < 0.35 ? 1 : 0;
    for (let i = 0; i < extra; i++) { const k = pickWanted(S, kinds); if (k) kinds.add(k); }
    for (const k of kinds) {
      const n = PRODUCTS[k] ? 1 : Math.random() < 0.4 ? 2 : 1;
      want[k] = type === 'big' ? n + randInt(1, 2) : n;
    }
  }
  // 要加工品的客人比較願意等
  const base = PATIENCE + (PRODUCT_KEYS.some(k => want[k]) ? 20 : 0);
  const patience = Math.round(base * def.patience * priceLevel(S).patience * decorBonus(S).patience);
  S.customers.push({
    id: S.nextId++, type, x: DOOR[0], y: STREET_Y, wp: [[DOOR[0], DOOR[1]]],
    want, patience, maxPatience: patience, state: 'enter', face: pick(def.faces || FACES), qi: -1,
  });
}

function checkGoals(S) {
  for (const g of GOALS) {
    if (S.goals[g.id] || !g.check(S)) continue;
    S.goals[g.id] = S.day;
    S.money += g.reward;
    S.stats.goals.push(g.id);
    S.banner = { text: `🏆 ${g.final ? '達成最終目標！' : '目標達成：' + g.text}${g.reward ? ` +$${g.reward}` : ''}`, ttl: 4 };
    addFx(S, REGISTER.x, REGISTER.y - 1, '', null, 'order');
  }
}

function stepAnimals(S, dt) {
  for (const k of ANIMAL_KEYS) {
    const a = S.animals[k], def = ANIMALS[k];
    if (!a.count || a.fed <= 0) continue;
    a.fed = Math.max(0, a.fed - dt);
    if (a.ready >= readyCap(a)) continue;
    a.prog += dt * a.count * upgValue(S, 'feed') / def.interval;
    if (a.prog >= 1) {
      a.prog -= 1;
      a.ready++;
      addFx(S, def.x + 0.5, PEN.y0 - 0.2, `${ITEMS[def.good].emoji} 好了`, '#ffe082', 'ding');
    }
  }
}

// 小偷：從門口溜到收銀台旁，待 10 秒就偷走一筆錢跑掉；被點到就抓住
function stepThief(S, dt) {
  const hour = gameHour(S.t);
  if (!S.thief && S.thiefAt != null && hour >= S.thiefAt) {
    S.thiefAt = null;
    S.thief = { x: DOOR[0], y: STREET_Y, wp: [[DOOR[0], DOOR[1]], THIEF_SPOT], state: 'enter', t: 0 };
    S.banner = { text: '⚠️ 有小偷溜進店裡了！快點他抓起來', ttl: 4 };
    addFx(S, DOOR[0], DOOR[1], '', null, 'bad');
  }
  const th = S.thief;
  if (!th) return;
  if (th.wp.length) {
    const [tx, ty] = th.wp[0], dx = tx - th.x, dy = ty - th.y, d = Math.hypot(dx, dy), m = (th.state === 'flee' ? 4 : 2.2) * dt;
    if (d <= m) { th.x = tx; th.y = ty; th.wp.shift(); }
    else { th.x += dx / d * m; th.y += dy / d * m; }
    if (!th.wp.length && th.state === 'enter') th.state = 'steal';
    if (!th.wp.length && th.state === 'flee') S.thief = null;
    return;
  }
  if (th.state === 'steal' && (th.t += dt / 10) >= 1) {
    const amount = Math.min(S.money, Math.max(20, Math.round(S.money * 0.15)));
    S.money -= amount;
    S.stats.thief = 'stolen';
    S.stats.stolen += amount;
    th.state = 'flee';
    th.wp = [[DOOR[0], DOOR[1]], [DOOR[0], STREET_Y + 1.5]];
    addFx(S, th.x, th.y - 0.7, `被偷走 $${amount}！`, '#ef5350', 'bad');
  }
}

function stepMachines(S, dt) {
  MACHINES.forEach((def, i) => {
    const m = S.machines[i], prod = PRODUCTS[def.product];
    if (m.input < prod.need) { m.p = 0; return; }
    if (m.out >= MACHINE_OUT) return;          // 成品放滿就先停
    m.p += dt * upgValue(S, 'machine') / prod.time;
    if (m.p >= 1) {
      m.p = 0;
      m.input -= prod.need;
      m.out++;
      addFx(S, def.x - 1, def.y - 0.3, `${prod.emoji} 做好了`, '#ffe082', 'ding');
    }
  });
}

function stepCustomers(S, dt) {
  const hour = gameHour(S.t);
  if (hour >= OPEN_HOUR && hour < CLOSE_HOUR) {
    S.spawnT -= dt;
    const active = S.customers.filter(c => c.state !== 'leave').length;
    if (S.spawnT <= 0 && active < QUEUE.length) {
      spawnCustomer(S);
      const rush = hour >= 11 && hour < 13 ? 0.5 : 1;   // 中午尖峰
      // 價格越低、評價越高、有大招牌，客人來得越頻繁
      S.spawnT = (6 + Math.random() * 7) * rush * priceLevel(S).spawn * (1.4 - 0.15 * S.rating) * decorBonus(S).spawn;
    }
  }
  let qi = 0;
  for (const c of S.customers) {
    if (c.state !== 'leave') {
      c.qi = qi++;
      c.patience -= dt;
      if (c.patience <= 0) {
        c.face = '😠';
        sendAway(c);
        S.stats.angry++;
        changeRating(S, -0.15 * (c.type === 'gourmet' ? 1.6 : 1));
        addFx(S, c.x, c.y - 0.7, '等太久了！', '#ef5350', 'bad');
      }
    }
    const target = c.wp.length ? c.wp[0] : c.state !== 'leave' ? QUEUE[c.qi] : null;
    if (target) {
      const dx = target[0] - c.x, dy = target[1] - c.y, d = Math.hypot(dx, dy), m = CUSTOMER_SPEED * dt;
      if (d <= m) {
        c.x = target[0]; c.y = target[1];
        if (c.wp.length) c.wp.shift();
        else if (c.state === 'enter') c.state = 'wait';
      } else {
        c.x += dx / d * m; c.y += dy / d * m;
      }
    }
    if (c.state === 'leave' && !c.wp.length) c.gone = true;
  }
  S.customers = S.customers.filter(c => !c.gone);
}

// 從準備畫面開始遊戲
function startGame(S) {
  S.phase = 'play';
  if (!S.order) S.order = newOrder(S);
  if (S.stats.ratingStart == null) S.stats.ratingStart = S.rating;
  rollThief(S);
}

// 一天結束：停下來進結算畫面，等所有人按「準備好了」才進到隔天
function endDay(S) {
  S.phase = 'summary';
  S.t = DAY_LEN;
  S.customers = [];
  S.thief = null;
  S.thiefAt = null;
  S.fx = [];
  S.banner = null;
  if (S.order && !S.order.done) { S.order.failed = true; S.stats.order = 'failed'; changeRating(S, -0.2); }
  addFx(S, REGISTER.x, REGISTER.y, '', null, 'night');
  for (const p of Object.values(S.players)) { p.ready = false; p.path = []; p.action = null; }
}

function startNextDay(S) {
  S.phase = 'play';
  S.day++;
  S.t = 0;
  S.spawnT = 3;
  S.stats = newStats();
  S.stats.ratingStart = S.rating;
  S.order = newOrder(S);
  for (const pl of S.plots) pl.wet = 0;     // 過一晚土就乾了
  for (const a of Object.values(S.animals)) a.fed = 0;   // 動物每天早上要重新餵
  rollThief(S);
  // 每天早上付幫手工資；錢不夠他就放假一天
  if (S.worker) {
    S.worker.off = S.money < WORKER.wage;
    if (!S.worker.off) { S.money -= WORKER.wage; S.stats.wage = WORKER.wage; }
    Object.assign(S.worker, { path: [], action: null });
    [S.worker.x, S.worker.y] = WORKER.spawn;
  }
  for (const p of Object.values(S.players)) p.ready = false;
}

function step(S, dt) {
  if (S.phase === 'summary' && onlinePlayers(S).length && allReady(S)) startNextDay(S);
  if (S.phase !== 'play') return;
  S.t += dt;
  if (S.t >= DAY_LEN) return endDay(S);
  stepPlots(S, dt);
  stepMachines(S, dt);
  stepAnimals(S, dt);
  stepWorker(S, dt);
  for (const id in S.players) stepPlayer(S, S.players[id], dt);
  stepCustomers(S, dt);
  stepThief(S, dt);
  checkGoals(S);
  for (const p of Object.values(S.players)) if (p.chat && (p.chat.ttl -= dt) <= 0) p.chat = null;
  for (const f of S.fx) f.ttl -= dt;
  S.fx = S.fx.filter(f => f.ttl > 0);
  if (S.banner && (S.banner.ttl -= dt) <= 0) S.banner = null;
}
