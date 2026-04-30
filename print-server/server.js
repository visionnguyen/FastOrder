/**
 * CHABAR Print Server
 * Cài đặt: npm install
 * Chạy: node server.js
 * Cấu hình: http://localhost:3000
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const PORT        = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ── pdf-to-printer (bundles SumatraPDF, không cần cài thêm) ────────────────
let pdfPrinter;
try {
  pdfPrinter = require('pdf-to-printer');
} catch (e) {
  console.warn('⚠️  pdf-to-printer chưa được cài (chạy: npm install)');
}

// ── Config helpers ──────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { printers: [] }; }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    platform: process.platform,
    printerReady: !!pdfPrinter
  });
});

// Danh sách máy in hệ thống
app.get('/api/printers/system', async (req, res) => {
  if (!pdfPrinter) return res.status(503).json({ error: 'pdf-to-printer chưa được cài' });
  try {
    const list = await pdfPrinter.getPrinters();
    res.json({
      printers: list.map(p => ({
        name: p.name || p.deviceId,
        isDefault: p.isDefault || false
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Danh sách máy in đã chia sẻ
app.get('/api/printers/shared', (req, res) => {
  const cfg = loadConfig();
  res.json({ printers: cfg.printers });
});

// Thêm / cập nhật máy in chia sẻ
app.post('/api/printers/shared', (req, res) => {
  const { name, device, description } = req.body;
  if (!name || !device) return res.status(400).json({ error: 'Thiếu name hoặc device' });

  const cfg = loadConfig();
  const idx = cfg.printers.findIndex(p => p.name === name);
  const entry = { name: name.trim(), device: device.trim(), description: (description || '').trim() };

  if (idx >= 0) cfg.printers[idx] = entry;
  else cfg.printers.push(entry);

  saveConfig(cfg);
  res.json({ ok: true, printer: entry });
});

// Xóa máy in chia sẻ
app.delete('/api/printers/shared/:name', (req, res) => {
  const cfg = loadConfig();
  cfg.printers = cfg.printers.filter(p => p.name !== decodeURIComponent(req.params.name));
  saveConfig(cfg);
  res.json({ ok: true });
});

// In PDF
app.post('/api/print', async (req, res) => {
  const { printer: printerName, pdf, jobName } = req.body;
  if (!printerName || !pdf) return res.status(400).json({ error: 'Thiếu printer hoặc pdf' });
  if (!pdfPrinter) return res.status(503).json({ error: 'pdf-to-printer chưa được cài' });

  // Tìm device name từ shared config
  const cfg = loadConfig();
  const shared = cfg.printers.find(p => p.name === printerName);
  const deviceName = shared ? shared.device : printerName;

  // Ghi PDF ra file tạm
  const tmpFile = path.join(os.tmpdir(), `chabar-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, Buffer.from(pdf, 'base64'));
    await pdfPrinter.print(tmpFile, { printer: deviceName, silent: true });
    fs.unlinkSync(tmpFile);
    console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ✅ In "${jobName || 'job'}" → "${deviceName}"`);
    res.json({ ok: true, message: `Đã gửi lệnh in đến "${deviceName}"` });
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch {}
    console.error(`[${new Date().toLocaleTimeString('vi-VN')}] ❌ Lỗi in:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🖨️  CHABAR Print Server v1.0.0`);
  console.log(`   http://localhost:${PORT}  ← trang cấu hình`);
  console.log(`   Ctrl+C để dừng\n`);
});
