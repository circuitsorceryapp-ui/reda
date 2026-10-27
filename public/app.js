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
        companyName: companyName.value, name: name.value,
        email: email.value, password: password.value,
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
