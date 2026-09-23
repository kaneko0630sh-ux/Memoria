// 画面の切り替え・アクションの登録・入力バインドの共通処理
//
// 約束ごと:
//   data-act="名前"      クリックで ACTIONS[名前](要素, イベント) を呼ぶ（プラグインは "p:<id>:<名前>"）
//   data-set="a.b"       変更で S.settings の a.b に保存（数値は data-num、再描画は data-rerender）
//   data-draft="a.0.b"   入力で S.draft（編集中のプロット）の a[0].b に反映
import { S, curView, saveSettings } from '../core/store.js';
import { $, setPath, clamp, splitList } from '../core/util.js';
import { on } from '../core/hooks.js';
import { allPlugins } from '../plugins/registry.js';
import { toast, closeSheet, closeAllSheets, sheetOf } from './dom.js';

const VIEWS = {};
const ACTIONS = {};

// def: { render(p) → html, mount?(p, el), onInput?(el) }
export const defineView = (name, def) => { VIEWS[name] = def; };
export const defineActions = obj => Object.assign(ACTIONS, obj);

export function go(v, p = {}) { S.ui.stack.push({ v, p }); render(); }
export function back() { if (S.ui.stack.length > 1) S.ui.stack.pop(); render(); }
export function replaceView(v, p = {}) { S.ui.stack[S.ui.stack.length - 1] = { v, p }; render(); }
export function goHome(tab) {
  closeAllSheets();
  S.ui.stack = [{ v: 'home', p: {} }];
  if (tab) S.ui.tab = tab;
  render();
}
export function render() {
  const top = curView(), def = VIEWS[top.v];
  const key = `${top.v}:${top.p.id || ''}:${top.v === 'home' ? S.ui.tab : ''}:${top.v === 'editor' ? S.ui.edTab : ''}`;
  const el = $('#view'), oldSc = el.querySelector('.scroll');
  const keep = S.ui.lastKey === key && oldSc ? oldSc.scrollTop : null;
  el.className = 'view v-' + top.v;
  el.innerHTML = def.render(top.p);
  S.ui.lastKey = key;
  def.mount?.(top.p, el);
  if (keep != null && !def.ownScroll) { const sc = el.querySelector('.scroll'); if (sc) sc.scrollTop = keep; }
}
export const isView = v => curView().v === v;

export function applyUI() {
  const u = S.settings.ui;
  const dark = u.theme === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : u.theme !== 'light';
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.font = u.font;
  root.style.setProperty('--fs', clamp(Number(u.fs) || 16, 12, 24) + 'px');
  $('meta[name=theme-color]').content = dark ? '#111114' : '#f5f4f8';
}

// iOS のキーボード表示時も入力欄が隠れないよう、表示領域に合わせる
function fitViewport() {
  const vv = window.visualViewport, app = $('#app');
  const h = vv ? vv.height : innerHeight, top = vv ? vv.offsetTop : 0;
  app.style.height = h + 'px';
  app.style.transform = top ? `translateY(${top}px)` : '';
  document.documentElement.classList.toggle('kb', !!vv && innerHeight - vv.height > 120);
}

function makeIcon() {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = c.height = 180;
  const gr = g.createLinearGradient(0, 0, 180, 180);
  gr.addColorStop(0, '#5a36e0'); gr.addColorStop(1, '#16151c');
  g.fillStyle = gr; g.fillRect(0, 0, 180, 180);
  g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineJoin = 'round'; g.lineCap = 'round';
  const layer = y => { g.beginPath(); g.moveTo(40, y); g.lineTo(90, y + 25); g.lineTo(140, y); g.stroke(); };
  g.beginPath(); g.moveTo(90, 38); g.lineTo(140, 63); g.lineTo(90, 88); g.lineTo(40, 63); g.closePath(); g.stroke();
  layer(90); layer(117);
  $('#touchIcon').href = c.toDataURL('image/png');
}

defineActions({
  back: () => back(),
  closeSheet: el => closeSheet(sheetOf(el)),
  confirmOk: el => sheetOf(el)?._ok?.(),
});

export function startApp() {
  for (const p of allPlugins()) for (const [k, fn] of Object.entries(p.actions || {})) ACTIONS[`p:${p.id}:${k}`] = fn;

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const fn = ACTIONS[t.dataset.act];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(t, e)).catch(err => { console.error(err); toast(err.message || String(err), 'err', 6000); });
  });
  // テキストは input で、チェックボックスとセレクトは change で反映する
  const bindDraft = el => {
    if (!S.draft) return;
    setPath(S.draft, el.dataset.draft, el.type === 'checkbox' ? el.checked : el.dataset.list ? splitList(el.value) : el.value);
    const cnt = el.closest('.field')?.querySelector('.count');
    if (cnt && el.maxLength > 0) cnt.textContent = `${el.value.length}/${el.maxLength}`;
    VIEWS[curView().v]?.onInput?.(el);
  };
  const isChoice = el => el.type === 'checkbox' || el.tagName === 'SELECT';
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-draft]');
    if (el && !isChoice(el)) bindDraft(el);
  });
  document.addEventListener('change', e => {
    const d = e.target.closest('[data-draft]');
    if (d && isChoice(d)) return bindDraft(d);
    const el = e.target.closest('[data-set]');
    if (!el) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.num) { if (el.value === '' || isNaN(Number(el.value))) return; v = Number(el.value); }
    else v = el.value;
    setPath(S.settings, el.dataset.set, v);
    saveSettings();
    applyUI();
    if (el.dataset.rerender) render();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheets .sheet-wrap')) closeSheet(); });
  on('notify', (text, kind, ms) => toast(text, kind, ms));
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  addEventListener('resize', fitViewport);
  addEventListener('beforeunload', e => { if (S.gen || Object.keys(S.memJobs).length) { e.preventDefault(); e.returnValue = ''; } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyUI);
  fitViewport();
  makeIcon();
  applyUI();
  render();
}
