/**
 * SK Agent - Express API Routes
 * Dashboard ↔ Backend communication
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

const whatsapp = require('../whatsapp/client');
const fileManager = require('../files/fileManager');
const memory = require('../memory/conversationMemory');
const scheduler = require('../agent/taskScheduler');

// ── File Upload Setup ──────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.ensureDir(fileManager.UPLOADS_DIR);
    cb(null, fileManager.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ── Debug logs endpoint ───────────────────────────────────────────────────────
const _startupLogs = [];
const _origConsoleError = console.error.bind(console);
const _origConsoleWarn  = console.warn.bind(console);
console.error = (...a) => { _origConsoleError(...a); _startupLogs.push({ level:'error', msg: a.join(' '), t: Date.now() }); if (_startupLogs.length > 50) _startupLogs.shift(); };
console.warn  = (...a) => { _origConsoleWarn(...a);  _startupLogs.push({ level:'warn',  msg: a.join(' '), t: Date.now() }); if (_startupLogs.length > 50) _startupLogs.shift(); };

router.get('/debug-logs', (req, res) => {
  const state = whatsapp.getState();
  res.json({ state, logs: _startupLogs.slice(-20) });
});

router.get('/status', (req, res) => {
  const state = whatsapp.getState();
  res.json({ success: true, ...state });
});

// ── QR page — open in browser to scan (useful on Render where no terminal UI) ──
router.get('/qr-page', async (req, res) => {
  const state = whatsapp.getState();
  if (state.state === 'ready') {
    return res.send(`<!DOCTYPE html><html><body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center;padding:60px">
      <h2>✅ WhatsApp is Connected!</h2>
      <p>SK Agent is online and listening for messages.</p>
    </body></html>`);
  }
  if (state.state !== 'qr' || !state.qr) {
    return res.send(`<!DOCTYPE html><html>
    <head><meta http-equiv="refresh" content="3"></head>
    <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px">
      <h2>⏳ Waiting for QR code...</h2>
      <p>State: <b style="color:#f90">${state.state}</b></p>
      <p style="color:#aaa;font-size:13px">This page auto-refreshes every 3 seconds.</p>
      <p style="color:#aaa;font-size:13px">If state stays "disconnected" for more than 60s,<br>
      check Render Logs for Chrome/Puppeteer errors.</p>
      <hr style="border-color:#333;margin:30px auto;width:300px">
      <p style="font-size:12px;color:#555">
        Debug: <a href="/health" style="color:#25D366">/health</a> &nbsp;|&nbsp; 
        <a href="/api/status" style="color:#25D366">/api/status</a> &nbsp;|&nbsp;
        <a href="/api/debug-logs" style="color:#f90">/api/debug-logs ← check this for errors</a>
      </p>
    </body></html>`);
  }
  // Convert raw QR string → base64 PNG
  let qrBase64 = '';
  try {
    const qrcode = require('qrcode');
    qrBase64 = await qrcode.toDataURL(state.qr);
  } catch { qrBase64 = ''; }

  res.send(`<!DOCTYPE html><html>
  <head>
    <title>SK Agent — Scan QR</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { background:#111; color:#fff; font-family:sans-serif; text-align:center; padding:30px; margin:0; }
      .qr-wrap { display:inline-block; background:white; padding:16px; border-radius:16px; margin:20px auto; }
      img  { display:block; width:320px; height:320px; }
      h2   { color:#25D366; margin-bottom:6px; }
      p    { color:#aaa; font-size:14px; margin:6px 0; }
      .tip { background:#1a3a1a; border:1px solid #25D366; border-radius:8px; padding:12px; margin:16px auto; max-width:400px; font-size:13px; color:#cfc; }
      .refresh-bar { width:100%; max-width:400px; height:4px; background:#333; border-radius:2px; margin:10px auto; overflow:hidden; }
      .refresh-fill { height:4px; background:#25D366; width:100%; transition:width .2s linear; }
    </style>
  </head>
  <body>
    <h2>📱 Scan QR to Connect WhatsApp</h2>
    <p>Open WhatsApp → ⋮ Menu → Linked Devices → Link a Device</p>
    <div class="qr-wrap">
      ${qrBase64 ? `<img src="${qrBase64}" alt="QR Code"/>` : '<p style="color:red;padding:20px">QR generation failed — refreshing...</p>'}
    </div>
    <div class="refresh-bar"><div id="refresh-fill" class="refresh-fill"></div></div>
    <p id="refresh-text" style="font-size:12px;color:#666">Checking for a new QR...</p>
    <div class="tip">
      ⚡ <b>Tip:</b> After scanning, wait up to 30 seconds for confirmation.<br>
      If it fails, this page will show a new QR automatically. You have up to 5 minutes to connect.
    </div>
    <script>
      const pageQr = ${JSON.stringify(state.qr)};
      let seconds = 8;
      async function refreshQr() {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' });
          const state = await response.json();
          if (state.state === 'ready') {
            document.body.innerHTML = '<h2 style="color:#25D366;margin-top:80px">WhatsApp connected</h2><p>SK Agent is online and listening for messages.</p>';
            return;
          }
          if (state.state === 'qr' && state.qr && state.qr !== pageQr) window.location.reload();
        } catch {}
      }
      setInterval(() => {
        seconds = seconds <= 1 ? 8 : seconds - 1;
        document.getElementById('refresh-fill').style.width = (seconds / 8 * 100) + '%';
        document.getElementById('refresh-text').textContent = 'Checking for a new QR in ' + seconds + 's';
      }, 1000);
      setInterval(refreshQr, 2000);
    </script>
  </body></html>`);
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  res.json({ success: true, settings: whatsapp.getSettings() });
});

router.post('/settings', express.json(), (req, res) => {
  whatsapp.updateSettings(req.body);
  res.json({ success: true, settings: whatsapp.getSettings() });
});

// ── Message Log ───────────────────────────────────────────────────────────────

router.get('/messages', (req, res) => {
  res.json({ success: true, messages: whatsapp.getMessageLog() });
});

// ── Chats ─────────────────────────────────────────────────────────────────────

router.get('/chats', async (req, res) => {
  try {
    const chats = await whatsapp.getChats();
    res.json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Send Manual Message ───────────────────────────────────────────────────────

router.post('/send', express.json(), async (req, res) => {
  const { chatId, message } = req.body;
  if (!chatId || !message) {
    return res.status(400).json({ success: false, error: 'chatId and message required' });
  }
  try {
    await whatsapp.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Send File ─────────────────────────────────────────────────────────────────

router.post('/send-file', express.json(), async (req, res) => {
  const { chatId, filename, caption } = req.body;
  if (!chatId || !filename) {
    return res.status(400).json({ success: false, error: 'chatId and filename required' });
  }
  try {
    const filePath = path.join(fileManager.UPLOADS_DIR, filename);
    await whatsapp.sendFile(chatId, filePath, caption || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── File Management ───────────────────────────────────────────────────────────

router.get('/files', async (req, res) => {
  try {
    const files = await fileManager.listFiles();
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/files/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  res.json({
    success: true,
    file: {
      name: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    },
  });
});

router.delete('/files/:filename', async (req, res) => {
  try {
    await fileManager.deleteFile(req.params.filename);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Memory / Conversations ────────────────────────────────────────────────────

router.get('/memory', (req, res) => {
  res.json({ success: true, stats: memory.getStats() });
});

router.delete('/memory/:chatId', (req, res) => {
  memory.clearHistory(req.params.chatId);
  res.json({ success: true });
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Tasks / Scheduler ─────────────────────────────────────────────────────────

router.get('/tasks', (req, res) => {
  const all = scheduler.getAllPending();
  res.json({ success: true, tasks: all });
});

router.delete('/tasks/:id', (req, res) => {
  const ok = scheduler.cancelTask(req.params.id);
  res.json({ success: ok });
});

router.delete('/tasks/chat/:chatId', (req, res) => {
  const count = scheduler.cancelAllForChat(decodeURIComponent(req.params.chatId));
  res.json({ success: true, cancelled: count });
});

module.exports = router;
