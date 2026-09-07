import React, { useEffect, useRef } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Paperclip } from 'lucide-react'
import { format } from 'date-fns'

export default function MessageFeed({ messages }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-600">
        <ArrowDownCircle size={32} className="mb-3" />
        <p className="text-sm">Waiting for messages...</p>
        <p className="text-xs mt-1">Messages will appear here in real-time</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
      {messages.map((msg, i) => {
        const isIncoming = msg.type === 'incoming'
        const isFile = msg.type === 'outgoing_file'
        return (
          <div
            key={msg.id || i}
            className={`flex gap-3 items-start p-3 rounded-xl transition-colors ${
              isIncoming ? 'bg-gray-800/80' : 'bg-gray-800/40'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isIncoming ? (
                <ArrowDownCircle size={15} className="text-green-400" />
              ) : isFile ? (
                <Paperclip size={15} className="text-whatsapp-green" />
              ) : (
                <ArrowUpCircle size={15} className="text-blue-400" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-white">{msg.senderName}</span>
                {msg.isGroup && (
                  <span className="text-xs text-gray-500 truncate">↳ {msg.groupName}</span>
                )}
                <span className="text-xs text-gray-600 ml-auto shrink-0">
                  {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm:ss') : ''}
                </span>
              </div>
              <p className="text-sm text-gray-300 mt-0.5 break-words leading-relaxed">
                {msg.message}
              </p>
              {isFile && msg.fileName && (
                <span className="text-xs text-whatsapp-green mt-1 block">📎 {msg.fileName}</span>
              )}
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
