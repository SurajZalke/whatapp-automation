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
