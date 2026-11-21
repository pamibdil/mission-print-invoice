const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { db, initDb } = require('./db');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== TERBILANG =====
function terbilang(n) {
  n = Math.floor(Math.abs(n));
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  if (n < 12) return s[n];
  if (n < 20) return s[n - 10] + ' belas';
  if (n < 100) return s[Math.floor(n / 10)] + ' puluh' + (n % 10 ? ' ' + s[n % 10] : '');
  if (n < 200) return 'seratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 1000) return s[Math.floor(n / 100)] + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 2000) return 'seribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1000000) return terbilang(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1000000000) return terbilang(Math.floor(n / 1000000)) + ' juta' + (n % 1000000 ? ' ' + terbilang(n % 1000000) : '');
  if (n < 1000000000000) return terbilang(Math.floor(n / 1000000000)) + ' miliar' + (n % 1000000000 ? ' ' + terbilang(n % 1000000000) : '');
  return terbilang(Math.floor(n / 1000000000000)) + ' triliun' + (n % 1000000000000 ? ' ' + terbilang(n % 1000000000000) : '');
}

function terbilangRupiah(n) {
  if (n === 0) return 'nol rupiah';
  const t = terbilang(n).trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1) + ' rupiah';
}

// Helper format tanggal YYYY-MM-DD -> DD-MM-YYYY
function formatTanggalIndo(dateStr) {
  if (!dateStr) return '-';
  const parts = String(dateStr).split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

// Helper mencari file gambar di folder public / root
function findAssetFile(regexPattern) {
  const searchDirs = [
    path.join(__dirname, 'public'),
    __dirname,
    path.join(process.cwd(), 'public'),
    process.cwd()
  ];
  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const found = files.find(f => regexPattern.test(f));
      if (found) return path.join(dir, found);
    }
  }
  return null;
}

// ===== API CONFIG =====
app.get('/api/config', (req, res) => {
  try {
    res.json({
      store: config.store || {},
      services: config.services || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API SIMPAN INVOICE =====
app.post('/api/invoices', async (req, res) => {
  const { number, date, items } = req.body;
  if (!number || !date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }
  const svcMap = Object.fromEntries(config.services.map(s => [s.code, s]));
  let total = 0;
  let cleanItems;
  try {
    cleanItems = items.map(it => {
      const svc = svcMap[it.service_code];
      if (!svc) throw new Error('Jasa tidak dikenal: ' + it.service_code);
      const qty = parseInt(it.qty) || 0;
      const subtotal = svc.price * qty;
      total += subtotal;
      return {
        description: String(it.description || ''),
        service_code: svc.code,
        service_label: svc.label,
        price: svc.price,
        qty,
        subtotal
      };
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const terbilangText = terbilangRupiah(total);

  try {
    const invResult = await db.execute({
      sql: 'INSERT INTO invoices (number, date, total, terbilang) VALUES (?, ?, ?, ?)',
      args: [number, date, total, terbilangText]
    });
    const invId = Number(invResult.lastInsertRowid);

    for (const it of cleanItems) {
      await db.execute({
        sql: 'INSERT INTO invoice_items (invoice_id, description, service_code, service_label, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [invId, it.description, it.service_code, it.service_label, it.price, it.qty, it.subtotal]
      });
    }

    res.json({ id: invId, total, terbilang: terbilangText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API LIST =====
app.get('/api/invoices', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, number, date, total, created_at FROM invoices ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API HAPUS =====
app.delete('/api/invoices/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.execute({ sql: 'DELETE FROM invoice_items WHERE invoice_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM invoices WHERE id = ?', args: [id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== API PDF =====
app.get('/api/invoices/:id/pdf', async (req, res) => {
  const id = parseInt(req.params.id);

  let inv, items;
  try {
    const invResult = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [id] });
    inv = invResult.rows[0];
    if (!inv) return res.status(404).send('Invoice tidak ditemukan');

    const itemsResult = await db.execute({ sql: 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', args: [id] });
    items = itemsResult.rows;
  } catch (err) {
    return res.status(500).send('Gagal mengambil data database');
  }

  try {
    const pdfDoc = await PDFDocument.create();

    // Kertas Horizontal (Landscape)
    const page = pdfDoc.addPage([config.page.height, config.page.width]);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    const margin = 12;
    let y = height - margin;

    // ===== 1. WATERMARK BERULANG (TILE) =====
    const wmText = 'MISSION PRINT';
    const wmSize = 14;
    const wmOpacity = 0.1;
    const angle = 45;

    for (let i = -2; i < 6; i++) {
      for (let j = -2; j < 8; j++) {
        page.drawText(wmText, {
          x: i * 120,
          y: j * 60,
          size: wmSize,
          font: fontBold,
          color: rgb(0.6, 0.6, 0.6),
          opacity: wmOpacity,
          rotate: { type: 'degrees', angle: angle },
        });
      }
    }

    // ===== 2. LOGO PNG DI KANAN ATAS =====
    try {
      const logoFile = findAssetFile(/^logo\.png$/i);
      if (logoFile) {
        const logoBytes = fs.readFileSync(logoFile);
        const img = await pdfDoc.embedPng(logoBytes);

        const logoH = 44;
        const logoW = (img.width / img.height) * logoH;
        const posX = width - margin - logoW;
        const posY = y - logoH - 2;

        page.drawImage(img, { x: posX, y: posY, width: logoW, height: logoH });
      }
    } catch (error) {
      console.error('Gagal memuat logo.png:', error);
    }

    // ===== 3. HEADER TEKS KIRI (TANPA PENGULANGAN NAMA USAHA) =====
    page.drawText('Lokasi:', { x: margin, y: y - 9, size: 7.5, font: fontBold });
    page.drawText('Belakang Seblak Teh Windy,', { x: margin, y: y - 17, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });
    page.drawText('Jl. HS. Ronggo Waluyo', { x: margin, y: y - 25, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });

    page.drawText('Telp:', { x: margin, y: y - 35, size: 7.5, font: fontBold });
    page.drawText('0895371709332 / 0895331827838', { x: margin, y: y - 43, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });

    // Garis pemisah header
    y -= 52;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });

    // Judul & info (Tanggal format DD-MM-YYYY)
    y -= 13;
    page.drawText('INVOICE', { x: margin, y, size: 10, font: fontBold });
    page.drawText('No: ' + inv.number, { x: width - margin - 88, y, size: 7, font });
    y -= 9;
    page.drawText('Tanggal: ' + formatTanggalIndo(inv.date), { x: width - margin - 88, y, size: 7, font });

    // Kolom tabel
    y -= 13;
    const colDesc = margin;
    const colJasa = margin + 130;
    const colHarga = margin + 240;
    const colQty = margin + 290;
    const colSub = margin + 330;

    const drawHeader = (yy) => {
      page.drawText('Deskripsi', { x: colDesc, y: yy, size: 6.5, font: fontBold });
      page.drawText('Jasa', { x: colJasa, y: yy, size: 6.5, font: fontBold });
      page.drawText('Harga', { x: colHarga, y: yy, size: 6.5, font: fontBold });
      page.drawText('Qty', { x: colQty, y: yy, size: 6.5, font: fontBold });
      page.drawText('Subtotal', { x: colSub, y: yy, size: 6.5, font: fontBold });
    };
    drawHeader(y);
    y -= 3;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 9;

    const fmt = (n) => n.toLocaleString('id-ID');

    for (const it of items) {
      const desc = it.description || '-';
      const maxChars = 35;
      const lines = desc.length <= maxChars ? [desc] : [desc.substring(0, maxChars), desc.substring(maxChars, maxChars * 2)];
      page.drawText(lines[0], { x: colDesc, y, size: 6.5, font });
      page.drawText(it.service_label, { x: colJasa, y, size: 5.8, font });
      page.drawText(fmt(it.price), { x: colHarga, y, size: 6.5, font });
      page.drawText(String(it.qty), { x: colQty, y, size: 6.5, font });
      page.drawText(fmt(it.subtotal), { x: colSub, y, size: 6.5, font });
      y -= 8;
      if (lines[1]) {
        page.drawText(lines[1], { x: colDesc, y, size: 6, font });
        y -= 8;
      }
      if (y < margin + 70) break;
    }

    // Total
    y -= 2;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 12;
    page.drawText('Grand Total:', { x: colHarga, y, size: 8, font: fontBold });
    page.drawText('Rp ' + fmt(inv.total), { x: colSub - 8, y, size: 8, font: fontBold });

    // Terbilang (dibatasi lebarnya agar tidak menabrak QRIS di kanan bawah)
    y -= 14;
    page.drawText('Terbilang:', { x: margin, y, size: 6.5, font: fontBold });
    y -= 8;
    const words = inv.terbilang.split(' ');
    let line = '';
    const maxW = width - margin * 2 - 75;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, 6.5) > maxW) {
        page.drawText(line, { x: margin, y, size: 6.5, font });
        y -= 8;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) page.drawText(line, { x: margin, y, size: 6.5, font });

    // ===== 4. KANAN BAWAH: QRIS PEMBAYARAN (ATAU KOLOM TTD JIKA BELUM ADA QRIS) =====
    let hasQris = false;
    try {
      const qrisFile = findAssetFile(/^qris\.png$/i);
      if (qrisFile) {
        const qrisBytes = fs.readFileSync(qrisFile);
        const qrisImg = await pdfDoc.embedPng(qrisBytes);

        const qrisSize = 46;
        const qrisW = (qrisImg.width / qrisImg.height) * qrisSize;
        const qrisX = width - margin - qrisW;
        const qrisY = margin + 4;

        page.drawText('Scan QRIS:', {
          x: qrisX + (qrisW / 2) - 16,
          y: qrisY + qrisSize + 3,
          size: 6,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2)
        });
        page.drawImage(qrisImg, { x: qrisX, y: qrisY, width: qrisW, height: qrisSize });
        hasQris = true;
      }
    } catch (error) {
      console.error('Gagal memuat qris.png:', error);
    }

    if (!hasQris) {
      page.drawText('Hormat Kami,', {
        x: width - margin - 65,
        y: margin + 36,
        size: 6.5,
        font,
        color: rgb(0.25, 0.25, 0.25)
      });
      page.drawText('( Mission Print )', {
        x: width - margin - 72,
        y: margin + 6,
        size: 6.5,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2)
      });
    }

    // Footer Kiri Bawah
    page.drawText('Terima kasih atas kepercayaan Anda.', {
      x: margin,
      y: margin + 6,
      size: 7,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2)
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${inv.number}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Gagal membuat PDF:', err);
    res.status(500).send('Gagal membuat PDF');
  }
});

// ===== INISIALISASI SERVER & VERCEL =====
if (process.env.VERCEL) {
  initDb().catch(console.error);
} else {
  initDb().then(() => {
    app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
  });
}

module.exports = app;
