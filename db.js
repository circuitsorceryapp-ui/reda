// Reda — database layer (SQLite for the starter; PostgreSQL + row-level security is the production path, see README)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'reda.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',        -- owner | accountant | sales
  totp_secret TEXT,                          -- base32 secret for Microsoft Authenticator
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mfa_pending INTEGER NOT NULL DEFAULT 0,    -- 1 = password verified, MFA code still required
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),  -- the isolation key: EVERY query filters on this
  number TEXT NOT NULL,
  customer TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL,             -- money is stored as integer minor units (cents)
  currency TEXT NOT NULL DEFAULT 'EUR',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | sent | paid
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

module.exports = db;

// ---------- migrations (safe on existing databases) ----------
const invoiceCols = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
if (!invoiceCols.includes('doc_type')) {
  // quote = offer (piedāvājums), delivery = delivery note (pavadzīme),
  // invoice = sales invoice you issued, bill = purchase invoice a supplier sent you
  db.exec("ALTER TABLE invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'invoice'");
}
if (!invoiceCols.includes('parent_id')) {
  db.exec('ALTER TABLE invoices ADD COLUMN parent_id INTEGER'); // links a converted document to its origin
}
// v7: line items + VAT. items = JSON array [{code, name, qty, unit_price_cents}] (unit price EXCL. VAT, in cents).
// vat_rate = percent (21 in Latvia). amount_cents stays the grand total INCLUDING VAT.
if (!invoiceCols.includes('items')) {
  db.exec('ALTER TABLE invoices ADD COLUMN items TEXT');          // JSON, NULL for old simple documents
  db.exec('ALTER TABLE invoices ADD COLUMN vat_rate INTEGER');   // NULL = unknown / old doc
  db.exec('ALTER TABLE invoices ADD COLUMN contact_id INTEGER'); // optional link to a saved contact
}
// v7: customer & supplier base (CRM-lite)
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),  -- the isolation key: EVERY query filters on this
  kind TEXT NOT NULL DEFAULT 'company',                -- company | person
  name TEXT NOT NULL,
  reg_no TEXT DEFAULT '',                              -- registration no (SIA reģ. nr.)
  vat_no TEXT DEFAULT '',                              -- VAT no (PVN nr.)
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);
`);
// v8: company profile (shown on printouts) + logo (stored as base64, this keeps zero-npm-dep simplicity)
db.exec(`
CREATE TABLE IF NOT EXISTS company_profile (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),  -- the isolation key
  address TEXT DEFAULT '',
  reg_no TEXT DEFAULT '',
  vat_no TEXT DEFAULT '',
  bank TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  logo_data TEXT,          -- base64-encoded image bytes, NULL = no logo
  logo_mime TEXT,          -- e.g. image/png
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
`);
// v9.4: multiple bank accounts per company + optional bank chosen on each document
const profCols = db.prepare('PRAGMA table_info(company_profile)').all().map((c) => c.name);
if (!profCols.includes('banks')) {
  db.exec("ALTER TABLE company_profile ADD COLUMN banks TEXT DEFAULT ''"); // JSON [{name, iban, swift}]
}
const invCols2 = db.prepare('PRAGMA table_info(invoices)').all().map((c) => c.name);
if (!invCols2.includes('bank_id')) {
  db.exec('ALTER TABLE invoices ADD COLUMN bank_id INTEGER'); // which of your bank accounts to be paid to
}
// v9.5: clean up company names that the older scan parser saved with Latvian header
// prefixes — "01. Nosūtītājs: SIA X" becomes just "SIA X", so lists read simply.
const cleanNamePrefix = (n) => String(n || '')
  .replace(/^\s*\d{1,2}\s*[.)\-–]\s*/, '')
  .replace(/^(pre[cč]u\s+)?(nos[ūu]t[īi]t[āa]js|nosutitajs|pieg[āa]d[āa]t[āa]js|s[ūu]t[īi]t[āa]js|sa[ņn][ēe]m[ēe]js|sanemejs|klients?|klientam|pirc[ēe]js|buyer|bill to|sold to|from|supplier|vendor|customer)\s*[:\-–]?\s*/i, '')
  .replace(/["'„“”]+/g, '')
  .replace(/[.,;:]+$/, '').trim();
for (const [table, col] of [['contacts', 'name'], ['invoices', 'customer']]) {
  try {
    const rows = db.prepare(`SELECT id, ${col} AS n FROM ${table}`).all();
    for (const r of rows) {
      const c = cleanNamePrefix(r.n);
      if (c && c !== r.n) db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(c, r.id);
    }
  } catch { /* table not created yet (fresh db) — fine */ }
}
// v11: scanned originals (PDF/photo) stored in the system, linked to a document number
db.exec(`CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  doc_number TEXT DEFAULT '',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// v12: backup settings (where to keep automatic backups)
db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);`);
