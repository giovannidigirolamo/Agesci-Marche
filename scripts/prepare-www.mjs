import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'www');
const files = ['index.html', 'manifest.json', 'sw.js'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
}

fs.cpSync(path.join(root, 'assets'), path.join(outDir, 'assets'), { recursive: true });

const apiBase = String(process.env.APP_API_BASE || '').trim().replace(/\/+$/, '');
if (apiBase) {
  const indexPath = path.join(outDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const replaced = html.replace('const API_BASE = "";', `const API_BASE = ${JSON.stringify(apiBase)};`);
  if (replaced === html) {
    console.warn('ATTENZIONE: API_BASE non trovata in index.html: il pacchetto APK userà percorsi relativi.');
  }
  fs.writeFileSync(indexPath, replaced);
  console.log(`API_BASE impostata su ${apiBase} per il pacchetto APK.`);
} else {
  console.warn('APP_API_BASE non impostata: nel pacchetto APK il login tramite codice socio potrebbe non funzionare.');
}

console.log(`Pacchetto web pronto in ${outDir}`);
