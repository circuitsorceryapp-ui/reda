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

let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      resolve();
    };
    s.onerror = () => reject(new Error('Could not load the PDF reader'));
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Excel reader'));
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

// Extracts raw text from an uploaded file: photo (OCR), PDF (render + OCR) or Excel/CSV (direct — exact values, no OCR)
async function fileToInvoiceText(file, onStatus) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    onStatus('Reading spreadsheet…');
    await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
    return { text, kind: 'spreadsheet' };
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    onStatus('Opening PDF…');
    await loadPdfJs();
    await loadTesseract();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    const pages = Math.min(pdf.numPages, 3); // first 3 pages is enough for an invoice
    for (let p = 1; p <= pages; p++) {
      onStatus(`Reading PDF page ${p} of ${pages}…`);
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const r = await Tesseract.recognize(canvas, 'eng');
      text += r.data.text + '\n';
    }
    return { text, kind: 'pdf' };
  }
  onStatus('Loading reading engine…');
  await loadTesseract();
  onStatus('Reading document… (this takes ~5–20 seconds)');
  const r = await Tesseract.recognize(file, 'eng', {
    logger: (l) => { if (l.status === 'recognizing text') onStatus(`Reading document… ${Math.round(l.progress * 100)}%`); },
  });
  return { text: r.data.text, kind: 'image' };
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
    if (hash === '#/contacts') return viewContacts(me);
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
        <a href="#/contacts" class="${active === 'contacts' ? 'active' : ''}">👥 Customers & suppliers</a>
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

// ---------- printable PDF: opens a clean A4 layout the browser can print or save as PDF ----------
function printDoc(me, d) {
  const TITLES = { quote: 'OFFER / QUOTE', delivery: 'DELIVERY NOTE', invoice: 'INVOICE', bill: 'PURCHASE BILL' };
  const paid = (d.paid_cents || 0) / 100;
  const remaining = (d.amount_cents - (d.paid_cents || 0)) / 100;
  const today = new Date().toLocaleDateString('en-GB');
  const hasItems = Array.isArray(d.items) && d.items.length > 0;
  const rowsHtml = hasItems ? d.items.map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.code || '')}</td><td>${esc(it.name)}</td>
    <td class="amount">${Number(it.qty)}</td>
    <td class="amount">${fmt(it.unit_price_cents, d.currency)}</td>
    <td class="amount">${fmt(Math.round(Number(it.qty) * it.unit_price_cents), d.currency)}</td></tr>`).join('') : `
    <tr><td>1</td><td></td><td>${esc(d.description || 'As agreed')}</td>
    <td class="amount">1</td><td class="amount"></td><td class="amount">${fmt(d.amount_cents, d.currency)}</td></tr>`;
  const vatRows = hasItems ? `
    <tr><td>Sum without VAT</td><td class="amount">${fmt(d.total_excl_cents, d.currency)}</td></tr>
    <tr><td>VAT ${d.vat_rate}%</td><td class="amount">${fmt(d.vat_cents, d.currency)}</td></tr>` : '';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${TITLES[d.doc_type]} ${esc(d.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c2733; font-size: 11pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0b5cad; padding-bottom: 10px; }
  .company { font-size: 15pt; font-weight: bold; color: #0b5cad; }
  .doctype { text-align: right; }
  .doctype h1 { margin: 0; font-size: 20pt; letter-spacing: 2px; color: #1c2733; }
  .doctype .num { color: #64748b; font-size: 10pt; margin-top: 4px; }
  .parties { display: flex; justify-content: space-between; margin: 22px 0; }
  .party { width: 46%; }
  .party h3 { margin: 0 0 6px; font-size: 9pt; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.items th { text-align: left; border-bottom: 2px solid #1c2733; padding: 7px 8px; font-size: 9pt; text-transform: uppercase; color: #64748b; }
  table.items td { border-bottom: 1px solid #dde3ea; padding: 9px 8px; }
  .amount { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 300px; margin-top: 14px; }
  .totals td { padding: 5px 8px; }
  .totals .grand { border-top: 2px solid #1c2733; font-weight: bold; font-size: 12pt; }
  .totals .red { color: #c0392b; } .totals .green { color: #0f8a4d; }
  .meta { margin: 14px 0 0; font-size: 10pt; color: #334155; }
  .meta b { color: #1c2733; }
  .foot { margin-top: 40px; padding-top: 10px; border-top: 1px solid #dde3ea; font-size: 8.5pt; color: #94a3b8; display: flex; justify-content: space-between; }
  .status { display: inline-block; padding: 3px 12px; border: 1px solid; border-radius: 999px; font-size: 9pt; font-weight: bold; text-transform: uppercase; }
</style></head><body>
  <div class="head">
    <div><div class="company">${esc(me.company)}</div><div style="color:#64748b;font-size:9.5pt;margin-top:3px">${esc(me.name)} · ${esc(me.email)}</div></div>
    <div class="doctype"><h1>${TITLES[d.doc_type]}</h1><div class="num">${esc(d.number)} · Issued: ${esc(d.issue_date)}</div></div>
  </div>
  <div class="parties">
    <div class="party"><h3>From</h3><b>${esc(me.company)}</b></div>
    <div class="party"><h3>To</h3><b>${esc(d.customer)}</b></div>
  </div>
  <table class="items">
    <thead><tr><th style="width:20px">#</th><th style="width:80px">Code</th><th>Product / service</th><th class="amount">Qty</th><th class="amount">Unit price</th><th class="amount">Sum</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <table class="totals">
    ${vatRows}
    <tr><td>Total incl. VAT</td><td class="amount">${fmt(d.amount_cents, d.currency)}</td></tr>
    ${d.doc_type === 'invoice' || d.doc_type === 'bill' ? `
    <tr><td>Paid to date</td><td class="amount green">${fmt((d.paid_cents || 0), d.currency)}</td></tr>
    <tr><td>Remaining</td><td class="amount ${remaining > 0 ? 'red' : 'green'}">${fmt((d.amount_cents - (d.paid_cents || 0)), d.currency)}</td></tr>` : ''}
    <tr class="grand"><td class="grand">Total ${d.doc_type === 'quote' ? 'offered' : 'due'}</td><td class="amount grand">${fmt(remaining > 0 && d.doc_type !== 'quote' ? (d.amount_cents - (d.paid_cents || 0)) : d.amount_cents, d.currency)}</td></tr>
  </table>
  ${d.due_date ? `<div class="meta"><b>Payment/delivery due:</b> ${esc(d.due_date)}</div>` : ''}
  <div class="meta"><b>Status:</b> ${esc(d.status)}</div>
  <div class="foot"><span>Printed on ${today}</span><span>Generated with Reda — lite ERP for small business</span></div>
</body></html>`;
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.srcdoc = html;
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
  document.body.appendChild(f);
}

function viewDashboard(me) {
  const TYPE_LABELS = { quote: 'Offer', delivery: 'Delivery note', invoice: 'Invoice', bill: 'Purchase bill' };
  let filter = 'all';

  appShell(me, 'dashboard', `
    <div class="topline">
      <h1>Documents & money</h1>
      <span class="company-chip">🏢 ${esc(me.company)}</span>
    </div>
    <div class="stat-grid" id="stats"></div>
    <div class="card">
      <h2>📷 Scan a document (optional)</h2>
      <p class="sub">Photo, <b>PDF</b> or <b>Excel/CSV</b> — Reda reads it and fills the fields below. Files are processed <b>on your computer</b> and never uploaded anywhere. Scanning a supplier document? Choose "Purchase bill" as the type after it fills. First use needs internet (~15&nbsp;MB engine, cached afterwards).</p>
      <input type="file" id="scanFile" accept="image/*,.pdf,.xlsx,.xls,.csv" hidden>
      <button class="btn small secondary" id="scanBtn" type="button">📷 Scan / photo / PDF / Excel</button>
      <span id="scanStatus" class="sub"></span>
    </div>
    <div class="card">
      <h2>New document</h2>
      <form id="invForm" class="form-row">
        <div><label>Type</label><select id="doc_type">
          <option value="invoice">🧾 Invoice (you invoice a customer)</option>
          <option value="quote">📝 Offer / quote</option>
          <option value="delivery">📦 Delivery note</option>
          <option value="bill">📥 Purchase bill (supplier invoiced you)</option>
        </select></div>
        <div style="position:relative"><label>Customer / supplier</label>
          <input id="customer" required placeholder="Start typing a name, phone or email…" autocomplete="off">
          <input type="hidden" id="contact_id" value="">
          <div id="contactSuggest" style="display:none;position:absolute;z-index:10;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.12);width:100%;max-height:220px;overflow:auto"></div>
        </div>
        <div><label>Currency</label><select id="currency"><option>EUR</option><option>USD</option><option>GBP</option></select></div>
        <div><label>Due date</label><input id="due_date" type="date"></div>
        <div style="grid-column: 1 / -1"><label>Note (optional)</label><input id="description" placeholder="Extra note for this document"></div>

        <div style="grid-column: 1 / -1">
          <label>Products / services</label>
          <table id="itemsTable" style="margin-bottom:.5rem">
            <thead><tr><th style="width:2.2rem">#</th><th style="width:16%">Code</th><th>Product / service name</th><th style="width:5.5rem">Qty</th><th style="width:7rem">Unit price</th><th style="width:7.5rem">Line sum</th><th style="width:2rem"></th></tr></thead>
            <tbody id="itemsBody"></tbody>
          </table>
          <button class="btn small secondary" id="addRow" type="button">+ Add line</button>
        </div>

        <div><label>VAT rate</label><select id="vat_rate">
          <option value="21" selected>21%</option>
          <option value="12">12%</option>
          <option value="5">5%</option>
          <option value="0">0% (no VAT)</option>
        </select></div>
        <div><label>Sum without VAT</label><input id="sum_excl" disabled placeholder="0.00"></div>
        <div><label>VAT amount</label><input id="sum_vat" disabled placeholder="0.00"></div>
        <div><label><b>Total with VAT</b></label><input id="sum_total" disabled style="font-weight:bold" placeholder="0.00"></div>
        <button class="btn small" type="submit" style="grid-column: 1 / -1">Add document</button>
      </form>
      <div class="error-msg" id="err"></div>
    </div>
    <div class="card">
      <h2>Your documents</h2>
      <div id="tabs"></div>
      <div id="invList"><p class="empty">Loading…</p></div>
    </div>`);

  async function load() {
    const { invoices: docs, totals } = await api('/api/invoices');
    const t = totals;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="label">Customers owe you</div><div class="value" style="color:var(--amber)">${fmt(t.customers_owe)}</div></div>
      <div class="stat"><div class="label">You owe suppliers</div><div class="value" style="color:var(--red)">${fmt(t.you_owe)}</div></div>
      <div class="stat"><div class="label">Sales invoiced</div><div class="value">${fmt(t.sales_invoiced)}</div></div>
      <div class="stat"><div class="label">Sales paid</div><div class="value" style="color:var(--green)">${fmt(t.sales_paid)}</div></div>
      <div class="stat"><div class="label">Open offers</div><div class="value">${t.quotes_open}</div><div class="label">${fmt(t.quotes_value)}</div></div>`;

    const counts = { all: docs.length, quote: 0, delivery: 0, invoice: 0, bill: 0 };
    docs.forEach((d) => counts[d.doc_type] = (counts[d.doc_type] || 0) + 1);
    document.getElementById('tabs').innerHTML = `
      <p class="sub">${['all', 'quote', 'delivery', 'invoice', 'bill'].map((k) =>
        `<a href="#" data-tab="${k}" style="margin-right:1rem;${filter === k ? 'font-weight:700;text-decoration:underline' : ''}">${k === 'all' ? 'All' : TYPE_LABELS[k]} (${counts[k] || 0})</a>`).join('')}</p>`;
    document.querySelectorAll('#tabs a').forEach((a) => a.onclick = (e) => { e.preventDefault(); filter = a.dataset.tab; load(); });

    const shown = filter === 'all' ? docs : docs.filter((d) => d.doc_type === filter);
    document.getElementById('invList').innerHTML = shown.length ? `
      <table><thead><tr><th>№</th><th>Type</th><th>Customer</th><th>Amount</th><th>Paid</th><th>Remaining</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${shown.map((d) => {
        const payable = d.doc_type === 'invoice' || d.doc_type === 'bill';
        const remaining = d.amount_cents - d.paid_cents;
        return `
        <tr>
          <td>${esc(d.number)}${d.parent_id ? `<div style="color:var(--muted);font-size:.75rem">← converted</div>` : ''}</td>
          <td><span class="badge ${d.doc_type}">${TYPE_LABELS[d.doc_type]}</span></td>
          <td>${esc(d.customer)}${d.description ? `<div style="color:var(--muted);font-size:.8rem">${esc(d.description)}</div>` : ''}</td>
          <td>${fmt(d.amount_cents, d.currency)}</td>
          ${payable
            ? `<td style="color:var(--green)">${fmt(d.paid_cents, d.currency)}</td>
               <td style="color:${remaining > 0 ? 'var(--red)' : 'var(--green)'}">${fmt(remaining, d.currency)}</td>`
            : '<td>—</td><td>—</td>'}
          <td>${esc(d.due_date || '—')}</td>
          <td><span class="badge ${d.status}">${d.status}</span></td>
          <td class="actions">
            <button data-id="${d.id}" class="print">🖨 PDF</button>
            ${d.status === 'draft' ? `<button data-id="${d.id}" class="send">Mark sent</button>` : ''}
            ${d.doc_type === 'quote' ? `<button data-id="${d.id}" class="conv" data-to="invoice">→ Invoice</button><button data-id="${d.id}" class="conv" data-to="delivery">→ Delivery</button>` : ''}
            ${d.doc_type === 'delivery' ? `<button data-id="${d.id}" class="conv" data-to="invoice">→ Invoice</button>` : ''}
            ${payable && remaining > 0 ? `<button data-id="${d.id}" data-rem="${remaining / 100}" class="pay">💰 Pay</button>` : ''}
            ${d.status === 'sent' && d.doc_type === 'quote' ? `<button data-id="${d.id}" class="acc">✔ Accepted</button>` : ''}
            <button data-id="${d.id}" class="del danger">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>`
      : '<p class="empty">No documents here yet — create one above. Only your company can see these.</p>';

    document.querySelectorAll('.print').forEach((b) => b.onclick = () => {
      const d = docs.find((x) => x.id === +b.dataset.id);
      if (d) printDoc(me, d);
    });
    document.querySelectorAll('.send').forEach((b) => b.onclick = async () => {
      await api('/api/invoices/status', 'PATCH', { id: +b.dataset.id, status: 'sent' });
      load();
    });
    document.querySelectorAll('.acc').forEach((b) => b.onclick = async () => {
      await api('/api/invoices/status', 'PATCH', { id: +b.dataset.id, status: 'accepted' });
      load();
    });
    document.querySelectorAll('.conv').forEach((b) => b.onclick = async () => {
      const r = await api('/api/invoices/convert', 'POST', { id: +b.dataset.id, to: b.dataset.to });
      alert(`Created ${r.number} — it's in the list now.`);
      load();
    });
    document.querySelectorAll('.pay').forEach((b) => b.onclick = async () => {
      const input = prompt(`Payment amount (e.g. ${b.dataset.rem}):`, b.dataset.rem);
      if (input === null) return;
      try {
        await api('/api/invoices/payments', 'POST', { invoice_id: +b.dataset.id, amount: input });
        load();
      } catch (e) { alert(e.message); }
    });
    document.querySelectorAll('.del').forEach((b) => b.onclick = async () => {
      if (confirm('Delete this document?')) {
        await api('/api/invoices?id=' + b.dataset.id, 'DELETE');
        load();
      }
    });
  }

  document.getElementById('scanBtn').onclick = () => document.getElementById('scanFile').click();
  // ---- line items editor ----
  const itemsBody = document.getElementById('itemsBody');
  function addRowEl(code = '', name = '', qty = '1', price = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rowNo"></td>
      <td><input class="it-code" placeholder="SKU-1" maxlength="60"></td>
      <td><input class="it-name" placeholder="Product or service" maxlength="300"></td>
      <td><input class="it-qty" type="number" step="0.001" min="0" value="${esc(String(qty))}"></td>
      <td><input class="it-price" type="number" step="0.01" min="0" placeholder="0.00" value="${esc(String(price))}"></td>
      <td class="it-sum" style="text-align:right;white-space:nowrap">—</td>
      <td><button type="button" class="it-del danger" title="Remove line" style="padding:0 .4rem">×</button></td>`;
    itemsBody.appendChild(tr);
    tr.querySelector('.it-del').onclick = () => { tr.remove(); renumber(); updateTotals(); };
    tr.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateTotals));
    renumber(); updateTotals();
    return tr;
  }
  function renumber() {
    [...itemsBody.children].forEach((tr, i) => { tr.querySelector('.rowNo').textContent = i + 1; });
  }
  function collectItems() {
    return [...itemsBody.children].map((tr) => ({
      code: tr.querySelector('.it-code').value.trim(),
      name: tr.querySelector('.it-name').value.trim(),
      qty: tr.querySelector('.it-qty').value,
      unit_price: tr.querySelector('.it-price').value,
    }));
  }
  function updateTotals() {
    const rate = Number(document.getElementById('vat_rate').value) || 0;
    let excl = 0;
    [...itemsBody.children].forEach((tr) => {
      const qty = Number(tr.querySelector('.it-qty').value) || 0;
      const price = Math.round((Number(tr.querySelector('.it-price').value) || 0) * 100);
      const sum = Math.round(qty * price);
      tr.querySelector('.it-sum').textContent = sum ? fmt(sum) : '—';
      excl += sum;
    });
    const vat = Math.round(excl * rate / 100);
    document.getElementById('sum_excl').value = (excl / 100).toFixed(2);
    document.getElementById('sum_vat').value = (vat / 100).toFixed(2);
    document.getElementById('sum_total').value = ((excl + vat) / 100).toFixed(2);
  }
  document.getElementById('vat_rate').addEventListener('change', updateTotals);
  document.getElementById('addRow').onclick = () => {
    const tr = addRowEl();
    tr.querySelector(itemsBody.children.length === 1 ? '.it-name' : '.it-name').focus();
  };
  addRowEl(); // start with one empty line

  // ---- customer search (saved contacts: search by name, person, phone or email) ----
  const custInput = document.getElementById('customer');
  const suggestBox = document.getElementById('contactSuggest');
  let searchTimer = null;
  custInput.addEventListener('input', () => {
    document.getElementById('contact_id').value = ''; // typing manually = not linked anymore
    clearTimeout(searchTimer);
    const q = custInput.value.trim();
    if (q.length < 1) { suggestBox.style.display = 'none'; return; }
    searchTimer = setTimeout(async () => {
      try {
        const { contacts } = await api('/api/contacts?q=' + encodeURIComponent(q));
        if (!contacts.length) { suggestBox.style.display = 'none'; return; }
        suggestBox.innerHTML = contacts.map((c) => `
          <div class="sug" data-id="${c.id}" data-name="${esc(c.name)}" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--line)">
            <b>${esc(c.name)}</b> <span class="sub">${c.kind === 'person' ? '👤 person' : '🏢 company'}</span>
            <div class="sub">${esc([c.phone, c.email, c.vat_no].filter(Boolean).join(' · '))}</div>
          </div>`).join('');
        suggestBox.style.display = 'block';
        suggestBox.querySelectorAll('.sug').forEach((el) => el.onmousedown = (e) => {
          e.preventDefault();
          custInput.value = el.dataset.name;
          document.getElementById('contact_id').value = el.dataset.id;
          suggestBox.style.display = 'none';
        });
      } catch { suggestBox.style.display = 'none'; }
    }, 200);
  });
  custInput.addEventListener('blur', () => setTimeout(() => suggestBox.style.display = 'none', 150));

  document.getElementById('scanFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('scanStatus');
    e.target.value = '';
    try {
      const { text, kind } = await fileToInvoiceText(file, (s) => status.textContent = s);
      const parsed = parseInvoiceText(text);
      if (parsed.customer) { custInput.value = parsed.customer; document.getElementById('contact_id').value = ''; }
      document.getElementById('currency').value = parsed.currency;
      if (parsed.due_date) document.getElementById('due_date').value = parsed.due_date;
      const parts = [];
      if (parsed.invoiceNo) parts.push(`Invoice ${parsed.invoiceNo}`);
      if (parsed.vat) parts.push(`VAT ${parsed.vat}`);
      document.getElementById('description').value = parts.length ? `${parts.join(', ')} (scanned — please check)` : '';
      if (parsed.amount) {
        // put the scanned total into one line; if it looks like it includes VAT, use it as "with VAT" total
        itemsBody.innerHTML = '';
        const rate = Number(document.getElementById('vat_rate').value) || 0;
        const total = Math.round(Number(parsed.amount) * 100);
        const excl = rate > 0 ? Math.round(total / (1 + rate / 100)) : total;
        addRowEl('', 'Scanned item — please check', '1', (excl / 100).toFixed(2));
      }
      if (kind === 'spreadsheet') status.textContent = '✅ Read from spreadsheet — please check the fields, then press "Add document".';
      else {
        const found = ['customer', 'amount', 'due_date', 'invoiceNo'].filter((k) => parsed[k]).length;
        status.textContent = found
          ? `✅ Filled ${found} of 4 fields — please check & correct them, then press "Add document".`
          : '⚠️ Could not read the fields reliably — try a sharper photo with better light, or fill in manually.';
      }
    } catch (err) {
      status.textContent = `⚠️ ${err.message}`;
    }
  };

  document.getElementById('invForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const items = collectItems().filter((it) => it.name || it.unit_price);
      if (items.length && !items.every((it) => it.name && Number(it.qty) > 0)) {
        return showError('Every line needs a product name and a quantity bigger than 0.');
      }
      await api('/api/invoices', 'POST', {
        customer: custInput.value,
        currency: document.getElementById('currency').value,
        due_date: document.getElementById('due_date').value,
        description: document.getElementById('description').value,
        doc_type: document.getElementById('doc_type').value,
        items: items.length ? items : null,
        vat_rate: document.getElementById('vat_rate').value,
        contact_id: document.getElementById('contact_id').value || null,
      });
      e.target.reset();
      document.getElementById('contact_id').value = '';
      itemsBody.innerHTML = '';
      addRowEl();
      updateTotals();
      load();
    } catch (err) { showError(err.message); }
  };
  load().catch((e) => showError(e.message));
}

function viewContacts(me) {
  let q = '';
  appShell(me, 'contacts', `
    <div class="topline"><h1>Customers & suppliers</h1><span class="company-chip">🏢 ${esc(me.company)}</span></div>
    <div class="card">
      <h2>Search</h2>
      <div class="form-row">
        <div style="grid-column:1 / -1;position:relative">
          <input id="cq" placeholder="Search by company, person, phone, email, registration or VAT number…" autocomplete="off">
          <button class="btn small secondary" id="clearQ" type="button" style="margin-left:.5rem">Clear</button>
        </div>
      </div>
      <div id="contactList"><p class="empty">Loading…</p></div>
    </div>
    <div class="card">
      <h2 id="formTitle">Add new contact</h2>
      <div class="error-msg" id="err"></div>
      <form id="contactForm" class="form-row">
        <div><label>Type</label><select id="c_kind"><option value="company">🏢 Company</option><option value="person">👤 Private person</option></select></div>
        <div><label>Name *</label><input id="c_name" required placeholder="SIA Example or Jānis Bērziņš"></div>
        <div><label>Registration no.</label><input id="c_reg_no" placeholder="40001234567"></div>
        <div><label>VAT (PVN) no.</label><input id="c_vat_no" placeholder="LV40001234567"></div>
        <div><label>Email</label><input id="c_email" type="email" placeholder="info@example.com"></div>
        <div><label>Phone</label><input id="c_phone" placeholder="+371 20000000"></div>
        <div style="grid-column: 1 / -1"><label>Address</label><input id="c_address" placeholder="Street, city, postal code, country"></div>
        <button class="btn small" type="submit">Save contact</button>
        <button class="btn small secondary" id="cancelEdit" type="button" style="display:none">Cancel edit</button>
      </form>
    </div>`);

  const $ = (id) => document.getElementById(id);
  let editingId = null;

  async function load() {
    const { contacts } = await api('/api/contacts?q=' + encodeURIComponent(q));
    $('contactList').innerHTML = contacts.length ? `
      <table><thead><tr><th>Name</th><th>Type</th><th>Reg. no.</th><th>VAT no.</th><th>Email</th><th>Phone</th><th></th></tr></thead>
      <tbody>${contacts.map((c) => `
        <tr>
          <td><b>${esc(c.name)}</b>${c.address ? `<div style="color:var(--muted);font-size:.8rem">${esc(c.address)}</div>` : ''}</td>
          <td>${c.kind === 'person' ? '👤 person' : '🏢 company'}</td>
          <td>${esc(c.reg_no || '—')}</td>
          <td>${esc(c.vat_no || '—')}</td>
          <td>${esc(c.email || '—')}</td>
          <td>${esc(c.phone || '—')}</td>
          <td class="actions">
            <button data-id="${c.id}" class="cedit">✏️ Edit</button>
            <button data-id="${c.id}" class="cdel danger">Delete</button>
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="empty">No contacts found. Add your first customer below — then you can pick them by name, phone or email when writing invoices.</p>';
    $('contactList').querySelectorAll('.cedit').forEach((b) => b.onclick = () => {
      const c = contacts.find((x) => x.id === +b.dataset.id);
      if (!c) return;
      editingId = c.id;
      $('formTitle').textContent = `Edit: ${c.name}`;
      $('c_kind').value = c.kind; $('c_name').value = c.name; $('c_reg_no').value = c.reg_no;
      $('c_vat_no').value = c.vat_no; $('c_email').value = c.email; $('c_phone').value = c.phone;
      $('c_address').value = c.address;
      $('cancelEdit').style.display = 'inline-block';
      $('contactForm').scrollIntoView({ behavior: 'smooth' });
    });
    $('contactList').querySelectorAll('.cdel').forEach((b) => b.onclick = async () => {
      if (confirm('Delete this contact? Documents already written keep the name.')) {
        await api('/api/contacts?id=' + b.dataset.id, 'DELETE');
        load();
      }
    });
  }

  $('cq').addEventListener('input', () => { q = $('cq').value.trim(); load(); });
  $('clearQ').onclick = () => { q = ''; $('cq').value = ''; load(); };
  $('cancelEdit').onclick = () => {
    editingId = null; $('contactForm').reset();
    $('formTitle').textContent = 'Add new contact';
    $('cancelEdit').style.display = 'none';
  };
  $('contactForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = {
        kind: $('c_kind').value, name: $('c_name').value, reg_no: $('c_reg_no').value,
        vat_no: $('c_vat_no').value, email: $('c_email').value, phone: $('c_phone').value,
        address: $('c_address').value,
      };
      if (editingId) await api('/api/contacts', 'PATCH', { id: editingId, ...data });
      else await api('/api/contacts', 'POST', data);
      $('cancelEdit').click();
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
