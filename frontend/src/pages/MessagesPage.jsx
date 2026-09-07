import React, { useState, useEffect, useRef } from 'react'
import { Send, ArrowDownCircle, ArrowUpCircle, Paperclip, RefreshCw } from 'lucide-react'
import { useSocket } from '../hooks/useSocket'
import { getChats, sendMessage, getFiles, sendFile } from '../api/client'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

export default function MessagesPage() {
  const { messages, status } = useSocket()
  const [chats, setChats] = useState([])
  const [files, setFiles] = useState([])
  const [selectedChat, setSelectedChat] = useState('')
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState('all')
  const [loadingChats, setLoadingChats] = useState(false)
  const loadedRef = useRef(false)

  // Auto-load chats once WhatsApp is ready
  useEffect(() => {
    if (status.state === 'ready' && !loadedRef.current) {
      loadedRef.current = true
      loadChats()
      loadFiles()
    }
  }, [status.state])

  async function loadChats() {
    if (status.state !== 'ready') {
      toast.error('WhatsApp not connected yet')
      return
    }
    setLoadingChats(true)
    try {
      const res = await getChats()
      setChats(res.chats || [])
      if ((res.chats || []).length === 0) {
        toast('No chats found yet — try again in a moment', { icon: 'ℹ️' })
      }
    } catch {
      toast.error('Could not load chats')
    } finally {
      setLoadingChats(false)
    }
  }

  async function loadFiles() {
    try {
      const res = await getFiles()
      setFiles(res.files || [])
    } catch {}
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!selectedChat) return toast.error('Select a chat first')
    if (!text.trim() && !selectedFile) return toast.error('Enter a message or choose a file')

    setSending(true)
    try {
      if (text.trim()) {
        await sendMessage(selectedChat, text.trim())
        toast.success('Message sent!')
        setText('')
      }
      if (selectedFile) {
        await sendFile(selectedChat, selectedFile, text.trim())
        toast.success('File sent!')
        setSelectedFile('')
        setText('')
      }
    } catch (err) {
      toast.error('Send failed: ' + err.message)
    } finally {
      setSending(false)
    }
  }

  const filtered = messages.filter(m => {
    if (filter === 'incoming') return m.type === 'incoming'
    if (filter === 'outgoing') return m.type !== 'incoming'
    return true
  })

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Messages</h2>
        <button onClick={loadChats} disabled={loadingChats} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={15} className={loadingChats ? 'animate-spin' : ''} />
          {loadingChats ? 'Loading...' : 'Load Chats'}
        </button>
      </div>

      {/* Manual Send Panel */}
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Send Message Manually</h3>
        <form onSubmit={handleSend} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={selectedChat}
              onChange={e => setSelectedChat(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-whatsapp-green"
            >
              <option value="">— Select Chat —</option>
              {chats.map(c => (
                <option key={c.id} value={c.id}>
                  {c.isGroup ? '👥 ' : '👤 '}{c.name}
                  {c.unreadCount > 0 ? ` (${c.unreadCount} unread)` : ''}
                </option>
              ))}
            </select>

            <select
              value={selectedFile}
              onChange={e => setSelectedFile(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-whatsapp-green"
            >
              <option value="">— No file (optional) —</option>
              {files.map(f => (
                <option key={f.name} value={f.name}>{f.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={selectedFile ? 'Caption (optional)...' : 'Type a message...'}
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-whatsapp-green"
            />
            <button type="submit" disabled={sending} className="btn-primary flex items-center gap-2">
              {selectedFile ? <Paperclip size={16} /> : <Send size={16} />}
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {/* Message Log */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Message History</h3>
          <div className="flex gap-2">
            {['all', 'incoming', 'outgoing'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-lg capitalize transition-colors ${
                  filter === f ? 'bg-whatsapp-green text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No messages yet</p>
          ) : (
            [...filtered].reverse().map((msg, i) => (
              <div
                key={msg.id || i}
                className={`flex gap-3 p-3 rounded-xl ${
                  msg.type === 'incoming' ? 'bg-gray-800' : 'bg-gray-800/50'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {msg.type === 'incoming' ? (
                    <ArrowDownCircle size={16} className="text-green-400" />
                  ) : (
                    <ArrowUpCircle size={16} className="text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-white">{msg.senderName}</span>
                    {msg.isGroup && (
                      <span className="text-xs text-gray-500">in {msg.groupName}</span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 break-words">{msg.message}</p>
                  {msg.type === 'outgoing_file' && (
                    <span className="text-xs text-whatsapp-green mt-1 block">📎 {msg.fileName}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
