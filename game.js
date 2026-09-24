"use strict";

// ===== 설정 =====
const SAVE_KEY = "cat-game-save-v1";
const STAT_KEYS = ["hunger", "happiness", "energy", "cleanliness", "health"];
const MAX_OFFLINE_MINUTES = 12 * 60;
const OFFLINE_SPEED = 0.2; // 게임을 끈 동안은 시간이 5배 느리게 흐름
const VET_COST = 15;

// 분당 스탯 변화량
const DECAY_PER_MIN = { hunger: 1.5, happiness: 1.0, energy: 0.8, cleanliness: 0.7 };
const SLEEP_ENERGY_PER_MIN = 6;

const STAGES = [
  { xp: 0, name: "아기 고양이", scale: 0.7 },
  { xp: 120, name: "꼬마 고양이", scale: 0.85 },
  { xp: 350, name: "어른 고양이", scale: 1.0 },
  { xp: 800, name: "대장 고양이", scale: 1.08 },
];

const COLORS = {
  orange: { fur: "#f4a261", dark: "#d98a4c", belly: "#fde2c8" },
  gray: { fur: "#9aa5b1", dark: "#6f7a86", belly: "#dfe4ea" },
  black: { fur: "#3d3d3d", dark: "#222222", belly: "#6a6a6a" },
  white: { fur: "#f5f0e8", dark: "#d8cfc2", belly: "#ffffff" },
};

const SHOP_ITEMS = {
  tuna: { name: "🐟 참치캔", price: 12, desc: "포만감 +40, 행복 +10", effect: { hunger: 40, happiness: 10 } },
  churu: { name: "🍬 츄르", price: 8, desc: "행복 +25, 포만감 +10", effect: { happiness: 25, hunger: 10 } },
  catnip: { name: "🌿 캣닢", price: 18, desc: "행복 +40, 에너지 +20", effect: { happiness: 40, energy: 20 } },
  vitamin: { name: "💊 영양제", price: 25, desc: "건강 +30", effect: { health: 30 } },
};

// ===== 상태 =====
let state = null;
let petCooldownUntil = 0;
let speechTimer = null;
let animTimer = null;

function newState(name, color) {
  const now = Date.now();
  return {
    name,
    color,
    stats: { hunger: 70, happiness: 70, energy: 80, cleanliness: 80, health: 100 },
    xp: 0,
    coins: 20,
    inventory: {},
    sleeping: false,
    bornAt: now,
    lastTick: now,
    log: [],
  };
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* 저장 실패해도 게임은 계속 */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ===== 유틸 =====
const $ = (sel) => document.querySelector(sel);
const clamp = (v) => Math.max(0, Math.min(100, v));

function changeStats(delta) {
  for (const [k, v] of Object.entries(delta)) {
    state.stats[k] = clamp(state.stats[k] + v);
  }
}

function currentStage() {
  let stage = STAGES[0];
  for (const s of STAGES) if (state.xp >= s.xp) stage = s;
  return stage;
}

function gainXp(amount) {
  const before = currentStage();
  state.xp += amount;
  const after = currentStage();
  if (after !== before) {
    addLog(`🎉 ${state.name}(이)가 ${after.name}(으)로 성장했어요!`);
    say("나 좀 컸다냥!");
    burst("🎉", 5);
    state.coins += 20;
  }
}

function addLog(msg) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 30);
  renderLog();
}

// ===== 시간 흐름 =====
function simulate(minutes) {
  const s = state.stats;
  if (state.sleeping) {
    s.energy = clamp(s.energy + SLEEP_ENERGY_PER_MIN * minutes);
    // 자는 동안은 천천히 배고파지고 지저분해짐
    s.hunger = clamp(s.hunger - DECAY_PER_MIN.hunger * 0.5 * minutes);
    s.cleanliness = clamp(s.cleanliness - DECAY_PER_MIN.cleanliness * 0.5 * minutes);
  } else {
    for (const [k, rate] of Object.entries(DECAY_PER_MIN)) {
      s[k] = clamp(s[k] - rate * minutes);
    }
  }

  // 건강: 돌봄이 부족하면 나빠지고, 잘 돌보면 회복
  const neglected = ["hunger", "cleanliness", "happiness"].filter((k) => s[k] < 20).length;
  if (neglected > 0) {
    s.health = clamp(s.health - 1.2 * neglected * minutes);
  } else if (s.hunger > 50 && s.cleanliness > 50) {
    s.health = clamp(s.health + 0.4 * minutes);
  }

  if (state.sleeping && s.energy >= 100) {
    state.sleeping = false;
    addLog(`☀️ ${state.name}(이)가 푹 자고 일어났어요.`);
  }
}

function tick() {
  const now = Date.now();
  const minutes = Math.min((now - state.lastTick) / 60000, MAX_OFFLINE_MINUTES);
  state.lastTick = now;
  simulate(minutes);
  render();
  save();
}

// ===== 행동 =====
const actions = {
  feed() {
    if (state.stats.hunger >= 95) return say("배불러서 더는 못 먹겠다냥…");
    changeStats({ hunger: 25, happiness: 3 });
    gainXp(5);
    addLog(`🍗 ${state.name}에게 사료를 줬어요.`);
    say(pick(["냠냠!", "맛있다냥!", "사료 최고!"]));
    burst("🍗");
    animate("bounce");
  },

  play() {
    if (state.stats.energy < 15) return say("너무 피곤하다냥… 💤");
    if (state.stats.hunger < 10) return say("배고파서 못 놀겠다냥…");
    changeStats({ happiness: 20, energy: -15, hunger: -5, cleanliness: -6 });
    state.coins += 3;
    gainXp(10);
    addLog(`🧶 ${state.name}(와)과 털실로 놀았어요. (+3🪙)`);
    say(pick(["신난다냥!", "한 번 더!", "잡았다!"]));
    burst("🧶");
    animate("bounce");
  },

  pet() {
    const now = Date.now();
    if (now < petCooldownUntil) return;
    petCooldownUntil = now + 1500;
    if (state.stats.happiness < 25 && Math.random() < 0.4) {
      addLog(`😾 ${state.name}(이)가 기분이 안 좋아서 손을 피했어요.`);
      say("지금은 만지지 마라냥!");
      animate("shake");
      return;
    }
    changeStats({ happiness: 6 });
    state.coins += 1;
    gainXp(2);
    say(pick(["골골골…", "거기 좋다냥~", "더 쓰다듬어라냥"]));
    burst("💕");
  },

  sleep() {
    state.sleeping = !state.sleeping;
    if (state.sleeping) {
      addLog(`💤 ${state.name}(이)가 잠들었어요.`);
      say("잘 자라냥… zzZ");
    } else {
      addLog(`☀️ ${state.name}(을)를 깨웠어요.`);
      changeStats({ happiness: state.stats.energy < 60 ? -8 : 0 });
      say(state.stats.energy < 60 ? "아직 졸린데…" : "잘 잤다냥!");
    }
  },

  wash() {
    if (state.stats.cleanliness >= 90) return say("이미 깨끗하다냥!");
    changeStats({ cleanliness: 100, happiness: -10 });
    gainXp(5);
    addLog(`🛁 ${state.name}(을)를 씻겼어요. 깨끗해졌지만 조금 삐졌어요.`);
    say(pick(["물 싫다냥!!", "으앙 젖었다냥…"]));
    burst("🫧", 4);
    animate("shake");
  },

  vet() {
    if (state.stats.health >= 90) return say("나 건강하다냥!");
    if (state.coins < VET_COST) return say(`병원비 ${VET_COST}🪙가 부족하다냥… (쓰다듬어서 모아보자)`);
    state.coins -= VET_COST;
    changeStats({ health: 100, happiness: -5 });
    addLog(`🏥 병원에서 진료를 받았어요. (-${VET_COST}🪙)`);
    say("주사 무서웠다냥…");
    burst("🩹");
  },

  shop() {
    openShop();
  },

  minigame() {
    if (state.stats.energy < 10) return say("너무 피곤하다냥… 💤");
    startMinigame();
  },
};

function doAction(name) {
  if (state.sleeping && name !== "sleep" && name !== "shop") {
    return say("쿨쿨… (자는 중이에요. 먼저 깨워주세요)");
  }
  tick();
  actions[name]();
  render();
  save();
}

// ===== 상점 =====
function openShop() {
  renderShop();
  $("#shop-modal").classList.remove("hidden");
}

function renderShop() {
  const list = $("#shop-list");
  list.innerHTML = "";
  for (const [id, item] of Object.entries(SHOP_ITEMS)) {
    const li = document.createElement("li");
    li.innerHTML = `<div>${item.name}<small>${item.desc}</small></div>`;
    const btn = document.createElement("button");
    btn.textContent = `${item.price}🪙 구매`;
    btn.disabled = state.coins < item.price;
    btn.onclick = () => {
      if (state.coins < item.price) return;
      state.coins -= item.price;
      state.inventory[id] = (state.inventory[id] || 0) + 1;
      addLog(`🛒 ${item.name}(을)를 샀어요.`);
      renderShop();
      render();
      save();
    };
    li.appendChild(btn);
    list.appendChild(li);
  }

  const inv = $("#inventory");
  inv.innerHTML = "";
  const owned = Object.entries(state.inventory).filter(([, n]) => n > 0);
  if (owned.length === 0) {
    inv.innerHTML = `<li class="muted">비어 있어요</li>`;
  }
  for (const [id, count] of owned) {
    const item = SHOP_ITEMS[id];
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.name} × ${count}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "주기";
    btn.disabled = state.sleeping;
    btn.onclick = () => useItem(id);
    li.appendChild(btn);
    inv.appendChild(li);
  }
}

function useItem(id) {
  const item = SHOP_ITEMS[id];
  if (!state.inventory[id]) return;
  state.inventory[id] -= 1;
  changeStats(item.effect);
  gainXp(8);
  addLog(`🎁 ${state.name}에게 ${item.name}(을)를 줬어요.`);
  say(pick(["최고의 선물이다냥!", "사랑한다냥!", "이거 좋아!"]));
  burst("✨", 4);
  animate("bounce");
  renderShop();
  render();
  save();
}

// ===== 미니게임 =====
let mg = null;

function startMinigame() {
  const area = $("#mg-area");
  area.innerHTML = "";
  $("#mg-close").classList.add("hidden");
  $("#minigame-modal").classList.remove("hidden");
  mg = { score: 0, timeLeft: 10 };
  $("#mg-score").textContent = "0";
  $("#mg-time").textContent = "10";

  mg.spawner = setInterval(spawnFish, 650);
  mg.timer = setInterval(() => {
    mg.timeLeft -= 1;
    $("#mg-time").textContent = mg.timeLeft;
    if (mg.timeLeft <= 0) endMinigame();
  }, 1000);
  spawnFish();
}

function spawnFish() {
  const area = $("#mg-area");
  const fish = document.createElement("div");
  fish.className = "fish";
  const golden = Math.random() < 0.12;
  fish.textContent = golden ? "🐠" : "🐟";
  fish.style.left = `${5 + Math.random() * 80}%`;
  fish.style.top = `${5 + Math.random() * 75}%`;
  fish.addEventListener("pointerdown", () => {
    mg.score += golden ? 3 : 1;
    $("#mg-score").textContent = mg.score;
    fish.remove();
  });
  area.appendChild(fish);
  setTimeout(() => fish.remove(), 1100);
}

function endMinigame() {
  clearInterval(mg.spawner);
  clearInterval(mg.timer);
  const area = $("#mg-area");
  area.querySelectorAll(".fish").forEach((f) => f.remove());
  const coins = mg.score * 2;
  const result = document.createElement("div");
  result.className = "mg-result";
  result.innerHTML = `<div>🎣 ${mg.score}점!</div><div>+${coins}🪙</div>`;
  area.appendChild(result);
  $("#mg-close").classList.remove("hidden");

  tick();
  state.coins += coins;
  changeStats({ energy: -10, happiness: 10 + Math.min(mg.score, 15), hunger: -5 });
  gainXp(5 + mg.score);
  addLog(`🐟 생선 잡기에서 ${mg.score}점! (+${coins}🪙)`);
  mg = null;
  render();
  save();
}

// ===== 고양이 그리기 =====
function mood() {
  const s = state.stats;
  if (state.sleeping) return "sleep";
  if (s.health < 30) return "sick";
  if (Math.min(s.hunger, s.happiness, s.cleanliness) < 25) return "sad";
  if (s.energy < 20) return "tired";
  if (s.happiness >= 70) return "happy";
  return "normal";
}

function catSvg(colorKey, m) {
  const c = COLORS[colorKey] || COLORS.orange;
  const eyeColor = colorKey === "black" ? "#f7d154" : "#3b2f2a";

  let eyes;
  switch (m) {
    case "sleep":
    case "tired":
      eyes = `<path d="M78 88 q8 6 16 0 M106 88 q8 6 16 0" stroke="#3b2f2a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      break;
    case "happy":
      eyes = `<path d="M78 90 q8 -10 16 0 M106 90 q8 -10 16 0" stroke="#3b2f2a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      break;
    case "sad":
    case "sick":
      eyes = `<circle cx="86" cy="88" r="6" fill="${eyeColor}"/><circle cx="114" cy="88" r="6" fill="${eyeColor}"/>
              <path d="M76 78 l14 4 M124 78 l-14 4" stroke="#3b2f2a" stroke-width="2.5" stroke-linecap="round"/>`;
      break;
    default:
      eyes = `<circle cx="86" cy="88" r="7" fill="${eyeColor}"/><circle cx="114" cy="88" r="7" fill="${eyeColor}"/>
              <circle cx="88" cy="85" r="2.2" fill="#fff"/><circle cx="116" cy="85" r="2.2" fill="#fff"/>`;
  }

  const mouth =
    m === "sad" || m === "sick"
      ? `<path d="M92 108 q8 -6 16 0" stroke="#3b2f2a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      : `<path d="M92 104 q4 5 8 0 q4 5 8 0" stroke="#3b2f2a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;

  const extras = [];
  if (m === "sleep") extras.push(`<text x="140" y="40" font-size="20" fill="#6c7bd9">z Z</text>`);
  if (m === "sick") extras.push(`<text x="130" y="60" font-size="18">🤒</text>`);
  if (m === "happy" || m === "normal") {
    extras.push(`<ellipse cx="74" cy="100" rx="7" ry="4" fill="#ff9aa8" opacity="0.6"/>
                 <ellipse cx="126" cy="100" rx="7" ry="4" fill="#ff9aa8" opacity="0.6"/>`);
  }
  if (state.stats.cleanliness < 30) {
    extras.push(`<circle cx="70" cy="150" r="5" fill="#8b6b4a" opacity="0.6"/>
                 <circle cx="125" cy="165" r="4" fill="#8b6b4a" opacity="0.6"/>`);
  }

  return `
  <svg viewBox="0 0 200 200" width="200" height="200">
    <path class="tail" d="M150 160 q40 -10 30 -60" stroke="${c.dark}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="155" rx="55" ry="40" fill="${c.fur}"/>
    <ellipse cx="100" cy="162" rx="30" ry="25" fill="${c.belly}"/>
    <ellipse cx="72" cy="190" rx="14" ry="8" fill="${c.dark}"/>
    <ellipse cx="128" cy="190" rx="14" ry="8" fill="${c.dark}"/>
    <path d="M55 70 L62 25 L92 55 Z" fill="${c.fur}"/>
    <path d="M145 70 L138 25 L108 55 Z" fill="${c.fur}"/>
    <path d="M63 60 L66 38 L82 54 Z" fill="#ffb3c1"/>
    <path d="M137 60 L134 38 L118 54 Z" fill="#ffb3c1"/>
    <circle cx="100" cy="92" r="45" fill="${c.fur}"/>
    ${eyes}
    <path d="M96 98 L104 98 L100 103 Z" fill="#ff8fa3"/>
    ${mouth}
    <path d="M60 98 l-22 -4 M60 104 l-22 2 M140 98 l22 -4 M140 104 l22 2" stroke="${c.dark}" stroke-width="1.5" stroke-linecap="round"/>
    ${extras.join("")}
  </svg>`;
}

// ===== 렌더 =====
function render() {
  const stage = currentStage();
  $("#cat-name").textContent = state.name;
  $("#cat-stage").textContent = stage.name;
  $("#coins").textContent = state.coins;

  const days = Math.floor((Date.now() - state.bornAt) / 86400000);
  $("#cat-age").textContent = `함께한 지 ${days + 1}일째`;

  for (const k of STAT_KEYS) {
    const v = state.stats[k];
    const el = $(`#bar-${k}`);
    el.style.width = `${v}%`;
    el.className = v < 25 ? "low" : v < 50 ? "mid" : "";
  }

  const next = STAGES.find((s) => s.xp > state.xp);
  const prev = stage.xp;
  $("#bar-xp").style.width = next ? `${((state.xp - prev) / (next.xp - prev)) * 100}%` : "100%";

  const m = mood();
  const catEl = $("#cat");
  if (catEl.dataset.mood !== m || catEl.dataset.stage !== stage.name) {
    catEl.innerHTML = catSvg(state.color, m);
    catEl.dataset.mood = m;
    catEl.dataset.stage = stage.name;
  }
  catEl.style.scale = stage.scale;
  if (!catEl.classList.contains("bounce") && !catEl.classList.contains("shake")) {
    catEl.classList.toggle("idle", !state.sleeping);
  }

  $("#room").classList.toggle("night", state.sleeping);
  document.querySelector('[data-action="sleep"] span').textContent = state.sleeping ? "깨우기" : "재우기";
}

function renderLog() {
  const ul = $("#log");
  ul.innerHTML = "";
  for (const msg of state.log) {
    const li = document.createElement("li");
    li.textContent = msg;
    ul.appendChild(li);
  }
}

// ===== 연출 =====
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function say(text) {
  const el = $("#speech");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => el.classList.add("hidden"), 2500);
}

function burst(emoji, count = 3) {
  const fx = $("#effects");
  for (let i = 0; i < count; i++) {
    const span = document.createElement("span");
    span.className = "float-fx";
    span.textContent = emoji;
    span.style.left = `${35 + Math.random() * 30}%`;
    span.style.top = `${40 + Math.random() * 25}%`;
    span.style.animationDelay = `${i * 0.12}s`;
    fx.appendChild(span);
    setTimeout(() => span.remove(), 1500 + i * 120);
  }
}

function animate(cls) {
  const cat = $("#cat");
  cat.classList.remove("idle", "bounce", "shake");
  void cat.offsetWidth; // 애니메이션 재시작
  cat.classList.add(cls);
  clearTimeout(animTimer);
  animTimer = setTimeout(() => {
    cat.classList.remove(cls);
    if (!state.sleeping) cat.classList.add("idle");
  }, 1000);
}

// 가끔 고양이가 원하는 것을 말함
function randomChatter() {
  if (!state || state.sleeping || mg) return;
  const s = state.stats;
  const needs = [];
  if (s.hunger < 40) needs.push("배고프다냥…🍗");
  if (s.happiness < 40) needs.push("심심하다냥… 놀아줘!");
  if (s.energy < 30) needs.push("졸리다냥… 💤");
  if (s.cleanliness < 35) needs.push("몸이 근질근질하다냥");
  if (s.health < 50) needs.push("몸이 안 좋다냥… 🏥");
  const idle = ["냐옹~", "오늘 날씨 좋다냥", "집사 뭐해?", "꾹꾹이 하고 싶다냥"];
  say(needs.length ? pick(needs) : pick(idle));
}

// ===== 시작 =====
function startGame() {
  $("#start-screen").classList.add("hidden");
  $("#game-screen").classList.remove("hidden");
  tick();
  renderLog();
  setInterval(tick, 1000);
  setInterval(randomChatter, 15000);
}

function init() {
  // 색상 선택
  let selectedColor = "orange";
  document.querySelectorAll(".color-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".color-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedColor = btn.dataset.color;
    });
  });

  $("#start-btn").addEventListener("click", () => {
    const name = $("#name-input").value.trim() || "나비";
    state = newState(name, selectedColor);
    addLog(`🏠 ${name}(이)가 우리 집에 왔어요!`);
    startGame();
    say("안녕 집사! 잘 부탁한다냥!");
    save();
  });
  $("#name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#start-btn").click();
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => doAction(btn.dataset.action));
  });
  $("#cat").addEventListener("click", () => doAction("pet"));

  document.querySelectorAll(".close-modal").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".modal").classList.add("hidden"));
  });

  // 브라우저 confirm 대신 두 번 눌러서 확인
  let resetArmed = null;
  $("#reset-btn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (!resetArmed) {
      btn.textContent = "정말 초기화할까요? 한 번 더 누르면 기록이 사라져요";
      resetArmed = setTimeout(() => {
        btn.textContent = "처음부터 다시하기";
        resetArmed = null;
      }, 4000);
      return;
    }
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (err) {
      /* 저장소를 쓸 수 없어도 새로 시작 */
    }
    location.reload();
  });

  const saved = load();
  if (saved) {
    state = saved;
    const awayMin = Math.min((Date.now() - state.lastTick) / 60000, MAX_OFFLINE_MINUTES);
    simulate(awayMin * OFFLINE_SPEED);
    state.lastTick = Date.now();
    startGame();
    if (awayMin > 5) {
      addLog(`👋 ${Math.round(awayMin)}분 만에 돌아왔어요.`);
      say("어디 갔었냥! 보고 싶었다냥!");
    }
  }
}

init();
