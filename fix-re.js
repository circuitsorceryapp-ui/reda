const fs = require('fs');
let s = fs.readFileSync('public/i18n.js', 'utf8');
const quad = String.raw`\p{L}`; // "\p{L}"
const quadActual = '\\' + '\\' + 'p{L}'; // source text "\\\\p{L}" (4 backslashes in file)
const twoActual = '\\' + 'p{L}'; // source text "\\p{L}" (2 backslashes in file)
const before = (s.match(/\\\\p\{L\}/g) || []).length;
s = s.split(quadActual).join(twoActual);
fs.writeFileSync('public/i18n.js', s);
const after = (s.match(/\\\\p\{L\}/g) || []).length;
console.log('source \\\\p{L} occurrences: before', before, 'after', after);
