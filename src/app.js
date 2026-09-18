/* Подлесок — клиентская часть. Данные приходят из build.mjs в window.GARDEN. */
(function(){
'use strict';

var G = window.GARDEN;
var NOTES = G.notes;
var BACK = G.backlinks;
var byId = {};
NOTES.forEach(function(n){ byId[n.id] = n; });

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

var stack = [];
var query = '';
var stageFilter = null;

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtDate(iso){
  var p = iso.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

/* ── Адрес страницы ────────────────────────────────────── */
function readHash(){
  var raw = '';
  try { raw = decodeURIComponent(location.hash || ''); } catch(e){ raw = ''; }
  var ids = raw.replace(/^#\/?/, '').split('/').filter(function(id){ return byId[id]; });
  return ids.length ? ids : null;
}

function writeHash(){
  try {
    var want = '#/' + stack.join('/');
    if (location.hash !== want) history.replaceState(null, '', want);
  } catch(e){ /* внутри песочницы адрес менять нельзя — не страшно */ }
}

/* ── Заметка ───────────────────────────────────────────── */
function noteHTML(n, colIndex){
  var st = STAGES[n.stage];
  var bl = BACK[n.id] || [];
  return '<div class="col-inner">' +
    '<span class="note-stage ' + st.cls + '"><span class="dot ' + st.cls + '"></span>' + st.label + '</span>' +
    '<h2 class="note-title">' + esc(n.title) + '</h2>' +
    '<div class="note-dates">' +
      '<span>посажена ' + fmtDate(n.planted) + '</span>' +
      '<span>последний уход ' + fmtDate(n.tended) + '</span>' +
    '</div>' +
    '<div class="body">' + n.html + '</div>' +
    '<div class="backlinks">' +
      '<h3>Ссылаются сюда · ' + bl.length + '</h3>' +
      (bl.length
        ? bl.map(function(id){
            var s = STAGES[byId[id].stage];
            return '<button class="bl" data-id="' + id + '" data-col="' + colIndex + '">' +
                   '<span class="dot ' + s.cls + '"></span>' + esc(byId[id].title) + '</button>';
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
                '<span class="dot ' + st.cls + '"></span>' +
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
  renderTopbar();
  renderRail();
  writeHash();
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
        return '<button class="rail-item" data-id="' + n.id + '" data-open="' + open + '">' +
                 '<span class="t"><span class="dot ' + st.cls + '"></span>' +
                 '<span class="name">' + esc(n.title) + '</span></span>' +
                 '<span class="meta">' + fmtDate(n.tended) + ' · ссылок сюда: ' + bl + '</span>' +
               '</button>';
      }).join('')
    : '<p class="empty">Ничего не выросло по этому запросу.</p>';
}

function renderFilters(){
  filtersEl.innerHTML = Object.keys(STAGES).map(function(k){
    return '<button class="chip" data-stage="' + k + '" aria-pressed="false">' +
             '<span class="dot ' + STAGES[k].cls + '"></span>' + STAGES[k].label +
           '</button>';
  }).join('');
}

function open(id, fromCol){
  if (fromCol === null || fromCol === undefined) stack = [id];
  else {
    stack = stack.slice(0, fromCol + 1);
    if (stack[stack.length - 1] !== id) stack.push(id);
  }
  document.body.classList.remove('rail-open');
  closeMap();
  renderStack();
  var cols = stackEl.querySelectorAll('.col');
  if (cols.length) cols[cols.length - 1].scrollTop = 0;
}

/* ── Карта сада: пружинная раскладка ───────────────────── */
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

function layout(){
  var n = NOTES.length;
  var pos = [];
  for (var i = 0; i < n; i++){
    var a = (i / n) * Math.PI * 2;
    pos.push({ x: Math.cos(a) * 130, y: Math.sin(a) * 130 });
  }
  var L = 95, KS = 0.055, KR = 5200, KC = 0.010;
  for (var it = 0; it < 450; it++){
    var fx = new Array(n).fill(0), fy = new Array(n).fill(0);
    for (var i2 = 0; i2 < n; i2++){
      for (var j = i2 + 1; j < n; j++){
        var dx = pos[i2].x - pos[j].x, dy = pos[i2].y - pos[j].y;
        var d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2);
        var f = KR / d2;
        fx[i2] += dx / d * f; fy[i2] += dy / d * f;
        fx[j]  -= dx / d * f; fy[j]  -= dy / d * f;
      }
    }
    edges.forEach(function(e){
      var a1 = e[0], b1 = e[1];
      var dx = pos[b1].x - pos[a1].x, dy = pos[b1].y - pos[a1].y;
      var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var f = (d - L) * KS;
      fx[a1] += dx / d * f; fy[a1] += dy / d * f;
      fx[b1] -= dx / d * f; fy[b1] -= dy / d * f;
    });
    for (var k = 0; k < n; k++){
      fx[k] -= pos[k].x * KC; fy[k] -= pos[k].y * KC;
      pos[k].x += Math.max(-8, Math.min(8, fx[k] * 0.85));
      pos[k].y += Math.max(-8, Math.min(8, fy[k] * 0.85));
    }
  }
  return pos;
}

var mapDrawn = false;
function drawMap(){
  if (mapDrawn) return;
  mapDrawn = true;

  var W = 800, H = 560, HM = 100, VM = 40;
  var pos = layout();
  var xs = pos.map(function(p){ return p.x; }), ys = pos.map(function(p){ return p.y; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var sx = (W - HM * 2) / Math.max(1, maxX - minX);
  var sy = (H - VM * 2) / Math.max(1, maxY - minY);
  var s = Math.min(sx, sy);
  var ox = (W - (maxX - minX) * s) / 2 - minX * s;
  var oy = (H - (maxY - minY) * s) / 2 - minY * s;
  var P = pos.map(function(p){ return { x: p.x * s + ox, y: p.y * s + oy }; });

  var stroke = { seed:'var(--warm)', grow:'var(--accent)', ever:'var(--accent)' };

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Граф связей между заметками">';
  edges.forEach(function(e, i){
    svg += '<line class="edge" data-edge="' + e[0] + '-' + e[1] + '" ' +
           'x1="' + P[e[0]].x.toFixed(1) + '" y1="' + P[e[0]].y.toFixed(1) + '" ' +
           'x2="' + P[e[1]].x.toFixed(1) + '" y2="' + P[e[1]].y.toFixed(1) + '"></line>';
  });
  NOTES.forEach(function(n, i){
    var bl = (BACK[n.id] || []).length;
    var r  = 5 + Math.min(bl, 6) * 1.7;
    var right = P[i].x > W / 2;
    var label = n.title.length > 22 ? n.title.slice(0, 21) + '…' : n.title;
    var fill = n.stage === 'seed' ? 'none' : stroke[n.stage];
    var half = n.stage === 'grow';
    svg += '<g class="node" data-i="' + i + '" data-id="' + n.id + '" tabindex="0" role="button" aria-label="' + esc(n.title) + '">';
    svg += '<circle cx="' + P[i].x.toFixed(1) + '" cy="' + P[i].y.toFixed(1) + '" r="' + r.toFixed(1) +
           '" fill="' + (half ? 'none' : fill) + '" stroke="' + stroke[n.stage] + '" stroke-width="1.6"></circle>';
    if (half){
      svg += '<path d="M ' + P[i].x.toFixed(1) + ' ' + (P[i].y - r).toFixed(1) +
             ' A ' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 1 ' +
             P[i].x.toFixed(1) + ' ' + (P[i].y + r).toFixed(1) + ' Z" fill="' + stroke[n.stage] + '"></path>';
    }
    svg += '<text x="' + (P[i].x + (right ? -(r + 6) : (r + 6))).toFixed(1) + '" y="' + (P[i].y + 3.4).toFixed(1) +
           '" text-anchor="' + (right ? 'end' : 'start') + '">' + esc(label) + '</text>';
    svg += '</g>';
  });
  svg += '</svg>';
  mapBody.innerHTML = svg;

  var neighbours = NOTES.map(function(){ return {}; });
  edges.forEach(function(e){ neighbours[e[0]][e[1]] = 1; neighbours[e[1]][e[0]] = 1; });

  function hot(i){
    mapEl.classList.add('dimmed');
    mapBody.querySelectorAll('.node').forEach(function(g){
      var k = Number(g.dataset.i);
      g.classList.toggle('hot', k === i || neighbours[i][k] === 1);
    });
    mapBody.querySelectorAll('.edge').forEach(function(l){
      var p = l.dataset.edge.split('-');
      l.classList.toggle('hot', Number(p[0]) === i || Number(p[1]) === i);
    });
  }
  function cool(){
    mapEl.classList.remove('dimmed');
    mapBody.querySelectorAll('.hot').forEach(function(el){ el.classList.remove('hot'); });
  }

  mapBody.querySelectorAll('.node').forEach(function(g){
    var i = Number(g.dataset.i);
    g.addEventListener('mouseenter', function(){ hot(i); });
    g.addEventListener('focus', function(){ hot(i); });
    g.addEventListener('mouseleave', cool);
    g.addEventListener('blur', cool);
    g.addEventListener('click', function(){ open(g.dataset.id, null); });
    g.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); open(g.dataset.id, null); }
    });
  });
}

function openMap(){ drawMap(); mapEl.hidden = false; }
function closeMap(){ mapEl.hidden = true; }

/* ── События ───────────────────────────────────────────── */
stackEl.addEventListener('click', function(e){
  var spine = e.target.closest('[data-spine]');
  if (spine){ stack = stack.slice(0, Number(spine.dataset.spine) + 1); renderStack(); return; }
  var bl = e.target.closest('.bl');
  if (bl){ open(bl.dataset.id, Number(bl.dataset.col)); return; }
  var wl = e.target.closest('.wl');
  if (wl){ e.preventDefault(); open(wl.dataset.id, Number(wl.closest('.col').dataset.col)); }
});

topbar.addEventListener('click', function(e){
  if (e.target.closest('#railBtn')){ document.body.classList.toggle('rail-open'); return; }
  if (e.target.closest('#mapBtnM')){ document.body.classList.remove('rail-open'); openMap(); return; }
  var crumb = e.target.closest('[data-spine]');
  if (crumb){ stack = stack.slice(0, Number(crumb.dataset.spine) + 1); renderStack(); }
});

railList.addEventListener('click', function(e){
  var item = e.target.closest('.rail-item');
  if (item) open(item.dataset.id, null);
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

document.getElementById('mapBtn').addEventListener('click', openMap);
document.getElementById('mapClose').addEventListener('click', closeMap);
mapEl.addEventListener('click', function(e){ if (e.target === mapEl) closeMap(); });
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMap(); });

var resizeTimer;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderStack, 120);
});

/* ── Старт ─────────────────────────────────────────────── */
stack = readHash() || G.entry;
renderFilters();
renderStack();
})();
