const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'invoice.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    date TEXT NOT NULL,
    total INTEGER NOT NULL,
    terbilang TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

db.exec(`
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

module.exports = db;