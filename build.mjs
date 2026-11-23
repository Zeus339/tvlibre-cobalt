// Genera dist/tvlibre.js:
//   1) scriptlets de uBlock Origin (mismo código que usa Brave) para las reglas de YouTube
//      de las listas de uBO de hoy, y
//   2) el userScript de TizenTube más reciente.
// Uso: node build.mjs   (requiere git y Node 20+)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HOSTNAME = 'www.youtube.com';
const LISTS = [
  'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt',
];
const TIZENTUBE_URL = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js';

const get = async (url) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'tvlibre-cobalt-build' } });
      if (r.ok) return await r.text();
      console.warn(url, r.status);
    } catch (e) { console.warn(url, e.message); }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('No se pudo descargar ' + url);
};

// ---- uBlock Origin (última versión publicada)
const tags = execFileSync('git', ['ls-remote', '--tags', '--refs', 'https://github.com/gorhill/uBlock.git'], { encoding: 'utf8' })
  .split('\n').map(l => l.split('refs/tags/')[1]).filter(t => /^\d+\.\d+\.\d+$/.test(t || ''))
  .sort((a, b) => a.split('.').map(Number).reduce((acc, n, i) => acc || n - b.split('.').map(Number)[i], 0));
const uboTag = tags[tags.length - 1];
const uboDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubo-'));
execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', uboTag, 'https://github.com/gorhill/uBlock.git', uboDir]);
const { builtinScriptlets } = await import(pathToFileURL(path.join(uboDir, 'src/js/resources/scriptlets.js')).href);
const { ArglistParser } = await import(pathToFileURL(path.join(uboDir, 'src/js/arglist-parser.js')).href);

const reg = new Map();
for (const s of builtinScriptlets) { reg.set(s.name, s); for (const a of s.aliases ?? []) reg.set(a, s); }
const resolve = n => reg.get(n) || reg.get(n + '.js') || null;

// ---- preprocesador !#if (motor Chromium, sin filtrado HTML, como uBO/Brave en escritorio)
const env = new Set(['env_chromium']);
const evalCond = expr => expr.split('||').some(t => t.trim().split('&&').every(x => {
  x = x.trim().replace(/[()]/g, ''); const neg = x.startsWith('!'); const v = env.has(neg ? x.slice(1) : x); return neg ? !v : v;
}));
function preprocess(text) {
  const out = []; const stack = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^!#(if|else|endif)\b\s*(.*)$/.exec(line);
    if (m) {
      if (m[1] === 'if') stack.push({ on: evalCond(m[2]) });
      else if (m[1] === 'else') { const s = stack[stack.length - 1]; if (s) s.on = !s.on; }
      else stack.pop();
      continue;
    }
    if (stack.every(s => s.on)) out.push(line);
  }
  return out;
}
function hnMatches(list) {
  const labels = HOSTNAME.split('.'); const cands = new Set();
  for (let i = 0; i < labels.length - 1; i++) cands.add(labels.slice(i).join('.'));
  for (let i = 0; i < labels.length - 1; i++) cands.add(labels.slice(i, -1).join('.') + '.*');
  let pos = false, neg = false;
  for (let h of list.split(',')) { h = h.trim(); if (!h) continue;
    if (h.startsWith('~')) { if (cands.has(h.slice(1))) neg = true; } else if (cands.has(h)) pos = true; }
  return pos && !neg;
}
const argp = new ArglistParser(',');
function parseArgs(s) {
  const args = []; let i = 0;
  for (;;) { const d = argp.nextArg(s, i); if (i === s.length) break;
    let a = s.slice(d.argBeg, d.argEnd); if (d.transform) a = argp.normalizeArg(a); args.push(a); i = d.separatorEnd; if (i >= s.length) break; }
  return args;
}

const rules = [], exceptions = [];
for (const url of LISTS) {
  const name = url.split('/').pop();
  for (const line of preprocess(await get(url))) {
    const m = /^([^#!\s][^#]*?)?#(@?)#\+js\((.*)\)\s*$/.exec(line);
    if (!m) continue;
    const [, hns = '', at, body] = m;
    if (hns === '' && !at) continue;
    if (hns !== '' && !hnMatches(hns)) continue;
    (at ? exceptions : rules).push({ list: name, raw: line, args: parseArgs(body) });
  }
}
const excKeys = new Set(exceptions.map(e => JSON.stringify(e.args)));
const disableAll = exceptions.some(e => e.args.length === 0);
const seen = new Set();
const active = disableAll ? [] : rules.filter(r => { const k = JSON.stringify(r.args); if (excKeys.has(k) || seen.has(k)) return false; seen.add(k); return true; });

const fnSources = new Map(); const calls = []; const report = [];
function addWithDeps(s) {
  if (fnSources.has(s.name)) return;
  fnSources.set(s.name, s.fn.toString());
  for (const d of s.dependencies ?? []) { const ds = resolve(d); if (!ds) throw new Error('falta dependencia ' + d); addWithDeps(ds); }
}
for (const r of active) {
  const s = resolve(r.args[0]);
  if (!s) { report.push('DESCONOCIDO ' + r.raw); continue; }
  addWithDeps(s);
  calls.push(`try { ${s.fn.name}(${r.args.slice(1).map(a => JSON.stringify(a)).join(', ')}); } catch (e) { }`);
  report.push(`${s.name} | ${r.list}`);
}
const ubo = `(function tvlibreUboScriptlets() {\nconst scriptletGlobals = {};\nconst $SCRIPTLET_GLOBALS$ = scriptletGlobals;\n${[...fnSources.values()].join('\n')}\n${calls.join('\n')}\n})();\n`;

// ---- TizenTube
const tizentube = await get(TIZENTUBE_URL);
const ttVersion = (await get('https://registry.npmjs.org/@foxreis/tizentube/latest').then(JSON.parse)).version;

const built = new Date().toISOString();
const header = `/*! tvlibre-cobalt | ${built}
 * uBlock Origin ${uboTag} scriptlets (GPL-3.0, https://github.com/gorhill/uBlock) - ${active.length} reglas para ${HOSTNAME}
 * TizenTube ${ttVersion} (GPL-3.0, https://github.com/reisxd/TizenTube)
 * Generado automáticamente por build.mjs; no editar a mano. */\n`;
const out = header +
  `try { window.__tvlibre = { built: ${JSON.stringify(built)}, ubo: ${JSON.stringify(uboTag)}, rules: ${active.length}, tizentube: ${JSON.stringify(ttVersion)} }; } catch (e) {}\n` +
  `try {\n${ubo}\n} catch (e) { try { console.error('[tvlibre] uBO', e); } catch (_) {} }\n` +
  `/* ---- TizenTube ---- */\n${tizentube}\n`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('tvlibre.js', out); // en la raíz: la URL debe medir lo mismo que la original
fs.writeFileSync('dist/build-info.json', JSON.stringify({ built, ubo: uboTag, rules: active.length, functions: fnSources.size, tizentube: ttVersion, report }, null, 2) + '\n');
fs.rmSync(uboDir, { recursive: true, force: true });
console.log(`uBO ${uboTag}: ${active.length} reglas, ${fnSources.size} funciones; TizenTube ${ttVersion}; ${out.length} bytes`);
for (const r of report) console.log('  ' + r);
