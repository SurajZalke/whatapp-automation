# SK Agent - Start Script (PowerShell)
# Run this file to start both backend and frontend

Write-Host ""
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║       SK Agent - WhatsApp Bot          ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Start backend in new window
Write-Host "[1/2] Starting Backend (port 3001)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; npm start" -WindowStyle Normal

Start-Sleep -Seconds 3

# Start frontend in new window  
Write-Host "[2/2] Starting Frontend (port 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "✓ SK Agent is starting up!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:  http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Backend:    http://localhost:3001" -ForegroundColor Yellow
Write-Host ""
Write-Host "Scan the QR code in the backend terminal to connect WhatsApp." -ForegroundColor White
Write-Host "Press any key to open the dashboard in your browser..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Start-Process "http://localhost:5173"
