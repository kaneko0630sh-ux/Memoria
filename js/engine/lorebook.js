// ロアブック（設定集のキーワード設定）。作者が書く静的な設定を、必要なときだけ差し込む。
// 入る条件: 「常時」 / 直近の会話にキーワードが出た / 記憶係のAIが次の場面に必要と選んだ（chat.mem.loreRecall）
// 容量を超えるときは 常時 → キーワード → AI の順に優先する
import { S, txt, isDialog, normalizeLore } from '../core/store.js';
import { RARITY } from '../core/items.js';

const BY = ['always', 'key', 'ai'];

// 戻り値: [{ entry, by: 'always' | 'key' | 'ai' }]
export function scanLore(story, chat, end) {
  const entries = (story?.lore || []).filter(e => e.on && e.content.trim());
  if (!entries.length) return [];
  const { depth = 4, budget = 3000, ai = true } = S.settings.lore;
  const recent = chat.messages.slice(0, end).filter(isDialog).slice(-depth).map(txt).join('\n').toLowerCase();
  const picked = new Set(ai ? chat.mem?.loreRecall || [] : []);
  const keysOf = e => (e.item ? [e.title, ...e.keys] : e.keys); // アイテムは名前そのものもキーワード
  const why = e => (e.always ? 'always' : keysOf(e).some(k => k && recent.includes(k.toLowerCase())) ? 'key' : picked.has(e.id) ? 'ai' : '');
  const hits = entries.map(entry => ({ entry, by: why(entry) })).filter(h => h.by).sort((a, b) => BY.indexOf(a.by) - BY.indexOf(b.by));
  const out = [];
  let chars = 0;
  for (const h of hits) {
    if (out.length && chars + h.entry.content.length > budget) continue;
    out.push(h);
    chars += h.entry.content.length;
  }
  return out;
}

// 記憶係に見せる設定集の目録（常時の項目は毎回入るので除く）。短いID → 項目ID の対応も返す
export function loreCatalog(story, M, max = 80) {
  const list = (story?.lore || []).filter(e => e.on && !e.always && e.content.trim()).slice(0, max);
  const ids = {};
  const text = list.map((e, i) => {
    ids['l' + (i + 1)] = e.id;
    const head = M(e.content).replace(/\s+/g, ' ').trim();
    return `[l${i + 1}] ${e.item ? 'アイテム: ' : ''}${e.title || e.keys[0] || '設定'}${e.keys.length ? `（キー: ${e.keys.slice(0, 4).join('・')}）` : ''}: ${head.slice(0, 50)}${head.length > 50 ? '…' : ''}`;
  }).join('\n');
  return { text, ids };
}

export function loreText(entries, M) {
  if (!entries.length) return '';
  const head = e => {
    if (!e.item) return e.title || e.keys[0] || '設定';
    const tags = [RARITY.find(r => r.k === e.item.rar)?.label, e.item.cat].filter(Boolean).join('・');
    return `アイテム: ${e.title}${tags ? `（${tags}）` : ''}`;
  };
  return `<lore>\n${entries.map(e => `【${head(e)}】\n${M(e.content).trim()}`).join('\n\n')}\n</lore>`;
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
