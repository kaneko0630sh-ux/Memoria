// 記憶パネル（現在の状況・進行度・キャラ/世界/ユーザー記憶・あらすじ・ログ）
import { S, getChat, curChat, chatCtx, saveChat } from '../../core/store.js';
import { esc, tl, hhmm } from '../../core/util.js';
import { on } from '../../core/hooks.js';
import { buildChatRequest } from '../../engine/prompt.js';
import { TAGS, scopeLabel, scopeBudget, memScopes, entryNum, clampImp, isMemBusy, updateNow, consolidateNow, rebuildMemory, resetMemoryItems } from '../../engine/memory.js';
import { ic, openSheet, closeAllSheets, sheetById, sheetOf, setSheetBody, toast } from '../dom.js';
import { defineActions } from '../app.js';

const chatOf = el => getChat(sheetOf(el)?.dataset.chat) || curChat();
const refresh = (top = false) => { const w = sheetById('memory'); if (w) setSheetBody('memory', panelHTML(getChat(w.dataset.chat)), top); };
const val = sel => document.querySelector(`#sheets [data-sheet="memory"] ${sel}`)?.value ?? '';

function statusHTML(chat) {
  const m = chat.mem, busy = isMemBusy(chat);
  const pending = chat.messages.filter(x => (x.role === 'user' || x.role === 'ai') && x.id > m.lastId).length;
  return `<div class="mem-status"><span>${busy ? '<span class="spin"></span>記憶を更新中…' : `${tl(m.turn)}まで記憶済み`}</span><span>未処理 ${pending}件</span><span class="grow"></span><button class="btn sm" data-act="memUpdateNow" ${busy ? 'disabled' : ''}>${ic('refresh', 'sm')}今すぐ更新</button></div>`;
}
function panelHTML(chat) {
  const ctx = chatCtx(chat), m = chat.mem, scopes = memScopes(chat, ctx);
  if (!['state', 'prog', 'chron', 'log', ...scopes].includes(S.ui.memTab)) S.ui.memTab = 'state';
  const tab = S.ui.memTab, count = sc => m.entries.filter(e => e.scope === sc).length;
  const tabs = [['state', '現在の状況', ''], ['prog', '進行度', m.threads.length], ...scopes.map(sc => [sc, scopeLabel(sc, ctx), count(sc)]), ['chron', 'あらすじ', m.chronicle.length], ['log', 'ログ', '']];
  return `<div id="memStatus">${statusHTML(chat)}</div>
    <div class="seg">${tabs.map(([k, l, n]) => `<button class="${k === tab ? 'on' : ''}" data-act="memTab" data-tab="${k}">${esc(l)}${n !== '' ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
    <div class="mem-pane">${paneHTML(chat, tab, ctx)}</div>`;
}
function meterHTML(used, budget, extra = '') {
  const pct = Math.min(100, Math.round(used / Math.max(1, budget) * 100));
  return `<div class="meter-row"><span>${used.toLocaleString()} / ${budget.toLocaleString()}字</span><span>${extra}</span></div><div class="meter ${used > budget ? 'over' : ''}"><i style="width:${pct}%"></i></div>${used > budget ? '<p class="hint warn">容量を超えています。次の更新時に自動で統合・圧縮されます。</p>' : ''}`;
}
const impSel = (cls, cur = 3) => `<select class="${cls}">${[5, 4, 3, 2, 1].map(i => `<option value="${i}" ${i === cur ? 'selected' : ''}>重要度 ${i}</option>`).join('')}</select>`;
function entryHTML(e) {
  if (S.ui.memEditing === e.id) return `<div class="mem-e editing"><textarea class="mem-edit" rows="3">${esc(e.text)}</textarea><div class="inline">${impSel('mem-edit-imp', e.imp)}<button class="btn sm" data-act="memCancelEdit">取消</button><button class="btn sm primary" data-act="memSaveEdit" data-eid="${e.id}">保存</button></div></div>`;
  const src = e.src === 'manual' ? '<span class="tag">手動</span>' : e.src === 'merged' ? '<span class="tag">統合</span>' : '';
  return `<div class="mem-e ${e.pinned ? 'pinned' : ''}"><div class="mem-text">${esc(e.text)}</div><div class="mem-meta"><span class="imp" title="重要度">${'★'.repeat(e.imp)}<span class="off">${'★'.repeat(5 - e.imp)}</span></span><span>${tl(e.turn)}</span>${e.tag ? `<span class="tag">${TAGS[e.tag] || esc(e.tag)}</span>` : ''}${src}${(e.ents || []).map(x => `<span class="tag ent">${esc(x)}</span>`).join('')}<span class="grow"></span><button class="icon-btn pin-b" data-act="memPin" data-eid="${e.id}" aria-label="${e.pinned ? '固定を解除' : '固定（常に渡す・圧縮しない）'}">${ic('pin', 'sm')}</button><button class="icon-btn" data-act="memEdit" data-eid="${e.id}" aria-label="編集">${ic('edit', 'sm')}</button><button class="icon-btn" data-act="memDel" data-eid="${e.id}" aria-label="削除">${ic('trash', 'sm')}</button></div></div>`;
}
function statsHTML(chat) {
  let r;
  try { r = buildChatRequest(chat, { end: chat.messages.length }); } catch { return ''; }
  const i = r.info, cap = S.settings.context, tot = i.system + i.memory + i.history;
  const bar = (label, v, cls) => `<div class="stat"><span>${label}</span><div class="meter"><i class="${cls}" style="width:${Math.min(100, Math.round(v / Math.max(tot, cap) * 100))}%"></i></div><b>${v.toLocaleString()}</b></div>`;
  return bar('設定・プロット・あらすじ', i.system, '') + bar(`設定集・記憶・状況（記憶${i.used}/${i.total}件）`, i.memory, 'c2') + bar(`直近の会話（${i.msgs}件）`, i.history, 'c3')
    + `<p class="hint">合計 約${tot.toLocaleString()} / 上限 ${cap.toLocaleString()} トークン（概算）${i.dropped ? ` ・ 上限のため${i.dropped}件を省略中` : ''}</p>`;
}

function paneHTML(chat, tab, ctx) {
  const m = chat.mem, s = S.settings;
  if (tab === 'state') return `<p class="note-box">毎ターン自動で書き直される「いま」の状況です。場所・時刻・その場の人物・所持品などを常に正しく保ち、AIへ毎回渡されます。</p>
    <textarea class="mem-state" rows="9" placeholder="まだ記録されていません。会話が進むと自動で記入されます。">${esc(m.state)}</textarea>
    <div class="btn-row end"><button class="btn sm primary" data-act="memSaveState">状況を保存</button></div>
    <div class="lbl" style="margin-top:16px">次に送信されるプロンプトの内訳</div>${statsHTML(chat)}`;
  if (tab === 'prog') {
    const recall = (m.recall || []).map(id => m.entries.find(e => e.id === id)).filter(Boolean);
    return `<p class="note-box">記憶係が毎ターン更新する「物語の現在地」です。常にAIへ渡されます。</p>
      <div class="lbl">局面・当面の目標</div><textarea class="mem-arc" rows="3" placeholder="まだ記録されていません">${esc(m.arc)}</textarea>
      <div class="btn-row end"><button class="btn sm primary" data-act="memSaveArc">保存</button></div>
      <div class="lbl">未解決の筋（${m.threads.length}）</div>
      ${m.threads.length ? m.threads.map((t, i) => `<div class="mem-e"><div class="mem-text"><b>${esc(t.t)}</b>　<span class="tag">${esc(t.s)}</span></div><div class="mem-meta"><span class="grow">${esc(t.n)}</span><button class="icon-btn" data-act="memThreadDel" data-i="${i}" aria-label="解決済みにして外す">${ic('check', 'sm')}</button></div></div>`).join('') : '<p class="empty-s">まだありません</p>'}
      <div class="lbl" style="margin-top:14px">関係の現在地</div>
      ${m.rel.length ? m.rel.map(r => `<div class="mem-e"><div class="mem-text"><b>${esc(r.name)}</b>　${esc(r.text)}</div></div>`).join('') : '<p class="empty-s">まだありません</p>'}
      ${m.brief ? `<div class="lbl" style="margin-top:14px">演出メモ（次の応答向け）</div><p class="note-box">${esc(m.brief)}</p>` : ''}
      <div class="lbl" style="margin-top:14px">記憶係が次の場面用に選んだ記憶（${recall.length}）</div>
      ${recall.map(e => `<div class="mem-e"><div class="mem-text">${esc(e.text)}</div><div class="mem-meta"><span class="tag">${esc(scopeLabel(e.scope, ctx))}</span></div></div>`).join('') || '<p class="empty-s">まだありません</p>'}
      ${m.scene.length ? `<div class="lbl" style="margin-top:14px">いまの場面の要素</div><div class="ent-chips">${m.scene.map(x => `<span class="tag ent">${esc(x)}</span>`).join('')}</div>` : ''}`;
  }
  if (tab === 'chron') {
    const used = m.chronicle.reduce((a, c) => a + c.text.length, 0);
    const coveredTurn = chat.messages.find(x => x.id === m.coveredId)?.turn;
    return `<p class="note-box">${m.coveredId ? `${tl(coveredTurn || 0)}までの会話はここに要約され、原文はAIへ送られません（画面上には残ります）。` : 'まだ要約はありません。'}直近の約${s.mem.recent}件は常に原文のまま送られます。</p>
      ${meterHTML(used, s.mem.budgets.chronicle, `${m.chronicle.length}件`)}
      ${m.chronicle.length ? m.chronicle.map(c => S.ui.memEditing === c.id
        ? `<div class="mem-e editing"><div class="mem-meta"><b>${tl(c.from)}〜${tl(c.to)}</b></div><textarea class="mem-edit" rows="6">${esc(c.text)}</textarea><div class="inline"><span class="grow"></span><button class="btn sm" data-act="memCancelEdit">取消</button><button class="btn sm primary" data-act="chronSave" data-eid="${c.id}">保存</button></div></div>`
        : `<div class="mem-e"><div class="mem-meta"><b class="t2">${tl(c.from)}〜${tl(c.to)}</b>${c.merged ? '<span class="tag">前史</span>' : ''}<span class="grow"></span><button class="icon-btn" data-act="memEdit" data-eid="${c.id}" aria-label="編集">${ic('edit', 'sm')}</button><button class="icon-btn" data-act="chronDel" data-eid="${c.id}" aria-label="削除">${ic('trash', 'sm')}</button></div><div class="mem-text">${esc(c.text)}</div></div>`).join('')
        : '<p class="empty-s">会話が長くなると、古い部分から自動であらすじ化されます。</p>'}`;
  }
  if (tab === 'log') {
    const r = S.lastPrompt[chat.id];
    const pt = r ? r.system.filter(b => b.text).map(b => '■ SYSTEM\n' + b.text).join('\n\n') + '\n\n' + r.messages.map(x => `■ ${x.role.toUpperCase()}\n${x.content}`).join('\n\n') : '（この起動中はまだ送信していません）';
    return `<details><summary>最後に送信したプロンプトを見る</summary><pre class="prompt">${esc(pt)}</pre></details>
      <div class="btn-row"><button class="btn sm" data-act="memRebuild">${ic('refresh', 'sm')}全ログから記憶を作り直す</button><button class="btn sm danger" data-act="memReset">記憶項目をすべて消す</button></div>
      <div class="lbl">処理ログ</div>
      ${m.log.length ? m.log.slice().reverse().map(l => `<div class="logline ${l.err ? 'err' : ''}"><span class="meta">${hhmm(l.t)}</span>　${esc(l.text)}</div>`).join('') : '<p class="empty-s">ログはまだありません</p>'}`;
  }
  const sc = tab, budget = scopeBudget(sc);
  const list = m.entries.filter(e => e.scope === sc).sort((a, b) => a.turn - b.turn || entryNum(a) - entryNum(b));
  const used = list.reduce((a, e) => a + e.text.length, 0);
  const desc = sc === 'world' ? '世界・場所・組織・NPC・出来事について積み重なった事実です。'
    : sc === 'user' ? `${esc(ctx.user)}について判明した事実です。`
    : `${esc(scopeLabel(sc, ctx))}が体験したこと・感じたこと・関係・約束・秘密の記憶です。`;
  return `<p class="note-box">${desc}ピン留め・最重要（★5）の記憶は毎回、それ以外は場面に合わせて選ばれてAIへ渡されます。</p>
    ${meterHTML(used, budget, `${list.length}件`)}
    <div class="mem-add"><textarea class="mem-new" rows="2" placeholder="記憶を手動で追加…"></textarea><div class="inline">${impSel('mem-new-imp', 3)}<button class="btn sm primary" data-act="memAdd" data-scope="${sc}">追加</button></div></div>
    <div>${list.length ? list.map(entryHTML).join('') : '<p class="empty-s">まだ記憶はありません。会話が進むと自動で積み重なります。</p>'}</div>
    <div class="btn-row"><button class="btn sm" data-act="memConsolidate" data-scope="${sc}" ${list.filter(e => !e.pinned).length < 3 ? 'disabled' : ''}>今すぐ整理・圧縮</button></div>`;
}

on('memory:changed', chat => {
  const w = sheetById('memory');
  if (!w || w.dataset.chat !== chat.id) return;
  const st = w.querySelector('#memStatus');
  if (st) st.innerHTML = statusHTML(chat);
  const a = document.activeElement;
  if (!(a && w.contains(a) && /TEXTAREA|INPUT|SELECT/.test(a.tagName)) && !S.ui.memEditing) setSheetBody('memory', panelHTML(chat));
});

const save = async chat => { await saveChat(chat); refresh(); };

defineActions({
  memory: el => {
    const chat = getChat(sheetOf(el)?.dataset.chat) || curChat();
    closeAllSheets();
    if (!chat) return;
    S.ui.memEditing = null;
    openSheet({ id: 'memory', title: '記憶', full: true, data: { chat: chat.id }, html: panelHTML(chat), onClose: () => { S.ui.memEditing = null; } });
  },
  memTab: el => { S.ui.memTab = el.dataset.tab; S.ui.memEditing = null; refresh(true); },
  memUpdateNow: el => {
    const chat = chatOf(el);
    if (!chat.messages.length) return toast('まだメッセージがありません');
    if (S.gen?.chatId === chat.id) return toast('生成が終わってから実行してください', 'warn');
    updateNow(chat);
    toast('記憶を更新しています…', '', 1800);
  },
  memPin: el => { const chat = chatOf(el), e = chat.mem.entries.find(x => x.id === el.dataset.eid); if (!e) return; e.pinned = !e.pinned; toast(e.pinned ? '固定しました（常に渡され、圧縮されません）' : '固定を解除しました', '', 2000); return save(chat); },
  memEdit: el => { S.ui.memEditing = el.dataset.eid; refresh(); document.querySelector('#sheets .mem-edit')?.focus(); },
  memCancelEdit: () => { S.ui.memEditing = null; refresh(); },
  memSaveEdit: el => {
    const chat = chatOf(el), e = chat.mem.entries.find(x => x.id === el.dataset.eid), text = val('.mem-edit').trim();
    if (e && text) { e.text = text; e.imp = clampImp(val('.mem-edit-imp')); if (e.src === 'auto') e.src = 'manual'; }
    S.ui.memEditing = null;
    return save(chat);
  },
  memDel: el => {
    const chat = chatOf(el), e = chat.mem.entries.find(x => x.id === el.dataset.eid);
    if (!e || !confirm(`この記憶を削除しますか？\n\n${e.text}`)) return;
    chat.mem.entries = chat.mem.entries.filter(x => x !== e);
    return save(chat);
  },
  memAdd: el => {
    const chat = chatOf(el), text = val('.mem-new').trim();
    if (!text) return toast('内容を入力してください', 'warn');
    chat.mem.entries.push({ id: 'm' + (++chat.mem.seq), scope: el.dataset.scope, text, imp: clampImp(val('.mem-new-imp')), tag: '', ents: [], turn: chat.mem.turn, src: 'manual' });
    toast('記憶を追加しました', 'ok', 1500);
    return save(chat);
  },
  memSaveState: el => { const chat = chatOf(el); chat.mem.state = val('.mem-state').trim(); toast('現在の状況を保存しました', 'ok', 1500); return save(chat); },
  memSaveArc: el => { const chat = chatOf(el); chat.mem.arc = val('.mem-arc').trim(); toast('保存しました', 'ok', 1500); return save(chat); },
  memThreadDel: el => { const chat = chatOf(el); chat.mem.threads.splice(Number(el.dataset.i), 1); return save(chat); },
  memConsolidate: el => { consolidateNow(chatOf(el), el.dataset.scope); toast('整理・圧縮しています…', '', 1800); },
  chronSave: el => {
    const chat = chatOf(el), c = chat.mem.chronicle.find(x => x.id === el.dataset.eid), text = val('.mem-edit').trim();
    if (c && text) c.text = text;
    S.ui.memEditing = null;
    return save(chat);
  },
  chronDel: el => {
    const chat = chatOf(el), c = chat.mem.chronicle.find(x => x.id === el.dataset.eid);
    if (!c || !confirm('このあらすじを削除しますか？ 該当期間の出来事はAIに伝わらなくなります。')) return;
    chat.mem.chronicle = chat.mem.chronicle.filter(x => x !== c);
    return save(chat);
  },
  memRebuild: el => {
    const chat = chatOf(el), n = chat.messages.filter(x => x.role !== 'sys').length;
    if (!confirm(`全${n}件のメッセージから記憶とあらすじを作り直します。APIを何度も呼び出すため費用と時間がかかります。続けますか？`)) return;
    rebuildMemory(chat);
    return save(chat);
  },
  memReset: el => {
    const chat = chatOf(el);
    if (!confirm('記憶項目・現在の状況・進行度をすべて消します（あらすじは残ります）。よろしいですか？')) return;
    resetMemoryItems(chat);
    return save(chat);
  },
});
