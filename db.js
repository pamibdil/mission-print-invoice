const { createClient } = require('@libsql/client/web');

// Vercel menyediakan URL dan Token ini secara otomatis melalui Environment Variables
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Fungsi inisialisasi tabel (dipanggil sekali saat server nyala)
async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      date TEXT NOT NULL,
      total INTEGER NOT NULL,
      terbilang TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      service_code TEXT NOT NULL,
      service_label TEXT NOT NULL,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);
}

module.exports = { db, initDb };
