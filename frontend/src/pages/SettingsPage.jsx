import React, { useState, useEffect } from 'react'
import { Save, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { getSettings, updateSettings, getMemoryStats, clearChatMemory } from '../api/client'
import toast from 'react-hot-toast'

function Toggle({ enabled, onToggle, label, description }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <button onClick={onToggle} className="shrink-0 ml-4">
        {enabled ? (
          <ToggleRight size={28} className="text-whatsapp-green" />
        ) : (
          <ToggleLeft size={28} className="text-gray-600" />
        )}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    autoReply: true,
    replyToGroups: false,
    typingDelay: true,
    whitelistedOnly: false,
    blacklistedChats: [],
    whitelistedChats: [],
  })
  const [memStats, setMemStats] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
    loadMemory()
  }, [])

  async function loadSettings() {
    try {
      const res = await getSettings()
      setSettings(res.settings)
    } catch {
      toast.error('Could not load settings')
    }
  }

  async function loadMemory() {
    try {
      const res = await getMemoryStats()
      setMemStats(res.stats || {})
    } catch {}
  }

  function toggle(key) {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings(settings)
      toast.success('Settings saved!')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearMemory(chatId) {
    try {
      await clearChatMemory(chatId)
      toast.success('Chat memory cleared')
      loadMemory()
    } catch {
      toast.error('Failed to clear memory')
    }
  }

  const chatIds = Object.keys(memStats)

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white">Settings</h2>

      {/* Auto-Reply Settings */}
      <div className="card">
        <h3 className="font-semibold text-white mb-3">Auto-Reply Behavior</h3>

        <Toggle
          enabled={settings.autoReply}
          onToggle={() => toggle('autoReply')}
          label="Auto Reply"
          description="SK Agent automatically replies to incoming messages"
        />
        <Toggle
          enabled={settings.replyToGroups}
          onToggle={() => toggle('replyToGroups')}
          label="Reply in Groups"
          description="Reply to messages in group chats (not just DMs)"
        />
        <Toggle
          enabled={settings.typingDelay}
          onToggle={() => toggle('typingDelay')}
          label="Typing Indicator"
          description="Show 'typing...' before sending reply (feels more natural)"
        />
        <Toggle
          enabled={settings.whitelistedOnly}
          onToggle={() => toggle('whitelistedOnly')}
          label="Whitelist Mode"
          description="Only reply to specific whitelisted chat IDs"
        />

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary mt-4 flex items-center gap-2"
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Conversation Memory */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-white">Conversation Memory</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              SK Agent remembers up to 20 messages per chat for context
            </p>
          </div>
          <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-lg">
            {chatIds.length} chats stored
          </span>
        </div>

        {chatIds.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">No conversation history yet</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {chatIds.map(chatId => (
              <div
                key={chatId}
                className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-white font-mono truncate max-w-xs">{chatId}</p>
                  <p className="text-xs text-gray-500">{memStats[chatId]} messages stored</p>
                </div>
                <button
                  onClick={() => handleClearMemory(chatId)}
                  className="p-1.5 text-red-400 hover:bg-red-900/30 rounded-lg"
                  title="Clear memory"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="card bg-gray-900/50">
        <h3 className="font-semibold text-white mb-3">About SK Agent</h3>
        <div className="space-y-2 text-sm text-gray-400">
          <p>🤖 <strong className="text-white">Model:</strong> Groq llama-3.3-70b (primary) → Gemini 1.5 Flash (fallback)</p>
          <p>🔑 <strong className="text-white">API Keys:</strong> 4 Groq keys + 3 Gemini keys with auto-rotation</p>
          <p>💾 <strong className="text-white">Memory:</strong> Per-chat conversation history, persisted to disk</p>
          <p>📎 <strong className="text-white">Files:</strong> Auto-matches and sends files based on request keywords</p>
          <p>🌐 <strong className="text-white">Language:</strong> Replies in the same language as the sender</p>
          <p>⚡ <strong className="text-white">Mode:</strong> Fully local — no external automation services</p>
        </div>
      </div>
    </div>
  )
}
