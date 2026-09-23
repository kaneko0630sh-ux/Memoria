// アプリ内イベントバス。エンジン層は UI を直接触らず、ここに通知する。
//
// 主なイベント:
//   gen:changed (chat)          生成の開始・終了
//   gen:delta (chat, msg)       ストリーミング中の本文更新
//   memory:changed (chat)       記憶の更新・処理状態の変化
//   memory:flash (chat, text, isError)
//   choices:changed (chat)
//   notify (text, kind, ms)     画面にトースト表示してほしい通知

const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}

export function emit(evt, ...args) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(...args); } catch (e) { console.error(`[${evt}]`, e); }
  }
}

export const notify = (text, kind = '', ms) => emit('notify', text, kind, ms);
