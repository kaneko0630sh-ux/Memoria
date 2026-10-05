// ステータス管理: 画面（☰ →「ステータス」のシートと、トーク上部のバー）
import { esc } from '../../core/util.js';
import { ic } from '../../ui/dom.js';
import { list, fmtMoney, rarLabel, itemLabel, depthLevel, dangerLabel, repLabel, weekday, carryOf } from './model.js';

const A = name => `p:status:${name}`;
const btn = (act, label, data = {}, cls = 'btn sm') => `<button class="${cls}" data-act="${A(act)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;
const rarBadge = (it, e) => (it.unid ? '<span class="rar r-q">未鑑定</span>' : it.rar ? `<span class="rar r-${it.rar}">${esc(rarLabel(it.rar, e))}</span>` : '');
const meter = (v, max, cls = '') => `<div class="st-meter ${cls}"><i style="width:${Math.max(0, Math.min(100, max ? (v / max) * 100 : 0))}%"></i></div>`;

export const TABS = e => [['items', '持ち物'], ['gear', '装備・スキル'], ['state', '状態'], ...(e.life === 'on' ? [['home', '拠点・依頼']] : []), ['log', '履歴']];

export function barHTML(st, e) {
  const g = Object.entries(st.gauges)[0];
  const parts = [`💰 ${esc(fmtMoney(st.money, e))}`];
  if (g) parts.push(`${esc(g[0])} ${g[1].v}/${g[1].max}`);
  if (e.life === 'on') parts.push(`${st.day}日目`);
  if (e.explore === 'on' && st.depth) parts.push(esc(st.depth));
  const c = carryOf(st, e);
  if (c && c.used > c.max) parts.push('<b class="warn">重量オーバー</b>');
  return `<button class="st-bar" data-act="${A('open')}">${parts.join('<i>・</i>')}</button>`;
}

function itemRow(it, e, pending) {
  return `<button class="st-item" data-act="${A('item')}" data-id="${it.id}"><span class="nm">${esc(itemLabel(it, e))}</span>${rarBadge(it, e)}${pending ? '<span class="tag">反映待ち</span>' : ''}<span class="q">×${it.qty}</span></button>`;
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
    <div class="btn-row">${btn('form', `${ic('plus', 'sm')}持ち物を追加`, { kind: 'item' })}</div>`;
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
  return `${g.length ? `<div class="lbl">ゲージ</div>${g.map(([n, x]) => `<div class="st-gauge"><div class="st-row"><span>${esc(n)}</span><span class="st-step">${btn('gauge', '−', { name: n, d: -1 }, 'icon-btn sm')}<b>${x.v} / ${x.max}</b>${btn('gauge', '＋', { name: n, d: 1 }, 'icon-btn sm')}</span></div>${meter(x.v, x.max)}</div>`).join('')}` : ''}
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

export function itemSheetHTML(it, e, { inBase, life, busy }) {
  const facts = [it.cat && `種類: ${it.cat}`, it.val && !it.unid && `査定額: ${fmtMoney(it.val, e)}`, it.note].filter(Boolean);
  const acts = [
    !it.unid && btn('use', `${ic('forward', 'sm')}使う`, { id: it.id }),
    it.unid && btn('appraise', `${ic('search', 'sm')}鑑定する`, { id: it.id }, 'btn primary sm'),
    it.val && !it.unid && btn('sell', `${ic('download', 'sm')}売る（${esc(fmtMoney(it.val, e))}）`, { id: it.id }),
  ].filter(Boolean).join('');
  const edits = inBase ? `<div class="btn-row">${btn('qty', '−1', { id: it.id, d: -1 })}${btn('qty', '＋1', { id: it.id, d: 1 })}${life ? btn('move', it.at === 'home' ? '持ち物へ移す' : '拠点に置く', { id: it.id }) : ''}${btn('form', '編集', { kind: 'item', id: it.id }, 'btn sm ghost')}${btn('qty', '捨てる', { id: it.id, d: -it.qty }, 'btn sm danger')}</div>`
    : '<p class="hint">この品はまだ反映待ちです。次の発言のあとに編集できます。</p>';
  return `<div class="st-card big"><b>${esc(itemLabel(it, e))}</b>${rarBadge(it, e)}<span class="q">×${it.qty}</span>${facts.length ? `<small>${esc(facts.join('／'))}</small>` : ''}</div>
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
