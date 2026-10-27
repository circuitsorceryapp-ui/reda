// Reda — crypto helpers: password hashing (scrypt), TOTP (RFC 6238, Microsoft Authenticator compatible), sessions
const crypto = require('crypto');

// ---------- passwords (scrypt, built into Node — same family banks use for key derivation) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---------- base32 (RFC 4648, no padding — the format Authenticator secrets use) ----------
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of str.toUpperCase().replace(/=+$/, '')) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- TOTP (RFC 6238) — the 6-digit codes Microsoft Authenticator shows ----------
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret
}

function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// Accepts codes from the previous, current and next 30-second window (clock drift tolerance)
function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (let w = -1; w <= 1; w++) {
    if (crypto.timingSafeEqual(Buffer.from(totpAt(secret, counter + w)), Buffer.from(String(code)))) {
      return true;
    }
  }
  return false;
}

// The URI Microsoft Authenticator understands ("Enter code manually" or QR import)
function otpauthUri(secret, email, issuer = 'Reda') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- session tokens ----------
function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotp,
  otpauthUri,
  newSessionId,
};
