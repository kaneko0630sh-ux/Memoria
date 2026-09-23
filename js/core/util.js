// 汎用ユーティリティ（状態やDOM構造に依存しない関数だけを置く）

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = s => String(s ?? '').replace(/"/g, '”');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = o => JSON.parse(JSON.stringify(o));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const now = () => Date.now();
export const uniq = a => [...new Set(a)];
export const tl = t => (t ? 'T' + t : '開始');
export const FINE = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
export const safeName = s => String(s || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
export const modelShort = m => String(m || '').split('/').pop().replace(/^claude-/, '');
export const splitList = s => uniq(String(s || '').split(/[,、，\n]+/).map(x => x.trim()).filter(Boolean));

// 日本語は1字≒1トークン、英数字は約3.5字≒1トークンとして概算
export function estTokens(s) {
  s = String(s || '');
  let w = 0;
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 1 : 0.28;
  return Math.ceil(w);
}

export function relTime(t) {
  const d = (now() - t) / 1000;
  if (d < 60) return 'たった今';
  if (d < 3600) return Math.floor(d / 60) + '分前';
  if (d < 86400) return Math.floor(d / 3600) + '時間前';
  if (d < 86400 * 7) return Math.floor(d / 86400) + '日前';
  const x = new Date(t);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}
export function hhmm(t) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function ymd() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
export const fmtCount = n => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : n.toLocaleString());

export const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
export function setPath(o, p, v) {
  const ks = p.split('.'), last = ks.pop();
  let t = o;
  for (const k of ks) t = t[k] ??= {};
  t[last] = v;
}
// base の形を保ったまま over の値で上書き（配列は丸ごと置き換え）
export function deepMerge(base, over) {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return over === undefined ? base : over;
  const out = { ...base };
  if (over && typeof over === 'object') for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export function b64utf8(b64) {
  const bin = atob(b64.trim()), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u8);
}

// モデルの出力からJSONを取り出す（前後の文章やコードブロックを許容）
export function parseJSON(t) {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
