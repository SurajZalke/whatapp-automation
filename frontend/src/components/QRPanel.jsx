import React from 'react'
import { QrCode, Loader2, Wifi } from 'lucide-react'

export default function QRPanel({ status, qrData }) {
  if (status.state === 'connecting') {
    return (
      <div className="card flex flex-col items-center gap-4 py-10">
        <Loader2 size={36} className="text-whatsapp-green animate-spin" />
        <div className="text-center">
          <p className="text-white font-semibold">Connecting to WhatsApp...</p>
          <p className="text-gray-400 text-sm mt-1">
            {status.message || 'Please wait, loading your account'}
          </p>
          {status.percent !== undefined && (
            <div className="mt-3 w-48 bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-whatsapp-green h-1.5 rounded-full transition-all"
                style={{ width: `${status.percent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (status.state === 'disconnected' && !qrData) {
    return (
      <div className="card flex flex-col items-center gap-4 py-10 border-yellow-800/30">
        <Wifi size={36} className="text-yellow-500" />
        <div className="text-center">
          <p className="text-white font-semibold">Waiting for WhatsApp Client</p>
          <p className="text-gray-400 text-sm mt-1">
            Start the backend server and wait for the QR code to appear
          </p>
        </div>
      </div>
    )
  }

  if (status.state === 'qr' && qrData) {
    return (
      <div className="card flex flex-col md:flex-row items-center gap-8 py-6">
        {/* QR Image */}
        <div className="shrink-0">
          {qrData.qrBase64 ? (
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              <img
                src={qrData.qrBase64}
                alt="WhatsApp QR Code"
                className="w-52 h-52"
              />
            </div>
          ) : (
            <div className="w-52 h-52 bg-gray-800 rounded-2xl flex items-center justify-center">
              <QrCode size={48} className="text-gray-600" />
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="flex-1">
          <h3 className="text-xl font-bold text-white mb-3">Scan to Login</h3>
          <ol className="space-y-3">
            {[
              'Open WhatsApp on your phone',
              'Tap Menu (⋮) → Linked Devices',
              'Tap "Link a Device"',
              'Point your phone at the QR code',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
                <span className="w-6 h-6 bg-whatsapp-green rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-xl">
            <p className="text-yellow-300 text-xs">
              ⚠️ QR code expires in ~60 seconds. If it expires, a new one will appear automatically.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return null
}
