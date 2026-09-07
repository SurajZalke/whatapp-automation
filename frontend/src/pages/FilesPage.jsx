import React, { useState, useEffect, useCallback } from 'react'
import { Upload, Trash2, File, Image, FileText, Download, RefreshCw } from 'lucide-react'
import { getFiles, uploadFile, deleteFile } from '../api/client'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

function fileIcon(mimeType) {
  if (!mimeType) return <File size={18} />
  if (mimeType.startsWith('image/')) return <Image size={18} className="text-blue-400" />
  if (mimeType === 'application/pdf') return <FileText size={18} className="text-red-400" />
  return <File size={18} className="text-gray-400" />
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FilesPage() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => { loadFiles() }, [])

  async function loadFiles() {
    try {
      const res = await getFiles()
      setFiles(res.files || [])
    } catch {
      toast.error('Could not load files')
    }
  }

  async function handleUpload(fileList) {
    const arr = Array.from(fileList)
    if (arr.length === 0) return
    setUploading(true)
    let successCount = 0
    for (const file of arr) {
      try {
        await uploadFile(file)
        successCount++
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`)
      }
    }
    if (successCount > 0) toast.success(`${successCount} file(s) uploaded`)
    await loadFiles()
    setUploading(false)
  }

  async function handleDelete(filename) {
    if (!window.confirm(`Delete "${filename}"?`)) return
    try {
      await deleteFile(filename)
      toast.success('File deleted')
      setFiles(prev => prev.filter(f => f.name !== filename))
    } catch {
      toast.error('Delete failed')
    }
  }

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }, [])

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Files</h2>
          <p className="text-gray-400 text-sm mt-0.5">
            SK Agent will automatically send these when users request them
          </p>
        </div>
        <button onClick={loadFiles} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Upload Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${
          dragOver
            ? 'border-whatsapp-green bg-whatsapp-green/10'
            : 'border-gray-700 hover:border-gray-600'
        }`}
      >
        <Upload size={32} className="mx-auto mb-3 text-gray-500" />
        <p className="text-gray-300 font-medium mb-1">Drag & drop files here</p>
        <p className="text-gray-500 text-sm mb-4">PDF, images, documents — up to 50MB each</p>
        <label className="btn-primary cursor-pointer">
          {uploading ? 'Uploading...' : 'Browse Files'}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
            disabled={uploading}
          />
        </label>
      </div>

      {/* File List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Uploaded Files</h3>
          <span className="text-xs text-gray-500">{files.length} files</span>
        </div>

        {files.length === 0 ? (
          <div className="text-center py-10">
            <File size={36} className="mx-auto mb-3 text-gray-700" />
            <p className="text-gray-500">No files uploaded yet</p>
            <p className="text-gray-600 text-sm mt-1">
              Upload PDFs, images, or documents for SK Agent to share
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map(f => (
              <div
                key={f.name}
                className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 group"
              >
                <div className="shrink-0">{fileIcon(f.mimeType)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{f.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatSize(f.size)} · {f.mimeType}
                    {f.uploadedAt && ` · ${format(new Date(f.uploadedAt), 'dd MMM, HH:mm')}`}
                  </p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={`/uploads/${encodeURIComponent(f.name)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg"
                    title="Preview"
                  >
                    <Download size={14} className="text-gray-300" />
                  </a>
                  <button
                    onClick={() => handleDelete(f.name)}
                    className="p-1.5 bg-red-900/40 hover:bg-red-800 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="card border-whatsapp-darker/50 bg-whatsapp-darker/10">
        <h3 className="font-semibold text-white mb-3">How file sending works</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          <li className="flex gap-2"><span className="text-whatsapp-green">→</span> User sends: <em>"send me the menu"</em></li>
          <li className="flex gap-2"><span className="text-whatsapp-green">→</span> SK Agent detects a file request</li>
          <li className="flex gap-2"><span className="text-whatsapp-green">→</span> Matches keywords like "menu" against uploaded filenames</li>
          <li className="flex gap-2"><span className="text-whatsapp-green">→</span> Sends the best matching file automatically</li>
        </ul>
        <p className="text-xs text-gray-600 mt-3">
          Tip: Name your files descriptively, e.g., <code>restaurant-menu-2024.pdf</code>
        </p>
      </div>
    </div>
  )
}
