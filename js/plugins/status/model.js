// ステータス管理: データの形と増減の計算。画面にもAIにも依存しない
//
// トークごとの状態（記憶と一緒に巻き戻る）:
// { money, items: [{ id, name, qty, cat, note, at: ''|'home', rar, unid, val, named }],
//   equip: { 枠: 名前 }, skills: [{ name, level, note }], gauges: { 名前: { v, max } },
//   day, home: { name, kind, rent, every, next, arrears } | null, projects: [{ name, progress, note }],
//   quests: [{ title, reward, deadline, state }], depth, rep: { 勢力: -100〜100 }, log: [{ turn, text }], prev }
//
// 増減の経路は2つ:
// - ボタン操作（戦利品・鑑定・売却・使う）: 送ったメッセージに ops を付け、記憶係が確定させたときに適用（それまでは上乗せ表示）
// - 記憶係が会話から読み取った変化: applyKeeper で適用
import { uid, clamp, clone } from '../../core/util.js';
import { RARITY } from './presets.js';

/* ---------- 設定文字列の読み取り ---------- */
export const list = s => String(s ?? '').split(/[,、，\n]/).map(x => x.trim()).filter(Boolean);
const lines = s => String(s ?? '').split(/\n|[,、，](?![^（(]*[)）])/).map(x => x.trim()).filter(Boolean);
// 「名前×数（種類）」。種類を省いたら、種類名の一部を含むものに振り分ける（浄水タブレット → 食料・水）
export function parseItems(s, cats = []) {
  return lines(s).map(l => {
    let cat = '';
    const c = l.match(/^(.*?)\s*[（(［\[]([^）)］\]]+)[）)］\]]\s*$/);
    if (c && cats.includes(c[2].trim())) { l = c[1]; cat = c[2].trim(); }
    const m = l.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/), name = (m ? m[1] : l).trim();
    return { name, qty: m ? Number(m[2]) : 1, cat: cat || guessCat(name, cats) };
  });
}
export const guessCat = (name, cats) => cats.find(c => c.split(/[・/／]/).some(t => t && name.includes(t))) || '';
export function parsePairs(s) {
  return lines(s).map(l => {
    const m = l.match(/^([^:：]+)[:：]\s*(.*)$/);
    return m ? [m[1].trim(), m[2].trim()] : [l, ''];
  });
}
export function parseGauges(s) {
  const out = {};
  for (const [name, v] of parsePairs(s)) {
    const m = v.match(/^(\d+)\s*(?:\/\s*(\d+))?$/);
    if (!m) continue;
    const max = Number(m[2] ?? m[1]);
    out[name] = { v: Number(m[1]), max: max || Number(m[1]) || 100 };
  }
  return out;
}
export function parseWeights(s) {
  const out = {};
  for (const [k, v] of parsePairs(s)) if (v !== '' && !isNaN(Number(v))) out[k] = Number(v);
  return out;
}

/* ---------- 状態 ---------- */
export function initState(e) {
  const items = parseItems(e.items, list(e.cats)).map(i => ({ id: uid(), name: i.name, qty: i.qty, cat: i.cat, note: '', at: '' }));
  return {
    v: 1, money: Number(e.money) || 0, items,
    equip: Object.fromEntries(parsePairs(e.equip).filter(([k, v]) => k && v)),
    skills: parsePairs(e.skills).map(([name, level]) => ({ name, level, note: '' })),
    gauges: parseGauges(e.gauges),
    day: 1, home: null, projects: [], quests: [],
    depth: '', rep: Object.fromEntries(list(e.factions).map(f => [f, 0])),
    log: [], prev: null,
  };
}

export const fmtMoney = (n, e) => `${Math.round(n).toLocaleString()}${e.currency}`;
export const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString();
export const rarity = k => RARITY.find(r => r.k === k);
export const rarLabel = (k, e) => (k === 'L' ? e.legend : rarity(k)?.label || '');
export const itemLabel = (it, e) => it.unid ? (it.name.includes('未鑑定') ? it.name : `${it.name}（？）`) : it.rar && !it.named ? `${it.name}【${rarLabel(it.rar, e)}】` : it.name;

// 深さ（「下層B4」「第3層」→ 4 / 3、地上・街 → 0）
export const depthLevel = d => Number(String(d || '').match(/\d+/)?.[0] || 0);
export function dangerLabel(lvl) {
  return lvl <= 0 ? '安全' : lvl <= 2 ? '低' : lvl <= 4 ? '中' : lvl <= 7 ? '高' : '極めて高い';
}
export const repLabel = v => (v <= -60 ? '敵対' : v <= -20 ? '冷淡' : v < 20 ? '中立' : v < 60 ? '友好' : '盟友');
export const weekday = day => '月火水木金土日'[(Math.max(1, day) - 1) % 7];

export function carryOf(st, e) {
  if (!(Number(e.carry) > 0)) return null;
  const w = parseWeights(e.weights);
  const used = st.items.filter(i => i.at !== 'home').reduce((a, i) => a + (w[i.cat] ?? 1) * i.qty, 0);
  return { used: Math.round(used * 10) / 10, max: Number(e.carry) };
}

const findItem = (st, name, at = '') => {
  const n = String(name || '').trim();
  const pool = st.items.filter(i => i.at === at);
  return pool.find(i => i.name === n) || pool.find(i => n.length > 1 && (i.name.includes(n) || n.includes(i.name)));
};
function addItem(st, it) {
  const same = !it.rar && !it.unid && st.items.find(i => i.at === (it.at || '') && i.name === it.name && !i.rar && !i.unid);
  if (same) { same.qty += it.qty; if (it.note && !same.note) same.note = it.note; return same; }
  const x = { id: it.id || uid(), name: it.name, qty: it.qty || 1, cat: it.cat || '', note: it.note || '', at: it.at || '' };
  for (const k of ['rar', 'unid', 'val', 'named']) if (it[k] != null) x[k] = it[k];
  st.items.push(x);
  return x;
}
const pushLog = (st, turn, text) => { st.log.push({ turn, text }); if (st.log.length > 120) st.log.splice(0, st.log.length - 120); };

/* ---------- ボタン操作の増減（メッセージに付けて保存し、確定時に適用） ---------- */
// op: { op: 'money', d } / { op: 'add', item } / { op: 'qty', id, d } / { op: 'patch', id, set } / { op: 'log', text }
export function applyOps(st, ops, turn = 0) {
  for (const o of ops || []) {
    if (o.op === 'money') st.money += Number(o.d) || 0;
    else if (o.op === 'add') addItem(st, o.item);
    else if (o.op === 'qty') {
      const it = st.items.find(i => i.id === o.id);
      if (it) { it.qty += Number(o.d) || 0; if (it.qty <= 0) st.items.splice(st.items.indexOf(it), 1); }
    } else if (o.op === 'patch') {
      const it = st.items.find(i => i.id === o.id);
      if (it) Object.assign(it, o.set);
    } else if (o.op === 'log') pushLog(st, turn, o.text);
  }
}

/* ---------- 運はアプリが決める（戦利品・鑑定） ---------- */
const pick = a => a[Math.floor(Math.random() * a.length)];
const between = (a, b) => a + Math.random() * (b - a);
export function rollRarity(lvl) {
  const ws = RARITY.map((r, i) => r.w * (i === 0 ? Math.max(0.3, 1 - lvl * 0.06) : 1 + lvl * 0.25 * i));
  let x = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return RARITY[i].k; }
  return 'C';
}
export function rollValue(rar, lvl) {
  const [a, b] = rarity(rar)?.val || [5, 30];
  return Math.max(1, Math.round(between(a, b) * (1 + lvl * 0.15)));
}
const catLike = (e, re, fallback) => list(e.cats).find(c => re.test(c)) || fallback;

// 探索・戦利品: 見つけた物を決めて { ops, text } を返す
export function rollLoot(st, e) {
  const lvl = depthLevel(st.depth), ops = [], parts = [];
  const n = 1 + (Math.random() < 0.55) + (Math.random() < 0.2);
  const kinds = [['relic', 0.22 + lvl * 0.03], ['material', 0.42], ['consumable', 0.16], ['money', 0.2]];
  for (let i = 0; i < n; i++) {
    let x = Math.random() * kinds.reduce((a, k) => a + k[1], 0), kind = 'material';
    for (const [k, w] of kinds) { x -= w; if (x <= 0) { kind = k; break; } }
    if (kind === 'relic') {
      const item = { id: uid(), name: e.relic, qty: 1, cat: catLike(e, /遺品|貴重|魔道具/, ''), unid: true, rar: rollRarity(lvl) };
      ops.push({ op: 'add', item }); parts.push(`${e.relic}（？）×1`);
    } else if (kind === 'money') {
      const d = Math.max(1, Math.round(Number(e.moneyFind || 20) * between(0.5, 1.6) * (1 + lvl * 0.4)));
      ops.push({ op: 'money', d }); parts.push(fmtMoney(d, e));
    } else {
      const pool = list(kind === 'material' ? e.materials : e.consumables);
      const name = pick(pool.length ? pool : ['がらくた']), qty = kind === 'material' ? 1 + Math.floor(Math.random() * 3) : 1;
      const cat = kind === 'material' ? catLike(e, /素材|部品/, '') : catLike(e, /消耗|弾薬|食料|医療/, '');
      ops.push({ op: 'add', item: { id: uid(), name, qty, cat } }); parts.push(`${name}×${qty}`);
    }
  }
  const danger = Math.random() < Math.min(0.6, 0.12 + lvl * 0.06);
  ops.push({ op: 'log', text: `🎁 ${parts.join('、')}` });
  return { ops, text: `*🎁 探索の成果: ${parts.join('、')}*${danger ? '\n*⚠ 近くで何かが動く気配がした*' : ''}`, danger };
}

export function appraiseOps(st, it, e) {
  const val = rollValue(it.rar, depthLevel(st.depth));
  const label = rarLabel(it.rar, e);
  return {
    ops: [{ op: 'patch', id: it.id, set: { unid: false, val } }, { op: 'log', text: `🔍 ${it.name} → 【${label}】査定額 ${fmtMoney(val, e)}` }],
    text: `*🔍 ${it.name}を鑑定: 【${label}】、査定額 ${fmtMoney(val, e)}*`,
    reveal: { id: it.id, rar: it.rar, label, val },
  };
}
export function sellOps(it, e) {
  return {
    ops: [{ op: 'money', d: it.val }, { op: 'qty', id: it.id, d: -1 }, { op: 'log', text: `💰 ${it.name}を売却 ${signed(it.val)}${e.currency}` }],
    text: `*💰 ${it.name}を売った: ${signed(it.val)}${e.currency}*`,
  };
}
export function useOps(it) {
  return { ops: [{ op: 'qty', id: it.id, d: -1 }, { op: 'log', text: `🧪 ${it.name}を使った` }], text: `*🧪 ${it.name}を使った*` };
}

/* ---------- 記憶係が読み取った変化を適用 ---------- */
// 戻り値: 通知用の短い要約の配列
export function applyKeeper(st, r, e, turn) {
  if (!r || typeof r !== 'object') return [];
  const out = [], str = v => (typeof v === 'string' ? v.trim() : ''), int = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  const arr = v => (Array.isArray(v) ? v : []);
  const log = t => { pushLog(st, turn, t); out.push(t); };

  if (int(r.money)) { st.money += int(r.money); log(`所持金 ${signed(int(r.money))}${e.currency}`); }
  for (const x of arr(r.items)) {
    const name = str(x?.name), d = int(x?.delta);
    if (!name || !d) continue;
    if (d > 0) addItem(st, { name, qty: d, cat: str(x.cat), note: str(x.note) });
    else {
      const it = findItem(st, name) || findItem(st, name, 'home');
      if (!it) continue;
      it.qty += d;
      if (it.qty <= 0) st.items.splice(st.items.indexOf(it), 1);
    }
    log(`${name} ${signed(d)}`);
  }
  for (const x of arr(r.equip)) {
    const slot = str(x?.slot);
    if (!slot) continue;
    if (str(x.name)) { st.equip[slot] = str(x.name); log(`装備 ${slot}: ${str(x.name)}`); } else if (st.equip[slot]) { delete st.equip[slot]; log(`装備 ${slot}: なし`); }
  }
  for (const x of arr(r.skills)) {
    const name = str(x?.name);
    if (!name) continue;
    const s = st.skills.find(k => k.name === name);
    if (s) { if (str(x.level) && s.level !== str(x.level)) { s.level = str(x.level); log(`スキル ${name}: ${s.level}`); } if (str(x.note)) s.note = str(x.note); }
    else { st.skills.push({ name, level: str(x.level), note: str(x.note) }); log(`スキル習得: ${name}${str(x.level) ? `（${str(x.level)}）` : ''}`); }
  }
  for (const x of arr(r.gauges)) {
    const g = st.gauges[str(x?.name)];
    if (!g || !Number.isFinite(Number(x.value))) continue;
    const v = clamp(int(x.value), 0, g.max);
    if (v !== g.v) { g.v = v; out.push(`${str(x.name)} ${v}/${g.max}`); }
  }

  // 生活
  if (int(r.days) > 0) {
    st.day += clamp(int(r.days), 0, 60);
    out.push(`${st.day}日目`);
  }
  for (const x of arr(r.home).slice(0, 1)) {
    if (!str(x?.name)) continue;
    const every = Math.max(0, int(x.every)), rent = Math.max(0, int(x.rent));
    st.home = { name: str(x.name), kind: str(x.kind), rent, every, next: st.day + (every || 0), arrears: false };
    log(`拠点: ${st.home.name}${rent ? `（${fmtMoney(rent, e)}／${every}日）` : ''}`);
  }
  // 家賃・宿代の引き落とし
  for (let guard = 0; st.home?.rent > 0 && st.home.every > 0 && st.day >= st.home.next && guard < 24; guard++) {
    st.money -= st.home.rent;
    st.home.next += st.home.every;
    st.home.arrears = st.money < 0;
    log(`${st.home.kind || '家賃'}の支払い ${signed(-st.home.rent)}${e.currency}（自動）${st.home.arrears ? '・不足' : ''}`);
  }
  for (const x of arr(r.projects)) {
    const name = str(x?.name);
    if (!name) continue;
    const p = st.projects.find(q => q.name === name) || (st.projects.push({ name, progress: 0, note: '' }), st.projects.at(-1));
    const prog = clamp(int(x.progress), 0, 100);
    if (prog !== p.progress) { p.progress = prog; log(`${name} ${prog}%`); }
    if (str(x.note)) p.note = str(x.note);
  }
  for (const x of arr(r.quests)) {
    const title = str(x?.title);
    if (!title) continue;
    const q = st.quests.find(k => k.title === title);
    const next = { title, reward: str(x.reward), deadline: str(x.deadline), state: ['受注', '達成', '失敗'].includes(x.state) ? x.state : '受注' };
    if (!q) { st.quests.push(next); log(`依頼を受けた: ${title}`); }
    else { if (q.state !== next.state) log(`依頼${next.state}: ${title}`); Object.assign(q, { ...next, reward: next.reward || q.reward, deadline: next.deadline || q.deadline }); }
  }
  for (const x of arr(r.move)) {
    const to = x?.to === '拠点' ? 'home' : '', from = to === 'home' ? '' : 'home';
    const it = findItem(st, str(x?.name), from), qty = Math.max(1, int(x?.qty) || 1);
    if (!it) continue;
    const n = Math.min(qty, it.qty);
    it.qty -= n;
    if (it.qty <= 0) st.items.splice(st.items.indexOf(it), 1);
    addItem(st, { ...it, id: undefined, qty: n, at: to });
    log(`${it.name}×${n} → ${to === 'home' ? '拠点' : '持ち物'}`);
  }

  // 探索
  if (str(r.depth) && str(r.depth) !== st.depth) { st.depth = str(r.depth); log(`現在地: ${st.depth}`); }
  for (const x of arr(r.rep)) {
    const f = str(x?.faction), d = int(x?.delta);
    if (!f || !d) continue;
    st.rep[f] = clamp((st.rep[f] || 0) + d, -100, 100);
    log(`評判 ${f} ${signed(d)}（${repLabel(st.rep[f])}）`);
  }
  for (const x of arr(r.identify)) {
    const it = st.items.find(i => i.id === str(x?.id));
    if (!it || !str(x.name)) continue;
    log(`${itemLabel(it, e)} → ${str(x.name)}`);
    it.name = str(x.name); it.named = true;
    if (str(x.note)) it.note = str(x.note);
  }
  for (const t of arr(r.reasons).map(str).filter(Boolean).slice(0, 4)) pushLog(st, turn, `（${t}）`);
  return out;
}

export const snapshot = st => { const c = clone(st); c.prev = null; c.log = []; return c; };
