// トークプロフィール（ペルソナ）: 一覧・作成/編集・トーク中の切り替え
// マイページ・トーク開始時・トーク中（☰）の3か所から同じ部品を使う
import { S, getChat, getStory, curChat, resolvePersona, newPersona, defaultPersona, LIMITS, saveSettings } from '../../core/store.js';
import { esc, clone } from '../../core/util.js';
import { switchPersona } from '../../engine/chat.js';
import { ic, avatarHTML, openSheet, closeSheet, sheetById, sheetOf, setSheetBody, pickFile, fileToImage, toast } from '../dom.js';
import { defineActions, render } from '../app.js';

const snippet = s => (s || '').replace(/\s+/g, ' ').slice(0, 48);

// act: 行をタップしたときのアクション（data-kind / data-id を受け取る）
// current: 選択中 { kind, id }。null なら既定に印を付け、false なら印を付けない
// editIcons: 行の右に編集ボタンを出す（行のタップで選ぶ画面用）
export function personaListHTML({ act, story = null, current = null, editIcons = true }) {
  const cur = current === null ? { kind: 'mine', id: defaultPersona().id } : current || {};
  const row = (p, kind) => {
    const on = cur.kind === kind && cur.id === p.id;
    const badge = kind === 'mine' && p.id === S.settings.defaultPersona ? '<span class="pill">既定</span>' : '';
    return `<div class="pr-row ${on ? 'on' : ''}"><button class="pr-main" data-act="${act}" data-kind="${kind}" data-id="${p.id}">${avatarHTML(p, 44)}<span class="grow"><b>${esc(p.name || '（名前なし）')} ${badge}</b><small>${esc(snippet(p.desc)) || '設定なし'}</small></span>${on ? ic('check', 'sm') : ''}</button>${editIcons && kind === 'mine' ? `<button class="icon-btn" data-act="editPersona" data-id="${p.id}" aria-label="編集">${ic('edit', 'sm')}</button>` : ''}</div>`;
  };
  const plot = (story?.profiles || []).filter(p => p.name.trim());
  return `<div class="lbl">マイプロフィール</div>
    <div class="pr-list">${S.settings.personas.map(p => row(p, 'mine')).join('')}</div>
    <button class="btn sm ghost" data-act="newPersona">${ic('plus', 'sm')}新しいプロフィール</button>
    ${plot.length ? `<div class="lbl" style="margin-top:14px">このプロットのプロフィール</div><div class="pr-list">${plot.map(p => row(p, 'plot')).join('')}</div>` : ''}`;
}

/* ---------- トーク中の切り替え ---------- */
const switcherHTML = chat => `<p class="hint" style="margin:0 0 10px">このトークであなたが演じる人物です。切り替えると、次の返信から新しいプロフィールとして扱われます。</p>`
  + personaListHTML({ act: 'switchPersona', story: getStory(chat.storyId), current: chat.persona });
export function openPersonaSwitcher(chat) {
  openSheet({ id: 'persona-switch', title: 'トークプロフィール', data: { chat: chat.id }, html: switcherHTML(chat) });
}

/* ---------- 作成・編集 ---------- */
function editorHTML() {
  const p = S.ui.personaDraft, isNew = !S.settings.personas.some(x => x.id === p.id);
  return `<button class="av-pick" data-act="personaAvatar">${avatarHTML(p.name || p.avatar ? p : { name: '+' }, 88)}<span>${p.avatar ? '画像を変更' : '画像を設定'}</span></button>
    ${p.avatar ? '<div class="btn-row" style="justify-content:center;margin:6px 0 0"><button class="btn sm ghost" data-act="personaAvatarClear">画像を外す</button></div>' : ''}
    <label class="field"><span><i class="req">*</i>名前</span><input class="pf-name" maxlength="${LIMITS.charName}" value="${esc(p.name)}" placeholder="例) 瑠奈"></label>
    <label class="field"><span>設定</span><textarea class="pf-desc" rows="5" placeholder="外見・年齢・立場・性格・キャラとの関係など">${esc(p.desc)}</textarea></label>
    <label class="switch"><span>既定にする（新しいトークで最初に選ばれる）</span><input type="checkbox" class="tgl pf-default" ${S.settings.defaultPersona === p.id || !S.settings.personas.length ? 'checked' : ''}></label>
    <div class="btn-row end">${!isNew && S.settings.personas.length > 1 ? '<button class="btn danger" data-act="personaDelete">削除</button><span class="grow"></span>' : ''}<button class="btn" data-act="closeSheet">キャンセル</button><button class="btn primary" data-act="personaSave">保存</button></div>`;
}
export function openPersonaEditor(id) {
  const src = S.settings.personas.find(p => p.id === id);
  S.ui.personaDraft = src ? clone(src) : newPersona();
  openSheet({ id: 'persona-edit', title: src ? 'プロフィールを編集' : '新しいプロフィール', full: true, html: editorHTML() });
}
function readEditor() {
  const w = sheetById('persona-edit'), p = S.ui.personaDraft;
  if (!w) return;
  p.name = w.querySelector('.pf-name').value.trim();
  p.desc = w.querySelector('.pf-desc').value;
  p._default = w.querySelector('.pf-default').checked;
}
// 一覧を表示しているシートと画面を最新にする
function refreshAll() {
  const sw = sheetById('persona-switch');
  if (sw) setSheetBody('persona-switch', switcherHTML(getChat(sw.dataset.chat)));
  const st = sheetById('persona-start');
  if (st) setSheetBody('persona-start', st._html());
  render();
}

defineActions({
  newPersona: () => openPersonaEditor(null),
  editPersona: el => openPersonaEditor(el.dataset.id),
  personaAvatar: async () => {
    readEditor();
    S.ui.personaDraft.avatar = await fileToImage(await pickFile('image/*'), 256, 256);
    setSheetBody('persona-edit', editorHTML());
  },
  personaAvatarClear: () => { readEditor(); S.ui.personaDraft.avatar = ''; setSheetBody('persona-edit', editorHTML()); },
  personaSave: async el => {
    readEditor();
    const { _default, ...p } = S.ui.personaDraft;
    if (!p.name) return toast('名前を入力してください', 'warn');
    const list = S.settings.personas, i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    if (_default || list.length === 1) S.settings.defaultPersona = p.id;
    else if (S.settings.defaultPersona === p.id) S.settings.defaultPersona = list.find(x => x.id !== p.id)?.id || p.id;
    await saveSettings();
    closeSheet(sheetOf(el));
    refreshAll();
    toast('プロフィールを保存しました', 'ok', 1500);
  },
  personaDelete: async el => {
    const p = S.ui.personaDraft;
    if (!confirm(`「${p.name}」を削除しますか？ このプロフィールを使っていたトークは、既定のプロフィールに切り替わります。`)) return;
    S.settings.personas = S.settings.personas.filter(x => x.id !== p.id);
    if (S.settings.defaultPersona === p.id) S.settings.defaultPersona = S.settings.personas[0].id;
    await saveSettings();
    closeSheet(sheetOf(el));
    refreshAll();
  },
  switchPersona: async el => {
    const chat = getChat(sheetOf(el)?.dataset.chat) || curChat();
    const ok = await switchPersona(chat, { kind: el.dataset.kind, id: el.dataset.id });
    closeSheet(sheetOf(el));
    if (ok) toast(`${resolvePersona(chat).name}に変身！`, 'ok', 1800);
  },
});
