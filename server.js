const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
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
    return res.status(500).send("Gagal mengambil data database");
  }

  const pdfDoc = await PDFDocument.create();
  
  // Kertas Horizontal (Landscape)
  const page = pdfDoc.addPage([config.page.height, config.page.width]);
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 12;
  let y = height - margin;

  // ===== 1. WATERMARK DIAGONAL =====
  page.drawText('MISSION PRINT', {
    x: width / 2 - 150,
    y: height / 2 - 20,
    size: 50,
    font: fontBold,
    color: rgb(0.85, 0.85, 0.85), 
    opacity: 0.3,                 
    rotate: { type: 'degrees', angle: 45 },
  });

  // ===== 2. LOGO DARI URL (KANAN ATAS) =====
  const logoUrl = 'https://invoice-mission-print.vercel.app/logo.png'; // Pastikan URL ini sesuai domain Vercel Anda
  let headerX = margin;
  
  try {
    const getImageBuffer = (url) => {
      return new Promise((resolve, reject) => {
        https.get(url, (res) => {
          const data = [];
          res.on('data', (chunk) => data.push(chunk));
          res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
      });
    };

    const logoBytes = await getImageBuffer(logoUrl);
    const img = await pdfDoc.embedPng(logoBytes);
    
    const logoH = 30;
    const logoW = (img.width / img.height) * logoH;
    
    // Posisi Kanan Atas
    const posX = width - margin - logoW; 
    const posY = y - logoH; 

    page.drawImage(img, { x: posX, y: posY, width: logoW, height: logoH });
    
  } catch (error) {
    console.error("Gagal mengunduh logo:", error);
  }

  // ===== 3. HEADER TEKS =====
  page.drawText(config.store.name, { x: headerX, y: y - 10, size: 12, font: fontBold });
  
  page.drawText('Lokasi:', { x: headerX, y: y - 21, size: 7.5, font: fontBold });
  page.drawText('Belakang Seblak Teh Windy,', { x: headerX, y: y - 29, size: 7.5, font, color: rgb(0.25,0.25,0.25) });
  page.drawText('Jl. HS. Ronggo Waluyo', { x: headerX, y: y - 37, size: 7.5, font, color: rgb(0.25,0.25,0.25) });
  
  page.drawText('Telp:', { x: headerX, y: y - 45, size: 7.5, font: fontBold });
  page.drawText('0895371709332', { x: headerX, y: y - 53, size: 7.5, font, color: rgb(0.25,0.25,0.25) });
  page.drawText('0895331827838', { x: headerX, y: y - 61, size: 7.5, font, color: rgb(0.25,0.25,0.25) });

  // Garis pemisah
  y -= 68; 
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0,0,0) });

  // Judul & info
  y -= 13;
  page.drawText('INVOICE', { x: margin, y, size: 10, font: fontBold });
  page.drawText('No: ' + inv.number, { x: width - margin - 85, y, size: 7, font });
  y -= 9;
  page.drawText('Tanggal: ' + inv.date, { x: width - margin - 85, y, size: 7, font });

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
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0,0,0) });
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
    if (lines[1]) { page.drawText(lines[1], { x: colDesc, y, size: 6, font }); y -= 8; }
    if (y < margin + 70) break;
  }

  // Total
  y -= 2;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0,0,0) });
  y -= 12;
  page.drawText('Grand Total:', { x: colHarga, y, size: 8, font: fontBold });
  page.drawText('Rp ' + fmt(inv.total), { x: colSub - 8, y, size: 8, font: fontBold });

  // Terbilang
  y -= 14;
  page.drawText('Terbilang:', { x: margin, y, size: 6.5, font: fontBold });
  y -= 8;
  const words = inv.terbilang.split(' ');
  let line = '';
  const maxW = width - margin * 2;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, 6.5) > maxW) {
      page.drawText(line, { x: margin, y, size: 6.5, font });
      y -= 8;
      line = w;
    } else line = test;
  }
  if (line) page.drawText(line, { x: margin, y, size: 6.5, font });

  // Footer
  page.drawText('Terima kasih atas kepercayaan Anda.', {
    x: margin, 
    y: margin + 6, 
    size: 7, 
    font: fontBold, 
    color: rgb(0.2, 0.2, 0.2) 
  });

  const pdfBytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
  res.send(Buffer.from(pdfBytes));
});

// ===== CONFIG UNTUK FRONTEND =====
app.get('/api/config', (req, res) => {
  res.json({ services: config.services, store: config.store });
});

// ===== ROUTE UNTUK HALAMAN UTAMA =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== INISIALISASI DATABASE & START SERVER =====
initDb().catch(err => console.error("Gagal inisialisasi DB:", err));

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  Mission Print Invoice');
  console.log('  Server jalan di port ' + PORT);
  console.log('========================================');
});
