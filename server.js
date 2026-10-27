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
      ).run(tenant.lastInsertRowid, name, email.toLowerCase(), hashPassword(password), 'owner');
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
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
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
    db.prepare('UPDATE sessions SET mfa_pending = 0 WHERE user_id = ?').run(user.id);
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

  // ---- invoices (tenant-isolated demo module) ----
  if (req.method === 'GET' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    // NOTE: tenant_id comes from the session, never from the request.
    const rows = db.prepare(
      'SELECT * FROM invoices WHERE tenant_id = ? ORDER BY id DESC'
    ).all(user.tenant_id);
    const totals = db.prepare(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN status != 'paid' THEN amount_cents ELSE 0 END), 0) AS open_cents
       FROM invoices WHERE tenant_id = ?`
    ).get(user.tenant_id);
    return json(res, 200, { invoices: rows, totals });
  }

  if (req.method === 'POST' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    const { customer, amount, currency, due_date, description, status } = body || {};
    if (!customer || !amount) return bad(res, 'Customer and amount are required');
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return bad(res, 'Amount must be a positive number');

    const n = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ?').get(user.tenant_id).c + 1;
    const number = `INV-${String(n).padStart(4, '0')}`;
    db.prepare(
      `INSERT INTO invoices (tenant_id, number, customer, description, amount_cents, currency, issue_date, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.tenant_id, number, customer, description || '',
      amountCents, (currency || 'EUR').toUpperCase(),
      new Date().toISOString().slice(0, 10), due_date || null,
      ['draft', 'sent', 'paid'].includes(status) ? status : 'draft');
    return json(res, 201, { ok: true, number });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/invoices/status') {
    const user = requireAuth(req, res); if (!user) return;
    const { id, status } = body || {};
    if (!['draft', 'sent', 'paid'].includes(status)) return bad(res, 'Invalid status');
    const r = db.prepare(
      'UPDATE invoices SET status = ? WHERE id = ? AND tenant_id = ?'
    ).run(status, id, user.tenant_id); // tenant_id in WHERE = isolation, even on updates
    return json(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Not found' });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/invoices') {
    const user = requireAuth(req, res); if (!user) return;
    const id = url.searchParams.get('id');
    const r = db.prepare('DELETE FROM invoices WHERE id = ? AND tenant_id = ?').run(id, user.tenant_id);
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
