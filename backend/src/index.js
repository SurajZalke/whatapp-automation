/**
 * SK Agent - Main Server
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const whatsapp = require('./whatsapp/client');
const memory = require('./memory/conversationMemory');
const fileManager = require('./files/fileManager');
const scheduler = require('./agent/taskScheduler');
const routes = require('./api/routes');

const PORT = process.env.PORT || 3001;

// Accept localhost (dev) + any Netlify domain + custom FRONTEND_URL env var
const ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  /^https:\/\/.*\.netlify\.app$/,        // any Netlify preview/prod URL
  /^https:\/\/.*\.onrender\.com$/,       // Render preview URLs
  process.env.FRONTEND_URL,              // custom domain if set
].filter(Boolean);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log('[Socket.IO] Dashboard connected:', socket.id);
  const state = whatsapp.getState();
  socket.emit('status', { state: state.state, qr: state.qr });
  socket.emit('message_log', whatsapp.getMessageLog());
  socket.on('disconnect', () => console.log('[Socket.IO] Dashboard disconnected:', socket.id));
  socket.on('ping', () => socket.emit('pong'));
});

app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api', routes);
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SK Agent' }));

async function start() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       SK Agent - WhatsApp Bot          ║');
  console.log('╚════════════════════════════════════════╝\n');

  await memory.init();
  console.log('[Server] Memory initialized');

  await fileManager.init();
  console.log('[Server] File manager initialized');

  // Load and start task scheduler
  await scheduler.load();
  scheduler.start();
  console.log('[Server] Task scheduler started');

  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`[Server] API → http://localhost:${PORT}`);
  console.log(`[Server] Dashboard → http://localhost:5173`);

  console.log('\n[WhatsApp] Starting client...');
  await whatsapp.init(io);
}

start().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});

// ── Self-ping keepalive (prevents Render free tier from sleeping) ─────────────
// Pings own /health endpoint every 10-12 minutes (Render sleeps after 15 min)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || null;

if (RENDER_URL) {
  const https = require('https');
  const http = require('http');

  function selfPing() {
    const url = `${RENDER_URL}/health`;
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      console.log(`[Keepalive] Ping → ${url} — ${res.statusCode}`);
    });
    req.on('error', (err) => {
      console.warn(`[Keepalive] Ping failed: ${err.message}`);
    });
    req.end();
  }

  // Random interval between 10–12 minutes so it doesn't look like a bot pattern
  function scheduleNextPing() {
    const ms = (10 + Math.random() * 2) * 60 * 1000; // 10–12 min in ms
    setTimeout(() => {
      selfPing();
      scheduleNextPing();
    }, ms);
  }

  // First ping after 2 min (let server fully boot first)
  setTimeout(() => {
    selfPing();
    scheduleNextPing();
  }, 2 * 60 * 1000);

  console.log(`[Keepalive] Self-ping active → ${RENDER_URL}/health every 10–12 min`);
} else {
  console.log('[Keepalive] RENDER_EXTERNAL_URL not set — self-ping disabled (local mode)');
}
