#!/usr/bin/env node
/**
 * Подлесок — генератор статического сада.
 *
 * Читает notes/*.md, разрешает ссылки, считает обратные ссылки с контекстом
 * и собирает dist/: главную, отдельную страницу на каждую заметку, ленту,
 * карту сайта и 404.
 *
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
  url:     'https://tekken14kz.github.io',  // без слэша на конце
  base:    '/',                              // подпапка, если сайт не в корне домена
  entry:   ['start', 'sad'],                 // что открыто при заходе на главную
  foot:    'Заметки живут в папке <code>notes/</code>. Ссылки <code>[[имя]]</code> в тексте открывают следующий столбец, обратные ссылки и карта считаются при сборке.'
};

const STAGES = { seed:'росток', grow:'растёт', ever:'вечнозелёная' };
const WIKI = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const href = id => SITE.base + id + '/';
const abs  = path => SITE.url + path;

/* ── Первый проход: метаданные ───────────────────────────── */
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

const files = readdirSync(join(ROOT, 'notes')).filter(f => f.endsWith('.md')).sort();
if (!files.length) throw new Error('В notes/ нет ни одного .md — сажать нечего');

const notes = files.map(file => {
  const id = file.replace(/\.md$/, '');
  const { meta, body } = frontmatter(readFileSync(join(ROOT, 'notes', file), 'utf8'), file);
  for (const key of ['title', 'stage', 'planted', 'tended'])
    if (!meta[key]) throw new Error(file + ': не хватает поля "' + key + '"');
  if (!STAGES[meta.stage])
    throw new Error(file + ': стадия "' + meta.stage + '" — допустимы ' + Object.keys(STAGES).join(', '));
  return { id, title: meta.title, stage: meta.stage, planted: meta.planted, tended: meta.tended, raw: body };
});

const byId = Object.fromEntries(notes.map(n => [n.id, n]));

/* Ссылку можно писать и по имени файла, и по заголовку — как в Obsidian.
   Экранированный вариант заголовка тоже кладём в указатель: к моменту
   разбора ссылок текст уже прошёл через esc(). */
const index = {};
notes.forEach(n => {
  index[n.id.toLowerCase()] = n.id;
  index[n.title.toLowerCase().trim()] = n.id;
  index[esc(n.title).toLowerCase().trim()] = n.id;
});
const resolve = target => index[String(target).toLowerCase().trim()] || null;

const broken = [];

/* ── Разбор markdown ─────────────────────────────────────── */
function inline(raw, from, links){
  const codes = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return '@@CODE' + (codes.length - 1) + '@@';
  });

  s = s.replace(WIKI, (full, target, label) => {
    const id = resolve(target);
    if (!id){
      broken.push(from + ' -> [[' + target + ']]');
      return label || target;
    }
    if (links) links.add(id);
    return '<a class="wl" href="' + href(id) + '" data-id="' + id + '">' +
           (label || esc(byId[id].title)) +
           '<span class="dot wl-stage s-' + byId[id].stage + '"></span></a>';
  });

  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
       .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return s.replace(/@@CODE(\d+)@@/g, (_, i) => '<code>' + codes[Number(i)] + '</code>');
}

function markdown(body, from, links){
  return body.trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines[0].startsWith('## '))
      return '<h3>' + inline(lines[0].slice(3), from, links) + '</h3>' +
             (lines.length > 1 ? '<p>' + inline(lines.slice(1).join(' '), from, links) + '</p>' : '');
    if (lines.every(l => l.startsWith('> ')))
      return '<blockquote>' + inline(lines.map(l => l.slice(2)).join(' '), from, links) + '</blockquote>';
    if (lines.every(l => l.startsWith('- ')))
      return '<ul>' + lines.map(l => '<li>' + inline(l.slice(2), from, links) + '</li>').join('') + '</ul>';
    return '<p>' + inline(block, from, links) + '</p>';
  }).join('');
}

/* ── Контекст обратной ссылки ────────────────────────────── */
/* Предложение, в котором стоит ссылка: показывает не «кто-то сослался»,
   а зачем именно. */
function excerpt(raw, targetId){
  WIKI.lastIndex = 0;
  let m;
  while ((m = WIKI.exec(raw)) !== null){
    if (resolve(m[1]) !== targetId) continue;

    let a = m.index, b = m.index + m[0].length;
    while (a > 0 && !/\n/.test(raw[a - 1]) &&
           !(/[.!?]/.test(raw[a - 1]) && /\s/.test(raw[a] || ' '))) a--;
    while (b < raw.length && !/\n/.test(raw[b]) &&
           !(/[.!?]/.test(raw[b]) && /[\s]/.test(raw[b + 1] || ' '))) b++;
    if (b < raw.length && /[.!?]/.test(raw[b])) b++;

    let s = raw.slice(a, b).trim().replace(/^(?:[-*>]\s+|#+\s+)/, '');

    if (s.length > 240){
      const rel = s.indexOf(m[0]);
      const from = Math.max(0, rel - 90);
      const to   = Math.min(s.length, rel + m[0].length + 130);
      s = (from > 0 ? '…' : '') + s.slice(from, to).trim() + (to < s.length ? '…' : '');
    }

    let marked = false;
    return esc(s)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(WIKI, (full, target, label) => {
        const id = resolve(target);
        const text = label || (id && esc(byId[id].title)) || target;
        if (id === targetId && !marked){ marked = true; return '<mark>' + text + '</mark>'; }
        return text;
      });
  }
  return null;
}

/* ── Второй проход: рендер ───────────────────────────────── */
notes.forEach(n => {
  const links = new Set();
  n.html = markdown(n.raw, n.id, links);
  n.links = [...links].filter(id => id !== n.id);
  n.text = n.raw.replace(WIKI, (_, t, l) => l || t).replace(/[*`>#\-\[\]]/g, '').replace(/\s+/g, ' ').trim();
});

const backlinks = {};
notes.forEach(n => n.links.forEach(id => {
  (backlinks[id] = backlinks[id] || []).push({ from: n.id, excerpt: excerpt(n.raw, id) });
}));

const entry = SITE.entry.filter(id => byId[id]);
if (!entry.length) entry.push(notes[0].id);

const byTended = [...notes].sort((a, b) => b.tended.localeCompare(a.tended));

function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' ' + one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' ' + few;
  return n + ' ' + many;
}

const fmtDate = iso => { const p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };

/* ── Разметка, которую видно без JS ──────────────────────── */
/* Ровно та же структура, что строит app.js после загрузки: если правишь
   здесь — поправь и там (функции noteHTML / renderRail). */
function noteMarkup(n){
  const bl = backlinks[n.id] || [];
  return '<article class="col" data-col="0"><div class="col-inner">' +
    '<span class="note-stage s-' + n.stage + '"><span class="dot s-' + n.stage + '"></span>' + STAGES[n.stage] + '</span>' +
    '<h2 class="note-title">' + esc(n.title) + '</h2>' +
    '<div class="note-dates"><span>посажена ' + fmtDate(n.planted) + '</span>' +
    '<span>последний уход ' + fmtDate(n.tended) + '</span></div>' +
    '<div class="body">' + n.html + '</div>' +
    '<div class="backlinks"><h3>Ссылаются сюда · ' + bl.length + '</h3>' +
    (bl.length
      ? bl.map(b => '<a class="bl" href="' + href(b.from) + '" data-id="' + b.from + '" data-col="0">' +
          '<span class="bl-head"><span class="dot s-' + byId[b.from].stage + '"></span>' +
          esc(byId[b.from].title) + '</span>' +
          (b.excerpt ? '<span class="bl-quote">' + b.excerpt + '</span>' : '') + '</a>').join('')
      : '<p class="none">Пока ниоткуда. Одинокая заметка — повод связать её с соседями.</p>') +
    '</div></div></article>';
}

function railMarkup(openIds){
  return byTended.map(n =>
    '<a class="rail-item" href="' + href(n.id) + '" data-id="' + n.id + '" data-open="' +
    (openIds.includes(n.id) ? '1' : '0') + '">' +
    '<span class="t"><span class="dot s-' + n.stage + '"></span>' +
    '<span class="name">' + esc(n.title) + '</span></span>' +
    '<span class="meta">' + fmtDate(n.tended) + ' · ссылок сюда: ' +
    ((backlinks[n.id] || []).length) + '</span></a>').join('');
}

const FILTERS = Object.keys(STAGES).map(k =>
  '<button class="chip" data-stage="' + k + '" aria-pressed="false">' +
  '<span class="dot s-' + k + '"></span>' + STAGES[k] + '</button>').join('');

const shellTpl = readFileSync(join(ROOT, 'src/shell.html'), 'utf8');

function shell(stackHTML, openIds){
  return shellTpl
    .replace('{{TITLE}}', esc(SITE.title))
    .replace('{{HOME}}', SITE.base)
    .replace('{{TAGLINE}}', esc(SITE.tagline))
    .replace('{{COUNT}}', plural(notes.length, 'растение', 'растения', 'растений'))
    .replace('{{FILTERS}}', FILTERS)
    .replace('{{RAILLIST}}', railMarkup(openIds))
    .replace('{{STACK}}', stackHTML)
    .replace('{{FOOT}}', SITE.foot);
}

/* ── Страницы ────────────────────────────────────────────── */
const css = readFileSync(join(ROOT, 'src/style.css'), 'utf8');
const js  = readFileSync(join(ROOT, 'src/app.js'), 'utf8');

const DATA = '<script>window.GARDEN=' +
  JSON.stringify({
    notes: notes.map(n => ({ id:n.id, title:n.title, stage:n.stage, planted:n.planted,
                             tended:n.tended, html:n.html, text:n.text, links:n.links })),
    backlinks, entry, base: SITE.base, site: SITE.title
  }).replace(/</g, '\\u003c') + ';</script>';

/* Тему ставим до первой отрисовки, иначе выбранная светлая моргнёт тёмной. */
const THEME_BOOT = '<script>try{var t=localStorage.getItem("podlesok-theme");' +
  'if(t&&t!=="auto")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>';

const FONTS =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">';

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  '<circle cx="8" cy="8" r="6" fill="none" stroke="#2a4fa8" stroke-width="2"/>' +
  '<path d="M8 2a6 6 0 0 1 0 12z" fill="#2a4fa8"/></svg>');

function page({ title, description, path, body, extra = '' }){
  return `<!doctype html>
<html lang="${SITE.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(path)}">
<meta property="og:type" content="${path === SITE.base ? 'website' : 'article'}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${abs(path)}">
<meta property="og:site_name" content="${esc(SITE.title)}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/atom+xml" title="${esc(SITE.title)}" href="${SITE.base}feed.xml">
<link rel="icon" href="${FAVICON}">
${FONTS}
<link rel="stylesheet" href="${SITE.base}style.css">
${THEME_BOOT}
</head>
<body>
${body}
${extra}
${DATA}
<script src="${SITE.base}app.js"></script>
</body>
</html>
`;
}

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/* Главная: заранее отрисована первая заметка из entry. */
writeFileSync(join(dist, 'index.html'), page({
  title: SITE.title,
  description: SITE.description,
  path: SITE.base,
  body: shell(noteMarkup(byId[entry[0]]), entry)
}));

/* По странице на заметку — свой адрес, свой заголовок, готовый HTML. */
notes.forEach(n => {
  mkdirSync(join(dist, n.id), { recursive: true });
  writeFileSync(join(dist, n.id, 'index.html'), page({
    title: n.title + ' · ' + SITE.title,
    description: n.text.slice(0, 155),
    path: href(n.id),
    body: shell(noteMarkup(n), [n.id])
  }));
});

writeFileSync(join(dist, '404.html'), page({
  title: 'Заметка не найдена · ' + SITE.title,
  description: SITE.description,
  path: SITE.base,
  body: shell(
    '<article class="col" data-col="0"><div class="col-inner">' +
    '<h2 class="note-title">Такой заметки нет</h2>' +
    '<div class="body"><p>Возможно, она ещё не посажена или её переименовали. ' +
    'Слева — всё, что растёт сейчас.</p></div></div></article>', []),
  extra: '<script>window.GARDEN_404=true;</script>'
}));

writeFileSync(join(dist, 'style.css'), css);
writeFileSync(join(dist, 'app.js'), js);
writeFileSync(join(dist, '.nojekyll'), '');

/* ── Лента, карта сайта, robots ──────────────────────────── */
const stamp = iso => iso + 'T00:00:00Z';
const updated = stamp(byTended[0].tended);

writeFileSync(join(dist, 'feed.xml'),
`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(SITE.title)}</title>
  <subtitle>${esc(SITE.description)}</subtitle>
  <link href="${abs(SITE.base + 'feed.xml')}" rel="self"/>
  <link href="${abs(SITE.base)}"/>
  <id>${abs(SITE.base)}</id>
  <updated>${updated}</updated>
${byTended.map(n => `  <entry>
    <title>${esc(n.title)}</title>
    <link href="${abs(href(n.id))}"/>
    <id>${abs(href(n.id))}</id>
    <published>${stamp(n.planted)}</published>
    <updated>${stamp(n.tended)}</updated>
    <category term="${STAGES[n.stage]}"/>
    <summary>${esc(n.text.slice(0, 300))}</summary>
  </entry>`).join('\n')}
</feed>
`);

writeFileSync(join(dist, 'sitemap.xml'),
`<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${abs(SITE.base)}</loc><lastmod>${byTended[0].tended}</lastmod></url>
${notes.map(n => `  <url><loc>${abs(href(n.id))}</loc><lastmod>${n.tended}</lastmod></url>`).join('\n')}
</urlset>
`);

writeFileSync(join(dist, 'robots.txt'),
`User-agent: *
Allow: /

Sitemap: ${abs(SITE.base + 'sitemap.xml')}
`);

/* Вариант для артефакта Claude: без doctype/html/head/body, одним файлом. */
mkdirSync(join(ROOT, 'artifact'), { recursive: true });
writeFileSync(join(ROOT, 'artifact/index.html'),
`<title>${esc(SITE.title)}</title>
${FONTS}
${THEME_BOOT}
<style>
${css}
</style>
${shell(noteMarkup(byId[entry[0]]), entry)}
${DATA}
<script>
${js}
</script>
`);

/* ── Итог ────────────────────────────────────────────────── */
const edges = notes.reduce((a, n) => a + n.links.length, 0);
const withCtx = Object.values(backlinks).flat().filter(b => b.excerpt).length;
const total = Object.values(backlinks).flat().length;
const orphans = notes.filter(n => !n.links.length && !(backlinks[n.id] || []).length);

console.log('готово: ' + notes.length + ' заметок, ' + edges + ' связей, ' +
            (notes.length + 3) + ' страниц -> dist/');
console.log('контекст у обратных ссылок: ' + withCtx + ' из ' + total);
if (broken.length)  console.log('! битые ссылки: ' + broken.join(', '));
if (orphans.length) console.log('! ни с чем не связаны: ' + orphans.map(n => n.id).join(', '));

/* ── Локальный просмотр ──────────────────────────────────── */
if (process.argv.includes('--serve')){
  const { createServer } = await import('node:http');
  const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
                  '.js':'text/javascript; charset=utf-8', '.xml':'application/xml; charset=utf-8',
                  '.txt':'text/plain; charset=utf-8' };
  createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = join(dist, path.replace(/^\/+/, ''));
    if (path.endsWith('/')) file = join(file, 'index.html');
    const send = (code, f) => {
      res.writeHead(code, {
        'content-type': TYPES[f.slice(f.lastIndexOf('.'))] || 'text/plain',
        'cache-control': 'no-store'   // иначе браузер держит старый app.js
      });
      res.end(readFileSync(f));
    };
    if (file.startsWith(dist) && existsSync(file) && !file.endsWith('/')) return send(200, file);
    return send(404, join(dist, '404.html'));
  }).listen(4321, () => console.log('-> http://localhost:4321'));
}
