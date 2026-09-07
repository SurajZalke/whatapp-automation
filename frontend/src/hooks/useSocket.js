import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3001'

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
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      console.log('[Socket] Connected to SK Agent backend')
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    // WhatsApp status updates
    socket.on('status', (data) => {
      setStatus(data)
      if (data.state === 'ready') setQrData(null)
    })

    // QR code
    socket.on('qr', (data) => {
      setQrData(data)
      setStatus(prev => ({ ...prev, state: 'qr' }))
    })

    // Incoming message log (bulk or single)
    socket.on('message_log', (data) => {
      if (Array.isArray(data)) {
        setMessages(data.slice(-100))
      } else {
        setMessages(prev => {
          const updated = [...prev, data]
          return updated.slice(-100)
        })
      }
    })

    socket.on('settings_updated', () => {
      // Settings updated, components can re-fetch
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  return { socket: socketRef.current, connected, status, qrData, messages }
}
