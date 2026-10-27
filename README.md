# Reda — Lite ERP for EU Small Businesses

Multi-tenant SaaS starter: each company (tenant) registers, logs in with **email + password + Microsoft Authenticator (TOTP)**, and sees **only its own data** — enforced on every database query.

Built with **zero npm dependencies** (pure Node.js built-ins) — nothing to install, nothing to break.

## Run it

Requires [Node.js 22.5+](https://nodejs.org).

```bash
node server.js
```

Open http://localhost:3000 — create your company workspace, add invoices, set up Microsoft Authenticator in Settings.

## What's inside

| Feature | Status |
|---|---|
| Company registration (tenant = isolated workspace) | ✅ |
| Login: email + password | ✅ (scrypt hashing) |
| MFA: Microsoft Authenticator TOTP 6-digit codes | ✅ (RFC 6238, ±30s drift) |
| Per-company data isolation on every query | ✅ (`tenant_id` from session, never from input) |
| Document flow: **Offer → Delivery note → Invoice**, plus Purchase bills | ✅ per-type numbering (QUO/DLV/INV/PUR) |
| Payments: full & partial, auto "paid" status, paid/remaining per document | ✅ |
| 🖨 Print / save any document as a professional A4 PDF | ✅ |
| Money overview: customers owe you / you owe suppliers / sales invoiced & paid | ✅ |
| 📷 Invoice scanning: photo → auto-filled fields (OCR, in-browser) | ✅ prefill + human review |
| 🧾 Line items: numbered rows (product, code, qty, unit price) with live totals | ✅ |
| 📅 Editable document date (default: today) + payment due date on every document | ✅ |
| VAT: 21 / 12 / 5 / 0 % — sums **without VAT**, VAT amount and **with VAT** computed server-side | ✅ |
| 👥 Customer & supplier base: save contacts, search by company/person/phone/email/reg/VAT no | ✅ |
| Customer autocomplete while writing invoices | ✅ search-as-you-type, links the contact |
| Session management (HttpOnly cookies, 12h expiry) | ✅ |
| User roles (owner / accountant / sales) | 🚧 field exists, enforcement TODO |
| Purchasing, inventory, ledger, VAT reports | 📋 roadmap (see Architecture plan) |

## Invoice scanning (photo → pre-filled form)

On the dashboard, "📷 Scan / photo / PDF / Excel" lets you take a photo or pick an
**image, PDF or Excel/CSV file** of an invoice. Reda reads it — OCR for photos and PDFs
(Tesseract.js + pdf.js, **entirely inside your browser** — files never leave your
computer), direct exact read for spreadsheets — and prefills customer, amount, currency,
due date and invoice number. **You always review and confirm before saving.**

Notes:
- First use needs internet (~15 MB engine downloads from CDNs, cached afterwards).
- Works best on: flat paper, good light, no shadows, text facing the camera.
- Scanning a supplier document? Pick "Purchase bill" as the type after it fills.

## Document flow & money (like real accounting software)

1. **Offer (QUO)** — write an offer to a customer. Status: draft → sent → accepted/rejected.
2. **Convert** the accepted offer → **Delivery note (DLV)** and/or → **Invoice (INV)** —
   customer, amount and description are copied, numbering is automatic per type.
3. **Purchase bill (PUR)** — when a supplier invoices you (scan it in!). Bought goods to
   resell? Press **→ Invoice** on the bill and it becomes a sales invoice with the same lines.
4. **Payments** — record full or partial payments on invoices and bills; the status
   flips to "paid" automatically when the amount is covered, and back to "sent" if a
   payment is removed.
5. **Overview** — "Customers owe you", "You owe suppliers", sales invoiced/paid,
   open offers — always up to date. Every document shows **Paid** and **Remaining**.
6. **🖨 PDF** — every document prints as a clean A4 layout (letterhead, parties,
   totals, paid/remaining, status). In the print dialog choose "Save as PDF" to get
   a file you can email to a customer.

## Line items & VAT (invoices like real software)

When you write an invoice, offer, delivery note or purchase bill you add **numbered
lines**: `1. 2. 3. …` with product **code**, **name**, **qty** and **unit price**
(without VAT). Pick the VAT rate (21 / 12 / 5 / 0 %) and Reda shows live:
**Sum without VAT → VAT amount → Total with VAT**. The totals are recomputed on the
**server** — the browser can never fake them. The printed PDF shows the full table
(#, code, product, qty, unit price, line sum) plus the VAT breakdown.

## Customer & supplier base

The **👥 Customers & suppliers** page stores your contacts: company or private
person, registration no., VAT (PVN) no., email, phone, address. Search works by
**any of these** — company name, person, phone, email or VAT number. While writing an
invoice, start typing in the customer field and matching contacts appear in a
dropdown — click one and it's filled and linked to the document. Deleting a contact
never breaks old documents (they keep the saved name).

## How isolation works (the important part)

1. At registration a **tenant** (company) is created; the user belongs to it.
2. Login yields a server-side session; `tenant_id` is read **only from the session**.
3. Every SQL query includes `WHERE tenant_id = ?` — even updates and deletes.
4. Result: company A physically cannot read, edit or delete company B's rows.

> Production path: migrate SQLite → **PostgreSQL with Row-Level Security**, so isolation is enforced by the database engine even if application code has a bug. (See the Architecture plan.)

## MFA with Microsoft Authenticator

1. Settings → *Set up Microsoft Authenticator*.
2. In the app: **Add account → Other account → Enter code manually**.
3. Type the shown secret key, then confirm with the 6-digit code.
4. From now on: password **+** Authenticator code at every login.

TOTP is implemented per RFC 6238 (SHA1, 6 digits, 30s period) — the same standard Microsoft Authenticator, Google Authenticator, 1Password etc. use.

## Put it on GitHub

```bash
cd reda
git init
git add .
git commit -m "Reda starter: multi-tenant auth + MFA + invoices"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/YOURNAME/reda.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes the SQLite database file — your local test data never goes to GitHub.

## Buy a domain & go live (Hetzner example, ~€10/mo)

1. Buy a domain (nic.lv, Namecheap, Cloudflare…).
2. Rent a cheap EU VPS (e.g. Hetzner CX22, Nuremberg — GDPR-friendly EU hosting).
3. On the server:

```bash
# install Node 22 + Caddy (automatic HTTPS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs caddy
git clone https://github.com/YOURNAME/reda.git && cd reda
node server.js   # test it
```

4. Keep it running as a service:

```bash
sudo tee /etc/systemd/system/reda.service <<EOF
[Unit]
Description=Reda
[Service]
WorkingDirectory=/root/reda
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now reda
```

5. Point the domain: DNS **A record** → your VPS IP, then:

```bash
sudo caddy reverse-proxy --from yourdomain.com --to localhost:3000
```

Caddy handles the HTTPS certificate automatically. Done — `https://yourdomain.com` is live with logins and MFA.

## Project structure

```
server.js        HTTP server + API routes (auth, MFA, invoices)
db.js            SQLite schema — every table carries tenant_id
crypto.js        scrypt passwords, TOTP (RFC 6238), base32, sessions
public/          Frontend (vanilla JS single-page app)
  index.html / style.css / app.js
```

## Security notes & TODOs for production

- Add HTTPS (Caddy above does it), rate limiting on `/api/login`, and a proper secret for cookie signing.
- Add "remember this device" so MFA isn't asked on every device daily.
- Add email verification + password reset before public launch.
- Migrate to PostgreSQL + Row-Level Security (see Architecture plan) and daily backups.
- Add tests around the TOTP and tenant-isolation logic first — they are the trust core.

## License

MIT
