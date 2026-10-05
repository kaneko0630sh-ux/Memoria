// ステータス管理: 画面（☰ →「ステータス」のシートと、トーク上部のバー）
import { esc } from '../../core/util.js';
import { ic } from '../../ui/dom.js';
import { list, fmtMoney, rarLabel, depthLevel, dangerLabel, repLabel, weekday, carryOf, needXp, needsName, signed } from './model.js';

const A = name => `p:status:${name}`;
const btn = (act, label, data = {}, cls = 'btn sm', disabled = false) => `<button class="${cls}" data-act="${A(act)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${disabled ? ' disabled' : ''}>${label}</button>`;
const rarBadge = (it, e) => `${it.rar ? `<span class="rar r-${it.rar}">${esc(rarLabel(it.rar, e))}</span>` : ''}${it.unid ? '<span class="rar r-q">未鑑定</span>' : ''}`;
const RANK = ['C', 'U', 'R', 'E', 'L'];
const iconHTML = (src, cls = 'st-ic') => (src ? `<span class="${cls}"><img src="${esc(src)}" alt=""></span>` : '');
const meter = (v, max, cls = '') => `<div class="st-meter ${cls}"><i style="width:${Math.max(0, Math.min(100, max ? (v / max) * 100 : 0))}%"></i></div>`;

export const TABS = e => [['items', '持ち物'], ['gear', '装備・スキル'], ['state', '状態'], ...(e.life === 'on' ? [['home', '拠点・依頼']] : []), ['log', '履歴']];

export function barHTML(st, e) {
  const g = Object.entries(st.gauges)[0];
  const parts = [`💰 ${esc(fmtMoney(st.money, e))}`];
  if (e.xp === 'on') parts.push(`Lv${st.lv}`);
  if (g) parts.push(`${esc(g[0])} ${g[1].v}/${g[1].max}`);
  if (e.life === 'on') parts.push(`${st.day}日目`);
  if (e.explore === 'on' && st.depth) parts.push(esc(st.depth));
  const c = carryOf(st, e);
  if (c && c.used > c.max) parts.push('<b class="warn">重量オーバー</b>');
  return `<button class="st-bar" data-act="${A('open')}">${parts.join('<i>・</i>')}</button>`;
}

function itemRow(it, e, pending) {
  return `<button class="st-item${it.rar ? ` rf r-${it.rar}` : ''}" data-act="${A('item')}" data-id="${it.id}">${iconHTML(it.icon)}<span class="nm">${esc(it.name)}</span>${rarBadge(it, e)}${needsName(it) && !it.unid ? '<span class="tag">名前未定</span>' : ''}${pending ? '<span class="tag">反映待ち</span>' : ''}<span class="q">×${it.qty}</span></button>`;
}

/* ---------- トーク中のカード（戦利品・鑑定・売却・使用）と、記憶係の記録 ---------- */
function lootTile(f, e, iconOf) {
  if (f.money != null) return `<div class="lt lt-money"><span class="lt-rar">お金</span><b class="lt-name">+${esc(fmtMoney(f.money, e))}</b></div>`;
  const icon = f.unid ? '' : iconOf(f.name);
  return `<div class="lt r-${f.rar || 'N'}${f.unid ? ' unid' : ''}${icon ? ' has-ic' : ''}">${iconHTML(icon, 'lt-ic')}<span class="lt-rar">${f.rar ? esc(rarLabel(f.rar, e)) : esc(f.cat || '')}</span><b class="lt-name">${esc(f.name)}</b><span class="lt-q">×${f.qty}${f.unid ? '・未鑑定' : ''}</span></div>`;
}
// iconOf(name) → アイテム図鑑のアイコン（なければ空）
export function cardHTML(card, e, env = {}, iconOf = () => '') {
  const fresh = env.fresh ? ' fresh' : '';
  if (card.kind === 'loot') {
    const best = RANK[Math.max(-1, ...card.finds.map(f => RANK.indexOf(f.rar)))] || 'N';
    return `<div class="lcard r-${best}${fresh}"><div class="lc-head"><span>🎁 探索の成果</span>${card.depth ? `<small>${esc(card.depth)}</small>` : ''}</div>
      <div class="lc-grid">${card.finds.map(f => lootTile(f, e, iconOf)).join('')}</div>${card.danger ? '<div class="lc-danger">⚠ 近くで何かが動く気配がした</div>' : ''}</div>`;
  }
  if (card.kind === 'appraise') {
    return `<div class="lcard appraise r-${card.rar}${fresh}"><div class="lc-head"><span>🔍 鑑定結果</span></div>
      <div class="ap-body"><div class="ap-rar">${esc(rarLabel(card.rar, e))}</div><div class="ap-name">${esc(card.name)}</div><div class="ap-val">査定額 <b>${esc(fmtMoney(card.val, e))}</b></div></div></div>`;
  }
  if (card.kind === 'sell') return `<div class="lcard mini${card.rar ? ` r-${card.rar}` : ''}${fresh}"><span class="mi-h">💰 売却</span>${iconHTML(iconOf(card.name), 'mi-ic')}<b class="mi-name">${esc(card.name)}</b><span class="mi-plus">+${esc(fmtMoney(card.val, e))}</span></div>`;
  if (card.kind === 'use') return `<div class="lcard mini${card.rar ? ` r-${card.rar}` : ''}${fresh}"><span class="mi-h">🧪 使用</span>${iconHTML(iconOf(card.name), 'mi-ic')}<b class="mi-name">${esc(card.name)}</b></div>`;
  if (card.kind === 'trade') {
    const row = (x, sign) => `<div class="tr-row${x.rar ? ` r-${x.rar}` : ''}">${iconHTML(iconOf(x.name), 'mi-ic')}<span class="tr-nm">${esc(x.name)}${x.qty > 1 ? ` ×${x.qty}` : ''}${x.service ? ' <small>サービス</small>' : ''}</span><span class="tr-p ${sign > 0 ? 'plus' : ''}">${sign > 0 ? '+' : '−'}${esc(fmtMoney(x.price * x.qty, e))}</span></div>`;
    return `<div class="lcard trade${fresh}"><div class="lc-head"><span>🛒 ${card.shop ? esc(card.shop) : 'お店'}での取引</span></div>
      ${card.buy.map(x => row(x, -1)).join('')}${card.sell.map(x => row(x, 1)).join('')}
      <div class="tr-total"><span>差し引き</span><b class="${card.total >= 0 ? 'plus' : ''}">${signed(card.total)}${esc(e.currency)}</b></div></div>`;
  }
  if (card.kind === 'craft') {
    const mats = card.mats.map(m => `<span class="cr-mat${m.rar ? ` r-${m.rar}` : ''}">${esc(m.name)}×${m.qty}</span>`).join('<i>＋</i>');
    if (!card.ok) return `<div class="lcard craft fail${fresh}"><div class="lc-head"><span>🔨 作成</span><small>出目 ${card.d20}</small></div><div class="cr-mats">${mats}</div><div class="cr-fail">失敗… 素材の半分を失った</div></div>`;
    return `<div class="lcard craft r-${card.rar}${fresh}"><div class="lc-head"><span>🔨 作成</span><small>出目 ${card.d20}${card.skill ? `・${esc(card.skill)}` : ''}</small></div>
      <div class="cr-mats">${mats}</div><div class="cr-arrow">▼</div>
      <div class="lt r-${card.rar} cr-out"><span class="lt-rar">${esc(rarLabel(card.rar, e))}</span><b class="lt-name">${esc(card.wish || '何かができた')}</b><span class="lt-q">${card.wish ? '' : '正体は本文で'}</span></div></div>`;
  }
  return '';
}
export function noteHTML(note) {
  const cls = n => (/\+\d|受けた|習得|達成|レベルアップ/.test(n) ? 'gain' : /−\d|不足|失敗/.test(n) ? 'loss' : '');
  const lv = note?.lvup ? `<div class="lvup"><div class="lv-h">LEVEL UP</div><div class="lv-n">Lv ${note.lvup.from} <i>→</i> <b>Lv ${note.lvup.to}</b></div>${Object.keys(note.lvup.gains || {}).length ? `<div class="lv-g">${Object.entries(note.lvup.gains).map(([n, d]) => `<span>${esc(n)} +${d}</span>`).join('')}</div>` : ''}</div>` : '';
  const notes = (note?.notes || []).filter(n => !/^⭐/.test(n));
  return `${lv}${notes.length ? `<div class="pnote"><span class="pn-h">🎒 記録</span>${notes.map(n => `<span class="pn ${cls(n)}">${esc(n)}</span>`).join('')}</div>` : ''}`;
}

/* ---------- お店のシート ---------- */
const step = (act, data, n, max) => `<span class="st-step">${btn(act, '−', { ...data, d: -1, max }, 'icon-btn sm')}<b class="qn">${n}</b>${btn(act, '＋', { ...data, d: 1, max }, 'icon-btn sm')}</span>`;
export function shopHTML({ c, stock, sellables, money, e, busy, iconOf }) {
  const buyTotal = stock.reduce((a, x) => a + (c.buy[x.name] || 0) * x.price, 0);
  const sellTotal = sellables.reduce((a, i) => a + (c.sell[i.id] || 0) * i.sellAt, 0);
  const after = money - buyTotal + sellTotal, any = buyTotal || sellTotal;
  const buyRow = x => `<div class="sh-row${x.rar ? ` rf r-${x.rar}` : ''}">${iconHTML(x.icon || iconOf(x.name))}<div class="sh-main"><b class="nm">${esc(x.name)}</b>${x.rar ? `<span class="rar r-${x.rar}">${esc(rarLabel(x.rar, e))}</span>` : ''}${x.service ? '<span class="tag">サービス</span>' : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</div><span class="sh-p">${esc(fmtMoney(x.price, e))}</span>${step('shopQty', { kind: 'buy', key: x.name }, c.buy[x.name] || 0, 99)}</div>`;
  const sellRow = i => `<div class="sh-row${i.rar ? ` rf r-${i.rar}` : ''}">${iconHTML(i.icon)}<div class="sh-main"><b class="nm">${esc(i.name)}</b><small>所持 ${i.qty}</small></div><span class="sh-p plus">${esc(fmtMoney(i.sellAt, e))}</span>${step('shopQty', { kind: 'sell', key: i.id }, c.sell[i.id] || 0, i.qty)}</div>`;
  return `<div class="sh-top"><input id="shopName" value="${esc(c.name)}" placeholder="店の名前（例: 鍛冶屋グロム、闇市）" autocomplete="off">${btn('shopSwitch', '切替', {}, 'btn sm ghost')}</div>
    <div class="btn-row">${btn('shopGen', c.gen ? '品ぞろえを考えています…' : '✨ この店の品ぞろえをAIに出してもらう', {}, 'btn sm', c.gen)}</div>
    <p class="hint">今の場面と相場表から、その店らしい品をAIが並べます（記憶用のモデルを1回使います）。アイテム図鑑と相場表の品は、いつでも買えます。</p>
    <div class="lbl">買う</div><div class="st-list">${stock.map(buyRow).join('') || '<p class="empty-s">品物がありません（相場表かアイテム図鑑に値段を書くか、AIに品ぞろえを出してもらってください）</p>'}</div>
    <div class="lbl" style="margin-top:12px">売る</div><div class="st-list">${sellables.map(sellRow).join('') || '<p class="empty-s">値段の分かる持ち物がありません</p>'}</div>
    <div class="sh-sum"><div class="st-row"><span>買う</span><b>−${esc(fmtMoney(buyTotal, e))}</b></div><div class="st-row"><span>売る</span><b class="plus">+${esc(fmtMoney(sellTotal, e))}</b></div>
      <div class="st-row"><span>取引後の所持金</span><b class="${after < 0 ? 'warn' : ''}">${esc(fmtMoney(after, e))}</b></div>
      ${btn('shopDeal', '取引する', {}, 'btn primary block', !any || after < 0 || busy)}</div>`;
}

/* ---------- クラフトのシート ---------- */
export function craftHTML({ c, items, skills, e, busy }) {
  const picked = Object.values(c.pick).reduce((a, b) => a + b, 0);
  return `<p class="hint">素材を選んで作ります。完成品は登録していなくても作れます。出来（ランク）はアプリがサイコロで決め、素材のランク・数とスキルが高いほど良い物になります。何ができたかはAIが描きます。失敗すると素材の半分を失います。</p>
    <label class="field"><span>作りたい物（任意・空欄ならおまかせ）</span><input id="craftWish" value="${esc(c.wish)}" placeholder="例: 解毒薬、即席の盾、改造スコープ" autocomplete="off"></label>
    <label class="field"><span>使うスキル（任意）</span><select id="craftSkill"><option value="">なし</option>${skills.map(k => `<option value="${esc(k.name)}" ${c.skill === k.name ? 'selected' : ''}>${esc(k.name)}${k.level ? `（${esc(k.level)}）` : ''}</option>`).join('')}</select></label>
    <div class="lbl">素材（${picked}個）</div>
    <div class="st-list">${items.map(i => `<div class="sh-row${i.rar ? ` rf r-${i.rar}` : ''}">${iconHTML(i.icon)}<div class="sh-main"><b class="nm">${esc(i.name)}</b>${i.rar ? `<span class="rar r-${i.rar}">${esc(rarLabel(i.rar, e))}</span>` : ''}<small>所持 ${i.qty}</small></div>${step('craftQty', { id: i.id }, c.pick[i.id] || 0, i.qty)}</div>`).join('') || '<p class="empty-s">持ち物がありません</p>'}</div>
    <div class="sh-sum">${btn('craftGo', '🔨 作る', {}, 'btn primary block', !picked || busy)}</div>`;
}

function itemsTab(st, e, base) {
  const carried = st.items.filter(i => i.at !== 'home');
  const cats = [...new Set([...list(e.cats), ...carried.map(i => i.cat)])];
  const pend = it => !base.items.some(b => b.id === it.id);
  const c = carryOf(st, e), lvl = depthLevel(st.depth);
  return `<div class="st-money"><b>💰 ${esc(fmtMoney(st.money, e))}</b>${btn('form', '編集', { kind: 'money' }, 'btn sm ghost')}</div>
    ${c ? `<div class="st-row"><span>積載</span><b class="${c.used > c.max ? 'warn' : ''}">${c.used} / ${c.max}</b></div>${meter(c.used, c.max, c.used > c.max ? 'over' : '')}` : ''}
    ${e.explore === 'on' ? `<div class="st-explore">${btn('loot', `${ic('search', 'sm')}探索する・戦利品を確認`, {}, 'btn primary sm')}<small>${esc(st.depth || '現在地未設定')}・危険度 ${dangerLabel(lvl)}。見つかる物と当たりはアプリがサイコロで決めます</small></div>` : ''}
    ${cats.map(cat => {
      const items = carried.filter(i => (i.cat || '') === cat);
      return items.length ? `<div class="lbl">${esc(cat || 'その他')}</div><div class="st-list">${items.map(it => itemRow(it, e, pend(it))).join('')}</div>` : '';
    }).join('') || '<p class="empty-s">持ち物はありません</p>'}
    <div class="btn-row">${btn('shop', '🛒 お店', {}, 'btn sm')}${btn('craft', '🔨 作る', {}, 'btn sm')}${btn('form', `${ic('plus', 'sm')}持ち物を追加`, { kind: 'item' }, 'btn sm ghost')}</div>`;
}

function gearTab(st, e) {
  const slots = [...new Set([...list(e.slots), ...Object.keys(st.equip)])];
  return `<div class="lbl">装備</div><div class="st-list">${slots.map(s => `<button class="st-item" data-act="${A('form')}" data-kind="slot" data-id="${esc(s)}"><span class="slot">${esc(s)}</span><span class="nm">${esc(st.equip[s] || '—')}</span></button>`).join('')}</div>
    <div class="lbl" style="margin-top:14px">スキル・能力</div><div class="st-list">${st.skills.map((k, i) => `<button class="st-item" data-act="${A('form')}" data-kind="skill" data-id="${i}"><span class="nm">${esc(k.name)}</span>${k.level ? `<span class="tag">${esc(k.level)}</span>` : ''}${k.note ? `<small>${esc(k.note)}</small>` : ''}</button>`).join('') || '<p class="empty-s">まだありません</p>'}</div>
    <div class="btn-row">${btn('form', `${ic('plus', 'sm')}スキルを追加`, { kind: 'skill', id: 'new' })}</div>`;
}

function stateTab(st, e) {
  const g = Object.entries(st.gauges);
  const rep = Object.entries(st.rep);
  const need = needXp(st.lv);
  return `${e.xp === 'on' ? `<div class="st-lv"><b>Lv ${st.lv}</b><span>次のレベルまで ${need - st.xp}</span>${btn('form', '編集', { kind: 'level' }, 'btn sm ghost')}</div>${meter(st.xp, need, 'xp')}` : ''}
    ${g.length ? `<div class="lbl">ゲージ</div>${g.map(([n, x]) => `<div class="st-gauge"><div class="st-row"><span>${esc(n)}</span><span class="st-step">${btn('gauge', '−', { name: n, d: -1 }, 'icon-btn sm')}<b>${x.v} / ${x.max}</b>${btn('gauge', '＋', { name: n, d: 1 }, 'icon-btn sm')}</span></div>${meter(x.v, x.max)}</div>`).join('')}` : ''}
    <div class="btn-row">${btn('form', 'ゲージを編集', { kind: 'gauges' }, 'btn sm ghost')}</div>
    ${e.life === 'on' ? `<div class="lbl" style="margin-top:14px">日付</div><div class="st-row"><span>${st.day}日目（${weekday(st.day)}）</span><span class="st-step">${btn('day', '−', { d: -1 }, 'icon-btn sm')}${btn('day', '＋', { d: 1 }, 'icon-btn sm')}</span></div>` : ''}
    ${e.explore === 'on' ? `<div class="lbl" style="margin-top:14px">現在地</div><div class="st-row"><span>${esc(st.depth || '未設定')}（危険度 ${dangerLabel(depthLevel(st.depth))}）</span>${btn('form', '変更', { kind: 'depth' }, 'btn sm ghost')}</div>
      ${rep.length ? `<div class="lbl" style="margin-top:14px">評判</div>${rep.map(([f, v]) => `<div class="st-row"><span>${esc(f)}</span><span class="st-step">${btn('rep', '−', { f, d: -10 }, 'icon-btn sm')}<b>${repLabel(v)}（${v}）</b>${btn('rep', '＋', { f, d: 10 }, 'icon-btn sm')}</span></div>`).join('')}` : ''}` : ''}`;
}

function homeTab(st, e, base) {
  const h = st.home, stored = st.items.filter(i => i.at === 'home');
  return `<div class="lbl">拠点</div>
    ${h ? `<div class="st-card"><b>${esc(h.name)}</b>${h.kind ? `<span class="tag">${esc(h.kind)}</span>` : ''}<small>${h.rent ? `${esc(fmtMoney(h.rent, e))}／${h.every}日・次の支払い ${h.next}日目${h.arrears ? '・<b class="warn">支払い不足</b>' : ''}` : '支払いなし'}</small></div>` : '<p class="empty-s">拠点はまだありません（宿や家を借りると、記憶係が自動で記録します）</p>'}
    <div class="btn-row">${btn('form', h ? '拠点を編集' : '拠点を設定', { kind: 'home' }, 'btn sm ghost')}</div>
    <div class="lbl" style="margin-top:14px">建設・増築</div>
    ${st.projects.map((p, i) => `<button class="st-proj" data-act="${A('form')}" data-kind="project" data-id="${i}"><div class="st-row"><span>${esc(p.name)}</span><b>${p.progress}%</b></div>${meter(p.progress, 100)}${p.note ? `<small>${esc(p.note)}</small>` : ''}</button>`).join('') || '<p class="empty-s">ありません</p>'}
    <div class="btn-row">${btn('form', `${ic('plus', 'sm')}建設を追加`, { kind: 'project', id: 'new' })}</div>
    <div class="lbl" style="margin-top:14px">依頼</div>
    <div class="st-list">${st.quests.map((q, i) => `<button class="st-item" data-act="${A('form')}" data-kind="quest" data-id="${i}"><span class="tag q-${q.state}">${esc(q.state)}</span><span class="nm">${esc(q.title)}</span><small>${esc([q.reward && '報酬 ' + q.reward, q.deadline && '期限 ' + q.deadline].filter(Boolean).join('・'))}</small></button>`).join('') || '<p class="empty-s">ありません</p>'}</div>
    <div class="btn-row">${btn('form', `${ic('plus', 'sm')}依頼を追加`, { kind: 'quest', id: 'new' })}</div>
    <div class="lbl" style="margin-top:14px">拠点の保管（${stored.length}）</div>
    <div class="st-list">${stored.map(it => itemRow(it, e, !base.items.some(b => b.id === it.id))).join('') || '<p class="empty-s">ありません</p>'}</div>`;
}

function logTab(st) {
  return `${st.prev ? `<div class="btn-row">${btn('undo', `${ic('undo', 'sm')}直前の自動反映を取り消す`, {}, 'btn sm')}</div>` : ''}
    <div class="st-log">${st.log.slice().reverse().map(l => `<div><span class="meta">T${l.turn}</span>${esc(l.text)}</div>`).join('') || '<p class="empty-s">まだ記録はありません</p>'}</div>`;
}

export function sheetHTML(st, e, base, tab) {
  const tabs = TABS(e);
  if (!tabs.some(([k]) => k === tab)) tab = 'items';
  const body = { items: itemsTab, gear: gearTab, state: stateTab, home: homeTab, log: logTab }[tab](st, e, base);
  return `<div class="seg">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="${A('tab')}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="st-body">${body}</div>
    <p class="hint">会話の中の売買・入手・消費・負傷などは、記憶係が次の発言のあとに自動で反映します。違っていたら直接直せます。</p>`;
}

export function itemSheetHTML(it, e, { inBase, life, busy, sellAt }) {
  const facts = [it.cat && `種類: ${it.cat}`, it.val && !it.unid && `査定額: ${fmtMoney(it.val, e)}`, it.note].filter(Boolean);
  const acts = [
    !it.unid && btn('use', `${ic('forward', 'sm')}使う`, { id: it.id }),
    it.unid && btn('appraise', `${ic('search', 'sm')}鑑定する`, { id: it.id }, 'btn primary sm'),
    sellAt && btn('sell', `${ic('download', 'sm')}売る（${esc(fmtMoney(sellAt, e))}）`, { id: it.id }),
  ].filter(Boolean).join('');
  const edits = inBase ? `<div class="btn-row">${btn('qty', '−1', { id: it.id, d: -1 })}${btn('qty', '＋1', { id: it.id, d: 1 })}${life ? btn('move', it.at === 'home' ? '持ち物へ移す' : '拠点に置く', { id: it.id }) : ''}${btn('form', '編集', { kind: 'item', id: it.id }, 'btn sm ghost')}${btn('qty', '捨てる', { id: it.id, d: -it.qty }, 'btn sm danger')}</div>`
    : '<p class="hint">この品はまだ反映待ちです。次の発言のあとに編集できます。</p>';
  return `<div class="st-card big${it.rar ? ` rf r-${it.rar}` : ''}">${iconHTML(it.icon, 'st-ic big')}<b class="nm">${esc(it.name)}</b>${rarBadge(it, e)}<span class="q">×${it.qty}</span>${facts.length ? `<small>${esc(facts.join('／'))}</small>` : ''}</div>
    ${it.desc ? `<p class="st-desc">${esc(it.desc)}</p>` : ''}
    ${busy ? '<p class="hint">応答の生成中は操作できません。</p>' : acts ? `<div class="btn-row">${acts}</div>` : ''}
    ${it.unid ? '<p class="hint">鑑定すると、ランクと査定額をアプリがサイコロで決め、AIが正体を描写します。</p>' : ''}
    ${edits}`;
}

// 汎用の編集フォーム。fields: [{ name, label, value, type: 'text'|'number'|'textarea'|'select', options }]
export function formHTML(fields, { kind, id, del = false }) {
  return fields.map(f => {
    const v = esc(f.value ?? '');
    const input = f.type === 'textarea' ? `<textarea name="${f.name}" rows="${f.rows || 3}">${v}</textarea>`
      : f.type === 'select' ? `<select name="${f.name}">${f.options.map(([ov, l]) => `<option value="${esc(ov)}" ${String(f.value ?? '') === String(ov) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input name="${f.name}" value="${v}" ${f.type === 'number' ? 'type="number" inputmode="numeric"' : ''} autocomplete="off">`;
    return `<label class="field"><span>${esc(f.label)}</span>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</label>`;
  }).join('') + `<div class="btn-row end">${del ? btn('remove', '削除', { kind, id }, 'btn danger') : ''}<button class="btn" data-act="closeSheet">キャンセル</button>${btn('save', '保存', { kind, id }, 'btn primary')}</div>`;
}
