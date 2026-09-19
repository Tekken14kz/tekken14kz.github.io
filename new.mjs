#!/usr/bin/env node
/**
 * Быстрая посадка заметки.
 *
 *   node new.mjs "Как называть заметки"        создать и открыть в редакторе
 *   node new.mjs "Заголовок" --stage grow      сразу не росток
 *   node new.mjs "Заголовок" --push            создать, закоммитить и запушить
 *   node new.mjs --tend obratnye               обновить дату последнего ухода
 *   node new.mjs --inbox                       что надиктовано и ждёт разбора
 *   node new.mjs --promote golos-1             превратить запись из inbox в заметку
 *
 * Зависимостей нет.
 */
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NOTES = join(ROOT, 'notes');
const INBOX = join(ROOT, 'inbox');

const TRANSLIT = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
  к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f',
  х:'h', ц:'c', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
};

/* Имя файла — это адрес заметки, поэтому только латиница и дефисы. */
function slugify(title){
  return title.toLowerCase()
    .split('').map(ch => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'zametka';
}

const today = () => new Date().toISOString().slice(0, 10);

function git(...args){
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function push(message){
  git('add', '-A');
  git('commit', '-m', message);
  git('push', 'origin', 'main');
  console.log('выложено, через минуту будет на сайте');
}

/* ── Разбор аргументов ───────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = name => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : (argv[i + 1] || '');
};
const has = name => argv.includes('--' + name);
const title = argv.filter(a => !a.startsWith('--') &&
  argv[argv.indexOf(a) - 1] !== '--stage' &&
  argv[argv.indexOf(a) - 1] !== '--tend').join(' ').trim();

/* ── Карантин: что надиктовано и ждёт разбора ────────────── */
function inboxFiles(){
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX).filter(f => f.endsWith('.md')).sort();
}

if (has('inbox')){
  const files = inboxFiles();
  if (!files.length){ console.log('в inbox пусто'); process.exit(0); }
  console.log('в inbox ' + files.length + ':');
  for (const f of files){
    const body = readFileSync(join(INBOX, f), 'utf8').replace(/^---[\s\S]*?---\n/, '').trim();
    const first = body.split('\n').find(l => l.trim()) || '(пусто)';
    console.log('  ' + f.replace(/\.md$/, '').padEnd(22) + ' ' + first.slice(0, 60));
  }
  console.log('\nразобрать: node new.mjs --promote <имя> ["Заголовок"]');
  process.exit(0);
}

/* Разбор: надиктованное становится заметкой только руками — в этом и смысл
   предварительной модерации. */
if (has('promote')){
  const src = flag('promote').replace(/\.md$/, '');
  const from = join(INBOX, src + '.md');
  if (!existsSync(from)){
    console.error('нет такой записи в inbox: ' + src);
    console.error('есть: ' + inboxFiles().map(f => f.replace(/\.md$/, '')).join(', ') || '(пусто)');
    process.exit(1);
  }
  const raw = readFileSync(from, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim();
  const lines = raw.split('\n');
  /* Заголовок берём из аргумента, иначе первой строкой записи. */
  const given = argv.filter(a => !a.startsWith('--') && a !== flag('promote')).join(' ').trim();
  const name = given || lines[0].replace(/^#+\s*/, '').trim().slice(0, 80);
  if (!name){ console.error('нечего назвать: запись пустая'); process.exit(1); }
  const body = given ? raw : lines.slice(1).join('\n').trim();

  const pid = slugify(name);
  const to = join(NOTES, pid + '.md');
  if (existsSync(to)){ console.error('уже растёт: notes/' + pid + '.md'); process.exit(1); }

  writeFileSync(to, `---\ntitle: ${name}\nstage: ${flag('stage') || 'seed'}\n` +
                    `planted: ${today()}\ntended: ${today()}\n---\n\n${body}\n`);
  rmSync(from);
  console.log('разобрано: inbox/' + src + '.md  ->  notes/' + pid + '.md');
  if (has('push')) push('разобрано из inbox: ' + name);
  process.exit(0);
}

/* ── Обновить дату ухода ─────────────────────────────────── */
if (has('tend')){
  const id = flag('tend');
  const file = join(NOTES, id + '.md');
  if (!existsSync(file)){
    console.error('нет такой заметки: ' + id);
    console.error('есть: ' + readdirSync(NOTES).map(f => f.replace(/\.md$/, '')).join(', '));
    process.exit(1);
  }
  const src = readFileSync(file, 'utf8');
  /* Сверяем именно наличие поля: если ухаживали сегодня, текст не изменится,
     и это не повод считать, что поля нет. */
  if (!/^tended:.*$/m.test(src)){ console.error(id + ': поле tended не найдено'); process.exit(1); }
  writeFileSync(file, src.replace(/^tended:.*$/m, 'tended: ' + today()));
  console.log(id + ': уход отмечен ' + today());
  if (has('push')) push('уход за заметкой: ' + id);
  process.exit(0);
}

/* ── Посадить заметку ────────────────────────────────────── */
const stage = flag('stage') || 'seed';
if (!['seed', 'grow', 'ever'].includes(stage)){
  console.error('стадия должна быть seed, grow или ever');
  process.exit(1);
}

let name = title;
if (!name){
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  name = (await rl.question('Заголовок: ')).trim();
  rl.close();
}
if (!name){ console.error('без заголовка нечего сажать'); process.exit(1); }

const id = slugify(name);
const file = join(NOTES, id + '.md');
if (existsSync(file)){
  console.error('уже растёт: notes/' + id + '.md');
  process.exit(1);
}

writeFileSync(file, `---
title: ${name}
stage: ${stage}
planted: ${today()}
tended: ${today()}
---

`);

console.log('посажено: notes/' + id + '.md  ->  /' + id + '/');

/* Открываем в том, чем человек и так пользуется. */
const editor = process.env.VISUAL || process.env.EDITOR;
try {
  if (editor) execFileSync(editor, [file], { stdio: 'inherit' });
  else if (process.platform === 'darwin') execFileSync('open', [file]);
} catch { /* редактор не открылся — файл всё равно создан */ }

if (has('push')) push('посажено: ' + name);
