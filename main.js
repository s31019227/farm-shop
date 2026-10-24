// 大廳、準備畫面、連線（PeerJS 點對點）與主迴圈。
// 主機 = 建房間的人：跑遊戲邏輯，每 0.1 秒把整份狀態傳給所有人。
// 其他人：只送出點擊和設定，畫出主機傳來的狀態。
(() => {
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);
  const PREFIX = 'nongshop-v1-';
  const SAVE_KEY = 'nongshop-save', CODE_KEY = 'nongshop-room', NAME_KEY = 'nongshop-name', CID_KEY = 'nongshop-cid';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const canvas = $('game'), ctx = canvas.getContext('2d');

  const store = fn => { try { return fn(); } catch (e) { return null; } };
  const pad = n => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const randomCode = (n = 4) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

  // 每個分頁一個玩家代號：重新整理後還是同一個人，同一台電腦開兩個分頁也不會撞在一起
  const cid = store(() => sessionStorage.getItem(CID_KEY)) || randomCode(10);
  store(() => sessionStorage.setItem(CID_KEY, cid));
  let myName = store(() => localStorage.getItem(NAME_KEY)) || '';

  let mode = null;          // 'host' | 'guest'
  const meId = cid;
  let S = null;             // 主機：權威狀態；其他人：最新快照
  let peer = null, roomCode = '';
  let conn = null;          // 其他人 → 主機的連線
  const conns = new Map();  // 主機：玩家代號 → 連線
  let retryTimer = null;
  let tapMark = null;
  let view = { tilePx: 32, camX: 0, camY: 0, cw: 0, ch: 0, dpr: 1 };
  const disp = {};          // 這一幀要畫的位置（客機用，主機直接畫狀態裡的位置）
  const INTERP_DELAY = 110; // 毫秒：其他人畫在稍早兩份快照之間，網路有點抖也看起來平順
  const snaps = [];         // 客機收到的位置快照 [{ at, pos: { key: [x, y] } }]
  let pred = null;          // 客機：自己角色的預測位置，點下去馬上開始走，不用等主機

  function setText(el, text) { if (typeof el === 'string') el = $(el); if (el.textContent !== text) el.textContent = text; }
  function setNet(text, cls) { const el = $('hud-net'); el.textContent = text; el.className = 'net ' + cls; }
  function lobbyMsg(text) { $('lobby-msg').textContent = text; }

  // ---------- 開始畫面 ----------
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('in-code').value = params.get('room').toUpperCase();
  // 有存檔就先問要接續還是開新農場
  $('btn-host').onclick = () => {
    const d = readSave();
    if (!d) return startHost(false);
    setText('save-info', `上次的進度：${SEASONS[seasonOf(d.day)].name}・第 ${d.day} 天、$${d.money}、⭐${(d.rating ?? 3).toFixed(1)}`);
    showHostChoice(true);
  };
  function showHostChoice(on) {
    $('host-choice').classList.toggle('hidden', !on);
    $('btn-host').classList.toggle('hidden', on);
    $('join-area').classList.toggle('hidden', on);
  }
  $('btn-continue').onclick = () => startHost(true);
  $('btn-newfarm').onclick = () => { if (confirm('確定要開新農場嗎？舊的進度會被蓋掉（可以先匯出存檔備份）')) startHost(false); };
  $('btn-choice-back').onclick = () => showHostChoice(false);
  $('btn-join').onclick = () => {
    const code = $('in-code').value.trim().toUpperCase();
    if (code.length !== 4) return lobbyMsg('請輸入 4 碼房間代碼');
    startGuest(code);
  };
  $('in-code').onkeydown = e => { if (e.key === 'Enter') $('btn-join').click(); };

  // 匯出 / 匯入存檔：換網址（例如從自己電腦換到網路版）或換電腦時用
  function readSave() {
    const d = store(() => JSON.parse(localStorage.getItem(SAVE_KEY)));
    return d && d.v === 2 ? d : null;
  }
  $('btn-export').onclick = () => {
    const d = readSave();
    if (!d) return lobbyMsg('這個瀏覽器裡還沒有存檔');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
    a.download = `農場小店存檔-第${d.day}天.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('btn-import').onclick = () => $('in-import').click();
  $('in-import').onchange = async () => {
    const file = $('in-import').files[0];
    if (!file) return;
    const text = await file.text();
    const d = store(() => JSON.parse(text));
    $('in-import').value = '';
    if (!d || d.v !== 2 || typeof d.day !== 'number') return lobbyMsg('這個檔案不是農場小店的存檔');
    if (readSave() && !confirm(`要用匯入的存檔（第 ${d.day} 天、$${d.money}）蓋掉這裡的存檔嗎？`)) return;
    store(() => localStorage.setItem(SAVE_KEY, JSON.stringify(d)));
    lobbyMsg(`已匯入：第 ${d.day} 天、$${d.money}。按「建立房間」→「接續上次的農場」就能繼續`);
  };

  // ---------- 安裝成 App（PWA） ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) $('install-tip').classList.remove('hidden');
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('btn-install').classList.remove('hidden');
  });
  $('btn-install').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('btn-install').classList.add('hidden');
  };
  for (const b of $$('.btn-copy')) b.onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${roomCode}`;
    try { await navigator.clipboard.writeText(link); b.textContent = '已複製！'; setTimeout(() => { b.textContent = '複製邀請連結'; }, 1500); }
    catch (e) { prompt('把這個連結傳給朋友：', link); }
  };

  function sendInput(msg) {
    if (mode === 'host') applyInput(S, meId, msg);
    else if (conn && conn.open) conn.send(msg);
  }

  // ---------- 準備畫面 ----------
  $('me-name').addEventListener('input', () => {
    myName = cleanName($('me-name').value);
    store(() => localStorage.setItem(NAME_KEY, myName));
    if (myName) sendInput({ t: 'profile', name: myName });
  });
  $('btn-ready').onclick = () => { const me = S && S.players[meId]; if (me) sendInput({ t: 'ready', v: !me.ready }); };
  $('btn-start').onclick = () => { if (mode === 'host' && allReady(S)) startGame(S); };

  // ---------- 管理面板和快捷聊天 ----------
  const sheet = $('upg-sheet'), chatMenu = $('chat-menu'), backdrop = $('backdrop');
  // popup = 'sheet'、'chat' 或 null；同時只開一個，開著的時候墊一層背景，點空白處就關掉
  function setPopup(which) {
    sheet.classList.toggle('open', which === 'sheet');
    chatMenu.classList.toggle('hidden', which !== 'chat');
    backdrop.classList.toggle('hidden', !which);
  }
  const popupOpen = () => sheet.classList.contains('open') || !chatMenu.classList.contains('hidden');
  $('btn-upg-toggle').onclick = () => setPopup(sheet.classList.contains('open') ? null : 'sheet');
  $('btn-upg-close').onclick = () => setPopup(null);
  $('btn-chat').onclick = () => setPopup(chatMenu.classList.contains('hidden') ? 'chat' : null);
  backdrop.addEventListener('pointerdown', e => { e.preventDefault(); setPopup(null); });
  CHAT.forEach((text, i) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = () => { sendInput({ t: 'chat', i }); setPopup(null); };
    chatMenu.appendChild(b);
  });
  // 三種幫手各一個按鈕
  for (const k of HELPER_KEYS) {
    const def = HELPERS[k], row = document.createElement('div');
    row.className = 'helper-row';
    row.innerHTML = '<div class="helper-info"><b></b><span class="sheet-note"></span></div><button></button>';
    row.querySelector('b').textContent = `${def.hat} ${def.name}`;
    row.querySelector('.sheet-note').textContent = `${def.desc}。雇用 $${def.hire}，每天工資 $${def.wage}`;
    const b = row.querySelector('button');
    b.dataset.helper = k;
    b.onclick = () => {
      if (S.helpers[k] && !confirm(`確定要解雇${def.name}嗎？他身上的東西會放回貨架`)) return;
      sendInput({ t: 'helper', k, v: !S.helpers[k] });
    };
    $('helpers').appendChild(row);
  }
  PRICE_LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.textContent = lv.name;
    b.dataset.price = i;
    b.onclick = () => sendInput({ t: 'price', v: i });
    $('price').appendChild(b);
  });

  let goalSig = '', lastHatSig = '';
  function updatePanel() {
    for (const b of $('price').children) b.classList.toggle('active', +b.dataset.price === S.priceLv);
    const lv = priceLevel(S);
    setText('price-desc', `售價 ×${lv.mult}　` + (lv.mult < 1 ? '客人變多、評價漲得快' : lv.mult > 1 ? '客人變少、比較沒耐心、評價漲得慢' : '標準價格'));
    for (const b of $$('[data-helper]')) {
      const k = b.dataset.helper, h = S.helpers[k];
      setText(b, h ? '解雇' + (h.off ? '（今天放假）' : '') : `雇用 $${HELPERS[k].hire}`);
      b.disabled = !h && S.money < HELPERS[k].hire;
    }
    // 帽子：買過的才能戴（買帽子在結算畫面）
    const me = S.players[meId];
    const hatSig = JSON.stringify(S.hats) + (me && me.hat);
    if (me && hatSig !== lastHatSig) {
      lastHatSig = hatSig;
      const box = $('hats');
      box.innerHTML = '';
      for (const k of HAT_KEYS) {
        if (!S.hats[k]) continue;
        const b = document.createElement('button');
        b.textContent = HATS[k].icon ? `${HATS[k].icon} ${HATS[k].name}` : HATS[k].name;
        b.classList.toggle('active', me.hat === k);
        b.onclick = () => sendInput({ t: 'hat', k });
        box.appendChild(b);
      }
    }
    const sig = JSON.stringify(S.goals) + S.day;
    if (sig === goalSig) return;
    goalSig = sig;
    const ul = $('goals');
    ul.innerHTML = '';
    for (const g of GOALS) {
      const li = document.createElement('li'), done = S.goals[g.id];
      li.className = (done ? 'done ' : '') + (g.final ? 'final' : '');
      li.innerHTML = '<span></span><span></span>';
      li.firstChild.textContent = (done ? '✅ ' : '⬜ ') + g.text;
      li.lastChild.textContent = done ? `第 ${done} 天` : g.reward ? `+$${g.reward}` : '';
      ul.appendChild(li);
    }
  }

  // ---------- 音效（用 Web Audio 現場合成，不用音檔） ----------
  // 每個音效是一串 [頻率, 秒數, 滑到哪個頻率]
  const SOUNDS = {
    coin: [[880, 0.06], [1320, 0.14]],
    harvest: [[520, 0.07], [780, 0.09]],
    plant: [[330, 0.07], [392, 0.07]],
    water: [[900, 0.14, 420]],
    give: [[600, 0.05], [750, 0.07]],
    tick: [[440, 0.04]],
    up: [[523, 0.08], [659, 0.08], [784, 0.16]],
    order: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.24]],
    chat: [[880, 0.05], [1175, 0.06]],
    ding: [[1320, 0.18]],
    bad: [[330, 0.12], [220, 0.2]],
    night: [[392, 0.16], [330, 0.16], [262, 0.32]],
  };
  const MUTE_KEY = 'nongshop-mute';
  let audio = null, muted = store(() => localStorage.getItem(MUTE_KEY)) === '1', lastFxId = -1;
  const lastPlayed = {};
  // 瀏覽器（特別是 iPhone）要在使用者點畫面之後才能出聲
  document.addEventListener('pointerdown', () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!audio && AC) audio = new AC();
    if (audio && audio.state === 'suspended') audio.resume();
  }, true);
  const muteBtn = $('btn-mute');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    store(() => localStorage.setItem(MUTE_KEY, muted ? '1' : '0'));
  };

  function playSound(name) {
    const seq = SOUNDS[name];
    if (muted || !seq || !audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (lastPlayed[name] && now - lastPlayed[name] < 0.08) return;   // 同一個音效太密就略過
    lastPlayed[name] = now;
    let t = now;
    for (const [freq, dur, slide] of seq) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = name === 'bad' ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(name === 'tick' ? 0.05 : 0.16, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.85;
    }
  }

  // 狀態裡新出現的特效就播它的音效；第一次拿到狀態時只記住編號，不播舊的
  function playNewSounds() {
    let max = lastFxId;
    for (const f of S.fx) {
      if (f.id > lastFxId && lastFxId >= 0 && f.snd) playSound(f.snd);
      if (f.id > max) max = f.id;
    }
    lastFxId = Math.max(max, S.fxSeq || 0, 0);
  }

  // ---------- 背景音樂：五聲音階隨機旋律 + 低音，白天、晚上、節慶的速度和音高不一樣 ----------
  const MUSIC_KEY = 'nongshop-music';
  let musicOn = store(() => localStorage.getItem(MUSIC_KEY)) !== '0';
  let musicNext = 0, musicStep = 0, musicGain = null, melodyIdx = 4;
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const CHORDS = [0, 5, 9, 7];          // 每小節低音的半音位置
  const musicBtn = $('btn-music');
  musicBtn.classList.toggle('off', !musicOn);
  musicBtn.onclick = () => {
    musicOn = !musicOn;
    musicBtn.classList.toggle('off', !musicOn);
    store(() => localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'));
  };

  function playNote(freq, start, dur, type, vol) {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(musicGain);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function scheduleMusic() {
    if (!musicOn || !audio || audio.state !== 'running' || !S) return;
    if (!musicGain) { musicGain = audio.createGain(); musicGain.gain.value = 0.06; musicGain.connect(audio.destination); }
    const h = gameHour(S.t), night = h >= 19 || h < 7, fest = isFestival(S.day);
    const beat = fest ? 0.2 : night ? 0.42 : 0.28, root = night ? 220 : 262;
    const semi = n => root * Math.pow(2, n / 12);
    if (musicNext < audio.currentTime) musicNext = audio.currentTime + 0.05;
    while (musicNext < audio.currentTime + 0.4) {
      const bar = Math.floor(musicStep / 8) % CHORDS.length;
      if (musicStep % 8 === 0) playNote(semi(CHORDS[bar] - 24), musicNext, beat * 7, 'sine', 0.5);
      // 旋律在音階上小步走，偶爾休息
      if (Math.random() < (night ? 0.45 : 0.7)) {
        melodyIdx = Math.max(0, Math.min(PENTA.length - 1, melodyIdx + randInt(-2, 2)));
        playNote(semi(PENTA[melodyIdx]), musicNext, beat * 0.9, 'triangle', 0.35);
      }
      musicNext += beat;
      musicStep++;
    }
  }

  // ---------- 新手教學：前三天、每台裝置只顯示一次 ----------
  const TUT_KEY = 'nongshop-tutorial';
  let tutDone = store(() => localStorage.getItem(TUT_KEY)) === '1';
  const TUTORIAL = [
    { text: '👋 先在左邊的農地點一下，種下番茄', done: S => S.plots.some(p => p.crop) },
    { text: '💧 作物要有水才會長：到 💧 井打水，再點正在長的作物（種的時候有水會順便澆）', done: S => S.plots.some(p => p.crop && (p.wet > 0 || p.g > 0.3)) },
    { text: '🍅 等作物成熟（會上下晃）再點一下收成', done: S => Object.values(S.players).some(p => CROP_KEYS.some(k => p.carry[k] || p.carry[goldOf(k)])) || ITEM_KEYS.some(k => S.shelves[k] > 0) },
    { text: '🏪 從店的側門走進後場，點貨架把東西放上去', done: S => ITEM_KEYS.some(k => S.shelves[k] > 0) },
    { text: '💰 客人走到櫃台時，點 💰 幫他結帳。之後可以打開右下角 📋 管理看升級和目標！', done: S => S.served > 0 },
  ];
  $('tut-skip').onclick = () => { tutDone = true; store(() => localStorage.setItem(TUT_KEY, '1')); };

  function updateTutorial() {
    const el = $('tutorial');
    if (tutDone || S.phase !== 'play' || S.day > 3) { el.classList.add('hidden'); return; }
    const i = TUTORIAL.findIndex(s => !s.done(S));
    if (i < 0) { tutDone = true; store(() => localStorage.setItem(TUT_KEY, '1')); el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    setText('tut-text', `📖 ${i + 1}/${TUTORIAL.length}　${TUTORIAL[i].text}`);
  }

  let readySig = '';
  function updateReady() {
    const me = S.players[meId];
    if (!me) return;
    if (!$('me-name').value && document.activeElement !== $('me-name')) $('me-name').value = me.name;
    const online = onlinePlayers(S);
    const sig = JSON.stringify([online.map(p => [p.id, p.name, p.color, p.ready]), S.day, S.money]);
    if (sig === readySig) return;
    readySig = sig;

    setText('ready-save', S.day > 1 || S.money !== 50 ? `接續存檔：第 ${S.day} 天、$${S.money}` : '新的農場');
    renderPlayerList($('ready-list'), online);

    const colors = $('me-colors');
    colors.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.style.background = c;
      b.classList.toggle('active', me.color === c);
      b.disabled = online.some(p => p !== me && p.color === c);
      b.onclick = () => sendInput({ t: 'profile', color: c });
      colors.appendChild(b);
    }

    $('btn-ready').textContent = me.ready ? '取消準備' : '準備好了';
    $('btn-start').classList.toggle('hidden', mode !== 'host');
    $('btn-start').disabled = !allReady(S);
    setText('ready-msg', allReady(S)
      ? (mode === 'host' ? '大家都準備好了，可以開始！' : '大家都準備好了，等房主開始…')
      : '等所有人按「準備好了」');
  }

  function renderPlayerList(list, players) {
    list.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot"></span><span class="name"></span><span class="tag"></span><span class="state"></span>';
      li.querySelector('.dot').style.background = p.color;
      li.querySelector('.name').textContent = p.name + (p.id === meId ? '（你）' : '');
      li.querySelector('.tag').textContent = p.id === S.hostId ? '房主' : '';
      li.querySelector('.state').textContent = p.ready ? '✅ 準備好了' : '⏳ 還沒準備';
      list.appendChild(li);
    }
  }

  // ---------- 當天結算 ----------
  $('btn-next').onclick = () => { const me = S && S.players[meId]; if (me) sendInput({ t: 'ready', v: !me.ready }); };

  let summarySig = '';
  function updateSummary() {
    const me = S.players[meId];
    if (!me) return;
    const online = onlinePlayers(S), st = S.stats;
    const sig = JSON.stringify([online.map(p => [p.id, p.name, p.color, p.ready]), S.day, S.money, st, S.unlocked, S.decor, S.animals, S.owned, S.hats, S.weatherNext]);
    if (sig === summarySig) return;
    summarySig = sig;

    const season = SEASONS[seasonOf(S.day)];
    setText('sum-title', `🌙 ${season.icon}${season.name}・第 ${S.day} 天結算`);
    const sold = ITEM_KEYS.filter(k => st.sold[k]).map(k => `${ITEMS[k].emoji}×${st.sold[k]}`).join('　') || '沒有';
    const net = st.income - st.seedSpent - st.upgradeSpent;
    const rows = [
      ['營業收入（含小費、訂單）', `$${st.income}`],
      ['服務客人', `${st.served} 位`],
      ['生氣離開', `${st.angry} 位`, st.angry ? 'neg' : ''],
      ['賣出', sold],
      ['特殊訂單', st.order === 'done' ? `完成 +$${st.orderReward}` : st.order === 'failed' ? '沒完成' : '—', st.order === 'failed' ? 'neg' : ''],
      ['枯萎的作物', `${st.withered} 株`, st.withered ? 'neg' : ''],
      ['小偷', st.thief === 'caught' ? '抓到了！+$30' : st.thief === 'dog' ? '被看門狗嚇跑了 🐕' : st.thief === 'stolen' ? `被偷走 $${st.stolen}` : '沒來', st.thief === 'stolen' ? 'neg' : ''],
      ...(st.stormLoss ? [['暴風雨打壞', `${st.stormLoss} 株`, 'neg']] : []),
      ...(st.crowLoss ? [['被烏鴉吃掉', `${st.crowLoss} 株`, 'neg']] : []),
      ...(st.gold ? [['🌟 金星作物', `${st.gold} 個`]] : []),
      ...(st.giants ? [['🎃 巨無霸南瓜', `${st.giants} 顆`]] : []),
      ...(st.fish ? [['🐟 釣到的魚', `${st.fish} 條`]] : []),
      ...(st.maxCombo >= 2 ? [['最高結帳連擊', `×${st.maxCombo}`]] : []),
      ...(st.wage ? [['幫手工資', `-$${st.wage}`, 'neg']] : []),
      ['種子、飼料花費', `-$${st.seedSpent}`, 'neg'],
      ['升級、解鎖花費', `-$${st.upgradeSpent}`, 'neg'],
      ['今日淨賺', `${net < 0 ? '-' : ''}$${Math.abs(net)}`],
      ['商店評價', `⭐${(st.ratingStart ?? S.rating).toFixed(1)} → ⭐${S.rating.toFixed(1)}`, S.rating < (st.ratingStart ?? S.rating) ? 'neg' : ''],
      ...st.goals.map(id => ['🏆 達成目標', GOALS.find(g => g.id === id).text]),
      ['目前資金', `$${S.money}`, 'total'],
    ];
    const table = $('sum-table');
    table.innerHTML = '';
    for (const [name, value, cls] of rows) {
      const tr = table.insertRow();
      if (cls === 'total') tr.className = 'total';
      tr.insertCell().textContent = name;
      const td = tr.insertCell();
      td.textContent = value;
      if (cls === 'neg') td.className = 'neg';
    }

    // 明天換季、最終目標的狀況提醒一下
    const next = seasonOf(S.day + 1), notes = [];
    notes.push(`明天的天氣：${weatherLabel({ day: S.day + 1 }, S.weatherNext)}${WEATHERS[S.weatherNext] && WEATHERS[S.weatherNext].storm ? '（下午會打壞田裡的作物，溫室裡的沒事）' : ''}`);
    if (isFestival(S.day + 1)) notes.push(`${SEASONS[next].festIcon} 明天是${SEASONS[next].festival}！客人會特別多，先多備點貨`);
    if (S.goals.final) notes.push(`🏆 你們在第 ${S.goals.final} 天達成最終目標了！可以繼續經營`);
    else if (S.day >= FINAL_DAY) notes.push(`沒在 ${FINAL_DAY} 天內存到 $5,000，不過可以繼續經營`);
    else notes.push(`🏆 最終目標：再 ${FINAL_DAY - S.day} 天內存到 $5,000（還差 $${Math.max(0, 5000 - S.money)}）`);
    if (next !== seasonOf(S.day)) {
      notes.push(`${SEASONS[next].icon} 明天開始是${SEASONS[next].name}天！可以種：${CROP_KEYS.filter(k => CROPS[k].seasons.includes(next)).map(k => CROPS[k].emoji + CROPS[k].name).join('、')}`);
    }
    setText('sum-season', notes.join('\n'));

    const unlocks = $('sum-unlocks');
    unlocks.innerHTML = '';
    for (const k of UNLOCK_KEYS) {
      if (S.unlocked[k]) continue;
      const u = UNLOCKS[k], it = ITEMS[k], b = document.createElement('button');
      const what = CROPS[k] ? `${it.emoji} ${it.name}（作物）` : `${it.emoji} ${it.name}（${MACHINES[machineIndex(k)].name}：${recipeText(k)}）`;
      const missing = unlockBlockers(S, k);
      b.textContent = missing.length ? `${what} — 要先有${missing.map(nameOf).join('、')}` : `${what} → 解鎖 $${u.cost}`;
      b.disabled = missing.length > 0 || S.money < u.cost;
      b.onclick = () => sendInput({ t: 'unlock', k });
      unlocks.appendChild(b);
    }
    if (!unlocks.children.length) unlocks.textContent = '全部都解鎖了！';

    const fac = $('sum-facilities');
    fac.innerHTML = '';
    for (const k of FACILITY_KEYS) {
      const f = FACILITIES[k], b = document.createElement('button');
      b.textContent = S.owned[k] ? `${f.icon} ${f.name}（已經有了）` : `${f.icon} ${f.name}：${f.desc} → $${f.cost}`;
      b.disabled = !!S.owned[k] || S.money < f.cost;
      b.onclick = () => sendInput({ t: 'facility', k });
      fac.appendChild(b);
    }
    const hats = $('sum-hats');
    hats.innerHTML = '';
    for (const k of HAT_KEYS) {
      const h = HATS[k];
      if (!h.cost) continue;
      const b = document.createElement('button');
      b.textContent = S.hats[k] ? `${h.icon} ${h.name}（已買，在管理面板戴上）` : `${h.icon} ${h.name} → $${h.cost}`;
      b.disabled = !!S.hats[k] || S.money < h.cost;
      b.onclick = () => sendInput({ t: 'buyhat', k });
      hats.appendChild(b);
    }

    const animals = $('sum-animals');
    animals.innerHTML = '';
    for (const k of ANIMAL_KEYS) {
      const def = ANIMALS[k], a = S.animals[k], good = ITEMS[def.good], b = document.createElement('button');
      const what = `${def.emoji} ${def.name}（產${good.emoji}${good.name}）`;
      b.textContent = a.count >= animalMax(S) ? `${what} 已養 ${a.count} 隻（滿了）`
        : `${what}${a.count ? ` 已養 ${a.count} 隻，再買一隻` : ''} → $${animalCost(S, k)}`;
      b.disabled = a.count >= animalMax(S) || S.money < animalCost(S, k);
      b.onclick = () => sendInput({ t: 'animal', k });
      animals.appendChild(b);
    }

    const decor = $('sum-decor');
    decor.innerHTML = '';
    for (const k of DECOR_KEYS) {
      const d = DECOR[k], b = document.createElement('button');
      b.textContent = S.decor[k] ? `${d.icon} ${d.name}（已擺好）` : `${d.icon} ${d.name}：${d.desc} → $${d.cost}`;
      b.disabled = !!S.decor[k] || S.money < d.cost;
      b.onclick = () => sendInput({ t: 'decor', k });
      decor.appendChild(b);
    }

    renderPlayerList($('sum-list'), online);
    $('btn-next').textContent = me.ready ? '取消準備' : `準備好了，開始第 ${S.day + 1} 天`;
    setText('sum-msg', online.length > 1 ? '所有人都準備好就會進到隔天' : '');
  }

  // ---------- 遊戲中的按鈕 ----------
  // 種子按鈕只放已經解鎖的作物，不是這一季的就反灰
  let seedSig = '';
  function updateSeeds() {
    const season = seasonOf(S.day);
    const keys = CROP_KEYS.filter(k => S.unlocked[k]);
    const sig = keys.join() + '|' + season + '|' + !!S.owned.greenhouse;
    if (sig === seedSig) return;
    seedSig = sig;
    const seeds = $('seeds');
    seeds.innerHTML = '';
    for (const k of keys) {
      const c = CROPS[k], b = document.createElement('button');
      b.dataset.crop = k;
      b.innerHTML = `${c.emoji} <span class="seed-name">${c.name}種子</span> $${c.seed}`;
      b.title = `${c.name}種子（${c.seasons.map(i => SEASONS[i].name).join('、')}天可以種）`;
      // 有溫室的話不合季節的種子也能選（只能種在溫室那排）
      const off = !c.seasons.includes(season);
      b.disabled = off && !S.owned.greenhouse;
      b.classList.toggle('greenhouse-only', off && !!S.owned.greenhouse);
      if (off && S.owned.greenhouse) b.title += '（現在只能種在溫室）';
      b.onclick = () => sendInput({ t: 'seed', c: k });
      seeds.appendChild(b);
    }
  }

  function buildBar() {
    // 下方工具列和結算畫面各放一組升級按鈕
    for (const ups of [$('upgrades'), $('sum-upgrades')]) {
      ups.innerHTML = '';
      for (const k of UPGRADE_KEYS) {
        const b = document.createElement('button');
        b.dataset.upg = k;
        b.onclick = () => sendInput({ t: 'upgrade', k });
        ups.appendChild(b);
      }
    }
  }
  buildBar();

  function updateBar() {
    const me = S.players[meId];
    updateSeeds();
    if (me) for (const b of $('seeds').children) b.classList.toggle('active', b.dataset.crop === me.seed);
    let affordable = false;
    for (const b of $$('[data-upg]')) {
      const u = UPGRADES[b.dataset.upg], lv = S.upg[b.dataset.upg];
      const maxed = lv >= u.costs.length;
      const v = u.values[lv];
      const shown = u.show ? `（${v === Infinity ? '無限' : v}${u.unit || ''}）` : '';
      const level = u.labels ? u.labels[lv] : `Lv${lv + 1}${shown}`;
      setText(b, `${u.icon} ${u.name} ${level}` + (maxed ? (u.labels ? '' : '（滿級）') : ` → 升級 $${u.costs[lv]}`));
      b.disabled = maxed || S.money < u.costs[lv];
      if (!b.disabled) affordable = true;
    }
    // 有買得起的升級時，手機的升級按鈕會亮起來提醒
    $('btn-upg-toggle').classList.toggle('has', affordable);
  }

  let lostSince = 0;
  function updateScreens() {
    $('lobby').classList.toggle('hidden', !!S);
    $('ready').classList.toggle('hidden', !S || S.phase !== 'lobby');
    $('summary').classList.toggle('hidden', !S || S.phase !== 'summary');
    // 客機跟房主斷線超過 1.5 秒就蓋上「房主斷線」畫面
    const lost = mode === 'guest' && S && !(conn && conn.open);
    if (lost && !lostSince) lostSince = performance.now();
    if (!lost) lostSince = 0;
    $('lost').classList.toggle('hidden', !lost || performance.now() - lostSince < 1500);
    if (S && S.phase === 'lobby') updateReady();
    if (S && S.phase === 'summary') updateSummary();
  }

  function showRoomCode() {
    for (const el of $$('.room-code')) setText(el, roomCode);
    $('hud-room').classList.remove('hidden');
  }

  // ---------- 主機 ----------
  function startHost(useSave) {
    mode = 'host';
    S = (useSave && loadSave()) || newState();
    S.hostId = meId;
    addPlayer(S, meId, myName);
    roomCode = store(() => localStorage.getItem(CODE_KEY)) || randomCode();
    openHostPeer(0);
    startHostLoop();
    requestAnimationFrame(frame);
    save();   // 開新農場時馬上蓋掉舊存檔
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    // 有人連著的時候關掉分頁，先跳出確認，免得不小心讓大家斷線
    window.addEventListener('beforeunload', e => {
      save();
      if ([...conns.values()].some(c => c.open)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function openHostPeer(tries) {
    setNet('連線中…', 'warn');
    peer = new Peer(PREFIX + roomCode);
    peer.on('open', () => {
      store(() => localStorage.setItem(CODE_KEY, roomCode));
      showRoomCode();
      setNet('房間已開', 'ok');
    });
    peer.on('connection', onGuestConn);
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        // 上一次的房間可能還沒被伺服器釋放，等一下再試，試不成就換新代碼
        peer.destroy();
        // 多等一下，盡量拿回同一個代碼，大家才能自動接回來
        if (tries < 10) {
          setNet(`等舊房間釋放中…（${tries + 1}/10）`, 'warn');
          setTimeout(() => openHostPeer(tries + 1), 3000);
        } else { roomCode = randomCode(); openHostPeer(0); }
        return;
      }
      console.warn('peer error', err.type, err);
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) setNet('連線中斷，重試中…', 'bad');
    });
  }

  function onGuestConn(c) {
    const meta = c.metadata || {};
    const id = typeof meta.cid === 'string' ? meta.cid.slice(0, 20) : '';
    c.on('open', () => {
      if (!id || id === meId) return c.close();
      const others = onlinePlayers(S).filter(p => p.id !== id);
      if (others.length >= MAX_PLAYERS) { c.send({ t: 'full' }); return setTimeout(() => c.close(), 500); }
      const old = conns.get(id);
      conns.set(id, c);
      if (old) old.close();
      const p = addPlayer(S, id, meta.name);
      if (!p.connected) {
        p.connected = true;
        p.ready = false;
        if (others.some(o => o.color === p.color)) p.color = freeColor(S, p);
      }
      sendSnap();
    });
    c.on('data', d => { if (conns.get(id) === c) applyInput(S, id, d); });
    c.on('close', () => {
      if (conns.get(id) !== c) return;
      conns.delete(id);
      if (S.players[id]) { S.players[id].connected = false; S.players[id].ready = false; }
    });
  }

  function sendSnap() {
    const msg = { t: 'snap', s: S };
    for (const c of conns.values()) if (c.open) c.send(msg);
  }

  function startHostLoop() {
    // 用 setInterval 而不是 requestAnimationFrame，切到別的視窗時遊戲才不會整個停住
    let last = performance.now(), sendAcc = 0, saveAcc = 0;
    setInterval(() => {
      const now = performance.now();
      let dt = Math.min((now - last) / 1000, 5);
      last = now;
      while (dt > 0) {
        const h = Math.min(dt, 0.05);
        step(S, h);
        dt -= h; sendAcc += h; saveAcc += h;
      }
      if (sendAcc >= 0.05) { sendAcc = 0; sendSnap(); }
      if (saveAcc >= 5) { saveAcc = 0; save(); }
    }, 50);
  }

  // 只存農場進度；玩家每次進房間重新加入
  function save() {
    const data = {
      v: 2, day: S.day, t: S.t, money: S.money, served: S.served,
      stats: S.stats, upg: S.upg, plots: S.plots, shelves: S.shelves, machines: S.machines,
      unlocked: S.unlocked, order: S.order,
      rating: S.rating, priceLv: S.priceLv, decor: S.decor, goals: S.goals, ordersDone: S.ordersDone, fxSeq: S.fxSeq,
      animals: S.animals, thievesCaught: S.thievesCaught, owned: S.owned, hats: S.hats,
      giants: S.giants, fishCaught: S.fishCaught, starsServed: S.starsServed, weather: S.weather, weatherNext: S.weatherNext, mv: 2,
      helpers: Object.fromEntries(HELPER_KEYS.map(k => [k, S.helpers[k] ? { off: S.helpers[k].off, carry: S.helpers[k].carry } : null])),
    };
    store(() => localStorage.setItem(SAVE_KEY, JSON.stringify(data)));
  }

  function loadSave() {
    const d = readSave();
    if (!d) return null;
    const s = newState();
    // 跟預設值合併，舊存檔沒有的新東西（加工品、加工機、新升級）會補上
    Object.assign(s, {
      day: d.day, t: d.t, money: d.money, served: d.served || 0,
      plots: s.plots.map((pl, i) => ({ ...pl, ...(d.plots && d.plots[i]), lift: {} })),
      upg: { ...s.upg, ...d.upg },
      unlocked: { ...s.unlocked, ...d.unlocked },
      shelves: { ...s.shelves, ...d.shelves },
      // 舊存檔的加工機記的是原料個數，換算成排了幾份
      machines: s.machines.map((m, i) => {
        const o = d.machines && d.machines[i];
        if (!o) return m;
        const need = Object.values(PRODUCTS[MACHINES[i].product].inputs)[0];
        return { ...o, input: d.mv === 2 ? o.input : Math.min(MACHINE_QUEUE, Math.floor(o.input / need)) };
      }),
      order: d.order || null,
      rating: d.rating ?? s.rating,
      priceLv: d.priceLv ?? s.priceLv,
      decor: d.decor || {},
      goals: d.goals || {},
      ordersDone: d.ordersDone || 0,
      fxSeq: d.fxSeq || 0,
      animals: Object.fromEntries(ANIMAL_KEYS.map(k => [k, { ...s.animals[k], ...(d.animals && d.animals[k]) }])),
      thievesCaught: d.thievesCaught || 0,
      owned: d.owned || {},
      hats: { ...s.hats, ...d.hats },
      giants: d.giants || 0, fishCaught: d.fishCaught || 0, starsServed: d.starsServed || 0,
      weather: d.weather || 'cloudy', weatherNext: d.weatherNext || 'sunny',
    });
    // 幫手（舊存檔只有一個 worker，就是農場幫手）
    const savedHelpers = d.helpers || { farmer: d.worker || null };
    for (const k of HELPER_KEYS) {
      const h = savedHelpers[k];
      s.helpers[k] = h ? Object.assign(newHelper(k), { off: h.off, carry: { ...zeroItems(), ...h.carry } }) : null;
    }
    if (d.stats) s.stats = { ...newStats(), ...d.stats, sold: { ...s.stats.sold, ...d.stats.sold } };
    // 存檔時已經在結算畫面的話，下次直接從隔天開始
    if (s.t >= DAY_LEN) { s.day++; s.t = 0; s.stats = newStats(); s.order = null; s.weather = s.weatherNext; }
    return s;
  }

  // ---------- 加入的人 ----------
  function startGuest(code) {
    mode = 'guest';
    roomCode = code;
    lobbyMsg('連線中…');
    $('btn-host').disabled = $('btn-join').disabled = true;
    peer = new Peer();
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        setNet('找不到房間，重試中…', 'bad');
        if (!S) lobbyMsg(`找不到房間 ${code}，請確認房主已經建立房間（會自動重試）`);
        scheduleRetry();
      } else {
        console.warn('peer error', err.type, err);
      }
    });
    // 手機鎖螢幕或切 App 回來後，馬上重連
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (peer.disconnected) peer.reconnect();
      if (!conn || !conn.open) connectToHost();
    });
    requestAnimationFrame(frame);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connectToHost(); }, 2000);
  }

  function connectToHost() {
    if (conn && conn.open) return;
    if (!peer.open) { scheduleRetry(); return; }
    if (conn) conn.close();
    const c = peer.connect(PREFIX + roomCode, { reliable: true, serialization: 'json', metadata: { cid, name: myName } });
    conn = c;
    const timeout = setTimeout(() => { if (!c.open) { c.close(); scheduleRetry(); } }, 8000);
    c.on('open', () => { clearTimeout(timeout); setNet('已連線', 'ok'); showRoomCode(); });
    c.on('data', d => {
      if (d && d.t === 'snap') onSnap(d.s);
      else if (d && d.t === 'full') { lobbyMsg('房間已滿（最多 4 人）'); conn = null; c.close(); }
    });
    c.on('close', () => {
      clearTimeout(timeout);
      if (conn !== c) return;
      setNet('斷線了，重新連線中…', 'bad');
      scheduleRetry();
    });
  }

  // ---------- 畫面 ----------
  function layoutView() {
    const st = $('stage'), aw = st.clientWidth, ah = st.clientHeight;
    const fit = Math.min(aw / COLS, ah / ROWS);
    // 螢幕太小（例如直式手機）時放大格子填滿高度，改成鏡頭跟著自己走
    const tilePx = fit >= 20 ? fit : Math.max(26, Math.min(ah / ROWS, 40));
    const cw = Math.min(aw, Math.floor(COLS * tilePx)), ch = Math.min(ah, Math.floor(ROWS * tilePx));
    const dpr = Math.min(2, window.devicePixelRatio || 1);   // 3 倍螢幕畫起來太吃力，2 倍就夠清楚
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
    }
    const me = disp['p' + meId] || S.players[meId] || { x: COLS / 2, y: ROWS / 2 };
    view = {
      tilePx, cw, ch, dpr,
      camX: clamp((me.x + 0.5) * tilePx - cw / 2, 0, COLS * tilePx - cw),
      camY: clamp((me.y + 0.5) * tilePx - ch / 2, 0, ROWS * tilePx - ch),
    };
  }

  // ---------- 客機的平順處理 ----------
  function onSnap(s) {
    S = s;
    const pos = {};
    for (const p of Object.values(s.players)) pos['p' + p.id] = [p.x, p.y];
    for (const c of s.customers) pos['c' + c.id] = [c.x, c.y];
    if (s.thief) pos.thief = [s.thief.x, s.thief.y];
    for (const k of HELPER_KEYS) if (s.helpers[k]) pos['h' + k] = [s.helpers[k].x, s.helpers[k].y];
    snaps.push({ at: performance.now(), pos });
    while (snaps.length > 20) snaps.shift();
    reconcile();
  }

  // 自己的預測位置跟主機對一下：差太多就以主機為準，都停下來時慢慢拉回主機的位置
  function reconcile() {
    const me = S.players[meId];
    if (!me) return;
    if (!pred || S.phase !== 'play') { pred = { x: me.x, y: me.y, path: [] }; return; }
    if (Math.hypot(pred.x - me.x, pred.y - me.y) > 2) {
      pred = { x: me.x, y: me.y, path: me.path.map(t => [...t]) };
    } else if (!pred.path.length && !me.path.length) {
      pred.x += (me.x - pred.x) * 0.3;
      pred.y += (me.y - pred.y) * 0.3;
    }
  }

  function updateDisp(dt) {
    for (const key in disp) delete disp[key];
    if (mode !== 'guest' || !snaps.length) return;
    if (pred && S.phase === 'play') moveAlong(pred, upgValue(S, 'speed') * dt);
    const rt = performance.now() - INTERP_DELAY;
    let a = 0;
    while (a < snaps.length - 1 && snaps[a + 1].at <= rt) a++;
    const A = snaps[a], B = snaps[Math.min(a + 1, snaps.length - 1)];
    const f = B.at > A.at ? clamp((rt - A.at) / (B.at - A.at), 0, 1) : 1;
    for (const key in B.pos) {
      const pa = A.pos[key] || B.pos[key], pb = B.pos[key];
      disp[key] = { x: pa[0] + (pb[0] - pa[0]) * f, y: pa[1] + (pb[1] - pa[1]) * f };
    }
    if (pred) disp['p' + meId] = pred;
  }

  let shownMoney = null, moneyTarget = null, moneyFlash = null;
  function updateHud(dt) {
    const h = gameHour(S.t), hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
    const status = h < OPEN_HOUR ? '（準備中）' : h >= CLOSE_HOUR ? '（打烊）' : '';
    const season = SEASONS[seasonOf(S.day)];
    const fest = isFestival(S.day) ? `${season.festIcon}${season.festival} ` : '';
    setText('hud-day', `${season.icon}${season.name}・第 ${S.day} 天 ${pad(hh)}:${pad(mm)}${status}　${fest}${weatherLabel(S, S.weather)}`);
    // 錢的數字會滾動到新的值，增加變綠、減少變紅
    if (shownMoney === null) shownMoney = S.money;
    const moneyEl = $('hud-money');
    if (S.money !== moneyTarget) {
      moneyEl.className = S.money > moneyTarget ? 'up' : 'down';
      moneyTarget = S.money;
      clearTimeout(moneyFlash);
      moneyFlash = setTimeout(() => { moneyEl.className = ''; }, 600);
    }
    shownMoney += (S.money - shownMoney) * Math.min(1, dt * 8);
    if (Math.abs(S.money - shownMoney) < 0.5) shownMoney = S.money;
    setText(moneyEl, `💰 $${Math.round(shownMoney)}`);
    setText('hud-rating', `⭐${S.rating.toFixed(1)}`);

    // 特殊訂單進度：每樣東西 已交/需要
    const o = S.order;
    let orderText = '';
    if (o) {
      const parts = Object.keys(o.need).map(k => `${ITEMS[k].emoji}${Math.min(o.got[k] || 0, o.need[k])}/${o.need[k]}`).join(' ');
      orderText = o.done ? `📋 訂單完成 ✅ +$${o.reward}` : o.failed ? '📋 訂單失敗' : `📋 ${parts} → $${o.reward}`;
    }
    setText('hud-order', orderText);

    const me = S.players[meId];
    if (!me) return;
    const items = itemList(me.carry);
    const water = upgValue(S, 'sprinkler') ? '' : `　💧${me.water}/${upgValue(S, 'can')}`;
    setText('hud-carry', `🎒 ${items || '空'}（${carryTotal(me.carry)}/${carryCap(S)}）${water}`);
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    updateScreens();
    if (S) {
      updateDisp(dt);
      layoutView();
      drawGame(ctx, S, view, meId, disp, tapMark, now / 1000);
      updateHud(dt);
      updateBar();
      updatePanel();
      updateTutorial();
      playNewSounds();
      scheduleMusic();
      if (tapMark && (tapMark.ttl -= dt * 1.5) <= 0) tapMark = null;
    }
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', e => {
    if (!S || S.phase !== 'play') return;
    // 面板開著時點畫面只會把面板收起來，免得角色亂跑
    if (popupOpen()) { setPopup(null); return; }
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left + view.camX) / view.tilePx);
    const y = Math.floor((e.clientY - r.top + view.camY) / view.tilePx);
    tapMark = { x, y, ttl: 1 };
    if (mode === 'guest' && pred) {
      const plan = planTap(pred.x, pred.y, x, y);
      if (plan) pred.path = plan.path;
    }
    sendInput({ t: 'tap', x, y });
  });

  // 給除錯用
  window.__game = {
    get S() { return S; }, get mode() { return mode; }, get conn() { return conn; }, get conns() { return conns; },
    get view() { return view; }, get pred() { return pred; }, meId,
  };
})();
