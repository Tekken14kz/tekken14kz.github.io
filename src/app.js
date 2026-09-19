/* Подлесок — клиентская часть. Данные приходят из build.mjs в window.GARDEN.
   Разметка здесь обязана совпадать с той, что build.mjs отдаёт заранее
   (функции noteMarkup / railMarkup) — иначе страница дёрнется при загрузке. */
(function(){
'use strict';

var G = window.GARDEN;
var NOTES = G.notes;
var BACK = G.backlinks;
var PAGES = G.pages || [];
var BASE = G.base || '/';
/* Страницы лежат в том же указателе, что и заметки: у них есть адрес и они
   открываются столбцом — но в список, карту и граф не попадают. */
var byId = {};
NOTES.concat(PAGES).forEach(function(n){ byId[n.id] = n; });

var STAGES = {
  seed:{label:'росток',       cls:'s-seed'},
  grow:{label:'растёт',       cls:'s-grow'},
  ever:{label:'вечнозелёная', cls:'s-ever'}
};

var stackEl  = document.getElementById('stack');
var railList = document.getElementById('railList');
var filtersEl= document.getElementById('filters');
var searchEl = document.getElementById('search');
var topbar   = document.getElementById('topbar');
var mapEl    = document.getElementById('map');
var mapBody  = document.getElementById('mapBody');
var themeBtn = document.getElementById('themeBtn');

var stack = [];
var query = '';
var stageFilter = null;

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtDate(iso){
  var p = iso.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

/* ── Адреса ────────────────────────────────────────────────
   У каждой заметки свой настоящий адрес /имя/. Остальная стопка
   живёт в ?s=, чтобы ссылкой можно было поделиться целиком. */
function hrefFor(id){ return BASE + id + '/'; }

function urlFor(st){
  var last = st[st.length - 1];
  var rest = st.slice(0, -1);
  return hrefFor(last) + (rest.length ? '?s=' + rest.join(',') : '');
}

function parseUrl(){
  var path = location.pathname;
  if (path === BASE || path === BASE + 'index.html') return G.entry.slice();

  var id = path.slice(BASE.length).replace(/\/+$/, '');
  if (!byId[id]) return null;

  var out = [];
  try {
    var s = new URLSearchParams(location.search).get('s');
    if (s) s.split(',').forEach(function(x){ if (byId[x] && x !== id) out.push(x); });
  } catch(e){ /* без URLSearchParams просто откроем одну заметку */ }
  out.push(id);
  return out;
}

function pushUrl(){
  try { history.pushState({ stack: stack.slice() }, '', urlFor(stack)); }
  catch(e){ /* в песочнице адрес менять нельзя — не страшно */ }
}

/* ── Заметка ───────────────────────────────────────────── */
function pageHTML(p){
  return '<div class="col-inner">' +
    '<h2 class="note-title">' + esc(p.title) + '</h2>' +
    '<div class="note-meta"><span>страница</span>' +
      (p.updated ? '<span class="sep">·</span><span>обновлена ' + fmtDate(p.updated) + '</span>' : '') +
    '</div>' +
    '<div class="body">' + p.html + '</div>' +
  '</div>';
}

function noteHTML(n, colIndex){
  if (n.isPage) return pageHTML(n);
  var st = STAGES[n.stage];
  var bl = BACK[n.id] || [];
  return '<div class="col-inner">' +
    '<h2 class="note-title">' + esc(n.title) + '</h2>' +
    '<div class="note-meta">' +
      '<span class="stage ' + st.cls + '"><span class="mark ' + st.cls + '"></span>' + st.label + '</span>' +
      '<span class="sep">·</span><span>посажена ' + fmtDate(n.planted) + '</span>' +
      '<span class="sep">·</span><span>уход ' + fmtDate(n.tended) + '</span>' +
    '</div>' +
    '<div class="body">' + n.html + '</div>' +
    '<div class="backlinks">' +
      '<h3>Ссылаются сюда · ' + bl.length + '</h3>' +
      (bl.length
        ? bl.map(function(b){
            var s = STAGES[byId[b.from].stage];
            return '<a class="bl" href="' + hrefFor(b.from) + '" data-id="' + b.from + '" data-col="' + colIndex + '">' +
                   '<span class="bl-head"><span class="mark ' + s.cls + '"></span>' +
                   esc(byId[b.from].title) + '</span>' +
                   (b.excerpt ? '<span class="bl-quote">' + b.excerpt + '</span>' : '') +
                   '</a>';
          }).join('')
        : '<p class="none">Пока ниоткуда. Одинокая заметка — повод связать её с соседями.</p>') +
    '</div>' +
  '</div>';
}

function isMobile(){ return window.matchMedia('(max-width:860px)').matches; }

function expandedCount(){
  if (isMobile()) return 1;
  var avail = stackEl.clientWidth, COL = 400, SPINE = 46;
  for (var e = Math.min(stack.length, 3); e >= 1; e--){
    if (e * COL + (stack.length - e) * SPINE <= avail) return e;
  }
  return 1;
}

function renderStack(){
  var exp = expandedCount();
  var firstExpanded = stack.length - exp;
  var html = '';

  stack.forEach(function(id, i){
    var n = byId[id];
    if (i < firstExpanded){
      var st = STAGES[n.stage];
      html += '<button class="spine" data-spine="' + i + '" title="' + esc(n.title) + '">' +
                (st ? '<span class="mark ' + st.cls + '"></span>' : '') +
                '<span class="label">' + esc(n.title) + '</span>' +
              '</button>';
    } else {
      html += '<article class="col" data-col="' + i + '">' + noteHTML(n, i) + '</article>';
    }
  });

  /* Подсказка занимает только честно свободное место и не отжимает текст. */
  if (!isMobile()){
    var free = stackEl.clientWidth - (stack.length - exp) * 46 - exp * 400;
    if (free >= 200) html += '<div class="ghost">откройте ссылку<br>в тексте →</div>';
  }

  stackEl.innerHTML = html;
  syncTitle();
  renderTopbar();
  renderRail();
}

/* Заголовок вкладки должен совпадать с тем, что отдал сервер для этого адреса. */
function syncTitle(){
  var atHome = location.pathname === BASE || location.pathname === BASE + 'index.html';
  document.title = atHome
    ? G.site
    : byId[stack[stack.length - 1]].title + ' · ' + G.site;
}

function renderTopbar(){
  var html = '<button class="tb-btn" id="railBtn">Указатель</button>' +
             '<button class="tb-btn" id="mapBtnM">Карта</button>';
  stack.slice(0, -1).forEach(function(id, i){
    html += '<button class="crumb" data-spine="' + i + '">' + esc(byId[id].title) + '</button>';
  });
  topbar.innerHTML = html;
}

function renderRail(){
  var q = query.trim().toLowerCase();
  var list = NOTES.filter(function(n){
    if (stageFilter && n.stage !== stageFilter) return false;
    if (!q) return true;
    return (n.title + ' ' + n.text).toLowerCase().indexOf(q) !== -1;
  }).sort(function(a, b){ return a.tended < b.tended ? 1 : a.tended > b.tended ? -1 : 0; });

  railList.innerHTML = list.length
    ? list.map(function(n){
        var st = STAGES[n.stage];
        var open = stack.indexOf(n.id) !== -1 ? '1' : '0';
        var bl = (BACK[n.id] || []).length;
        return '<a class="rail-item" href="' + hrefFor(n.id) + '" data-id="' + n.id + '" data-open="' + open + '">' +
                 '<span class="t"><span class="mark ' + st.cls + '"></span>' +
                 '<span class="name">' + esc(n.title) + '</span></span>' +
                 '<span class="meta">' + fmtDate(n.tended) + ' · ссылок сюда: ' + bl + '</span>' +
               '</a>';
      }).join('')
    : '<p class="empty">Ничего не выросло по этому запросу.</p>';
}

function open(id, fromCol, silent){
  if (fromCol === null || fromCol === undefined) stack = [id];
  else {
    stack = stack.slice(0, fromCol + 1);
    if (stack[stack.length - 1] !== id) stack.push(id);
  }
  document.body.classList.remove('rail-open');
  closeMap();
  if (!silent) pushUrl();
  renderStack();
  var cols = stackEl.querySelectorAll('.col');
  if (cols.length) cols[cols.length - 1].scrollTop = 0;
}

function truncate(i){
  stack = stack.slice(0, i + 1);
  pushUrl();
  renderStack();
}

/* Обычный клик перехватываем, но cmd/ctrl/средняя кнопка открывают
   настоящую страницу в новой вкладке — адреса для того и сделаны. */
function plainClick(e){
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

/* ── Карта сада ───────────────────────────────────────────
   Живая пружинная модель без библиотек. Интегратор такой же, как в
   d3-force: силы меняют скорость, скорость гасится, alpha остывает.
   Узел можно таскать, вид — двигать колесом, пальцами и перетаскиванием. */
var SVGNS = 'http://www.w3.org/2000/svg';
var MAP_W = 800, MAP_H = 560, MAP_CX = MAP_W / 2, MAP_CY = MAP_H / 2;
/* Та же шкала, что и у штрихов: пунктир -> штрих -> сплошная с заливкой. */
var DASH   = { seed:'1.5 2.5', grow:'5 3', ever:'' };
var STROKE = { seed:'var(--warm)', grow:'var(--accent)', ever:'var(--accent)' };

var edges = [];
(function buildEdges(){
  var seen = {};
  NOTES.forEach(function(n, i){
    n.links.forEach(function(id){
      var j = NOTES.findIndex(function(m){ return m.id === id; });
      if (j < 0 || j === i) return;
      var key = Math.min(i, j) + ':' + Math.max(i, j);
      if (seen[key]) return;
      seen[key] = 1;
      edges.push([Math.min(i, j), Math.max(i, j)]);
    });
  });
})();

var sim = null, svgEl = null, viewG = null;
var edgeEls = [], nodeEls = [], labelEls = [];
var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function svgNode(name, attrs){
  var e = document.createElementNS(SVGNS, name);
  for (var k in attrs) if (attrs[k] !== '') e.setAttribute(k, attrs[k]);
  return e;
}

function makeSim(){
  var n = NOTES.length;
  return {
    alpha:1, target:0, raf:0, k:1, tx:0, ty:0, cx:MAP_CX, fit:true,
    nodes: NOTES.map(function(note, i){
      var a = (i / n) * Math.PI * 2;
      return {
        i:i, stage:note.stage,
        r: 5 + Math.min((BACK[note.id] || []).length, 6) * 1.7,
        w: Math.min(note.title.length, 24) * 5.4 + 14,   // сколько места ест подпись
        x: MAP_CX + Math.cos(a) * 150, y: MAP_CY + Math.sin(a) * 150,
        vx:0, vy:0, fx:null, fy:null, side:1
      };
    })
  };
}

function step(){
  var nodes = sim.nodes, n = nodes.length, a = sim.alpha, i, j;
  /* Равновесие посчитано, а не подобрано: на рабочем радиусе притяжение к
     центру (R * CENTER) уравновешивает сумму отталкиваний (~n * REPEL / R²),
     то есть R растёт как кубический корень из REPEL.
     Притяжение по осям разное: поле горизонтальное, и граф должен
     расходиться вширь, а не вытягиваться столбом. */
  var REPEL = 56000, LINK = 150, LINK_K = 0.55, DECAY = 0.62;
  var CENTER_X = 0.010, CENTER_Y = 0.014;
  var LABEL_H = 17, LABEL_K = 0.22;

  for (i = 0; i < n; i++){
    for (j = i + 1; j < n; j++){
      var p = nodes[i], q = nodes[j];
      var dx = q.x - p.x, dy = q.y - p.y;
      var d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2);
      /* Вблизи 1/d² улетает в бесконечность — ограничиваем, иначе узлы
         разлетаются при случайном совпадении координат. */
      var f = Math.min(REPEL * a / d2, 40), ux = dx / d, uy = dy / d;
      p.vx -= ux * f; p.vy -= uy * f;
      q.vx += ux * f; q.vy += uy * f;

      /* Узел — это не точка, а точка с горизонтальной строкой подписи.
         Если две подписи оказались на одной высоте и близко по горизонтали,
         разводим их вверх-вниз: вбок расталкивать бессмысленно, строка
         всё равно длинная. */
      if (Math.abs(dy) < LABEL_H && Math.abs(dx) < (p.w + q.w) / 2){
        var push = (LABEL_H - Math.abs(dy)) * LABEL_K * a;
        var sgn = dy >= 0 ? 1 : -1;
        p.vy -= sgn * push; q.vy += sgn * push;
      }
    }
  }
  edges.forEach(function(e){
    var p = nodes[e[0]], q = nodes[e[1]];
    var dx = q.x - p.x, dy = q.y - p.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var f = (d - LINK) / d * a * LINK_K * 0.5;
    p.vx += dx * f; p.vy += dy * f;
    q.vx -= dx * f; q.vy -= dy * f;
  });
  nodes.forEach(function(p){
    if (p.fx !== null){ p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; return; }
    p.vx += (MAP_CX - p.x) * CENTER_X * a;
    p.vy += (MAP_CY - p.y) * CENTER_Y * a;
    p.vx *= DECAY; p.vy *= DECAY;
    p.x += p.vx; p.y += p.vy;
  });
  sim.alpha += (sim.target - sim.alpha) * 0.0228;
}

function paint(){
  viewG.setAttribute('transform',
    'translate(' + sim.tx.toFixed(1) + ',' + sim.ty.toFixed(1) + ') scale(' + sim.k.toFixed(3) + ')');
  edges.forEach(function(e, i){
    var p = sim.nodes[e[0]], q = sim.nodes[e[1]], l = edgeEls[i];
    l.setAttribute('x1', p.x.toFixed(1)); l.setAttribute('y1', p.y.toFixed(1));
    l.setAttribute('x2', q.x.toFixed(1)); l.setAttribute('y2', q.y.toFixed(1));
  });
  sim.nodes.forEach(function(p, i){
    nodeEls[i].setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
    /* Подпись держим повёрнутой внутрь, но с запасом — иначе она мигает,
       когда узел дышит около середины. */
    var want = p.x > sim.cx + 30 ? -1 : (p.x < sim.cx - 30 ? 1 : p.side);
    if (want !== p.side){
      p.side = want;
      labelEls[i].setAttribute('x', (want * (p.r + 6)).toFixed(1));
      labelEls[i].setAttribute('text-anchor', want === 1 ? 'start' : 'end');
    }
  });
}

function frame(){
  step(); paint();
  if (sim.alpha > 0.004 || sim.target > 0){
    sim.raf = requestAnimationFrame(frame);
  } else {
    sim.raf = 0;
    /* Раскладка устоялась — вписываем её в панель. Размер графа задают
       пружины рёбер, а не поле, поэтому подгонять надо вид, а не силы:
       так карта останется читаемой и на полусотне заметок. */
    if (sim.fit){ sim.fit = false; fitView(); paint(); }
  }
}

function heat(target, alpha){
  sim.target = target;
  if (alpha !== undefined) sim.alpha = alpha;
  if (reduceMotion){
    for (var i = 0; i < 400; i++) step();
    sim.alpha = 0; sim.target = 0; paint();
    return;
  }
  if (!sim.raf) sim.raf = requestAnimationFrame(frame);
}

/* ── Вид: масштаб и сдвиг ──────────────────────────────── */
function svgScale(){ var m = svgEl.getScreenCTM(); return m ? m.a : 1; }

function toSvgPoint(ev){
  var m = svgEl.getScreenCTM();
  if (!m) return { x:0, y:0 };
  return new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
}

function toGraph(ev){
  var p = toSvgPoint(ev);
  return { x: (p.x - sim.tx) / sim.k, y: (p.y - sim.ty) / sim.k };
}

function zoomTo(k2, ev){
  k2 = Math.max(0.35, Math.min(5, k2));
  var p = toSvgPoint(ev);
  sim.tx = p.x - (p.x - sim.tx) * (k2 / sim.k);
  sim.ty = p.y - (p.y - sim.ty) * (k2 / sim.k);
  sim.k = k2;
}

function fitView(){
  var xs = sim.nodes.map(function(p){ return p.x; });
  var ys = sim.nodes.map(function(p){ return p.y; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var PADX = 130, PADY = 46;            // запас под подписи справа и слева
  var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  sim.k  = Math.min((MAP_W - PADX * 2) / w, (MAP_H - PADY * 2) / h, 2.2);
  sim.cx = (minX + maxX) / 2;
  sim.tx = MAP_W / 2 - sim.cx * sim.k;
  sim.ty = MAP_H / 2 - (minY + maxY) / 2 * sim.k;
}

function resetView(){ if (!sim) return; fitView(); paint(); }

function shuffle(){
  if (!sim) return;
  sim.nodes.forEach(function(p){
    var a = Math.random() * Math.PI * 2;
    p.x = MAP_CX + Math.cos(a) * (60 + Math.random() * 140);
    p.y = MAP_CY + Math.sin(a) * (60 + Math.random() * 140);
    p.vx = 0; p.vy = 0; p.fx = null; p.fy = null;
  });
  sim.fit = true;
  heat(0, 1);
}

/* ── Сборка и события ──────────────────────────────────── */
function buildMap(){
  sim = makeSim();

  svgEl = svgNode('svg', { viewBox: '0 0 ' + MAP_W + ' ' + MAP_H,
                           preserveAspectRatio: 'xMidYMid meet',
                           role: 'img', 'aria-label': 'Граф связей между заметками' });
  viewG = svgNode('g', {});
  var gEdges = svgNode('g', {}), gNodes = svgNode('g', {});

  edgeEls = edges.map(function(){
    var l = svgNode('line', { 'class':'edge', 'vector-effect':'non-scaling-stroke' });
    gEdges.appendChild(l);
    return l;
  });

  nodeEls = []; labelEls = [];
  sim.nodes.forEach(function(p, i){
    var note = NOTES[i];
    var g = svgNode('g', { 'class':'node', 'data-i':i, 'data-id':note.id,
                           tabindex:'0', role:'button', 'aria-label':note.title });
    g.appendChild(svgNode('circle', {
      r: p.r.toFixed(1),
      fill: note.stage === 'ever' ? STROKE[note.stage] : 'none',
      stroke: STROKE[note.stage], 'stroke-width':1.6,
      'stroke-dasharray': DASH[note.stage],
      'vector-effect':'non-scaling-stroke'
    }));
    var t = svgNode('text', { x:(p.r + 6).toFixed(1), y:3.4, 'text-anchor':'start' });
    t.textContent = note.title.length > 24 ? note.title.slice(0, 23) + '…' : note.title;
    g.appendChild(t);
    gNodes.appendChild(g);
    nodeEls.push(g); labelEls.push(t);
  });

  viewG.appendChild(gEdges); viewG.appendChild(gNodes);
  svgEl.appendChild(viewG);
  mapBody.innerHTML = '';
  mapBody.appendChild(svgEl);

  wireMap();
  /* Первый кадр рисуем сразу: requestAnimationFrame не тикает, пока вкладка
     скрыта, и карта иначе висит в нуле до первого показа. */
  paint();
  heat(0, 1);
}

function wireMap(){
  var neigh = NOTES.map(function(){ return {}; });
  edges.forEach(function(e){ neigh[e[0]][e[1]] = 1; neigh[e[1]][e[0]] = 1; });

  var pointers = new Map(), drag = null, pan = null, pinch = null, moved = 0;

  function hot(i){
    mapEl.classList.add('dimmed');
    nodeEls.forEach(function(g, k){ g.classList.toggle('hot', k === i || neigh[i][k] === 1); });
    edgeEls.forEach(function(l, k){ l.classList.toggle('hot', edges[k][0] === i || edges[k][1] === i); });
  }
  function cool(){
    mapEl.classList.remove('dimmed');
    nodeEls.forEach(function(g){ g.classList.remove('hot'); });
    edgeEls.forEach(function(l){ l.classList.remove('hot'); });
  }

  nodeEls.forEach(function(g, i){
    g.addEventListener('mouseenter', function(){ if (!drag) hot(i); });
    g.addEventListener('mouseleave', function(){ if (!drag) cool(); });
    g.addEventListener('focus', function(){ hot(i); });
    g.addEventListener('blur', function(){ if (!drag) cool(); });
    g.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); open(g.dataset.id, null); }
    });
  });

  svgEl.addEventListener('pointerdown', function(ev){
    try { svgEl.setPointerCapture(ev.pointerId); } catch(e){}
    pointers.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
    moved = 0;

    if (pointers.size === 2){
      var pts = Array.from(pointers.values());
      pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
      drag = null; pan = null;
      return;
    }

    var g = ev.target.closest ? ev.target.closest('.node') : null;
    if (g){
      var i = Number(g.dataset.i), gp = toGraph(ev);
      drag = { node: sim.nodes[i], i: i };
      drag.node.fx = gp.x; drag.node.fy = gp.y;
      hot(i);
      heat(0.3, Math.max(sim.alpha, 0.3));
    } else {
      pan = { x:ev.clientX, y:ev.clientY };
    }
    svgEl.classList.add('grabbing');
  });

  svgEl.addEventListener('pointermove', function(ev){
    if (!pointers.has(ev.pointerId)) return;
    var prev = pointers.get(ev.pointerId);
    moved += Math.abs(ev.clientX - prev.x) + Math.abs(ev.clientY - prev.y);
    pointers.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });

    if (pinch && pointers.size === 2){
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoomTo(sim.k * (d / (pinch.d || d)),
             { clientX:(pts[0].x + pts[1].x) / 2, clientY:(pts[0].y + pts[1].y) / 2 });
      pinch.d = d;
      paint();
      return;
    }
    if (drag){
      var gp = toGraph(ev);
      drag.node.fx = gp.x; drag.node.fy = gp.y;
      if (!sim.raf) paint();
      return;
    }
    if (pan){
      var sc = svgScale();
      sim.tx += (ev.clientX - pan.x) / sc;
      sim.ty += (ev.clientY - pan.y) / sc;
      pan = { x:ev.clientX, y:ev.clientY };
      paint();
    }
  });

  function release(ev){
    pointers.delete(ev.pointerId);
    try { svgEl.releasePointerCapture(ev.pointerId); } catch(e){}
    if (pointers.size < 2) pinch = null;

    if (drag){
      var d = drag; drag = null;
      d.node.fx = null; d.node.fy = null;
      heat(0);
      /* Короткое нажатие без протяжки — это клик, а не перетаскивание. */
      if (moved < 5){ open(NOTES[d.i].id, null); return; }
      cool();
    }
    pan = null;
    svgEl.classList.remove('grabbing');
  }
  svgEl.addEventListener('pointerup', release);
  svgEl.addEventListener('pointercancel', release);

  svgEl.addEventListener('wheel', function(ev){
    ev.preventDefault();
    zoomTo(sim.k * Math.exp(-ev.deltaY * 0.0015), ev);
    paint();
  }, { passive:false });

  svgEl.addEventListener('dblclick', function(ev){ ev.preventDefault(); resetView(); });
}

var mapBuilt = false;
function drawMap(){ if (!mapBuilt){ mapBuilt = true; buildMap(); } }
function openMap(){
  drawMap();
  mapEl.hidden = false;
  if (sim && sim.alpha < 0.02) heat(0, 0.15);
}
function closeMap(){
  mapEl.hidden = true;
  if (sim && sim.raf){ cancelAnimationFrame(sim.raf); sim.raf = 0; }
}
function mapOpen(){ return !mapEl.hidden; }

/* ── Тема ──────────────────────────────────────────────── */
var THEMES = ['auto', 'light', 'dark'];
var LABELS = { auto:'как в системе', light:'светлая', dark:'тёмная' };
var theme = 'auto';

function applyTheme(t){
  theme = t;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  themeBtn.innerHTML = 'Тема: <span class="val">' + LABELS[t] + '</span>';
  try { localStorage.setItem('podlesok-theme', t); } catch(e){ /* приватный режим */ }
}

/* ── События ───────────────────────────────────────────── */
stackEl.addEventListener('click', function(e){
  var spine = e.target.closest('[data-spine]');
  if (spine){ truncate(Number(spine.dataset.spine)); return; }

  var link = e.target.closest('.bl, .wl');
  if (link && plainClick(e)){
    e.preventDefault();
    var col = link.closest('.col');
    open(link.dataset.id, col ? Number(col.dataset.col) : null);
  }
});

topbar.addEventListener('click', function(e){
  if (e.target.closest('#railBtn')){ document.body.classList.toggle('rail-open'); return; }
  if (e.target.closest('#mapBtnM')){ document.body.classList.remove('rail-open'); openMap(); return; }
  var crumb = e.target.closest('[data-spine]');
  if (crumb) truncate(Number(crumb.dataset.spine));
});

railList.addEventListener('click', function(e){
  var item = e.target.closest('.rail-item');
  if (item && plainClick(e)){ e.preventDefault(); open(item.dataset.id, null); }
});

railList.addEventListener('keydown', function(e){
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  var items = [].slice.call(railList.querySelectorAll('.rail-item'));
  var i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  var next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (next) next.focus(); else if (e.key === 'ArrowUp') searchEl.focus();
});

filtersEl.addEventListener('click', function(e){
  var chip = e.target.closest('.chip');
  if (!chip) return;
  stageFilter = stageFilter === chip.dataset.stage ? null : chip.dataset.stage;
  Array.prototype.forEach.call(filtersEl.children, function(c){
    c.setAttribute('aria-pressed', String(c.dataset.stage === stageFilter));
  });
  renderRail();
});

searchEl.addEventListener('input', function(e){ query = e.target.value; renderRail(); });
searchEl.addEventListener('keydown', function(e){
  if (e.key === 'ArrowDown'){
    var first = railList.querySelector('.rail-item');
    if (first){ e.preventDefault(); first.focus(); }
  }
  if (e.key === 'Enter'){
    var hit = railList.querySelector('.rail-item');
    if (hit){ e.preventDefault(); open(hit.dataset.id, null); searchEl.blur(); }
  }
});

document.querySelector('.rail-controls').addEventListener('click', function(e){
  var link = e.target.closest('.page-link');
  if (link && plainClick(e)){ e.preventDefault(); open(link.dataset.id, null); }
});

document.getElementById('mapBtn').addEventListener('click', openMap);
document.getElementById('mapClose').addEventListener('click', closeMap);
document.getElementById('mapReset').addEventListener('click', resetView);
document.getElementById('mapShuffle').addEventListener('click', shuffle);
mapEl.addEventListener('click', function(e){ if (e.target === mapEl) closeMap(); });
themeBtn.addEventListener('click', function(){
  applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
});

document.getElementById('homeLink').addEventListener('click', function(e){
  if (!plainClick(e)) return;
  e.preventDefault();
  stack = G.entry.slice();
  try { history.pushState({ stack: stack.slice() }, '', BASE); } catch(err){}
  renderStack();
});

/* ── Клавиатура ────────────────────────────────────────── */
document.addEventListener('keydown', function(e){
  var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  if (e.key === 'Escape'){
    if (mapOpen()) closeMap();
    else if (typing){ searchEl.value = ''; query = ''; renderRail(); searchEl.blur(); }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === '/'){ e.preventDefault(); searchEl.focus(); searchEl.select(); }
  else if (e.key === 'm' || e.key === 'ь'){ mapOpen() ? closeMap() : openMap(); }
});

window.addEventListener('popstate', function(){
  var s = parseUrl();
  stack = s || G.entry.slice();
  closeMap();
  renderStack();
});

var resizeTimer;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderStack, 120);
});

/* ── Старт ─────────────────────────────────────────────── */
try {
  var saved = localStorage.getItem('podlesok-theme');
  if (saved && THEMES.indexOf(saved) !== -1) theme = saved;
} catch(e){ /* приватный режим */ }
applyTheme(theme);

if (window.GARDEN_404){
  /* 404 оставляем как есть: сообщение уже отрисовано, указатель рядом. */
  renderRail();
} else {
  stack = parseUrl() || G.entry.slice();
  renderStack();
}
})();
