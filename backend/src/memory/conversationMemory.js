/**
 * SK Agent - Conversation Memory Manager
 * Keeps per-chat history for context-aware replies
 */

const fs = require('fs-extra');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '../../data/memory');
const MAX_HISTORY = 20; // max messages per chat to keep in memory

// In-memory store: { chatId: [{ role, content, timestamp }] }
const store = new Map();

async function init() {
  await fs.ensureDir(MEMORY_DIR);
  // Load persisted memory from disk
  try {
    const files = await fs.readdir(MEMORY_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const chatId = file.replace('.json', '');
        const data = await fs.readJson(path.join(MEMORY_DIR, file));
        store.set(chatId, data);
      }
    }
    console.log(`[Memory] Loaded ${store.size} conversation histories`);
  } catch (e) {
    console.log('[Memory] Starting fresh');
  }
}

function getHistory(chatId) {
  return store.get(chatId) || [];
}

function addMessage(chatId, role, content) {
  if (!store.has(chatId)) {
    store.set(chatId, []);
  }
  const history = store.get(chatId);
  history.push({ role, content, timestamp: Date.now() });

  // Trim to MAX_HISTORY
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  // Persist async (non-blocking)
  persistChat(chatId, history).catch(() => {});
  return history;
}

async function persistChat(chatId, history) {
  const filePath = path.join(MEMORY_DIR, `${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  await fs.writeJson(filePath, history, { spaces: 2 });
}

function clearHistory(chatId) {
  store.delete(chatId);
  const filePath = path.join(MEMORY_DIR, `${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  fs.remove(filePath).catch(() => {});
}

function getAllChats() {
  return Array.from(store.keys());
}

function getStats() {
  const stats = {};
  for (const [chatId, history] of store.entries()) {
    stats[chatId] = history.length;
  }
  return stats;
}

module.exports = { init, getHistory, addMessage, clearHistory, getAllChats, getStats };
