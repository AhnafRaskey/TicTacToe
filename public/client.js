// Ahnaf Raskey
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');
const identityText = document.getElementById('identity');
const joinForm = document.getElementById('joinForm');
const resetBtn = document.getElementById('resetBtn');
const CELL_SIZE = 200;

let board = Array(9).fill('');
let currentPlayer = 'X';
let role = 'Spectator';
let gameOver = false;
let token = sessionStorage.getItem('ticTacToeToken');
let ws;

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'black';
  ctx.beginPath();
  for (let position = CELL_SIZE; position < canvas.width; position += CELL_SIZE) {
    ctx.moveTo(position, 0);
    ctx.lineTo(position, canvas.height);
    ctx.moveTo(0, position);
    ctx.lineTo(canvas.width, position);
  }
  ctx.stroke();

  board.forEach((mark, index) => {
    if (!mark) return;
    const x = (index % 3) * CELL_SIZE;
    const y = Math.floor(index / 3) * CELL_SIZE;
    ctx.beginPath();
    if (mark === 'X') {
      ctx.moveTo(x + 30, y + 30);
      ctx.lineTo(x + 170, y + 170);
      ctx.moveTo(x + 170, y + 30);
      ctx.lineTo(x + 30, y + 170);
    } else {
      ctx.arc(x + 100, y + 100, 70, 0, Math.PI * 2);
    }
    ctx.stroke();
  });
}

function showState(state) {
  board = state.board;
  currentPlayer = state.currentPlayer;
  role = state.role;
  gameOver = state.gameOver;
  identityText.textContent = `Logged in as ${state.name} (${role})`;
  statusText.textContent = state.winner ? `Winner: ${state.winner}` :
    gameOver ? "It's a tie!" : `Player ${currentPlayer} Turn`;
  resetBtn.disabled = role === 'Spectator';
  joinForm.hidden = true;
  drawBoard();
}

function connect() {
  if (ws) ws.close();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/?token=${encodeURIComponent(token)}`);
  const connection = ws;
  ws.onmessage = event => showState(JSON.parse(event.data));
  ws.onerror = () => {
    statusText.textContent = 'Connection lost. Reconnecting...';
  };
  ws.onclose = () => {
    if (ws === connection && token) setTimeout(connect, 1000);
  };
}

async function request(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

joinForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('name').value,
        password: document.getElementById('password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    token = result.token;
    sessionStorage.setItem('ticTacToeToken', token);
    document.getElementById('password').value = '';
    connect();
  } catch (error) {
    statusText.textContent = error.message;
  }
});

canvas.addEventListener('click', async event => {
  if (!token || gameOver || role !== currentPlayer) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);
  if (col < 0 || col > 2 || row < 0 || row > 2) return;
  const index = row * 3 + col;
  if (board[index]) return;
  try {
    showState(await request('/api/move', { index }));
  } catch (error) {
    statusText.textContent = error.message;
  }
});

resetBtn.addEventListener('click', async () => {
  if (!token || role === 'Spectator') return;
  try {
    showState(await request('/api/reset', {}));
  } catch (error) {
    statusText.textContent = error.message;
  }
});

async function restoreSession() {
  if (!token) return;
  try {
    const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Session expired. Join again.');
    showState(await response.json());
    connect();
  } catch (error) {
    token = null;
    sessionStorage.removeItem('ticTacToeToken');
    statusText.textContent = error.message;
  }
}

resetBtn.disabled = true;
drawBoard();
restoreSession();
