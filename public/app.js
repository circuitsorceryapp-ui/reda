// Verdins — single-page application (plain JavaScript, no frameworks)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => (Number(c || 0) / 100).toFixed(2);
  const fmD = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return String(d || ''); } };
  const T = (s) => (window.VERDINS_I18N ? window.VERDINS_I18N.translateText(s) : s);
  const today = () => new Date().toISOString().slice(0, 10);

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
  const patch = (p, body) => api(p, { method: 'PATCH', body: JSON.stringify(body || {}) });
  const del = (p) => api(p, { method: 'DELETE' });

  const LOGO = '<svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#0f766e"/><text x="16" y="22" font-family="Georgia,serif" font-size="17" font-weight="bold" fill="#ffffff" text-anchor="middle">V</text></svg>';
  const BRAND = '<div style="display:flex;align-items:center;gap:10px">' + LOGO +
    '<div><div style="font-size:19px;font-weight:700;letter-spacing:.3px;color:inherit">Verdins</div>' +
    '<div class="muted" style="font-size:12px;letter-spacing:2px;color:inherit;opacity:.8">ACCOUNTING</div></div></div>';

  function showErr(box, msg) { box.innerHTML = '<div class="error-line">' + esc(msg) + '</div>'; }

  // ---------- auth screens ----------
  function viewLogin(mode) {
    mode = mode || 'login';
    app.innerHTML = `
    <div class="auth">
      <div class="card" style="max-width:420px;margin:auto">
        ${BRAND}
        <h2 style="margin-top:16px">${mode === 'login' ? 'Welcome back' : 'Create a company workspace'}</h2>
        <p class="muted">${mode === 'login' ? 'Sign in to your company workspace' : 'One workspace for your whole company'}</p>
        <form id="authForm">
          ${mode === 'register' ? `
          <label>Company name<br><input id="fCompany" required maxlength="200" style="width:100%"></label><br>
          <label>Your name<br><input id="fName" required maxlength="100" style="width:100%"></label><br>` : ''}
          <label>Email<br><input id="fEmail" type="email" required style="width:100%"></label><br>
          <label>Password<br><input id="fPass" type="password" required minlength="8" style="width:100%"></label><br>
          <button class="btn" style="width:100%;margin-top:8px">${mode === 'login' ? 'Sign in' : 'Create workspace'}</button>
        </form>
        <div id="authErr"></div>
        <p style="margin-top:14px"><a href="#" id="authSwitch">${mode === 'login' ? 'New company? Create one' : 'Already have an account? Sign in'}</a></p>
      </div>
    </div>`;
    $('authSwitch').onclick = (e) => { e.preventDefault(); viewLogin(mode === 'login' ? 'register' : 'login'); };
    $('authForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('authErr');
      err.innerHTML = '';
      try {
        if (mode === 'login') {
          const r = await post('/api/login', { email: $('fEmail').value.trim(), password: $('fPass').value });
          if (r.mfaRequired) return viewMfa();
          await enterApp();
        } else {
          await post('/api/register', {
            companyName: $('fCompany').value.trim(), name: $('fName').value.trim(),
            email: $('fEmail').value.trim(), password: $('fPass').value,
          });
          await post('/api/login', { email: $('fEmail').value.trim(), password: $('fPass').value });
          await enterApp();
        }
      } catch (ex) { showErr(err, ex.message); }
    };
  }

  function viewMfa() {
    app.innerHTML = `
    <div class="auth">
      <div class="card" style="max-width:420px;margin:auto">
        ${BRAND}
        <h2 style="margin-top:16px">Two-step verification</h2>
        <p class="muted">Enter the 6-digit code from your app</p>
        <form id="mfaForm">
          <input id="fCode" inputmode="numeric" pattern="[0-9]*" maxlength="6" required style="width:160px;font-size:20px;letter-spacing:4px;text-align:center"><br><br>
          <button class="btn" style="width:100%">Verify</button>
        </form>
        <div id="mfaErr"></div>
      </div>
    </div>`;
    $('fCode').focus();
    $('mfaForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await post('/api/mfa/verify', { code: $('fCode').value.trim() });
        await enterApp();
      } catch (ex) { showErr($('mfaErr'), ex.message); }
    };
  }

  // ---------- app shell ----------
  let me = null;
  const NAV = [
    ['dashboard', 'Dashboard'], ['documents', 'Documents'], ['contacts', 'Customers & suppliers'],
    ['stock', 'My stock'], ['scans', 'Scanned originals'], ['settings', 'Settings'],
  ];
  function shell(content, active) {
    app.innerHTML = `
    <div class="shell">
      <aside class="side">
        ${BRAND}
        <nav style="margin-top:24px">
          ${NAV.map(([id, label]) => '<div style="margin:6px 0"><a href="#' + id + '" class="navlink' + (id === active ? ' active' : '') + '">' + T(label) + '</a></div>').join('')}
        </nav>
        <div style="margin-top:auto">
          <div style="font-size:13px">${esc(me.company)}</div>
          <div class="small" style="opacity:.7">${esc(me.email)}</div>
          <button class="btn secondary small" id="navLogout" style="margin-top:8px">Log out</button>
        </div>
      </aside>
      <main class="main">${content}</main>
    </div>`;
    $('navLogout').onclick = async () => { try { await post('/api/logout'); } catch {} me = null; viewLogin('login'); };
  }

  // ---------- dashboard ----------
  async function viewDashboard() {
    const { invoices } = await api('/api/invoices');
    const month = new Date().toISOString().slice(0, 7);
    const whoOwes = invoices.filter((i) => i.doc_type === 'invoice' && (i.status === 'sent' || i.status === 'partial' || i.status === 'draft') && (i.amount_cents - i.paid_cents) > 0);
    const youOwe = invoices.filter((i) => i.doc_type === 'bill' && i.status !== 'paid' && (i.amount_cents - i.paid_cents) > 0);
    const sum = (list) => list.reduce((a, i) => a + i.amount_cents - i.paid_cents, 0);
    const unpaid = whoOwes.concat(youOwe);
    shell(`
      <h1>Dashboard</h1>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:16px">
        <div class="kpi"><div class="muted">Who owes you</div><div style="font-size:24px;font-weight:700;margin-top:6px">€ ${money(sum(whoOwes))}</div></div>
        <div class="kpi"><div class="muted">You owe suppliers</div><div style="font-size:24px;font-weight:700;margin-top:6px">€ ${money(sum(youOwe))}</div></div>
        <div class="kpi"><div class="muted">Documents this month</div><div style="font-size:24px;font-weight:700;margin-top:6px">${invoices.filter((i) => (i.issue_date || '').startsWith(month)).length}</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Unpaid documents</h2>
        ${unpaid.length ? `<table><thead><tr><th>Number</th><th>Customer</th><th>Amount</th><th>Due date</th></tr></thead><tbody>
          ${unpaid.slice(0, 12).map((i) => {
            const overdue = i.due_date && i.due_date < today();
            return '<tr class="' + (overdue ? 'overdue' : '') + '"><td><a href="#documents?d=' + i.id + '">' + esc(i.number) + '</a></td><td>' + esc(i.customer) + '</td><td>€ ' + money(i.amount_cents - i.paid_cents) + '</td><td>' + esc(i.due_date || '—') + '</td></tr>';
          }).join('')}</tbody></table>` : '<p class="muted">No unpaid documents yet</p>'}
      </div>
    `, 'dashboard');
  }

  // ---------- documents list ----------
  async function viewDocuments(query) {
    const { invoices } = await api('/api/invoices');
    const q = (query.q || '').toLowerCase();
    const type = query.type || '';
    const sort = query.sort || 'new';
    let list = invoices.slice();
    if (q) list = list.filter((i) => (i.number + ' ' + i.customer + ' ' + (i.description || '')).toLowerCase().includes(q));
    if (type) list = list.filter((i) => i.doc_type === type);
    const cmp = {
      new: (a, b) => b.id - a.id, old: (a, b) => a.id - b.id,
      big: (a, b) => b.amount_cents - a.amount_cents, small: (a, b) => a.amount_cents - b.amount_cents,
      due: (a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')),
    }[sort] || ((a, b) => b.id - a.id);
    list.sort(cmp);
    const badge = (i) => {
      let s = i.status;
      if (i.doc_type === 'invoice' && s !== 'paid' && s !== 'draft' && i.due_date && i.due_date < today() && i.amount_cents > i.paid_cents) s = 'overdue';
      return '<span class="badge b-' + s + '">' + T(s.charAt(0).toUpperCase() + s.slice(1)) + '</span>';
    };
    shell(`
      <h1>Documents</h1>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:14px">
        <input id="docSearch" placeholder="${T('Search documents')}" value="${esc(query.q || '')}" style="min-width:220px">
        <select id="docType">
          <option value="">${T('All types')}</option>
          <option value="invoice" ${type === 'invoice' ? 'selected' : ''}>${T('Invoices')}</option>
          <option value="quote" ${type === 'quote' ? 'selected' : ''}>${T('Quotes')}</option>
          <option value="bill" ${type === 'bill' ? 'selected' : ''}>${T('Bills (purchases)')}</option>
          <option value="cmr" ${type === 'cmr' ? 'selected' : ''}>${T('CMR waybills')}</option>
        </select>
        <select id="docSort">
          <option value="new" ${sort === 'new' ? 'selected' : ''}>${T('Newest first')}</option>
          <option value="old" ${sort === 'old' ? 'selected' : ''}>${T('Oldest first')}</option>
          <option value="big" ${sort === 'big' ? 'selected' : ''}>${T('Amount largest → smallest')}</option>
          <option value="small" ${sort === 'small' ? 'selected' : ''}>${T('Amount smallest → largest')}</option>
          <option value="due" ${sort === 'due' ? 'selected' : ''}>${T('Due soonest')}</option>
        </select>
        <span style="flex:1"></span>
        <button class="btn" id="btnNewInv">New invoice</button>
        <button class="btn secondary" id="btnNewQuo">New quote</button>
        <button class="btn secondary" id="btnNewBill">New bill</button>
        <button class="btn secondary" id="btnNewCmr">New CMR</button>
      </div>
      ${list.length ? `<div class="card" style="margin-top:14px"><table>
        <thead><tr><th>Number</th><th>${T('Status')}</th><th>${T('Customer')}</th><th>${T('Amount')}</th><th>${T('Issue date')}</th><th>${T('Due date')}</th></tr></thead>
        <tbody>${list.map((i) => '<tr><td><a href="#documents?d=' + i.id + '">' + esc(i.number) + '</a></td><td>' + badge(i) + '</td><td>' + esc(i.customer) + '</td><td>€ ' + money(i.amount_cents) + (i.paid_cents && i.paid_cents < i.amount_cents ? ' <span class="muted small">(' + T('Paid').toLowerCase() + ' € ' + money(i.paid_cents) + ')</span>' : '') + '</td><td>' + esc(fmD(i.issue_date)) + '</td><td>' + esc(i.due_date || '—') + '</td></tr>').join('')}</tbody>
      </table></div>` : '<p class="muted" style="margin-top:16px">' + T('Nothing here yet') + '</p>'}
    `, 'documents');
    const go = () => { location.hash = '#documents?' + new URLSearchParams({ q: $('docSearch').value, type: $('docType').value, sort: $('docSort').value }).toString(); };
    $('docSearch').oninput = (() => { let t; return () => { clearTimeout(t); t = setTimeout(go, 250); }; })();
    $('docType').onchange = go; $('docSort').onchange = go;
    $('btnNewInv').onclick = () => viewDoc('invoice');
    $('btnNewQuo').onclick = () => viewDoc('quote');
    $('btnNewBill').onclick = () => viewDoc('bill');
    $('btnNewCmr').onclick = () => viewDoc('cmr');
  }

  // ---------- one document (view / edit) ----------
  async function viewDoc(docType, id) {
    const isNew = !id;
    let doc = null;
    const [{ contacts }, company] = await Promise.all([api('/api/contacts'), api('/api/company')]);
    if (!isNew) doc = await api('/api/invoices/' + id);
    else doc = {
      doc_type: docType, items: [], status: 'draft', issue_date: today(), due_date: '',
      vat_rate: 21, amount: 0, customer: '', description: '', bank_id: null, contact_id: null,
      scan_warn: 0, cmr_carrier: '', cmr_dispatch: '', cmr_delivery: '', cmr_weight: '', cmr_packages: '',
    };
    const isCmr = doc.doc_type === 'cmr';
    const typeLabel = { invoice: 'Invoice', quote: 'Quote', bill: 'Bill', cmr: 'CMR' }[doc.doc_type];
    shell(`
      <div class="row"><a href="#documents">← ${T('Documents')}</a></div>
      <h1 style="margin-top:10px">${isNew ? T('New document') : esc(doc.number) + ' — ' + T(typeLabel)}</h1>
      ${doc.scan_warn ? '<div class="warn-box">' + T('The amount on this document looks unusual — please check') + '</div>' : ''}
      <div class="card" style="margin-top:14px">
        <div class="grid" style="gap:10px">
          <label>${isCmr ? T('Consignee') : T('Customer')}<br><input id="fCustomer" list="contactList" value="${esc(doc.customer)}" style="width:100%"></label>
          <datalist id="contactList">${contacts.map((c) => '<option value="' + esc(c.name) + '">').join('')}</datalist>
          <label>${isCmr ? T('Goods') : T('Description')}<br><input id="fDesc" value="${esc(doc.description || '')}" style="width:100%"></label>
          <label>${T('Issue date')}<br><input id="fIssue" type="date" value="${esc(doc.issue_date || today())}"></label>
          <label>${isCmr ? T('Place of delivery') : T('Due date')}<br><input id="fDue" type="date" value="${esc(doc.due_date || '')}"></label>
          ${isCmr ? `
          <label>${T('Carrier')}<br><input id="fCarrier" value="${esc(doc.cmr_carrier || '')}" style="width:100%"></label>
          <label>${T('Place of dispatch')}<br><input id="fDispatch" value="${esc(doc.cmr_dispatch || '')}" style="width:100%"></label>
          <label>${T('Number of packages')}<br><input id="fPackages" value="${esc(doc.cmr_packages || '')}"></label>
          <label>${T('Gross weight (kg)')}<br><input id="fWeight" value="${esc(doc.cmr_weight || '')}"></label>` : `
          <label>VAT %<br><input id="fVat" type="number" step="0.5" min="0" max="100" value="${esc(doc.vat_rate ?? 21)}"></label>
          ${doc.doc_type === 'invoice' && (company.company.banks || []).length ? `
          <label>${T('Bank account on printout')}<br><select id="fBank" style="width:100%">
            <option value="">—</option>
            ${(company.company.banks).map((b) => '<option value="' + (b.id ?? b.iban) + '"' + (String(doc.bank_id) === String(b.id ?? b.iban) ? ' selected' : '') + '>' + esc(b.name || '') + ' · ' + esc(b.iban) + '</option>').join('')}
          </select></label>` : ''}`}
        </div>
        ${isCmr ? '' : `
        <h2 style="margin-top:18px">${T('Line items')}</h2>
        <table id="itemsTable"><thead><tr><th style="width:45%">${T('Item')}</th><th>${T('Qty')}</th><th>${T('Unit price')}</th><th>${T('Sum')}</th><th></th></tr></thead>
        <tbody id="itemsBody"></tbody></table>
        <button class="btn secondary small" id="btnAddLine">Add line</button>
        <div style="margin-top:14px;font-weight:600">Total: <span id="totalOut">€ 0.00</span></div>`}
        <div class="row" style="margin-top:18px;flex-wrap:wrap">
          <button class="btn" id="btnSave">Save</button>
          ${isNew ? '' : '<button class="btn secondary" id="btnPrint">Print</button>'}
          ${!isNew && doc.doc_type === 'invoice' ? '<button class="btn secondary" id="btnGenCmr">' + T('Generate CMR') + '</button>' : ''}
          ${isNew ? '' : '<span style="flex:1"></span><button class="btn danger" id="btnDelete">Delete</button>'}
        </div>
        <div id="docErr"></div>
      </div>
      <div id="docExtra"></div>
    `, 'documents');
    const items = isCmr ? [] : (doc.items && doc.items.length ? doc.items : []).map((x) => ({ name: x.name || '', qty: Number(x.qty) || 0, price: Number(x.price) || 0 }));
    function recalc() {
      const total = items.reduce((a, x) => a + x.qty * x.price, 0);
      $('totalOut').textContent = '€ ' + total.toFixed(2);
    }
    function renderItems() {
      $('itemsBody').innerHTML = items.map((x, idx) => `
        <tr>
          <td><input data-i="${idx}" data-f="name" value="${esc(x.name)}" style="width:100%"></td>
          <td><input data-i="${idx}" data-f="qty" type="number" step="any" min="0" value="${esc(x.qty)}" style="width:80px"></td>
          <td><input data-i="${idx}" data-f="price" type="number" step="any" min="0" value="${esc(x.price)}" style="width:110px"></td>
          <td id="lineSum${idx}">€ ${(x.qty * x.price).toFixed(2)}</td>
          <td>${items.length > 1 ? '<button class="btn danger small" data-del="' + idx + '">✕</button>' : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">—</td></tr>';
      $('itemsBody').querySelectorAll('input[data-i]').forEach((inp) => {
        inp.oninput = () => {
          const i = +inp.dataset.i;
          items[i][inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : Number(inp.value) || 0;
          $('lineSum' + i).textContent = '€ ' + (items[i].qty * items[i].price).toFixed(2);
          recalc();
        };
      });
      $('itemsBody').querySelectorAll('button[data-del]').forEach((b) => {
        b.onclick = () => { items.splice(+b.dataset.del, 1); renderItems(); recalc(); };
      });
      recalc();
    }
    if (!isCmr) {
      $('btnAddLine').onclick = () => { items.push({ name: '', qty: 1, price: 0 }); renderItems(); };
      renderItems();
    }

    const payload = () => {
      const total = items.reduce((a, x) => a + x.qty * x.price, 0);
      return {
        doc_type: doc.doc_type, customer: $('fCustomer').value.trim(), description: $('fDesc').value,
        issue_date: $('fIssue').value, due_date: $('fDue').value,
        amount: isCmr ? (Number(doc.amount_cents ? doc.amount_cents / 100 : 0) || 0) : total,
        items: isCmr ? (doc.items || []) : items,
        bank_id: $('fBank') ? $('fBank').value || null : null,
        cmr_carrier: $('fCarrier') ? $('fCarrier').value : '',
        cmr_dispatch: $('fDispatch') ? $('fDispatch').value : '',
        cmr_packages: $('fPackages') ? $('fPackages').value : '',
        cmr_weight: $('fWeight') ? $('fWeight').value : '',
      };
    };
    $('btnSave').onclick = async () => {
      const err = $('docErr'); err.innerHTML = '';
      try {
        if (isNew) {
          const r = await post('/api/invoices', payload());
          location.hash = '#documents?d=' + r.id;
        } else {
          await patch('/api/invoices/' + id, payload());
          alert(T('Document saved'));
        }
      } catch (ex) { showErr(err, ex.message); }
    };
    if (!isNew) {
      $('btnPrint').onclick = () => (isCmr ? printCmr(doc.id) : printDoc(doc.id));
      $('btnDelete').onclick = async () => {
        if (!confirm(T('Delete document?'))) return;
        await del('/api/invoices/' + id);
        location.hash = '#documents';
      };
      if ($('btnGenCmr')) $('btnGenCmr').onclick = () => generateCmr(doc);
      renderDocExtra(doc);
    }
  }

  // "Generate CMR" from an invoice: creates a linked CMR waybill with the invoice data
  async function generateCmr(invoice) {
    try {
      const goods = (invoice.items || []).map((x) => x.name).join(', ') || invoice.description || '';
      const packages = String((invoice.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0) || '');
      const r = await post('/api/invoices', {
        doc_type: 'cmr', customer: invoice.customer, description: goods,
        items: invoice.items || [], amount: invoice.amount_cents / 100,
        cmr_packages: packages,
        issue_date: today(),
      });
      alert(T('CMR consignment note') + ' ' + r.number + ' ' + T('Created').toLowerCase() + '.');
      await printCmr(r.id);
    } catch (ex) { alert(ex.message); }
  }

  // payments + scan panel for an existing document
  async function renderDocExtra(doc) {
    const box = $('docExtra');
    const full = await api('/api/invoices/' + doc.id);
    const isCmr = doc.doc_type === 'cmr';
    box.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card">
          <h2>${T('Payments')}</h2>
          ${doc.doc_type === 'quote' || isCmr ? '<p class="muted">' + T('Quotes are not paid') + '</p>' : `
          <table><tbody>${(full.payments || []).map((p) => '<tr><td>' + esc(p.paid_on) + '</td><td>€ ' + money(p.amount_cents) + '</td><td class="muted">' + esc(p.note || '') + '</td><td><button class="btn danger small" data-pay="' + p.id + '">✕</button></td></tr>').join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table>
          <div class="row" style="margin-top:10px;gap:8px">
            <input id="payAmt" type="number" step="any" min="0" placeholder="${T('Payment amount')}">
            <input id="payDate" type="date" value="${today()}">
            <button class="btn small" id="btnPay">${T('Record payment')}</button>
          </div>`}
        </div>
        <div class="card">
          <h2>${T('Scanned originals')}</h2>
          <div class="scan-box">
            <label class="btn secondary small" for="scanInput">${T('Link scan')}</label>
            <input type="file" id="scanInput" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv">
            <span class="muted small" id="scanMsg"></span>
          </div>
          <div id="scanList" style="margin-top:10px"></div>
        </div>
      </div>`;
    box.querySelectorAll('button[data-pay]').forEach((b) => {
      b.onclick = async () => { await del('/api/payments/' + b.dataset.pay); viewDoc(doc.doc_type, doc.id); };
    });
    const payBtn = $('btnPay');
    if (payBtn) payBtn.onclick = async () => {
      try {
        await post('/api/invoices/payments', { invoice_id: doc.id, amount: $('payAmt').value, paid_on: $('payDate').value, note: '' });
        viewDoc(doc.doc_type, doc.id);
      } catch (ex) { alert(ex.message); }
    };
    renderScanList(doc);
    $('scanInput').onchange = () => handleScanInput($('scanInput'), doc);
  }

  async function renderScanList(doc) {
    const { scans } = await api('/api/scans');
    const mine = scans.filter((s) => s.doc_number === doc.number);
    const list = $('scanList');
    if (!list) return;
    list.innerHTML = mine.length ? mine.map((s) => `
      <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <a href="/api/scans/${s.id}" target="_blank">${esc(s.filename)}</a>
        <span style="flex:1"></span>
        <button class="btn danger small" data-scan="${s.id}">Delete</button>
      </div>`).join('') : '<p class="muted small">' + T('Not linked') + '</p>';
    list.querySelectorAll('button[data-scan]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/scans', { method: 'DELETE', body: JSON.stringify({ id: +b.dataset.scan }) });
        renderScanList(doc);
      };
    });
  }

  // scan upload: images/PDF stored as-is; Excel/CSV parsed with SheetJS
  async function handleScanInput(input, doc) {
    const f = input.files[0];
    if (!f) return;
    const msg = $('scanMsg');
    msg.textContent = T('Scanning…');
    try {
      if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.mjs');
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        await parseSheet(rows, doc);
      } else {
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
        });
        if (/\.pdf$/i.test(f.name) || dataUrl.startsWith('data:application/pdf')) {
          await post('/api/scans', { filename: f.name, data: dataUrl, doc_number: doc ? doc.number : null });
          msg.textContent = T('Scan saved and linked');
          if (doc) renderScanList(doc);
        } else {
          const text = await runOcr(dataUrl);
          await post('/api/scans', { filename: f.name, data: dataUrl, doc_number: doc ? doc.number : null });
          await parseDocText(text, doc);
          msg.textContent = T('Scan saved and linked');
          if (doc) renderScanList(doc);
        }
      }
    } catch (ex) { msg.textContent = T('Could not read the file'); }
    input.value = '';
  }
  async function runOcr(dataUrl) {
    const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
    const { createWorker } = mod;
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();
    return data.text || '';
  }
  const amtRe = /(?:total|amount|summa|kopā|betrag|montant|totale|importe|razem)[^0-9]{0,20}([0-9][0-9 .,]{1,12})/i;
  function findAmount(text) {
    const m = text.match(amtRe);
    if (!m) return null;
    let s = m[1].trim().replace(/ /g, '');
    if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  async function parseDocText(text, doc) {
    const amount = findAmount(text);
    if (amount == null) return;
    if (doc) {
      const big = amount > 10000;
      await patch('/api/invoices/' + doc.id, { amount, scan_warn: big ? 1 : 0 });
      alert(T('Amount found on the scan') + ': € ' + amount.toFixed(2) + (big ? '\n\n' + T('Large amount — please check the document') : ''));
      viewDoc(doc.doc_type, doc.id);
    } else {
      alert(T('Amount found on the scan') + ': € ' + amount.toFixed(2));
    }
  }
  async function parseSheet(rows, doc) {
    if (!rows.length) return;
    const head = rows[0].map((h) => String(h || '').toLowerCase().trim());
    const idx = (names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const iName = idx(['item', 'description', 'nosaukums', 'prece']);
    const iQty = idx(['qty', 'quantity', 'daudzums', 'skaits']);
    const iPrice = idx(['price', 'unit price', 'cena', 'vienības cena']);
    if (iName < 0) return;
    const items = [];
    for (let r = 1; r < rows.length && items.length < 100; r++) {
      const name = String(rows[r][iName] || '').trim();
      if (!name) continue;
      items.push({ name, qty: Number(rows[r][iQty]) || 1, price: Number(rows[r][iPrice]) || 0 });
    }
    if (!items.length) return;
    const total = items.reduce((a, x) => a + x.qty * x.price, 0);
    if (doc) {
      await patch('/api/invoices/' + doc.id, { items, amount: total, scan_warn: total > 10000 ? 1 : 0 });
      alert(T('Amount found on the scan') + ': € ' + total.toFixed(2));
      viewDoc(doc.doc_type, doc.id);
    } else {
      alert(T('Amount found on the scan') + ': € ' + total.toFixed(2));
    }
  }

  // ---------- print: invoice / quote / bill ----------
  async function printDoc(id) {
    const doc = await api('/api/invoices/' + id);
    const { company } = await api('/api/company');
    const c = company || {};
    const vat = Number(doc.vat_rate) || 0;
    const net = doc.amount_cents / 100;
    const vatAmt = net * vat / 100;
    const bank = (c.banks || []).find((b) => String(b.id ?? b.iban) === String(doc.bank_id));
    const typeLabel = { invoice: 'Invoice', quote: 'Quote', bill: 'Bill', cmr: 'CMR' }[doc.doc_type];
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; color: #1c2b29; margin: 40px; }
      .head { display: flex; justify-content: space-between; border-bottom: 3px solid #0f766e; padding-bottom: 14px; }
      .brand { font-size: 26px; font-weight: bold; color: #0f766e; }
      table { width: 100%; border-collapse: collapse; margin: 24px 0; }
      th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; }
      th { background: #f0f6f4; }
      .totals { margin-left: auto; width: 280px; }
      .totals td { border: none; padding: 4px 10px; }
      .tot { font-weight: bold; font-size: 17px; border-top: 2px solid #0f766e; }
      .foot { margin-top: 60px; color: #6b7c78; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
    </style></head><body>
      <div class="head">
        <div><div class="brand">Verdins</div><div style="font-size:11px;letter-spacing:3px;color:#6b7c78">ACCOUNTING</div></div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:bold">${T(typeLabel)} ${esc(doc.number)}</div>
          <div>${T('Issued:')} ${esc(doc.issue_date)}</div>
          <div>${T('Due:')} ${esc(doc.due_date || '—')}</div>
        </div>
      </div>
      <table><tr><td style="border:none;padding:14px 10px">
        <b>${esc(c.full_name || '')}</b><br>${esc(c.address || '')}<br>
        ${c.reg_no ? 'Reg: ' + esc(c.reg_no) + '<br>' : ''}${c.vat_no ? 'VAT: ' + esc(c.vat_no) + '<br>' : ''}${esc(c.email || '')}
      </td><td style="border:none;padding:14px 10px;text-align:right">
        <b>${esc(doc.customer)}</b>
      </td></tr></table>
      <table><thead><tr><th>${T('Item')}</th><th>${T('Qty')}</th><th>${T('Unit price')}</th><th style="text-align:right">${T('Sum')}</th></tr></thead>
      <tbody>${(doc.items && doc.items.length ? doc.items : [{ name: doc.description || '—', qty: 1, price: net }])
        .map((x) => '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.qty) + '</td><td>€ ' + Number(x.price).toFixed(2) + '</td><td style="text-align:right">€ ' + (x.qty * x.price).toFixed(2) + '</td></tr>').join('')}</tbody></table>
      <table class="totals"><tr><td>${T('Sum')}</td><td style="text-align:right">€ ${net.toFixed(2)}</td></tr>
        ${vat ? '<tr><td>VAT ' + vat + '%</td><td style="text-align:right">€ ' + vatAmt.toFixed(2) + '</td></tr>' : ''}
        <tr class="tot"><td>${T('Total')}</td><td style="text-align:right">€ ${(net + vatAmt).toFixed(2)}</td></tr></table>
      ${bank ? '<p><b>' + T('Pay to:') + '</b> ' + esc(bank.name || '') + ' · IBAN ' + esc(bank.iban) + (bank.swift ? ' · SWIFT ' + esc(bank.swift) : '') + '</p>' : ''}
      <div class="foot">Created with Verdins — simple accounting for small businesses</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ---------- print: CMR consignment note ----------
  async function printCmr(id) {
    const doc = await api('/api/invoices/' + id);
    const { company } = await api('/api/company');
    const c = company || {};
    const goods = (doc.items && doc.items.length)
      ? doc.items.map((x) => esc(x.name) + ' × ' + esc(x.qty)).join('<br>')
      : esc(doc.description || '—');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111; margin: 30px; font-size: 13px; }
      h1 { font-size: 18px; text-align: center; margin: 4px 0 14px; }
      .box { border: 1px solid #333; padding: 8px 10px; margin: 6px 0; }
      .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
      .val { font-size: 14px; min-height: 22px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .sign { margin-top: 26px; display: flex; justify-content: space-between; gap: 20px; }
      .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #555; }
      .foot { margin-top: 30px; color: #888; font-size: 10px; text-align: center; }
    </style></head><body>
      <h1>${T('CMR consignment note')} ${esc(doc.number)}</h1>
      <div class="grid">
        <div class="box"><div class="lbl">${T('Sender')}</div><div class="val"><b>${esc(c.full_name || me.company)}</b>${c.address ? '<br>' + esc(c.address) : ''}${c.vat_no ? '<br>' + esc(c.vat_no) : ''}</div></div>
        <div class="box"><div class="lbl">${T('Consignee')}</div><div class="val">${esc(doc.customer)}</div></div>
        <div class="box"><div class="lbl">${T('Carrier')}</div><div class="val">${esc(doc.cmr_carrier || '—')}</div></div>
        <div class="box"><div class="lbl">${T('Place of dispatch')}</div><div class="val">${esc(doc.cmr_dispatch || '—')}</div></div>
        <div class="box"><div class="lbl">${T('Place of delivery')}</div><div class="val">${esc(doc.cmr_delivery || doc.due_date || '—')}</div></div>
        <div class="box"><div class="lbl">${T('Goods')}</div><div class="val">${goods}</div></div>
        <div class="box"><div class="lbl">${T('Number of packages')}</div><div class="val">${esc(doc.cmr_packages || '—')}</div></div>
        <div class="box"><div class="lbl">${T('Gross weight (kg)')}</div><div class="val">${esc(doc.cmr_weight || '—')}</div></div>
      </div>
      <div class="sign">
        <div>${T('Sender')}</div>
        <div>${T('Carrier')}</div>
        <div>${T('Consignee')}</div>
      </div>
      <div class="foot">${T('Issued:')} ${esc(doc.issue_date)} — Created with Verdins</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // ---------- contacts ----------
  const COLMAP = {
    name: ['name', 'nosaukums', 'nom', 'nome', 'nombre', 'nazwa'],
    reg_no: ['reg no', 'registration', 'reģistrācijas', 'registernummer', 'n° d\u2019immatriculation', 'n. di iscrizione', 'n.º de registro', 'nr rejestracyjny'],
    vat_no: ['vat', 'vat no', 'pvn', 'ust', 'n° de tva', 'p. iva', 'n.º de iva', 'nr vat'],
    email: ['email', 'e-pasts', 'e-mail', 'correo'],
    phone: ['phone', 'telefons', 'telefon', 'téléphone', 'telefono', 'teléfono', 'telefon'],
    address: ['address', 'adrese', 'adresse', 'indirizzo', 'dirección', 'adres'],
  };
  async function viewContacts() {
    const { contacts } = await api('/api/contacts');
    shell(`
      <h1>Customers & suppliers</h1>
      <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
        <input id="conSearch" placeholder="${T('Search')}" style="min-width:220px">
        <button class="btn" id="btnNewCon">Add contact</button>
        <label class="btn secondary small" for="impFile">Import</label>
        <input type="file" id="impFile" accept=".csv,.xlsx,.xls" style="display:none">
        <button class="btn secondary small" id="btnExp">Export CSV</button>
      </div>
      <div class="card" style="margin-top:14px"><table>
        <thead><tr><th>${T('Name')}</th><th>${T('Kind')}</th><th>${T('VAT no.')}</th><th>${T('Email')}</th><th>${T('Phone')}</th><th></th></tr></thead>
        <tbody id="conBody">
          ${contacts.map((c) => '<tr><td>' + esc(c.name) + '</td><td>' + T(c.kind === 'company' ? 'Company' : c.kind === 'supplier' ? 'Supplier' : 'Person') + '</td><td>' + esc(c.vat_no || '') + '</td><td>' + esc(c.email || '') + '</td><td>' + esc(c.phone || '') + '</td><td><button class="btn danger small" data-con="' + c.id + '">Delete</button></td></tr>').join('') || '<tr><td colspan="6" class="muted">—</td></tr>'}
        </tbody></table></div>
      <div id="conMsg" style="margin-top:10px"></div>
    `, 'contacts');
    $('conSearch').oninput = async () => {
      const { contacts } = await api('/api/contacts?q=' + encodeURIComponent($('conSearch').value));
      $('conBody').innerHTML = contacts.map((c) => '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.kind) + '</td><td>' + esc(c.vat_no || '') + '</td><td>' + esc(c.email || '') + '</td><td>' + esc(c.phone || '') + '</td><td><button class="btn danger small" data-con="' + c.id + '">Delete</button></td></tr>').join('') || '<tr><td colspan="6" class="muted">—</td></tr>';
      wireDelete();
    };
    function wireDelete() {
      document.querySelectorAll('button[data-con]').forEach((b) => {
        b.onclick = async () => { await del('/api/contacts/' + b.dataset.con); viewContacts(); };
      });
    }
    wireDelete();
    $('btnNewCon').onclick = async () => {
      const name = prompt(T('Name'));
      if (!name || !name.trim()) return;
      const kind = prompt(T('Kind') + ': company / supplier / person', 'company');
      const vat = prompt(T('VAT no.'), '');
      await post('/api/contacts', { name: name.trim(), kind: (kind || 'company').trim(), vat_no: vat || '' });
      viewContacts();
    };
    $('impFile').onchange = async () => {
      const f = $('impFile').files[0];
      if (!f) return;
      try {
        let rows;
        if (/\.csv$/i.test(f.name)) {
          const text = await f.text();
          rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0).map((s) => s.replace(/^"|"$/g, '').replace(/""/g, '"')));
        } else {
          const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.mjs');
          const wb = XLSX.read(await f.arrayBuffer());
          rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        }
        if (!rows.length) throw new Error('empty');
        const head = rows[0].map((h) => String(h || '').toLowerCase().trim());
        const idx = {};
        for (const [key, names] of Object.entries(COLMAP)) idx[key] = head.findIndex((h) => names.includes(h));
        const list = [];
        for (let r = 1; r < rows.length; r++) {
          const get = (k) => idx[k] >= 0 ? rows[r][idx[k]] : '';
          const name = String(get('name') || '').trim();
          if (!name) continue;
          list.push({ name, reg_no: String(get('reg_no') || ''), vat_no: String(get('vat_no') || ''), email: String(get('email') || ''), phone: String(get('phone') || ''), address: String(get('address') || '') });
        }
        const res = await post('/api/contacts/import', { contacts: list });
        $('conMsg').innerHTML = '<div class="good-box">' + T('Added:') + ' ' + res.added + ' · ' + T('Skipped:') + ' ' + (list.length - res.added) + '</div>';
        setTimeout(viewContacts, 1200);
      } catch (ex) { $('conMsg').innerHTML = '<div class="error-line">' + T('Could not read the file') + '</div>'; }
    };
    $('btnExp').onclick = () => {
      const csv = 'name,kind,reg_no,vat_no,email,phone,address\n' + contacts.map((c) => [c.name, c.kind, c.reg_no, c.vat_no, c.email, c.phone, c.address].map((x) => '"' + String(x || '').replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'verdins-contacts.csv';
      a.click();
    };
  }

  // ---------- stock ----------
  async function viewStock() {
    const { invoices } = await api('/api/invoices');
    const map = new Map();
    const fuzzy = (a, b) => a.toLowerCase().split(/\s+/)[0] === b.toLowerCase().split(/\s+/)[0];
    for (const i of invoices) {
      if (i.doc_type === 'bill' && i.status === 'received') {
        for (const it of i.items || []) {
          const ex = [...map.keys()].find((k) => fuzzy(k, it.name));
          const k = ex || it.name;
          const cur = map.get(k) || { qty: 0, cost: 0, value: 0 };
          cur.qty += Number(it.qty) || 0; cur.cost = Number(it.price) || cur.cost;
          cur.value = cur.qty * cur.cost;
          map.set(k, cur);
        }
      }
      if (i.doc_type === 'invoice' && (i.status === 'sent' || i.status === 'paid')) {
        for (const it of i.items || []) {
          const ex = [...map.keys()].find((k) => fuzzy(k, it.name));
          if (!ex) continue;
          const cur = map.get(ex);
          cur.qty -= Number(it.qty) || 0; cur.value = cur.qty * cur.cost;
        }
      }
    }
    const rows = [...map.entries()].filter(([, v]) => v.qty > 0);
    shell(`
      <h1>My stock</h1>
      ${rows.length ? `<div class="card" style="margin-top:14px"><table>
        <thead><tr><th>${T('Item name')}</th><th>${T('In stock')}</th><th>${T('Unit cost (last)')}</th><th>${T('Stock value')}</th></tr></thead>
        <tbody>${rows.map(([n, v]) => '<tr><td>' + esc(n) + '</td><td>' + v.qty + '</td><td>€ ' + v.cost.toFixed(2) + '</td><td>€ ' + v.value.toFixed(2) + '</td></tr>').join('')}</tbody></table></div>`
      : '<p class="muted" style="margin-top:16px">' + T('Nothing in stock yet') + '</p>'}
    `, 'stock');
  }

  // ---------- scans ----------
  async function viewScans() {
    const { scans } = await api('/api/scans');
    shell(`
      <h1>Scanned originals</h1>
      <div class="scan-box" style="margin-top:14px">
        <label class="btn secondary" for="scanFree">Attach a scanned original (PDF, photo, Excel or CSV)</label>
        <input type="file" id="scanFree" accept=".pdf,.png,.jpg,.jpeg,.webp">
        <span class="muted small" id="scanFreeMsg"></span>
      </div>
      <div class="card" style="margin-top:14px"><table>
        <thead><tr><th>${T('File')}</th><th>${T('Linked to document')}</th><th>${T('Actions')}</th></tr></thead>
        <tbody>${scans.map((s) => '<tr><td><a href="/api/scans/' + s.id + '" target="_blank">' + esc(s.filename) + '</a></td><td>' + esc(s.doc_number || T('Not linked')) + '</td><td><button class="btn danger small" data-scan="' + s.id + '">Delete</button></td></tr>').join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody>
      </table></div>
    `, 'scans');
    $('scanFree').onchange = async () => {
      const f = $('scanFree').files[0];
      if (!f) return;
      $('scanFreeMsg').textContent = T('Scanning…');
      try {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        await post('/api/scans', { filename: f.name, data: dataUrl, doc_number: null });
        $('scanFreeMsg').textContent = T('Backup saved');
        viewScans();
      } catch (ex) { $('scanFreeMsg').textContent = T('Could not read the file'); }
    };
    document.querySelectorAll('button[data-scan]').forEach((b) => {
      b.onclick = async () => {
        await api('/api/scans', { method: 'DELETE', body: JSON.stringify({ id: +b.dataset.scan }) });
        viewScans();
      };
    });
  }

  // ---------- settings ----------
  async function viewSettings() {
    const [meData, companyData, backup, users] = await Promise.all([
      api('/api/me'), api('/api/company'), api('/api/backup'), api('/api/users')]);
    const c = companyData.company || { banks: [] };
    const banks = c.banks || [];
    const langs = window.VERDINS_I18N ? window.VERDINS_I18N.LANGS : { en: 'English' };
    const curLang = window.VERDINS_I18N ? window.VERDINS_I18N.getLang() : 'en';
    shell(`
      <h1>Settings</h1>

      <div class="card" style="margin-top:14px">
        <h2>${T('Language')}</h2>
        <select id="langSel">${Object.entries(langs).map(([k, v]) => '<option value="' + k + '"' + (k === curLang ? ' selected' : '') + '>' + v + '</option>').join('')}</select>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>${T('Company details')}</h2>
        <div class="grid" style="gap:10px">
          <label>${T('Full company name')}<br><input id="cName" value="${esc(c.full_name || meData.me.company)}" style="width:100%"></label>
          <label>${T('Registration no.')}<br><input id="cReg" value="${esc(c.reg_no || '')}"></label>
          <label>${T('VAT no.')}<br><input id="cVat" value="${esc(c.vat_no || '')}"></label>
          <label>${T('Email')}<br><input id="cEmail" value="${esc(c.email || '')}"></label>
          <label>${T('Phone')}<br><input id="cPhone" value="${esc(c.phone || '')}"></label>
          <label>${T('Address')}<br><input id="cAddr" value="${esc(c.address || '')}"></label>
          <label>${T('Logo')}<br><input type="file" id="cLogo" accept="image/png,image/jpeg"></label>
        </div>
        <h2 style="margin-top:18px">${T('Bank accounts')}</h2>
        <div id="bankRows"></div>
        <button class="btn secondary small" id="btnAddBank">Add bank</button>
        <div style="margin-top:16px"><button class="btn" id="btnSaveCompany">Save</button></div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>${T('Backups')}</h2>
        <p class="muted small">${T('Set a folder to keep copies of your data')}</p>
        <label>${T('Backup folder')}<br><input id="bkFolder" value="${esc(backup.folder || '')}" style="width:min(420px,100%)"></label>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="bkAuto" ${backup.auto ? 'checked' : ''}> ${T('Auto-backup daily')}</label>
        <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
          <button class="btn secondary" id="bkSave">Save</button>
          <button class="btn" id="bkRun">${T('Back up now')}</button>
          <button class="btn secondary" id="bkDl">${T('Download backup')}</button>
        </div>
        <div id="bkMsg" class="small" style="margin-top:8px"></div>
        ${backup.files && backup.files.length ? '<div class="small" style="margin-top:8px">' + backup.files.map((f) => esc(f.name) + ' <span class="muted">(' + Math.round(f.size / 1024) + ' KB)</span>').join('<br>') + '</div>' : ''}
      </div>

      <div class="card" style="margin-top:14px">
        <h2>${T('Restore everything from a backup file')}</h2>
        <p class="muted small">${T('Before a software update: make a backup first, update, and if anything goes wrong, restore here.')}</p>
        <p class="muted small">${T('Current data is saved as a safety copy first.')}</p>
        <label class="btn secondary" for="restoreFile">${T('Choose a backup file')}</label>
        <input type="file" id="restoreFile" accept=".db" style="display:none">
        <span class="muted small" id="restoreName"></span>
        <button class="btn danger" id="btnRestore" style="margin-top:10px">${T('Restore and restart')}</button>
        <div id="restoreMsg" style="margin-top:8px"></div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>${T('Two-step verification')}</h2>
        <div id="mfaBox">
          <button class="btn" id="mfaStart">Enable</button>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>${T('People')}</h2>
        <table><tbody>${users.users.map((u) => '<tr><td>' + esc(u.name) + '</td><td class="muted">' + esc(u.email) + '</td><td class="muted">' + T(u.role === 'owner' ? 'Owner' : 'User') + '</td></tr>').join('')}</tbody></table>
        <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
          <input id="pName" placeholder="${T('Name')}">
          <input id="pEmail" type="email" placeholder="${T('Email')}">
          <input id="pPass" type="password" placeholder="${T('Password')}">
          <button class="btn small" id="btnAddUser">${T('Add person')}</button>
        </div>
        <div id="userMsg" class="small" style="margin-top:8px"></div>
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Demo</h2>
        <button class="btn secondary" id="btnDemo">Load demo data</button>
        <span class="muted small">${T('Adds 10 example documents')}</span>
      </div>
    `, 'settings');

    $('langSel').onchange = () => {
      window.VERDINS_I18N.setLang($('langSel').value);
      viewSettings();
    };

    const bankRows = $('bankRows');
    function renderBanks() {
      bankRows.innerHTML = banks.map((b, i) => `
        <div class="row" style="gap:8px;margin:6px 0;flex-wrap:wrap">
          <input data-bi="${i}" data-bf="name" placeholder="${T('Bank')}" value="${esc(b.name || '')}" style="min-width:140px">
          <input data-bi="${i}" data-bf="iban" placeholder="IBAN" value="${esc(b.iban || '')}" style="min-width:200px">
          <input data-bi="${i}" data-bf="swift" placeholder="SWIFT/BIC" value="${esc(b.swift || '')}" style="min-width:120px">
          ${banks.length > 1 ? '<button class="btn danger small" data-bdel="' + i + '">✕</button>' : ''}
        </div>`).join('');
      bankRows.querySelectorAll('input[data-bi]').forEach((inp) => {
        inp.oninput = () => { banks[+inp.dataset.bi][inp.dataset.bf] = inp.value; };
      });
      bankRows.querySelectorAll('button[data-bdel]').forEach((b) => {
        b.onclick = () => { banks.splice(+b.dataset.bdel, 1); renderBanks(); };
      });
    }
    $('btnAddBank').onclick = () => { if (banks.length < 5) { banks.push({ name: '', iban: '', swift: '' }); renderBanks(); } };
    renderBanks();

    let logoData = (c.logo && c.logo.startsWith('data:')) ? c.logo : null;
    $('cLogo').onchange = () => {
      const f = $('cLogo').files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { logoData = r.result; };
      r.readAsDataURL(f);
    };
    $('btnSaveCompany').onclick = async () => {
      try {
        await post('/api/company', {
          full_name: $('cName').value, reg_no: $('cReg').value, vat_no: $('cVat').value,
          email: $('cEmail').value, phone: $('cPhone').value, address: $('cAddr').value,
          logo: logoData, banks: banks.filter((b) => b.iban || b.name),
        });
        alert(T('Backup saved'));
      } catch (ex) { alert(ex.message); }
    };

    $('bkSave').onclick = async () => {
      try {
        await post('/api/backup', { folder: $('bkFolder').value, auto: $('bkAuto').checked });
        $('bkMsg').innerHTML = '<span class="good-box">' + T('Backup saved') + '</span>';
        setTimeout(viewSettings, 900);
      } catch (ex) { $('bkMsg').innerHTML = '<span class="error-line">' + esc(ex.message) + '</span>'; }
    };
    $('bkRun').onclick = async () => {
      try {
        const r = await post('/api/backup/run');
        $('bkMsg').innerHTML = '<span class="good-box">' + T('Backup saved') + ': ' + esc(r.file) + '</span>';
        setTimeout(viewSettings, 1200);
      } catch (ex) { $('bkMsg').innerHTML = '<span class="error-line">' + esc(ex.message) + '</span>'; }
    };
    $('bkDl').onclick = () => { location.href = '/api/backup/download'; };

    // ---- RESTORE ----
    let restoreBytes = null;
    $('restoreFile').onchange = () => {
      const f = $('restoreFile').files[0];
      if (!f) { restoreBytes = null; $('restoreName').textContent = ''; return; }
      restoreBytes = f;
      $('restoreName').textContent = f.name;
    };
    $('btnRestore').onclick = async () => {
      const msg = $('restoreMsg');
      if (!restoreBytes) { msg.innerHTML = '<div class="warn-box">' + T('Choose a backup file') + '</div>'; return; }
      if (!confirm(T('Restore') + '?')) return;
      msg.innerHTML = '';
      try {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(restoreBytes); });
        await post('/api/backup/restore', { data: dataUrl });
        msg.innerHTML = '<div class="good-box">' + T('Restoring — the page will reload in a moment') + '</div>';
        const start = Date.now();
        (function poll() {
          fetch('/api/me').then((x) => { if (x.status === 401 || x.ok) location.reload(); else throw 0; })
            .catch(() => { if (Date.now() - start < 60000) setTimeout(poll, 1000); });
        })();
      } catch (ex) {
        msg.innerHTML = '<div class="error-line">' + (String(ex.message).includes('backup') ? T('Not a valid Verdins backup') : esc(ex.message)) + '</div>';
      }
    };

    // ---- MFA ----
    $('mfaStart').onclick = async () => {
      try {
        const r = await post('/api/mfa/setup');
        $('mfaBox').innerHTML = `
          <p class="muted small">${T('Scan this in Microsoft Authenticator, then enter a code to confirm')}</p>
          <textarea readonly rows="2" style="width:min(420px,100%);font-size:12px">${esc(r.uri)}</textarea>
          <div class="row" style="margin-top:8px;gap:8px">
            <input id="mfaCode" maxlength="6" inputmode="numeric" placeholder="000000" style="width:110px">
            <button class="btn small" id="mfaConfirm">Verify</button>
          </div>
          <div id="mfaMsg" class="small" style="margin-top:8px"></div>`;
        $('mfaConfirm').onclick = async () => {
          try {
            await post('/api/mfa/enable', { code: $('mfaCode').value.trim() });
            $('mfaBox').innerHTML = '<span class="good-box">' + T('Two-step verification') + ': ' + T('Enable') + 'd</span> <button class="btn secondary small" id="mfaOff">Disable</button>';
            $('mfaOff').onclick = async () => { await post('/api/mfa/disable'); viewSettings(); };
          } catch (ex) { $('mfaMsg').innerHTML = '<span class="error-line">' + esc(ex.message) + '</span>'; }
        };
      } catch (ex) { alert(ex.message); }
    };

    $('btnAddUser').onclick = async () => {
      try {
        await post('/api/users', { name: $('pName').value, email: $('pEmail').value, password: $('pPass').value, role: 'user' });
        viewSettings();
      } catch (ex) { $('userMsg').innerHTML = '<span class="error-line">' + esc(ex.message) + '</span>'; }
    };
    $('btnDemo').onclick = async () => {
      try { await post('/api/demo'); alert(T('Demo data loaded')); location.hash = '#dashboard'; }
      catch (ex) { alert(ex.message); }
    };
  }

  // ---------- router ----------
  function route() {
    if (!me) return;
    const h = (location.hash || '#dashboard').slice(1);
    const [name, qs] = h.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    if (name === 'documents' && query.d) viewDoc(null, query.d).catch(() => viewLogin('login'));
    else if (name === 'documents') viewDocuments(query).catch(() => viewLogin('login'));
    else if (name === 'contacts') viewContacts().catch(() => viewLogin('login'));
    else if (name === 'stock') viewStock().catch(() => viewLogin('login'));
    else if (name === 'scans') viewScans().catch(() => viewLogin('login'));
    else if (name === 'settings') viewSettings().catch(() => viewLogin('login'));
    else viewDashboard().catch(() => viewLogin('login'));
  }
  window.addEventListener('hashchange', route);

  async function enterApp() {
    try { const r = await api('/api/me'); me = r.me; }
    catch { return viewLogin('login'); }
    if (!location.hash || location.hash === '#') location.hash = '#dashboard';
    else route();
  }
  enterApp();
})();
