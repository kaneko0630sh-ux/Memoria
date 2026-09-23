// プロット編集（タブ: プロンプト / 設定集 / スタイル / プラグイン / イントロ / 紹介 / 詳細）
// 編集中は S.draft（コピー）を data-draft で直接書き換え、「一時保存」「完成」で保存する
import { S, LIMITS, getStory, talksOf, storyCtx, storyIssues, promptChars, normalizeStory, normalizeChar, normalizeLore, newStory, saveStory, curView, macros } from '../../core/store.js';
import { esc, clone, uid, hhmm } from '../../core/util.js';
import { STYLE_GROUPS, STYLE_SECTIONS, INFOBOX_OPTIONS } from '../../engine/style.js';
import { parseBlocks, textToItems, itemsToText } from '../../engine/parse.js';
import { loreFromJSON } from '../../engine/lorebook.js';
import { allPlugins, getPlugin, blockOwners } from '../../plugins/registry.js';
import { readCardFile } from '../../io/porting.js';
import { ic, openSheet, closeAllSheets, toast, pickFile, fileToImage, segButtons, draftInput } from '../dom.js';
import { blocksHTML } from '../blocks.js';
import { defineView, defineActions, go, back, render } from '../app.js';

const TABS = [['prompt', 'プロンプト'], ['lore', '設定集'], ['style', 'スタイル'], ['plugins', 'プラグイン'], ['intro', 'イントロ'], ['intro2', '紹介'], ['detail', '詳細']];
const d = () => S.draft;
const dirty = () => { S.ui.edDirty = true; };

export function openEditor(storyId) {
  const src = storyId ? getStory(storyId) : null;
  const st = src ? normalizeStory(clone(src)) : newStory();
  st._intro = textToItems(st.opening, st.chars);
  S.draft = st;
  S.ui.edTab = 'prompt';
  S.ui.edDirty = false;
  S.ui.edOpen = {};
  go('editor', { id: st.id });
}

/* ---------- 各タブ ---------- */
function promptTab() {
  const st = d(), named = st.chars.some(c => c.name.trim());
  return `<div class="ed-count" id="edCount">${countText()}</div>
  <h3 class="ed-h">基本設定</h3>
  <div class="ed-card">
    ${draftInput('title', st.title, { label: '題名', max: LIMITS.title, req: true, ph: '例) この夏、私たち幼馴染じゃいられない' })}
    ${draftInput('prompt', st.prompt, { label: '説明', rows: 6, ph: '状況、関係性、世界観等を説明してください' })}
    <button class="opt-toggle" data-act="edToggle" data-k="opt">オプション設定 ${ic(S.ui.edOpen.opt ? 'up' : 'down', 'sm')}</button>
    ${S.ui.edOpen.opt ? draftInput('userRole', st.userRole, { label: 'あなたの役', rows: 3, ph: '例) 霧の夜に古書店を訪ねた旅人。師匠の失踪について何かを知っている' })
      + draftInput('guide', st.guide, { label: 'AIへの追加指示', rows: 3, ph: '例) 恋愛描写はゆっくり進める。暴力の描写は控えめに' }) : ''}
  </div>
  <h3 class="ed-h">キャラクター</h3>
  ${st.chars.map((c, i) => charCard(c, i)).join('')}
  <button class="btn block add-btn" data-act="edAddChar" ${st.chars.length >= LIMITS.chars ? 'disabled' : ''}>${ic('plus', 'sm')}キャラクター追加 ${st.chars.length}/${LIMITS.chars}</button>
  <button class="btn sm ghost" data-act="edImportCard">${ic('upload', 'sm')}キャラカード（PNG/JSON）から追加</button>
  <hr class="ed-sep">
  <h3 class="ed-h">ユーザーが使用する、<br>トークプロフィールを作成</h3><p class="hint">文字数には含まれません。トーク開始時に選べます。</p>
  ${st.profiles.map((p, i) => `<div class="ed-card"><div class="ed-card-h"><b>プロフィール ${i + 1}</b><button class="icon-btn" data-act="edRemove" data-list="profiles" data-i="${i}" aria-label="削除">${ic('trash', 'sm')}</button></div>
    ${draftInput(`profiles.${i}.name`, p.name, { label: '名前', max: LIMITS.charName, ph: '例) 瑠奈' })}${draftInput(`profiles.${i}.desc`, p.desc, { label: '設定', rows: 3, ph: '外見・立場・キャラとの関係など' })}</div>`).join('')}
  <button class="btn block add-btn" data-act="edAddProfile" ${st.profiles.length >= LIMITS.profiles ? 'disabled' : ''}>${ic('plus', 'sm')}トークプロフィール追加 ${st.profiles.length}/${LIMITS.profiles}</button>
  <hr class="ed-sep">
  <h3 class="ed-h">状況例でキャラの<br>性格と口調を表現！</h3><p class="hint">全体の字数には含まれません。「こんな状況ならこう返す」の例を書くと、口調が安定します。</p>
  ${st.examples.map((x, i) => `<div class="ed-card"><div class="ed-card-h"><b>状況例 ${i + 1}</b><button class="icon-btn" data-act="edRemove" data-list="examples" data-i="${i}" aria-label="削除">${ic('trash', 'sm')}</button></div>
    ${st.chars.filter(c => c.name).length > 1 ? `<label class="field"><span>キャラクター</span><select data-draft="examples.${i}.charId">${st.chars.filter(c => c.name).map(c => `<option value="${c.id}" ${x.charId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    ${draftInput(`examples.${i}.situation`, x.situation, { label: '状況', rows: 2, ph: '例) {{user}}が遅刻してきた' })}${draftInput(`examples.${i}.reply`, x.reply, { label: 'キャラの反応', rows: 3, ph: '例) *腕を組んだまま、時計を見せつける* ……三十分。言い訳を聞こうか' })}</div>`).join('')}
  <button class="btn block add-btn" data-act="edAddExample" ${named ? '' : 'disabled'}>${named ? `${ic('plus', 'sm')}状況例を追加` : 'キャラの名前を先に入力して下さい'}</button>`;
}
function charCard(c, i) {
  const st = d();
  return `<div class="ed-card">
    ${st.chars.length > 1 ? `<div class="ed-card-h"><b>キャラクター ${i + 1}</b><button class="icon-btn" data-act="edRemove" data-list="chars" data-i="${i}" aria-label="削除">${ic('trash', 'sm')}</button></div>` : ''}
    <div class="img-row">${c.images.map((u, j) => `<div class="img-tile"><img src="${esc(u)}" alt=""><button class="img-x" data-act="edRemoveImage" data-i="${i}" data-j="${j}" aria-label="削除">${ic('x', 'xs')}</button>${j === 0 ? '<span class="img-main">アイコン</span>' : ''}</div>`).join('')}
      ${c.images.length < LIMITS.images ? `<button class="img-add" data-act="edAddImage" data-i="${i}">${ic('plus')}<span>${c.images.length}/${LIMITS.images}<br><i class="req">*</i>キャラクター<br>イメージ</span></button>` : ''}</div>
    ${draftInput(`chars.${i}.name`, c.name, { label: '名前', max: LIMITS.charName, req: true, ph: '短い方がみんな呼びやすいかも…? 例) ヤマト' })}
    ${draftInput(`chars.${i}.profile`, c.profile, { label: 'プロフィール', rows: 5, ph: 'キャラクターの外見的特徴、性格、趣味などを記入すると、より個性溢れるキャラクターを作ることができます！\n例) ヤマトはとても優しい高身長イケメン。だけど料理だけはどうしても苦手。' })}
    <button class="opt-toggle" data-act="edToggle" data-k="c${i}">詳しく設定 ${ic(S.ui.edOpen['c' + i] ? 'up' : 'down', 'sm')}</button>
    ${S.ui.edOpen['c' + i] ? draftInput(`chars.${i}.personality`, c.personality, { label: '性格', rows: 2 })
      + draftInput(`chars.${i}.speech`, c.speech, { label: '口調・話し方', rows: 3, ph: '一人称、語尾、相手の呼び方、口癖など' })
      + draftInput(`chars.${i}.note`, c.note, { label: '補足・演技指示', rows: 2 }) : ''}
  </div>`;
}
const countText = () => { const n = promptChars(d()); return `<span class="${n > LIMITS.promptSoft ? 'over' : ''}">${n.toLocaleString()}</span> / 目安 ${LIMITS.promptSoft.toLocaleString()}字`; };

function loreTab() {
  const st = d();
  return `<h3 class="ed-h">常に参照する設定</h3>
  <div class="ed-card">${draftInput('world', st.world, { rows: 10, ph: '世界観・地理・勢力・ルールなど。キーワードに関係なく毎回AIに渡されます。', hint: '長いほど毎回の送信量が増えます。細かい設定は下のキーワード設定に分けるのがおすすめです。' })}</div>
  <h3 class="ed-h">キーワード設定（ロアブック）</h3>
  <p class="hint">会話にキーワードが出たときだけ呼び出される設定です（直近${S.settings.lore.depth}件の会話を見ます）。</p>
  ${st.lore.map((e, i) => `<div class="ed-card ${e.on ? '' : 'off'}">
    <div class="ed-card-h"><input class="lore-title" data-draft="lore.${i}.title" value="${esc(e.title)}" placeholder="項目名（例: 灰の手）"><button class="icon-btn" data-act="edRemove" data-list="lore" data-i="${i}" aria-label="削除">${ic('trash', 'sm')}</button></div>
    <label class="field"><span>キーワード（カンマ区切り）</span><input data-draft="lore.${i}.keys" data-list="1" value="${esc(e.keys.join(', '))}" placeholder="例: 灰の手, 密輸組合"></label>
    ${draftInput(`lore.${i}.content`, e.content, { label: '内容', rows: 4 })}
    <div class="lore-flags"><label class="switch sm"><span>有効</span><input type="checkbox" class="tgl" data-draft="lore.${i}.on" ${e.on ? 'checked' : ''}></label><label class="switch sm"><span>常時（キーワードなしでも入れる）</span><input type="checkbox" class="tgl" data-draft="lore.${i}.always" ${e.always ? 'checked' : ''}></label></div>
  </div>`).join('')}
  <button class="btn block add-btn" data-act="edAddLore">${ic('plus', 'sm')}キーワード設定を追加</button>
  <button class="btn sm ghost" data-act="edImportLore">${ic('upload', 'sm')}ロアブック（JSON）を取り込む</button>`;
}

function styleTab() {
  const s = d().style;
  const sel = (path, list, cur) => `<select data-draft="${path}">${list.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<h3 class="ed-title">スタイルを自由に調整！</h3>
  <h3 class="ed-h">プレイシステム</h3>
  <div class="ed-card rows">
    <label class="ed-row"><span>ユーザーターンに選択肢を提供</span><input type="checkbox" class="tgl" data-draft="style.choices" ${s.choices ? 'checked' : ''}></label>
    <label class="ed-row"><span>背景のインフォボックス</span>${sel('style.infoBg', INFOBOX_OPTIONS, s.infoBg)}</label>
    <label class="ed-row"><span>キャラのインフォボックス</span>${sel('style.infoChar', INFOBOX_OPTIONS, s.infoChar)}</label>
  </div>
  ${STYLE_SECTIONS.map(sec => `<h3 class="ed-h">${sec.title}</h3><div class="ed-card">${sec.groups.map(g => {
    const G = STYLE_GROUPS[g];
    return `<div class="ed-group"><div class="lbl">${G.label}${G.note ? ` <small>（${G.note}）</small>` : ''}</div>${segButtons({ act: 'edStyle', group: g, options: G.options, value: s[g], cols: G.cols || 4, multi: !!G.multi })}</div>`;
  }).join('')}</div>`).join('')}`;
}

function pluginsTab() {
  const st = d();
  return `<h3 class="ed-h">プラグイン</h3><p class="hint">プロットごとに機能を追加できます。</p>
  ${allPlugins().map(p => {
    const cfg = st.plugins[p.id] || {}, on = !!cfg.on;
    return `<div class="ed-card pl-card"><div class="pl-row"><div class="grow"><b>${esc(p.name)}</b> <button class="help-btn" data-act="edPluginHelp" data-id="${p.id}" aria-label="説明">${ic('help', 'xs')}</button><p class="hint">${esc(p.desc)}</p></div><input type="checkbox" class="tgl" data-draft="plugins.${p.id}.on" ${on ? 'checked' : ''}></div>
      ${on && p.fields?.length ? `<div class="pl-cfg">${p.fields.map(f => pluginField(p, f, cfg[f.key] ?? p.defaults?.[f.key])).join('')}</div>` : ''}</div>`;
  }).join('')}`;
}
function pluginField(p, f, v) {
  const path = `plugins.${p.id}.${f.key}`;
  if (f.type === 'select') return `<label class="field"><span>${esc(f.label)}</span><select data-draft="${path}">${f.options.map(([ov, l]) => `<option value="${ov}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<label class="field"><span>${esc(f.label)}</span><input ${f.type === 'number' ? `type="number" inputmode="numeric" min="${f.min ?? ''}" max="${f.max ?? ''}"` : ''} data-draft="${path}" value="${esc(v ?? '')}"></label>`;
}

function introTab() {
  const st = d(), names = st.chars.filter(c => c.name.trim()).map(c => c.name);
  return `<h3 class="ed-h">イントロ</h3><p class="hint">トークを始めたときに最初に表示される場面です。キャラのブロックでは *動作や表情* を書いて改行し、台詞を書きます。{{user}} はあなたの名前に置き換わります。</p>
  ${st._intro.map((it, i) => `<div class="ed-card intro-item">
    <div class="ed-card-h">${it.type === 'narr' ? `<b>${ic('lines', 'sm')}ナレーション</b>` : `<select data-draft="_intro.${i}.name">${[...new Set([...names, it.name].filter(Boolean))].map(n => `<option ${n === it.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`}
      <span class="grow"></span><button class="icon-btn" data-act="edIntroMove" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">${ic('up', 'sm')}</button><button class="icon-btn" data-act="edIntroMove" data-i="${i}" data-dir="1" ${i === st._intro.length - 1 ? 'disabled' : ''} aria-label="下へ">${ic('down', 'sm')}</button><button class="icon-btn" data-act="edRemove" data-list="_intro" data-i="${i}" aria-label="削除">${ic('trash', 'sm')}</button></div>
    <textarea data-draft="_intro.${i}.text" rows="4" placeholder="${it.type === 'narr' ? '情景・場面の描写' : '*動作や表情*\n台詞'}">${esc(it.text)}</textarea></div>`).join('')}
  <div class="btn-row"><button class="btn sm" data-act="edIntroAdd" data-type="narr">${ic('plus', 'sm')}ナレーション</button><button class="btn sm" data-act="edIntroAdd" data-type="char" ${names.length ? '' : 'disabled'}>${ic('plus', 'sm')}キャラの台詞</button></div>
  <h3 class="ed-h">プレビュー</h3><div class="ed-card preview" id="introPreview">${introPreview()}</div>`;
}
function introPreview() {
  const st = d(), ctx = storyCtx(st), text = itemsToText(st._intro);
  return text ? blocksHTML(parseBlocks(macros(text, ctx), ctx.chars, blockOwners(st)), ctx, { tap: false }) : '<p class="empty-s">まだイントロがありません</p>';
}

function introduceTab() {
  const st = d();
  return `<h3 class="ed-h">紹介</h3>
  <div class="ed-card"><div class="cover-edit"><button class="cover-pick" data-act="edCover">${st.cover ? `<img src="${esc(st.cover)}" alt="">` : `<span>${ic('image')}<br>表紙画像</span>`}</button>
    <div class="grow"><p class="hint">ホームのカードとプロット詳細の上部に表示されます。未設定ならキャラクターの画像を使います。</p>${st.cover ? '<button class="btn sm ghost" data-act="edCoverClear">画像を外す</button>' : ''}</div></div>
    ${draftInput('description', st.description, { label: '紹介文（カードに表示）', rows: 3, max: 120, ph: '例) 閉店間際の古書店に、霧を連れた客が来た' })}
    <label class="field"><span>タグ（カンマ区切り）</span><input data-draft="tags" data-list="1" value="${esc(st.tags.join(', '))}" placeholder="例: ミステリー, ファンタジー, 古書店"></label>
    ${draftInput('creatorNote', st.creatorNote, { label: 'クリエイターコメント（任意）', rows: 3 })}</div>`;
}

function detailTab() {
  const st = d(), saved = getStory(st.id);
  return `<h3 class="ed-h">詳細</h3>
  <div class="ed-card rows">
    <div class="ed-row"><span>状態</span><span class="meta">${saved ? (saved.draft ? '下書き' : '公開中（ホームに表示）') : '未保存'}</span></div>
    ${saved ? `<div class="ed-row"><span>作成</span><span class="meta">${hhmm(saved.createdAt)}</span></div><div class="ed-row"><span>更新</span><span class="meta">${hhmm(saved.updatedAt)}</span></div><div class="ed-row"><span>トーク</span><span class="meta">${talksOf(st.id).length}件</span></div>` : ''}
  </div>
  ${saved ? `<div class="btn-row"><button class="btn sm" data-act="exportStory" data-id="${st.id}">${ic('download', 'sm')}このプロットを書き出す</button><button class="btn sm danger" data-act="deleteStory" data-id="${st.id}">${ic('trash', 'sm')}削除</button></div>` : ''}`;
}

const TAB_RENDER = { prompt: promptTab, lore: loreTab, style: styleTab, plugins: pluginsTab, intro: introTab, intro2: introduceTab, detail: detailTab };

defineView('editor', {
  ownScroll: false,
  render() {
    const st = d();
    if (!st) return '';
    const issues = storyIssues(st), tab = S.ui.edTab;
    const badge = k => (k === 'prompt' && issues.prompt.length ? '<i class="bad">!</i>' : '');
    return `<header class="topbar ed-top"><button class="icon-btn" data-act="edClose" aria-label="閉じる">${ic('x')}</button><h1 class="title">プロット</h1><span class="grow"></span>
      <button class="btn sm ghost-fill" data-act="edSave">一時保存</button><button class="btn sm ${issues.ok ? 'primary' : 'ghost-fill'}" data-act="edDone">完成</button></header>
      <nav class="ed-tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="edTab" data-tab="${k}">${k === 'prompt' || k === 'intro' ? '<sup>*</sup>' : ''}${l}${badge(k)}</button>`).join('')}</nav>
      <main class="scroll form">${TAB_RENDER[tab]()}</main>`;
  },
  mount() { document.querySelector('.ed-tabs .on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); },
  onInput(el) {
    dirty();
    const path = el.dataset.draft;
    if (/^plugins\.[^.]+\.on$/.test(path)) return render();
    const c = document.getElementById('edCount');
    if (c) c.innerHTML = countText();
    if (S.ui.edTab === 'intro') { const p = document.getElementById('introPreview'); if (p) p.innerHTML = introPreview(); }
    if (/^(title|chars\.\d+\.name)$/.test(path)) {
      const ok = storyIssues(d()).ok, done = document.querySelector('[data-act="edDone"]');
      done?.classList.toggle('primary', ok); done?.classList.toggle('ghost-fill', !ok);
      const tabBtn = document.querySelector('.ed-tabs [data-tab="prompt"]');
      if (tabBtn) tabBtn.innerHTML = `<sup>*</sup>プロンプト${ok ? '' : '<i class="bad">!</i>'}`;
    }
  },
});

/* ---------- 保存 ---------- */
async function persist(asDraft) {
  const st = normalizeStory(clone(d()));
  st.opening = itemsToText(d()._intro);
  delete st._intro;
  st.chars = st.chars.filter((c, i) => c.name.trim() || c.images.length || c.profile.trim() || i === 0);
  st.lore = st.lore.filter(e => e.title.trim() || e.content.trim());
  const prev = getStory(st.id);
  st.draft = asDraft ? (prev ? prev.draft : true) : false;
  await saveStory(st);
  S.ui.edDirty = false;
  return st;
}

defineActions({
  newStory: () => openEditor(null),
  editStory: el => { closeAllSheets(); openEditor(el.dataset.id); },
  edTab: el => { S.ui.edTab = el.dataset.tab; render(); document.querySelector('#view .scroll')?.scrollTo(0, 0); },
  edToggle: el => { const k = el.dataset.k; S.ui.edOpen[k] = !S.ui.edOpen[k]; render(); },
  edClose: () => {
    if (S.ui.edDirty && !confirm('保存していない変更があります。閉じますか？')) return;
    S.draft = null;
    back();
  },
  edSave: async () => { await persist(true); toast('一時保存しました', 'ok', 1500); render(); },
  edDone: async () => {
    const issues = storyIssues(d());
    if (!issues.ok) { S.ui.edTab = 'prompt'; render(); return toast('必須項目を入力してください: ' + issues.prompt.join('・'), 'warn', 3500); }
    const st = await persist(false);
    S.draft = null;
    toast('プロットを保存しました', 'ok', 1500);
    S.ui.stack.pop();
    if (curView().v === 'story' && curView().p.id === st.id) render(); else go('story', { id: st.id });
  },
  edRemove: el => {
    const list = d()[el.dataset.list], i = Number(el.dataset.i);
    const label = { chars: 'このキャラクター', profiles: 'このプロフィール', examples: 'この状況例', lore: 'この設定', _intro: 'このブロック' }[el.dataset.list];
    if (!confirm(`${label}を削除しますか？`)) return;
    list.splice(i, 1);
    dirty();
    render();
  },
  edAddChar: () => { d().chars.push(normalizeChar()); dirty(); render(); },
  edAddProfile: () => { d().profiles.push({ id: uid(), name: '', desc: '' }); dirty(); render(); },
  edAddExample: () => { d().examples.push({ id: uid(), charId: d().chars.find(c => c.name)?.id || '', situation: '', reply: '' }); dirty(); render(); },
  edAddLore: () => { d().lore.push(normalizeLore()); dirty(); render(); },
  edAddImage: async el => {
    const c = d().chars[Number(el.dataset.i)];
    c.images.push(await fileToImage(await pickFile('image/*'), 480, 640));
    dirty();
    render();
  },
  edRemoveImage: el => { d().chars[Number(el.dataset.i)].images.splice(Number(el.dataset.j), 1); dirty(); render(); },
  edCover: async () => { d().cover = await fileToImage(await pickFile('image/*'), 600, 800); dirty(); render(); },
  edCoverClear: () => { d().cover = ''; dirty(); render(); },
  edStyle: el => {
    const g = el.dataset.g, v = el.dataset.v, s = d().style, G = STYLE_GROUPS[g];
    if (G.multi) {
      const cur = s[g] || [];
      if (cur.includes(v)) s[g] = cur.filter(x => x !== v);
      else if (cur.length >= G.multi) return toast(`${G.label}は最大${G.multi}つまでです`, 'warn');
      else s[g] = [...cur, v];
    } else s[g] = v;
    dirty();
    render();
  },
  edPluginHelp: el => { const p = getPlugin(el.dataset.id); openSheet({ id: 'help', title: p.name, html: `<p class="pre">${esc(p.help || p.desc)}</p>` }); },
  edIntroAdd: el => {
    const type = el.dataset.type;
    d()._intro.push({ type, name: type === 'char' ? d().chars.find(c => c.name)?.name || '' : '', text: '' });
    dirty();
    render();
  },
  edIntroMove: el => {
    const a = d()._intro, i = Number(el.dataset.i), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    dirty();
    render();
  },
  edImportCard: async () => {
    const r = await readCardFile();
    if (!r) return;
    const st = d();
    if (st.chars.length === 1 && !st.chars[0].name && !st.chars[0].images.length) st.chars = [];
    st.chars.push(r.char);
    if (!st.title) st.title = r.char.name;
    if (!st.prompt.trim() && r.scenario) st.prompt = r.scenario;
    if (!st._intro.length && r.firstMes) st._intro = textToItems(r.firstMes, st.chars);
    if (r.lore.length) st.lore.push(...r.lore);
    dirty();
    render();
    toast(`「${r.char.name}」を追加しました`, 'ok');
  },
  edImportLore: async () => {
    const f = await pickFile('.json,application/json');
    const lore = loreFromJSON(JSON.parse(await f.text()));
    d().lore.push(...lore);
    dirty();
    render();
    toast(`ロアブックを${lore.length}件取り込みました`, 'ok');
  },
});
