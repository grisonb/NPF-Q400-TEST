#!/usr/bin/env node
/*
 * NPF-Q400 — reconstruction de script.js à partir des fichiers de src/.
 *
 * Étape 1 du découpage : déplacement pur. Les fichiers de src/ contiennent
 * les octets exacts de script.js, dans l'ordre de src/ORDER.txt. La
 * concaténation doit être identique octet pour octet au fichier d'origine.
 *
 * Lecture et écriture en binaire uniquement : les fins de ligne CRLF du
 * fichier d'origine doivent traverser la construction sans être modifiées.
 *
 *   node tools/build_script.js           reconstruit script.js
 *   node tools/build_script.js --check   compare sans écrire (code 1 si écart)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const target = path.join(root, 'script.js');

const order = fs.readFileSync(path.join(srcDir, 'ORDER.txt'), 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

const missing = order.filter(name => !fs.existsSync(path.join(srcDir, name)));
if (missing.length) {
    console.error('Fichiers absents de src/ :', missing.join(', '));
    process.exit(2);
}

const present = fs.readdirSync(srcDir).filter(name => name.endsWith('.js'));
const orphans = present.filter(name => !order.includes(name));
if (orphans.length) {
    console.error('Fichiers de src/ absents de ORDER.txt :', orphans.join(', '));
    process.exit(2);
}

const rebuilt = Buffer.concat(order.map(name => fs.readFileSync(path.join(srcDir, name))));
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

if (process.argv.includes('--check')) {
    if (!fs.existsSync(target)) {
        console.error('script.js absent : rien à comparer.');
        process.exit(2);
    }
    const current = fs.readFileSync(target);
    const identical = current.equals(rebuilt);
    console.log('src/            ', order.length, 'fichiers,', rebuilt.length, 'octets,', sha(rebuilt));
    console.log('script.js       ', current.length, 'octets,', sha(current));
    console.log(identical ? 'IDENTIQUE' : 'DIFFÉRENT');
    process.exit(identical ? 0 : 1);
}

fs.writeFileSync(target, rebuilt);
console.log('script.js reconstruit :', order.length, 'fichiers,', rebuilt.length, 'octets,', sha(rebuilt));
