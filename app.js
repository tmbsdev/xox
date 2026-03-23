(() => {
  "use strict";

  // ── State ──────────────────────────────────────────
  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6]          // diags
  ];

  let board = Array(9).fill(null);
  let currentPlayer = "X";
  let gameOver = false;
  let mode = "pvp"; // pvp | pvc
  let scores = { X: 0, O: 0, draw: 0 };

  // ── DOM refs ───────────────────────────────────────
  const cells = document.querySelectorAll(".cell");
  const turnIndicator = document.getElementById("turn-indicator");
  const scoreX = document.getElementById("score-x");
  const scoreO = document.getElementById("score-o");
  const scoreDraw = document.getElementById("score-draw");
  const btnRestart = document.getElementById("btn-restart");
  const btnReset = document.getElementById("btn-reset");
  const overlay = document.getElementById("result-overlay");
  const resultText = document.getElementById("result-text");
  const btnPlayAgain = document.getElementById("btn-play-again");
  const modeBtns = document.querySelectorAll(".mode-btn");

  // ── Mode switching ─────────────────────────────────
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const newMode = btn.dataset.mode;
      if (newMode === mode) return;
      mode = newMode;
      modeBtns.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-checked", isActive);
      });
      resetBoard();
    });
  });

  // ── Cell clicks ────────────────────────────────────
  cells.forEach(cell => {
    cell.addEventListener("click", () => handleMove(+cell.dataset.index));
  });

  function handleMove(i) {
    if (gameOver || board[i] !== null) return;
    if (mode === "pvc" && currentPlayer === "O") return; // CPU's turn

    placeMove(i);
    if (!gameOver && mode === "pvc" && currentPlayer === "O") {
      // small delay so CPU move feels natural
      setTimeout(cpuMove, 300);
    }
  }

  function placeMove(i) {
    board[i] = currentPlayer;
    const cell = cells[i];
    cell.textContent = currentPlayer;
    cell.classList.add(currentPlayer.toLowerCase(), "placed");
    cell.disabled = true;

    const row = Math.floor(i / 3) + 1;
    const col = (i % 3) + 1;
    cell.setAttribute("aria-label", `Row ${row}, Column ${col}, ${currentPlayer}`);

    const winLine = checkWin(currentPlayer);
    if (winLine) {
      endGame(currentPlayer, winLine);
      return;
    }
    if (board.every(c => c !== null)) {
      endGame(null);
      return;
    }
    currentPlayer = currentPlayer === "X" ? "O" : "X";
    updateTurnIndicator();
  }

  // ── Win check ──────────────────────────────────────
  function checkWin(player) {
    return WIN_LINES.find(line => line.every(i => board[i] === player)) || null;
  }

  // ── End game ───────────────────────────────────────
  function endGame(winner, winLine) {
    gameOver = true;
    cells.forEach(c => (c.disabled = true));

    if (winner) {
      scores[winner]++;
      winLine.forEach(i => cells[i].classList.add("win"));
      resultText.textContent = `${winner} wins!`;
      resultText.className = "result-text " + (winner === "X" ? "x-wins" : "o-wins");
    } else {
      scores.draw++;
      resultText.textContent = "It's a draw!";
      resultText.className = "result-text";
    }
    updateScoreboard();
    setTimeout(() => { overlay.hidden = false; }, 600);
  }

  // ── CPU AI (minimax-lite) ──────────────────────────
  function cpuMove() {
    if (gameOver) return;
    const move = getBestMove();
    if (move !== -1) placeMove(move);
  }

  function getBestMove() {
    // 1. Win if possible
    for (const line of WIN_LINES) {
      const m = findTwoOf(line, "O");
      if (m !== -1) return m;
    }
    // 2. Block opponent win
    for (const line of WIN_LINES) {
      const m = findTwoOf(line, "X");
      if (m !== -1) return m;
    }
    // 3. Take center
    if (board[4] === null) return 4;
    // 4. Take a corner
    const corners = [0, 2, 6, 8].filter(i => board[i] === null);
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
    // 5. Take any remaining
    const empty = board.map((v, i) => v === null ? i : -1).filter(i => i !== -1);
    return empty.length ? empty[Math.floor(Math.random() * empty.length)] : -1;
  }

  function findTwoOf(line, player) {
    const vals = line.map(i => board[i]);
    if (vals.filter(v => v === player).length === 2 && vals.includes(null)) {
      return line[vals.indexOf(null)];
    }
    return -1;
  }

  // ── UI helpers ─────────────────────────────────────
  function updateTurnIndicator() {
    turnIndicator.textContent = `${currentPlayer}'s turn`;
    turnIndicator.className = "turn-indicator turn-" + currentPlayer.toLowerCase();
  }

  function updateScoreboard() {
    scoreX.textContent = scores.X;
    scoreO.textContent = scores.O;
    scoreDraw.textContent = scores.draw;
  }

  function resetBoard() {
    board = Array(9).fill(null);
    currentPlayer = "X";
    gameOver = false;
    overlay.hidden = true;
    cells.forEach((cell, i) => {
      cell.textContent = "";
      cell.disabled = false;
      cell.className = "cell";
      const row = Math.floor(i / 3) + 1;
      const col = (i % 3) + 1;
      cell.setAttribute("aria-label", `Row ${row}, Column ${col}, empty`);
    });
    updateTurnIndicator();
  }

  // ── Button handlers ────────────────────────────────
  btnRestart.addEventListener("click", resetBoard);
  btnPlayAgain.addEventListener("click", resetBoard);

  btnReset.addEventListener("click", () => {
    scores = { X: 0, O: 0, draw: 0 };
    updateScoreboard();
    resetBoard();
  });

  // ── Init ───────────────────────────────────────────
  updateTurnIndicator();
})();
