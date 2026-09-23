// トーク画面（メッセージ・入力欄・☰メニュー・各種シート）
import { S, getChat, getStory, curChat, curChatId, talksOf, txt, lastDialog, maxTurn, chatCtx, saveChat, removeChat, curView } from '../../core/store.js';
import { esc, FINE, relTime, tl, modelShort, safeName, ymd } from '../../core/util.js';
import { on } from '../../core/hooks.js';
import { PROVIDERS, EFFORTS, llmCfg } from '../../llm/providers.js';
import { parseBlocks, plainText, lastLine } from '../../engine/parse.js';
import { sendMessage, aiTurn, generate, regenerate, swipe, rewindTo } from '../../engine/chat.js';
import { isMemBusy, scopeLabel, TAGS } from '../../engine/memory.js';
import { blockOwners, collect } from '../../plugins/registry.js';
import { ic, avatarHTML, openSheet, closeSheet, closeAllSheets, sheetOf, setSheetBody, autosize, copyText, saveFile, toast, TYPING } from '../dom.js';
import { blocksHTML } from '../blocks.js';
import { defineView, defineActions, go, render, goHome, isView } from '../app.js';
import { openEditor } from './editor.js';

/* ---------- 表示 ---------- */
defineView('chat', {
  ownScroll: true,
  render(p) {
    const chat = getChat(p.id);
    if (!chat) return '';
    const ctx = chatCtx(chat), cfg = llmCfg('main');
    return `<header class="topbar chat-top">
      <button class="icon-btn" data-act="back" aria-label="戻る">${ic('back')}</button>
      <div class="ct-title">${esc(ctx.story?.title || chat.title)}</div>
      <button class="mpill" data-act="modelSheet"><span>${esc(cfg.def.kind === 'mock' ? 'demo' : modelShort(cfg.model) || '未設定')}</span>${ic('down', 'xs')}</button>
      <button class="icon-btn mem-btn ${isMemBusy(chat) ? 'busy' : ''}" id="memBtn" data-act="drawer" aria-label="メニュー">${ic('menu')}<i class="dot"></i></button>
    </header>
    <div class="mem-flash" id="memFlash"></div>
    <main class="scroll msgs" id="msgs"></main>
    <footer class="composer">
      <button class="to-bottom" id="toBottom" data-act="toBottom" aria-label="最新へ">${ic('down')}</button>
      <div class="choices" id="choices"></div>
      <div class="comp-row">
        <button class="bolt" data-act="aiTurnBtn" aria-label="おまかせ">${ic('bolt', 'sm')}<small>おまかせ</small></button>
        <div class="in-wrap"><textarea id="input" rows="1" placeholder="メッセージ"></textarea><button class="ast" id="astBtn" data-act="insertAst" aria-label="＊を挿入">＊</button></div>
        <button class="send-btn" id="sendBtn" data-act="send" aria-label="送信">${ic('send')}</button>
      </div>
    </footer>`;
  },
  mount(p) {
    const chat = getChat(p.id);
    if (!chat) { S.ui.stack.pop(); return render(); }
    renderMessages(chat);
    renderChoices(chat);
    updateComposer();
    const ta = document.getElementById('input'), sc = document.getElementById('msgs');
    ta.value = S.ui.drafts[chat.id] || '';
    autosize(ta);
    ta.addEventListener('input', () => { autosize(ta); S.ui.drafts[chat.id] = ta.value; });
    ta.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || (FINE && !e.shiftKey)) { e.preventDefault(); submit(); }
    });
    ta.addEventListener('focus', () => setTimeout(scrollBottom, 350));
    for (const id of ['sendBtn', 'astBtn']) document.getElementById(id).addEventListener('pointerdown', e => e.preventDefault());
    sc.addEventListener('scroll', () => document.getElementById('toBottom')?.classList.toggle('on', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 400), { passive: true });
  },
});

const scrollBottom = () => { const sc = document.getElementById('msgs'); if (sc) sc.scrollTop = sc.scrollHeight; };
const isStreaming = (chat, x) => S.gen && S.gen.chatId === chat.id && S.gen.msgId === x.id;
function genLabel() {
  if (!S.gen || S.gen.status === 'writing') return '';
  const sec = Math.floor((Date.now() - S.gen.t0) / 1000);
  return `${S.gen.status === 'thinking' ? '考え中' : '応答を待っています'}… ${sec}秒`;
}

function msgHTML(chat, x, ctx, lastD) {
  const covered = x.id <= chat.mem.coveredId ? ' covered' : '';
  if (x.role === 'sys') return `<div class="divider"><span>${esc(txt(x))}</span></div>`;
  if (x.role === 'user') {
    const av = { name: ctx.user, avatar: S.settings.persona.avatar };
    const body = esc(txt(x)).replace(/\*([^*\n]+?)\*/g, '<span class=act>$1</span>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return `<div class="msg user${covered}" data-id="${x.id}"><div class="u-main"><div class="u-name">${esc(ctx.user)}</div><div class="bubble me" data-act="msgTap">${body}</div></div>${avatarHTML(av, 40)}</div>`;
  }
  const streaming = isStreaming(chat, x), isLast = lastD?.id === x.id;
  const blocks = parseBlocks(txt(x), ctx.chars, blockOwners(ctx.story));
  const inner = streaming && !blocks.length
    ? `<div class="say">${avatarHTML(ctx.chars[0], 40)}<div class="say-main"><div class="say-name">${esc(ctx.chars[0]?.name || '')}</div><div class="brow"><div class="bubble ai">${TYPING}<div class="gen-status">${genLabel()}</div></div></div></div></div>`
    : blocksHTML(blocks, ctx, { tag: streaming ? '' : modelShort(x.mdl?.[x.sw]), caret: streaming, env: { chat, msg: x, isLast: isLast && !streaming, ctx } });
  const swipeBar = isLast && !streaming ? `<div class="swipe"><button class="icon-btn" data-act="swipe" data-id="${x.id}" data-dir="-1" ${x.sw === 0 ? 'disabled' : ''} aria-label="前の候補">${ic('left', 'sm')}</button><span>${x.sw + 1}/${x.swipes.length}</span><button class="icon-btn" data-act="swipe" data-id="${x.id}" data-dir="1" aria-label="次の候補">${ic('right', 'sm')}</button><span class="grow"></span><button class="icon-btn" data-act="contMsg" aria-label="続きを書かせる">${ic('forward', 'sm')}</button><button class="icon-btn" data-act="regen" aria-label="再生成">${ic('refresh', 'sm')}</button></div>` : '';
  return `<div class="msg ai${covered}" data-id="${x.id}">${inner}${swipeBar}</div>`;
}

function renderMessages(chat, { keep = false } = {}) {
  const sc = document.getElementById('msgs');
  if (!sc) return;
  const fromBottom = sc.scrollHeight - sc.scrollTop;
  const ctx = chatCtx(chat), all = chat.messages, n = S.ui.showN[chat.id] || 80;
  const start = Math.max(0, all.length - n), lastD = lastDialog(chat);
  let html = start > 0 ? `<button class="btn sm ghost more-btn" data-act="showMore">以前のメッセージを表示（残り${start}件）</button>`
    : `<div class="notice">${ic('info', 'xs')}返答はすべてAIが生成した内容です</div><div class="divider"><span>${esc(ctx.user)}に変身！</span></div>`;
  for (let i = start; i < all.length; i++) {
    const x = all[i];
    html += msgHTML(chat, x, ctx, lastD);
    if (chat.mem.coveredId && x.id <= chat.mem.coveredId && !(all[i + 1] && all[i + 1].id <= chat.mem.coveredId))
      html += `<div class="divider accent"><span>${ic('layers', 'xs')}ここまでは「あらすじ」に要約して引き継ぎ</span></div>`;
  }
  sc.innerHTML = html;
  sc.scrollTop = keep ? sc.scrollHeight - fromBottom : sc.scrollHeight;
}

let paintQueued = false;
function paintStreaming(chat, msg) {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (curChatId() !== chat.id || S.gen?.msgId !== msg.id) return;
    const el = document.querySelector(`#msgs .msg[data-id="${msg.id}"]`), sc = document.getElementById('msgs');
    if (!el || !sc) return;
    const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
    el.outerHTML = msgHTML(chat, msg, chatCtx(chat), lastDialog(chat));
    if (near) sc.scrollTop = sc.scrollHeight;
  });
}

function renderChoices(chat) {
  const el = document.getElementById('choices');
  if (!el || curChatId() !== chat.id) return;
  const last = lastDialog(chat);
  if (S.choiceBusy[chat.id]) el.innerHTML = '<span class="choice-wait"><span class="spin"></span>選択肢を考え中…</span>';
  else if (chat.choices && chat.lastChoices && last && chat.lastChoices.msgId === last.id && !S.gen)
    el.innerHTML = chat.lastChoices.items.map((c, i) => `<button class="choice" data-act="useChoice" data-i="${i}">${esc(c).replace(/\*([^*]+)\*/g, '<i>$1</i>')}</button>`).join('');
  else el.innerHTML = '';
}
function updateComposer() {
  const b = document.getElementById('sendBtn');
  if (!b) return;
  const g = !!(S.gen && S.gen.chatId === curChatId());
  b.classList.toggle('stop', g);
  b.dataset.act = g ? 'stop' : 'send';
  b.setAttribute('aria-label', g ? '停止' : '送信');
  b.innerHTML = g ? ic('stop') : ic('send');
}
function flashMem(text, err) {
  const el = document.getElementById('memFlash');
  if (!el) return;
  el.innerHTML = `${ic('layers', 'xs')}${esc(text)}`;
  el.classList.toggle('err', !!err);
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 2800);
}

/* ---------- エンジンからの通知 ---------- */
const here = chat => isView('chat') && curChatId() === chat.id;
on('gen:changed', chat => { if (here(chat)) { renderMessages(chat, { keep: true }); updateComposer(); renderChoices(chat); if (S.gen) scrollBottom(); } });
on('gen:delta', (chat, msg) => { if (here(chat)) paintStreaming(chat, msg); });
on('gen:status', chat => { if (here(chat)) { const el = document.querySelector('#msgs .gen-status'); if (el) el.textContent = genLabel(); } });
on('choices:changed', chat => renderChoices(chat));
on('memory:changed', chat => {
  if (!here(chat)) return;
  document.getElementById('memBtn')?.classList.toggle('busy', isMemBusy(chat));
  if (!S.gen) renderMessages(chat, { keep: true });
});
on('memory:flash', (chat, text, err) => { if (here(chat)) flashMem(text, err); });
setInterval(() => { if (S.gen) { const el = document.querySelector('#msgs .gen-status'); if (el) el.textContent = genLabel(); } }, 1000);

/* ---------- シート ---------- */
function drawerHTML(chat) {
  const ctx = chatCtx(chat), cfg = llmCfg('main'), talks = talksOf(chat.storyId), bms = chat.messages.filter(m => m.bm).length;
  const chev = ic('right', 'sm');
  const item = (act, label, { sub = '', val = '', arrow = true, data = '' } = {}) => `<button data-act="${act}" ${data}><span class="dm">${label}${sub ? `<small>${sub}</small>` : ''}</span>${val !== '' ? `<span class="val">${esc(val)}</span>` : ''}${arrow ? chev : ''}</button>`;
  const plugItems = collect(ctx.story, 'menu', chat).flat();
  return `<div class="dr-card"><div><small>${esc(cfg.def.label)}</small><b>${esc(cfg.def.kind === 'mock' ? 'デモ' : cfg.model || '未設定')}</b></div><button class="btn primary sm" data-act="modelSheet">変更</button></div>
    <div class="dmenu">
      ${item('newTalk', '新しいトーク', { sub: '内容を保存したまま、新しく始められます', arrow: false })}
      ${item('resumeSheet', '再開', { val: `${talks.length}件` })}
      ${item('deleteChat', 'トーク削除', { arrow: false })}
      <hr>
      ${item('profileSheet', 'トークプロフィール', { val: ctx.user })}
      ${item('toggleChoices', '選択肢', { val: chat.choices ? '使用する' : '使用しない' })}
      ${item('memory', '記憶', { sub: `${tl(chat.mem.turn)}まで記憶済み・${chat.mem.entries.length}件` })}
      ${item('noteSheet', '作者メモ', { sub: '展開の指示を毎ターン反映', val: chat.note?.trim() ? 'あり' : 'なし' })}
      ${item('editStoryFromChat', 'プロットを編集')}
      ${plugItems.length ? '<hr>' + plugItems.map(x => item(x.act, esc(x.label), { sub: x.sub || '', val: x.val ?? '' })).join('') : ''}
      <hr>
      ${item('bookmarks', 'ブックマーク一覧', { val: bms || '', arrow: false })}
      ${item('exportChat', 'トークを書き出す', { arrow: false })}
    </div>
    <button class="dr-exit" data-act="exitRoom">${ic('logout', 'sm')}トークルームを退出</button>`;
}
function modelSheetHTML() {
  const s = S.settings, p = s.provider, cur = s.models[p] || '';
  const list = [...new Set([...(s.recentModels[p] || []), ...(PROVIDERS[p].suggest || [])])].filter(Boolean);
  return `<p class="hint" style="margin:0 0 10px">${esc(PROVIDERS[p].label)}（プロバイダはマイページで変更）</p>
    <div class="menu">${list.map(m => `<button class="${m === cur ? 'on' : ''}" data-act="chooseModel" data-m="${esc(m)}" data-path="models.${p}">${m === cur ? ic('check', 'sm') : '<span class="ic sm"></span>'}${esc(m)}</button>`).join('')}</div>
    <div class="btn-row"><button class="btn sm" data-act="pickModel" data-p="${p}" data-path="models.${p}">${ic('search', 'sm')}一覧から選ぶ</button><button class="btn sm" data-act="goMy">${ic('user', 'sm')}API設定</button></div>
    <label class="field"><span>思考（考えてから書く）</span><select data-set="effort">${EFFORTS.map(([v, l]) => `<option value="${v}" ${s.effort === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint">返信が遅いときは「オフ」にすると速くなります。</div></label>`;
}
function openMsgMenu(chat, msg) {
  const isLastAi = msg.role === 'ai' && lastDialog(chat)?.id === msg.id, processed = msg.id <= chat.mem.lastId;
  const refs = (msg.refs?.length || 0) + (msg.lore?.length || 0);
  openSheet({ id: 'msgmenu', title: `${msg.role === 'user' ? chatCtx(chat).user : 'AI'} · ${tl(msg.turn)}${processed ? ' · 記憶済' : ''}`, data: { chat: chat.id, msg: msg.id }, html: `
    <div class="msg-preview">${esc(plainText(txt(msg)).slice(0, 200))}</div>
    <div class="menu">
      <button data-act="mCopy">${ic('copy')}コピー</button>
      <button data-act="mBookmark" class="${msg.bm ? 'on' : ''}">${ic('bookmark')}${msg.bm ? 'ブックマークを外す' : 'ブックマーク'}</button>
      <button data-act="mEdit">${ic('edit')}編集</button>
      ${msg.role === 'ai' && refs ? `<button data-act="mRefs">${ic('layers')}この応答で参照した記憶・設定（${refs}件）</button>` : ''}
      ${isLastAi ? `<button data-act="regen">${ic('refresh')}再生成（別の候補を作る）</button><button data-act="contMsg">${ic('forward')}続きを書かせる</button>` : ''}
      <button data-act="mDelete">${ic('trash')}このメッセージだけ削除</button>
      <button class="danger" data-act="mRewind">${ic('undo')}ここから下をすべて削除（巻き戻し）<small>記憶もこの時点まで巻き戻します</small></button>
    </div>` });
}
const sheetMsg = el => { const w = sheetOf(el), chat = getChat(w?.dataset.chat); return { w, chat, msg: chat?.messages.find(m => m.id === Number(w.dataset.msg)) }; };
const chatOf = el => getChat(sheetOf(el)?.dataset.chat) || curChat();

function submit(textOverride) {
  const chat = curChat(), ta = document.getElementById('input');
  if (!chat || S.gen) return;
  const text = textOverride ?? ta.value;
  if (textOverride == null) { ta.value = ''; S.ui.drafts[chat.id] = ''; autosize(ta); }
  sendMessage(chat, text);
}

/* ---------- アクション ---------- */
defineActions({
  openChat: el => { closeAllSheets(); if (curView().v === 'chat') S.ui.stack.pop(); go('chat', { id: el.dataset.id }); },
  send: () => submit(),
  stop: () => S.gen?.ctrl.abort(),
  toBottom: () => document.getElementById('msgs')?.scrollTo({ top: 1e9, behavior: 'smooth' }),
  aiTurnBtn: () => { const c = curChat(); if (c && !S.gen) aiTurn(c); },
  insertAst: () => {
    const ta = document.getElementById('input'), chat = curChat();
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s, sel = ta.value.slice(s, e);
    ta.value = ta.value.slice(0, s) + '*' + sel + '*' + ta.value.slice(e);
    const pos = s + 1 + sel.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    autosize(ta);
    if (chat) S.ui.drafts[chat.id] = ta.value;
  },
  useChoice: el => { const chat = curChat(), c = chat?.lastChoices?.items[Number(el.dataset.i)]; if (c) { chat.lastChoices = null; renderChoices(chat); submit(c); } },
  msgTap: el => {
    if (String(window.getSelection?.() || '').length) return;
    const chat = curChat(), m = el.closest('.msg'), msg = chat && m && chat.messages.find(x => x.id === Number(m.dataset.id));
    if (msg) openMsgMenu(chat, msg);
  },
  showMore: () => { const c = curChat(); S.ui.showN[c.id] = (S.ui.showN[c.id] || 80) + 80; renderMessages(c, { keep: true }); },
  swipe: el => { const chat = curChat(), msg = chat.messages.find(m => m.id === Number(el.dataset.id)); if (msg) swipe(chat, msg, Number(el.dataset.dir)); },
  regen: el => { const w = sheetOf(el); if (w) closeSheet(w); const c = curChat(); if (c) regenerate(c); },
  contMsg: el => { const w = sheetOf(el); if (w) closeSheet(w); const c = curChat(); if (c) generate(c, { mode: 'continue' }); },

  mCopy: async el => { const { w, msg } = sheetMsg(el); closeSheet(w); await copyText(txt(msg)); toast('コピーしました', 'ok', 1500); },
  mBookmark: async el => { const { w, chat, msg } = sheetMsg(el); closeSheet(w); msg.bm = !msg.bm; await saveChat(chat); toast(msg.bm ? 'ブックマークしました' : 'ブックマークを外しました', '', 1500); },
  mEdit: el => {
    const { w, chat, msg } = sheetMsg(el);
    closeSheet(w);
    openSheet({ id: 'edit', title: 'メッセージを編集', data: { chat: chat.id, msg: msg.id }, html: `<textarea class="edit-area">${esc(txt(msg))}</textarea>
      ${msg.id <= chat.mem.lastId ? '<p class="hint">このメッセージは記憶に反映済みです。内容を大きく変えたときは、記憶パネルで該当する記憶も直してください。</p>' : ''}
      <div class="btn-row end"><button class="btn" data-act="closeSheet">キャンセル</button><button class="btn primary" data-act="mSaveEdit">保存</button></div>` });
  },
  mSaveEdit: async el => {
    const { w, chat, msg } = sheetMsg(el);
    if (msg) { msg.swipes[msg.sw] = w.querySelector('.edit-area').value; await saveChat(chat); renderMessages(chat, { keep: true }); }
    closeSheet(w);
  },
  mRefs: el => {
    const { w, chat, msg } = sheetMsg(el), ctx = chatCtx(chat);
    closeSheet(w);
    const mems = (msg.refs || []).map(id => chat.mem.entries.find(e => e.id === id)).filter(Boolean);
    const lore = (msg.lore || []).map(id => ctx.story?.lore.find(e => e.id === id)).filter(Boolean);
    openSheet({ id: 'refs', title: 'この応答で参照した記憶・設定', full: true, html: `
      ${lore.length ? `<div class="lbl">キーワード設定（${lore.length}）</div>${lore.map(e => `<div class="mem-e"><div class="mem-text"><b>${esc(e.title || e.keys[0] || '設定')}</b>　<span class="meta">${esc(e.keys.join(', '))}</span></div></div>`).join('')}` : ''}
      <div class="lbl" style="margin-top:12px">記憶（${mems.length}）</div>
      ${mems.map(e => `<div class="mem-e ${e.pinned ? 'pinned' : ''}"><div class="mem-text">${esc(e.text)}</div><div class="mem-meta"><span class="tag">${esc(scopeLabel(e.scope, ctx))}</span>${e.tag ? `<span class="tag">${TAGS[e.tag] || ''}</span>` : ''}<span>${tl(e.turn)}</span></div></div>`).join('') || '<p class="empty-s">記憶はまだありません</p>'}
      <p class="hint">記憶の選び方はマイページ →「記憶の渡し方」で変えられます。確実に入れたい記憶は記憶パネルでピン留めしてください。</p>` });
  },
  mDelete: async el => {
    const { w, chat, msg } = sheetMsg(el);
    closeSheet(w);
    if (S.gen?.chatId === chat.id) return toast('生成中は削除できません', 'warn');
    chat.messages.splice(chat.messages.indexOf(msg), 1);
    await saveChat(chat);
    renderMessages(chat, { keep: true });
    toast(msg.id <= chat.mem.lastId ? '削除しました（記憶に反映済みの内容は残っています）' : '削除しました', '', 3000);
  },
  mRewind: async el => {
    const { w, chat, msg } = sheetMsg(el);
    closeSheet(w);
    if (S.gen?.chatId === chat.id) return toast('生成中は操作できません', 'warn');
    const n = chat.messages.length - chat.messages.indexOf(msg);
    if (!confirm(`このメッセージ以降の${n}件を削除して巻き戻します。よろしいですか？`)) return;
    const r = await rewindTo(chat, msg);
    if (msg.role === 'user') { S.ui.drafts[chat.id] = txt(msg); const ta = document.getElementById('input'); if (ta) { ta.value = txt(msg); autosize(ta); } }
    renderMessages(chat);
    renderChoices(chat);
    toast(r === 'ok' ? '巻き戻しました（記憶もこの時点へ復元）' : r === 'fail' ? '巻き戻しました。※古すぎるため記憶は戻せませんでした。記憶パネルで確認してください。' : '巻き戻しました', r === 'fail' ? 'warn' : 'ok', 4000);
  },

  drawer: () => { const c = curChat(); if (c) openSheet({ id: 'drawer', side: 'right', data: { chat: c.id }, html: drawerHTML(c) }); },
  exitRoom: () => goHome(),
  modelSheet: () => { closeAllSheets(); openSheet({ id: 'model', title: 'モデルを切り替え', html: modelSheetHTML() }); },
  editStoryFromChat: el => { const c = chatOf(el); closeAllSheets(); openEditor(c.storyId); },
  resumeSheet: el => {
    const chat = chatOf(el), talks = talksOf(chat.storyId);
    closeAllSheets();
    openSheet({ id: 'resume', title: 'トークを再開', html: `<div class="menu">${talks.map(c => `<button class="${c.id === chat.id ? 'on' : ''}" data-act="openChat" data-id="${c.id}"><span class="grow">${esc(c.title)}<small>${relTime(c.updatedAt)} ・ ${tl(maxTurn(c))} ・ ${esc(lastDialog(c) ? lastLine(txt(lastDialog(c))) : '')}</small></span></button>`).join('')}</div>` });
  },
  deleteChat: async el => {
    const chat = chatOf(el);
    if (!confirm(`「${chat.title}」を削除します。記憶も含めて元に戻せません。よろしいですか？`)) return;
    await removeChat(chat);
    closeAllSheets();
    if (curView().v === 'chat') S.ui.stack.pop();
    render();
    toast('削除しました');
  },
  profileSheet: el => {
    const chat = chatOf(el);
    closeAllSheets();
    openSheet({ id: 'profile', title: 'トークプロフィール', data: { chat: chat.id }, html: `
      <label class="field"><span>このトークでのあなたの名前</span><input class="pf-name" value="${esc(chat.userName)}"></label>
      <label class="field"><span>このトークでのあなたの設定</span><textarea class="pf-desc" rows="5" placeholder="外見・立場・性格など">${esc(chat.userDesc || '')}</textarea></label>
      <p class="hint">アイコン画像はマイページのプロフィールで変更できます。</p>
      <div class="btn-row end"><button class="btn" data-act="closeSheet">キャンセル</button><button class="btn primary" data-act="saveProfile">保存</button></div>` });
  },
  saveProfile: async el => {
    const w = sheetOf(el), chat = chatOf(el);
    chat.userName = w.querySelector('.pf-name').value.trim() || chat.userName;
    chat.userDesc = w.querySelector('.pf-desc').value;
    await saveChat(chat);
    closeSheet(w);
    render();
    toast('保存しました', 'ok', 1500);
  },
  toggleChoices: async el => {
    const chat = chatOf(el);
    chat.choices = !chat.choices;
    if (!chat.choices) chat.lastChoices = null;
    await saveChat(chat);
    setSheetBody('drawer', drawerHTML(chat));
    renderChoices(chat);
    toast(chat.choices ? '選択肢: 使用する（応答のたびに記憶用モデルで提案します）' : '選択肢: 使用しない', '', 2500);
  },
  noteSheet: el => {
    const chat = chatOf(el);
    closeAllSheets();
    openSheet({ id: 'note', title: '作者メモ', data: { chat: chat.id }, html: `
      <p class="hint" style="margin:0 0 10px">このトークの展開への指示です。毎ターンAIに渡されます（本文では言及されません）。</p>
      <textarea class="note-text" rows="6" placeholder="例: そろそろ二人きりになる場面へ。天気は雨に。">${esc(chat.note || '')}</textarea>
      <div class="btn-row end"><button class="btn" data-act="closeSheet">キャンセル</button><button class="btn primary" data-act="saveNote">保存</button></div>` });
  },
  saveNote: async el => { const w = sheetOf(el), chat = chatOf(el); chat.note = w.querySelector('.note-text').value; await saveChat(chat); closeSheet(w); toast('作者メモを保存しました', 'ok', 1500); },
  bookmarks: el => {
    const chat = chatOf(el), list = chat.messages.filter(m => m.bm);
    closeAllSheets();
    openSheet({ id: 'bms', title: `ブックマーク（${list.length}）`, data: { chat: chat.id }, html: list.length
      ? `<div class="menu">${list.map(m => `<button data-act="jumpMsg" data-id="${m.id}">${ic('bookmark')}<span class="grow">${esc(plainText(txt(m)).slice(0, 80))}<small>${tl(m.turn)}</small></span></button>`).join('')}</div>`
      : '<p class="empty-s">メッセージをタップ →「ブックマーク」で追加できます。</p>' });
  },
  jumpMsg: el => {
    const chat = chatOf(el);
    closeAllSheets();
    const idx = chat.messages.findIndex(m => m.id === Number(el.dataset.id));
    if (idx < 0) return;
    const need = chat.messages.length - idx;
    if ((S.ui.showN[chat.id] || 80) < need) S.ui.showN[chat.id] = need + 10;
    renderMessages(chat, { keep: true });
    const m = document.querySelector(`#msgs .msg[data-id="${el.dataset.id}"]`);
    if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1700); }
  },
  exportChat: el => {
    const chat = chatOf(el), st = getStory(chat.storyId);
    saveFile(`memoria-talk-${safeName(chat.title)}-${ymd()}.json`, JSON.stringify({ app: 'memoria', version: 3, stories: st ? [st] : [], chats: [chat] }));
  },
});
