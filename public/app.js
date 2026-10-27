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

// EU VAT rates 2026 (standard + reduced, per national law). Presets only — you can always type a custom rate,
// because countries change rates during the year and some goods (wood, medicine, books…) have their own rate.
const EU_VAT = {
  LV: { name: '🇱🇻 Latvia', rates: [21, 12, 5, 0] },
  LT: { name: '🇱🇹 Lithuania', rates: [21, 12, 9, 0] },
  EE: { name: '🇪🇪 Estonia', rates: [24, 13, 9, 0] },
  FI: { name: '🇫🇮 Finland', rates: [25.5, 14, 13.5, 10, 0] },
  SE: { name: '🇸🇪 Sweden', rates: [25, 12, 6, 0] },
  DK: { name: '🇩🇰 Denmark', rates: [25, 0] },
  DE: { name: '🇩🇪 Germany', rates: [19, 7, 0] },
  PL: { name: '🇵🇱 Poland', rates: [23, 8, 5, 0] },
  AT: { name: '🇦🇹 Austria', rates: [20, 13, 10, 0] },
  BE: { name: '🇧🇪 Belgium', rates: [21, 12, 6, 0] },
  NL: { name: '🇳🇱 Netherlands', rates: [21, 9, 0] },
  LU: { name: '🇱🇺 Luxembourg', rates: [17, 14, 8, 3, 0] },
  FR: { name: '🇫🇷 France', rates: [20, 10, 5.5, 2.1, 0] },
  IT: { name: '🇮🇹 Italy', rates: [22, 10, 5, 4, 0] },
  ES: { name: '🇪🇸 Spain', rates: [21, 10, 4, 0] },
  PT: { name: '🇵🇹 Portugal', rates: [23, 13, 6, 0] },
  IE: { name: '🇮🇪 Ireland', rates: [23, 13.5, 9, 4.8, 0] },
  CZ: { name: '🇨🇿 Czechia', rates: [21, 12, 0] },
  SK: { name: '🇸🇰 Slovakia', rates: [23, 19, 5, 0] },
  HU: { name: '🇭🇺 Hungary', rates: [27, 18, 5, 0] },
  RO: { name: '🇷🇴 Romania', rates: [21, 11, 9, 5, 0] },
  BG: { name: '🇧🇬 Bulgaria', rates: [20, 9, 0] },
  HR: { name: '🇭🇷 Croatia', rates: [25, 13, 5, 0] },
  SI: { name: '🇸🇮 Slovenia', rates: [22, 9.5, 5, 0] },
  GR: { name: '🇬🇷 Greece', rates: [24, 13, 6, 0] },
  CY: { name: '🇨🇾 Cyprus', rates: [19, 9, 5, 0] },
  MT: { name: '🇲🇹 Malta', rates: [18, 7, 5, 0] },
};


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
  const readDataUrl = () => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    onStatus('Reading spreadsheet…');
    await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
    return { text, kind: 'spreadsheet', preview: null };
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    onStatus('Opening PDF…');
    await loadPdfJs();
    await loadTesseract();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    let preview = null;
    const pages = Math.min(pdf.numPages, 3); // first 3 pages is enough for an invoice
    for (let p = 1; p <= pages; p++) {
      onStatus(`Reading PDF page ${p} of ${pages}…`);
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (p === 1) { // keep page 1 as the visual preview of the original
        const small = document.createElement('canvas');
        const v2 = page.getViewport({ scale: 1.2 });
        small.width = v2.width; small.height = v2.height;
        await page.render({ canvasContext: small.getContext('2d'), viewport: v2 }).promise;
        preview = small.toDataURL('image/jpeg', 0.75);
      }
      const r = await Tesseract.recognize(canvas, 'eng');
      text += r.data.text + '\n';
    }
    return { text, kind: 'pdf', preview };
  }
  onStatus('Loading reading engine…');
  await loadTesseract();
  const preview = await readDataUrl(); // the original photo IS the preview
  onStatus('Reading document… (this takes ~5–20 seconds)');
  const r = await Tesseract.recognize(file, 'eng', {
    logger: (l) => { if (l.status === 'recognizing text') onStatus(`Reading document… ${Math.round(l.progress * 100)}%`); },
  });
  return { text: r.data.text, kind: 'image', preview };
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
  const noRe = /\b(?:r[ēe][ķk]in[sa]|rekins|reknis|invoice|saskaita|ček|cek|nr|no|#)[\s.:#\-]*([A-Z0-9\-\/]*[0-9][A-Z0-9\-\/]*)/i;
  for (const line of lines) { const n = line.match(noRe); if (n) { invoiceNo = n[1]; break; } }

  // --- counterparty: line with a company form (SIA, AS, UAB, GmbH...) ---
  let customer = null;
  let regNo = null;
  for (const line of lines) {
    if (/^(r[ēe][ķk]in[sa]|rekins|reknis|fakt[ūu]ra|invoice|saskaita|[čc]ek[s]?|nr|no|#)/i.test(line)) continue; // "Invoice #AB-77" is a number, not a company
    const c = line.match(/\b(SIA|A\/S|S\.A\.|AS|UAB|O[ÜU]|GmbH|MB|Ltd|Limited|LLC|Llc|Inc|Corp|Co\.|OY|AB|BV|NV|Sp\.A\.|Zrt|d\.o\.o\.|s\.r\.o\.|K\/S|PS|IK|IP|SC)(?!-\d)/);
    if (c && line.length < 80) {
      let name = line;
      // strip Latvian / English "sender/buyer" labels and list numbers: "01. Nosūtītājs:", "Piegādātājs:", "From:", "3)" …
      name = name
        .replace(/^\s*\d{1,2}\s*[.\)\-–]\s*/, '')
        .replace(/^(pre[cč]u\s+)?(nos[ūu]t[īi]t[āa]js|nosutitajs|pieg[āa]d[āa]t[āa]js|s[ūu]t[īi]t[āa]js|sa[ņn][ēe]m[ēe]js|sanemejs|klients?|klientam|pirc[ēe]js|buyer|bill to|sold to|from|supplier|vendor|customer)\s*[:\-–]?\s*/i, '')
        .replace(/["'„“”]+/g, '')
        .trim();
      // cut the name off at the first registration/VAT/extra-info part: keep a clean company name only
      const cut = name.split(/\s+(?=(?:re[ğģg]\.?\s*nr|reg\.?\s*nr|re[ğģg]istr[āa]cijas|PVN|VAT|HRB|Invoice|Saskaita|R[ēe][ķk]ins)\b|\b[A-Z]{2,5}\d{4,}\b)/i)[0];
      if (cut.trim()) name = cut.trim();
      const rn = line.match(/\b(?:re[ğģg]\.?\s*nr|reg\.?\s*nr|re[ğģg]istr[āa]cijas\s*nr)\s*[:.]?\s*([A-Z]{0,3}[0-9]{6,15})/i);
      if (rn) regNo = rn[1];
      customer = name.slice(0, 80);
      break;
    }
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
    reg_no: regNo,
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
async function printDoc(me, d) {
  // company profile (details + logo) from Settings — appears on the letterhead
  let co = null;
  try { co = await api('/api/company'); } catch { co = null; }
  // banking v9.4: the bank account chosen on the document (or the first/default one)
  const banks = (co && Array.isArray(co.banks)) ? co.banks : [];
  const bank = banks.length ? banks[(d.bank_id && banks[d.bank_id - 1]) ? d.bank_id - 1 : 0] : null;
  const bankLine = bank ? `Bank: ${[bank.name, bank.iban, bank.swift].filter(Boolean).join(' · ')}` : (co && co.bank ? `Bank: ${co.bank}` : '');
  const coLines = co ? [co.address, co.reg_no ? `Reg. no. ${co.reg_no}` : '',
    co.vat_no ? `VAT no. ${co.vat_no}` : '', bankLine,
    co.phone, co.email].filter(Boolean) : [];
  const TITLES = { quote: 'OFFER / QUOTE', delivery: 'DELIVERY NOTE', invoice: 'INVOICE', bill: 'PURCHASE BILL' };
  const paid = (d.paid_cents || 0) / 100;
  const remaining = (d.amount_cents - (d.paid_cents || 0)) / 100;
  const today = new Date().toLocaleDateString('en-GB');
  const hasItems = Array.isArray(d.items) && d.items.length > 0;
  const rowsHtml = hasItems ? d.items.map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.code || '')}</td><td>${esc(it.name)}</td><td>${esc(it.tax_code || '')}</td>
    <td class="amount">${Number(it.qty)}</td>
    <td class="amount">${fmt(it.unit_price_cents, d.currency)}</td>
    <td class="amount">${fmt(Math.round(Number(it.qty) * it.unit_price_cents), d.currency)}</td></tr>`).join('') : `
    <tr><td>1</td><td></td><td>${esc(d.description || 'As agreed')}</td><td></td>
    <td class="amount">1</td><td class="amount"></td><td class="amount">${fmt(d.amount_cents, d.currency)}</td></tr>`;
  const vatRows = hasItems ? `
    <tr><td>Sum without VAT</td><td class="amount">${fmt(d.total_excl_cents, d.currency)}</td></tr>
    <tr><td>VAT ${d.vat_rate}%</td><td class="amount">${fmt(d.vat_cents, d.currency)}</td></tr>` : '';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${TITLES[d.doc_type]} ${esc(d.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c2733; font-size: 11pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0b5cad; padding-bottom: 10px; gap: 20px; }
  .head img.logo { max-height: 56px; max-width: 180px; }
  .company-wrap { display: flex; align-items: center; gap: 12px; }
  .company { font-size: 15pt; font-weight: bold; color: #0b5cad; }
  .company-details { color: #64748b; font-size: 8.5pt; margin-top: 3px; line-height: 1.5; }
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
    <div>
      <div class="company-wrap">
        ${co && co.has_logo ? '<img class="logo" src="/api/company/logo" alt="">' : ''}
        <div>
          <div class="company">${esc(me.company)}</div>
          <div style="color:#64748b;font-size:9.5pt">${esc(me.name)}${co && co.phone ? ' · ' + esc(co.phone) : ''}${co && co.email ? ' · ' + esc(co.email) : ''}</div>
          ${coLines.length ? `<div class="company-details">${coLines.map(esc).join('<br>')}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="doctype"><h1>${TITLES[d.doc_type]}</h1><div class="num">${esc(d.number)} · Issued: ${esc(d.issue_date)}</div></div>
  </div>
  <div class="parties">
    <div class="party"><h3>From</h3><b>${esc(me.company)}</b>${coLines.length ? `<div style="font-size:9pt;color:#334155;margin-top:4px">${coLines.map(esc).join('<br>')}</div>` : ''}</div>
    <div class="party"><h3>To</h3><b>${esc(d.customer)}</b></div>
  </div>
  <table class="items">
    <thead><tr><th style="width:20px">#</th><th style="width:80px">Code</th><th>Product / service</th><th style="width:90px">Tax code</th><th class="amount">Qty</th><th class="amount">Unit price</th><th class="amount">Sum</th></tr></thead>
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
  ${bank && (d.doc_type === 'invoice' || d.doc_type === 'quote') ? `<div class="meta"><b>Pay to:</b> ${esc([bank.name, bank.iban, bank.swift].filter(Boolean).join(' · '))}</div>` : ''}
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
  let custFilter = '';
  let sortKey = 'new';
  let docQuery = '';

  appShell(me, 'dashboard', `
    <div class="topline">
      <h1>Documents & money</h1>
      <span class="company-chip">🏢 ${esc(me.company)}</span>
    </div>
    <div class="stat-grid" id="stats"></div>
    <div class="page-grid">
    <div class="col-main">
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
        <div><label>Bank account for payment</label><select id="bankSel"><option value="">— default (first) —</option></select></div>
        <div><label>Document date</label><input id="issue_date" type="date"></div>
        <div><label>Payment due date</label><input id="due_date" type="date"></div>
        <div style="grid-column: 1 / -1"><label>Note (optional)</label><input id="description" placeholder="Extra note for this document"></div>

        <div style="grid-column: 1 / -1">
          <label>Products / services</label>
          <table id="itemsTable" style="margin-bottom:.5rem">
            <thead><tr><th style="width:2.2rem">#</th><th style="width:14%">Code</th><th>Product / service name</th><th style="width:13%">Tax code (optional)</th><th style="width:5.5rem">Qty</th><th style="width:7rem">Unit price</th><th style="width:7.5rem">Line sum</th><th style="width:2rem"></th></tr></thead>
            <tbody id="itemsBody"></tbody>
          </table>
          <button class="btn small secondary" id="addRow" type="button">+ Add line</button>
        </div>

        <div><label>VAT country (local law)</label><select id="vat_country"></select></div>
        <div><label>VAT rate</label><select id="vat_rate"></select>
          <input id="vat_custom" type="text" inputmode="decimal" placeholder="e.g. 25,5" style="display:none;margin-top:.3rem"></div>
        <div><label>Sum without VAT</label><input id="sum_excl" disabled placeholder="0.00"></div>
        <div><label>VAT amount</label><input id="sum_vat" disabled placeholder="0.00"></div>
        <div><label><b>Total with VAT</b></label><input id="sum_total" disabled style="font-weight:bold" placeholder="0.00"></div>
        <button class="btn small" type="submit" style="grid-column: 1 / -1">Add document</button>
      </form>
      <div class="error-msg" id="err"></div>
    </div>
    <div class="card" style="margin-top:1.2rem">
      <h2>📦 My stock (inventory)</h2>
      <p class="sub">What is in your warehouse right now. It counts goods received from purchase bills (steps “Received” or “Paid”) and takes out what you delivered (delivery notes marked “delivered” and invoices marked “sent” or “paid”).</p>
      <input type="search" id="stockSearch" placeholder="🔎 Find a product…" style="margin:.4rem 0 .8rem">
      <div id="stockBox"><p class="empty">Loading…</p></div>
    </div>
    <div class="panel-grid">
    <div class="card">
      <h2>📷 Scan a document (optional)</h2>
      <p class="sub">Photo, <b>PDF</b> or <b>Excel/CSV</b> — Reda reads it and fills the form. Files are processed <b>on your computer</b> and never uploaded anywhere. First use needs internet (~15&nbsp;MB engine, cached afterwards).</p>
      <input type="file" id="scanFile" accept="image/*,.pdf,.xlsx,.xls,.csv" hidden>
      <button class="btn small secondary" id="scanBtn" type="button">📷 Scan / photo / PDF / Excel</button>
      <span id="scanStatus" class="sub"></span>
      <div id="scanPreview" style="display:none;margin-top:.8rem"></div>
      <div id="scanActions" style="display:none;margin-top:.8rem;gap:.6rem;flex-wrap:wrap">
        <button class="btn small secondary" id="scanBill" type="button">📥 Supplier bill</button>
        <button class="btn small" id="scanSell" type="button">📤 I'm selling this</button>
      </div>
    </div>
      <div class="card"><h2>🛒 Purchase steps</h2><div id="pipeBox"><p class="empty">Loading…</p></div></div>
      <div class="card"><h2>💼 By customer</h2><p class="sub" style="margin-bottom:.5rem">Click a customer to show only their documents. Red = still owes you.</p><div id="custBox"><p class="empty">Loading…</p></div></div>
      <div class="card"><h2>💰 Unpaid — who to chase, what to pay</h2><p class="sub" style="margin-bottom:.5rem">🟡 yellow = payment due today · 🔴 red = overdue. Supplier bills = money YOU must pay — top priority.</p><div id="unpaidBox"><p class="empty">Loading…</p></div></div>
    </div>
    </div>
    <aside class="side">
      <div class="card">
        <h2>Your documents</h2>
        <input type="search" id="docSearch" placeholder="🔎 Search by word, name, number or amount…" style="width:100%;margin:.4rem 0 .8rem">
        <div id="tabs"></div>
        <div style="display:flex;gap:.6rem;align-items:center;margin:.6rem 0;flex-wrap:wrap">
          <span class="sub" style="margin:0">Sort:</span>
          <select id="sortSel" style="width:auto;padding:.3rem .5rem">
            <option value="new">Newest first</option>
            <option value="cust">Customer A–Z</option>
            <option value="amount">Amount high → low</option>
            <option value="due">Due date (soonest)</option>
            <option value="unpaid">Unpaid first</option>
          </select>
          <span id="activeCustFilter" style="display:none"></span>
        </div>
        <div id="invList"><p class="empty">Loading…</p></div>
      </div>
    </aside>
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

    // Right panel: purchase steps (bills)
    const bills = docs.filter((d) => d.doc_type === 'bill');
    const step = (st, label) => {
      const b = bills.filter((x) => x.status === st);
      const sum = b.reduce((s, x) => s + x.amount_cents - x.paid_cents, 0);
      return `<div class="pipe-row"><span>${label}</span><b>${b.length}</b><span style="color:${sum > 0 ? 'var(--red)' : 'var(--green)'}">${b.length ? fmt(sum) : ''}</span></div>`;
    };
    document.getElementById('pipeBox').innerHTML = bills.length ? `
      ${step('draft', '📝 1. Decided to buy')}
      ${step('ordered', '📤 2. Ordered (email sent)')}
      ${step('received', '📥 3. In stock')}
      ${step('paid', '✔ 4. Paid')}
      <p class="sub" style="margin-top:.5rem">Buttons on each bill row move it to the next step.</p>`
      : '<p class="empty">No purchase bills yet. Scan a supplier bill and choose “Purchase bill”.</p>';

    // Right panel: by customer (sales invoices)
    const byCust = {};
    docs.filter((d) => d.doc_type === 'invoice').forEach((d) => {
      const k = d.customer || '(no name)';
      byCust[k] = byCust[k] || { invoiced: 0, paid: 0 };
      byCust[k].invoiced += d.amount_cents; byCust[k].paid += d.paid_cents;
    });
    const custRows = Object.entries(byCust).map(([name, v]) => ({ name, ...v, owed: v.invoiced - v.paid }))
      .sort((a, b) => b.owed - a.owed);
    document.getElementById('custBox').innerHTML = custRows.length ? custRows.map((c) => `
      <div class="cust-row${custFilter === c.name ? ' active' : ''}" data-cust="${esc(c.name)}">
        <span class="cust-name">${esc(c.name)}</span>
        <span style="color:${c.owed > 0 ? 'var(--red)' : 'var(--green)'};white-space:nowrap">${fmt(c.owed)}</span>
      </div>`).join('') : '<p class="empty">No sales invoices yet.</p>';
    document.querySelectorAll('.cust-row').forEach((r) => r.onclick = () => {
      custFilter = custFilter === r.dataset.cust ? '' : r.dataset.cust;
      renderCustChip();
      load();
    });

    // Panel: unpaid list — overdue first, then bills you must pay, then customer debts
    const todayU = new Date().toISOString().slice(0, 10);
    const dueStateU = (d) => !d.due_date ? '' : d.due_date < todayU ? 'overdue' : d.due_date === todayU ? 'due-today' : '';
    const unpaid = docs.filter((d) => (d.doc_type === 'invoice' || d.doc_type === 'bill') && d.amount_cents - d.paid_cents > 0)
      .sort((a, b) => {
        const o = (x) => (x.due_date && x.due_date < todayU ? 0 : x.doc_type === 'bill' ? 1 : 2);
        return o(a) - o(b) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
      });
    document.getElementById('unpaidBox').innerHTML = unpaid.length ? unpaid.slice(0, 8).map((d) => `
      <div class="unpaid-row ${dueStateU(d)}">
        <span class="cust-name">${d.doc_type === 'bill' ? '🏭 <b>YOU PAY:</b> ' : ''}${esc(d.customer)}</span>
        <span style="white-space:nowrap">${fmt(d.amount_cents - d.paid_cents, d.currency)}<div style="color:var(--muted);font-size:.75rem">due ${esc(d.due_date || '—')}${dueStateU(d) === 'overdue' ? ' 🔴 overdue' : dueStateU(d) === 'due-today' ? ' 🟡 today' : ''}</div></span>
      </div>`).join('') + (unpaid.length > 8 ? `<p class="sub">…and ${unpaid.length - 8} more</p>` : '')
      : '<p class="empty">Nothing unpaid. ✔</p>';

    // Left column: my stock (goods in minus goods out)
    const stock = {};
    const moved = (d, dir) => {
      (d.items || []).forEach((it) => {
        const key = (it.code ? it.code + ' · ' : '') + (it.name || '').trim();
        if (!key || key === ' · ') return;
        stock[key] = stock[key] || { qty: 0, cost: 0, costN: 0 };
        stock[key].qty += dir * (Number(it.qty) || 0);
        if (dir > 0 && it.unit_price_cents >= 0) { stock[key].cost += Number(it.unit_price_cents) || 0; stock[key].costN++; }
      });
    };
    docs.forEach((d) => {
      if (d.doc_type === 'bill' && (d.status === 'received' || d.status === 'paid')) moved(d, 1);
      if (d.doc_type === 'delivery' && d.status === 'delivered') moved(d, -1);
      if (d.doc_type === 'invoice' && (d.status === 'sent' || d.status === 'paid')) moved(d, -1);
    });
    const stockRows = Object.entries(stock).map(([name, v]) => ({ name, qty: v.qty, unitCost: v.costN ? Math.round(v.cost / v.costN) : null }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    const renderStock = () => {
      const q = (document.getElementById('stockSearch').value || '').toLowerCase();
      const rows = stockRows.filter((r) => !q || r.name.toLowerCase().includes(q));
      document.getElementById('stockBox').innerHTML = rows.length ? `
        <table><thead><tr><th>Product</th><th>In stock</th><th>Unit cost (last)</th><th>Value</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td>${esc(r.name)}</td>
            <td style="font-weight:700;color:${r.qty > 0 ? 'var(--green)' : r.qty < 0 ? 'var(--red)' : 'var(--muted)'}">${r.qty}</td>
            <td>${r.unitCost != null ? fmt(r.unitCost) : '—'}</td>
            <td>${r.unitCost != null ? fmt(Math.max(r.qty, 0) * r.unitCost) : '—'}</td>
          </tr>`).join('')}</tbody></table>`
        : '<p class="empty">No stock yet. Add products as lines to a purchase bill and press “📥 Received” when they arrive — they appear here automatically.</p>';
    };
    renderStock();
    document.getElementById('stockSearch').oninput = renderStock;

    function renderCustChip() {
      const chip = document.getElementById('activeCustFilter');
      if (!custFilter) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
      chip.style.display = 'inline-block';
      chip.innerHTML = `<span class="badge invoice">${esc(custFilter)}</span> <a href="#" id="clearCust">✕ clear</a>`;
      document.getElementById('clearCust').onclick = (e) => { e.preventDefault(); custFilter = ''; renderCustChip(); load(); };
    }

    let shown = filter === 'all' ? docs.slice() : docs.filter((d) => d.doc_type === filter);
    if (custFilter) shown = shown.filter((d) => d.customer === custFilter);
    // free-text search: number, name, note, status, amount, product lines — whatever the user types
    if (docQuery) {
      const q = docQuery.toLowerCase();
      shown = shown.filter((d) =>
        [d.number, d.customer, d.description, d.status, d.due_date,
          (d.amount_cents / 100).toFixed(2), String(d.amount_cents / 100),
          ...(d.items || []).flatMap((it) => [it.code, it.name])]
          .some((v) => v != null && String(v).toLowerCase().includes(q)));
    }
    if (sortKey === 'cust') shown.sort((a, b) => String(a.customer).localeCompare(String(b.customer)));
    else if (sortKey === 'amount') shown.sort((a, b) => b.amount_cents - a.amount_cents);
    else if (sortKey === 'due') shown.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
    else if (sortKey === 'unpaid') shown.sort((a, b) => (b.amount_cents - b.paid_cents) - (a.amount_cents - a.paid_cents));
    const today = new Date().toISOString().slice(0, 10);
    const dueState = (d, remaining) => (!d.due_date || remaining <= 0) ? ''
      : d.due_date < today ? 'overdue' : d.due_date === today ? 'due-today' : '';
    document.getElementById('invList').innerHTML = shown.length ? `
      <table><thead><tr><th>№</th><th>Type</th><th>Customer</th><th>Amount</th><th>Paid</th><th>Remaining</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${shown.map((d) => {
        const payable = d.doc_type === 'invoice' || d.doc_type === 'bill';
        const remaining = d.amount_cents - d.paid_cents;
        return `
        <tr class="${dueState(d, remaining)}">
          <td>${esc(d.number)}${d.parent_id ? `<div style="color:var(--muted);font-size:.75rem">← converted</div>` : ''}${/scanned/.test(d.description || '') ? `<span title="Scanned document — check fields by hand" style="display:inline-block;width:12px;height:12px;background:#dc2626;border-radius:2px;vertical-align:middle;margin-left:.4rem"></span><span style="color:#b91c1c;font-size:.72rem"> check</span>` : ''}</td>
          <td><span class="badge ${d.doc_type}">${TYPE_LABELS[d.doc_type]}</span></td>
          <td>${esc(d.customer)}${d.description ? `<div style="color:var(--muted);font-size:.8rem">${esc(d.description)}</div>` : ''}</td>
          <td>${fmt(d.amount_cents, d.currency)}</td>
          ${payable
            ? `<td style="color:var(--green)">${fmt(d.paid_cents, d.currency)}</td>
               <td style="color:${remaining > 0 ? 'var(--red)' : 'var(--green)'}">${fmt(remaining, d.currency)}</td>`
            : '<td>—</td><td>—</td>'}
          <td>${esc(d.due_date || '—')}${dueState(d, remaining) === 'overdue' ? ' 🔴' : dueState(d, remaining) === 'due-today' ? ' 🟡' : ''}</td>
          <td><span class="badge ${d.status}">${d.status}</span></td>
          <td class="actions">
            <button data-id="${d.id}" class="print">🖨 PDF</button>
            ${d.doc_type === 'bill' && d.status === 'draft' ? `<button data-id="${d.id}" class="send billstep" data-st="ordered">📤 Order</button>` : ''}
            ${d.doc_type === 'bill' && d.status === 'ordered' ? `<button data-id="${d.id}" class="send billstep" data-st="received">📥 Received</button>` : ''}
            ${d.status === 'draft' && d.doc_type !== 'bill' ? `<button data-id="${d.id}" class="send" data-st="sent">Mark sent</button>` : ''}
            ${d.doc_type === 'quote' ? `<button data-id="${d.id}" class="conv" data-to="invoice">→ Invoice</button><button data-id="${d.id}" class="conv" data-to="delivery">→ Delivery</button>` : ''}
            ${d.doc_type === 'delivery' || d.doc_type === 'bill' ? `<button data-id="${d.id}" class="conv" data-to="invoice">→ Invoice</button>` : ''}
            ${d.items && d.items.length ? `<button data-id="${d.id}" class="reuse" title="Copy these products into the New document form">➕ Lines</button>` : ''}
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
      await api('/api/invoices/status', 'PATCH', { id: +b.dataset.id, status: b.dataset.st || 'sent' });
      load();
    });
    const sortSel = document.getElementById('sortSel');
    if (sortSel) sortSel.onchange = () => { sortKey = sortSel.value; load(); };
    const ds = document.getElementById('docSearch');
    if (ds) ds.oninput = () => { docQuery = ds.value.trim(); load(); };
    document.querySelectorAll('.acc').forEach((b) => b.onclick = async () => {
      await api('/api/invoices/status', 'PATCH', { id: +b.dataset.id, status: 'accepted' });
      load();
    });
    document.querySelectorAll('.conv').forEach((b) => b.onclick = async () => {
      const r = await api('/api/invoices/convert', 'POST', { id: +b.dataset.id, to: b.dataset.to });
      alert(`Created ${r.number} — it's in the list now.`);
      load();
    });
    // ➕ Lines: copy this document's products into the New document form (no retyping)
    document.querySelectorAll('.reuse').forEach((b) => b.onclick = () => {
      const src = docs.find((x) => x.id === +b.dataset.id);
      if (!src || !src.items || !src.items.length) return;
      itemsBody.innerHTML = ''; // start fresh with the copied lines
      for (const it of src.items) {
        addRowEl(it.code || '', it.name, it.qty, (it.unit_price_cents / 100).toFixed(2));
      }
      updateTotals();
      // selling on what you bought? default to a sales invoice; customer stays empty for you to pick
      if (src.doc_type === 'bill') document.getElementById('doc_type').value = 'invoice';
      document.getElementById('contact_id').value = '';
      custInput.value = '';
      document.getElementById('invForm').scrollIntoView({ behavior: 'smooth' });
      const n = src.items.length;
      document.getElementById('scanStatus').textContent = `✅ ${n} product line${n > 1 ? 's' : ''} copied — set the customer and your selling price, then press "Add document".`;
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
      <td><input class="it-tax" placeholder="Optional (CN/VAT)" maxlength="30" title="Tax/tariff code, e.g. 4407 for sawn wood — optional"></td>
      <td><input class="it-qty" type="text" inputmode="decimal" placeholder="1" value="${esc(String(qty))}"></td>
      <td><input class="it-price" type="text" inputmode="decimal" placeholder="0.00" value="${esc(String(price))}"></td>
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
      tax_code: tr.querySelector('.it-tax').value.trim(),
      qty: tr.querySelector('.it-qty').value,
      unit_price: tr.querySelector('.it-price').value,
    }));
  }
  function updateTotals() {
    const rate = Number(String(getVatRate()).replace(',', '.')) || 0;
    let excl = 0;
    [...itemsBody.children].forEach((tr) => {
      const qty = Number(String(tr.querySelector('.it-qty').value).replace(',', '.')) || 0;
      const price = Math.round((Number(String(tr.querySelector('.it-price').value).replace(',', '.')) || 0) * 100);
      const sum = Math.round(qty * price);
      tr.querySelector('.it-sum').textContent = sum ? fmt(sum) : '—';
      excl += sum;
    });
    const vat = Math.round(excl * rate / 100);
    document.getElementById('sum_excl').value = (excl / 100).toFixed(2);
    document.getElementById('sum_vat').value = (vat / 100).toFixed(2);
    document.getElementById('sum_total').value = ((excl + vat) / 100).toFixed(2);
  }
  // ---- EU VAT picker: country presets (local law) + custom manual rate ----
  const vatCountry = document.getElementById('vat_country');
  const vatRateSel = document.getElementById('vat_rate');
  const vatCustom = document.getElementById('vat_custom');
  vatCountry.innerHTML = Object.entries(EU_VAT)
    .map(([code, c]) => `<option value="${code}" ${code === 'LV' ? 'selected' : ''}>${c.name}</option>`).join('');
  function populateRates() {
    const rates = EU_VAT[vatCountry.value].rates;
    vatRateSel.innerHTML = rates.map((r) => `<option value="${r}">${r}%${r === 0 ? ' (no VAT)' : ''}</option>`).join('')
      + '<option value="custom">✏️ Other — type it…</option>';
    vatCustom.style.display = 'none';
    updateTotals();
  }
  const getVatRate = () => {
    if (vatRateSel.value === 'custom') return vatCustom.value.trim();
    return vatRateSel.value;
  };
  vatCountry.addEventListener('change', populateRates);
  vatRateSel.addEventListener('change', () => {
    vatCustom.style.display = vatRateSel.value === 'custom' ? 'block' : 'none';
    if (vatRateSel.value === 'custom') vatCustom.focus();
    updateTotals();
  });
  vatCustom.addEventListener('input', updateTotals);
  populateRates();
  document.getElementById('addRow').onclick = () => {
    const tr = addRowEl();
    tr.querySelector(itemsBody.children.length === 1 ? '.it-name' : '.it-name').focus();
  };
  addRowEl(); // start with one empty line
  // document date defaults to today, but the user can change it freely
  document.getElementById('issue_date').value = new Date().toISOString().slice(0, 10);

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

  // ---- scan flow: show the original + two ways to use it ----
  let lastScan = null; // { parsed, kind, preview }
  document.getElementById('scanFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('scanStatus');
    e.target.value = '';
    document.getElementById('scanActions').style.display = 'none';
    document.getElementById('scanPreview').style.display = 'none';
    try {
      const { text, kind, preview } = await fileToInvoiceText(file, (s) => status.textContent = s);
      const parsed = parseInvoiceText(text);
      lastScan = { parsed, kind, preview };
      // show the original document next to the form so you can check it
      const found = ['customer', 'amount', 'due_date', 'invoiceNo'].filter((k) => parsed[k]).length;
      // red warning box when something could not be read — the user must check that place manually
      const missing = [['customer', 'customer name'], ['amount', 'total amount'], ['due_date', 'payment due date']]
        .filter(([k]) => !parsed[k]).map(([, label]) => label);
      const warnBox = missing.length
        ? `<div style="margin-top:.6rem;border:2px solid #dc2626;background:#fef2f2;color:#b91c1c;border-radius:8px;padding:.6rem .8rem;display:flex;gap:.6rem;align-items:flex-start">
             <span style="width:16px;height:16px;background:#dc2626;border-radius:2px;flex:none;margin-top:2px"></span>
             <span><b>Reading problem:</b> could not read ${missing.join(', ')}. 🔴 Fill these fields by hand — see the original below.</span>
           </div>`
        : '';
      if (preview) {
        document.getElementById('scanPreview').innerHTML = `
          <div style="position:relative;display:inline-block;border:1px solid var(--border);border-radius:10px;padding:.4rem;background:#fff">
            <img src="${preview}" alt="Scanned original" style="max-height:300px;max-width:100%;border-radius:6px${missing.length ? ';outline:3px solid #dc2626;outline-offset:2px' : ''}">
            ${missing.length ? '<div style="position:absolute;top:.6rem;left:.6rem;width:18px;height:18px;background:#dc2626;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' : ''}
            <button type="button" id="scanClose" title="Close preview" style="position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:7px;width:24px;height:24px;cursor:pointer">×</button>
          </div>
          ${warnBox}`;
        document.getElementById('scanPreview').style.display = 'block';
        document.getElementById('scanClose').onclick = () => {
          document.getElementById('scanPreview').style.display = 'none';
          document.getElementById('scanActions').style.display = 'none';
          status.textContent = '';
        };
      } else if (warnBox) {
        document.getElementById('scanPreview').innerHTML = warnBox;
        document.getElementById('scanPreview').style.display = 'block';
      }
      status.textContent = found
        ? `✅ Read the document (found ${found} of 4 fields). Check it in the preview and choose below how to use it.`
        : '⚠️ Could not read the fields reliably — try a sharper photo with better light, or fill in manually.';
      document.getElementById('scanActions').style.display = 'flex';
    } catch (err) {
      status.textContent = `⚠️ ${err.message}`;
    }
  };

  const applyScan = async (mode) => {
    if (!lastScan) return;
    const { parsed, kind } = lastScan;
    const parts = [];
    if (parsed.invoiceNo) parts.push(`Invoice ${parsed.invoiceNo}`);
    if (parsed.vat) parts.push(`VAT ${parsed.vat}`);
    document.getElementById('description').value = parts.length ? `${parts.join(', ')} (scanned — please check)` : '';
    document.getElementById('currency').value = parsed.currency;
    itemsBody.innerHTML = '';
    document.getElementById('contact_id').value = '';
    if (parsed.amount) {
      const rate = Number(String(getVatRate()).replace(',', '.')) || 0;
      const total = Math.round(Number(parsed.amount) * 100);
      // scanned totals usually include VAT: reverse it out for the "without VAT" line price
      const excl = rate > 0 ? Math.round(total / (1 + rate / 100)) : total;
      addRowEl('', 'Scanned goods — please check', '1', (excl / 100).toFixed(2));
    }
    if (mode === 'bill') {
      // possibility 1: it's a supplier's document — save it as a Purchase bill
      document.getElementById('doc_type').value = 'bill';
      custInput.value = parsed.customer || '';
      document.getElementById('due_date').value = parsed.due_date || '';
      // automatically save this supplier into the contact library (if not there yet)
      try {
        const q = encodeURIComponent(parsed.customer || parsed.vat || '');
        const { contacts } = await api('/api/contacts' + (q ? `?q=${q}` : ''));
        let supplier = contacts.find((c) => (parsed.customer && c.name === parsed.customer) || (parsed.vat && c.vat_no === parsed.vat));
        if (!supplier) {
          const r = await api('/api/contacts', 'POST', {
            kind: 'company', name: parsed.customer || 'Unknown supplier (scanned)',
            vat_no: parsed.vat || '', reg_no: parsed.reg_no || '',
          });
          supplier = { id: r.id, name: parsed.customer };
          document.getElementById('scanStatus').textContent = `✅ Supplier "${parsed.customer}" saved to your contact library — filled as Purchase bill. Check the fields, then press "Add document".`;
        } else {
          document.getElementById('scanStatus').textContent = `✅ Supplier "${supplier.name}" was already in your library. Filled as Purchase bill — check the fields, then press "Add document".`;
        }
        document.getElementById('contact_id').value = supplier.id;
        custInput.value = parsed.customer || supplier.name;
      } catch {
        document.getElementById('scanStatus').textContent = '✅ Filled as Purchase bill — check the fields, then press "Add document".';
      }
    } else {
      // possibility 2: you're selling the same thing — copy only the total into your Invoice
      document.getElementById('doc_type').value = 'invoice';
      custInput.value = '';
      document.getElementById('due_date').value = '';
      document.getElementById('scanStatus').textContent = '✅ Total copied into your Invoice — pick the customer, adjust the price to your selling price, then press "Add document".';
    }
    updateTotals();
    document.getElementById('invForm').scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('scanBill').onclick = () => applyScan('bill');
  document.getElementById('scanSell').onclick = () => applyScan('sell');

  document.getElementById('invForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const items = collectItems();
      if (items.some((it) => (it.qty || it.unit_price) && !it.name)) {
        return showError('One line has a price/quantity but no product name — please fill in the name or remove the line.');
      }
      const vRateNum = Number(String(getVatRate()).replace(',', '.'));
      if (!Number.isFinite(vRateNum) || vRateNum < 0 || vRateNum > 100) {
        return showError('VAT rate must be a number between 0 and 100 (e.g. 21 or 25,5).');
      }
      const real = items.filter((it) => it.name);
      if (real.length && !real.every((it) => it.name && Number(String(it.qty).replace(',', '.')) > 0)) {
        return showError('Every line needs a product name and a quantity bigger than 0.');
      }
      await api('/api/invoices', 'POST', {
        customer: custInput.value,
        currency: document.getElementById('currency').value,
        due_date: document.getElementById('due_date').value,
        issue_date: document.getElementById('issue_date').value,
        description: document.getElementById('description').value,
        doc_type: document.getElementById('doc_type').value,
        items: real.length ? real : null,
        vat_rate: getVatRate(),
        contact_id: document.getElementById('contact_id').value || null,
        bank_id: document.getElementById('bankSel').value || null,
      });
      e.target.reset();
      document.getElementById('contact_id').value = '';
      document.getElementById('issue_date').value = new Date().toISOString().slice(0, 10);
      itemsBody.innerHTML = '';
      addRowEl();
      updateTotals();
      load();
    } catch (err) { showError(err.message); }
  };
  // fill the bank-account picker from your company profile (banking v9.4)
  api('/api/company').then((co) => {
    const sel = document.getElementById('bankSel');
    if (!sel || !Array.isArray(co.banks) || !co.banks.length) return;
    sel.innerHTML = '<option value="">— default (first) —</option>' + co.banks
      .map((b, i) => `<option value="${i + 1}">${esc(`${b.name || 'Bank'} · ${b.iban || ''}`)}</option>`).join('');
  }).catch(() => {});
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
      <h2>🏢 Company details & logo (used on printouts)</h2>
      <p class="sub">These details and your logo appear automatically on every invoice/offer PDF you print.</p>
      <div id="logoBox" style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
        <div id="logoPreview" style="min-width:100px;min-height:50px;border:1px dashed var(--border);border-radius:10px;padding:.5rem;display:flex;align-items:center;justify-content:center;background:#fff"></div>
        <input type="file" id="logoFile" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden>
        <button class="btn small secondary" id="logoBtn" type="button">📤 Upload logo</button>
        <button class="btn small secondary" id="logoDel" type="button" style="display:none">🗑 Remove logo</button>
      </div>
      <form id="coForm" class="form-row">
        <div style="grid-column:1 / -1"><label>Address</label><input id="co_address" placeholder="Street, city, postal code, country"></div>
        <div><label>Registration no.</label><input id="co_reg_no" placeholder="40001234567"></div>
        <div><label>VAT (PVN) no.</label><input id="co_vat_no" placeholder="LV40001234567"></div>
        <div style="grid-column:1 / -1"><label>Bank accounts (you can add more than one)</label>
          <div id="bankList" style="display:grid;gap:.5rem"></div>
          <button type="button" class="btn small secondary" id="addBankBtn" style="margin-top:.4rem">+ Add bank account</button>
        </div>
        <div><label>Phone</label><input id="co_phone" placeholder="+371 20000000"></div>
        <div><label>Email</label><input id="co_email" type="email" placeholder="info@yourcompany.lv"></div>
        <button class="btn small" type="submit" style="grid-column:1 / -1">Save company details</button>
      </form>
      <div id="coMsg" class="ok-msg"></div>
    </div>
    <div class="card">
      <h2>🧪 Demo data for testing</h2>
      <p class="sub">Adds <b>10 fake documents</b> (paid invoices, an overdue one, purchase bills, stock goods, an offer) so you can safely test searching, colors, stock and money totals. Your real documents are not touched.</p>
      <button class="btn small" id="demoBtn" type="button">➕ Add 10 demo documents</button>
      <span id="demoMsg" class="sub" style="margin-left:.6rem"></span>
    </div>
    <div class="card">
      <h2>👥 People in your company (<span id="userCount">…</span>)</h2>
      <p class="sub">Everyone in this list logs in with their own email and works in the same company workspace. Up to 10 people at the same time.</p>
      <div id="userList"><p class="empty">Loading…</p></div>
      <form id="addUserForm" class="form-row">
        <div><label>Name</label><input id="u_name" required placeholder="Jānis Bērziņš"></div>
        <div><label>Email</label><input id="u_email" type="email" required placeholder="janis@yourcompany.lv"></div>
        <div><label>Password (min 8)</label><input id="u_password" type="password" required minlength="8" placeholder="••••••••"></div>
        <div><label>Role</label><select id="u_role">
          <option value="accountant">Accountant (sees documents & contacts)</option>
          <option value="sales">Sales (writes documents)</option>
          <option value="owner">Owner (full control)</option>
        </select></div>
        <button class="btn small" type="submit" style="grid-column:1 / -1">Add person</button>
      </form>
      <p class="sub" id="userNote">Give the person their password personally and ask them to keep it safe. They log in on the same login page with their own email and this password.</p>
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

  // ---- company details & logo ----
  const coMsg = document.getElementById('coMsg');
  const coSay = (text, bad = false) => {
    coMsg.style.display = 'block';
    coMsg.style.background = bad ? '#fef2f2' : '';
    coMsg.style.borderColor = bad ? '#fecaca' : '';
    coMsg.style.color = bad ? 'var(--red)' : '';
    coMsg.textContent = text;
  };
  async function loadCompany() {
    const p = await api('/api/company');
    document.getElementById('co_address').value = p.address;
    document.getElementById('co_reg_no').value = p.reg_no;
    document.getElementById('co_vat_no').value = p.vat_no;
    renderBanks(Array.isArray(p.banks) ? p.banks : []);
    document.getElementById('co_phone').value = p.phone;
    document.getElementById('co_email').value = p.email;
    renderLogo(p.has_logo);
  }
  // ---- multiple bank accounts (banking v9.4) ----
  const renderBanks = (banks) => {
    const box = document.getElementById('bankList');
    box.innerHTML = banks.length ? banks.map((b, i) => `
      <div class="bank-row" data-i="${i}" style="display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:.4rem">
        <input class="bk-name" placeholder="Bank name (e.g. Swedbank)" value="${esc(b.name || '')}">
        <input class="bk-iban" placeholder="IBAN (LV12 BANK 0000 0000 0000)" value="${esc(b.iban || '')}">
        <input class="bk-swift" placeholder="SWIFT/BIC (optional)" value="${esc(b.swift || '')}">
        <button type="button" class="btn small secondary bk-del">🗑</button>
      </div>`).join('') : '<p class="sub" style="margin:0">No bank accounts yet — add one so customers know where to pay.</p>';
    box.querySelectorAll('.bk-del').forEach((btn) => btn.onclick = () => {
      const cur = collectBanks();
      cur.splice(+btn.closest('.bank-row').dataset.i, 1);
      renderBanks(cur);
    });
  };
  const collectBanks = () => Array.from(document.querySelectorAll('#bankList .bank-row')).map((row) => ({
    name: row.querySelector('.bk-name').value.trim(),
    iban: row.querySelector('.bk-iban').value.trim(),
    swift: row.querySelector('.bk-swift').value.trim(),
  })).filter((b) => b.name || b.iban);
  document.getElementById('addBankBtn').onclick = () => {
    const cur = collectBanks();
    if (cur.length >= 5) return coSay('⚠️ Up to 5 bank accounts.', true);
    cur.push({ name: '', iban: '', swift: '' });
    renderBanks(cur);
  };
  function renderLogo(has) {
    document.getElementById('logoDel').style.display = has ? 'inline-block' : 'none';
    document.getElementById('logoPreview').innerHTML = has
      ? `<img src="/api/company/logo?${Date.now()}" alt="Company logo" style="max-height:60px;max-width:180px">`
      : '<span class="sub" style="font-size:.8rem">No logo yet</span>';
  }
  document.getElementById('logoBtn').onclick = () => document.getElementById('logoFile').click();
  document.getElementById('logoFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    coSay('Uploading logo…');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api('/api/company/logo', 'POST', { data: dataUrl });
      coSay('✅ Logo saved — it will appear on every printout.');
      renderLogo(true);
    } catch (err) { coSay(`⚠️ ${err.message}`, true); }
  };
  document.getElementById('logoDel').onclick = async () => {
    await api('/api/company/logo', 'DELETE');
    coSay('Logo removed.');
    renderLogo(false);
  };
  document.getElementById('coForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/company', 'POST', {
        address: document.getElementById('co_address').value,
        reg_no: document.getElementById('co_reg_no').value,
        vat_no: document.getElementById('co_vat_no').value,
        banks: collectBanks(),
        phone: document.getElementById('co_phone').value,
        email: document.getElementById('co_email').value,
      });
      coSay('✅ Company details saved.');
    } catch (err) { coSay(`⚠️ ${err.message}`, true); }
  };
  // ---- demo data (10 fake documents) ----
  document.getElementById('demoBtn').onclick = async () => {
    const msg = document.getElementById('demoMsg');
    msg.textContent = 'Adding…';
    try {
      await api('/api/demo', 'POST', {});
      msg.textContent = '✅ 10 demo documents added — open the dashboard to see them.';
    } catch (err) { msg.textContent = `⚠️ ${err.message}`; }
  };
  loadCompany().catch(() => {});

  // ---- people in my company (max 10) ----
  async function loadUsers() {
    const { users, max } = await api('/api/users');
    document.getElementById('userCount').textContent = `${users.length} of ${max}`;
    const meId = me.email;
    document.getElementById('userList').innerHTML = `
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>MFA</th><th></th></tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td><b>${esc(u.name)}</b>${u.email === meId ? ' <span class="sub">(you)</span>' : ''}</td>
          <td>${esc(u.email)}</td>
          <td>${esc(u.role)}</td>
          <td>${u.mfa_enabled ? '✅' : '—'}</td>
          <td class="actions">${u.email !== meId ? `<button data-id="${u.id}" data-name="${esc(u.name)}" class="udel danger">Remove</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
      ${users.length >= max ? '<p class="sub">⚠️ You have reached the 10-user limit for your company.</p>' : ''}`;
    document.getElementById('userList').querySelectorAll('.udel').forEach((b) => b.onclick = async () => {
      if (confirm(`Remove ${b.dataset.name}? They will be logged out and lose access.`)) {
        try { await api('/api/users?id=' + b.dataset.id, 'DELETE'); loadUsers(); }
        catch (err) { showError(err.message); }
      }
    });
  }
  document.getElementById('addUserForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', 'POST', {
        name: document.getElementById('u_name').value,
        email: document.getElementById('u_email').value,
        password: document.getElementById('u_password').value,
        role: document.getElementById('u_role').value,
      });
      e.target.reset();
      loadUsers();
    } catch (err) { showError(err.message); }
  };
  loadUsers().catch(() => {});
}

function showError(msg) {
  const el = document.getElementById('err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

route();
