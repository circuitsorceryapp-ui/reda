// test helper: build an old-format DB with messy prefixed names
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./crypto.js');
const db = new DatabaseSync('/tmp/mig95.db');
db.exec(`CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE users (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT, email TEXT UNIQUE, password_hash TEXT NOT NULL, role TEXT DEFAULT 'owner', totp_enabled INTEGER DEFAULT 0);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, mfa_pending INTEGER DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, tenant_id INTEGER, number TEXT, customer TEXT, description TEXT, amount_cents INTEGER, currency TEXT, issue_date TEXT, due_date TEXT, status TEXT, created_at TEXT);
CREATE TABLE payments (id INTEGER PRIMARY KEY, tenant_id INTEGER, invoice_id INTEGER, amount_cents INTEGER, paid_on TEXT);
CREATE TABLE contacts (id INTEGER PRIMARY KEY, tenant_id INTEGER, kind TEXT, name TEXT, reg_no TEXT, vat_no TEXT, email TEXT, phone TEXT, address TEXT, created_at TEXT);
INSERT INTO tenants (name) VALUES ('OldCo');
INSERT INTO invoices (tenant_id,number,customer,amount_cents,currency,issue_date,status) VALUES (1,'INV-0001','01. Nosūtītājs: SIA "KVILLER"',15000,'EUR','2026-01-01','sent');
INSERT INTO invoices (tenant_id,number,customer,amount_cents,currency,issue_date,status) VALUES (1,'PUR-0001','Preču nosūtītājs: Bibus Baltic SIA',9000,'EUR','2026-01-01','received');
INSERT INTO contacts (tenant_id,kind,name) VALUES (1,'company','Nosūtītājs: SIA "Mežs"');
`);
db.prepare(`INSERT INTO users (tenant_id,name,email,password_hash,role) VALUES (1,'O','old@t.lv',?,'owner')`).run(hashPassword('Passw0rd!23'));
console.log('old db built');
