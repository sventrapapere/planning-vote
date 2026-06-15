const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let players = {}; // id -> { id, name, vote, observer, ws }
let revealed = false;

const VOTABLE = [1, 2, 3, 5, 8, 13, 21];

function nearestVotable(avg) {
  return VOTABLE.reduce((best, v) =>
    Math.abs(v - avg) < Math.abs(best - avg) ? v : best
  );
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function getPublicState() {
  const playerList = Object.values(players).map(p => ({
    id: p.id,
    name: p.name,
    observer: p.observer,
    voted: p.vote !== null,
    vote: revealed ? p.vote : null,
  }));

  let average = null;
  if (revealed) {
    const votes = Object.values(players)
      .filter(p => !p.observer && p.vote !== null)
      .map(p => p.vote);
    if (votes.length > 0) {
      const avg = votes.reduce((a, b) => a + b, 0) / votes.length;
      average = nearestVotable(avg);
    }
  }

  return { type: 'state', players: playerList, revealed, average };
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const name = String(msg.name || 'Anonimo').slice(0, 30);
      const observer = !!msg.observer;
      players[id] = { id, name, vote: null, observer, ws };
      ws.send(JSON.stringify({ type: 'joined', id, observer }));
      broadcast(getPublicState());
    }

    if (msg.type === 'vote' && players[id] && !players[id].observer) {
      const v = Number(msg.value);
      if (!isNaN(v) && v >= 0 && v <= 999) {
        players[id].vote = v;
        broadcast(getPublicState());
      }
    }

    if (msg.type === 'reveal') {
      revealed = true;
      broadcast(getPublicState());
    }

    if (msg.type === 'reset') {
      revealed = false;
      Object.values(players).forEach(p => { p.vote = null; });
      broadcast(getPublicState());
    }
  });

  ws.on('close', () => {
    delete players[id];
    broadcast(getPublicState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Planning Vote running at http://localhost:${PORT}`);
});
