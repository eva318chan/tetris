(() => {
  "use strict";

  // ---------- Constants ----------
  const COLS = 10;
  const ROWS = 20;
  const BLOCK = 30; // canvas pixels per cell (board canvas is 300x600)

  const SHAPES = {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    O: [
      [1, 1],
      [1, 1],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
  };

  const COLORS = {
    I: "#22d3ee",
    J: "#60a5fa",
    L: "#fb923c",
    O: "#facc15",
    S: "#4ade80",
    T: "#c084fc",
    Z: "#f87171",
  };

  const TYPES = Object.keys(SHAPES);
  const LINE_SCORES = [0, 100, 300, 500, 800];

  // ---------- DOM ----------
  const boardCanvas = document.getElementById("board");
  const nextCanvas = document.getElementById("next");
  const holdCanvas = document.getElementById("hold");
  const bctx = boardCanvas.getContext("2d");
  const nctx = nextCanvas.getContext("2d");
  const hctx = holdCanvas.getContext("2d");

  const elScore = document.getElementById("score");
  const elLevel = document.getElementById("level");
  const elLines = document.getElementById("lines");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const btnStart = document.getElementById("btn-start");
  const btnPause = document.getElementById("btn-pause");
  const btnRestart = document.getElementById("btn-restart");
  const lbEl = document.getElementById("leaderboard");
  const scoreSubmitEl = document.getElementById("score-submit");
  const nameInput = document.getElementById("player-name");
  const btnSubmitScore = document.getElementById("btn-submit-score");

  // ---------- Supabase leaderboard (optional) ----------
  let sb = null; // supabase client, null when not configured
  let scoreSubmitted = false;

  function initSupabase() {
    try {
      const cfg = window.TETRIS_CONFIG;
      if (!window.supabase || !cfg || !cfg.SUPABASE_URL) return;
      if (cfg.SUPABASE_URL.includes("YOUR_PROJECT_REF")) return;
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      sb = null;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  async function loadLeaderboard() {
    if (!lbEl) return;
    if (!sb) {
      lbEl.innerHTML = '<li class="loading">排行榜未連線</li>';
      return;
    }
    const { data, error } = await sb
      .schema("tetris")
      .from("scores")
      .select("name,score,level")
      .order("score", { ascending: false })
      .limit(10);
    if (error) {
      lbEl.innerHTML = '<li class="loading">載入失敗</li>';
      return;
    }
    if (data.length === 0) {
      lbEl.innerHTML = '<li class="loading">還沒有紀錄，來當第一名！</li>';
      return;
    }
    lbEl.innerHTML = "";
    data.forEach((r, i) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="rank">${i + 1}</span>` +
        `<span class="lb-name">${esc(r.name)}</span>` +
        `<span class="lb-score">${r.score}</span>`;
      lbEl.appendChild(li);
    });
  }

  async function submitScore() {
    if (!sb || scoreSubmitted) return;
    const name = nameInput.value.trim().slice(0, 20) || "匿名";
    btnSubmitScore.disabled = true;
    const { error } = await sb
      .schema("tetris")
      .from("scores")
      .insert({ name, score, level, lines });
    if (!error) {
      scoreSubmitted = true;
      scoreSubmitEl.hidden = true;
      overlayText.textContent = `最終分數 ${score} · 已登上排行榜！`;
      loadLeaderboard();
    } else {
      overlayText.textContent = "送出失敗：" + error.message;
      btnSubmitScore.disabled = false;
    }
  }

  // ---------- State ----------
  let grid; // ROWS x COLS, 0 or type letter
  let bag;
  let current; // {type, matrix, x, y}
  let heldType;
  let canHold;
  let score;
  let level;
  let lines;
  let dropCounter;
  let lastTime;
  let state; // 'ready' | 'playing' | 'paused' | 'over'
  let rafId;

  function dropInterval() {
    // Classic-ish curve: faster each level, floor at 60ms
    return Math.max(800 - (level - 1) * 70, 60);
  }

  function reset() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    bag = [];
    heldType = null;
    canHold = true;
    score = 0;
    level = 1;
    lines = 0;
    dropCounter = 0;
    lastTime = 0;
    current = null;
    state = "ready";
    updateHud();
    drawAll();
  }

  // ---------- Bag ----------
  function refillBag() {
    bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  function nextType() {
    if (bag.length === 0) refillBag();
    return bag.pop();
  }

  function peekNext() {
    if (bag.length === 0) refillBag();
    return bag[bag.length - 1];
  }

  // ---------- Pieces ----------
  function spawn() {
    const type = nextType();
    const matrix = SHAPES[type].map((row) => row.slice());
    current = {
      type,
      matrix,
      x: Math.floor(COLS / 2) - Math.ceil(matrix[0].length / 2),
      y: 0,
    };
    canHold = true;
    if (collides(current.matrix, current.x, current.y)) {
      gameOver();
    }
  }

  function rotateMatrix(m) {
    const n = m.length;
    const out = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        out[x][n - 1 - y] = m[y][x];
      }
    }
    return out;
  }

  function collides(matrix, px, py) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const nx = px + x;
        const ny = py + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && grid[ny][nx]) return true;
      }
    }
    return false;
  }

  function tryRotate() {
    if (!current || state !== "playing") return;
    const rotated = rotateMatrix(current.matrix);
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      if (!collides(rotated, current.x + k, current.y)) {
        current.matrix = rotated;
        current.x += k;
        drawAll();
        return;
      }
    }
  }

  function tryMove(dx, dy) {
    if (!current || state !== "playing") return false;
    if (!collides(current.matrix, current.x + dx, current.y + dy)) {
      current.x += dx;
      current.y += dy;
      drawAll();
      return true;
    }
    return false;
  }

  function ghostY() {
    let gy = current.y;
    while (!collides(current.matrix, current.x, gy + 1)) gy++;
    return gy;
  }

  function hardDrop() {
    if (!current || state !== "playing") return;
    const dist = ghostY() - current.y;
    current.y = ghostY();
    score += dist * 2;
    lockPiece();
  }

  function softDrop() {
    if (tryMove(0, 1)) {
      score += 1;
      updateHud();
    }
  }

  function holdPiece() {
    if (!current || state !== "playing" || !canHold) return;
    const cur = current.type;
    if (heldType) {
      const matrix = SHAPES[heldType].map((row) => row.slice());
      current = {
        type: heldType,
        matrix,
        x: Math.floor(COLS / 2) - Math.ceil(matrix[0].length / 2),
        y: 0,
      };
      if (collides(current.matrix, current.x, current.y)) {
        gameOver();
        return;
      }
    } else {
      spawn();
    }
    heldType = cur;
    canHold = false;
    drawAll();
  }

  function lockPiece() {
    const { matrix, x, y, type } = current;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const gy = y + r;
        const gx = x + c;
        if (gy >= 0) grid[gy][gx] = type;
      }
    }
    clearLines();
    spawn();
    updateHud();
    drawAll();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every((cell) => cell !== 0)) {
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(0));
        cleared++;
        y++; // re-check same row index after splice
      }
    }
    if (cleared > 0) {
      lines += cleared;
      score += LINE_SCORES[cleared] * level;
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel !== level) level = newLevel;
    }
  }

  // ---------- Flow ----------
  function start() {
    reset();
    scoreSubmitted = false;
    if (scoreSubmitEl) scoreSubmitEl.hidden = true;
    state = "playing";
    hideOverlay();
    spawn();
    updateHud();
    drawAll();
    lastTime = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      cancelAnimationFrame(rafId);
      showOverlay("已暫停", "休息一下，準備好再繼續", "繼續");
    } else if (state === "paused") {
      state = "playing";
      hideOverlay();
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function gameOver() {
    state = "over";
    cancelAnimationFrame(rafId);
    const canSubmit = sb && score > 0 && !scoreSubmitted;
    if (scoreSubmitEl) {
      scoreSubmitEl.hidden = !canSubmit;
      if (canSubmit) {
        nameInput.value = "";
        btnSubmitScore.disabled = false;
      }
    }
    showOverlay("遊戲結束", `最終分數 ${score} · 等級 ${level}`, "再來一場");
  }

  function loop(t) {
    if (state !== "playing") return;
    const dt = t - lastTime;
    lastTime = t;
    dropCounter += dt;
    if (dropCounter > dropInterval()) {
      dropCounter = 0;
      if (!tryMove(0, 1)) {
        lockPiece();
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Rendering ----------
  function drawBlock(ctx, px, py, size, color, ghost) {
    const pad = 1;
    ctx.save();
    if (ghost) {
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + pad + 1, py + pad + 1, size - pad * 2 - 2, size - pad * 2 - 2);
    } else {
      const grad = ctx.createLinearGradient(px, py, px, py + size);
      grad.addColorStop(0, shade(color, 28));
      grad.addColorStop(1, shade(color, -22));
      ctx.fillStyle = grad;
      roundRect(ctx, px + pad, py + pad, size - pad * 2, size - pad * 2, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      roundRect(ctx, px + pad + 3, py + pad + 3, size - pad * 2 - 6, 7, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function drawBoard() {
    bctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    // grid lines
    bctx.strokeStyle = "rgba(139,148,199,0.10)";
    bctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      bctx.beginPath();
      bctx.moveTo(x * BLOCK + 0.5, 0);
      bctx.lineTo(x * BLOCK + 0.5, ROWS * BLOCK);
      bctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      bctx.beginPath();
      bctx.moveTo(0, y * BLOCK + 0.5);
      bctx.lineTo(COLS * BLOCK, y * BLOCK + 0.5);
      bctx.stroke();
    }
    // locked cells
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = grid[y][x];
        if (t) drawBlock(bctx, x * BLOCK, y * BLOCK, BLOCK, COLORS[t], false);
      }
    }
    // ghost + current
    if (current && state !== "over") {
      const gy = ghostY();
      if (gy !== current.y) {
        eachCell(current, (cx, cy) => {
          if (cy + gy >= 0)
            drawBlock(bctx, (current.x + cx) * BLOCK, (gy + cy) * BLOCK, BLOCK, COLORS[current.type], true);
        });
      }
      eachCell(current, (cx, cy) => {
        if (current.y + cy >= 0)
          drawBlock(
            bctx,
            (current.x + cx) * BLOCK,
            (current.y + cy) * BLOCK,
            BLOCK,
            COLORS[current.type],
            false
          );
      });
    }
  }

  function eachCell(piece, fn) {
    const m = piece.matrix;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (m[y][x]) fn(x, y);
      }
    }
  }

  function drawPreview(ctx, canvas, type) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    const m = SHAPES[type];
    const n = m.length;
    const size = Math.min(canvas.width, canvas.height) / 4.6;
    const ox = (canvas.width - n * size) / 2;
    const oy = (canvas.height - n * size) / 2;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (m[y][x]) drawBlock(ctx, ox + x * size, oy + y * size, size, COLORS[type], false);
      }
    }
  }

  function drawAll() {
    drawBoard();
    drawPreview(nctx, nextCanvas, state === "ready" ? null : peekNext());
    drawPreview(hctx, holdCanvas, heldType);
  }

  function updateHud() {
    elScore.textContent = score;
    elLevel.textContent = level;
    elLines.textContent = lines;
  }

  function showOverlay(title, text, btnLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    btnStart.textContent = btnLabel;
    overlay.classList.add("show");
  }

  function hideOverlay() {
    overlay.classList.remove("show");
  }

  // ---------- Input ----------
  const ACTIONS = {
    left: () => tryMove(-1, 0),
    right: () => tryMove(1, 0),
    down: () => softDrop(),
    rotate: () => tryRotate(),
    drop: () => hardDrop(),
    hold: () => holdPiece(),
  };

  document.addEventListener("keydown", (e) => {
    if (e.repeat && (e.code === "Space" || e.code === "KeyC")) return;
    switch (e.code) {
      case "ArrowLeft":
        ACTIONS.left();
        e.preventDefault();
        break;
      case "ArrowRight":
        ACTIONS.right();
        e.preventDefault();
        break;
      case "ArrowDown":
        ACTIONS.down();
        e.preventDefault();
        break;
      case "ArrowUp":
      case "KeyX":
        ACTIONS.rotate();
        e.preventDefault();
        break;
      case "Space":
        if (state === "ready" || state === "over") start();
        else ACTIONS.drop();
        e.preventDefault();
        break;
      case "KeyC":
        ACTIONS.hold();
        break;
      case "KeyP":
        togglePause();
        break;
      case "KeyR":
        start();
        break;
      case "Enter":
        if (state === "ready" || state === "over" || state === "paused") {
          if (state === "paused") togglePause();
          else start();
        }
        break;
    }
  });

  // Touch buttons (press-and-hold repeats for left/right/down)
  const repeatTimers = new Map();
  document.querySelectorAll(".tbtn").forEach((btn) => {
    const action = btn.dataset.action;
    const fire = () => ACTIONS[action] && ACTIONS[action]();
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fire();
      if (action === "left" || action === "right" || action === "down") {
        const t = setTimeout(() => {
          const iv = setInterval(fire, 70);
          repeatTimers.set(btn, iv);
        }, 220);
        repeatTimers.set(btn, t);
      }
    });
    const clear = () => {
      const t = repeatTimers.get(btn);
      if (t) {
        clearTimeout(t);
        clearInterval(t);
        repeatTimers.delete(btn);
      }
    };
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointercancel", clear);
    btn.addEventListener("pointerleave", clear);
  });

  btnStart.addEventListener("click", () => {
    if (state === "paused") togglePause();
    else start();
  });
  btnPause.addEventListener("click", togglePause);
  btnRestart.addEventListener("click", start);
  if (btnSubmitScore) btnSubmitScore.addEventListener("click", submitScore);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  // ---------- Init ----------
  initSupabase();
  reset();
  loadLeaderboard();
  showOverlay("TETRIS", "按開始來一場吧", "開始遊戲");
})();
