(() => {
  "use strict";

  // ── State ──────────────────────────────────────────
  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6]          // diags
  ];

  const MAX_MARKS = 3;

  let board = Array(9).fill(null);
  let currentPlayer = "X";
  let gameOver = false;
  let mode = "pvp"; // pvp | pvc | online
  let scores = { X: 0, O: 0 };
  let moveHistory = { X: [], O: [] };

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
  const btnCopyInvite = document.getElementById("btn-copy-invite");
  const btnShareInvite = document.getElementById("btn-share-invite");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const playerRole = document.getElementById("player-role");

  // ── Invite link helper ─────────────────────────────
  function getInviteUrl(code) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", code);
    return url.toString();
  }

  // Show share button if navigator.share is available
  if (navigator.share) {
    btnShareInvite.hidden = false;
  }

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
    const player = currentPlayer;
    const history = moveHistory[player];

    // Aging: remove oldest mark if player already has MAX_MARKS
    let removedIndex = null;
    if (history.length >= MAX_MARKS) {
      removedIndex = history.shift();
      board[removedIndex] = null;
      clearCell(removedIndex);
    }

    // Place new mark
    board[i] = player;
    history.push(i);
    renderCell(i, player);

    const winLine = checkWin(player);
    if (winLine) {
      endGame(player, winLine);
      return;
    }

    currentPlayer = currentPlayer === "X" ? "O" : "X";
    updateFadingMarks();
    updateTurnIndicator();
  }

  function renderCell(i, player) {
    const cell = cells[i];
    cell.textContent = player;
    cell.classList.add(player.toLowerCase(), "placed");
    cell.disabled = true;
    const row = Math.floor(i / 3) + 1;
    const col = (i % 3) + 1;
    cell.setAttribute("aria-label", `Row ${row}, Column ${col}, ${player}`);
  }

  function clearCell(i) {
    const cell = cells[i];
    cell.textContent = "";
    cell.className = "cell";
    cell.disabled = false;
    const row = Math.floor(i / 3) + 1;
    const col = (i % 3) + 1;
    cell.setAttribute("aria-label", `Row ${row}, Column ${col}, empty`);
  }

  // ── Fading marks (predictive removal indicator) ────
  function updateFadingMarks() {
    // Clear all fading classes first
    cells.forEach(c => c.classList.remove("fading"));

    // For each player, if they have MAX_MARKS, their oldest mark fades
    for (const p of ["X", "O"]) {
      const history = moveHistory[p];
      if (history.length >= MAX_MARKS) {
        cells[history[0]].classList.add("fading");
      }
    }
  }

  // ── Win check ──────────────────────────────────────
  function checkWin(player) {
    return WIN_LINES.find(line => line.every(i => board[i] === player)) || null;
  }

  // ── End game ───────────────────────────────────────
  function endGame(winner, winLine) {
    gameOver = true;
    cells.forEach(c => { c.disabled = true; c.classList.remove("fading"); });

    scores[winner]++;
    winLine.forEach(i => cells[i].classList.add("win"));
    resultText.textContent = `${winner} wins!`;
    resultText.className = "result-text " + (winner === "X" ? "x-wins" : "o-wins");
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
    // Simulate what the board would look like after CPU's aging removal
    const cpuHistory = moveHistory["O"];
    let simBoard = board.slice();
    if (cpuHistory.length >= MAX_MARKS) {
      simBoard[cpuHistory[0]] = null;
    }

    // 1. Win if possible (accounting for aging)
    for (const line of WIN_LINES) {
      const m = findTwoOfSim(line, "O", simBoard);
      if (m !== -1) return m;
    }
    // 2. Block opponent win
    for (const line of WIN_LINES) {
      const m = findTwoOf(line, "X");
      if (m !== -1 && board[m] === null) return m;
    }
    // 3. Take center
    if (board[4] === null) return 4;
    // 4. Take random corner
    const corners = [0, 2, 6, 8].filter(i => board[i] === null);
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
    // 5. Take any empty
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

  function findTwoOfSim(line, player, simBoard) {
    const vals = line.map(i => simBoard[i]);
    if (vals.filter(v => v === player).length === 2 && vals.includes(null)) {
      const idx = line[vals.indexOf(null)];
      // Only consider cells that are actually empty on current board
      if (board[idx] === null) return idx;
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
  }

  function resetBoard() {
    board = Array(9).fill(null);
    currentPlayer = "X";
    gameOver = false;
    moveHistory = { X: [], O: [] };
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
      scores = { X: 0, O: 0 };
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
      board = data.board;
      moveHistory = data.moveHistory;

      // Clear removed cell if any
      if (data.removedIndex !== null && data.removedIndex !== undefined) {
        clearCell(data.removedIndex);
      }

      // Render placed cell
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
        cells.forEach(c => { c.disabled = true; c.classList.remove("fading"); });
        data.winLine.forEach(i => cells[i].classList.add("win"));
        resultText.textContent = `${data.winner} wins!`;
        resultText.className = "result-text " + (data.winner === "X" ? "x-wins" : "o-wins");
        updateScoreboard();
        setTimeout(() => { overlay.hidden = false; }, 600);
      } else {
        currentPlayer = data.currentPlayer;
        updateFadingMarks();
        updateTurnIndicator();
      }
    });

    socket.on("round-restarted", (data) => {
      scores = data.scores;
      updateScoreboard();
      resetBoardLocal();
    });

    socket.on("scores-reset", () => {
      scores = { X: 0, O: 0 };
      updateScoreboard();
      resetBoardLocal();
    });
  }

  function resetBoardLocal() {
    board = Array(9).fill(null);
    currentPlayer = "X";
    gameOver = false;
    moveHistory = { X: [], O: [] };
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
    moveHistory = state.moveHistory || { X: [], O: [] };
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
    updateFadingMarks();
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

  btnCopyInvite.addEventListener("click", () => {
    const url = getInviteUrl(displayRoomCode.textContent);
    navigator.clipboard.writeText(url).then(() => {
      btnCopyInvite.textContent = "Copied!";
      setTimeout(() => { btnCopyInvite.textContent = "Copy Invite Link"; }, 1500);
    });
  });

  btnShareInvite.addEventListener("click", () => {
    const code = displayRoomCode.textContent;
    const url = getInviteUrl(code);
    navigator.share({
      title: "XOX – Tic-Tac-Toe",
      text: `Join my game! Room code: ${code}`,
      url: url
    }).catch(() => {});
  });

  // ── Auto-join from URL ────────────────────────────
  function tryAutoJoinFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("room") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    if (!code) return;

    // Clean URL without reloading
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);

    // Switch to online mode
    mode = "online";
    modeBtns.forEach(b => {
      const isOnline = b.dataset.mode === "online";
      b.classList.toggle("active", isOnline);
      b.setAttribute("aria-checked", isOnline);
    });
    onlinePanel.hidden = false;

    // Show lobby with feedback while connecting
    inputRoomCode.value = code;
    onlineLobby.hidden = false;
    onlineInfo.hidden = true;

    // Connect and attempt join
    connectSocket();
    setStatus("waiting", "Joining room " + code + "…");
    socket.emit("join-room", code, (res) => {
      if (res.error) {
        setStatus("disconnected", res.error);
        onlineLobby.hidden = false;
        onlineInfo.hidden = true;
        return;
      }
      roomCode = code;
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
  }

  // ── Init ───────────────────────────────────────────
  updateTurnIndicator();
  tryAutoJoinFromUrl();
})();
