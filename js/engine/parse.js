// AI の出力を表示用のブロックに分解する（副作用なし）
//
// 出力形式:
//   【ナレーション】   情景（1段落1行）
//   【キャラ名】       *動作・内心*（a） と 台詞（d） を交互に
//   【情報】           インフォボックス（1行1項目）
//   【プラグイン見出し】 プラグインが所有するブロック（例: 【ダイス】）
// 見出しのない古い形式（名前: 台詞 / *地の文* / 「台詞」）も読める
import { charOf } from '../core/store.js';

const NARR_RE = /^(ナレーション|ナレーター|地の文|情景|描写|narration|narrator)$/i;
const INFO_RE = /^(情報|インフォ|ステータス|info)$/i;
const STAR = /^[*＊]/;

export function stripQ(s) {
  s = s.trim();
  const m = s.match(/^[「『“"]([\s\S]*)[」』”"]$/);
  return m ? m[1] : s;
}

// special: { 見出し名: pluginId }
export function parseBlocks(text, chars, special = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const headered = lines.some(l => /^\s*【[^】]{1,30}】/.test(l));
  const main = chars[0]?.name || '';
  const blocks = [];
  let cur = null, inStar = false;

  const open = (type, speaker = '', plugin = '') => { cur = { type, speaker, plugin, paras: [] }; blocks.push(cur); };
  const addTo = (type, speaker, k, t) => {
    if (!cur || cur.type !== type || cur.speaker !== speaker) open(type, speaker);
    cur.paras.push({ k, t });
  };
  const place = (isAct, t) => {
    t = t.trim();
    if (!t) return;
    if (headered) {
      if (!cur) open('narr');
      if (cur.type === 'char') cur.paras.push(isAct ? { k: 'a', t } : { k: 'd', t: stripQ(t) });
      else cur.paras.push({ k: 'n', t });
    } else if (!isAct && /^[「『“"]/.test(t)) addTo('char', cur?.type === 'char' ? cur.speaker : main, 'd', stripQ(t));
    else addTo('narr', '', 'n', t);
  };
  const handle = line => {
    let m;
    if ((m = line.match(/^【([^】]{1,30})】\s*(.*)$/))) {
      const n = m[1].trim();
      if (NARR_RE.test(n)) open('narr');
      else if (INFO_RE.test(n)) open('info');
      else if (special[n]) open('plug', n, special[n]);
      else open('char', n);
      inStar = false;
      if (m[2]) handle(m[2]);
      return;
    }
    if (!inStar && !STAR.test(line) && (m = line.match(/^([^\s:：「」『』*＊【】()（）]{1,20})\s*[:：]\s*(.+)$/)) && (!headered || charOf(m[1], chars))) {
      if (!(cur && cur.type === 'char' && cur.speaker === m[1])) open('char', m[1]);
      const rest = m[2].trim();
      if (/^[*＊][\s\S]*[*＊]$/.test(rest)) cur.paras.push({ k: 'a', t: rest.replace(/^[*＊]+|[*＊]+$/g, '') });
      else cur.paras.push({ k: 'd', t: stripQ(rest) });
      return;
    }
    let isAct = false, t = line;
    if (inStar) {
      isAct = true;
      if (/[*＊]$/.test(t)) { inStar = false; t = t.replace(/[*＊]+$/, ''); }
    } else if (STAR.test(t)) {
      isAct = true;
      t = t.replace(/^[*＊]+/, '');
      const mm = t.match(/^([^*＊]*)[*＊]+\s*(.*)$/);
      if (mm) { t = mm[1]; if (mm[2]) { place(true, t); handle(mm[2]); return; } } else inStar = true;
    }
    place(isAct, t);
  };
  for (const raw of lines) { const l = raw.trim(); if (l) handle(l); }
  return blocks.filter(b => b.paras.length);
}

/* ---------- イントロ編集用: テキスト ⇔ 項目リスト ---------- */
export function textToItems(text, chars) {
  return parseBlocks(text, chars).filter(b => b.type === 'narr' || b.type === 'char').map(b => ({
    type: b.type, name: b.speaker,
    text: b.paras.map(p => (p.k === 'a' ? `*${p.t}*` : p.t)).join('\n'),
  }));
}
export function itemsToText(items) {
  return items.filter(it => it.text.trim())
    .map(it => `【${it.type === 'narr' ? 'ナレーション' : it.name || 'キャラクター'}】\n${it.text.trim()}`).join('\n');
}

/* ---------- 一覧やプレビュー用のプレーンテキスト ---------- */
export const plainText = text => String(text || '').replace(/【[^】]*】/g, ' ').replace(/[*＊]/g, '').replace(/\s+/g, ' ').trim();
export function lastLine(text) {
  const ls = String(text || '').split('\n').map(l => l.replace(/【[^】]*】|[*＊]/g, '').trim()).filter(Boolean);
  return (ls.at(-1) || '').slice(0, 70);
}
