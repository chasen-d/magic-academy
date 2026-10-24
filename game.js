(() => {
  const content = window.MagicContent;
  const SAVE_KEY = "magic-academy-v1";
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const SPELL = 26;
  const STAFF = 22;
  const ROBE = 40;
  const STEP = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 16 : 150;

  const THEMES = {
    hall: { floorA: "#eadcc6", floorB: "#deceb4", wall: "#4e382c", style: "books" },
    tower: { floorA: "#d5dee6", floorB: "#c5d0da", wall: "#3c4c5c", style: "stone" },
    garden: { floorA: "#d5e4c4", floorB: "#c5d6ae", wall: "#2f4d38", style: "hedge" },
    vault: { floorA: "#e7d4cc", floorB: "#dcc3b8", wall: "#5c3330", style: "brick" },
    gallery: { floorA: "#f3e6cf", floorB: "#e7d4b0", wall: "#6d5642", style: "plaster" },
    clock: { floorA: "#d7deea", floorB: "#c7d0e0", wall: "#2d3c58", style: "clock" },
    star: { floorA: "#e4daf2", floorB: "#d4c8e8", wall: "#342850", style: "star" },
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const view = { tile: 32, ox: 0, oy: 0 };
  const particles = [];
  const floats = [];
  let state;
  let level;
  let player;
  let move = null;
  let battle = null;
  let review = null;
  let ui = "title";
  let hover = null;
  let shake = 0;
  let audioCtx = null;
  let hadSave = false;

  function freshState() {
    return {
      v: 1,
      hp: 100,
      maxHp: 100,
      gold: 0,
      combo: 0,
      floor: 0,
      defeated: [],
      opened: [],
      owned: { robe: false, staff: false },
      book: [],
      endingSeen: false,
      muted: false,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const base = freshState();
      return {
        ...base,
        ...data,
        owned: { ...base.owned, ...(data.owned || {}) },
        defeated: data.defeated || [],
        opened: data.opened || [],
        book: data.book || [],
      };
    } catch {
      return null;
    }
  }

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    hadSave = true;
  }

  function spellPower() {
    return SPELL + (state.owned.staff ? STAFF : 0);
  }

  function log(line) {
    const list = $("log");
    const item = document.createElement("li");
    item.textContent = line;
    list.prepend(item);
    while (list.children.length > 4) list.lastChild.remove();
  }

  let toastTimer = 0;
  function toast(message) {
    const el = $("toast");
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, when, dur, type, gain) {
    if (state.muted) return;
    const ac = ensureAudio();
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ac.currentTime + when);
    amp.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(ac.currentTime + when);
    osc.stop(ac.currentTime + when + dur);
  }

  function sfx(name) {
    if (name === "ok") {
      tone(523, 0, 0.08, "sine", 0.07);
      tone(659, 0.08, 0.1, "sine", 0.07);
      tone(784, 0.16, 0.16, "sine", 0.06);
    } else if (name === "crit") {
      tone(784, 0, 0.08, "triangle", 0.08);
      tone(988, 0.07, 0.1, "triangle", 0.08);
      tone(1318, 0.14, 0.2, "triangle", 0.07);
    } else if (name === "bad") {
      tone(196, 0, 0.16, "square", 0.04);
      tone(146, 0.1, 0.2, "square", 0.04);
    } else if (name === "coin") {
      tone(880, 0, 0.07, "sine", 0.05);
      tone(1174, 0.06, 0.1, "sine", 0.05);
    } else if (name === "step") {
      tone(320, 0, 0.03, "sine", 0.02);
    }
  }

  function buildLevel(index) {
    const def = content.floors[index];
    const rows = def.grid;
    const h = rows.length;
    const w = rows[0].length;
    const tiles = [];
    const entities = [];
    let spawn = { x: 1, y: 1 };
    let slimes = 0;
    let chests = 0;
    for (let y = 0; y < h; y += 1) {
      tiles[y] = [];
      for (let x = 0; x < w; x += 1) {
        const cell = rows[y][x];
        tiles[y][x] = cell === "#" ? 1 : 0;
        if (cell === "@") spawn = { x, y };
        if (cell === "S" || cell === "B") {
          const boss = cell === "B";
          const id = `${def.id}-${boss ? "boss" : `m${slimes}`}`;
          const spec = boss ? def.boss : def.minion;
          const name = boss ? spec.name : spec.names[slimes] || spec.names[0];
          const topics = spec.topics || (spec.topic ? [spec.topic] : []);
          if (!boss) slimes += 1;
          if (state.defeated.includes(id)) continue;
          const maxHp = boss ? Math.min(150, 120 + Math.floor(index / 3) * 4) : 90;
          entities.push({
            id,
            type: "monster",
            x,
            y,
            name,
            topic: topics[0],
            topics,
            kind: spec.kind,
            rank: boss ? "boss" : "minion",
            maxHp,
            hp: maxHp,
            atk: boss ? 16 + Math.min(index, 4) : 12,
            gold: boss ? 60 : 20,
            flash: 0,
          });
        }
        if (cell === "C") {
          const id = `${def.id}-chest-${chests}`;
          chests += 1;
          if (!state.opened.includes(id)) entities.push({ id, type: "chest", x, y, bob: Math.random() * 6 });
        }
        if (cell === "H") entities.push({ id: `${def.id}-shop`, type: "shop", x, y });
        if (cell === "L") entities.push({ id: `${def.id}-lib`, type: "library", x, y });
        if (cell === ">") entities.push({ id: `${def.id}-stairs`, type: "stairs", x, y });
      }
    }
    return { index, def, w, h, tiles, entities, spawn };
  }

  function bossAlive() {
    return level.entities.some((ent) => ent.type === "monster" && ent.rank === "boss");
  }

  function trackOf(floor) {
    return floor.track || "main";
  }

  function previousInTrack(index) {
    const track = trackOf(content.floors[index]);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (trackOf(content.floors[i]) === track) return content.floors[i];
    }
    return null;
  }

  function nextInTrack(index) {
    const track = trackOf(content.floors[index]);
    for (let i = index + 1; i < content.floors.length; i += 1) {
      if (trackOf(content.floors[i]) === track) return i;
    }
    return -1;
  }

  function allClear() {
    return content.floors.every((floor) => state.defeated.includes(`${floor.id}-boss`));
  }

  function floorUnlocked(index) {
    const prev = previousInTrack(index);
    if (!prev) return true;
    return state.defeated.includes(`${prev.id}-boss`);
  }

  function enterFloor(index) {
    state.floor = index;
    level = buildLevel(index);
    player = { x: level.spawn.x, y: level.spawn.y, face: 1 };
    move = null;
    hover = null;
    log(`走进了${level.def.name}`);
    updateHud();
    layout();
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < level.w && y < level.h;
  }

  function entityAt(x, y) {
    return level.entities.find((ent) => ent.x === x && ent.y === y) || null;
  }

  function walkable(x, y) {
    return inBounds(x, y) && level.tiles[y][x] === 0 && !entityAt(x, y);
  }

  function bfs(sx, sy, gx, gy) {
    if (sx === gx && sy === gy) return [];
    const prev = new Map();
    const startKey = `${sx},${sy}`;
    prev.set(startKey, null);
    const queue = [[sx, sy]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (prev.has(key) || !walkable(nx, ny)) continue;
        prev.set(key, `${x},${y}`);
        if (nx === gx && ny === gy) {
          const path = [{ x: nx, y: ny }];
          let cursor = `${x},${y}`;
          while (cursor && cursor !== startKey) {
            const [px, py] = cursor.split(",").map(Number);
            path.push({ x: px, y: py });
            cursor = prev.get(cursor);
          }
          path.reverse();
          return path;
        }
        queue.push([nx, ny]);
      }
    }
    return null;
  }

  function pathToEntity(ent) {
    let best = null;
    for (const [dx, dy] of DIRS) {
      const nx = ent.x + dx;
      const ny = ent.y + dy;
      if (nx === player.x && ny === player.y) return [];
      if (!walkable(nx, ny)) continue;
      const path = bfs(player.x, player.y, nx, ny);
      if (path && (!best || path.length < best.length)) best = path;
    }
    return best;
  }

  function startWalk(path, onDone) {
    if (!path.length) {
      if (onDone) onDone();
      return;
    }
    move = { path, cursor: 0, t: 0, onDone };
  }

  function interact(ent) {
    if (ent.type === "monster") beginBattle(ent);
    else if (ent.type === "chest") openChest(ent);
    else if (ent.type === "shop") openShop();
    else if (ent.type === "library") openLibrary();
    else if (ent.type === "stairs") {
      if (bossAlive()) {
        toast("先打败这一层的守护者，楼梯才会打开");
        return;
      }
      const next = nextInTrack(level.index);
      if (next < 0) {
        if (allClear()) showEnding();
        else toast("这一路走完了。其他科目在「楼层」里。");
        return;
      }
      enterFloor(next);
      save();
    }
  }

  function clickTile(tx, ty) {
    if (ui || move) return;
    if (!inBounds(tx, ty) || level.tiles[ty][tx] === 1) {
      toast("那边是书架，走不过去");
      return;
    }
    const ent = entityAt(tx, ty);
    if (!ent) {
      const path = bfs(player.x, player.y, tx, ty);
      if (!path) toast("这条路被挡住了");
      else startWalk(path);
      return;
    }
    const path = pathToEntity(ent);
    if (!path) {
      toast("先绕到它旁边");
      return;
    }
    startWalk(path, () => interact(ent));
  }

  function step(dx, dy) {
    if (ui || move) return;
    const nx = player.x + dx;
    const ny = player.y + dy;
    player.face = dx || player.face;
    const ent = entityAt(nx, ny);
    if (ent) {
      interact(ent);
      return;
    }
    if (!walkable(nx, ny)) return;
    startWalk([{ x: nx, y: ny }]);
  }

  function pickQuestion(topics, used) {
    const list = Array.isArray(topics) ? topics : [topics];
    let pool = content.questions.filter((q) => list.includes(q.topic) && !used.has(q.id));
    if (!pool.length) pool = content.questions.filter((q) => list.includes(q.topic));
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showOverlay(id) {
    ["title", "battle", "shop", "library", "floors", "ending"].forEach((name) => {
      $(name).hidden = name !== id;
    });
    ui = id;
    const lock = Boolean(id);
    ["btn-shop", "btn-lib", "btn-floors", "btn-reset", "btn-mute"].forEach((name) => {
      $(name).disabled = lock;
    });
  }

  function beginBattle(monster) {
    battle = {
      monster,
      used: new Set(),
      question: null,
      phase: "ask",
      timer: 0,
    };
    $("battle").classList.remove("is-crit", "is-wrong");
    askNext();
    showOverlay("battle");
    log(`遇到了${monster.name}`);
    sfx("step");
  }

  function askNext() {
    const monster = battle.monster;
    battle.question = pickQuestion(monster.topics || [monster.topic], battle.used);
    if (!battle.question) {
      battle.phase = "victory";
      renderBattle();
      return;
    }
    battle.used.add(battle.question.id);
    battle.phase = "ask";
    renderBattle();
  }

  function renderBattle() {
    const monster = battle.monster;
    const topic = content.topics[(battle.question && battle.question.topic) || monster.topic] || { subject: "魔法", name: "试炼" };
    $("battle-kicker").textContent = `${topic.subject} · ${topic.name}`;
    $("battle-title").textContent = monster.name;
    const ratio = Math.max(0, monster.hp / monster.maxHp);
    $("enemy-hp").style.width = `${ratio * 100}%`;
    $("enemy-hp-num").textContent = `${Math.max(0, monster.hp)}/${monster.maxHp}`;
    const options = $("battle-options");
    options.innerHTML = "";
    $("battle-ack").hidden = true;
    $("battle-next").hidden = true;
    $("battle-flee").hidden = battle.phase !== "ask";
    $("battle-feedback").textContent = "";

    if (battle.phase === "victory") {
      $("battle-q").textContent = `击败了${monster.name}，获得 ${monster.gold} 金币。`;
      $("battle-next").hidden = false;
      $("battle-next").textContent = "继续探索";
      return;
    }
    if (battle.phase === "defeat") {
      $("battle-q").textContent = "魔力用完了。导师会把你送回入口，生命也会补好。";
      $("battle-next").hidden = false;
      $("battle-next").textContent = "回到入口";
      return;
    }

    const question = battle.question;
    $("battle-q").textContent = question.q;
    question.options.forEach((text, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = "ABC"[index];
      const label = document.createElement("span");
      label.textContent = text;
      button.append(letter, label);
      button.disabled = battle.phase !== "ask";
      if (battle.phase === "resolve") {
        if (index === question.answer) button.classList.add("correct");
        if (index === battle.picked && index !== question.answer) button.classList.add("wrong");
      }
      button.addEventListener("click", () => chooseAnswer(index));
      options.append(button);
    });
    if (battle.phase === "resolve" && battle.pendingHit) {
      $("battle-feedback").textContent = battle.feedback;
      $("battle-ack").hidden = false;
    } else if (battle.feedback) {
      $("battle-feedback").textContent = battle.feedback;
    }
  }

  function chooseAnswer(index) {
    if (!battle || battle.phase !== "ask") return;
    const question = battle.question;
    battle.phase = "resolve";
    battle.picked = index;
    const monster = battle.monster;
    if (index === question.answer) {
      state.combo += 1;
      const crit = state.combo >= 3;
      let damage = spellPower();
      if (crit && monster.rank === "minion") damage = monster.hp;
      else if (crit) damage = spellPower() * 3;
      monster.hp -= damage;
      monster.flash = 1;
      burst(monster.x, monster.y, crit ? "#f0c27a" : "#e07a3d", crit ? 22 : 12);
      floatText(monster.x, monster.y, crit ? "暴击!" : `-${damage}`, crit ? "#f0c27a" : "#fffaf2");
      battle.feedback = crit
        ? monster.rank === "minion"
          ? "连续答对，火球暴击，小怪被秒杀了！"
          : `连续答对，暴击造成 ${damage} 点伤害。`
        : `答对了，火球造成 ${damage} 点伤害。`;
      battle.pendingHit = false;
      $("battle").classList.toggle("is-crit", crit);
      $("battle").classList.remove("is-wrong");
      sfx(crit ? "crit" : "ok");
      log(battle.feedback);
      renderBattle();
      updateHud();
      save();
      clearTimeout(battle.timer);
      battle.timer = setTimeout(() => {
        if (!battle) return;
        if (monster.hp <= 0) defeatMonster();
        else askNext();
      }, crit ? 900 : 650);
      return;
    }

    state.combo = 0;
    if (!state.book.some((item) => item.id === question.id)) {
      state.book.push({
        id: question.id,
        topic: question.topic,
        q: question.q,
        options: question.options.slice(),
        answer: question.answer,
        explain: question.explain,
      });
    }
    battle.pendingHit = true;
    battle.feedback = `答错了。正确答案是「${question.options[question.answer]}」。${question.explain} 这道题被关进了图书馆。`;
    $("battle").classList.add("is-wrong");
    $("battle").classList.remove("is-crit");
    sfx("bad");
    log("答错了，错题关进了图书馆");
    renderBattle();
    updateHud();
    save();
  }

  function acknowledgeHit() {
    if (!battle || !battle.pendingHit) return;
    const monster = battle.monster;
    state.hp = Math.max(0, state.hp - monster.atk);
    shake = 1;
    floatText(player.x, player.y, `-${monster.atk}`, "#c4543a");
    battle.pendingHit = false;
    updateHud();
    save();
    if (state.hp <= 0) {
      battle.phase = "defeat";
      battle.feedback = "";
      renderBattle();
      return;
    }
    toast(`${monster.name}撞了过来`);
    askNext();
  }

  function defeatMonster() {
    const monster = battle.monster;
    if (battle.phase === "victory") return;
    battle.phase = "victory";
    battle.feedback = "";
    state.gold += monster.gold;
    if (!state.defeated.includes(monster.id)) state.defeated.push(monster.id);
    sfx("coin");
    log(`击败${monster.name}，获得 ${monster.gold} 金币`);
    save();
    updateHud();
    renderBattle();
  }

  function closeBattle(next) {
    clearTimeout(battle && battle.timer);
    const monster = battle && battle.monster;
    battle = null;
    $("battle").classList.remove("is-crit", "is-wrong");
    showOverlay(null);
    if (monster && state.defeated.includes(monster.id)) {
      const index = level.entities.indexOf(monster);
      if (index >= 0) level.entities.splice(index, 1);
    }
    if (next) next();
    updateHud();
  }

  function flee() {
    if (!battle || battle.phase !== "ask") return;
    toast("先撤到安全的地砖上");
    closeBattle();
  }

  function respawn() {
    state.hp = state.maxHp;
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    move = null;
    toast("导师把你送回了入口");
    log("在入口重新站好了");
    save();
    updateHud();
  }

  function openChest(ent) {
    state.gold += 30;
    state.opened.push(ent.id);
    const index = level.entities.indexOf(ent);
    if (index >= 0) level.entities.splice(index, 1);
    burst(ent.x, ent.y, "#f0c27a", 14);
    floatText(ent.x, ent.y, "+30", "#f0c27a");
    sfx("coin");
    log("打开宝箱，获得 30 金币");
    save();
    updateHud();
  }

  function openShop() {
    if (ui && ui !== "shop") return;
    move = null;
    const list = $("shop-list");
    list.innerHTML = "";
    content.shop.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "goods";
      const owned = item.once && state.owned[item.id];
      const poor = state.gold < item.price;
      const full = item.id === "potion" && state.hp >= state.maxHp;
      button.disabled = owned || poor || full;
      const label = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const desc = document.createElement("small");
      desc.textContent = item.desc;
      label.append(name, desc);
      const price = document.createElement("b");
      price.textContent = owned ? "已拥有" : full ? "生命已满" : `${item.price} 金币`;
      button.append(label, price);
      button.addEventListener("click", () => buy(item));
      list.append(button);
    });
    showOverlay("shop");
  }

  function buy(item) {
    if (item.once && state.owned[item.id]) return;
    if (state.gold < item.price) return;
    if (item.id === "potion" && state.hp >= state.maxHp) return;
    state.gold -= item.price;
    if (item.id === "robe") {
      state.owned.robe = true;
      state.maxHp += ROBE;
      state.hp += ROBE;
      log("穿上了学徒法袍");
    } else if (item.id === "staff") {
      state.owned.staff = true;
      log("拿起了火焰法杖");
    } else {
      state.hp = Math.min(state.maxHp, state.hp + 40);
      log("喝下蜂蜜药水");
    }
    sfx("coin");
    save();
    updateHud();
    openShop();
  }

  function openLibrary() {
    if (ui && ui !== "library") return;
    move = null;
    review = null;
    renderLibrary();
    showOverlay("library");
  }

  function renderLibrary() {
    const list = $("lib-list");
    const panel = $("lib-review");
    list.innerHTML = "";
    if (!review) {
      panel.hidden = true;
      list.hidden = false;
      $("lib-close").hidden = false;
      if (!state.book.length) {
        const empty = document.createElement("p");
        empty.textContent = "书架是空的。答错的题目会出现在这里，答对就能解除封印。";
        list.append(empty);
        return;
      }
      state.book.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "goods";
        const topic = content.topics[item.topic];
        const label = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = item.q;
        const desc = document.createElement("small");
        desc.textContent = `${topic.subject} · ${topic.name}`;
        label.append(name, desc);
        button.append(label);
        button.addEventListener("click", () => {
          review = { item, picked: -1, done: false };
          renderLibrary();
        });
        list.append(button);
      });
      return;
    }

    list.hidden = true;
    panel.hidden = false;
    $("lib-close").hidden = true;
    $("lib-q").textContent = review.item.q;
    $("lib-feedback").textContent = review.message || "";
    const options = $("lib-options");
    options.innerHTML = "";
    review.item.options.forEach((text, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.disabled = review.done;
      if (review.done && index === review.item.answer) button.classList.add("correct");
      if (review.done && index === review.picked && index !== review.item.answer) button.classList.add("wrong");
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = "ABC"[index];
      const label = document.createElement("span");
      label.textContent = text;
      button.append(letter, label);
      button.addEventListener("click", () => reviewAnswer(index));
      options.append(button);
    });
  }

  function reviewAnswer(index) {
    if (!review || review.done) return;
    review.picked = index;
    review.done = true;
    const item = review.item;
    if (index === item.answer) {
      state.book = state.book.filter((entry) => entry.id !== item.id);
      state.gold += 15;
      state.combo += 1;
      sfx("ok");
      const hot = state.combo >= 3 ? "下一发火球会暴击。" : "连击还留着。";
      review.message = `封印解除，获得 15 金币。${hot} ${item.explain}`;
      log("在图书馆解开了一道封印");
      toast("封印解除了");
    } else {
      sfx("bad");
      review.message = `还没解开。正确答案是「${item.options[item.answer]}」。${item.explain}`;
    }
    save();
    updateHud();
    renderLibrary();
  }

  function openFloors() {
    if (ui) return;
    move = null;
    const list = $("floor-list");
    list.innerHTML = "";
    let lastTrack = "";
    content.floors.forEach((floor, index) => {
      const track = trackOf(floor);
      if (track !== lastTrack) {
        const label = document.createElement("p");
        label.className = "track-label";
        label.textContent = track === "math" ? "一年级数学" : track === "chinese" ? "一年级语文" : "学院冒险";
        list.append(label);
        lastTrack = track;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "floor-btn";
      const unlocked = floorUnlocked(index);
      const cleared = state.defeated.includes(`${floor.id}-boss`);
      button.disabled = !unlocked;
      const label = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = floor.name;
      const desc = document.createElement("small");
      const points = floor.points && floor.points.length ? floor.points.join("、") : floor.blurb;
      desc.textContent = unlocked ? points : "需要先打败这一路的上一层守护者";
      label.append(name, desc);
      const mark = document.createElement("b");
      mark.textContent = index === level.index ? "所在" : cleared ? "已通过" : unlocked ? "可进入" : "未开启";
      button.append(label, mark);
      button.addEventListener("click", () => {
        showOverlay(null);
        if (index !== level.index) {
          enterFloor(index);
          save();
        }
      });
      list.append(button);
    });
    showOverlay("floors");
  }

  function showEnding() {
    if (!state.endingSeen) {
      state.endingSeen = true;
      save();
    }
    showOverlay("ending");
  }

  function updateHud() {
    $("floor-name").textContent = level ? level.def.name : "";
    $("hp-num").textContent = `${state.hp}/${state.maxHp}`;
    const bar = $("hp-bar");
    bar.style.width = `${(state.hp / state.maxHp) * 100}%`;
    bar.classList.toggle("low", state.hp / state.maxHp < 0.3);
    $("gold").textContent = String(state.gold);
    $("spell").textContent = String(spellPower());
    $("combo").textContent = state.combo >= 3 ? `${state.combo} 暴击` : String(state.combo);
    $("pips").innerHTML = [0, 1, 2].map((i) => `<i class="${state.combo > i ? "on" : ""}"></i>`).join("");
    $("btn-lib").textContent = state.book.length ? `图书馆 ${state.book.length}` : "图书馆";
    $("btn-mute").textContent = state.muted ? "声音关" : "声音开";
  }

  function burst(tx, ty, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.015 + Math.random() * 0.04;
      particles.push({
        x: tx + 0.5,
        y: ty + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
      });
    }
  }

  function floatText(tx, ty, text, color) {
    floats.push({ x: tx + 0.5, y: ty, text, color, life: 1 });
  }

  function playerPos() {
    let tx = player.x;
    let ty = player.y;
    if (move) {
      const target = move.path[move.cursor];
      const fromX = move.cursor === 0 ? player.x : move.path[move.cursor - 1].x;
      const fromY = move.cursor === 0 ? player.y : move.path[move.cursor - 1].y;
      const t = Math.min(1, move.t);
      tx = fromX + (target.x - fromX) * t;
      ty = fromY + (target.y - fromY) * t;
    }
    return { tx, ty };
  }

  function layout() {
    if (!level) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const pad = Math.floor(8 * dpr);
    const availW = Math.max(1, width - pad * 2);
    const availH = Math.max(1, height - pad * 2);
    const fit = Math.max(8, Math.min(Math.floor(availW / level.w), Math.floor(availH / level.h)));
    const minTile = Math.floor(40 * dpr);
    view.pad = pad;
    view.tile = fit < minTile ? minTile : fit;
    view.zoom = view.tile !== fit;
    placeCamera();
  }

  function placeCamera() {
    const mapW = level.w * view.tile;
    const mapH = level.h * view.tile;
    if (!view.zoom) {
      view.ox = Math.floor((canvas.width - mapW) / 2);
      view.oy = Math.floor((canvas.height - mapH) / 2);
      return;
    }
    const { tx, ty } = playerPos();
    const availW = canvas.width - view.pad * 2;
    const availH = canvas.height - view.pad * 2;
    let ox = Math.floor(view.pad + availW / 2 - (tx + 0.5) * view.tile);
    let oy = Math.floor(view.pad + availH / 2 - (ty + 0.5) * view.tile);
    if (mapW <= availW) ox = Math.floor((canvas.width - mapW) / 2);
    else ox = Math.max(Math.floor(view.pad + availW - mapW), Math.min(view.pad, ox));
    if (mapH <= availH) oy = Math.floor((canvas.height - mapH) / 2);
    else oy = Math.max(Math.floor(view.pad + availH - mapH), Math.min(view.pad, oy));
    view.ox = ox;
    view.oy = oy;
  }

  function tileOf(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return {
      x: Math.floor((x - view.ox) / view.tile),
      y: Math.floor((y - view.oy) / view.tile),
    };
  }

  function update(dt) {
    shake *= 0.86;
    if (shake < 0.02) shake = 0;
    if (move) {
      move.t += dt / STEP;
      const target = move.path[move.cursor];
      if (move.t >= 1) {
        player.x = target.x;
        player.y = target.y;
        player.face = Math.sign(target.x - (move.cursor ? move.path[move.cursor - 1].x : player.x)) || player.face;
        move.cursor += 1;
        move.t = 0;
        sfx("step");
        if (move.cursor >= move.path.length) {
          const done = move.onDone;
          move = null;
          if (done) done();
        }
      }
    }
    particles.forEach((dot) => {
      dot.x += dot.vx * dt;
      dot.y += dot.vy * dt;
      dot.life -= dt / 520;
    });
    for (let i = particles.length - 1; i >= 0; i -= 1) if (particles[i].life <= 0) particles.splice(i, 1);
    floats.forEach((item) => {
      item.y -= dt / 900;
      item.life -= dt / 800;
    });
    for (let i = floats.length - 1; i >= 0; i -= 1) if (floats[i].life <= 0) floats.splice(i, 1);
    level.entities.forEach((ent) => {
      if (ent.flash) ent.flash = Math.max(0, ent.flash - dt / 220);
    });
  }

  function drawEntity(ent, time) {
    const s = view.tile;
    const x = view.ox + ent.x * s;
    const y = view.oy + ent.y * s;
    const cx = x + s / 2;
    const bob = Math.sin(time / 280 + (ent.bob || 0)) * s * 0.04;
    if (ent.type === "monster") drawMonster(ent, cx, y + bob, s);
    else if (ent.type === "chest") drawChest(cx, y + bob, s);
    else if (ent.type === "shop") drawShop(x, y, s);
    else if (ent.type === "library") drawLibrary(cx, y, s, time);
    else if (ent.type === "stairs") drawStairs(x, y, s, bossAlive());
  }

  function drawMonster(ent, cx, y, s) {
    const top = y + s * 0.18;
    if (ent.kind === "golem") {
      ctx.fillStyle = "#8d97a3";
      roundRect(ctx, cx - s * 0.28, top + s * 0.08, s * 0.56, s * 0.5, 6);
      ctx.fill();
      ctx.fillStyle = "#d7e0c8";
      ctx.fillRect(cx - s * 0.22, top + s * 0.02, s * 0.44, s * 0.12);
    } else if (ent.kind === "treant") {
      ctx.fillStyle = "#6a4630";
      roundRect(ctx, cx - s * 0.12, top + s * 0.22, s * 0.24, s * 0.4, 4);
      ctx.fill();
      ctx.fillStyle = "#2f7d5a";
      ctx.beginPath();
      ctx.arc(cx, top + s * 0.2, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (ent.kind === "wisp") {
      ctx.fillStyle = "rgba(240, 194, 122, 0.35)";
      ctx.beginPath();
      ctx.arc(cx, top + s * 0.28, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff4d2";
      ctx.beginPath();
      ctx.arc(cx, top + s * 0.28, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = ent.kind === "crown" ? "#8d6bd4" : "#7dce63";
      ctx.beginPath();
      ctx.ellipse(cx, top + s * 0.38, s * 0.28, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.08, top + s * 0.3, s * 0.08, s * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      if (ent.kind === "crown") {
        ctx.fillStyle = "#f0c27a";
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.16, top + s * 0.2);
        ctx.lineTo(cx - s * 0.1, top + s * 0.02);
        ctx.lineTo(cx, top + s * 0.16);
        ctx.lineTo(cx + s * 0.1, top + s * 0.02);
        ctx.lineTo(cx + s * 0.16, top + s * 0.2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#241c16";
    ctx.beginPath();
    ctx.arc(cx - s * 0.08, top + s * 0.34, s * 0.035, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.08, top + s * 0.34, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
    if (ent.flash > 0) {
      ctx.fillStyle = `rgba(255,244,220,${ent.flash * 0.7})`;
      ctx.beginPath();
      ctx.arc(cx, top + s * 0.34, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (ent.hp < ent.maxHp) {
      const w = s * 0.6;
      ctx.fillStyle = "#241c16";
      ctx.fillRect(cx - w / 2, y + s * 0.08, w, 5);
      ctx.fillStyle = "#c4543a";
      ctx.fillRect(cx - w / 2, y + s * 0.08, w * (ent.hp / ent.maxHp), 5);
    }
  }

  function drawChest(cx, y, s) {
    ctx.fillStyle = "#c9842a";
    roundRect(ctx, cx - s * 0.22, y + s * 0.38, s * 0.44, s * 0.28, 4);
    ctx.fill();
    ctx.fillStyle = "#f0c27a";
    ctx.fillRect(cx - s * 0.22, y + s * 0.36, s * 0.44, s * 0.08);
    ctx.fillStyle = "#241c16";
    ctx.fillRect(cx - 2, y + s * 0.46, 4, 6);
  }

  function drawShop(x, y, s) {
    ctx.fillStyle = "#c4543a";
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y + s * 0.42);
    ctx.lineTo(x + s * 0.5, y + s * 0.18);
    ctx.lineTo(x + s * 0.85, y + s * 0.42);
    ctx.fill();
    ctx.fillStyle = "#f7f1e6";
    ctx.fillRect(x + s * 0.28, y + s * 0.42, s * 0.44, s * 0.32);
  }

  function drawLibrary(cx, y, s, time) {
    const glow = 0.25 + Math.sin(time / 300) * 0.1;
    ctx.fillStyle = `rgba(240, 194, 122, ${glow})`;
    ctx.beginPath();
    ctx.arc(cx, y + s * 0.48, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f1e6";
    ctx.fillRect(cx - s * 0.2, y + s * 0.36, s * 0.4, s * 0.24);
    ctx.strokeStyle = "#3f6f8f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.36);
    ctx.lineTo(cx, y + s * 0.6);
    ctx.stroke();
  }

  function drawStairs(x, y, s, locked) {
    ctx.fillStyle = locked ? "#6d645b" : "#f0c27a";
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(x + s * 0.22, y + s * (0.28 + i * 0.14), s * (0.56 - i * 0.08), s * 0.1);
    }
  }

  function drawMage(time) {
    const s = view.tile;
    const { tx, ty } = playerPos();
    if (move) {
      const target = move.path[move.cursor];
      const fromX = move.cursor === 0 ? player.x : move.path[move.cursor - 1].x;
      player.face = Math.sign(target.x - fromX) || player.face;
    }
    const x = view.ox + tx * s;
    const y = view.oy + ty * s;
    const bob = Math.sin(time / 180) * s * 0.03;
    const cx = x + s / 2;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(cx, y + s * 0.78, s * 0.18, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3f6f8f";
    roundRect(ctx, cx - s * 0.16, y + s * 0.4 + bob, s * 0.32, s * 0.32, 8);
    ctx.fill();
    ctx.fillStyle = "#f4d2b4";
    ctx.beginPath();
    ctx.arc(cx, y + s * 0.36 + bob, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = state.owned.staff ? "#e07a3d" : "#c9842a";
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.14, y + s * 0.32 + bob);
    ctx.lineTo(cx, y + s * 0.1 + bob);
    ctx.lineTo(cx + s * 0.14, y + s * 0.32 + bob);
    ctx.fill();
    ctx.fillStyle = "#241c16";
    const eye = player.face >= 0 ? 0.04 : -0.04;
    ctx.beginPath();
    ctx.arc(cx - s * 0.05 + eye, y + s * 0.36 + bob, s * 0.018, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.05 + eye, y + s * 0.36 + bob, s * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(time) {
    if (!level) return;
    placeCamera();
    const ox = (Math.random() - 0.5) * shake * 8;
    const oy = (Math.random() - 0.5) * shake * 8;
    ctx.setTransform(1, 0, 0, 1, ox, oy);
    ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);
    const theme = THEMES[level.def.theme] || THEMES.hall;
    const floorA = theme.floorA;
    const floorB = theme.floorB;
    const wall = theme.wall;
    const s = view.tile;
    for (let y = 0; y < level.h; y += 1) {
      for (let x = 0; x < level.w; x += 1) {
        const px = view.ox + x * s;
        const py = view.oy + y * s;
        if (level.tiles[y][x] === 1) {
          ctx.fillStyle = wall;
          ctx.fillRect(px, py, s, s);
          if (theme.style === "hedge") {
            ctx.fillStyle = "#3f6b49";
            ctx.fillRect(px + 3, py + 4, s - 6, 4);
            ctx.fillRect(px + 5, py + s * 0.45, s - 10, 4);
          } else if (theme.style === "stone" || theme.style === "clock") {
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
          } else if (theme.style === "brick") {
            ctx.fillStyle = "rgba(255,220,200,0.18)";
            ctx.fillRect(px + 2, py + s * 0.28, s - 4, 2);
            ctx.fillRect(px + 2, py + s * 0.62, s - 4, 2);
          } else if (theme.style === "plaster") {
            ctx.fillStyle = "#f7f1e6";
            ctx.fillRect(px + s * 0.28, py + s * 0.22, s * 0.44, s * 0.5);
          } else if (theme.style === "star") {
            ctx.fillStyle = "#f0c27a";
            ctx.fillRect(px + s * 0.45, py + s * 0.2, 2, 2);
            ctx.fillRect(px + s * 0.25, py + s * 0.55, 2, 2);
            ctx.fillRect(px + s * 0.68, py + s * 0.62, 2, 2);
          } else {
            const spines = ["#c4543a", "#c9842a", "#3f6f8f", "#2f7d5a", "#8d6bd4"];
            const count = 4;
            for (let i = 0; i < count; i += 1) {
              ctx.fillStyle = spines[(x + y + i) % spines.length];
              const bw = (s - 8) / count;
              ctx.fillRect(px + 4 + i * bw, py + 5, bw - 2, s - 10);
            }
          }
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? floorA : floorB;
          ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        }
      }
    }
    if (hover && inBounds(hover.x, hover.y) && level.tiles[hover.y][hover.x] === 0) {
      ctx.strokeStyle = "rgba(201,132,42,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(view.ox + hover.x * s + 2, view.oy + hover.y * s + 2, s - 4, s - 4);
    }
    if (move) {
      ctx.fillStyle = "rgba(201,132,42,0.45)";
      move.path.forEach((cell) => {
        ctx.beginPath();
        ctx.arc(view.ox + cell.x * s + s / 2, view.oy + cell.y * s + s / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    level.entities.forEach((ent) => drawEntity(ent, time));
    drawMage(time);
    particles.forEach((dot) => {
      ctx.globalAlpha = Math.max(0, dot.life);
      ctx.fillStyle = dot.color;
      ctx.beginPath();
      ctx.arc(view.ox + dot.x * s, view.oy + dot.y * s, Math.max(2, s * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.font = `${Math.max(12, Math.floor(s * 0.28))}px Palatino, "Songti SC", serif`;
    ctx.textAlign = "center";
    floats.forEach((item) => {
      ctx.globalAlpha = Math.max(0, item.life);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, view.ox + item.x * s, view.oy + item.y * s);
      ctx.globalAlpha = 1;
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
  }

  function boot() {
    hadSave = Boolean(localStorage.getItem(SAVE_KEY));
    state = loadState() || freshState();
    enterFloor(state.floor);
    $("log").innerHTML = "";
    if (hadSave) {
      $("start-btn").textContent = "继续冒险";
      $("fresh-btn").hidden = false;
    }
    showOverlay("title");
    updateHud();
    layout();

    $("start-btn").addEventListener("click", () => {
      ensureAudio();
      showOverlay(null);
      save();
      toast("点地砖走路，点怪物开始答题");
      if (allClear() && !state.endingSeen) showEnding();
    });
    $("fresh-btn").addEventListener("click", () => {
      localStorage.removeItem(SAVE_KEY);
      state = freshState();
      hadSave = false;
      $("log").innerHTML = "";
      enterFloor(0);
      ensureAudio();
      showOverlay(null);
      save();
      toast("新的学期开始了");
    });
    $("btn-shop").addEventListener("click", openShop);
    $("btn-lib").addEventListener("click", openLibrary);
    $("btn-floors").addEventListener("click", openFloors);
    $("btn-mute").addEventListener("click", () => {
      state.muted = !state.muted;
      if (!state.muted) ensureAudio();
      save();
      updateHud();
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("重新开始会清空金币、装备和楼层进度。")) return;
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });
    $("shop-close").addEventListener("click", () => showOverlay(null));
    $("lib-close").addEventListener("click", () => showOverlay(null));
    $("lib-back").addEventListener("click", () => {
      review = null;
      renderLibrary();
    });
    $("floors-close").addEventListener("click", () => showOverlay(null));
    $("ending-close").addEventListener("click", () => showOverlay(null));
    $("battle-flee").addEventListener("click", flee);
    $("battle-ack").addEventListener("click", acknowledgeHit);
    $("battle-next").addEventListener("click", () => {
      if (!battle) return;
      if (battle.phase === "defeat") {
        closeBattle(respawn);
        return;
      }
      const cleared = battle.monster.rank === "boss" && allClear();
      closeBattle(() => {
        if (cleared) showEnding();
      });
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (ui) return;
      const tile = tileOf(event);
      clickTile(tile.x, tile.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      hover = tileOf(event);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow")) event.preventDefault();
      if (event.key === "Escape") {
        if (ui === "shop" || ui === "library" || ui === "floors" || ui === "ending") showOverlay(null);
        else if (ui === "battle") flee();
        return;
      }
      if (ui) return;
      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "w") step(0, -1);
      else if (key === "arrowleft" || key === "a") step(-1, 0);
      else if (key === "arrowdown" || key === "s") step(0, 1);
      else if (key === "arrowright" || key === "d") step(1, 0);
    });
    window.addEventListener("resize", layout);
    if (window.ResizeObserver) new ResizeObserver(layout).observe(canvas.parentElement);

    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(34, now - last);
      last = now;
      update(dt);
      draw(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  boot();
})();
