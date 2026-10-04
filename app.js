'use strict';

// ============================================================
// データと共通ヘルパー
// ============================================================
const D = window.DERBY.slice().sort((a, b) => a.year - b.year);
const byNo = new Map(D.map(d => [d.no, d]));
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = a => a[Math.floor(Math.random() * a.length)];

const FIELDS = { jockey: '騎手', trainer: '調教師', sire: '父', damsire: '母の父' };

const ERAS = [
  { id: 'all', label: '全期間', from: 0, to: 9999 },
  { id: 'pre', label: '〜1959', from: 0, to: 1959 },
  { id: '60', label: '1960〜79', from: 1960, to: 1979 },
  { id: '80', label: '1980〜99', from: 1980, to: 1999 },
  { id: '00', label: '2000〜09', from: 2000, to: 2009 },
  { id: '10', label: '2010〜', from: 2010, to: 9999 },
];
const inEra = (d, id) => {
  const e = ERAS.find(e => e.id === id) || ERAS[0];
  return d.year >= e.from && d.year <= e.to;
};

const countBy = field => {
  const m = new Map();
  for (const d of D) if (d[field]) m.set(d[field], (m.get(d[field]) || 0) + 1);
  return m;
};
const COUNTS = Object.fromEntries(Object.keys(FIELDS).map(f => [f, countBy(f)]));

// 入力答えの表記ゆれを吸収する（ひらがな→カタカナ、小書き文字、ヴ、記号、全角半角）
const SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };
function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/ヴァ/g, 'バ').replace(/ヴィ/g, 'ビ').replace(/ヴェ/g, 'ベ').replace(/ヴォ/g, 'ボ').replace(/ヴ/g, 'ブ')
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, c => SMALL[c])
    .replace(/[\s・･.．,、'’\-‐－―「」]/g, '');
}
// 「C.ルメール」は「ルメール」でも正解にする
function nameMatches(correct, input) {
  const v = norm(input);
  if (!v) return false;
  const alts = [correct, correct.replace(/^[A-Za-z]\./, '')];
  return alts.some(a => norm(a) === v);
}

// ============================================================
// 保存データ（苦手リスト・成績）
// 未ログイン時はこのブラウザだけに保存。ログイン中はアカウントごとに保存し Supabase に同期する
// ============================================================
const GUEST_KEY = 'derby-quiz:v1';
const emptyState = () => ({ miss: {}, known: {}, total: 0, correct: 0, settings: null, updatedAt: 0 });
const readLocal = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存できない環境では何もしない */ } };

let storeKey = GUEST_KEY;
const state = emptyState();

function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, emptyState(), next);
}
function save() {
  state.updatedAt = Date.now();
  writeLocal(storeKey, state);
  scheduleSync();
}
const weakNos = () => new Set(Object.keys(state.miss).map(k => +k.split(':')[0]));

function updateBadge() {
  const n = Object.keys(state.miss).length;
  const b = document.getElementById('miss-badge');
  b.textContent = n;
  b.hidden = n === 0;
}

// ============================================================
// 馬の情報表示（詳細ダイアログ・解説で共用）
// ============================================================
function factsHtml(h, highlight) {
  const row = (key, label, val) => val ? `<dt>${label}</dt><dd><span class="${highlight === key ? 'hl' : ''}">${esc(val)}</span></dd>` : '';
  return `<dl class="facts">
    ${row('year', '年', `${h.year}年（第${h.no}回）`)}
    ${row('jockey', '騎手', h.jockey)}
    ${row('trainer', '調教師', h.trainer)}
    ${row('sire', '父', h.sire)}
    ${row('dam', '母', h.dam)}
    ${row('damsire', '母の父', h.damsire)}
    ${row('pop', '人気', h.pop ? `${h.pop}番人気` : '')}
    ${row('time', 'タイム', h.time)}
  </dl>${h.note ? `<p class="note">※ ${esc(h.note)}</p>` : ''}`;
}

// 同じ騎手・調教師・父の他のダービー馬（関連づけて覚える用）
function relatedHtml(h) {
  const lines = [];
  for (const [f, label] of Object.entries(FIELDS)) {
    if (!h[f]) continue;
    const others = D.filter(d => d.no !== h.no && d[f] === h[f]);
    if (!others.length) continue;
    lines.push(`<p><b>同じ${label}（${esc(h[f])}）</b>${others.map(d => `<button class="hchip" data-no="${d.no}"><small>${d.year}</small>${esc(d.horse)}</button>`).join(' ')}</p>`);
  }
  return lines.length ? `<div class="related">${lines.join('')}</div>` : '';
}

const dlg = document.getElementById('detail');
function openDetail(no) {
  const h = byNo.get(no);
  if (!h) return;
  dlg.innerHTML = `<div class="dlg-body">
    <div class="dlg-top">
      <div>
        <p class="kicker">第${h.no}回 東京優駿・${esc(h.date)}・${esc(h.course)}</p>
        <h2>${esc(h.horse)}${h.sex === '牝' ? '<span class="tag">牝馬</span>' : ''}</h2>
      </div>
      <button class="close" aria-label="閉じる" data-close><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    ${factsHtml(h)}
    ${relatedHtml(h)}
  </div>`;
  if (!dlg.open) dlg.showModal();
}
dlg.addEventListener('click', e => {
  if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  const chip = e.target.closest('.hchip[data-no]');
  if (chip) openDetail(+chip.dataset.no);
});

// .hchip はどの画面でも詳細を開く
app.addEventListener('click', e => {
  const chip = e.target.closest('.hchip[data-no]');
  if (chip) openDetail(+chip.dataset.no);
});

// ============================================================
// 一覧
// ============================================================
const listUI = { q: '', era: 'all' };

function renderList() {
  app.innerHTML = `
    <section class="toolbar">
      <input type="search" id="q" placeholder="馬名・騎手・父・年などで検索" value="${esc(listUI.q)}">
      <div class="chips">${ERAS.map(e => `<button class="chip" data-era="${e.id}" aria-pressed="${listUI.era === e.id}">${e.label}</button>`).join('')}</div>
    </section>
    <p class="meta" id="list-meta"></p>
    <div class="table-wrap">
      <table class="list">
        <thead><tr><th>回</th><th>年</th><th>馬名</th><th>父</th><th>母の父</th><th>騎手</th><th>調教師</th><th>人気</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>`;

  const draw = () => {
    const q = norm(listUI.q);
    const weak = weakNos();
    const rows = D.filter(d => inEra(d, listUI.era) &&
      (!q || [d.horse, d.jockey, d.trainer, d.sire, d.damsire, d.dam, String(d.year), `第${d.no}回`].some(v => norm(v).includes(q))));
    let html = '';
    let prev = null;
    for (const d of rows) {
      if (!q && prev && d.year - prev.year > 1) {
        html += `<tr class="gap"><td colspan="8">${prev.year + 1}〜${d.year - 1}年は戦争のため中止</td></tr>`;
      }
      html += `<tr data-no="${d.no}" tabindex="0">
        <td class="no">${d.no}</td>
        <td class="yr">${d.year}</td>
        <td class="horse">${weak.has(d.no) ? '<span class="dot" title="復習リストにあり"></span>' : ''}${esc(d.horse)}${d.sex === '牝' ? '<span class="tag">牝</span>' : ''}</td>
        <td data-l="父">${esc(d.sire)}</td>
        <td data-l="${d.damsire ? '母の父' : ''}">${esc(d.damsire)}</td>
        <td data-l="騎手">${esc(d.jockey)}</td>
        <td data-l="調教師">${esc(d.trainer)}</td>
        <td class="pop">${d.pop ? `${d.pop}番人気` : ''}</td>
        <td class="sub">調教師 ${esc(d.trainer)}／騎手 ${esc(d.jockey)}</td>
      </tr>`;
      prev = d;
    }
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="8" class="empty">該当する馬がいません</td></tr>';
    document.getElementById('list-meta').textContent = `${rows.length}頭のダービー馬・タップで詳しく`;
  };

  document.getElementById('q').addEventListener('input', e => { listUI.q = e.target.value; draw(); });
  app.querySelector('.chips').addEventListener('click', e => {
    const b = e.target.closest('[data-era]');
    if (!b) return;
    listUI.era = b.dataset.era;
    app.querySelectorAll('[data-era]').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw();
  });
  const rowsEl = document.getElementById('rows');
  rowsEl.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-no]');
    if (tr) openDetail(+tr.dataset.no);
  });
  rowsEl.addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.key === 'Enter') openDetail(+tr.dataset.no);
  });
  draw();
}

// ============================================================
// 切り口（騎手別・父別など）
// ============================================================
const AXES = { jockey: '騎手', trainer: '調教師', sire: '父', damsire: '母の父', era: '年代', pop: '人気' };
const groupUI = { axis: 'jockey', all: false };

function groupKey(d, axis) {
  if (axis === 'era') return `${Math.floor(d.year / 10) * 10}年代`;
  if (axis === 'pop') {
    if (d.pop == null) return '記録なし';
    if (d.pop === 1) return '1番人気';
    if (d.pop <= 3) return '2〜3番人気';
    if (d.pop <= 9) return '4〜9番人気';
    return '10番人気以下';
  }
  return d[axis] || '';
}
const POP_ORDER = ['1番人気', '2〜3番人気', '4〜9番人気', '10番人気以下', '記録なし'];

function renderGroup() {
  const { axis } = groupUI;
  const byCount = axis in FIELDS;
  const m = new Map();
  for (const d of D) {
    const k = groupKey(d, axis);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  let groups = [...m.entries()];
  if (axis === 'pop') groups.sort((a, b) => POP_ORDER.indexOf(a[0]) - POP_ORDER.indexOf(b[0]));
  else if (axis === 'era') groups.sort((a, b) => a[1][0].year - b[1][0].year);
  else groups.sort((a, b) => b[1].length - a[1].length || a[1][0].year - b[1][0].year);
  const hidden = byCount && !groupUI.all ? groups.filter(g => g[1].length < 2).length : 0;
  if (hidden) groups = groups.filter(g => g[1].length >= 2);
  const max = Math.max(...groups.map(g => g[1].length));

  app.innerHTML = `
    <p class="lead">同じ騎手・同じ父などでまとめて見ると、つながりで覚えやすくなります。</p>
    <div class="chips" id="axes">${Object.entries(AXES).map(([k, v]) => `<button class="chip" data-axis="${k}" aria-pressed="${axis === k}">${v}別</button>`).join('')}</div>
    <div class="row" style="margin-top:12px; justify-content:space-between">
      ${byCount ? `<label class="toggle"><input type="checkbox" id="g-all" ${groupUI.all ? 'checked' : ''}> 1頭だけのグループも表示${hidden ? `（他${hidden}件）` : ''}</label>` : '<span></span>'}
      ${axis in FIELDS ? `<button class="btn small" id="g-quiz">この切り口でクイズ</button>` : ''}
    </div>
    <div class="groups">${groups.map(([k, list]) => `
      <div class="group">
        <div class="g-head">
          <span class="g-name">${esc(k)}</span>
          <span class="g-count">${list.length}${byCount ? '勝' : '頭'}</span>
          <span class="bar"><i style="width:${(list.length / max) * 100}%"></i></span>
        </div>
        <div class="g-horses">${list.map(d => `<button class="hchip" data-no="${d.no}"><small>${d.year}</small>${esc(d.horse)}</button>`).join('')}</div>
      </div>`).join('')}
    </div>`;

  document.getElementById('axes').addEventListener('click', e => {
    const b = e.target.closest('[data-axis]');
    if (!b) return;
    groupUI.axis = b.dataset.axis;
    renderGroup();
  });
  document.getElementById('g-all')?.addEventListener('change', e => { groupUI.all = e.target.checked; renderGroup(); });
  document.getElementById('g-quiz')?.addEventListener('click', () => {
    // 2勝以上のグループに属する馬から、その切り口の問題を出す
    const pool = D.filter(d => d[axis] && COUNTS[axis].get(d[axis]) >= 2);
    const keys = shuffle(pool).map(d => `${d.no}:${pick([`pick-${axis}`, `horse-${axis}`])}`).filter(keepByKnown).slice(0, 10);
    startSession(keys, { mode: 'choice', title: `${AXES[axis]}別クイズ` });
    location.hash = '#quiz';
  });
}

// ============================================================
// 暗記カード
// ============================================================
const cardUI = { front: 'year', era: 'all', weakOnly: false, order: null, i: 0, flipped: false, sides: [] };

function buildCards() {
  const weak = weakNos();
  const list = D.filter(d => inEra(d, cardUI.era) && (!cardUI.weakOnly || weak.has(d.no)));
  cardUI.order = list.map(d => d.no);
  cardUI.sides = list.map(() => (cardUI.front === 'random' ? pick(['year', 'horse']) : cardUI.front));
  cardUI.i = 0;
  cardUI.flipped = false;
}

function renderCards() {
  if (!cardUI.order) buildCards();
  const total = cardUI.order.length;
  const h = byNo.get(cardUI.order[cardUI.i]);
  const side = cardUI.sides[cardUI.i];

  let face = '<div class="empty">該当するカードがありません</div>';
  if (h) {
    if (!cardUI.flipped) {
      face = side === 'year'
        ? `<div><div class="small">第${h.no}回</div><div class="big">${h.year}年</div><div class="hint">タップでめくる（スペースキー）</div></div>`
        : `<div><div class="big">${esc(h.horse)}</div><div class="hint">タップでめくる（スペースキー）</div></div>`;
    } else {
      face = `<div style="width:100%">
        <div class="small">第${h.no}回・${h.year}年</div>
        <div class="big">${esc(h.horse)}</div>
        ${factsHtml(h)}
      </div>`;
    }
  }

  app.innerHTML = `
    <div class="toolbar">
      <div class="row">
        <span class="meta" style="margin:0">表に出すもの</span>
        <div class="chips" id="c-front">
          ${[['year', '年'], ['horse', '馬名'], ['random', 'ランダム']].map(([k, v]) => `<button class="chip" data-front="${k}" aria-pressed="${cardUI.front === k}">${v}</button>`).join('')}
        </div>
      </div>
      <div class="chips scroll-x" id="c-era">${ERAS.map(e => `<button class="chip" data-era="${e.id}" aria-pressed="${cardUI.era === e.id}">${e.label}</button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="c-weak" ${cardUI.weakOnly ? 'checked' : ''}> 復習リストの馬だけ</label>
    </div>
    <div class="card-stage">
      <div class="flashcard" id="card" role="button" tabindex="0" aria-label="カードをめくる">${face}</div>
      <div class="card-progress">${total ? cardUI.i + 1 : 0} / ${total}</div>
      <div class="row">
        <button class="btn" id="c-prev" ${cardUI.i <= 0 ? 'disabled' : ''}>← 前へ</button>
        <button class="btn ghost" id="c-shuffle">シャッフル</button>
        <button class="btn primary" id="c-next" ${cardUI.i >= total - 1 ? 'disabled' : ''}>次へ →</button>
      </div>
    </div>`;

  const go = d => {
    const n = cardUI.i + d;
    if (n < 0 || n >= total) return;
    cardUI.i = n;
    cardUI.flipped = false;
    renderCards();
  };
  document.getElementById('card').addEventListener('click', () => { cardUI.flipped = !cardUI.flipped; renderCards(); });
  document.getElementById('c-prev').addEventListener('click', () => go(-1));
  document.getElementById('c-next').addEventListener('click', () => go(1));
  document.getElementById('c-shuffle').addEventListener('click', () => {
    const idx = shuffle(cardUI.order.map((_, i) => i));
    cardUI.order = idx.map(i => cardUI.order[i]);
    cardUI.sides = idx.map(i => cardUI.sides[i]);
    cardUI.i = 0;
    cardUI.flipped = false;
    renderCards();
  });
  document.getElementById('c-front').addEventListener('click', e => {
    const b = e.target.closest('[data-front]');
    if (b) { cardUI.front = b.dataset.front; buildCards(); renderCards(); }
  });
  document.getElementById('c-era').addEventListener('click', e => {
    const b = e.target.closest('[data-era]');
    if (b) { cardUI.era = b.dataset.era; buildCards(); renderCards(); }
  });
  document.getElementById('c-weak').addEventListener('change', e => { cardUI.weakOnly = e.target.checked; buildCards(); renderCards(); });
  cardUI.go = go;
}

// ============================================================
// クイズ：問題の作り方
// ============================================================
const TYPES = {
  'year-horse': '年 → 馬名',
  'horse-year': '馬名 → 年',
  'horse-jockey': '馬名 → 騎手',
  'horse-trainer': '馬名 → 調教師',
  'horse-sire': '馬名 → 父',
  'horse-damsire': '馬名 → 母の父',
  'pick-jockey': '騎手 → 馬名',
  'pick-trainer': '調教師 → 馬名',
  'pick-sire': '父 → 馬名',
  'pick-damsire': '母の父 → 馬名',
};
// 設定画面で選べる出題パターン（pick は「切り口から馬を選ぶ」をまとめたもの）
const SETTING_TYPES = [
  ['year-horse', '年 → 馬名'],
  ['horse-year', '馬名 → 年'],
  ['horse-jockey', '馬名 → 騎手'],
  ['horse-trainer', '馬名 → 調教師'],
  ['horse-sire', '馬名 → 父'],
  ['horse-damsire', '馬名 → 母の父'],
  ['pick', '騎手・調教師・父 → 馬名'],
];

// 年の近い馬から、正解と違う値を n 個集める（近い時代ほど紛らわしい）
function distractors(h, getVal, n, isWrong = v => v !== getVal(h)) {
  for (let span = 8; span <= 120; span += 8) {
    const vals = [...new Set(D.filter(d => d.no !== h.no && Math.abs(d.year - h.year) <= span && isWrong(getVal(d), d)).map(getVal).filter(Boolean))];
    if (vals.length >= n || span >= 120) return shuffle(vals).slice(0, n);
  }
  return [];
}

const PICK_PROMPT = {
  jockey: v => `騎手「${v}」が勝ったダービー馬は？`,
  trainer: v => `調教師「${v}」が育てたダービー馬は？`,
  sire: v => `父「${v}」のダービー馬は？`,
  damsire: v => `母の父「${v}」のダービー馬は？`,
};

function makeQuestion(key) {
  const [noStr, type] = key.split(':');
  const h = byNo.get(+noStr);
  if (!h || !TYPES[type]) return null;
  const q = { key, type, h, label: TYPES[type] };

  if (type === 'year-horse') {
    return Object.assign(q, {
      prompt: `${h.year}年のダービー馬は？`, sub: `第${h.no}回 東京優駿`,
      answer: h.horse, choices: [h.horse, ...distractors(h, d => d.horse, 3)],
      check: v => nameMatches(h.horse, v), hint: 'カタカナでもひらがなでもOK', highlight: 'year', horseAnswer: true,
    });
  }
  if (type === 'horse-year') {
    return Object.assign(q, {
      prompt: `${h.horse} がダービーを勝ったのは何年？`, sub: `騎手 ${h.jockey}／父 ${h.sire}`,
      answer: String(h.year), choices: [String(h.year), ...distractors(h, d => String(d.year), 3)].sort(),
      check: v => parseInt(String(v).normalize('NFKC').replace(/[^0-9]/g, ''), 10) === h.year,
      hint: '西暦4桁で入力', highlight: 'year', numeric: true,
    });
  }
  if (type.startsWith('horse-')) {
    const f = type.slice(6);
    if (!h[f]) return null;
    return Object.assign(q, {
      prompt: `${h.horse} の${FIELDS[f]}は？`, sub: `第${h.no}回・${h.year}年`,
      answer: h[f], choices: [h[f], ...distractors(h, d => d[f], 3)],
      check: v => nameMatches(h[f], v), hint: f === 'jockey' || f === 'trainer' ? '漢字のフルネームで入力（外国人騎手はカタカナ）' : 'カタカナでもひらがなでもOK', highlight: f,
    });
  }
  if (type.startsWith('pick-')) {
    const f = type.slice(5);
    const val = h[f];
    if (!val) return null;
    const valid = D.filter(d => d[f] === val);
    return Object.assign(q, {
      prompt: PICK_PROMPT[f](val),
      sub: valid.length > 1 ? `該当は${valid.length}頭` : '該当は1頭',
      inputSub: valid.length > 1 ? `該当は${valid.length}頭（どれか1頭を答えればOK）` : '該当は1頭',
      answer: h.horse,
      choices: [h.horse, ...distractors(h, d => d.horse, 3, (_, d) => d[f] !== val)],
      check: v => valid.some(d => nameMatches(d.horse, v)),
      allAnswers: valid.map(d => d.horse), hint: 'カタカナでもひらがなでもOK', highlight: f, horseAnswer: true,
    });
  }
  return null;
}

// ============================================================
// クイズ：画面
// ============================================================
const defaultSettings = { types: ['year-horse', 'horse-year', 'horse-jockey', 'horse-sire'], mode: 'choice', era: 'all', n: 10, hint: false };
const settings = Object.assign({}, defaultSettings, state.settings || {});
let session = null;

// 頭文字ヒント（「ディープインパクト」なら「ディ」のように、小さい文字までをひとまとまりにする）
function initialOf(name) {
  const m = name.match(/^.[ァィゥェォャュョヮぁぃぅぇぉゃゅょゎ]?/u);
  return m ? m[0] : '';
}

function startSession(keys, { mode = settings.mode, title = 'クイズ', review = false } = {}) {
  const qs = keys.map(makeQuestion).filter(Boolean).map(q => Object.assign(q, { choices: q.numeric ? q.choices : shuffle(q.choices) }));
  session = { qs, i: 0, mode, title, review, hint: settings.hint, results: [], answered: null };
}

// 「もう覚えた」にした問題は出題確率を 1/5 に下げる（まったく出さないと忘れるので、たまに出す）
const KNOWN_RATE = 0.2;
const keepByKnown = key => !state.known[key] || Math.random() < KNOWN_RATE;

function buildKeysFromSettings() {
  const pool = shuffle(D.filter(d => inEra(d, settings.era)));
  const keys = [];
  for (let i = 0; keys.length < settings.n && i < settings.n * 20; i++) {
    const h = pool[i % pool.length];
    let t = pick(settings.types);
    if (t === 'pick') {
      // 2勝以上の騎手・調教師・父を優先（つながりで覚えられるので）
      const fs = ['jockey', 'trainer', 'sire'];
      const good = fs.filter(f => COUNTS[f].get(h[f]) >= 2);
      t = `pick-${pick(good.length ? good : fs)}`;
    }
    if (t === 'horse-damsire' && !h.damsire) continue;
    const key = `${h.no}:${t}`;
    if (!keepByKnown(key)) continue;
    keys.push(key);
  }
  return keys;
}

function renderQuiz() {
  if (!session) return renderQuizSettings();
  if (session.i >= session.qs.length) return renderQuizResult();
  renderQuestion();
}

function renderQuizSettings() {
  const rate = state.total ? Math.round((state.correct / state.total) * 100) : 0;
  app.innerHTML = `
    <div class="panel">
      <h2>クイズの設定</h2>
      <form class="settings" id="qs-form">
        <fieldset>
          <legend>出題パターン（複数選択可）</legend>
          <div class="checks">${SETTING_TYPES.map(([k, v]) => `<label class="check"><input type="checkbox" name="types" value="${k}" ${settings.types.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>答え方</legend>
          <div class="chips" data-group="mode">
            <button type="button" class="chip" data-v="choice" aria-pressed="${settings.mode === 'choice'}">4択</button>
            <button type="button" class="chip" data-v="input" aria-pressed="${settings.mode === 'input'}">入力</button>
          </div>
          <label class="toggle" style="margin-top:10px"><input type="checkbox" name="hint" ${settings.hint ? 'checked' : ''}> 馬名の頭文字をヒントに出す（入力のとき）</label>
        </fieldset>
        <fieldset>
          <legend>範囲</legend>
          <div class="chips" data-group="era">${ERAS.map(e => `<button type="button" class="chip" data-v="${e.id}" aria-pressed="${settings.era === e.id}">${e.label}</button>`).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>問題数</legend>
          <div class="chips" data-group="n">${[10, 20, 30, 50].map(n => `<button type="button" class="chip" data-v="${n}" aria-pressed="${settings.n === n}">${n}問</button>`).join('')}</div>
        </fieldset>
        <div class="row" style="justify-content:space-between">
          <div class="stats"><span><b>${state.total}</b>問 解答</span><span>正答率 <b>${rate}</b>%</span><span>復習リスト <b>${Object.keys(state.miss).length}</b>件</span><span>覚えた <b>${Object.keys(state.known).length}</b>問</span></div>
          <button class="btn primary" type="submit" id="qs-start">スタート</button>
        </div>
      </form>
    </div>`;

  const form = document.getElementById('qs-form');
  const syncStart = () => { document.getElementById('qs-start').disabled = settings.types.length === 0; };
  form.addEventListener('change', e => {
    if (e.target.name === 'types') {
      settings.types = [...form.querySelectorAll('input[name=types]:checked')].map(i => i.value);
      syncStart();
    }
    if (e.target.name === 'hint') settings.hint = e.target.checked;
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const g = b.parentElement.dataset.group;
    settings[g] = g === 'n' ? +b.dataset.v : b.dataset.v;
    b.parentElement.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!settings.types.length) return;
    state.settings = settings;
    save();
    startSession(buildKeysFromSettings());
    renderQuiz();
  });
  syncStart();
}

function renderQuestion() {
  const s = session;
  const q = s.qs[s.i];
  const ans = s.answered;
  const pct = (s.i / s.qs.length) * 100;

  const nextLabel = s.i + 1 < s.qs.length ? '次へ →' : '結果を見る';
  let body;
  if (s.mode === 'choice') {
    body = `<div class="choices">${q.choices.map((c, i) => {
      let cls = '';
      if (ans) cls = c === q.answer ? 'correct' : (c === ans.input ? 'wrong' : '');
      return `<button class="choice ${cls}" data-c="${esc(c)}" ${ans ? 'disabled' : ''}><kbd>${i + 1}</kbd>${esc(c)}</button>`;
    }).join('')}</div>`;
  } else {
    body = `<form class="answer-form" id="ans-form" autocomplete="off">
        <input type="text" id="ans" ${q.numeric ? 'inputmode="numeric"' : ''} placeholder="答えを入力" value="${ans ? esc(ans.input) : ''}" ${ans ? 'disabled' : ''}>
        ${ans
          ? `<button class="btn primary" type="button" id="next">${nextLabel}</button>`
          : '<button class="btn primary" type="submit">答える</button>'}
      </form>
      ${ans ? '' : `<div class="row" style="justify-content:space-between; margin-top:6px">
        <p class="input-hint">${esc(q.hint || '')}</p>
        <button class="btn ghost small" id="giveup">わからない</button>
      </div>`}`;
  }

  let fb = '';
  if (ans) {
    const correctText = q.allAnswers && q.allAnswers.length > 1 ? `正解：${q.allAnswers.join('、')}` : `正解：${q.answer}`;
    // 判定と「次へ」は答えたすぐ下に出し、解説はその下にまとめる（簡単な問題はスクロールせずに次へ進める）
    const your = `${ans.ok && s.mode === 'choice' ? '' : esc(correctText)}${!ans.ok && ans.input ? `（あなたの答え：${esc(ans.input)}）` : ''}`;
    fb = `<div class="verdict-bar ${ans.ok ? 'ok' : 'ng'}">
        <div><p class="verdict">${ans.ok ? 'せいかい！' : 'おしい…！'}</p>${your ? `<p class="your">${your}</p>` : ''}</div>
        <div class="verdict-actions">
          ${ans.ok ? `<button class="known-btn" id="known" aria-pressed="${!!state.known[q.key]}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>もう覚えた</button>` : ''}
          ${s.mode === 'choice' ? `<button class="btn primary" id="next">${nextLabel}</button>` : ''}
        </div>
      </div>
      <div class="feedback">
        <h3>${esc(q.h.horse)}</h3>
        ${factsHtml(q.h, q.highlight)}
        ${relatedHtml(q.h)}
      </div>`;
  }

  app.innerHTML = `
    <div class="panel">
      <div class="q-head"><span>${esc(s.title)}</span><span>${s.i + 1} / ${s.qs.length}</span></div>
      <div class="q-progress"><i style="width:${pct}%"></i></div>
      <span class="q-label">${esc(q.label)}</span>
      <p class="q-prompt">${esc(q.prompt)}</p>
      <p class="q-sub">${esc(s.mode === 'input' && q.inputSub ? q.inputSub : q.sub)}</p>
      ${s.mode === 'input' && s.hint && q.horseAnswer && !ans ? `<p class="q-hint">ヒント：<b>${esc(initialOf(q.answer))}</b> から始まる馬</p>` : ''}
      ${body}
      ${fb}
    </div>
    <div class="row" style="margin-top:12px; justify-content:flex-end">
      <button class="btn ghost small" id="quit">やめる</button>
    </div>`;

  app.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => answer(b.dataset.c)));
  const form = document.getElementById('ans-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = document.getElementById('ans').value.trim();
      if (v) answer(v);
    });
    if (!ans) document.getElementById('ans').focus();
  }
  document.getElementById('giveup')?.addEventListener('click', () => answer(''));
  document.getElementById('next')?.addEventListener('click', nextQuestion);
  document.getElementById('known')?.addEventListener('click', e => {
    const on = !state.known[q.key];
    if (on) state.known[q.key] = Date.now();
    else delete state.known[q.key];
    e.currentTarget.setAttribute('aria-pressed', on);
    save();
  });
  document.getElementById('quit').addEventListener('click', () => { session = null; renderQuiz(); });
  if (ans) document.getElementById('next').focus({ preventScroll: true });
}

function answer(input) {
  const s = session;
  if (s.answered) return;
  const q = s.qs[s.i];
  const ok = s.mode === 'choice' ? input === q.answer : q.check(input);
  s.answered = { input, ok };
  s.results.push({ key: q.key, ok });
  state.total++;
  if (ok) {
    state.correct++;
    delete state.miss[q.key];
  } else {
    const m = state.miss[q.key] || { n: 0 };
    state.miss[q.key] = { n: m.n + 1, at: Date.now() };
    delete state.known[q.key]; // 覚えたつもりで間違えたら、通常の出題に戻す
  }
  save();
  updateBadge();
  renderQuestion();
}

function nextQuestion() {
  session.i++;
  session.answered = null;
  renderQuiz();
  window.scrollTo({ top: 0 });
}

function renderQuizResult() {
  const s = session;
  const okN = s.results.filter(r => r.ok).length;
  const wrong = s.results.filter(r => !r.ok).map(r => makeQuestion(r.key)).filter(Boolean);
  app.innerHTML = `
    <div class="panel">
      <p class="meta" style="margin-top:0">${esc(s.title)}の結果</p>
      <p class="score">${okN}<small> / ${s.results.length} 問正解</small></p>
      ${wrong.length ? `<h3>間違えた問題（復習リストに追加済み）</h3>
        <ul class="miss-list">${wrong.map(q => `<li><div><div class="m-q">${esc(q.prompt)}</div><div class="m-a">${esc(q.answer)}</div></div><button class="hchip" data-no="${q.h.no}">詳細</button></li>`).join('')}</ul>`
        : '<p>全問正解です！</p>'}
      <div class="row" style="margin-top:18px">
        ${wrong.length ? '<button class="btn primary" id="retry-wrong">間違えた問題をもう一度</button>' : ''}
        <button class="btn" id="again">同じ設定でもう一度</button>
        <button class="btn ghost" id="to-settings">設定に戻る</button>
      </div>
    </div>`;
  document.getElementById('retry-wrong')?.addEventListener('click', () => {
    startSession(shuffle(wrong.map(q => q.key)), { mode: s.mode, title: '間違えた問題', review: true });
    renderQuiz();
  });
  document.getElementById('again').addEventListener('click', () => {
    if (s.review || s.title !== 'クイズ') startSession(shuffle(s.qs.map(q => q.key)), { mode: s.mode, title: s.title, review: s.review });
    else startSession(buildKeysFromSettings());
    renderQuiz();
  });
  document.getElementById('to-settings').addEventListener('click', () => { session = null; renderQuiz(); });
}

// ============================================================
// 復習
// ============================================================
const reviewUI = { mode: 'choice' };

function renderReview() {
  const entries = Object.entries(state.miss)
    .map(([key, v]) => ({ key, q: makeQuestion(key), n: v.n, at: v.at }))
    .filter(e => e.q)
    .sort((a, b) => b.n - a.n || b.at - a.at);
  const known = Object.entries(state.known)
    .map(([key, at]) => ({ key, q: makeQuestion(key), at }))
    .filter(e => e.q)
    .sort((a, b) => b.at - a.at);

  const missPanel = entries.length ? `
    <div class="panel">
      <h2>復習リスト（${entries.length}件）</h2>
      <p class="lead">間違えた問題だけを出題します。正解するとリストから外れます。</p>
      <div class="row" style="justify-content:space-between">
        <div class="chips" id="rv-mode">
          <button class="chip" data-v="choice" aria-pressed="${reviewUI.mode === 'choice'}">4択</button>
          <button class="chip" data-v="input" aria-pressed="${reviewUI.mode === 'input'}">入力</button>
        </div>
        ${reviewUI.mode === 'input' ? `<label class="toggle"><input type="checkbox" id="rv-hint" ${settings.hint ? 'checked' : ''}> 頭文字ヒント</label>` : ''}
        <button class="btn primary" id="rv-start">復習スタート（${Math.min(entries.length, 20)}問）</button>
      </div>
      <h3>苦手な問題（間違えた回数順）</h3>
      <ul class="miss-list">${entries.map(e => `
        <li>
          <div><div class="m-q">${esc(e.q.label)}｜${esc(e.q.prompt)}</div><div class="m-a">${esc(e.q.answer)}</div></div>
          <div class="row"><span class="m-n">×${e.n}</span><button class="btn ghost small" data-del="${esc(e.key)}" aria-label="リストから外す">外す</button></div>
        </li>`).join('')}
      </ul>
      <div class="row" style="margin-top:16px; justify-content:flex-end">
        <button class="btn ghost small" id="rv-clear">リストを全部消す</button>
      </div>
    </div>` : `
    <div class="panel empty">
      <p>復習リストは空です。</p>
      <p style="font-size:13px">クイズで間違えた問題がここにたまります。正解するとリストから外れます。</p>
      <a class="btn primary" href="#quiz">クイズをする</a>
    </div>`;

  const knownPanel = known.length ? `
    <div class="panel" style="margin-top:16px">
      <h2>覚えた問題（${known.length}問）</h2>
      <p class="lead">「もう覚えた」にした問題は、出題される確率が1/5になります。間違えると自動で外れます。</p>
      <ul class="miss-list">${known.map(e => `
        <li>
          <div><div class="m-q">${esc(e.q.label)}｜${esc(e.q.prompt)}</div><div class="m-a">${esc(e.q.answer)}</div></div>
          <button class="btn ghost small" data-unknown="${esc(e.key)}" aria-label="覚えた問題から外す">外す</button>
        </li>`).join('')}
      </ul>
    </div>` : '';

  app.innerHTML = missPanel + knownPanel;

  document.getElementById('rv-mode')?.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    reviewUI.mode = b.dataset.v;
    renderReview();
  });
  document.getElementById('rv-hint')?.addEventListener('change', e => {
    settings.hint = e.target.checked;
    state.settings = settings;
    save();
  });
  document.getElementById('rv-start')?.addEventListener('click', () => {
    // 間違いの多いものを優先しつつ、順番はシャッフル
    startSession(shuffle(entries.slice(0, 20).map(e => e.key)), { mode: reviewUI.mode, title: '復習', review: true });
    location.hash = '#quiz';
  });
  app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    delete state.miss[b.dataset.del];
    save();
    updateBadge();
    renderReview();
  }));
  app.querySelectorAll('[data-unknown]').forEach(b => b.addEventListener('click', () => {
    delete state.known[b.dataset.unknown];
    save();
    renderReview();
  }));
  document.getElementById('rv-clear')?.addEventListener('click', () => {
    if (!confirm('復習リストを全部消しますか？')) return;
    state.miss = {};
    save();
    updateBadge();
    renderReview();
  });
}

// ============================================================
// キーボード操作・画面切り替え
// ============================================================
document.addEventListener('keydown', e => {
  if (dlg.open || accountDlg.open || document.body.classList.contains('locked') || e.metaKey || e.ctrlKey || e.altKey) return;
  const view = currentView();
  const typing = e.target.matches('input, textarea, select');
  if (view === 'cards' && !typing) {
    if (e.key === ' ') { e.preventDefault(); cardUI.flipped = !cardUI.flipped; renderCards(); }
    if (e.key === 'ArrowRight') cardUI.go?.(1);
    if (e.key === 'ArrowLeft') cardUI.go?.(-1);
  }
  if (view === 'quiz' && session && session.i < session.qs.length && !typing) {
    if (!session.answered && session.mode === 'choice' && /^[1-4]$/.test(e.key)) {
      const c = session.qs[session.i].choices[+e.key - 1];
      if (c) answer(c);
    }
  }
});

const VIEWS = { list: renderList, group: renderGroup, cards: renderCards, quiz: renderQuiz, review: renderReview };
const currentView = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'list');

function route() {
  const v = currentView();
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  VIEWS[v]();
  updateBadge();
}

// ============================================================
// アカウント（Supabase）と同期
// ============================================================
const cfg = window.DERBY_CONFIG || {};
const sb = window.supabase && cfg.supabaseUrl ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
const account = { user: null, status: '' }; // status: saving / saved / error
const accountBtn = document.getElementById('account-btn');
const accountDlg = document.getElementById('account');
let syncTimer = null;

const displayName = u => (u.user_metadata && u.user_metadata.name) || u.email.split('@')[0];
const hasProgress = s => s && (s.total > 0 || Object.keys(s.miss || {}).length > 0);

function updateAccountBtn() {
  accountBtn.hidden = !account.user;
  if (!account.user) return;
  accountBtn.textContent = displayName(account.user);
  accountBtn.dataset.status = account.status;
}

function scheduleSync() {
  if (!account.user) return;
  account.status = 'saving';
  updateAccountBtn();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushRemote, 800);
}

async function pushRemote() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (!account.user) return;
  const { error } = await sb.from('progress').upsert({
    user_id: account.user.id, data: state, updated_at: new Date(state.updatedAt || Date.now()).toISOString(),
  });
  account.status = error ? 'error' : 'saved';
  updateAccountBtn();
}

// 複数端末で同じアカウントを使うので、新しく更新された方を採用する
async function pullRemote() {
  const { data, error } = await sb.from('progress').select('data').eq('user_id', account.user.id).maybeSingle();
  if (error) { account.status = 'error'; return; }
  const remote = data && data.data;
  if (remote && (remote.updatedAt || 0) >= (state.updatedAt || 0)) {
    replaceState(remote);
    writeLocal(storeKey, state);
  } else if (hasProgress(state)) {
    await pushRemote();
  }
  account.status = 'saved';
}

async function switchToUser(user) {
  account.user = user;
  storeKey = `${GUEST_KEY}:${user.id}`;
  replaceState(readLocal(storeKey) || {});
  await pullRemote();
  Object.assign(settings, defaultSettings, state.settings || {});
  updateAccountBtn();
  unlock();
}

async function logout() {
  if (syncTimer) await pushRemote();
  await sb.auth.signOut();
  account.user = null;
  account.status = '';
  storeKey = GUEST_KEY;
  replaceState({});
  session = null;
  cardUI.order = null;
  updateAccountBtn();
  lock();
}

// ============================================================
// ログイン画面（未ログインのときはコンテンツを表示しない）
// ============================================================
const gate = document.getElementById('gate');

function lock(message) {
  document.body.classList.add('locked');
  app.innerHTML = '';
  if (dlg.open) dlg.close();
  if (message) {
    gate.innerHTML = `<div class="panel gate-panel"><p class="lead" style="margin:0">${esc(message)}</p></div>`;
    return;
  }
  gate.innerHTML = `<div class="panel gate-panel">
    <h2>ログイン</h2>
    <p class="lead">このアプリは登録したメンバー専用です。</p>
    <form id="login-form" class="settings" style="gap:10px">
      <input type="email" name="email" placeholder="メールアドレス" autocomplete="username" required>
      <input type="password" name="password" placeholder="パスワード" autocomplete="current-password" required>
      <p class="login-error" id="login-error" hidden></p>
      <button class="btn primary" type="submit">ログイン</button>
    </form>
  </div>`;
  const form = gate.querySelector('#login-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = gate.querySelector('#login-error');
    btn.disabled = true;
    err.hidden = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) {
      btn.disabled = false;
      err.textContent = /invalid login credentials/i.test(error.message) ? 'メールアドレスかパスワードが違います' : `ログインできませんでした（${error.message}）`;
      err.hidden = false;
      return;
    }
    await switchToUser(data.user);
  });
  form.email.focus();
}

function unlock() {
  gate.innerHTML = '';
  document.body.classList.remove('locked');
  route();
}

const STATUS_TEXT = { saving: '保存中…', saved: 'クラウドに保存済み', error: '保存に失敗しました（通信を確認してください）' };

function openAccount() {
  if (!account.user) return;
  accountDlg.innerHTML = `<div class="dlg-body">
    <div class="dlg-top"><h2>${esc(displayName(account.user))}</h2><button class="close" aria-label="閉じる" data-close><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <p class="meta">${esc(account.user.email)}</p>
    <p>${esc(STATUS_TEXT[account.status] || '')}</p>
    <p class="note">成績と復習リストはこのアカウントに保存され、ログインしたどの端末でも同じ内容になります。</p>
    <details class="pw-change">
      <summary>パスワードを変更する</summary>
      <form id="pw-form" class="settings" style="gap:10px; margin-top:12px">
        <input type="email" name="username" value="${esc(account.user.email)}" autocomplete="username" hidden>
        <input type="password" name="pw1" placeholder="新しいパスワード（6文字以上）" autocomplete="new-password" minlength="6" required>
        <input type="password" name="pw2" placeholder="新しいパスワード（確認）" autocomplete="new-password" minlength="6" required>
        <p class="login-error" id="pw-error" hidden></p>
        <p class="form-ok" id="pw-ok" hidden>パスワードを変更しました。次回からは新しいパスワードでログインしてください。</p>
        <button class="btn primary" type="submit">変更する</button>
      </form>
    </details>
    <div class="row" style="margin-top:16px; justify-content:flex-end"><button class="btn" id="logout">ログアウト</button></div>
  </div>`;
  accountDlg.querySelector('#logout').addEventListener('click', async () => { accountDlg.close(); await logout(); });
  const pwForm = accountDlg.querySelector('#pw-form');
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    const err = accountDlg.querySelector('#pw-error');
    const ok = accountDlg.querySelector('#pw-ok');
    const btn = pwForm.querySelector('button[type=submit]');
    err.hidden = true;
    ok.hidden = true;
    if (pwForm.pw1.value !== pwForm.pw2.value) {
      err.textContent = '2つの入力が一致しません';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: pwForm.pw1.value });
    btn.disabled = false;
    if (error) {
      const m = error.message;
      err.textContent = /different from the old/i.test(m) ? '今と同じパスワードです。別のパスワードにしてください'
        : /at least|weak/i.test(m) ? 'パスワードが短すぎるか、簡単すぎます。6文字以上で、推測されにくいものにしてください'
        : /reauthenticat|nonce/i.test(m) ? '本人確認が必要な設定になっています。管理者に連絡してください'
        : `変更できませんでした（${m}）`;
      err.hidden = false;
      return;
    }
    pwForm.reset();
    ok.hidden = false;
  });
  accountDlg.showModal();
}
accountDlg.addEventListener('click', e => {
  if (e.target === accountDlg || e.target.closest('[data-close]')) accountDlg.close();
});
accountBtn.addEventListener('click', openAccount);

// 画面を閉じる・アプリを切り替える前に、未送信の変更を送る
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && syncTimer) pushRemote();
});

async function initAccount() {
  updateAccountBtn();
  if (!sb) return lock('ログインサービスに接続できませんでした。通信状況を確認して、ページを再読み込みしてください。');
  const { data } = await sb.auth.getSession();
  if (data.session) await switchToUser(data.session.user);
  else lock();
}

document.getElementById('count').textContent = D.length;
window.addEventListener('hashchange', () => {
  if (document.body.classList.contains('locked')) return;
  route();
  window.scrollTo({ top: 0 });
});
initAccount();
