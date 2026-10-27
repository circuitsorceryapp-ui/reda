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
