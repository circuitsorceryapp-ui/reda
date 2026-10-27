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
const MAX_USERS_PER_TENANT = 10; // how many people can work in one company at the same time
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
  // ---- users of my company (up to MAX_USERS_PER_TENANT people can work together) ----
  if (url.pathname === '/api/users') {
    const user = requireAuth(req, res); if (!user) return;
    const isOwner = user.role === 'owner';
    if (req.method === 'GET') {
      const users = db.prepare(
        'SELECT id, name, email, role, totp_enabled AS mfa_enabled, created_at FROM users WHERE tenant_id = ? ORDER BY id'
      ).all(user.tenant_id);
      return json(res, 200, { users, max: MAX_USERS_PER_TENANT });
    }
    if (!isOwner) return bad(res, 'Only the owner can add or remove users', 403);
    if (req.method === 'POST') {
      const { name, email, password, role } = body || {};
      if (!name || !email || !password) return bad(res, 'Name, email and password are required');
      if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
      const roleOk = ['owner', 'accountant', 'sales'].includes(role) ? role : 'accountant';
      const count = db.prepare('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ?').get(user.tenant_id).c;
      if (count >= MAX_USERS_PER_TENANT) return bad(res, `Limit reached: max ${MAX_USERS_PER_TENANT} users per company`, 409);
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase()))
        return bad(res, 'A user with this email already exists', 409);
      db.prepare('INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
        .run(user.tenant_id, String(name).slice(0, 100), String(email).trim().toLowerCase(), hashPassword(password), roleOk);
      return json(res, 201, { ok: true });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (+id === user.id) return bad(res, 'You cannot remove yourself');
      const target = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
      if (!target) return json(res, 404, { error: 'Not found' });
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // log them out too
      db.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').run(id, user.tenant_id);
      return json(res, 200, { ok: true });
    }
  }

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

  // ---- company profile (details + logo for printouts) ---- tenant-isolated ----
  const PROFILE_FIELDS = ['address', 'reg_no', 'vat_no', 'bank', 'phone', 'email'];
  if (url.pathname === '/api/company') {
    const user = requireAuth(req, res); if (!user) return;
    if (req.method === 'GET') {
      const p = db.prepare('SELECT * FROM company_profile WHERE tenant_id = ?').get(user.tenant_id) || {};
      const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(user.tenant_id);
      // banks: newer multi-account list; falls back to the old single "bank" field
      let banks = [];
      try { banks = JSON.parse(p.banks || '[]'); } catch { banks = []; }
      if (!Array.isArray(banks) || !banks.length) banks = p.bank ? [{ name: 'Bank', iban: p.bank, swift: '' }] : [];
      return json(res, 200, {
        company: tenant ? tenant.name : '',
        address: p.address || '', reg_no: p.reg_no || '', vat_no: p.vat_no || '',
        bank: p.bank || '', banks, phone: p.phone || '', email: p.email || '',
        has_logo: !!p.logo_data,
      });
    }
    if (req.method === 'POST') {
      const data = body || {};
      const cur = db.prepare('SELECT * FROM company_profile WHERE tenant_id = ?').get(user.tenant_id);
      const val = (k) => String(data[k] || '').slice(0, 300);
      // banks come as an array from the Settings page — keep max 5 accounts, strings only
      let banksJson = '';
      if (Array.isArray(data.banks)) {
        const banks = data.banks.slice(0, 5).map((b) => ({
          name: String((b && b.name) || '').slice(0, 100),
          iban: String((b && b.iban) || '').slice(0, 50),
          swift: String((b && b.swift) || '').slice(0, 20),
        })).filter((b) => b.iban || b.name);
        banksJson = JSON.stringify(banks);
      }
      if (cur) {
        db.prepare('UPDATE company_profile SET address=?, reg_no=?, vat_no=?, bank=?, banks=?, phone=?, email=?, updated_at=datetime(\'now\') WHERE tenant_id=?')
          .run(val('address'), val('reg_no'), val('vat_no'), val('bank'), banksJson, val('phone'), val('email'), user.tenant_id);
      } else {
        db.prepare('INSERT INTO company_profile (tenant_id, address, reg_no, vat_no, bank, banks, phone, email) VALUES (?,?,?,?,?,?,?,?)')
          .run(user.tenant_id, val('address'), val('reg_no'), val('vat_no'), val('bank'), banksJson, val('phone'), val('email'));
      }
      return json(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/company/logo') {
    const user = requireAuth(req, res); if (!user) return;
    if (req.method === 'GET') {
      const p = db.prepare('SELECT logo_data, logo_mime FROM company_profile WHERE tenant_id = ?').get(user.tenant_id);
      if (!p || !p.logo_data) return json(res, 404, { error: 'No logo' });
      res.writeHead(200, { 'Content-Type': p.logo_mime, 'Cache-Control': 'no-cache' });
      return res.end(Buffer.from(p.logo_data, 'base64'));
    }
    if (req.method === 'POST') {
      // client sends a data URL: "data:image/png;base64,AAAA..."
      const m = String((body || {}).data || '').match(/^data:(image\/(png|jpeg|jpg|gif|webp|svg\+xml));base64,(.+)$/);
      if (!m) return bad(res, 'Please choose a PNG, JPG, GIF, WebP or SVG image');
      const b64 = m[3];
      if (b64.length > 600_000) return bad(res, 'Logo is too big — please use an image under ~400 KB');
      db.prepare(`INSERT INTO company_profile (tenant_id, logo_data, logo_mime, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(tenant_id) DO UPDATE SET logo_data = excluded.logo_data, logo_mime = excluded.logo_mime, updated_at = datetime('now')`)
        .run(user.tenant_id, b64, m[1]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      db.prepare('UPDATE company_profile SET logo_data = NULL, logo_mime = NULL WHERE tenant_id = ?').run(user.tenant_id);
      return json(res, 200, { ok: true });
    }
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
    bill:     { prefix: 'PUR', statuses: ['draft', 'ordered', 'received', 'sent', 'paid'], payable: true },
    // purchase steps: draft = you decided to buy · ordered = you emailed the order ·
    // received = supplier's bill arrived & goods are in your warehouse · paid = money sent
  };

  // ---- demo data: 10 fake documents so a new user can explore safely ----
  if (req.method === 'POST' && url.pathname === '/api/demo') {
    const user = requireAuth(req, res); if (!user) return;
    const today = new Date();
    const iso = (offsetDays) => new Date(today.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
    const nextNo = (prefix) => {
      const n = db.prepare(
        `SELECT COALESCE(MAX(CAST(SUBSTR(number, 5) AS INTEGER)), 0) + 1 AS next
         FROM invoices WHERE tenant_id = ? AND number LIKE ?`
      ).get(user.tenant_id, prefix + '-%').next;
      return `${prefix}-${String(n).padStart(4, '0')}`;
    };
    const addDoc = (type, customer, items, extra = {}) => {
      const prefix = DOC_TYPES[type].prefix;
      const clean = items.map(([code, name, qty, price]) => ({ code, name, qty, unit_price_cents: Math.round(price * 100) }));
      const excl = clean.reduce((s, it) => s + Math.round(it.qty * it.unit_price_cents), 0);
      const vat = Math.round(excl * 0.21);
      const r = db.prepare(
        `INSERT INTO invoices (tenant_id, number, customer, description, amount_cents, currency, issue_date, due_date, status, doc_type, items, vat_rate)
         VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, 21)`
      ).run(user.tenant_id, nextNo(prefix), customer, extra.note || '', excl + vat, extra.issue || iso(0), extra.due || null, extra.status || 'draft', type, JSON.stringify(clean));
      return { id: Number(r.lastInsertRowid), total: excl + vat };
    };
    const pay = (id, cents, on) => {
      db.prepare('INSERT INTO payments (tenant_id, invoice_id, amount_cents, paid_on) VALUES (?, ?, ?, ?)')
        .run(user.tenant_id, id, cents, on || iso(0));
      // full payment flips the document to "paid" (same rule as the /payments endpoint)
      const inv = db.prepare('SELECT status, amount_cents FROM invoices WHERE id = ? AND tenant_id = ?').get(id, user.tenant_id);
      if (inv && inv.status !== 'paid' && cents >= inv.amount_cents) {
        db.prepare('UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?').run('paid', id, user.tenant_id);
      }
    };
    // 1–2: paid sales invoices
    let d = addDoc('invoice', 'SIA Celtnieks', [['4407', 'Oak planks 20mm', 30, 12.5]], { issue: iso(-40), due: iso(-10), status: 'sent', note: 'Decking boards' });
    pay(d.id, d.total, iso(-15));
    d = addDoc('invoice', 'Māja & Dārzs SIA', [['8716', 'Garden furniture set', 2, 189.9]], { issue: iso(-30), due: iso(-2), status: 'sent' });
    pay(d.id, d.total, iso(-3));
    // 3: partially paid invoice (due today)
    d = addDoc('invoice', 'Jānis Bērziņš', [['9403', 'Fence panels', 10, 24.0]], { issue: iso(-14), due: iso(0), status: 'sent' });
    pay(d.id, Math.round(d.total / 2), iso(-1));
    // 4: overdue unpaid invoice (customer owes you — red)
    addDoc('invoice', 'Kafejnīca "Ausma" SIA', [['7010', 'Coffee beans 1kg', 5, 22.5]], { issue: iso(-45), due: iso(-15), status: 'sent' });
    // 5: freshly sent invoice
    addDoc('invoice', 'Būvniecības Kooperatīvs', [['2523', 'Cement 25kg', 40, 4.2]], { issue: iso(-1), due: iso(13), status: 'sent' });
    // 6–7: purchase bills (one received = in stock, one ordered = waiting)
    addDoc('bill', 'Mežs SIA (sawmill)', [['4407', 'Oak planks 20mm', 50, 11.0]], { issue: iso(-20), due: iso(5), status: 'received', note: 'Supplier invoice MZ-1188' });
    addDoc('bill', 'Baltic Hardware OÜ', [['2523', 'Cement 25kg', 60, 3.4]], { issue: iso(-2), due: iso(12), status: 'ordered' });
    // 8: overdue supplier bill YOU must pay (red priority)
    addDoc('bill', 'Krāsu Noliktava SIA', [['3209', 'Paint 10L', 12, 31.0]], { issue: iso(-35), due: iso(-5), status: 'received', note: 'Supplier invoice KN-0442' });
    // 9–10: open offer + delivered delivery note
    addDoc('quote', 'Viesnīca "Priedes"', [['9405', 'Custom stairs project', 1, 1200.0]], { issue: iso(-5), due: iso(25), status: 'sent' });
    addDoc('delivery', 'SIA Celtnieks', [['4407', 'Oak planks 20mm', 30, 12.5]], { issue: iso(-12), due: iso(-12), status: 'delivered' });
    return json(res, 201, { ok: true, created: 10 });
  }

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
    const { customer, amount, currency, due_date, description, doc_type, items, vat_rate, contact_id, issue_date } = body || {};
    const type = DOC_TYPES[doc_type] ? doc_type : 'invoice';
    if (!customer) return bad(res, 'Customer is required');

    let amountCents, itemsJson = null, vatRate = null;
    if (Array.isArray(items) && items.length) {
      // line-items mode: unit prices are EXCL. VAT; the server computes everything — never trusts the browser
      const clean = items.map((it) => ({
        code: String(it.code || '').slice(0, 60),
        name: String(it.name || '').slice(0, 300),
        tax_code: String(it.tax_code || '').slice(0, 30), // optional VAT/tariff (CN) code, e.g. 4407 for sawn wood
        qty: Number(String(it.qty).replace(',', '.')) || 0,   // accept "2,5" like "2.5"
        unit_price_cents: Math.round(Number(String(it.unit_price).replace(',', '.')) * 100) || 0,
      })).filter((it) => it.name && it.qty > 0 && it.unit_price_cents >= 0);
      if (!clean.length) return bad(res, 'Add at least one line with a product name and quantity');
      const excl = clean.reduce((s, it) => s + Math.round(it.qty * it.unit_price_cents), 0);
      // VAT rate comes from the EU country presets or is typed manually — decimals like 25,5% are valid
      const rateNum = Number(String(vat_rate ?? 21).replace(',', '.'));
      vatRate = Number.isFinite(rateNum) ? Math.max(0, Math.min(100, rateNum)) : 21;
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
    // document date: today by default, but the user can set any date (e.g. backdated)
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const issueDate = isDate(issue_date) ? issue_date : new Date().toISOString().slice(0, 10);
    // optional: which of your bank accounts the customer should pay to (v9.4 banking)
    const bankId = Number(body?.bank_id) > 0 ? Math.floor(Number(body.bank_id)) : null;
    db.prepare(
      `INSERT INTO invoices (tenant_id, number, customer, description, amount_cents, currency, issue_date, due_date, status, doc_type, items, vat_rate, contact_id, bank_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.tenant_id, number, customer, description || '',
      amountCents, (currency || 'EUR').toUpperCase(),
      issueDate, due_date || null, 'draft', type, itemsJson, vatRate, contactId, bankId);
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
    const allowed = { quote: ['delivery', 'invoice'], delivery: ['invoice'], bill: ['invoice'] }; // bill → invoice: bought goods, sell them onward
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
