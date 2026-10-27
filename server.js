// Reda — Lite ERP starter server
// Multi-tenant: every company (tenant) sees only its own data. Enforced by scoping
// EVERY query on tenant_id taken from the verified session — never from user input.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const {
  hashPassword, verifyPassword,
  generateTotpSecret, verifyTotp, otpauthUri,
  newSessionId,
} = require('./crypto');

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---------------- helpers ----------------
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  for (const part of cookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function setSession(userId, mfaPending) {
  const id = newSessionId();
  const expires = Date.now() + 12 * 60 * 60 * 1000; // 12h
  db.prepare('INSERT INTO sessions (id, user_id, mfa_pending, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, mfaPending ? 1 : 0, expires);
  return id;
}

// Returns the logged-in user, or null. A session with mfa_pending=1 only allows MFA endpoints.
function currentUser(req) {
  const sid = getCookie(req, 'reda_session');
  if (!sid) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(sid, Date.now());
  if (!session) return null;
  const user = db.prepare(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.totp_enabled, s.mfa_pending
     FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = ?`
  ).get(sid);
  return user || null;
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user || user.mfa_pending) {
    json(res, 401, { error: 'Not authorised' });
    return null;
  }
  return user;
}

function bad(res, msg, status = 400) { json(res, status, { error: msg }); }

// ---------------- API ----------------
async function handleApi(req, res, url) {
  const body = await readBody(req);

  // ---- auth ----
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const { companyName, name, email, password } = body || {};
    if (!companyName || !name || !email || !password) return bad(res, 'All fields are required');
    if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()))
      return bad(res, 'A user with this email already exists', 409);

    const tx = db.exec('BEGIN');
    try {
      const tenant = db.prepare('INSERT INTO tenants (name) VALUES (?)').run(companyName);
      const user = db.prepare(
        'INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
      ).run(tenant.lastInsertRowid, name.trim(), email.trim().toLowerCase(), hashPassword(password), 'owner');
      db.exec('COMMIT');
      const sid = setSession(user.lastInsertRowid, false);
      res.setHeader('Set-Cookie', cookie(sid));
      return json(res, 200, { ok: true, mfaRequired: false });
    } catch (e) {
      db.exec('ROLLBACK');
      return bad(res, 'Registration failed', 500);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { email, password } = body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.password_hash))
      return bad(res, 'Wrong email or password', 401);

    const mfaPending = !!user.totp_enabled;
    const sid = setSession(user.id, mfaPending);
    res.setHeader('Set-Cookie', cookie(sid));
    return json(res, 200, { ok: true, mfaRequired: mfaPending });
  }

  if (req.method === 'POST' && url.pathname === '/api/login/mfa') {
    const user = currentUser(req); // mfa_pending session is enough to reach this
    if (!user) return bad(res, 'Session expired, please log in again', 401);
    const { code } = body || {};
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyTotp(full.totp_secret, code)) return bad(res, 'Invalid or expired code', 401);
    // unlock ONLY the session that entered the code, not all sessions of the user
    db.prepare('UPDATE sessions SET mfa_pending = 0 WHERE id = ?').get(getCookie(req, 'reda_session'));
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const sid = getCookie(req, 'reda_session');
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    res.setHeader('Set-Cookie', cookie('', 0));
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireAuth(req, res); if (!user) return;
    const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(user.tenant_id);
    return json(res, 200, {
      name: user.name, email: user.email, role: user.role,
      company: tenant.name, mfaEnabled: !!user.totp_enabled,
    });
  }

  // ---- MFA setup (Microsoft Authenticator) ----
  if (req.method === 'POST' && url.pathname === '/api/mfa/setup') {
    const user = requireAuth(req, res); if (!user) return;
    if (user.totp_enabled) return bad(res, 'MFA is already enabled — disable it first if you want to change it', 409);
    const secret = generateTotpSecret();
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
    return json(res, 200, { secret, uri: otpauthUri(secret, user.email) });
  }

  if (req.method === 'POST' && url.pathname === '/api/mfa/enable') {
    const user = requireAuth(req, res); if (!user) return;
    const { code } = body || {};
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!full.totp_secret) return bad(res, 'Run setup first');
    if (!verifyTotp(full.totp_secret, code)) return bad(res, 'Invalid or expired code, try the next one');
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/mfa/disable') {
    const user = requireAuth(req, res); if (!user) return;
    const { code } = body || {};
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyTotp(full.totp_secret, code)) return bad(res, 'Invalid or expired code');
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);
    return json(res, 200, { ok: true });
  }

  // ---- contacts (customer & supplier base) ---- tenant-isolated ----
  if (url.pathname === '/api/contacts') {
    const user = requireAuth(req, res); if (!user) return;
    if (req.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim();
      // search across company/person name, email, phone, reg no and VAT no
      const like = `%${q}%`;
      const rows = q
        ? db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? AND
            (name LIKE ? OR email LIKE ? OR phone LIKE ? OR reg_no LIKE ? OR vat_no LIKE ? OR address LIKE ?)
            ORDER BY name LIMIT 50`).all(user.tenant_id, like, like, like, like, like, like)
        : db.prepare('SELECT * FROM contacts WHERE tenant_id = ? ORDER BY name LIMIT 50').all(user.tenant_id);
      return json(res, 200, { contacts: rows });
    }
    if (req.method === 'POST') {
      const { kind, name, reg_no, vat_no, email, phone, address } = body || {};
      if (!name) return bad(res, 'Name is required');
      const k = kind === 'person' ? 'person' : 'company';
      const r = db.prepare(
        `INSERT INTO contacts (tenant_id, kind, name, reg_no, vat_no, email, phone, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(user.tenant_id, k, String(name).slice(0, 200), reg_no || '', vat_no || '',
        email || '', phone || '', address || '');
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid) });
    }
    if (req.method === 'PATCH') {
      const { id, kind, name, reg_no, vat_no, email, phone, address } = body || {};
      const c = db.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
      if (!c) return bad(res, 'Contact not found', 404);
      if (!name) return bad(res, 'Name is required');
      db.prepare(
        `UPDATE contacts SET kind = ?, name = ?, reg_no = ?, vat_no = ?, email = ?, phone = ?, address = ?
         WHERE id = ? AND tenant_id = ?`
      ).run(kind === 'person' ? 'person' : 'company', String(name).slice(0, 200),
        reg_no || '', vat_no || '', email || '', phone || '', address || '', id, user.tenant_id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      db.prepare('DELETE FROM contacts WHERE id = ? AND tenant_id = ?').run(id, user.tenant_id);
      return json(res, 200, { ok: true });
    }
  }

  // ---- documents (quotes, delivery notes, invoices, purchase bills) ---- tenant-isolated ----
  const DOC_TYPES = {
    quote:    { prefix: 'QUO', statuses: ['draft', 'sent', 'accepted', 'rejected'], payable: false },
    delivery: { prefix: 'DLV', statuses: ['draft', 'sent', 'delivered'],           payable: false },
    invoice:   { prefix: 'INV', statuses: ['draft', 'sent', 'paid'],                payable: true },
    bill:     { prefix: 'PUR', statuses: ['draft', 'sent', 'paid'],                 payable: true },
  };

  if (req.method === 'GET' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    // NOTE: tenant_id comes from the session, never from the request.
    const rows = db.prepare(
      `SELECT i.*, COALESCE((SELECT SUM(p.amount_cents) FROM payments p
         WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id), 0) AS paid_cents
       FROM invoices i WHERE i.tenant_id = ? ORDER BY i.id DESC`
    ).all(user.tenant_id);
    // attach line items + VAT breakdown for the frontend / PDF
    for (const r of rows) {
      try { r.items = r.items ? JSON.parse(r.items) : null; } catch { r.items = null; }
      if (Array.isArray(r.items) && r.items.length) {
        r.total_excl_cents = r.items.reduce((s, it) => s + Math.round(Number(it.qty) * Number(it.unit_price_cents)), 0);
        r.vat_cents = Math.round(r.total_excl_cents * (r.vat_rate || 0) / 100);
      } else { r.total_excl_cents = null; r.vat_cents = null; }
    }
    // money overview: issued sales vs received purchases, plus what's still open on both sides
    const totals = {
      count: rows.length,
      sales_invoiced: 0, sales_paid: 0, purchases_invoiced: 0, purchases_paid: 0,
      quotes_open: 0, quotes_value: 0,
    };
    for (const r of rows) {
      if (r.doc_type === 'bill') { totals.purchases_invoiced += r.amount_cents; totals.purchases_paid += r.paid_cents; }
      else if (r.doc_type === 'invoice') { totals.sales_invoiced += r.amount_cents; totals.sales_paid += r.paid_cents; }
      else if (r.doc_type === 'quote' && ['draft', 'sent'].includes(r.status)) {
        totals.quotes_open += 1; totals.quotes_value += r.amount_cents;
      }
    }
    totals.customers_owe = totals.sales_invoiced - totals.sales_paid;
    totals.you_owe = totals.purchases_invoiced - totals.purchases_paid;
    return json(res, 200, { invoices: rows, totals });
  }

  if (req.method === 'POST' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    const { customer, amount, currency, due_date, description, doc_type, items, vat_rate, contact_id } = body || {};
    const type = DOC_TYPES[doc_type] ? doc_type : 'invoice';
    if (!customer) return bad(res, 'Customer is required');

    let amountCents, itemsJson = null, vatRate = null;
    if (Array.isArray(items) && items.length) {
      // line-items mode: unit prices are EXCL. VAT; the server computes everything — never trusts the browser
      const clean = items.map((it) => ({
        code: String(it.code || '').slice(0, 60),
        name: String(it.name || '').slice(0, 300),
        qty: Number(it.qty) || 0,
        unit_price_cents: Math.round(Number(it.unit_price) * 100) || 0,
      })).filter((it) => it.name && it.qty > 0 && it.unit_price_cents >= 0);
      if (!clean.length) return bad(res, 'Add at least one line with a product name and quantity');
      const excl = clean.reduce((s, it) => s + Math.round(it.qty * it.unit_price_cents), 0);
      vatRate = Math.max(0, Math.min(100, Math.round(Number(vat_rate ?? 21))));
      const vat = Math.round(excl * vatRate / 100);
      amountCents = excl + vat;
      itemsJson = JSON.stringify(clean);
    } else {
      // simple mode (single amount, no line breakdown)
      if (!amount) return bad(res, 'Amount is required');
      amountCents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) return bad(res, 'Amount must be a positive number');
    }
    // if a contact was picked from the saved base, make sure it belongs to THIS tenant
    let contactId = null;
    if (contact_id) {
      const c = db.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?').get(contact_id, user.tenant_id);
      if (c) contactId = c.id;
    }

    // next number = highest existing suffix + 1, per document type (never re-uses a number)
    const prefix = DOC_TYPES[type].prefix;
    const n = db.prepare(
      `SELECT COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) + 1 AS next
       FROM invoices WHERE tenant_id = ? AND number LIKE ?`
    ).get(user.tenant_id, prefix + '-%').next;
    const number = `${prefix}-${String(n).padStart(4, '0')}`;
    db.prepare(
      `INSERT INTO invoices (tenant_id, number, customer, description, amount_cents, currency, issue_date, due_date, status, doc_type, items, vat_rate, contact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.tenant_id, number, customer, description || '',
      amountCents, (currency || 'EUR').toUpperCase(),
      new Date().toISOString().slice(0, 10), due_date || null, 'draft', type, itemsJson, vatRate, contactId);
    return json(res, 201, { ok: true, number });
  }

  // ---- document conversions: quote → invoice/delivery note, delivery note → invoice ----
  if (req.method === 'POST' && url.pathname === '/api/invoices/convert') {
    const user = requireAuth(req, res); if (!user) return;
    const { id, to } = body || {};
    const target = DOC_TYPES[to];
    if (!target) return bad(res, 'Unknown target document type');
    const src = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
    if (!src) return bad(res, 'Document not found', 404);
    const allowed = { quote: ['delivery', 'invoice'], delivery: ['invoice'] };
    if (!allowed[src.doc_type]?.includes(to)) return bad(res, `Cannot convert a ${src.doc_type} to a ${to}`);

    const prefix = target.prefix;
    const n = db.prepare(
      `SELECT COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) + 1 AS next
       FROM invoices WHERE tenant_id = ? AND number LIKE ?`
    ).get(user.tenant_id, prefix + '-%').next;
    const number = `${prefix}-${String(n).padStart(4, '0')}`;
    db.prepare(
      `INSERT INTO invoices (tenant_id, number, customer, description, amount_cents, currency, issue_date, due_date, status, doc_type, parent_id, items, vat_rate, contact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.tenant_id, number, src.customer, src.description, src.amount_cents, src.currency,
      new Date().toISOString().slice(0, 10), src.due_date, 'draft', to, src.id, src.items, src.vat_rate, src.contact_id);
    return json(res, 201, { ok: true, number });
  }

  // ---- payments: record money paid on an invoice or bill (full or partial) ----
  if (req.method === 'POST' && url.pathname === '/api/invoices/payments') {
    const user = requireAuth(req, res); if (!user) return;
    const { invoice_id, amount, paid_on, note } = body || {};
    if (!invoice_id || !amount) return bad(res, 'Document and amount are required');
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoice_id, user.tenant_id);
    if (!inv) return bad(res, 'Document not found', 404);
    if (!DOC_TYPES[inv.doc_type].payable) return bad(res, 'Payments can only be recorded on invoices and purchase bills');
    const paidCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paidCents) || paidCents <= 0) return bad(res, 'Payment must be a positive number');
    db.prepare('INSERT INTO payments (tenant_id, invoice_id, amount_cents, paid_on, note) VALUES (?, ?, ?, ?, ?)')
      .run(user.tenant_id, inv.id, paidCents, paid_on || new Date().toISOString().slice(0, 10), note || '');

    const sum = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE invoice_id = ? AND tenant_id = ?')
      .get(inv.id, user.tenant_id).s;
    if (sum >= inv.amount_cents && inv.status !== 'paid') {
      db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?').run('paid', inv.id, user.tenant_id);
    } else if (sum < inv.amount_cents && inv.status === 'paid') {
      db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?').run('sent', inv.id, user.tenant_id);
    }
    return json(res, 201, { ok: true, paid_total_cents: sum });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/invoices/payments') {
    const user = requireAuth(req, res); if (!user) return;
    const id = url.searchParams.get('id');
    const pay = db.prepare('SELECT * FROM payments WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
    if (!pay) return json(res, 404, { error: 'Not found' });
    db.prepare('DELETE FROM payments WHERE id = ? AND tenant_id = ?').run(id, user.tenant_id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(pay.invoice_id, user.tenant_id);
    const sum = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE invoice_id = ? AND tenant_id = ?')
      .get(inv.id, user.tenant_id).s;
    if (inv.status === 'paid' && sum < inv.amount_cents) {
      db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?').run('sent', inv.id, user.tenant_id);
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/invoices/status') {
    const user = requireAuth(req, res); if (!user) return;
    const { id, status } = body || {};
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
    if (!inv) return json(res, 404, { error: 'Not found' });
    if (!DOC_TYPES[inv.doc_type].statuses.includes(status)) return bad(res, 'Invalid status for this document type');
    const r = db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?')
      .run(status, id, user.tenant_id); // tenant_id in WHERE = isolation, even on updates
    return json(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Not found' });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    const id = url.searchParams.get('id');
    const r = db.prepare('DELETE FROM invoices WHERE id = ? AND tenant_id = ?').run(id, user.tenant_id);
    if (r.changes) db.prepare('DELETE FROM payments WHERE invoice_id = ? AND tenant_id = ?').run(id, user.tenant_id);
    return json(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Not found' });
  }

  json(res, 404, { error: 'Not found' });
}

function cookie(sid, maxAgeHours = 12) {
  return `reda_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeHours * 3600}`;
}

// ---------------- static files ----------------
const PUBLIC_DIR = path.join(__dirname, 'public');
function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, file));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // unknown paths → SPA shell
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Server error' });
  }
});

// tiny clean-up of expired sessions
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Reda running at http://localhost:${PORT}`);
});
