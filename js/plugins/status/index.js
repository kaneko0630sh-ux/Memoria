// プラグイン: ステータス管理（所持金・持ち物・装備・スキル・ゲージ／生活: 拠点・家賃・建設・依頼・日付／探索: 現在地・戦利品・鑑定・評判）
// - 会話の中の増減は記憶係が読み取る（記憶の呼び出しに相乗り。APIの呼び出しは増えない）
// - 戦利品・鑑定・売却・使用のボタンは、送ったメッセージに増減（ops）を付け、記憶係が確定させたときに反映する。
//   それまでは画面とAIへの文脈に上乗せして見せるので、再生成で二重に引かれず、巻き戻すと元に戻る
// - 運（戦利品の中身・レア度・査定額）はアプリがサイコロで決め、AIはそれを描写する
import { definePlugin, pluginMem, pluginCfg, getPlugin } from '../registry.js';
import { S, curChat, getStory, saveChat, maxTurn } from '../../core/store.js';
import { clone, uid } from '../../core/util.js';
import { emit, on, notify } from '../../core/hooks.js';
import { sendMessage } from '../../engine/chat.js';
import { openSheet, closeSheet, closeAllSheets, setSheetBody, sheetById, sheetOf } from '../../ui/dom.js';
import { PRESET_OPTIONS, effective } from './presets.js';
import * as M from './model.js';
import { libraryOf, findLibItem } from '../../core/items.js';
import { sheetHTML, itemSheetHTML, barHTML, formHTML, cardHTML, noteHTML, shopHTML, craftHTML, lootBlockHTML, appraiseBlockHTML, statusWindowHTML, peekHTML } from './view.js';
import { callLLM } from '../../llm/providers.js';
import { parseJSON } from '../../core/util.js';
import { chatCtx, macros, txt } from '../../core/store.js';

const ID = 'status';
const cfgOf = chat => effective(pluginCfg(getStory(chat.storyId), getPlugin(ID)));

/* ---------- 状態 ---------- */
// 確定済みの状態（記憶と一緒に保存・巻き戻し）
function base(chat, e = cfgOf(chat)) {
  const box = pluginMem(chat, ID);
  if (!box.st) box.st = M.initState(e);
  return M.upgrade(box.st);
}
// 表示とAIへの文脈用: 確定済み ＋ まだ確定していないメッセージの ops
function view(chat, e = cfgOf(chat)) {
  const b = base(chat, e);
  const pend = chat.messages.filter(m => m.id > chat.mem.lastId && m.ops?.[ID]);
  if (!pend.length) return b;
  const v = clone(b);
  for (const m of pend) M.applyOps(v, m.ops[ID], m.turn);
  return v;
}
const changed = chat => { saveChat(chat); emit('plugin:changed', chat); };

// アイテム図鑑の情報（アイコン・説明・レア度・相場）を重ねた持ち物。状態そのものは書き換えない
function enrich(story, it) {
  const l = findLibItem(story, it.name);
  if (!l) return it;
  return { ...it, rar: it.rar || l.item.rar || '', icon: l.item.icon, desc: l.content, named: it.named || !it.unid };
}
// 品物の基本の相場: アイテム図鑑 → 相場表
function marketPrice(chat, name, e = cfgOf(chat)) {
  const l = findLibItem(getStory(chat.storyId), name);
  if (Number(l?.item.price) > 0) return Number(l.item.price);
  return M.parsePrices(e.prices).find(p => p.name === name || p.name.startsWith(name))?.price || 0;
}
// 今いる土地の倍率と、交渉スキルによる売値・買値の率
function priceCtx(chat, e = cfgOf(chat)) {
  const st = view(chat, e);
  return { region: M.regionOf(e, st.depth), rates: M.tradeRates(st) };
}
// 売値: 査定額 or 基本の相場 × 土地の倍率 × 買取率（ふつう半額、交渉スキルで上がる）
const sellOf = (chat, it, e = cfgOf(chat), pc = priceCtx(chat, e)) => M.sellPrice(it, marketPrice(chat, it.name, e), { rate: pc.rates.sell, factor: M.regionFactor(pc.region, it.cat || M.catOf(it.name, M.list(e.cats))) });
// その店での売値: 店が出した買取額（交渉スキルで上がる）→ ふつうの売値
function shopSellPrice(chat, it, shop, e = cfgOf(chat), pc = priceCtx(chat, e)) {
  const offer = view(chat, e).shops[shop || 'この場の店']?.buyback?.[it.name];
  return offer > 0 && !(it.val > 0) ? Math.max(1, Math.round(offer * pc.rates.sell / 0.5)) : sellOf(chat, it, e, pc);
}
const decorated = (chat, st) => { const story = getStory(chat.storyId); return { ...st, items: st.items.map(i => enrich(story, i)) }; };
const dropLib = story => libraryOf(story).filter(l => l.item.drop).map(l => ({ name: l.title, cat: l.item.cat, rar: l.item.rar, price: Number(l.item.price) || 0 }));

/* ---------- AIに渡す文 ---------- */
function statusText(st, e, { ids = false, turn = 0, recent = '' } = {}) {
  const L = [];
  const g = Object.entries(st.gauges).map(([n, x]) => `${n} ${x.v}/${x.max}`).join('・');
  const lv = e.xp === 'on' ? `｜Lv${st.lv}（次のレベルまで経験値 ${M.needXp(st.lv) - st.xp}）` : '';
  L.push(`所持金 ${M.fmtMoney(st.money, e)}${g ? `｜${g}` : ''}${lv}${e.life === 'on' ? `｜${st.day}日目（${M.weekday(st.day)}）` : ''}`);
  if (e.xp === 'on' && st.lvup && st.lvup.turn >= turn - 1) L.push(`直前にレベルアップした（Lv${st.lvup.from} → Lv${st.lvup.to}）`);
  const eq = Object.entries(st.equip).map(([k, v]) => `${k}=${v}`).join('、');
  if (eq) L.push(`装備: ${eq}`);
  const carried = st.items.filter(i => i.at !== 'home');
  const label = i => M.itemLabel(i, e);
  if (carried.length) {
    const shown = carried.slice(0, ids ? 60 : 24).map(i => `${ids ? `[${i.id}] ` : ''}${label(i)}×${i.qty}`);
    L.push(`持ち物: ${shown.join('、')}${carried.length > shown.length ? `、ほか${carried.length - shown.length}種` : ''}`);
  } else L.push('持ち物: なし');
  if (st.skills.length) L.push(`スキル: ${st.skills.map(k => k.level ? `${k.name}（${k.level}）` : k.name).join('、')}`);
  const stats = Object.entries(st.stats || {});
  if (stats.length) L.push(`能力値: ${stats.map(([k, v]) => `${k}${v}`).join('・')}`);
  const ranks = Object.entries(st.ranks || {});
  if (ranks.length || st.titles?.length) L.push(`${ranks.map(([k, v]) => `${k}: ${v}`).join('、')}${st.titles?.length ? `${ranks.length ? '｜' : ''}称号: ${st.titles.join('、')}` : ''}`);
  if (st.rankup && st.rankup.turn >= turn - 1) L.push(`直前にランクが上がった（${st.rankup.name} ${st.rankup.from || '—'} → ${st.rankup.to}）`);
  if (st.party?.length) L.push(`仲間: ${st.party.map(m => `${m.name}${m.role ? `（${m.role}）` : ''} Lv${m.lv || 1} HP ${m.hp.v}/${m.hp.max}${m.good ? `・得意: ${m.good}` : ''}${m.equip ? `・${m.equip}` : ''}`).join('、')}`);
  // 前に鑑定した相手が最近の会話に出ていれば、その時の結果（同じ強さで描くため）
  const seen = Object.entries(st.dossier || {}).filter(([n]) => recent.includes(n)).slice(0, 3);
  for (const [n, d] of seen) L.push(`前に鑑定した${n}: ${d.lines.filter(l => !/^名前\s*[:：]/.test(l)).join('／')}`);
  if (e.life === 'on') {
    if (st.recurring?.length) L.push(`定期の収支: ${st.recurring.map(r => `${r.name} ${M.signed(r.amount)}${e.currency}／${r.every}日（次 ${r.next}日目）`).join('、')}`);
    const waiting = (st.timers || []).filter(t => !t.done);
    if (waiting.length) L.push(`育成中・待ち: ${waiting.map(t => `${t.name}（あと${Math.max(0, t.start + t.days - st.day)}日）`).join('、')}`);
    const h = st.home;
    if (h) L.push(`拠点: ${h.name}${h.kind ? `〔${h.kind}〕` : ''}${h.rent ? `（${M.fmtMoney(h.rent, e)}／${h.every}日・次の支払い ${h.next}日目${h.arrears ? '・支払い不足' : ''}）` : ''}`);
    const stored = st.items.filter(i => i.at === 'home');
    if (stored.length) L.push(`拠点の保管: ${stored.slice(0, 12).map(i => `${i.name}×${i.qty}`).join('、')}${stored.length > 12 ? ' ほか' : ''}`);
    if (st.projects.length) L.push(`建設: ${st.projects.map(p => `${p.name} ${p.progress}%`).join('、')}`);
    const qs = st.quests.filter(q => q.state === '受注');
    if (qs.length) L.push(`受注中の依頼: ${qs.map(q => `${q.title}${q.reward ? `（報酬 ${q.reward}` : '（'}${q.deadline ? `・期限 ${q.deadline}` : ''}）`).join('、')}`);
  }
  if (e.explore === 'on') {
    const c = M.carryOf(st, e);
    L.push(`現在地: ${st.depth || '未設定'}（危険度 ${M.dangerLabel(M.depthLevel(st.depth))}）${c ? `｜積載 ${c.used}/${c.max}${c.used > c.max ? '（重量オーバーで動きが鈍い）' : ''}` : ''}`);
    const rep = Object.entries(st.rep);
    if (rep.length) L.push(`評判: ${rep.map(([f, v]) => `${f}=${M.repLabel(v)}`).join('、')}`);
  } else if (String(e.regions).trim()) L.push(`現在地: ${st.depth || '未設定'}`);
  const region = M.regionOf(e, st.depth);
  if (region) L.push(`この土地（${region.name}）の相場: ${M.regionText(region) || '普通'}`);
  if (ids) {
    const unnamed = st.items.filter(M.needsName);
    if (unnamed.length) L.push(`名前未定の品: ${unnamed.map(i => `[${i.id}] ${label(i)}`).join('、')}`);
  }
  return L.join('\n');
}

function keeperPrompt(chat, ctx, cfg) {
  const e = effective(cfg), life = e.life === 'on', exp = e.explore === 'on';
  return `{{user}}の所持金・持ち物・装備・状態の記録係も兼ねる。new_log で実際に起きた変化だけを、このキーで出力する（推測しない。変化がなければ空にする）。
- 🎁 🔍 💰 🧪 🛒 🔨 で始まる行の増減は、アプリが反映済み。出力しない（ただし、そこで手に入った「名前未定の品」の正体が本文で描かれたら identify で名前を付ける）
- money: 所持金の増減（支払いは負、収入は正。なければ0）
- items: 持ち物の増減（name、delta。新しく手に入れた物には cat: ${M.list(e.cats).join('／')} のどれか、と短い note）
- equip: 装備の付け替え（slot: ${M.list(e.slots).join('／')}。外したら name を空に）
- skills: 新しく覚えた・成長したスキル（name、level、note）
- gauges: 値が変わったゲージの新しい値（${Object.keys(base(chat, e).gauges).join('、') || 'なし'}）${life ? `
- days: 経過した日数（翌朝なら1。なければ0）
- home: 住む場所・泊まる場所が変わったときだけ1件（name、kind: 宿／借家／自宅 など、rent: 支払い額、every: 何日ごと。家を買った・建てたなら rent は0）
- projects: 建設・増築・改装・開墾の進み具合（name、progress: 0〜100 の現在値、note、per_day: 職人に任せたなど毎日ひとりでに進むなら1日の進み%（なければ0））
- quests: 依頼の受注・達成・失敗（title、reward、deadline、state: 受注／達成／失敗）。報酬の受け取りは money で
- move: 持ち物を拠点に置いた（to: 拠点）・拠点から持ち出した（to: 持ち物）
- recurring: 定期の収入・支出が始まった・変わった・終わったとき（name: 例 宿屋の給金／店の売上／畑の賃料／借金の返済、amount: 1回の額（収入は正・支出は負）、every: 何日ごと、vary: ぶれ幅%（売上なら20〜50、給金なら0）、stop: 終わったら true）。家賃は home で
- timers: 植えた・仕込んだ・注文したなど、何日か後にできあがる物（name: 例 小麦畑、days: 何日後、yield_name: できる物、yield_qty: だいたいの量、cat）。できあがりはアプリが日付で処理する` : ''}${exp || String(e.regions).trim() ? `
- depth: 現在地が変わったときだけ、新しい場所（例: 下層B4、王都の市場、辺境の村）。変わらなければ空` : ''}${exp ? `
- rep: 勢力の評判の増減（faction: ${M.list(e.factions).join('／') || '本文に出た勢力'}、delta: -30〜30）` : ''}
- party: 仲間（{{user}}と行動を共にする人物）の加入・離脱・変化（name、status: 加入／離脱／更新、role: 役割、lv: 物語でレベルが明かされたら（なければ0。ふだんの成長はアプリが行う）、good: 得意なこと（例: 弓, 索敵, 料理。分かったときだけ）、hp: 今のHP（分からなければ-1）、hpmax（分からなければ0）、equip: 装備の要約、note）${Object.keys(base(chat, e).stats || {}).length ? `
- stats: {{user}}の能力値が物語の中で変わったとき（name、value。${Object.keys(base(chat, e).stats).join('、')}）。レベルアップでの伸びはアプリが行うので書かない` : ''}${String(e.ranks).trim() ? `
- ranks: ランクが上がった・変わったとき（name、value。例: 冒険者ランク / E）
- titles: 新しく得た称号` : ''}${e.xp === 'on' ? `
- xp: 今回得た経験値（敵を倒した 15〜50、依頼を達成した 30〜120、危機を切り抜けた・大きな発見 10〜40、なければ0。大げさに付けない）` : ''}
- identify: 「名前未定の品」の正体が本文で描かれたら、その id と、本文で付いた名前 name、短い note
- reasons: 変化の理由を短く（例: 宿代を払った）

現在の記録:
${statusText(decorated(chat, view(chat, e)), e, { ids: true })}${libNames(chat)}`;
}
function libNames(chat) {
  const lib = libraryOf(getStory(chat.storyId));
  return lib.length ? `\nアイテム図鑑の品（手に入れたら、この名前で items に記録する）:${lib.slice(0, 50).map(l => l.title + (l.item.cat ? `（${l.item.cat}）` : '')).join('、')}` : '';
}

function keeperSchema(cfg) {
  const e = effective(cfg), s = { type: 'string' }, i = { type: 'integer' };
  const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const arr = items => ({ type: 'array', items });
  const props = {
    money: i,
    items: arr(obj({ name: s, delta: i, cat: s, note: s })),
    equip: arr(obj({ slot: s, name: s })),
    skills: arr(obj({ name: s, level: s, note: s })),
    gauges: arr(obj({ name: s, value: i })),
  };
  if (e.life === 'on') Object.assign(props, {
    days: i,
    home: arr(obj({ name: s, kind: s, rent: i, every: i })),
    projects: arr(obj({ name: s, progress: i, note: s, per_day: i })),
    quests: arr(obj({ title: s, reward: s, deadline: s, state: { type: 'string', enum: ['受注', '達成', '失敗'] } })),
    move: arr(obj({ name: s, qty: i, to: { type: 'string', enum: ['拠点', '持ち物'] } })),
    recurring: arr(obj({ name: s, amount: i, every: i, vary: i, stop: { type: 'boolean' } })),
    timers: arr(obj({ name: s, days: i, yield_name: s, yield_qty: i, cat: s })),
  });
  if (e.explore === 'on' || String(e.regions).trim()) props.depth = s;
  if (e.explore === 'on') props.rep = arr(obj({ faction: s, delta: i }));
  props.party = arr(obj({ name: s, status: { type: 'string', enum: ['加入', '離脱', '更新'] }, role: s, lv: i, good: s, hp: i, hpmax: i, equip: s, note: s }));
  if (M.parseStats(e.stats) && Object.keys(M.parseStats(e.stats)).length) props.stats = arr(obj({ name: s, value: i }));
  if (String(e.ranks).trim()) Object.assign(props, { ranks: arr(obj({ name: s, value: s })), titles: arr(s) });
  if (e.xp === 'on') props.xp = i;
  props.identify = arr(obj({ id: s, name: s, note: s }));
  props.reasons = arr(s);
  return obj(props);
}

/* ---------- 手での編集フォーム ---------- */
const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const FORMS = {
  recurring: {
    title: '定期の収入・支出',
    fields: (st, e, id) => { const r = st.recurring.find(x => x.id === id) || {}; return [
      { name: 'name', label: '名前（例: 宿屋の給金、店の売上、家賃収入、借金の返済）', value: r.name },
      { name: 'amount', label: `1回の額（${e.currency}。支出はマイナス）`, type: 'number', value: r.amount ?? '' },
      { name: 'every', label: '何日ごと', type: 'number', value: r.every ?? 7 },
      { name: 'vary', label: 'ぶれ幅（%。売上なら20〜50、給金なら0）', type: 'number', value: r.vary ?? 0 },
    ]; },
    save: (st, v, id) => {
      if (!v.name.trim() || !num(v.amount)) return '';
      const i = st.recurring.findIndex(x => x.id === id), every = Math.max(1, num(v.every));
      const r = { id: i >= 0 ? st.recurring[i].id : uid(), name: v.name.trim(), amount: num(v.amount), every, vary: Math.max(0, Math.min(80, num(v.vary))), next: i >= 0 ? st.recurring[i].next : st.day + every };
      if (i >= 0) st.recurring[i] = r; else st.recurring.push(r);
      return `定期の収支: ${r.name}`;
    },
    remove: (st, id) => { const i = st.recurring.findIndex(x => x.id === id); return i >= 0 ? `定期の収支を終了: ${st.recurring.splice(i, 1)[0].name}` : ''; },
  },
  timer: {
    title: '育てる物・待つ物',
    fields: (st, e, id) => { const t = st.timers.find(x => x.id === id) || {}; return [
      { name: 'name', label: '名前（例: 小麦畑、仕込んだ酒、注文した剣）', value: t.name },
      { name: 'days', label: '何日でできる', type: 'number', value: t.days ?? 7 },
      { name: 'yieldName', label: 'できる物（任意）', value: t.yieldName },
      { name: 'yieldQty', label: 'だいたいの量', type: 'number', value: t.yieldQty ?? 1 },
    ]; },
    save: (st, v, id) => {
      if (!v.name.trim()) return '';
      const i = st.timers.findIndex(x => x.id === id);
      const t = { id: i >= 0 ? st.timers[i].id : uid(), name: v.name.trim(), days: Math.max(1, num(v.days)), start: i >= 0 ? st.timers[i].start : st.day, yieldName: v.yieldName.trim(), yieldQty: Math.max(0, num(v.yieldQty)), cat: i >= 0 ? st.timers[i].cat : '', done: false };
      if (i >= 0) st.timers[i] = t; else st.timers.push(t);
      return `⏳ ${t.name}（${t.days}日）`;
    },
    remove: (st, id) => { const i = st.timers.findIndex(x => x.id === id); return i >= 0 ? `取りやめ: ${st.timers.splice(i, 1)[0].name}` : ''; },
  },
  member: {
    title: '仲間',
    fields: (st, e, id) => { const m = st.party.find(x => x.id === id) || {}; return [
      { name: 'name', label: '名前', value: m.name }, { name: 'role', label: '役割（例: 弓使い、回復役）', value: m.role },
      { name: 'lv', label: 'レベル', type: 'number', value: m.lv ?? 1 }, { name: 'good', label: '得意なこと（例: 弓, 索敵。判定の補正になる）', value: m.good },
      { name: 'hp', label: 'HP', type: 'number', value: m.hp?.v ?? 30 }, { name: 'hpmax', label: 'HPの最大', type: 'number', value: m.hp?.max ?? 30 },
      { name: 'equip', label: '装備（例: 長弓・革鎧）', value: m.equip }, { name: 'note', label: 'メモ', value: m.note },
    ]; },
    save: (st, v, id) => {
      if (!v.name.trim()) return '';
      const i = st.party.findIndex(x => x.id === id), max = Math.max(1, num(v.hpmax));
      const m = M.newMember({ id: i >= 0 ? st.party[i].id : uid(), name: v.name.trim(), role: v.role.trim(), lv: Math.max(1, num(v.lv)), xp: i >= 0 ? st.party[i].xp || 0 : 0, good: v.good.trim(), hp: { v: Math.max(0, Math.min(max, num(v.hp))), max }, equip: v.equip.trim(), note: v.note.trim() });
      if (i >= 0) st.party[i] = m; else st.party.push(m);
      return `仲間: ${m.name}`;
    },
    remove: (st, id) => { const i = st.party.findIndex(x => x.id === id); return i >= 0 ? `仲間が離脱: ${st.party.splice(i, 1)[0].name}` : ''; },
  },
  stats: {
    title: '能力値',
    fields: st => [{ name: 'stats', label: '能力値（名前:値、カンマ区切り）', value: Object.entries(st.stats).map(([k, v]) => `${k}:${v}`).join(', ') }],
    save: (st, v) => { st.stats = M.parseStats(v.stats); return '能力値を編集'; },
  },
  ranks: {
    title: 'ランク・称号',
    fields: st => [
      { name: 'ranks', label: 'ランク（1行に1つ。名前: 値）', type: 'textarea', value: Object.entries(st.ranks).map(([k, v]) => `${k}: ${v}`).join('\n') },
      { name: 'titles', label: '称号（カンマ区切り）', value: st.titles.join(', ') },
    ],
    save: (st, v) => { st.ranks = Object.fromEntries(M.parsePairs(v.ranks).filter(([k]) => k)); st.titles = M.list(v.titles); return 'ランク・称号を編集'; },
  },
  level: {
    title: 'レベルと経験値',
    fields: st => [{ name: 'lv', label: 'レベル', type: 'number', value: st.lv }, { name: 'xp', label: '経験値（今のレベルの中で）', type: 'number', value: st.xp }],
    save: (st, v) => { st.lv = Math.max(1, num(v.lv)); st.xp = Math.max(0, num(v.xp)); return `Lv${st.lv}・経験値 ${st.xp}`; },
  },
  money: {
    title: '所持金',
    fields: (st, e) => [{ name: 'money', label: `所持金（${e.currency}）`, type: 'number', value: st.money }],
    save: (st, v) => { st.money = num(v.money); return `所持金を ${st.money} に` },
  },
  item: {
    title: '持ち物',
    fields: (st, e, id) => { const it = st.items.find(i => i.id === id) || {}; return [
      { name: 'name', label: '名前', value: it.name }, { name: 'qty', label: '個数', type: 'number', value: it.qty ?? 1 },
      { name: 'cat', label: '種類', type: 'select', value: it.cat ?? M.list(e.cats)[0], options: [...new Set([...M.list(e.cats), it.cat || ''])].map(c => [c, c || 'その他']) },
      { name: 'note', label: 'メモ', value: it.note }, { name: 'val', label: `査定額（${e.currency}・空欄で売値なし）`, type: 'number', value: it.val ?? '' },
    ]; },
    save: (st, v, id) => {
      if (!v.name.trim()) return '';
      const it = st.items.find(i => i.id === id);
      const patch = { name: v.name.trim(), qty: Math.max(1, num(v.qty)), cat: v.cat, note: v.note.trim(), ...(v.val !== '' ? { val: Math.max(0, num(v.val)) } : {}) };
      if (it) { Object.assign(it, patch); if (v.val === '') delete it.val; if (it.rar && patch.name !== it.name) it.named = true; }
      else M.applyOps(st, [{ op: 'add', item: patch }]);
      return `持ち物: ${patch.name}×${patch.qty}`;
    },
    remove: (st, id) => { const i = st.items.findIndex(x => x.id === id); if (i >= 0) return `持ち物を削除: ${st.items.splice(i, 1)[0].name}`; },
  },
  slot: {
    title: '装備',
    fields: (st, e, id) => [{ name: 'name', label: `${id}（空欄で外す）`, value: st.equip[id] || '' }],
    save: (st, v, id) => { if (v.name.trim()) st.equip[id] = v.name.trim(); else delete st.equip[id]; return `装備 ${id}: ${v.name.trim() || 'なし'}`; },
  },
  skill: {
    title: 'スキル',
    fields: (st, e, id) => { const k = st.skills[id] || {}; return [{ name: 'name', label: '名前', value: k.name }, { name: 'level', label: 'ランク・レベル', value: k.level }, { name: 'note', label: '説明', value: k.note }]; },
    save: (st, v, id) => {
      if (!v.name.trim()) return '';
      const k = { name: v.name.trim(), level: v.level.trim(), note: v.note.trim() };
      if (st.skills[id]) st.skills[id] = k; else st.skills.push(k);
      return `スキル: ${k.name}`;
    },
    remove: (st, id) => (st.skills[id] ? `スキルを削除: ${st.skills.splice(id, 1)[0].name}` : ''),
  },
  gauges: {
    title: 'ゲージ',
    fields: st => [{ name: 'g', label: 'ゲージ（名前:今/最大、カンマ区切り）', value: Object.entries(st.gauges).map(([n, x]) => `${n}:${x.v}/${x.max}`).join(', ') }],
    save: (st, v) => { st.gauges = M.parseGauges(v.g); return 'ゲージを編集'; },
  },
  depth: {
    title: '現在地',
    fields: st => [{ name: 'depth', label: '現在地（例: 下層B4。数字が大きいほど危険で実入りがよい）', value: st.depth }],
    save: (st, v) => { st.depth = v.depth.trim(); return `現在地: ${st.depth}`; },
  },
  home: {
    title: '拠点',
    fields: st => { const h = st.home || {}; return [
      { name: 'name', label: '名前（空欄で拠点なし）', value: h.name }, { name: 'kind', label: '種類（宿・借家・自宅など）', value: h.kind },
      { name: 'rent', label: '支払い額（0で支払いなし）', type: 'number', value: h.rent ?? 0 }, { name: 'every', label: '何日ごと', type: 'number', value: h.every ?? 30 },
      { name: 'next', label: '次の支払い日（◯日目）', type: 'number', value: h.next ?? st.day + 30 },
    ]; },
    save: (st, v) => {
      if (!v.name.trim()) { st.home = null; return '拠点なし'; }
      st.home = { name: v.name.trim(), kind: v.kind.trim(), rent: Math.max(0, num(v.rent)), every: Math.max(0, num(v.every)), next: num(v.next) || st.day, arrears: false };
      return `拠点: ${st.home.name}`;
    },
  },
  project: {
    title: '建設・増築',
    fields: (st, e, id) => { const p = st.projects[id] || {}; return [{ name: 'name', label: '名前', value: p.name }, { name: 'progress', label: '進み具合（%）', type: 'number', value: p.progress ?? 0 }, { name: 'note', label: 'メモ（必要な資材・費用など）', value: p.note }]; },
    save: (st, v, id) => {
      if (!v.name.trim()) return '';
      const p = { name: v.name.trim(), progress: Math.max(0, Math.min(100, num(v.progress))), note: v.note.trim() };
      if (st.projects[id]) st.projects[id] = p; else st.projects.push(p);
      return `建設: ${p.name} ${p.progress}%`;
    },
    remove: (st, id) => (st.projects[id] ? `建設を削除: ${st.projects.splice(id, 1)[0].name}` : ''),
  },
  quest: {
    title: '依頼',
    fields: (st, e, id) => { const q = st.quests[id] || {}; return [
      { name: 'title', label: '依頼名', value: q.title }, { name: 'reward', label: '報酬', value: q.reward }, { name: 'deadline', label: '期限', value: q.deadline },
      { name: 'state', label: '状態', type: 'select', value: q.state || '受注', options: [['受注', '受注'], ['達成', '達成'], ['失敗', '失敗']] },
    ]; },
    save: (st, v, id) => {
      if (!v.title.trim()) return '';
      const q = { title: v.title.trim(), reward: v.reward.trim(), deadline: v.deadline.trim(), state: v.state };
      if (st.quests[id]) st.quests[id] = q; else st.quests.push(q);
      return `依頼: ${q.title}（${q.state}）`;
    },
    remove: (st, id) => (st.quests[id] ? `依頼を削除: ${st.quests.splice(id, 1)[0].title}` : ''),
  },
};

/* ---------- シート ---------- */
function refresh(chat) {
  const e = cfgOf(chat);
  if (sheetById('status')) setSheetBody('status', sheetHTML(decorated(chat, view(chat, e)), e, base(chat, e), S.ui.stTab));
}
on('plugin:changed', chat => { if (curChat() === chat) refresh(chat); });
on('memory:changed', chat => { if (curChat() === chat && sheetById('status')) refresh(chat); });

// 確定済みの状態を手で書き換える（巻き戻しにも乗る）
function edit(chat, fn) {
  const st = base(chat);
  const text = fn(st);
  if (!text) return;
  st.log.push({ turn: chat.messages.at(-1)?.turn || 0, text: `✎ ${text}` });
  changed(chat);
}
// ボタン操作: メッセージに ops を付けて送る（確定は記憶係の処理時）
function act(chat, { ops, text, card }) {
  if (S.gen) return notify('応答の生成中です', '', 1800);
  closeAllSheets();
  sendMessage(chat, text, { ops: { [ID]: ops }, card });
}
const itemOf = (chat, id) => { const it = view(chat).items.find(i => i.id === id); return it && enrich(getStory(chat.storyId), it); };

/* ---------- お店（品ぞろえ: その店でAIが出したもの → アイテム図鑑 → 相場表） ---------- */
const SHOP_SCHEMA = { type: 'object', additionalProperties: false, required: ['items', 'buyback'], properties: {
  items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'price', 'cat', 'rar', 'note'], properties: { name: { type: 'string' }, price: { type: 'integer' }, cat: { type: 'string' }, rar: { type: 'string' }, note: { type: 'string' } } } },
  buyback: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'price'], properties: { name: { type: 'string' }, price: { type: 'integer' } } } },
} };
const shopName = () => (document.getElementById('shopName')?.value ?? S.ui.shop?.name ?? '').trim();
// 買値: AIが出した品ぞろえはその店の値段のまま、図鑑・相場表の品は土地の倍率を掛ける。交渉スキルで少し安くなる
function shopStock(chat, name, e = cfgOf(chat)) {
  const st = view(chat, e), story = getStory(chat.storyId), pc = priceCtx(chat, e);
  const adj = (p, cat, local = false) => Math.max(1, Math.round(p * (local ? 1 : M.regionFactor(pc.region, cat)) * pc.rates.buy));
  const gen = (st.shops[name || 'この場の店']?.items || []).map(x => ({ ...x, price: adj(x.price, x.cat, true) }));
  const lib = libraryOf(story).filter(l => Number(l.item.price) > 0).map(l => ({ name: l.title, price: adj(Number(l.item.price), l.item.cat), cat: l.item.cat, rar: l.item.rar, note: l.content.slice(0, 40), icon: l.item.icon }));
  const table = M.parsePrices(e.prices).map(p => { const cat = p.service ? '' : M.catOf(p.name, M.list(e.cats)); return { name: p.name, price: adj(p.price, cat), service: p.service, cat, rar: '', note: '' }; });
  const seen = new Set();
  return [...gen, ...lib, ...table].filter(x => !seen.has(x.name) && seen.add(x.name));
}
function shopView(chat) {
  const e = cfgOf(chat), st = decorated(chat, view(chat, e)), c = S.ui.shop, pc = priceCtx(chat, e);
  const stock = shopStock(chat, c.name, e);
  const sellables = st.items.filter(i => i.at !== 'home' && !i.unid).map(i => ({ ...i, sellAt: shopSellPrice(chat, i, c.name, e, pc) })).filter(i => i.sellAt);
  const note = [pc.region && `この土地（${pc.region.name}）の相場: ${M.regionText(pc.region) || '普通'}`,
    pc.rates.skill && `${pc.rates.skill}のおかげで、売値は相場の${Math.round(pc.rates.sell * 100)}%・買値は${Math.round(pc.rates.buy * 100)}%`].filter(Boolean).join('／');
  return shopHTML({ c, stock, sellables, money: st.money, e, note, busy: !!S.gen || c.gen, iconOf: n => findLibItem(getStory(chat.storyId), n)?.item.icon || '' });
}
const refreshShop = chat => { if (sheetById('status-shop')) setSheetBody('status-shop', shopView(chat)); };
async function genStock(chat, name) {
  const e = cfgOf(chat), st = view(chat, e), ctx = chatCtx(chat);
  const unpriced = st.items.filter(i => i.at !== 'home' && !i.unid && !sellOf(chat, i, e)).slice(0, 20);
  const content = `店: ${name || 'この場にある店'}
現在の状況:
${chat.mem.state || '（記録なし）'}${st.depth ? `\n現在地: ${st.depth}` : ''}
通貨: ${e.currency}${M.regionOf(e, st.depth) ? `\nこの土地の相場の傾向: ${M.regionText(M.regionOf(e, st.depth)) || '普通'}（相場表の値段にこの倍率を掛ける）` : ''}
持ち物の種類: ${M.list(e.cats).join('、')}
相場表:
${String(e.prices || '（なし）').trim()}

{{user}}の持ち物のうち、値段がまだ決まっていない物:
${unpriced.length ? unpriced.map(i => `${i.name}×${i.qty}`).join('、') : '（なし）'}

items: この店に並んでいる品を6〜10個、この場面と店にふさわしく具体的に挙げる。値段は相場表に合わせる（ない物は相場から自然に決める）。rar は C／U／R／E／L のどれか（ほとんど C・U。R 以上はまれで高価）。cat は持ち物の種類から選ぶ。note は一言の説明。
buyback: 上の「値段がまだ決まっていない物」のうち、この店が買い取る物と1個あたりの買取額（相場のおよそ半額。この店が扱わない物は入れない）。
出力: {"items":[{"name":"...","price":0,"cat":"...","rar":"C","note":"..."}],"buyback":[{"name":"...","price":0}]}`;
  const res = await callLLM({ role: 'mem', kind: 'shop', system: [{ text: macros('あなたはロールプレイの進行補助です。{{user}}が訪れた店の品ぞろえを作ります。出力はJSONのみです。', ctx) }], messages: [{ role: 'user', content: macros(content, ctx) }], maxTokens: 2000, schema: SHOP_SCHEMA, temperature: 0.8 });
  const items = (parseJSON(res.text)?.items || []).filter(x => x?.name && Number(x.price) > 0).slice(0, 12)
    .map(x => ({ name: String(x.name).trim(), price: Math.round(Number(x.price)), cat: String(x.cat || ''), rar: ['C', 'U', 'R', 'E', 'L'].includes(x.rar) ? x.rar : '', note: String(x.note || '').slice(0, 60) }));
  if (!items.length) throw new Error('品ぞろえを作れませんでした');
  const names = new Set(unpriced.map(i => i.name));
  const buyback = Object.fromEntries((parseJSON(res.text)?.buyback || []).filter(x => names.has(String(x?.name).trim()) && Number(x.price) > 0).map(x => [String(x.name).trim(), Math.round(Number(x.price))]));
  const key = name || 'この場の店';
  edit(chat, s => { s.shops[key] = { items, buyback, turn: maxTurn(chat) }; return `お店の品ぞろえ: ${key}（${items.length}品${Object.keys(buyback).length ? `・買取${Object.keys(buyback).length}品` : ''}）`; });
}

/* ---------- クラフト ---------- */
function craftView(chat) {
  const e = cfgOf(chat), st = decorated(chat, view(chat, e));
  return craftHTML({ c: S.ui.craft, items: st.items.filter(i => i.at !== 'home' && !i.unid), skills: st.skills, e, busy: !!S.gen });
}
const keepCraftInputs = () => { const c = S.ui.craft; c.wish = document.getElementById('craftWish')?.value ?? c.wish; c.skill = document.getElementById('craftSkill')?.value ?? c.skill; };

definePlugin({
  id: ID,
  name: 'ステータス管理',
  desc: '所持金・持ち物・装備・スキル・体力などを管理します。生活（拠点・家賃・建設・依頼・日付）と探索（現在地・戦利品・鑑定・評判）も選べます',
  help: '会話の中で起きた売買・入手・消費・負傷などは、記憶係が次の発言のあとに自動で反映します（APIの呼び出しは増えません）。トーク画面の上部か ☰ →「ステータス」で確認・編集できます。探索をオンにすると、戦利品の中身とレア度（手に入れた時点で枠の色で分かります）、鑑定の査定額をアプリがサイコロで決め、鑑定した品の正体と名前はAIが描きます。空欄の項目は、選んだひな型の値になります。',
  defaults: { preset: 'adventurer', bar: 'on' },
  blocks: ['戦利品', '鑑定', '鑑定結果'],

  // AIが物語の中に置く【戦利品】【鑑定】【鑑定結果】。その場にボタンやステータス画面を出す
  renderBlock(b, env) {
    const e = effective(env.cfg), what = b.paras.map(p => p.t).join(' ').trim();
    if (b.speaker === '鑑定結果') return statusWindowHTML(b.paras.map(p => p.t));
    if (b.speaker === '戦利品') {
      const done = env.chat.messages.some(m => m.card?.plugin === ID && m.card.src === env.msg.id);
      return lootBlockHTML({ what, done, active: env.isLast && !S.gen, msgId: env.msg.id });
    }
    const items = env.isLast ? view(env.chat, e).items.filter(i => i.unid) : [];
    return appraiseBlockHTML({ what, items, e, active: env.isLast && !S.gen });
  },
  fields: [
    { key: 'preset', label: 'ひな型', type: 'select', options: PRESET_OPTIONS, rerender: true, hint: '空欄の項目は、ひな型の値を使います（薄く表示されている値）' },
    { key: 'currency', label: '通貨の単位', type: 'text', ph: c => effective(c).currency },
    { key: 'money', label: '最初の所持金', type: 'number', ph: c => String(effective(c).money) },
    { key: 'items', label: '最初の持ち物（1行に1つ。例: 回復薬×2）', type: 'textarea', ph: c => effective(c).items },
    { key: 'equip', label: '最初の装備（1行に1つ。枠: 名前）', type: 'textarea', ph: c => effective(c).equip },
    { key: 'skills', label: '最初のスキル（1行に1つ。名前: ランク）', type: 'textarea', ph: c => effective(c).skills },
    { key: 'gauges', label: 'ゲージ（名前:最大 または 名前:今/最大）', type: 'text', ph: c => effective(c).gauges },
    { key: 'cats', label: '持ち物の種類', type: 'text', ph: c => effective(c).cats },
    { key: 'slots', label: '装備の枠', type: 'text', ph: c => effective(c).slots },
    { key: 'prices', label: '相場表（AIが値段の目安にします）', type: 'textarea', rows: 5, ph: c => effective(c).prices },
    { key: 'life', label: '生活（拠点・家賃・建設・依頼・日付）', type: 'select', options: [['', 'ひな型どおり'], ['on', '使う'], ['off', '使わない']] },
    { key: 'explore', label: '探索（現在地・戦利品・鑑定・評判）', type: 'select', options: [['', 'ひな型どおり'], ['on', '使う'], ['off', '使わない']] },
    { key: 'xp', label: '経験値とレベル', type: 'select', options: [['', 'ひな型どおり'], ['on', '使う'], ['off', '使わない']] },
    { key: 'growthSpeed', label: '成長の速さ', type: 'select', options: [['', 'ひな型どおり（普通）'], ...Object.entries(M.GROWTH).map(([k, g]) => [k, `${g.label}（経験値×${g.xp}・伸び×${g.grow}）`])], hint: '無双したいならチート、じっくり育てたいならゆっくり' },
    { key: 'growth', label: 'レベルアップで伸びるゲージ（名前:+量）', type: 'text', ph: c => effective(c).growth },
    { key: 'stats', label: '能力値（名前:値、カンマ区切り。空なら使わない）', type: 'text', ph: c => effective(c).stats || '例: 筋力:8,敏捷:10,魔力:12' },
    { key: 'statGrowth', label: 'レベルアップで伸びる能力値（名前:+量）', type: 'text', ph: c => effective(c).statGrowth || '例: 筋力:+1,魔力:+2' },
    { key: 'ranks', label: 'ランク（1行に1つ。名前: 値）', type: 'textarea', rows: 2, ph: c => effective(c).ranks || '例: 冒険者ランク: F' },
    { key: 'regions', label: '地域ごとの相場（1行に1つ。地名: 種類=倍率）', type: 'textarea', rows: 3, ph: c => effective(c).regions || '例: 王都: 装備品=1.3, 素材=1.2\n辺境の村: 素材=0.6' },
    { key: 'party', label: '最初の仲間（1行に1つ。名前: 役割）', type: 'textarea', rows: 2, ph: c => effective(c).party || '例: エルナ: 弓使い' },
    { key: 'factions', label: '勢力（評判を記録）', type: 'text', ph: c => effective(c).factions },
    { key: 'carry', label: '積載の上限（0で使わない）', type: 'number', ph: c => String(effective(c).carry) },
    { key: 'weights', label: '種類ごとの重さ（種類:重さ）', type: 'text', ph: c => effective(c).weights },
    { key: 'relic', label: '未鑑定品の呼び名', type: 'text', ph: c => effective(c).relic },
    { key: 'legend', label: '最高ランクの呼び名', type: 'text', ph: c => effective(c).legend },
    { key: 'materials', label: '戦利品の素材の候補', type: 'text', ph: c => effective(c).materials },
    { key: 'consumables', label: '戦利品の消耗品の候補', type: 'text', ph: c => effective(c).consumables },
    { key: 'bar', label: 'トーク画面の上部に表示', type: 'select', options: [['on', '表示する'], ['off', '表示しない']] },
  ],

  rules(ctx, cfg) {
    const e = effective(cfg);
    return `- <status> は{{user}}の所持金・持ち物・装備・状態の正確な記録。持っていない物は使えず、所持金が足りなければ買えない。装備やゲージの描写は <status> に合わせる。<status> より会話の方が新しい増減はそちらを優先する
- 値段は相場表に従う（ない物は相場から自然に決める）。所持金や個数の計算結果を本文に書かない（アプリが管理する）
- 🎁 🔍 💰 🧪 🛒 🔨 で始まる{{user}}の行は、アプリが確定させた結果（戦利品・鑑定・売却・使用・売買・作成）。覆さずにそのまま描写する。未鑑定の品は正体（何の品か）をまだ明かさないが、【】のランクに見合う気配（光り方・造りの精巧さ・重み）は描いてよい
- 「名前未定」の品（鑑定した遺品・何かは本文で、と書かれた戦利品・名前を決めずに作った物）は、その場とランクにふさわしい具体的な物として描き、名前を付ける
- 🔍 の鑑定結果・🔨 の作成結果は、ランク（と査定額）に見合う出来として描く。🛒 の売買は店の人物とのやり取りとして描く${e.xp === 'on' ? `
- <status> に「直前にレベルアップした」とあれば、成長を実感する一瞬を短く描く（数値は書かない）` : ''}${e.life === 'on' ? `
- 日付が進むときは本文で分かるように描く（翌朝、三日後など）。家賃・宿代の支払い、定期の収入・支出（給金・売上など）、建設の進み、育つ物のできあがりはアプリが日付に合わせて処理するので、本文では給金を受け取る・売上を数える・収穫するといった場面として描き、金額や量の計算はしない` : ''}
- <status> の仲間は{{user}}と行動を共にする人物。仲間の行動・HP・装備の描写を <status> に合わせ、レベルと得意なことに見合った活躍をさせる${Object.keys(M.parseStats(e.stats)).length || /鑑定/.test(e.skills) ? `
- {{user}}が人物や魔物を鑑定したら（👁 の行や、鑑定する描写）、応答の中に【鑑定結果】ブロックを置き、対象の「名前・種族・レベル・HP・主な能力値・スキル・状態」を1行に1つ「項目: 値」で書く。{{user}}の鑑定スキルが低いうちは一部を「？？？」にしてよい。<status> に「前に鑑定した〇〇」があれば、その強さと矛盾させない（その後の成長や負傷は描いてよい）` : ''}${String(e.ranks).trim() ? `
- ランクや称号が上がったら（<status> に「直前にランクが上がった」）、周りの反応を短く描く` : ''}${String(e.regions).trim() ? `
- 町や地域によって物の値段は違う。<status> の「この土地の相場」に合わせる` : ''}${e.explore === 'on' ? `
- 深い場所ほど危険で実入りがよい。<status> の危険度に合わせる。⚠ の気配が出たら、危険（敵・罠・崩落など）を登場させる
- 宝箱を開ける・倒した敵を調べる・瓦礫や遺構を漁るなど、何かを拾える瞬間には、応答の最後に【戦利品】ブロックを置いてそこで止める。中身は1行目に「何を調べるか」（例: 倒した機械兵の残骸）だけを書き、手に入る物は書かない（アプリが決める）。毎回は出さない
- {{user}}が鑑定屋などに品物の鑑定を頼んだら、応答の最後に【鑑定】ブロックを置く。1行目に鑑定する人や場所を書き、結果は書かない（アプリが決める）` : ''}${String(e.prices).trim() ? `
## 相場表
${String(e.prices).trim()}` : ''}`;
  },

  context: (ctx, chat, cfg) => `<status>\n${statusText(decorated(chat, view(chat, effective(cfg))), effective(cfg), { turn: maxTurn(chat), recent: chat.messages.slice(-6).map(txt).join('\n') })}\n</status>`,

  memory: {
    key: 'status',
    prompt: keeperPrompt,
    schema: keeperSchema,
    apply(chat, r, cfg, batch) {
      const e = effective(cfg), st = base(chat, e);
      for (const m of batch) if (m.ops?.[ID]) M.applyOps(st, m.ops[ID], m.turn);
      const before = M.snapshot(st);
      const notes = M.applyKeeper(st, r, e, batch.at(-1).turn);
      // AIが書いた【鑑定結果】は相手ごとに覚えておく（次に会ったときも同じ強さで描く）
      for (const m of batch) if (m.role === 'ai') for (const a of M.extractAppraisals(txt(m))) st.dossier[a.name] = { lines: a.lines, turn: m.turn };
      // 読み取った変化は、そのやり取りのAIの応答の下にカードで添える
      const reply = batch.filter(m => m.role === 'ai').at(-1);
      const lvup = st.lvup?.turn === batch.at(-1).turn ? st.lvup : null, rankup = st.rankup?.turn === batch.at(-1).turn ? st.rankup : null;
      if (reply) { reply.pnote ||= {}; if (notes.length) reply.pnote[ID] = { notes, lvup, rankup }; else delete reply.pnote[ID]; }
      if (notes.length) st.prev = before;
      emit('plugin:changed', chat);
      return notes.length ? `🎒 ${notes.slice(0, 4).join('・')}${notes.length > 4 ? ' …' : ''}` : '';
    },
  },

  // ダイスプラグインの判定に、スキル・レベル・装備・負傷の補正を出す
  // 難易度「無双」では上限なし（能力値もスキルもそのまま効く）
  diceMods: (chat, what, skill, sides, cfg) => M.diceMods(view(chat, effective(cfg)), what, skill, sides, effective(cfg), { uncapped: getStory(chat.storyId)?.style?.difficulty === 'muso' }),
  renderCard: (card, env, cfg) => cardHTML(card, effective(cfg), env, name => findLibItem(env.ctx?.story, name)?.item.icon || ''),
  renderNote: (note, env, cfg) => noteHTML(note, effective(cfg)),
  bar: (chat, cfg) => (cfg.bar === 'off' ? '' : barHTML(view(chat, effective(cfg)), effective(cfg))),
  menu: (chat, cfg) => [{ label: 'ステータス', val: M.fmtMoney(view(chat, effective(cfg)).money, effective(cfg)), act: `p:${ID}:open` }],

  actions: {
    open() {
      const chat = curChat();
      if (!chat) return;
      closeAllSheets();
      const e = cfgOf(chat);
      openSheet({ id: 'status', title: 'ステータス', full: true, html: sheetHTML(decorated(chat, view(chat, e)), e, base(chat, e), S.ui.stTab) });
    },
    tab(el) { S.ui.stTab = el.dataset.tab; refresh(curChat()); },
    item(el) {
      const chat = curChat(), it = itemOf(chat, el.dataset.id);
      if (!it) return;
      const e = cfgOf(chat);
      openSheet({ id: 'status-item', title: '持ち物', html: itemSheetHTML(it, e, { inBase: base(chat, e).items.some(i => i.id === it.id), life: e.life === 'on', busy: !!S.gen, sellAt: it.unid ? null : sellOf(chat, it) }) });
    },
    // お店
    shop() {
      const chat = curChat();
      if (!chat) return;
      S.ui.shop = { name: S.ui.shop?.name || '', buy: {}, sell: {}, gen: false };
      openSheet({ id: 'status-shop', title: 'お店', full: true, html: shopView(chat) });
    },
    shopQty(el) {
      const c = S.ui.shop, cart = c[el.dataset.kind], k = el.dataset.key;
      c.name = shopName();
      cart[k] = Math.max(0, Math.min(Number(el.dataset.max) || 99, (cart[k] || 0) + Number(el.dataset.d)));
      if (!cart[k]) delete cart[k];
      refreshShop(curChat());
    },
    shopSwitch() { const c = S.ui.shop; c.name = shopName(); c.buy = {}; refreshShop(curChat()); },
    async shopGen() {
      const chat = curChat(), c = S.ui.shop;
      c.name = shopName(); c.gen = true; refreshShop(chat);
      try { await genStock(chat, c.name); } catch (err) { notify('品ぞろえを作れませんでした: ' + err.message, 'err', 5000); }
      c.gen = false; refreshShop(chat);
    },
    shopDeal() {
      const chat = curChat(), c = S.ui.shop, e = cfgOf(chat);
      c.name = shopName();
      const stock = shopStock(chat, c.name, e), st = decorated(chat, view(chat, e));
      const buy = Object.entries(c.buy).map(([k, qty]) => ({ ...stock.find(x => x.name === k), qty })).filter(b => b.name && b.qty);
      const sell = Object.entries(c.sell).map(([id, qty]) => { const it = st.items.find(i => i.id === id); return it && { id, name: it.name, qty, price: shopSellPrice(chat, it, c.name, e) }; }).filter(s => s?.price && s.qty);
      if (!buy.length && !sell.length) return;
      const total = sell.reduce((a, s) => a + s.price * s.qty, 0) - buy.reduce((a, b) => a + b.price * b.qty, 0);
      if (st.money + total < 0) return notify('所持金が足りません', 'warn', 2500);
      act(chat, M.tradeOps({ buy, sell, shop: c.name }, e));
    },
    // クラフト
    craft() {
      const chat = curChat();
      if (!chat) return;
      S.ui.craft = { pick: {}, wish: '', skill: '' };
      openSheet({ id: 'status-craft', title: '作る', full: true, html: craftView(chat) });
    },
    craftQty(el) {
      keepCraftInputs();
      const c = S.ui.craft, k = el.dataset.id;
      c.pick[k] = Math.max(0, Math.min(Number(el.dataset.max) || 99, (c.pick[k] || 0) + Number(el.dataset.d)));
      if (!c.pick[k]) delete c.pick[k];
      setSheetBody('status-craft', craftView(curChat()));
    },
    craftGo() {
      keepCraftInputs();
      const chat = curChat(), c = S.ui.craft, e = cfgOf(chat), st = view(chat, e);
      const picks = Object.entries(c.pick).map(([id, qty]) => ({ id, qty }));
      const r = M.craftRoll(st, picks, c.wish.trim(), st.skills.find(k => k.name === c.skill), e);
      if (r) act(chat, r);
    },
    loot() { const chat = curChat(); act(chat, M.rollLoot(view(chat), cfgOf(chat), dropLib(getStory(chat.storyId)))); },
    // 物語の中の【戦利品】ブロックから
    lootAt(el) {
      const chat = curChat();
      if (!chat) return;
      const r = M.rollLoot(view(chat), cfgOf(chat), dropLib(getStory(chat.storyId)), el.dataset.what || '');
      r.card.src = Number(el.dataset.msg);
      act(chat, r);
    },
    appraise(el) { const chat = curChat(), it = itemOf(chat, el.dataset.id); if (it?.unid) act(chat, M.appraiseOps(view(chat), it, cfgOf(chat))); },
    sell(el) { const chat = curChat(), it = itemOf(chat, el.dataset.id), price = it && sellOf(chat, it); if (price) act(chat, M.sellOps(it, cfgOf(chat), price)); },
    use(el) { const chat = curChat(), it = itemOf(chat, el.dataset.id); if (it) act(chat, M.useOps(it)); },
    qty(el) {
      const chat = curChat(), d = Number(el.dataset.d);
      edit(chat, st => { const it = st.items.find(i => i.id === el.dataset.id); if (!it) return ''; M.applyOps(st, [{ op: 'qty', id: it.id, d }]); return `${it.name} ${M.signed(d)}`; });
      closeSheet(sheetOf(el));
    },
    move(el) {
      const chat = curChat();
      edit(chat, st => { const it = st.items.find(i => i.id === el.dataset.id); if (!it) return ''; it.at = it.at === 'home' ? '' : 'home'; return `${it.name} → ${it.at ? '拠点' : '持ち物'}`; });
      closeSheet(sheetOf(el));
    },
    gauge(el) {
      const chat = curChat();
      edit(chat, st => { const g = st.gauges[el.dataset.name]; if (!g) return ''; g.v = Math.max(0, Math.min(g.max, g.v + Number(el.dataset.d))); return `${el.dataset.name} ${g.v}/${g.max}`; });
    },
    // 日付を進めると、家賃・定期の収支・建設・育つ物も処理される（戻すときは日付だけ）
    day(el) {
      const chat = curChat(), d = Number(el.dataset.d), e = cfgOf(chat);
      edit(chat, st => {
        if (d > 0) return M.advanceDays(st, d, e, chat.messages.at(-1)?.turn || 0).join('・');
        st.day = Math.max(1, st.day + d);
        return `${st.day}日目`;
      });
    },
    // 人物・魔物の鑑定（鑑定スキル）。結果の【鑑定結果】はAIが書く
    peek() { openSheet({ id: 'status-peek', title: '👁 人物・魔物を鑑定', html: peekHTML() }); },
    peekGo(el) {
      const chat = curChat(), target = (sheetOf(el)?.querySelector('#peekTarget')?.value || '').trim();
      if (!chat || !target || S.gen) return;
      closeAllSheets();
      sendMessage(chat, `*👁 ${target}を鑑定した*`);
    },
    rep(el) { edit(curChat(), st => { const f = el.dataset.f; st.rep[f] = Math.max(-100, Math.min(100, (st.rep[f] || 0) + Number(el.dataset.d))); return `評判 ${f}: ${M.repLabel(st.rep[f])}`; }); },
    undo() {
      const chat = curChat(), st = base(chat);
      if (!st.prev) return;
      const log = st.log;
      Object.assign(st, clone(st.prev), { log, prev: null });
      st.log.push({ turn: chat.messages.at(-1)?.turn || 0, text: '↶ 直前の自動反映を取り消しました' });
      changed(chat);
    },
    form(el) {
      const chat = curChat(), F = FORMS[el.dataset.kind];
      if (!chat || !F) return;
      const st = base(chat), e = cfgOf(chat), id = el.dataset.id === 'new' ? 'new' : el.dataset.id ?? '';
      const exists = el.dataset.kind === 'item' ? st.items.some(i => i.id === id) : id !== 'new' && id !== '';
      openSheet({ id: 'status-form', title: F.title, html: formHTML(F.fields(st, e, id), { kind: el.dataset.kind, id, del: !!F.remove && exists }) });
    },
    save(el) {
      const chat = curChat(), F = FORMS[el.dataset.kind], w = sheetOf(el);
      if (!F || !w) return;
      const vals = Object.fromEntries([...w.querySelectorAll('[name]')].map(x => [x.name, x.value]));
      edit(chat, st => F.save(st, vals, el.dataset.id, cfgOf(chat)));
      closeSheet(w);
      closeSheet(sheetById('status-item'));
    },
    forget(el) {
      const chat = curChat(), n = el.dataset.name;
      edit(chat, st => (st.dossier?.[n] ? (delete st.dossier[n], `鑑定の記録を消去: ${n}`) : ''));
    },
    remove(el) {
      const chat = curChat(), F = FORMS[el.dataset.kind];
      if (!F?.remove) return;
      edit(chat, st => F.remove(st, el.dataset.id));
      closeSheet(sheetOf(el));
      closeSheet(sheetById('status-item'));
    },
  },
});
