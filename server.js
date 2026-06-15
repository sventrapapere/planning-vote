const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms[roomId] -> { players: {id -> player}, revealed, creatorId }
const rooms = {};

const VOTABLE = [1, 2, 3, 5, 8, 13, 21];

function nearestVotable(avg) {
  return VOTABLE.reduce((best, v) =>
    Math.abs(v - avg) < Math.abs(best - avg) ? v : best
  );
}

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { players: {}, revealed: false, creatorId: null };
  }
  return rooms[roomId];
}

function broadcast(room, data) {
  const msg = JSON.stringify(data);
  Object.values(room.players).forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  });
}

function getPublicState(room) {
  const playerList = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    observer: p.observer,
    voted: p.vote !== null,
    vote: room.revealed ? p.vote : null,
  }));

  let average = null;
  if (room.revealed) {
    const votes = Object.values(room.players)
      .filter(p => !p.observer && p.vote !== null && p.vote !== 'skip')
      .map(p => p.vote);
    if (votes.length > 0) {
      const avg = votes.reduce((a, b) => a + b, 0) / votes.length;
      average = nearestVotable(avg);
    }
  }

  return { type: 'state', players: playerList, revealed: room.revealed, average, creatorId: room.creatorId };
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2);
  let roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      roomId = String(msg.roomId || '').slice(0, 64);
      if (!roomId) return;

      const name = String(msg.name || 'Anonimo').slice(0, 30);
      const observer = !!msg.observer;
      const room = getOrCreateRoom(roomId);

      // First to join becomes creator
      if (!room.creatorId) room.creatorId = id;

      room.players[id] = { id, name, vote: null, observer, ws };

      ws.send(JSON.stringify({ type: 'joined', id, isCreator: room.creatorId === id, observer }));
      broadcast(room, getPublicState(room));
    }

    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    if (msg.type === 'vote' && room.players[id] && !room.players[id].observer) {
      if (msg.value === 'skip') {
        room.players[id].vote = 'skip';
        broadcast(room, getPublicState(room));
      } else {
        const v = Number(msg.value);
        if (!isNaN(v) && v >= 0 && v <= 999) {
          room.players[id].vote = v;
          broadcast(room, getPublicState(room));
        }
      }
    }

    // Only creator can reveal or reset
    if (msg.type === 'reveal' && room.creatorId === id) {
      room.revealed = true;
      broadcast(room, getPublicState(room));
    }

    if (msg.type === 'reset' && room.creatorId === id) {
      room.revealed = false;
      Object.values(room.players).forEach(p => { p.vote = null; });
      broadcast(room, getPublicState(room));
    }
  });

  ws.on('close', () => {
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    delete room.players[id];

    if (Object.keys(room.players).length === 0) {
      delete rooms[roomId];
    } else {
      // If creator left, assign to next player
      if (room.creatorId === id) {
        room.creatorId = Object.keys(room.players)[0];
      }
      broadcast(room, getPublicState(room));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Planning Vote running at http://localhost:${PORT}`);
});
