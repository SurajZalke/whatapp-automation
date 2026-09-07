import React from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import {
  MessageSquare, Settings, FolderOpen, Activity, Bot, Wifi, WifiOff
} from 'lucide-react'
import { useSocket } from './hooks/useSocket'
import Dashboard from './pages/Dashboard'
import MessagesPage from './pages/MessagesPage'
import FilesPage from './pages/FilesPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { connected, status } = useSocket()

  const stateColor = {
    ready: 'bg-green-500',
    qr: 'bg-yellow-500',
    connecting: 'bg-blue-500',
    disconnected: 'bg-red-500',
    error: 'bg-red-600',
  }[status.state] || 'bg-gray-500'

  const stateLabel = {
    ready: 'Online',
    qr: 'Scan QR',
    connecting: 'Connecting',
    disconnected: 'Offline',
    error: 'Error',
  }[status.state] || 'Unknown'

  const navItems = [
    { to: '/', label: 'Dashboard', icon: Activity, exact: true },
    { to: '/messages', label: 'Messages', icon: MessageSquare },
    { to: '/files', label: 'Files', icon: FolderOpen },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-whatsapp-green rounded-xl flex items-center justify-center">
              <Bot size={22} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-base leading-tight">SK Agent</h1>
              <p className="text-gray-500 text-xs">WhatsApp Automation</p>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <div className="mx-4 mt-4 bg-gray-800 rounded-xl px-3 py-2 flex items-center gap-2">
          <span className={`status-dot ${stateColor} ${status.state === 'ready' ? 'animate-pulse-green' : ''}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white">{stateLabel}</p>
            {status.name && <p className="text-xs text-gray-400 truncate">{status.name}</p>}
          </div>
          {connected ? <Wifi size={14} className="text-green-400 shrink-0" /> : <WifiOff size={14} className="text-red-400 shrink-0" />}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-whatsapp-green text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">SK Agent v1.0 · Local</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-950">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
