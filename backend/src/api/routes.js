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

// ── Status & QR ───────────────────────────────────────────────────────────────

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
        <a href="/api/status" style="color:#25D366">/api/status</a>
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
    <meta http-equiv="refresh" content="25">
    <style>
      body { background:#111; color:#fff; font-family:sans-serif; text-align:center; padding:40px; }
      img  { border:8px solid white; border-radius:12px; width:300px; height:300px; }
      h2   { color:#25D366; }
      p    { color:#aaa; font-size:14px; }
    </style>
  </head>
  <body>
    <h2>📱 Scan QR to Connect WhatsApp</h2>
    <p>Open WhatsApp → Linked Devices → Link a Device → Scan below</p>
    <br>
    ${qrBase64 ? `<img src="${qrBase64}" alt="QR Code"/>` : '<p style="color:red">QR image generation failed — try refreshing</p>'}
    <p style="margin-top:20px">⚠️ QR expires in ~60s — page auto-refreshes every 25s</p>
    <p><a href="/api/qr-page" style="color:#25D366">Click here to manually refresh</a></p>
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
