// キーワード発火のロアブック。直近の会話にキーワードが出た項目だけを差し込む
// （「常時」をオンにした項目は毎回入る）。動的な記憶とは別の、作者が書く静的な設定用
import { S, txt, isDialog, normalizeLore } from '../core/store.js';

export function scanLore(story, chat, end) {
  const entries = (story?.lore || []).filter(e => e.on && e.content.trim());
  if (!entries.length) return [];
  const { depth = 4, budget = 3000 } = S.settings.lore;
  const recent = chat.messages.slice(0, end).filter(isDialog).slice(-depth).map(txt).join('\n').toLowerCase();
  const hits = entries.filter(e => e.always || e.keys.some(k => k && recent.includes(k.toLowerCase())));
  const out = [];
  let chars = 0;
  for (const e of hits) {
    if (out.length && chars + e.content.length > budget) break;
    out.push(e);
    chars += e.content.length;
  }
  return out;
}

export function loreText(entries, M) {
  if (!entries.length) return '';
  return `<lore>\n${entries.map(e => `【${e.title || e.keys[0] || '設定'}】\n${M(e.content).trim()}`).join('\n\n')}\n</lore>`;
}

// SillyTavern のワールド情報 / キャラクターブック → ロアブック項目
export function stEntriesToLore(entries) {
  return (entries || []).filter(e => e && String(e.content || '').trim())
    .sort((a, b) => (a.order ?? a.insertion_order ?? 0) - (b.order ?? b.insertion_order ?? 0))
    .map(e => normalizeLore({
      title: e.comment || e.name || '',
      keys: [].concat(e.keys || e.key || []).map(k => String(k).trim()).filter(Boolean),
      content: String(e.content).trim(),
      always: !!e.constant,
      on: e.enabled !== false && !e.disable,
    }));
}
export function loreFromJSON(j) {
  let entries = j.entries ? (Array.isArray(j.entries) ? j.entries : Object.values(j.entries)) : Array.isArray(j) ? j : [];
  if (!entries.length && j.data?.character_book) entries = j.data.character_book.entries || [];
  const lore = stEntriesToLore(entries);
  if (!lore.length) throw new Error('ロアブックの項目が見つかりませんでした');
  return lore;
}
