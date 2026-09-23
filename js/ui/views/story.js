// プロット詳細（表紙・キャラ・設定集・イントロ → トークを始める）
import { S, getStory, talksOf, msgCount, lastDialog, txt, maxTurn, storyCtx, chatCtx, curChat, curView, macros, saveStory, removeStory, addChat, normalizeStory } from '../../core/store.js';
import { esc, fmtCount, relTime, tl, clone, uid, safeName } from '../../core/util.js';
import { parseBlocks, lastLine } from '../../engine/parse.js';
import { createTalk } from '../../engine/chat.js';
import { blockOwners } from '../../plugins/registry.js';
import { ic, avatarHTML, coverHTML, openSheet, closeAllSheets, sheetOf, saveFile, toast } from '../dom.js';
import { blocksHTML } from '../blocks.js';
import { defineView, defineActions, go, render, goHome } from '../app.js';

function clip(key, inner, long) {
  const open = S.ui.expand[key];
  return `<div class="${long && !open ? 'clip' : ''}">${inner}</div>${long ? `<button class="more" data-act="expand" data-k="${key}">${open ? '閉じる' : ic('down')}</button>` : ''}`;
}
function charCard(st, c) {
  const text = [c.profile, c.personality].filter(x => x && x.trim()).join('\n\n');
  return `<div class="ccard">${c.images.length ? `<div class="cc-imgs">${c.images.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}<div class="cc-n">${esc(c.name)}</div>${text ? clip(`${st.id}:c:${c.id}`, `<div class="pre">${esc(text)}</div>`, text.length > 180) : ''}</div>`;
}

defineView('story', {
  render(p) {
    const st = getStory(p.id);
    if (!st) return '';
    const ctx = storyCtx(st), M = t => macros(t, ctx);
    const imgs = [st.cover, ...st.chars.flatMap(c => c.images)].filter(Boolean);
    const hi = Math.min(S.ui.heroIdx || 0, Math.max(0, imgs.length - 1));
    const talks = talksOf(st.id);
    const intro = st.opening?.trim() ? blocksHTML(parseBlocks(M(st.opening), ctx.chars, blockOwners(st)), ctx, { tap: false }) : '';
    const loreN = st.lore.filter(e => e.on).length;
    return `<div class="detail-top" id="detailTop"><button class="icon-btn" data-act="back" aria-label="戻る">${ic('back')}</button><span class="dt-title">${esc(st.title)}</span><button class="icon-btn" data-act="goHomeBtn" aria-label="ホーム">${ic('home')}</button><button class="icon-btn" data-act="storyMenu" data-id="${st.id}" aria-label="メニュー">${ic('dots')}</button></div>
    <main class="scroll">
      <div class="hero">${imgs.length ? `<img src="${esc(imgs[hi])}" alt="">` : coverHTML(st, 110)}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button class="thumb ${i === hi ? 'on' : ''}" data-act="heroPick" data-i="${i}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
      <div class="d-body">
        <h1 class="d-title">${esc(st.title)}</h1>
        ${st.description ? `<p class="d-desc">${esc(st.description)}</p>` : ''}
        ${st.tags.length ? `<div class="d-tags">${st.tags.map(x => '#' + esc(x)).join(' ')}</div>` : ''}
        <div class="d-stats"><span>${ic('chat', 'xs')}${fmtCount(msgCount(st.id))}</span>${st.world.trim() || loreN ? `<button data-act="scrollToSec" data-to="sec-world">${ic('book', 'xs')}設定集</button>` : ''}<span>${ic('talk', 'xs')}トーク ${talks.length}</span></div>
        <hr>
        ${st.chars.some(c => c.name) ? `<h2 class="d-h">プロット</h2>${st.chars.filter(c => c.name).map(c => charCard(st, c)).join('')}` : ''}
        ${st.prompt.trim() ? `<h2 class="d-h">ストーリー</h2>${clip(st.id + ':prompt', `<div class="pre">${esc(M(st.prompt))}</div>`, st.prompt.length > 220)}` : ''}
        ${st.userRole.trim() ? `<h2 class="d-h">あなたの役</h2><div class="pre">${esc(M(st.userRole))}</div>` : ''}
        ${st.world.trim() || loreN ? `<h2 class="d-h" id="sec-world">設定集</h2>${st.world.trim() ? clip(st.id + ':world', `<div class="pre">${esc(M(st.world))}</div>`, st.world.length > 220) : ''}${loreN ? `<p class="hint">キーワードで呼び出される設定 ${loreN}件</p>` : ''}` : ''}
        ${intro ? `<h2 class="d-h">イントロ</h2>${clip(st.id + ':intro', `<div class="intro">${intro}</div>`, st.opening.length > 160)}` : ''}
        ${st.creatorNote.trim() ? `<h2 class="d-h">クリエイターコメント</h2><div class="pre">${esc(st.creatorNote)}</div>` : ''}
        ${talks.length ? `<h2 class="d-h">トーク履歴</h2><div class="list flush">${talks.map(c => `<button class="row" data-act="openChat" data-id="${c.id}"><div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(lastDialog(c) ? lastLine(txt(lastDialog(c))) : '')}</div></div><div class="row-meta">${relTime(c.updatedAt)}<br><span class="pill">${tl(maxTurn(c))}</span></div></button>`).join('')}</div><button class="btn block" data-act="newTalk" data-story="${st.id}">${ic('plus', 'sm')}新しいトークを始める</button>` : ''}
      </div>
    </main>
    <div class="d-bar"><button class="fav ${st.fav ? 'on' : ''}" data-act="favStory" data-id="${st.id}" aria-label="ブックマーク">${ic('bookmark')}</button><button class="btn primary" data-act="startTalk" data-id="${st.id}">${talks.length ? '続きから' : 'トークを始める'}</button></div>`;
  },
  mount() {
    const sc = document.querySelector('#view .scroll'), top = document.getElementById('detailTop'), hero = document.querySelector('#view .hero');
    if (!sc || !top || !hero) return;
    const upd = () => top.classList.toggle('solid', sc.scrollTop > hero.offsetHeight - top.offsetHeight - 10);
    sc.addEventListener('scroll', upd, { passive: true });
    requestAnimationFrame(upd);
  },
});

/* ---------- トークの開始（プロフィールを選べる場合は選択シートを出す） ---------- */
async function openNewTalk(story, profile) {
  const chat = createTalk(story, profile);
  await addChat(chat);
  closeAllSheets();
  if (curView().v === 'chat') S.ui.stack.pop();
  go('chat', { id: chat.id });
}
export function beginTalk(story) {
  const profiles = story.profiles.filter(p => p.name.trim());
  if (!profiles.length) return openNewTalk(story, null);
  const me = S.settings.persona;
  closeAllSheets();
  openSheet({ id: 'profiles', title: 'トークプロフィールを選択', data: { story: story.id }, html: `<p class="hint" style="margin:0 0 8px">このトークであなたが演じる人物を選んでください。</p><div class="menu">
    <button data-act="pickProfile" data-i="-1">${avatarHTML({ name: me.name, avatar: me.avatar }, 40)}<span class="grow">${esc(me.name)}<small>マイプロフィール</small></span></button>
    ${profiles.map(p => `<button data-act="pickProfile" data-i="${story.profiles.indexOf(p)}">${avatarHTML({ name: p.name }, 40)}<span class="grow">${esc(p.name)}<small>${esc(p.desc.slice(0, 60))}</small></span></button>`).join('')}</div>` });
}

defineActions({
  goHomeBtn: () => goHome('home'),
  heroPick: el => { S.ui.heroIdx = Number(el.dataset.i); render(); },
  expand: el => { const k = el.dataset.k; S.ui.expand[k] = !S.ui.expand[k]; render(); },
  scrollToSec: el => document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  favStory: async el => { const st = getStory(el.dataset.id); st.fav = !st.fav; await saveStory(st); render(); toast(st.fav ? 'ブックマークしました' : 'ブックマークを外しました', '', 1500); },
  startTalk: el => {
    const st = getStory(el.dataset.id), talks = talksOf(st.id);
    return talks.length ? go('chat', { id: talks[0].id }) : beginTalk(st);
  },
  newTalk: el => {
    const st = getStory(el.dataset.story) || (curChat() && chatCtx(curChat()).story);
    if (!st) return toast('プロットが見つかりません', 'warn');
    if (talksOf(st.id).length && !confirm(`「${st.title}」の新しいトークを始めます。今までのトークは保存され、「再開」から戻れます。`)) return;
    return beginTalk(st);
  },
  pickProfile: el => {
    const st = getStory(sheetOf(el).dataset.story), i = Number(el.dataset.i);
    return openNewTalk(st, i >= 0 ? st.profiles[i] : null);
  },
  storyMenu: el => {
    const id = el.dataset.id;
    openSheet({ id: 'storymenu', title: getStory(id)?.title || '', html: `<div class="menu">
      <button data-act="editStory" data-id="${id}">${ic('edit')}プロットを編集</button>
      <button data-act="newTalk" data-story="${id}">${ic('plus')}新しいトークを始める</button>
      <button data-act="dupStory" data-id="${id}">${ic('copy')}複製</button>
      <button data-act="exportStory" data-id="${id}">${ic('download')}書き出し</button>
      <button class="danger" data-act="deleteStory" data-id="${id}">${ic('trash')}削除</button></div>` });
  },
  dupStory: async el => {
    closeAllSheets();
    const src = clone(getStory(el.dataset.id));
    const st = normalizeStory({ ...src, id: uid(), title: src.title + '（コピー）', chars: src.chars.map(c => ({ ...c, id: uid() })), fav: false, createdAt: Date.now() });
    await saveStory(st);
    go('story', { id: st.id });
  },
  exportStory: el => { closeAllSheets(); const st = getStory(el.dataset.id); saveFile(`${safeName(st.title)}.memoria.json`, JSON.stringify({ app: 'memoria-story', version: 3, story: st })); },
  deleteStory: async el => {
    const st = getStory(el.dataset.id), n = talksOf(st.id).length;
    if (!confirm(`「${st.title || '（無題）'}」を削除します。${n ? `このプロットのトーク${n}件（記憶を含む）も削除されます。` : ''}元に戻せません。`)) return;
    await removeStory(st);
    S.draft = null;
    goHome(S.ui.tab === 'create' ? 'create' : 'home');
    toast('削除しました');
  },
});
