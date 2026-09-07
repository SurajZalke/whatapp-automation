import axios from 'axios'

// Local dev  → Vite proxy handles /api → localhost:3001
// Netlify    → VITE_API_URL=https://your-service.onrender.com
const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const SOCKET_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: BASE,
  timeout: 15000,
})

export { SOCKET_URL }

// ── Status & QR ───────────────────────────────────────────────────────────────
export const getStatus = () => api.get('/status').then(r => r.data)

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings').then(r => r.data)
export const updateSettings = (settings) => api.post('/settings', settings).then(r => r.data)

// ── Messages ──────────────────────────────────────────────────────────────────
export const getMessages = () => api.get('/messages').then(r => r.data)
export const sendMessage = (chatId, message) =>
  api.post('/send', { chatId, message }).then(r => r.data)

// ── Chats ─────────────────────────────────────────────────────────────────────
export const getChats = () => api.get('/chats').then(r => r.data)

// ── Files ─────────────────────────────────────────────────────────────────────
export const getFiles = () => api.get('/files').then(r => r.data)

export const uploadFile = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const deleteFile = (filename) =>
  api.delete(`/files/${encodeURIComponent(filename)}`).then(r => r.data)

export const sendFile = (chatId, filename, caption) =>
  api.post('/send-file', { chatId, filename, caption }).then(r => r.data)

// ── Memory ────────────────────────────────────────────────────────────────────
export const getMemoryStats = () => api.get('/memory').then(r => r.data)
export const clearChatMemory = (chatId) =>
  api.delete(`/memory/${encodeURIComponent(chatId)}`).then(r => r.data)

// ── Logout ────────────────────────────────────────────────────────────────────
export const logout = () => api.post('/logout').then(r => r.data)

export default api
