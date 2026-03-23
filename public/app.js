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
  let mode = "pvp"; // pvp | pvc | online
  let scores = { X: 0, O: 0, draw: 0 };

  // ── Online state ──────────────────────────────────
  let socket = null;
  let myRole = null;       // "X" | "O" | "spectator"
  let roomCode = null;
  let opponentJoined = false;

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

  // Online DOM refs
  const onlinePanel = document.getElementById("online-panel");
  const onlineLobby = document.getElementById("online-lobby");
  const onlineInfo = document.getElementById("online-info");
  const btnCreateRoom = document.getElementById("btn-create-room");
  const btnJoinRoom = document.getElementById("btn-join-room");
  const inputRoomCode = document.getElementById("input-room-code");
  const displayRoomCode = document.getElementById("display-room-code");
  const btnCopyCode = document.getElementById("btn-copy-code");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const playerRole = document.getElementById("player-role");

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

      // Show/hide online panel
      onlinePanel.hidden = mode !== "online";

      if (mode === "online") {
        leaveCurrentRoom();
        showLobby();
      } else {
        leaveCurrentRoom();
        resetBoard();
      }
    });
  });

  // ── Cell clicks ────────────────────────────────────
  cells.forEach(cell => {
    cell.addEventListener("click", () => handleMove(+cell.dataset.index));
  });

  function handleMove(i) {
    if (gameOver || board[i] !== null) return;

    if (mode === "online") {
      // Only allow moves if it's our turn and we're a player
      if (myRole === "spectator") return;
      if (currentPlayer !== myRole) return;
      if (!opponentJoined) return;
      socket.emit("make-move", { index: i });
      return;
    }

    if (mode === "pvc" && currentPlayer === "O") return;

    placeMove(i);
    if (!gameOver && mode === "pvc" && currentPlayer === "O") {
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
    for (const line of WIN_LINES) {
      const m = findTwoOf(line, "O");
      if (m !== -1) return m;
    }
    for (const line of WIN_LINES) {
      const m = findTwoOf(line, "X");
      if (m !== -1) return m;
    }
    if (board[4] === null) return 4;
    const corners = [0, 2, 6, 8].filter(i => board[i] === null);
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
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
    if (mode === "online" && !opponentJoined) {
      turnIndicator.textContent = "Waiting for opponent…";
      turnIndicator.className = "turn-indicator";
      return;
    }
    if (mode === "online" && myRole !== "spectator") {
      const isMyTurn = currentPlayer === myRole;
      turnIndicator.textContent = isMyTurn ? "Your turn" : "Opponent's turn";
    } else {
      turnIndicator.textContent = `${currentPlayer}'s turn`;
    }
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
  btnRestart.addEventListener("click", () => {
    if (mode === "online" && socket) {
      socket.emit("restart-round");
    } else {
      resetBoard();
    }
  });

  btnPlayAgain.addEventListener("click", () => {
    if (mode === "online" && socket) {
      socket.emit("restart-round");
    } else {
      resetBoard();
    }
  });

  btnReset.addEventListener("click", () => {
    if (mode === "online" && socket) {
      socket.emit("reset-scores");
    } else {
      scores = { X: 0, O: 0, draw: 0 };
      updateScoreboard();
      resetBoard();
    }
  });

  // ══════════════════════════════════════════════════
  //  ONLINE MODE
  // ══════════════════════════════════════════════════

  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on("connect", () => {
      if (roomCode) {
        // Reconnect to room
        socket.emit("join-room", roomCode, (res) => {
          if (res.error) {
            setStatus("disconnected", "Room expired");
            return;
          }
          myRole = res.role;
          if (res.state) syncState(res.state);
          setStatus("connected", "Reconnected");
        });
      }
    });

    socket.on("disconnect", () => {
      setStatus("disconnected", "Connection lost…");
    });

    socket.on("opponent-joined", () => {
      opponentJoined = true;
      setStatus("connected", "Opponent joined!");
      updateTurnIndicator();
    });

    socket.on("opponent-disconnected", () => {
      opponentJoined = false;
      setStatus("disconnected", "Opponent disconnected");
      updateTurnIndicator();
    });

    socket.on("move-made", (data) => {
      // Apply the move locally
      board = data.board;
      const cell = cells[data.index];
      cell.textContent = data.player;
      cell.classList.add(data.player.toLowerCase(), "placed");
      cell.disabled = true;

      const row = Math.floor(data.index / 3) + 1;
      const col = (data.index % 3) + 1;
      cell.setAttribute("aria-label", `Row ${row}, Column ${col}, ${data.player}`);

      if (data.winner) {
        gameOver = true;
        scores = data.scores;
        cells.forEach(c => (c.disabled = true));
        data.winLine.forEach(i => cells[i].classList.add("win"));
        resultText.textContent = `${data.winner} wins!`;
        resultText.className = "result-text " + (data.winner === "X" ? "x-wins" : "o-wins");
        updateScoreboard();
        setTimeout(() => { overlay.hidden = false; }, 600);
      } else if (data.draw) {
        gameOver = true;
        scores = data.scores;
        cells.forEach(c => (c.disabled = true));
        resultText.textContent = "It's a draw!";
        resultText.className = "result-text";
        updateScoreboard();
        setTimeout(() => { overlay.hidden = false; }, 600);
      } else {
        currentPlayer = data.currentPlayer;
        updateTurnIndicator();
      }
    });

    socket.on("round-restarted", (data) => {
      scores = data.scores;
      updateScoreboard();
      resetBoardLocal();
    });

    socket.on("scores-reset", () => {
      scores = { X: 0, O: 0, draw: 0 };
      updateScoreboard();
      resetBoardLocal();
    });
  }

  function resetBoardLocal() {
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

  function syncState(state) {
    board = state.board;
    currentPlayer = state.currentPlayer;
    gameOver = state.gameOver;
    scores = state.scores;
    opponentJoined = state.playerCount >= 2;

    updateScoreboard();

    cells.forEach((cell, i) => {
      const val = board[i];
      cell.textContent = val || "";
      cell.className = "cell" + (val ? ` ${val.toLowerCase()} placed` : "");
      cell.disabled = gameOver || val !== null;
      const row = Math.floor(i / 3) + 1;
      const col = (i % 3) + 1;
      cell.setAttribute("aria-label", `Row ${row}, Column ${col}, ${val || "empty"}`);
    });
    updateTurnIndicator();
  }

  function showLobby() {
    onlineLobby.hidden = false;
    onlineInfo.hidden = true;
    myRole = null;
    roomCode = null;
    opponentJoined = false;
    resetBoard();
  }

  function showRoomInfo(code, role) {
    onlineLobby.hidden = true;
    onlineInfo.hidden = false;
    displayRoomCode.textContent = code;
    playerRole.textContent = role === "spectator"
      ? "Spectating"
      : `You are ${role}`;
    playerRole.className = "player-role" + (role !== "spectator" ? ` role-${role.toLowerCase()}` : "");
  }

  function setStatus(state, text) {
    statusDot.className = "status-dot " + state;
    statusText.textContent = text;
  }

  function leaveCurrentRoom() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    roomCode = null;
    myRole = null;
    opponentJoined = false;
  }

  // ── Online button handlers ──────────────────────────

  btnCreateRoom.addEventListener("click", () => {
    connectSocket();
    socket.emit("create-room", (res) => {
      roomCode = res.code;
      myRole = res.role;
      showRoomInfo(roomCode, myRole);
      setStatus("waiting", "Waiting for opponent…");
      updateTurnIndicator();
    });
  });

  btnJoinRoom.addEventListener("click", () => {
    const code = inputRoomCode.value.trim();
    if (!code) return;
    connectSocket();
    socket.emit("join-room", code, (res) => {
      if (res.error) {
        setStatus("disconnected", res.error);
        onlineLobby.hidden = false;
        onlineInfo.hidden = true;
        return;
      }
      roomCode = code.toUpperCase();
      myRole = res.role;
      showRoomInfo(roomCode, myRole);
      if (res.state) {
        syncState(res.state);
        if (res.state.playerCount >= 2) {
          setStatus("connected", "Game in progress");
        } else {
          setStatus("waiting", "Waiting for opponent…");
        }
      } else {
        opponentJoined = false;
        setStatus("waiting", "Waiting for opponent…");
        updateTurnIndicator();
      }
    });
  });

  inputRoomCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnJoinRoom.click();
  });

  btnCopyCode.addEventListener("click", () => {
    const code = displayRoomCode.textContent;
    navigator.clipboard.writeText(code).then(() => {
      btnCopyCode.textContent = "Copied!";
      setTimeout(() => { btnCopyCode.textContent = "Copy"; }, 1500);
    });
  });

  // ── Init ───────────────────────────────────────────
  updateTurnIndicator();
})();
