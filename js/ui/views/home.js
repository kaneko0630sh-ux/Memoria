// ホーム（タブ: ホーム / 作成 / トーク / マイページ）
import { S, talksOf, msgCount, lastDialog, txt, maxTurn, getStory, saveSettings, storyIssues } from '../../core/store.js';
import { esc, fmtCount, relTime, tl } from '../../core/util.js';
import { lastLine } from '../../engine/parse.js';
import { ic, coverHTML, openSheet, closeSheet, sheetOf } from '../dom.js';
import { defineView, defineActions, go, render, goHome } from '../app.js';
import { myPageHTML, mountMyPage } from './settings.js';
import { loadSamples, importStoryFile, importStoryText } from '../../io/porting.js';

const PLOT_MAKER = 'https://github.com/kaneko0630sh-ux/Memoria/tree/main/tools/plot-maker';

const TABS = [['home', 'ホーム', 'home'], ['create', '作成', 'create'], ['talks', 'トーク', 'talk'], ['my', 'マイページ', 'user']];
const published = () => S.stories.filter(s => !s.draft);

defineView('home', {
  render() {
    const t = S.ui.tab;
    const body = { home: homeTab, create: createTab, talks: talksTab, my: myPageHTML }[t]();
    const head = t === 'home' ? homeHead() : `<header class="home-head"><span class="ht on">${{ create: '作成', talks: 'トーク', my: 'マイページ' }[t]}</span></header>`;
    return `${head}<main class="scroll">${body}</main>
      <nav class="tabbar">${TABS.map(([k, l, i]) => `<button class="tab ${k === t ? 'on' : ''}" data-act="tab" data-tab="${k}">${ic(i)}<span>${l}</span></button>`).join('')}</nav>`;
  },
  mount() {
    const q = document.getElementById('homeQ');
    if (q) {
      q.addEventListener('input', () => { S.ui.homeQ = q.value; const g = document.getElementById('sgrid'); if (g) g.innerHTML = gridHTML(); });
      if (!q.value) q.focus();
    }
    if (S.ui.tab === 'my') mountMyPage();
  },
});

function homeHead() {
  const u = S.ui, tags = [...new Set(published().flatMap(s => s.tags || []))].slice(0, 16);
  return `<header class="home-head"><button class="ht ${u.homeSort === 'rec' ? 'on' : ''}" data-act="homeSort" data-v="rec">ホーム</button><button class="ht ${u.homeSort === 'rank' ? 'on' : ''}" data-act="homeSort" data-v="rank">ランキング</button><span class="grow"></span><button class="icon-btn" data-act="homeSearch" aria-label="検索">${ic('search')}</button></header>
    ${u.homeQ != null ? `<div class="search-row"><input type="search" id="homeQ" placeholder="タイトル・タグ・キャラ名で検索" value="${esc(u.homeQ)}" autocapitalize="off"></div>` : ''}
    ${published().length ? `<div class="chips">${[['', 'おすすめ'], ['★', 'ブックマーク'], ...tags.map(x => [x, x])].map(([v, l]) => `<button class="chip ${u.homeTag === v ? 'on' : ''}" data-act="homeTag" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>` : ''}`;
}
function homeTab() { return published().length ? `<div class="sgrid" id="sgrid">${gridHTML()}</div>` : welcomeHTML(); }

function gridHTML() {
  const u = S.ui;
  let list = published();
  if (u.homeTag === '★') list = list.filter(s => s.fav);
  else if (u.homeTag) list = list.filter(s => (s.tags || []).includes(u.homeTag));
  const q = (u.homeQ || '').trim().toLowerCase();
  if (q) list = list.filter(s => [s.title, s.description, ...(s.tags || []), ...s.chars.map(c => c.name)].join(' ').toLowerCase().includes(q));
  const counts = new Map(list.map(s => [s.id, msgCount(s.id)]));
  const lastUse = s => talksOf(s.id)[0]?.updatedAt || s.updatedAt || 0;
  list.sort(u.homeSort === 'rank' ? (a, b) => counts.get(b.id) - counts.get(a.id) : (a, b) => lastUse(b) - lastUse(a));
  if (!list.length) return '<p class="empty-s" style="grid-column:1/-1">該当するプロットがありません</p>';
  return list.map((s, i) => {
    const n = counts.get(s.id), talk = talksOf(s.id)[0], last = talk && lastDialog(talk);
    return `<button class="scard" data-act="openStory" data-id="${s.id}"><div class="sc-img">${coverHTML(s)}${n ? `<span class="sc-badge">${ic('chat', 'xs')}${fmtCount(n)}</span>` : ''}${u.homeSort === 'rank' ? `<span class="sc-rank">${i + 1}</span>` : ''}</div>
      <div class="sc-body"><div class="sc-title">${esc(s.title)}</div>${s.description ? `<div class="sc-desc">${esc(s.description)}</div>` : ''}${s.tags?.length ? `<div class="sc-tags">${s.tags.map(x => '#' + esc(x)).join(' ')}</div>` : ''}${last ? `<div class="sc-cont">${esc(lastLine(txt(last)))}…と続きから</div>` : ''}</div></button>`;
  }).join('');
}

function welcomeHTML() {
  return `<div class="welcome"><div class="logo">${ic('layers')}</div><h2>Memoria へようこそ</h2>
    <p>ターンごとに事実を積み重ねる「記憶」を持った<br>AIロールプレイチャットです。</p>
    <ol class="steps"><li><b>APIを設定</b><span>マイページでプロバイダ・APIキー・モデルを入力</span></li>
    <li><b>プロットを用意</b><span>キャラ・世界観・導入をまとめた物語。自作・サンプル・SillyTavernカードから</span></li>
    <li><b>トークを始める</b><span>記憶は毎ターン自動で積み上がり、整理されます</span></li></ol>
    <div class="btn-col"><button class="btn primary" data-act="loadSample">サンプルを読み込む</button><button class="btn" data-act="tab" data-tab="my">APIを設定する</button><button class="btn ghost" data-act="useDemo">APIなしでデモを試す</button></div></div>`;
}

function createTab() {
  const list = S.stories.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return `<div class="create-top">
    <button class="btn primary block" data-act="newStory">${ic('plus', 'sm')}新しいプロットを作る</button>
    <div class="btn-row"><button class="btn sm" data-act="importStory">${ic('upload', 'sm')}ファイルから読み込む</button><button class="btn sm" data-act="pasteStory">${ic('copy', 'sm')}テキストを貼り付けて読み込む</button><button class="btn sm" data-act="loadSample">サンプルを追加</button></div>
    <p class="hint">SillyTavern のキャラクターカード（PNG / JSON）や、Memoria で書き出したプロットを読み込めます。Claude や ChatGPT にヒアリングしてもらってプロットを作るなら <a href="${PLOT_MAKER}" target="_blank" rel="noopener">プロット作成ツール</a> を。</p></div>
    <div class="sec-h">あなたのプロット（${list.length}）</div>
    <div class="list">${list.map(s => `<button class="row" data-act="editStory" data-id="${s.id}"><span class="thumb-sq">${coverHTML(s, 22)}</span><div class="row-main"><div class="row-title">${esc(s.title || '（無題）')}${s.draft ? ' <span class="pill warn">下書き</span>' : ''}</div><div class="row-sub">${esc(s.chars.map(c => c.name).filter(Boolean).join('・') || 'キャラ未設定')}${!storyIssues(s).ok ? ' ・ 未入力の必須項目あり' : ''}</div></div>${ic('edit', 'sm')}</button>`).join('') || '<p class="empty-s">まだプロットがありません</p>'}</div>`;
}

function talksTab() {
  if (!S.chats.length) return '<div class="empty"><h2>トークはまだありません</h2><p>ホームからプロットを選んで「トークを始める」を押しましょう。</p></div>';
  return `<div class="list">${S.chats.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(c => {
    const st = getStory(c.storyId), last = lastDialog(c);
    return `<button class="row" data-act="openChat" data-id="${c.id}"><span class="thumb-sq">${coverHTML(st, 22)}</span><div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(last ? lastLine(txt(last)) : '')}</div></div><div class="row-meta">${relTime(c.updatedAt)}<br><span class="pill">${tl(maxTurn(c))}</span></div></button>`;
  }).join('')}</div>`;
}

defineActions({
  tab: el => goHome(el.dataset.tab),
  homeSort: el => { S.ui.homeSort = el.dataset.v; render(); },
  homeTag: el => { S.ui.homeTag = el.dataset.v; render(); },
  homeSearch: () => { S.ui.homeQ = S.ui.homeQ == null ? '' : null; render(); },
  openStory: el => { S.ui.heroIdx = 0; go('story', { id: el.dataset.id }); },
  loadSample: async () => { await loadSamples(); goHome('home'); },
  useDemo: async () => { S.settings.provider = 'mock'; await saveSettings(); await loadSamples(); goHome('home'); },
  importStory: async () => { const st = await importStoryFile(); if (st) go('story', { id: st.id }); },
  pasteStory: () => openSheet({
    id: 'paste-story', title: 'テキストを貼り付けて読み込む',
    html: `<p class="hint">プロット作成ツール（Claude / ChatGPT）が出力した JSON を、そのまま貼り付けてください。前後の文章やコードブロックの囲みが混ざっていても大丈夫です。</p>
      <textarea id="pasteStoryText" rows="10" placeholder='{"app":"memoria-story", ...}' autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <div class="btn-row end"><button class="btn" data-act="closeSheet">キャンセル</button><button class="btn primary" data-act="pasteStoryOk">読み込む</button></div>`,
  }),
  pasteStoryOk: async el => {
    const text = document.getElementById('pasteStoryText')?.value || '';
    if (!text.trim()) return;
    const st = await importStoryText(text);
    if (!st) return;
    closeSheet(sheetOf(el));
    go('story', { id: st.id });
  },
});
