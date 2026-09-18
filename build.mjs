#!/usr/bin/env node
/**
 * Подлесок — генератор статического сада.
 * Читает notes/*.md, считает связи и обратные ссылки, собирает dist/.
 * Зависимостей нет: только стандартная библиотека Node.
 *
 *   node build.mjs          собрать
 *   node build.mjs --serve  собрать и поднять localhost:4321
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ── Настройки сада ──────────────────────────────────────── */
const SITE = {
  title:   'Подлесок',
  tagline: 'сад заметок',
  description: 'Личный сад заметок: связанные тексты, которые растут и переписываются, вместо ленты постов.',
  lang:    'ru',
  entry:   ['start', 'sad'],   // какие заметки открыты при заходе на главную
  foot:    'Заметки живут в папке <code>notes/</code>. Ссылки <code>[[имя]]</code> в тексте открывают следующий столбец, обратные ссылки и карта считаются при сборке.'
};

const STAGES = ['seed', 'grow', 'ever'];

/* ── Разбор markdown ─────────────────────────────────────── */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(raw, links){
  const codes = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return '@@CODE' + (codes.length - 1) + '@@';
  });

  s = s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
    links.add(id);
    return '<a class="wl" href="#/' + id + '" data-id="' + id + '">{{T:' + id + '|' +
           (label || '') + '}}<span class="dot wl-stage {{S:' + id + '}}"></span></a>';
  });

  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
       .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return s.replace(/@@CODE(\d+)@@/g, (_, i) => '<code>' + codes[Number(i)] + '</code>');
}

function markdown(body, links){
  return body.trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines[0].startsWith('## '))
      return '<h3>' + inline(lines[0].slice(3), links) + '</h3>' +
             (lines.length > 1 ? '<p>' + inline(lines.slice(1).join(' '), links) + '</p>' : '');
    if (lines.every(l => l.startsWith('> ')))
      return '<blockquote>' + inline(lines.map(l => l.slice(2)).join(' '), links) + '</blockquote>';
    if (lines.every(l => l.startsWith('- ')))
      return '<ul>' + lines.map(l => '<li>' + inline(l.slice(2), links) + '</li>').join('') + '</ul>';
    return '<p>' + inline(block, links) + '</p>';
  }).join('');
}

function frontmatter(src, file){
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(file + ': нет блока --- с метаданными в начале файла');
  const meta = {};
  m[1].split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return { meta, body: src.slice(m[0].length) };
}

/* ── Сбор заметок ────────────────────────────────────────── */
const files = readdirSync(join(ROOT, 'notes')).filter(f => f.endsWith('.md')).sort();
if (!files.length) throw new Error('В notes/ нет ни одного .md — сажать нечего');

const notes = files.map(file => {
  const id = file.replace(/\.md$/, '');
  const { meta, body } = frontmatter(readFileSync(join(ROOT, 'notes', file), 'utf8'), file);
  for (const key of ['title', 'stage', 'planted', 'tended'])
    if (!meta[key]) throw new Error(file + ': не хватает поля "' + key + '"');
  if (!STAGES.includes(meta.stage))
    throw new Error(file + ': стадия "' + meta.stage + '" — допустимы ' + STAGES.join(', '));

  const links = new Set();
  const html = markdown(body, links);
  const text = body.replace(/\[\[[a-z0-9-]+\|?([^\]]*)\]\]/g, '$1').replace(/[*`>#-]/g, '');
  return { id, title: meta.title, stage: meta.stage, planted: meta.planted,
           tended: meta.tended, html, text, links: [...links] };
});

const ids = new Set(notes.map(n => n.id));

/* Подписи и стадии ссылок подставляем, когда известны все заметки:
   так ссылка заранее показывает, насколько зрелое лежит на том конце. */
const titleOf = Object.fromEntries(notes.map(n => [n.id, n.title]));
const stageOf = Object.fromEntries(notes.map(n => [n.id, n.stage]));
const broken = [];
notes.forEach(n => {
  n.html = n.html.replace(/\{\{T:([a-z0-9-]+)\|([^}]*)\}\}/g,
    (_, id, label) => esc(label || titleOf[id] || id))
    .replace(/\{\{S:([a-z0-9-]+)\}\}/g, (_, id) => 's-' + (stageOf[id] || 'seed'));
  n.links = n.links.filter(id => {
    if (ids.has(id)) return true;
    broken.push(n.id + ' → ' + id);
    return false;
  });
});

/* Обратные ссылки: разворачиваем стрелки графа. */
const backlinks = {};
notes.forEach(n => n.links.forEach(id => {
  if (id === n.id) return;
  (backlinks[id] = backlinks[id] || []).push(n.id);
}));

const entry = SITE.entry.filter(id => ids.has(id));
if (!entry.length) entry.push(notes[0].id);

function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' ' + one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' ' + few;
  return n + ' ' + many;
}

/* ── Сборка ──────────────────────────────────────────────── */
const css   = readFileSync(join(ROOT, 'src/style.css'), 'utf8');
const js    = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
const shell = readFileSync(join(ROOT, 'src/shell.html'), 'utf8')
  .replace('{{TITLE}}', esc(SITE.title))
  .replace('{{TAGLINE}}', esc(SITE.tagline))
  .replace('{{COUNT}}', plural(notes.length, 'растение', 'растения', 'растений'))
  .replace('{{FOOT}}', SITE.foot);

const data = '<script>window.GARDEN=' +
  JSON.stringify({ notes, backlinks, entry }).replace(/</g, '\\u003c') +
  ';</script>';

const FONTS =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">';

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<circle cx="8" cy="8" r="6" fill="none" stroke="#2a4fa8" stroke-width="2"/>' +
  '<path d="M8 2a6 6 0 0 1 0 12z" fill="#2a4fa8"/></svg>');

const page = `<!doctype html>
<html lang="${SITE.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(SITE.title)}</title>
<meta name="description" content="${esc(SITE.description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(SITE.title)}">
<meta property="og:description" content="${esc(SITE.description)}">
<link rel="icon" href="${FAVICON}">
${FONTS}
<link rel="stylesheet" href="style.css">
</head>
<body>
${shell}
${data}
<script src="app.js"></script>
</body>
</html>
`;

/* Вариант для артефакта Claude: без doctype/html/head/body, всё внутри одного файла. */
const fragment = `<title>${esc(SITE.title)}</title>
${FONTS}
<style>
${css}
</style>
${shell}
${data}
<script>
${js}
</script>
`;

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.html'), page);
writeFileSync(join(dist, 'style.css'), css);
writeFileSync(join(dist, 'app.js'), js);
writeFileSync(join(dist, '.nojekyll'), '');

mkdirSync(join(ROOT, 'artifact'), { recursive: true });
writeFileSync(join(ROOT, 'artifact/index.html'), fragment);

const edges = notes.reduce((a, n) => a + n.links.length, 0);
const orphans = notes.filter(n => !n.links.length && !(backlinks[n.id] || []).length);

console.log('готово: ' + notes.length + ' заметок, ' + edges + ' связей -> dist/');
if (broken.length)  console.log('! битые ссылки: ' + broken.join(', '));
if (orphans.length) console.log('! ни с чем не связаны: ' + orphans.map(n => n.id).join(', '));

/* ── Локальный просмотр ──────────────────────────────────── */
if (process.argv.includes('--serve')){
  const { createServer } = await import('node:http');
  const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
                  '.js':'text/javascript; charset=utf-8' };
  createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(dist, path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'content-type': TYPES[file.slice(file.lastIndexOf('.'))] || 'text/plain',
      'cache-control': 'no-store'   // иначе браузер держит старый app.js
    });
    res.end(readFileSync(file));
  }).listen(4321, () => console.log('-> http://localhost:4321'));
}
