"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

// ── In-memory room store ───────────────────────────────
const rooms = new Map();

function generateCode() {
  // 6-char uppercase alphanumeric
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function createRoom() {
  let code;
  do { code = generateCode(); } while (rooms.has(code));
  rooms.set(code, {
    players: [],      // [{id, role}]  max 2
    board: Array(9).fill(null),
    currentPlayer: "X",
    gameOver: false,
    scores: { X: 0, O: 0, draw: 0 },
  });
  return code;
}

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function checkWin(board, player) {
  return WIN_LINES.find(l => l.every(i => board[i] === player)) || null;
}

// ── Socket.IO ──────────────────────────────────────────
io.on("connection", (socket) => {
  let roomCode = null;

  socket.on("create-room", (cb) => {
    roomCode = createRoom();
    const room = rooms.get(roomCode);
    room.players.push({ id: socket.id, role: "X" });
    socket.join(roomCode);
    cb({ code: roomCode, role: "X" });
  });

  socket.on("join-room", (code, cb) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) return cb({ error: "Room not found" });

    // Allow reconnect if socket was already in room
    const existing = room.players.find(p => p.id === socket.id);
    if (existing) {
      socket.join(code);
      roomCode = code;
      return cb({ role: existing.role, state: roomState(room) });
    }

    if (room.players.length >= 2) {
      // Spectator join
      socket.join(code);
      roomCode = code;
      return cb({ role: "spectator", state: roomState(room) });
    }

    const role = room.players[0].role === "X" ? "O" : "X";
    room.players.push({ id: socket.id, role });
    socket.join(code);
    roomCode = code;

    cb({ role, state: roomState(room) });

    // Notify the other player
    socket.to(code).emit("opponent-joined", { role });
  });

  socket.on("make-move", ({ index }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Validate turn
    if (room.gameOver) return;
    if (room.board[index] !== null) return;
    if (room.currentPlayer !== player.role) return;

    room.board[index] = player.role;

    const winLine = checkWin(room.board, player.role);
    if (winLine) {
      room.gameOver = true;
      room.scores[player.role]++;
      io.to(roomCode).emit("move-made", {
        index, player: player.role, board: room.board,
        winner: player.role, winLine, scores: room.scores,
      });
      return;
    }

    if (room.board.every(c => c !== null)) {
      room.gameOver = true;
      room.scores.draw++;
      io.to(roomCode).emit("move-made", {
        index, player: player.role, board: room.board,
        winner: null, draw: true, scores: room.scores,
      });
      return;
    }

    room.currentPlayer = room.currentPlayer === "X" ? "O" : "X";
    io.to(roomCode).emit("move-made", {
      index, player: player.role, board: room.board,
      currentPlayer: room.currentPlayer,
    });
  });

  socket.on("restart-round", () => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.find(p => p.id === socket.id)) return;

    room.board = Array(9).fill(null);
    room.currentPlayer = "X";
    room.gameOver = false;
    io.to(roomCode).emit("round-restarted", { scores: room.scores });
  });

  socket.on("reset-scores", () => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.find(p => p.id === socket.id)) return;

    room.board = Array(9).fill(null);
    room.currentPlayer = "X";
    room.gameOver = false;
    room.scores = { X: 0, O: 0, draw: 0 };
    io.to(roomCode).emit("scores-reset");
  });

  socket.on("disconnect", () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      socket.to(roomCode).emit("opponent-disconnected");
    }

    // Clean up empty rooms
    if (room.players.length === 0) {
      rooms.delete(roomCode);
    }
  });
});

function roomState(room) {
  return {
    board: room.board,
    currentPlayer: room.currentPlayer,
    gameOver: room.gameOver,
    scores: room.scores,
    playerCount: room.players.length,
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`XOX server listening on port ${PORT}`);
});
