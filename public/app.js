// Reda frontend — vanilla JS single-page app
const $app = document.getElementById('app');

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const fmt = (cents, cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'EUR' }).format(cents / 100);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- invoice scanning (OCR runs in the browser; the image never leaves your PC) ----------
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine — internet needed the first time'));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

// Turns raw OCR text into form fields. Pure function — deliberately overridable by a human review.
function parseInvoiceText(rawText) {
  const lines = String(rawText).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const text = lines.join('\n');

  // --- dates first: dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd, also 2-digit years ---
  const dates = [];
  const dateRe = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/g;
  let d;
  const dateSpans = [];
  while ((d = dateRe.exec(text)) !== null) {
    let y, mo, dd;
    if (d[1]) { y = +d[1]; mo = +d[2]; dd = +d[3]; }
    else { dd = +d[4]; mo = +d[5]; y = +d[6]; if (y < 100) y += 2000; }
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
      dates.push({ iso: `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}` });
      dateSpans.push([d.index, d.index + d[0].length]);
    }
  }
  // amount hunting happens on text with dates blanked out, so "27.10.2026" can never become "27.10 €"
  const amountText = dateSpans.reduceRight((s, [from, to]) => s.slice(0, from) + ' '.repeat(to - from) + s.slice(to), text);

  // --- amounts: any money-format number with 2 decimals ---
  const amountMatches = [];
  const amountRe = /(?:€|EUR|USD|GBP|\$|£)?\s*([0-9][0-9 \u00A0.,]*[.,][0-9]{2})(?:\s*(?:€|EUR|USD|GBP|\$|£))?/g;
  let m;
  while ((m = amountRe.exec(amountText)) !== null) {
    const digits = m[1].replace(/[ \u00A0]/g, '');
    const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
    const value = parseFloat(digits.slice(0, lastSep).replace(/[.,]/g, '') + '.' + digits.slice(lastSep + 1));
    if (Number.isFinite(value)) {
      const ctx = amountText.slice(Math.max(0, m.index - 60), m.index);
      const isTotal = /total|kop[āa]|summa|visa|gross|maks[āa]t|apmaks/i.test(ctx);
      amountMatches.push({ value, ctx, isTotal });
    }
  }
  // prefer amounts near "total"-like words, then the largest amount
  amountMatches.sort((a, b) => (b.isTotal - a.isTotal) || (b.value - a.value));
  const amount = amountMatches.length ? amountMatches[0] : null;

  // --- currency: what symbol/code appears around the amounts ---
  let currency = 'EUR';
  const hasEuro = /€|\bEUR\b/i.test(text);
  const hasUsd = /\$|\bUSD\b/i.test(text);
  const hasGbp = /£|\bGBP\b/i.test(text);
  if (!hasEuro && hasUsd) currency = 'USD';
  else if (!hasEuro && hasGbp) currency = 'GBP';

  // due date = date near "due/apmaksas līdz"-like words; otherwise the latest date found
  let due_date = null;
  for (const line of lines) {
    if (/due|apmaks|līdz|maks[āa]juma|termi[nņ]|pay by/i.test(line)) {
      const dm = line.match(dateRe);
      if (dm) { const inLine = parseFirstDateIn(line); if (inLine) { due_date = inLine; break; } }
    }
  }
  if (!due_date && dates.length) due_date = dates[dates.length - 1].iso;

  // --- invoice number ---
  let invoiceNo = null;
  const noRe = /\b(?:r[ēe][ķk]in[sa]|rekins|reknis|invoice|saskaita|ček|cek|nr|no|#)[\s.:\-]*([A-Z0-9\-\/]*[0-9][A-Z0-9\-\/]*)/i;
  for (const line of lines) { const n = line.match(noRe); if (n) { invoiceNo = n[1]; break; } }

  // --- counterparty: line with a company form (SIA, AS, UAB, GmbH...) ---
  let customer = null;
  for (const line of lines) {
    const c = line.match(/\b(SIA|A\/S|AS|S\.A\.|UAB|O[ÜU]|GmbH|MB|Ltd|Limited|LLC|Inc|K\/S|PS|IK|IP|SC)\b/i);
    if (c && line.length < 80) { customer = line.replace(/[.,;:]+$/, '').trim(); break; }
  }

  // --- VAT number (adds trust context) ---
  const vat = text.match(/\b((?:LV|LT|EE|SE|DE|PL|FI|DK|NL|FR)[\s-]?\d{9,12})\b/i);

  return {
    customer: customer ? customer.slice(0, 80) : null,
    amount: amount ? amount.value.toFixed(2) : null,
    currency,
    due_date,
    invoiceNo,
    vat: vat ? vat[1] : null,
    rawAmountCount: amountMatches.length,
  };
}

function parseFirstDateIn(line) {
  const d = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!d) return null;
  let y, mo, dd;
  if (d[1]) { y = +d[1]; mo = +d[2]; dd = +d[3]; }
  else { dd = +d[4]; mo = +d[5]; y = +d[6]; if (y < 100) y += 2000; }
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// ---------------- router ----------------
async function route() {
  const hash = location.hash || '#/login';
  const me = await api('/api/me').catch(() => null);
  if (me) {
    if (hash === '#/login' || hash === '#/register') return location.hash = '#/dashboard';
    if (hash === '#/settings') return viewSettings(me);
    return viewDashboard(me);
  }
  if (hash === '#/register') return viewRegister();
  if (me === null && hash.startsWith('#/dashboard')) return viewLogin();
  viewLogin();
}
window.addEventListener('hashchange', route);

// ---------------- views ----------------
function authShell(inner) {
  $app.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand"><div class="logo">R</div><span>Reda</span></div>
    <div class="sub">Lite ERP for small business</div>
    ${inner}
  </div></div>`;
}

function viewLogin(msg = '') {
  authShell(`
    <h1>Welcome back</h1>
    <div class="error-msg" id="err">${esc(msg)}</div>
    <form id="loginForm">
      <label>Email</label><input id="email" type="email" required autocomplete="email">
      <label>Password</label><input id="password" type="password" required autocomplete="current-password">
      <button class="btn" type="submit">Log in</button>
    </form>
    <div class="foot-note">No account yet? <a href="#/register">Create your company workspace</a></div>`);
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/login', 'POST', {
        email: email.value, password: password.value,
      });
      location.hash = r.mfaRequired ? '#/mfa' : '#/dashboard';
      if (r.mfaRequired) viewMfaPrompt();
      else route(); // if hash didn't change, hashchange won't fire — render manually
    } catch (err) { showError(err.message); }
  };
}

function viewRegister() {
  authShell(`
    <h1>Create your workspace</h1>
    <p class="sub">Your company gets its own private space — no other company can ever see your data.</p>
    <div class="error-msg" id="err"></div>
    <form id="regForm">
      <label>Company name</label><input id="companyName" required>
      <label>Your name</label><input id="name" required>
      <label>Email</label><input id="email" type="email" required autocomplete="email">
      <label>Password (min 8 characters)</label><input id="password" type="password" required minlength="8" autocomplete="new-password">
      <button class="btn" type="submit">Create workspace</button>
    </form>
    <div class="foot-note">Already have an account? <a href="#/login">Log in</a></div>`);
  document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/register', 'POST', {
        companyName: document.getElementById('companyName').value,
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      });
      location.hash = '#/mfa-setup';
      viewMfaSetup();
    } catch (err) { showError(err.message); }
  };
}

function viewMfaPrompt() {
  authShell(`
    <h1>Two-step verification</h1>
    <p class="sub">Open Microsoft Authenticator and enter the 6-digit code for your account.</p>
    <div class="error-msg" id="err"></div>
    <form id="mfaForm">
      <label>Authenticator code</label>
      <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus autocomplete="one-time-code">
      <button class="btn" type="submit">Verify</button>
    </form>`);
  document.getElementById('mfaForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/login/mfa', 'POST', { code: code.value });
      location.hash = '#/dashboard';
      route();
    } catch (err) { showError(err.message); }
  };
}

function viewMfaSetup() {
  authShell(`
    <h1>Protect your account</h1>
    <p class="sub">Set up Microsoft Authenticator now — your books deserve more than just a password.</p>
    <div class="error-msg" id="err"></div>
    <div id="setupBody"><p class="steps">Generating your secret…</p></div>
    <a class="foot-note" href="#/dashboard">Skip for now (you can do this in Settings)</a>`);
  (async () => {
    const { secret } = await api('/api/mfa/setup', 'POST');
    document.getElementById('setupBody').innerHTML = `
      <p class="steps"><b>1.</b> Open Microsoft Authenticator → <b>Add account</b> → <b>Other account</b><br>
      <b>2.</b> Choose <b>Enter code manually</b><br>
      <b>3.</b> Account name: <b>${esc(secret.account || 'Reda')}</b> — use any name you like<br>
      <b>4.</b> Secret key (type it in, or copy):</p>
      <div class="secret-box" id="secret">${esc(secret)}</div>
      <p class="steps"><b>5.</b> Enter the 6-digit code the app shows to confirm:</p>
      <form id="enableForm">
        <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6-digit code" required>
        <button class="btn" type="submit">Confirm & activate</button>
      </form>`;
    document.getElementById('enableForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/mfa/enable', 'POST', { code: code.value });
        location.hash = '#/dashboard';
        route();
      } catch (err) { showError(err.message); }
    };
  })().catch((e) => showError(e.message));
}

function appShell(me, active, content) {
  $app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><div class="logo">R</div><span>Reda</span></div>
      <nav>
        <a href="#/dashboard" class="${active === 'dashboard' ? 'active' : ''}">📊 Invoices</a>
        <a href="#/settings" class="${active === 'settings' ? 'active' : ''}">⚙️ Settings</a>
      </nav>
      <div class="spacer"></div>
      <div class="userbox"><b>${esc(me.name)}</b>${esc(me.role)}<br>${esc(me.email)}</div>
      <nav><a href="#" id="logout">Log out</a></nav>
    </aside>
    <main class="main">${content}</main>
  </div>`;
  document.getElementById('logout').onclick = async (e) => {
    e.preventDefault();
    await api('/api/logout', 'POST');
    location.hash = '#/login';
    viewLogin();
  };
}

function viewDashboard(me) {
  appShell(me, 'dashboard', `
    <div class="topline">
      <h1>Invoices</h1>
      <span class="company-chip">🏢 ${esc(me.company)}</span>
    </div>
    <div class="stat-grid" id="stats"></div>
    <div class="card">
      <h2>📷 Scan a supplier invoice (optional)</h2>
      <p class="sub">Take a photo or choose an image — Reda reads it and fills the fields below. The image is processed <b>on your computer</b> and never uploaded anywhere. First use needs internet to fetch the reading engine (~15&nbsp;MB, cached afterwards).</p>
      <input type="file" id="scanFile" accept="image/*" capture="environment" hidden>
      <button class="btn small secondary" id="scanBtn" type="button">📷 Scan / photo of invoice</button>
      <span id="scanStatus" class="sub"></span>
    </div>
    <div class="card">
      <h2>New invoice</h2>
      <form id="invForm" class="form-row">
        <div><label>Customer</label><input id="customer" required placeholder="SIA Example"></div>
        <div><label>Amount</label><input id="amount" type="number" step="0.01" min="0.01" required placeholder="150.00"></div>
        <div><label>Currency</label><select id="currency"><option>EUR</option><option>USD</option><option>GBP</option></select></div>
        <div><label>Due date</label><input id="due_date" type="date"></div>
        <div style="grid-column: 1 / -1"><label>Description (optional)</label><input id="description" placeholder="Goods or services"></div>
        <button class="btn small" type="submit" style="grid-column: 1 / -1">Add invoice</button>
      </form>
      <div class="error-msg" id="err"></div>
    </div>
    <div class="card">
      <h2>Your invoices</h2>
      <div id="invList"><p class="empty">Loading…</p></div>
    </div>`);

  async function load() {
    const { invoices, totals } = await api('/api/invoices');
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="label">Invoices</div><div class="value">${totals.count}</div></div>
      <div class="stat"><div class="label">Paid</div><div class="value" style="color:var(--green)">${fmt(totals.paid_cents)}</div></div>
      <div class="stat"><div class="label">Open (draft + sent)</div><div class="value" style="color:var(--amber)">${fmt(totals.open_cents)}</div></div>`;
    document.getElementById('invList').innerHTML = invoices.length ? `
      <table><thead><tr><th>№</th><th>Customer</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${invoices.map((i) => `
        <tr>
          <td>${esc(i.number)}</td>
          <td>${esc(i.customer)}${i.description ? `<div style="color:var(--muted);font-size:.8rem">${esc(i.description)}</div>` : ''}</td>
          <td>${fmt(i.amount_cents, i.currency)}</td>
          <td>${esc(i.due_date || '—')}</td>
          <td><span class="badge ${i.status}">${i.status}</span></td>
          <td class="actions">
            ${i.status !== 'paid' ? `<button data-id="${i.id}" data-status="paid" class="markPaid">Mark paid</button>` : ''}
            <button data-id="${i.id}" class="del danger">Delete</button>
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="empty">No invoices yet — add your first one above. Only your company can see these.</p>';
    document.querySelectorAll('.markPaid').forEach((b) => b.onclick = async () => {
      await api('/api/invoices/status', 'PATCH', { id: +b.dataset.id, status: b.dataset.status });
      load();
    });
    document.querySelectorAll('.del').forEach((b) => b.onclick = async () => {
      if (confirm('Delete this invoice?')) {
        await api('/api/invoices?id=' + b.dataset.id, 'DELETE');
        load();
      }
    });
  }
  document.getElementById('scanBtn').onclick = () => document.getElementById('scanFile').click();
  document.getElementById('scanFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('scanStatus');
    e.target.value = '';
    try {
      status.textContent = 'Loading reading engine…';
      await loadTesseract();
      status.textContent = 'Reading invoice… (this takes ~5–20 seconds)';
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (l) => { if (l.status === 'recognizing text') status.textContent = `Reading invoice… ${Math.round(l.progress * 100)}%`; },
      });
      const parsed = parseInvoiceText(result.data.text);
      // prefill the form — the human always reviews before saving
      if (parsed.customer) document.getElementById('customer').value = parsed.customer;
      if (parsed.amount) document.getElementById('amount').value = parsed.amount;
      document.getElementById('currency').value = parsed.currency;
      if (parsed.due_date) document.getElementById('due_date').value = parsed.due_date;
      const parts = [];
      if (parsed.invoiceNo) parts.push(`Invoice ${parsed.invoiceNo}`);
      if (parsed.vat) parts.push(`VAT ${parsed.vat}`);
      if (parsed.amount) parts.push(`Detected total: ${parsed.amount} ${parsed.currency}`);
      document.getElementById('description').value = parts.length
        ? `${parts.join(', ')} (scanned — please check)`
        : '';
      const found = ['customer', 'amount', 'due_date', 'invoiceNo'].filter((k) => parsed[k]).length;
      status.textContent = found
        ? `✅ Filled ${found} of 4 fields — please check & correct them, then press "Add invoice".`
        : '⚠️ Could not read the fields reliably — try a sharper photo with better light, or fill in manually.';
    } catch (err) {
      status.textContent = `⚠️ ${err.message}`;
    }
  };

  document.getElementById('invForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/invoices', 'POST', {
        customer: customer.value, amount: amount.value, currency: currency.value,
        due_date: due_date.value, description: description.value,
      });
      e.target.reset();
      load();
    } catch (err) { showError(err.message); }
  };
  load().catch((e) => showError(e.message));
}

function viewSettings(me) {
  appShell(me, 'settings', `
    <div class="topline"><h1>Settings</h1><span class="company-chip">🏢 ${esc(me.company)}</span></div>
    <div class="card">
      <h2>Two-step verification (Microsoft Authenticator)</h2>
      <p class="sub" id="mfaStatus">${me.mfaEnabled
        ? '✅ Enabled — every login also asks for a 6-digit code from Microsoft Authenticator.'
        : '⚠️ Not enabled yet. Add a second factor so a stolen password alone can’t open your books.'}</p>
      <div class="error-msg" id="err"></div>
      <div id="mfaAction">
        ${me.mfaEnabled
          ? `<form id="disForm"><p class="steps">To disable, confirm a current code:</p><input id="code" maxlength="6" inputmode="numeric" placeholder="6-digit code" required> <button class="btn small secondary" type="submit">Disable MFA</button></form>`
          : `<button class="btn small" id="setupBtn">Set up Microsoft Authenticator</button>`}
      </div>
    </div>
    <div class="card">
      <h2>Company & account</h2>
      <table>
        <tr><td>Company</td><td><b>${esc(me.company)}</b></td></tr>
        <tr><td>Your name</td><td>${esc(me.name)}</td></tr>
        <tr><td>Email</td><td>${esc(me.email)}</td></tr>
        <tr><td>Role</td><td>${esc(me.role)}</td></tr>
      </table>
      <p class="sub" style="margin-top:.8rem">This data belongs only to your company workspace. No other company — and no other user without access — can see it.</p>
    </div>`);
  if (me.mfaEnabled) {
    document.getElementById('disForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/mfa/disable', 'POST', { code: code.value });
        route();
      } catch (err) { showError(err.message); }
    };
  } else {
    document.getElementById('setupBtn').onclick = () => viewMfaSetup();
  }
}

function showError(msg) {
  const el = document.getElementById('err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

route();
