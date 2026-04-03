const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const speedEl = document.getElementById("speed");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const restartBtn = document.getElementById("restartBtn");
const padButtons = document.querySelectorAll(".pad-btn");
const toast = document.getElementById("toast");

const authStatus = document.getElementById("authStatus");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authFormWrap = document.getElementById("authFormWrap");
const leaderboardEl = document.getElementById("leaderboard");
const refreshRankBtn = document.getElementById("refreshRankBtn");

const gridSize = 28;
const cell = canvas.width / gridSize;

const state = {
  snake: [],
  dir: { x: 1, y: 0 },
  nextDir: { x: 1, y: 0 },
  food: { x: 10, y: 10 },
  score: 0,
  best: Number(localStorage.getItem("neon_snake_best") || 0),
  running: false,
  paused: false,
  dead: false,
  moveInterval: 140,
  stepAcc: 0,
  fxTimer: 0,
  scoreSubmitted: false,
  user: null,
};

bestEl.textContent = String(state.best);

function setToast(message, ms = 2400) {
  toast.textContent = message;
  if (!ms) return;
  const current = message;
  setTimeout(() => {
    if (toast.textContent === current) toast.textContent = "";
  }, ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let body = {};
  try {
    body = await res.json();
  } catch (_e) {
    body = {};
  }

  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

function updateAuthUI() {
  if (state.user) {
    authStatus.textContent = `Logged in as ${state.user.username}`;
    authFormWrap.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
  } else {
    authStatus.textContent = "Not logged in";
    authFormWrap.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
  }
}

function renderLeaderboard(items) {
  leaderboardEl.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "No scores yet";
    leaderboardEl.appendChild(li);
    return;
  }

  items.forEach((entry) => {
    const li = document.createElement("li");
    const u = document.createElement("span");
    const s = document.createElement("span");
    u.className = "rank-user";
    s.className = "rank-score";
    u.textContent = `${entry.username}`;
    s.textContent = `${entry.score}`;
    li.appendChild(u);
    li.appendChild(s);
    leaderboardEl.appendChild(li);
  });
}

async function refreshLeaderboard() {
  try {
    const data = await api("/api/leaderboard");
    renderLeaderboard(data.items || []);
  } catch (err) {
    setToast(`Leaderboard error: ${err.message}`, 3200);
  }
}

async function checkSession() {
  try {
    const data = await api("/api/me");
    state.user = data.user || null;
  } catch (_err) {
    state.user = null;
  }
  updateAuthUI();
}

async function handleRegister() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (username.length < 3 || password.length < 6) {
    setToast("Username >= 3 chars, password >= 6 chars");
    return;
  }
  try {
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.user = data.user;
    updateAuthUI();
    setToast("Registered and logged in");
    passwordInput.value = "";
    await refreshLeaderboard();
  } catch (err) {
    setToast(err.message, 3200);
  }
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    setToast("Please enter username and password");
    return;
  }
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.user = data.user;
    updateAuthUI();
    setToast("Login successful");
    passwordInput.value = "";
    await refreshLeaderboard();
  } catch (err) {
    setToast(err.message, 3200);
  }
}

async function handleLogout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch (_err) {
  }
  state.user = null;
  updateAuthUI();
  setToast("Logged out");
}

async function submitScoreIfNeeded() {
  if (state.scoreSubmitted || state.score <= 0 || !state.user) return;
  try {
    await api("/api/score", {
      method: "POST",
      body: JSON.stringify({ score: state.score }),
    });
    state.scoreSubmitted = true;
    setToast("Score uploaded to leaderboard");
    await refreshLeaderboard();
  } catch (err) {
    setToast(`Score submit failed: ${err.message}`, 3200);
  }
}

function resetGame() {
  const center = Math.floor(gridSize / 2);
  state.snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];
  state.dir = { x: 1, y: 0 };
  state.nextDir = { x: 1, y: 0 };
  state.score = 0;
  state.dead = false;
  state.paused = false;
  state.moveInterval = 140;
  state.stepAcc = 0;
  state.fxTimer = 0;
  state.scoreSubmitted = false;
  spawnFood();
  updateStats();
}

function spawnFood() {
  let pick;
  do {
    pick = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
  } while (state.snake.some((s) => s.x === pick.x && s.y === pick.y));
  state.food = pick;
}

function setDirection(x, y) {
  if (x === -state.dir.x && y === -state.dir.y) return;
  state.nextDir = { x, y };
}

function updateStats() {
  scoreEl.textContent = String(state.score);
  speedEl.textContent = `${(140 / state.moveInterval).toFixed(1)}x`;
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("neon_snake_best", String(state.best));
    bestEl.textContent = String(state.best);
  }
}

function gameStep() {
  if (!state.running || state.paused || state.dead) return;

  state.dir = state.nextDir;
  const head = state.snake[0];
  const next = {
    x: head.x + state.dir.x,
    y: head.y + state.dir.y,
  };

  const hitWall = next.x < 0 || next.y < 0 || next.x >= gridSize || next.y >= gridSize;
  const hitSelf = state.snake.some((s) => s.x === next.x && s.y === next.y);
  if (hitWall || hitSelf) {
    state.dead = true;
    state.running = false;
    showOverlay("Game Over", "Press Restart to challenge again.");
    if (!state.user) {
      setToast("Login to upload your score to leaderboard", 3000);
    }
    submitScoreIfNeeded();
    return;
  }

  state.snake.unshift(next);

  if (next.x === state.food.x && next.y === state.food.y) {
    state.score += 10;
    state.fxTimer = 260;
    state.moveInterval = Math.max(78, state.moveInterval - 2);
    spawnFood();
  } else {
    state.snake.pop();
  }

  updateStats();
}

function drawGrid(time) {
  const shift = (time * 0.03) % cell;
  ctx.strokeStyle = "rgba(108, 183, 220, 0.12)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= gridSize; i++) {
    const p = i * cell + shift;
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(canvas.width, p);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, canvas.height);
    ctx.stroke();
  }
}

function drawFood(time) {
  const pulse = 0.75 + 0.25 * Math.sin(time * 0.01);
  const x = state.food.x * cell + cell / 2;
  const y = state.food.y * cell + cell / 2;
  const r = (cell * 0.32) * pulse;

  const glow = ctx.createRadialGradient(x, y, 1, x, y, cell * 0.75);
  glow.addColorStop(0, "rgba(76, 255, 154, 0.95)");
  glow.addColorStop(1, "rgba(76, 255, 154, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4cff9a";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnake() {
  for (let i = state.snake.length - 1; i >= 0; i--) {
    const s = state.snake[i];
    const x = s.x * cell + 1.5;
    const y = s.y * cell + 1.5;
    const size = cell - 3;
    const t = i / Math.max(1, state.snake.length - 1);
    const color = i === 0
      ? "rgba(51, 212, 255, 1)"
      : `rgba(${Math.round(76 + 16 * (1 - t))}, ${Math.round(255 - 60 * t)}, ${Math.round(154 + 60 * t)}, 0.95)`;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
  }
}

function drawFx() {
  if (state.fxTimer <= 0) return;
  const alpha = state.fxTimer / 260;
  ctx.fillStyle = `rgba(76, 255, 154, ${0.2 * alpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawFrame(time) {
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, "#081a2a");
  bg.addColorStop(1, "#09222f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid(time);
  drawFood(time);
  drawSnake();
  drawFx();
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.add("show");
}

function hideOverlay() {
  overlay.classList.remove("show");
}

let last = performance.now();
function loop(now) {
  const delta = now - last;
  last = now;

  if (state.running && !state.paused && !state.dead) {
    state.stepAcc += delta;
    while (state.stepAcc >= state.moveInterval) {
      state.stepAcc -= state.moveInterval;
      gameStep();
    }
  }

  state.fxTimer = Math.max(0, state.fxTimer - delta);
  drawFrame(now);
  requestAnimationFrame(loop);
}

startBtn.addEventListener("click", () => {
  if (state.dead || state.snake.length === 0) resetGame();
  state.running = true;
  state.paused = false;
  hideOverlay();
});

pauseBtn.addEventListener("click", () => {
  if (!state.running || state.dead) return;
  state.paused = !state.paused;
  if (state.paused) {
    showOverlay("Paused", "Press Pause again or Start to continue.");
  } else {
    hideOverlay();
  }
});

restartBtn.addEventListener("click", () => {
  resetGame();
  state.running = true;
  hideOverlay();
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].includes(key)) {
    e.preventDefault();
  }

  if (key === "arrowup" || key === "w") setDirection(0, -1);
  if (key === "arrowdown" || key === "s") setDirection(0, 1);
  if (key === "arrowleft" || key === "a") setDirection(-1, 0);
  if (key === "arrowright" || key === "d") setDirection(1, 0);
  if (key === " " && state.running && !state.dead) {
    state.paused = !state.paused;
    if (state.paused) showOverlay("Paused", "Press Space or Pause to continue.");
    else hideOverlay();
  }
});

padButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const dir = btn.dataset.dir;
    if (dir === "up") setDirection(0, -1);
    if (dir === "down") setDirection(0, 1);
    if (dir === "left") setDirection(-1, 0);
    if (dir === "right") setDirection(1, 0);
  });
});

loginBtn.addEventListener("click", handleLogin);
registerBtn.addEventListener("click", handleRegister);
logoutBtn.addEventListener("click", handleLogout);
refreshRankBtn.addEventListener("click", refreshLeaderboard);

resetGame();
drawFrame(0);
requestAnimationFrame(loop);
Promise.all([checkSession(), refreshLeaderboard()]);
