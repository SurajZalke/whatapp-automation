import React, { useEffect, useState } from 'react'
import { Bot, MessageSquare, Users, HardDrive, RefreshCw, LogOut } from 'lucide-react'
import { useSocket } from '../hooks/useSocket'
import QRPanel from '../components/QRPanel'
import StatCard from '../components/StatCard'
import MessageFeed from '../components/MessageFeed'
import { getFiles, getMemoryStats, logout } from '../api/client'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'

export default function Dashboard() {
  const { status, qrData, messages, connected } = useSocket()
  const [files, setFiles] = useState([])
  const [memStats, setMemStats] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats() {
    try {
      const [fRes, mRes] = await Promise.all([getFiles(), getMemoryStats()])
      setFiles(fRes.files || [])
      setMemStats(mRes.stats || {})
    } catch {}
  }

  async function handleLogout() {
    if (!window.confirm('Logout from WhatsApp? You will need to scan QR again.')) return
    try {
      await logout()
      toast.success('Logged out successfully')
    } catch (err) {
      toast.error('Logout failed: ' + err.message)
    }
  }

  const totalConversations = Object.keys(memStats).length
  const totalMessages = messages.length
  const incoming = messages.filter(m => m.type === 'incoming').length
  const outgoing = messages.filter(m => m.type !== 'incoming').length

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400 text-sm mt-0.5">
            {connected ? 'Connected to SK Agent backend' : 'Backend disconnected — restart backend server'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadStats} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={15} /> Refresh
          </button>
          {status.state === 'ready' && (
            <button onClick={handleLogout} className="btn-danger flex items-center gap-2 text-sm">
              <LogOut size={15} /> Logout
            </button>
          )}
        </div>
      </div>

      {/* QR Panel (shown when not authenticated) */}
      {(status.state === 'qr' || status.state === 'disconnected' || status.state === 'connecting') && (
        <QRPanel status={status} qrData={qrData} />
      )}

      {/* Connected Info */}
      {status.state === 'ready' && (
        <div className="card bg-gradient-to-r from-whatsapp-darker to-whatsapp-dark border-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
              <Bot size={24} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-lg">SK Agent is Live 🟢</p>
              <p className="text-green-200 text-sm">
                Logged in as <strong>{status.name}</strong>
                {status.phone && ` (+${status.phone})`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<MessageSquare size={20} />}
          label="Messages Today"
          value={totalMessages}
          color="green"
        />
        <StatCard
          icon={<Bot size={20} />}
          label="Replies Sent"
          value={outgoing}
          color="blue"
        />
        <StatCard
          icon={<Users size={20} />}
          label="Active Chats"
          value={totalConversations}
          color="purple"
        />
        <StatCard
          icon={<HardDrive size={20} />}
          label="Files Available"
          value={files.length}
          color="orange"
        />
      </div>

      {/* Live Message Feed */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Live Message Feed</h3>
          <span className="text-xs text-gray-500">{messages.length} messages</span>
        </div>
        <MessageFeed messages={messages} />
      </div>
    </div>
  )
}
