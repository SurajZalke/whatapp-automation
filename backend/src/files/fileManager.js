/**
 * SK Agent - File Manager
 * Manages uploaded files and matches file requests to actual files
 */

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const { MessageMedia } = require('whatsapp-web.js');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

async function init() {
  await fs.ensureDir(UPLOADS_DIR);
  console.log('[FileManager] Uploads dir ready:', UPLOADS_DIR);
}

// ── List all uploaded files ────────────────────────────────────────────────────

async function listFiles() {
  await fs.ensureDir(UPLOADS_DIR);
  const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(UPLOADS_DIR, entry.name);
      const stats = await fs.stat(filePath);
      files.push({
        name: entry.name,
        path: filePath,
        size: stats.size,
        mimeType: mime.lookup(entry.name) || 'application/octet-stream',
        uploadedAt: stats.mtime,
      });
    }
  }
  return files;
}

// ── Find best matching file for a request ─────────────────────────────────────

async function findMatchingFile(fileRequest) {
  const files = await listFiles();
  if (files.length === 0) return null;

  const keywords = (fileRequest.keywords || []).map(k => k.toLowerCase());
  const description = (fileRequest.description || '').toLowerCase();
  const fileType = (fileRequest.fileType || '').toLowerCase();

  // Score each file
  const scored = files.map(f => {
    const nameLower = f.name.toLowerCase();
    let score = 0;

    // Keyword match in filename
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score += 10;
    }

    // Description words in filename
    const descWords = description.split(/\s+/);
    for (const word of descWords) {
      if (word.length > 3 && nameLower.includes(word)) score += 5;
    }

    // File type match
    if (fileType === 'pdf' && f.mimeType === 'application/pdf') score += 3;
    if (fileType === 'image' && f.mimeType.startsWith('image/')) score += 3;

    return { ...f, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return best match if score > 0, otherwise return first file
  return scored[0].score > 0 ? scored[0] : null;
}

// ── Convert file to WhatsApp MessageMedia ─────────────────────────────────────

async function fileToMessageMedia(filePath) {
  const data = await fs.readFile(filePath, { encoding: 'base64' });
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const filename = path.basename(filePath);
  return new MessageMedia(mimeType, data, filename);
}

// ── Save uploaded file from API ────────────────────────────────────────────────

async function saveUploadedFile(sourcePath, originalName) {
  await fs.ensureDir(UPLOADS_DIR);
  const destPath = path.join(UPLOADS_DIR, originalName);
  await fs.copy(sourcePath, destPath);
  return destPath;
}

async function deleteFile(filename) {
  const filePath = path.join(UPLOADS_DIR, filename);
  await fs.remove(filePath);
}

module.exports = {
  init,
  listFiles,
  findMatchingFile,
  fileToMessageMedia,
  saveUploadedFile,
  deleteFile,
  UPLOADS_DIR,
};
