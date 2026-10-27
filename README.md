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
| Invoices module (create, mark paid, delete, totals) | ✅ demo of a real module |
| Session management (HttpOnly cookies, 12h expiry) | ✅ |
| User roles (owner / accountant / sales) | 🚧 field exists, enforcement TODO |
| Contacts, purchasing, inventory, ledger, VAT | 📋 roadmap (see Architecture plan) |

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
