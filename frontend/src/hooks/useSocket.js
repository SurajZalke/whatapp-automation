import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

// Local dev  → connect to localhost:3001
// Netlify    → connect to VITE_API_URL (Render backend)
const SOCKET_URL = import.meta.env.VITE_API_URL || 'https://whatapp-automation-8erc.onrender.com'

export function useSocket() {
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState({ state: 'disconnected' })
  const [qrData, setQrData] = useState(null)
  const [messages, setMessages] = useState([])

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      console.log('[Socket] Connected to SK Agent backend')
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('status', (data) => {
      setStatus(data)
      if (data.state === 'ready') setQrData(null)
    })

    socket.on('qr', (data) => {
      setQrData(data)
      setStatus(prev => ({ ...prev, state: 'qr' }))
    })

    socket.on('message_log', (data) => {
      if (Array.isArray(data)) {
        setMessages(data.slice(-100))
      } else {
        setMessages(prev => [...prev, data].slice(-100))
      }
    })

    socket.on('settings_updated', () => {})

    return () => { socket.disconnect() }
  }, [])

  return { socket: socketRef.current, connected, status, qrData, messages }
}
