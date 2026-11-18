// Ahnaf Raskey
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const publicDir = path.join(__dirname, 'public');
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8']
};
const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
const accounts = new Map();
const clients = new Map();
let board = Array(9).fill('');
let currentPlayer = 'X';
let winner = null;
let gameOver = false;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function getClient(req, url) {
  const token = req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
  return clients.get(token);
}

function gameState(client) {
  return {
    board,
    currentPlayer,
    winner,
    gameOver,
    role: client.role,
    name: client.name
  };
}

function pushState() {
  for (const client of clients.values()) {
    if (client.socket?.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(gameState(client)));
  }
}

function assignRole() {
  if (![...clients.values()].some(client => client.role === 'X')) return 'X';
  if (![...clients.values()].some(client => client.role === 'O')) return 'O';
  return 'Spectator';
}

function removeClient(token) {
  const client = clients.get(token);
  if (!client || client.socket) return;
  clients.delete(token);
  const next = [...clients.values()].find(other => other.role === 'Spectator');
  if (next && (client.role === 'X' || client.role === 'O')) next.role = client.role;
  pushState();
}

function readJson(req, res, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    try {
      callback(JSON.parse(body));
    } catch {
      sendJson(res, 400, { error: 'Invalid request.' });
    }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && files[url.pathname]) {
    const [file, contentType] = files[url.pathname];
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(publicDir, file)).pipe(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    readJson(req, res, data => {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      const password = typeof data.password === 'string' ? data.password : '';
      if (!name || name.length > 30 || !password || password.length > 100) {
        sendJson(res, 400, { error: 'Enter a name and password.' });
        return;
      }
      if (accounts.has(name) && accounts.get(name) !== password) {
        sendJson(res, 403, { error: 'Incorrect password for that name.' });
        return;
      }
      if ([...clients.values()].some(client => client.name === name)) {
        sendJson(res, 409, { error: 'That name is already connected.' });
        return;
      }
      accounts.set(name, password);
      const token = randomUUID();
      const client = { name, role: assignRole(), socket: null, timer: null };
      clients.set(token, client);
      client.timer = setTimeout(() => removeClient(token), 5000);
      sendJson(res, 200, { token });
      pushState();
    });
    return;
  }

  const client = getClient(req, url);
  if (url.pathname.startsWith('/api/') && !client) {
    sendJson(res, 401, { error: 'Join the game first.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    sendJson(res, 200, gameState(client));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/move') {
    readJson(req, res, data => {
      const index = data.index;
      if (gameOver || client.role !== currentPlayer || !Number.isInteger(index) || index < 0 || index > 8 || board[index]) {
        sendJson(res, 400, { error: 'That move is not allowed.' });
        return;
      }
      board[index] = currentPlayer;
      for (const [a, b, c] of winningLines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          winner = board[a];
          gameOver = true;
          break;
        }
      }
      if (!gameOver && board.every(mark => mark !== '')) gameOver = true;
      if (!gameOver) currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
      sendJson(res, 200, gameState(client));
      pushState();
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    if (client.role === 'Spectator') {
      sendJson(res, 403, { error: 'Only players can reset the game.' });
      return;
    }
    board = Array(9).fill('');
    currentPlayer = 'X';
    winner = null;
    gameOver = false;
    sendJson(res, 200, gameState(client));
    pushState();
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');
  const client = clients.get(token);
  if (url.pathname !== '/' || !client) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    if (client.timer) clearTimeout(client.timer);
    client.timer = null;
    if (client.socket) client.socket.close();
    client.socket = ws;
    ws.send(JSON.stringify(gameState(client)));
    ws.on('close', () => {
      if (client.socket !== ws) return;
      client.socket = null;
      client.timer = setTimeout(() => removeClient(token), 5000);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
