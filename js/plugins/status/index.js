// プラグイン: ステータス管理（所持金・持ち物・装備・スキル・ゲージ／生活: 拠点・家賃・建設・依頼・日付／探索: 現在地・戦利品・鑑定・評判）
// - 会話の中の増減は記憶係が読み取る（記憶の呼び出しに相乗り。APIの呼び出しは増えない）
// - 戦利品・鑑定・売却・使用のボタンは、送ったメッセージに増減（ops）を付け、記憶係が確定させたときに反映する。
//   それまでは画面とAIへの文脈に上乗せして見せるので、再生成で二重に引かれず、巻き戻すと元に戻る
// - 運（戦利品の中身・レア度・査定額）はアプリがサイコロで決め、AIはそれを描写する
import { definePlugin, pluginMem, pluginCfg, getPlugin } from '../registry.js';
import { S, curChat, getStory, saveChat } from '../../core/store.js';
import { clone } from '../../core/util.js';
import { emit, on, notify } from '../../core/hooks.js';
import { sendMessage } from '../../engine/chat.js';
import { openSheet, closeSheet, closeAllSheets, setSheetBody, sheetById, sheetOf } from '../../ui/dom.js';
import { PRESET_OPTIONS, effective } from './presets.js';
import * as M from './model.js';
import { sheetHTML, itemSheetHTML, barHTML, formHTML, cardHTML, noteHTML } from './view.js';

const ID = 'status';
const cfgOf = chat => effective(pluginCfg(getStory(chat.storyId), getPlugin(ID)));

/* ---------- 状態 ---------- */
// 確定済みの状態（記憶と一緒に保存・巻き戻し）
function base(chat, e = cfgOf(chat)) {
  const box = pluginMem(chat, ID);
  if (!box.st) box.st = M.initState(e);
  return box.st;
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

/* ---------- AIに渡す文 ---------- */
function statusText(st, e, { ids = false } = {}) {
  const L = [];
  const g = Object.entries(st.gauges).map(([n, x]) => `${n} ${x.v}/${x.max}`).join('・');
  L.push(`所持金 ${M.fmtMoney(st.money, e)}${g ? `｜${g}` : ''}${e.life === 'on' ? `｜${st.day}日目（${M.weekday(st.day)}）` : ''}`);
  const eq = Object.entries(st.equip).map(([k, v]) => `${k}=${v}`).join('、');
  if (eq) L.push(`装備: ${eq}`);
  const carried = st.items.filter(i => i.at !== 'home');
  if (carried.length) {
    const shown = carried.slice(0, ids ? 60 : 24).map(i => `${ids ? `[${i.id}] ` : ''}${M.itemLabel(i, e)}${i.unid && !i.name.includes('未鑑定') ? '（未鑑定）' : ''}×${i.qty}`);
    L.push(`持ち物: ${shown.join('、')}${carried.length > shown.length ? `、ほか${carried.length - shown.length}種` : ''}`);
  } else L.push('持ち物: なし');
  if (st.skills.length) L.push(`スキル: ${st.skills.map(k => k.level ? `${k.name}（${k.level}）` : k.name).join('、')}`);
  if (e.life === 'on') {
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
    if (ids) {
      const unnamed = st.items.filter(i => i.rar && !i.unid && !i.named);
      if (unnamed.length) L.push(`鑑定済みで名前未定: ${unnamed.map(i => `[${i.id}] ${M.itemLabel(i, e)}`).join('、')}`);
    }
  }
  return L.join('\n');
}

function keeperPrompt(chat, ctx, cfg) {
  const e = effective(cfg), life = e.life === 'on', exp = e.explore === 'on';
  return `{{user}}の所持金・持ち物・装備・状態の記録係も兼ねる。new_log で実際に起きた変化だけを、このキーで出力する（推測しない。変化がなければ空にする）。
- 🎁 🔍 💰 🧪 で始まる行の増減は、アプリが反映済み。出力しない
- money: 所持金の増減（支払いは負、収入は正。なければ0）
- items: 持ち物の増減（name、delta。新しく手に入れた物には cat: ${M.list(e.cats).join('／')} のどれか、と短い note）
- equip: 装備の付け替え（slot: ${M.list(e.slots).join('／')}。外したら name を空に）
- skills: 新しく覚えた・成長したスキル（name、level、note）
- gauges: 値が変わったゲージの新しい値（${Object.keys(base(chat, e).gauges).join('、') || 'なし'}）${life ? `
- days: 経過した日数（翌朝なら1。なければ0）
- home: 住む場所・泊まる場所が変わったときだけ1件（name、kind: 宿／借家／自宅 など、rent: 支払い額、every: 何日ごと。家を買った・建てたなら rent は0）
- projects: 建設・増築・改装の進み具合（name、progress: 0〜100 の現在値、note）
- quests: 依頼の受注・達成・失敗（title、reward、deadline、state: 受注／達成／失敗）。報酬の受け取りは money で
- move: 持ち物を拠点に置いた（to: 拠点）・拠点から持ち出した（to: 持ち物）` : ''}${exp ? `
- depth: 現在地が変わったときだけ、新しい場所（例: 下層B4、地上の街）。変わらなければ空
- rep: 勢力の評判の増減（faction: ${M.list(e.factions).join('／') || '本文に出た勢力'}、delta: -30〜30）
- identify: 「鑑定済みで名前未定」の品の正体が本文で描かれたら、その id と name、note` : ''}
- reasons: 変化の理由を短く（例: 宿代を払った）

現在の記録:
${statusText(view(chat, e), e, { ids: true })}`;
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
    projects: arr(obj({ name: s, progress: i, note: s })),
    quests: arr(obj({ title: s, reward: s, deadline: s, state: { type: 'string', enum: ['受注', '達成', '失敗'] } })),
    move: arr(obj({ name: s, qty: i, to: { type: 'string', enum: ['拠点', '持ち物'] } })),
  });
  if (e.explore === 'on') Object.assign(props, { depth: s, rep: arr(obj({ faction: s, delta: i })), identify: arr(obj({ id: s, name: s, note: s })) });
  props.reasons = arr(s);
  return obj(props);
}

/* ---------- 手での編集フォーム ---------- */
const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const FORMS = {
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
  if (sheetById('status')) setSheetBody('status', sheetHTML(view(chat, e), e, base(chat, e), S.ui.stTab));
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
const itemOf = (chat, id) => view(chat).items.find(i => i.id === id);

definePlugin({
  id: ID,
  name: 'ステータス管理',
  desc: '所持金・持ち物・装備・スキル・体力などを管理します。生活（拠点・家賃・建設・依頼・日付）と探索（現在地・戦利品・鑑定・評判）も選べます',
  help: '会話の中で起きた売買・入手・消費・負傷などは、記憶係が次の発言のあとに自動で反映します（APIの呼び出しは増えません）。トーク画面の上部か ☰ →「ステータス」で確認・編集できます。探索をオンにすると、戦利品の中身とレア度（手に入れた時点で枠の色で分かります）、鑑定の査定額をアプリがサイコロで決め、鑑定した品の正体と名前はAIが描きます。空欄の項目は、選んだひな型の値になります。',
  defaults: { preset: 'adventurer', bar: 'on' },
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
- 🎁 🔍 💰 🧪 で始まる{{user}}の行は、アプリが確定させた結果（戦利品・鑑定・売却・使用）。覆さずにそのまま描写する。未鑑定の品は正体（何の品か）をまだ明かさないが、【】のランクに見合う気配（光り方・造りの精巧さ・重み）は描いてよい。🔍 の鑑定結果には、そのランクと査定額に見合う正体を具体的に描いて名前を付ける${e.life === 'on' ? `
- 日付が進むときは本文で分かるように描く（翌朝、三日後など）。家賃・宿代の支払いはアプリが自動で行う` : ''}${e.explore === 'on' ? `
- 深い場所ほど危険で実入りがよい。<status> の危険度に合わせる。⚠ の気配が出たら、危険（敵・罠・崩落など）を登場させる` : ''}${String(e.prices).trim() ? `
## 相場表
${String(e.prices).trim()}` : ''}`;
  },

  context: (ctx, chat, cfg) => `<status>\n${statusText(view(chat, effective(cfg)), effective(cfg))}\n</status>`,

  memory: {
    key: 'status',
    prompt: keeperPrompt,
    schema: keeperSchema,
    apply(chat, r, cfg, batch) {
      const e = effective(cfg), st = base(chat, e);
      for (const m of batch) if (m.ops?.[ID]) M.applyOps(st, m.ops[ID], m.turn);
      const before = M.snapshot(st);
      const notes = M.applyKeeper(st, r, e, batch.at(-1).turn);
      // 読み取った変化は、そのやり取りのAIの応答の下にカードで添える
      const reply = batch.filter(m => m.role === 'ai').at(-1);
      if (reply) { reply.pnote ||= {}; if (notes.length) reply.pnote[ID] = { notes }; else delete reply.pnote[ID]; }
      if (notes.length) st.prev = before;
      emit('plugin:changed', chat);
      return notes.length ? `🎒 ${notes.slice(0, 4).join('・')}${notes.length > 4 ? ' …' : ''}` : '';
    },
  },

  renderCard: (card, env, cfg) => cardHTML(card, effective(cfg), env),
  renderNote: (note, env, cfg) => noteHTML(note, effective(cfg)),
  bar: (chat, cfg) => (cfg.bar === 'off' ? '' : barHTML(view(chat, effective(cfg)), effective(cfg))),
  menu: (chat, cfg) => [{ label: 'ステータス', val: M.fmtMoney(view(chat, effective(cfg)).money, effective(cfg)), act: `p:${ID}:open` }],

  actions: {
    open() {
      const chat = curChat();
      if (!chat) return;
      closeAllSheets();
      const e = cfgOf(chat);
      openSheet({ id: 'status', title: 'ステータス', full: true, html: sheetHTML(view(chat, e), e, base(chat, e), S.ui.stTab) });
    },
    tab(el) { S.ui.stTab = el.dataset.tab; refresh(curChat()); },
    item(el) {
      const chat = curChat(), it = itemOf(chat, el.dataset.id);
      if (!it) return;
      const e = cfgOf(chat);
      openSheet({ id: 'status-item', title: '持ち物', html: itemSheetHTML(it, e, { inBase: base(chat, e).items.some(i => i.id === it.id), life: e.life === 'on', busy: !!S.gen }) });
    },
    loot() { const chat = curChat(); act(chat, M.rollLoot(view(chat), cfgOf(chat))); },
    appraise(el) { const chat = curChat(), it = itemOf(chat, el.dataset.id); if (it?.unid) act(chat, M.appraiseOps(view(chat), it, cfgOf(chat))); },
    sell(el) { const chat = curChat(), it = itemOf(chat, el.dataset.id); if (it?.val) act(chat, M.sellOps(it, cfgOf(chat))); },
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
    day(el) { edit(curChat(), st => { st.day = Math.max(1, st.day + Number(el.dataset.d)); return `${st.day}日目`; }); },
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
    remove(el) {
      const chat = curChat(), F = FORMS[el.dataset.kind];
      if (!F?.remove) return;
      edit(chat, st => F.remove(st, el.dataset.id));
      closeSheet(sheetOf(el));
      closeSheet(sheetById('status-item'));
    },
  },
});
