// UI の部品（アイコン・シート・トースト・ファイル・フォーム部品）。画面はここの部品で組み立てる
import { $, $$, esc } from '../core/util.js';
import { charAvatar } from '../core/store.js';

/* ---------- icons ---------- */
const IP = {
  back: '<path d="m15 18-6-6 6-6"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
  send: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  talk: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  create: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  lines: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
  dots: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  hdots: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  forward: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
};
export const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IP[n] || ''}</svg>`;
export const TYPING = '<span class="typing"><i></i><i></i><i></i></span>';

/* ---------- avatars & covers ---------- */
export function hueOf(s) { let h = 0; for (const ch of String(s || '?')) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
export function avatarHTML(c, size = 40) {
  const src = charAvatar(c);
  if (src) return `<img class="av" src="${esc(src)}" alt="" style="width:${size}px;height:${size}px">`;
  const name = c?.name || '?';
  return `<span class="av" style="width:${size}px;height:${size}px;background:hsl(${hueOf(name)} 38% 36%);font-size:${Math.round(size * 0.42)}px">${esc([...name][0])}</span>`;
}
export function coverHTML(st, fs = 56) {
  const src = st?.cover || charAvatar(st?.chars?.find(c => charAvatar(c)));
  if (src) return `<img src="${esc(src)}" alt="">`;
  const h = hueOf(st?.title);
  return `<div class="cover-ph" style="background:linear-gradient(160deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 40% 14%));font-size:${fs}px">${esc([...(st?.title || '?')][0])}</div>`;
}

/* ---------- toast ---------- */
export function toast(msg, kind = '', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

/* ---------- sheets（下から出るシート / 右から出るドロワー） ---------- */
export function openSheet({ id = '', title = '', html = '', full = false, side = '', data = {}, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap' + (side === 'right' ? ' right' : '');
  wrap.dataset.sheet = id;
  Object.assign(wrap.dataset, data);
  wrap.innerHTML = `<div class="sheet-backdrop" data-act="closeSheet"></div><div class="sheet${full ? ' full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="閉じる">${ic('x')}</button></div><div class="sheet-body">${html}</div></div>`;
  wrap._onClose = onClose;
  $('#sheets').appendChild(wrap);
  return wrap;
}
export function closeSheet(wrap) {
  wrap = wrap || $$('#sheets .sheet-wrap:not(.closing)').at(-1);
  if (!wrap || wrap.classList.contains('closing')) return;
  wrap.classList.add('closing');
  wrap._onClose?.();
  setTimeout(() => wrap.remove(), 180);
}
export function closeAllSheets() { $$('#sheets .sheet-wrap').forEach(w => { w._onClose?.(); w.remove(); }); }
export const sheetById = id => $(`#sheets .sheet-wrap[data-sheet="${id}"]:not(.closing)`);
export const sheetOf = el => el?.closest('.sheet-wrap');
export function setSheetBody(id, html, top = false) {
  const w = sheetById(id);
  if (!w) return;
  const b = $('.sheet-body', w), st = b.scrollTop;
  b.innerHTML = html;
  b.scrollTop = top ? 0 : st;
}
export function confirmSheet(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const w = openSheet({ id: 'confirm', title, html: `<p class="confirm-text">${esc(text)}</p><div class="btn-row end"><button class="btn" data-act="closeSheet">キャンセル</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-act="confirmOk">${esc(okLabel)}</button></div>`, onClose: () => res(false) });
    w._ok = () => { w._onClose = null; closeSheet(w); res(true); };
  });
}

/* ---------- misc ---------- */
export function autosize(ta, max = 170) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, max) + 'px'; }
export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); } catch {
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}
export async function saveFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
// ファイル選択（選ばれなかった場合は解決しない）
export function pickFile(accept) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.hidden = true;
    i.onchange = () => { res(i.files[0]); i.remove(); };
    document.body.appendChild(i);
    i.click();
  });
}
// 画像を中央（縦は上寄り）で切り抜いて JPEG 化
export function fileToImage(file, w, h) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), g = c.getContext('2d'), r = w / h;
      c.width = w; c.height = h;
      let sw = img.width, sh = img.height;
      if (sw / sh > r) sw = sh * r; else sh = sw / r;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.18, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

/* ---------- form parts ---------- */
// 選択ボタンの並び。options: [{ v, label, desc? }]
export function segButtons({ act, group, options, value, cols = options.length, multi = false }) {
  const on = v => (multi ? (value || []).includes(v) : value === v);
  const sel = !multi && options.find(o => o.v === value);
  return `<div class="segb ${multi ? 'chips-b' : ''}" style="--cols:${cols}">${options.map(o => `<button class="sb ${on(o.v) ? 'on' : ''}" data-act="${act}" data-g="${group}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('')}</div>${sel?.desc ? `<p class="seg-desc">${esc(sel.desc)}</p>` : ''}`;
}
export const toggleHTML = (attrs, checked) => `<input type="checkbox" class="tgl" ${attrs} ${checked ? 'checked' : ''}>`;
// 文字数カウンター付きの入力欄（data-draft で S.draft に双方向バインド）
export function draftInput(path, value, { label = '', ph = '', max = 0, rows = 0, req = false, hint = '' } = {}) {
  const cnt = max ? `<span class="count">${String(value || '').length}/${max}</span>` : '';
  const ctl = rows
    ? `<textarea data-draft="${path}" rows="${rows}" placeholder="${esc(ph)}" ${max ? `maxlength="${max}"` : ''}>${esc(value)}</textarea>`
    : `<div class="with-count"><input data-draft="${path}" value="${esc(value)}" placeholder="${esc(ph)}" ${max ? `maxlength="${max}"` : ''}>${cnt}</div>`;
  return `<label class="field">${label ? `<span>${req ? '<i class="req">*</i>' : ''}${esc(label)}</span>` : ''}${ctl}${rows && max ? cnt : ''}${hint ? `<div class="hint">${hint}</div>` : ''}</label>`;
}
