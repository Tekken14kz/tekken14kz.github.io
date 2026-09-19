#!/usr/bin/env node
/**
 * Быстрая посадка заметки.
 *
 *   node new.mjs "Как называть заметки"        создать и открыть в редакторе
 *   node new.mjs "Заголовок" --stage grow      сразу не росток
 *   node new.mjs "Заголовок" --push            создать, закоммитить и запушить
 *   node new.mjs --tend obratnye               обновить дату последнего ухода
 *   node new.mjs --tend obratnye --push        то же и сразу выложить
 *
 * Зависимостей нет.
 */
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NOTES = join(ROOT, 'notes');

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
