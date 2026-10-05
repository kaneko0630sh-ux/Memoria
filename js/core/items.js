// アイテム図鑑。プロットの設定集（story.lore）のうち item を持つ項目がアイテムになる。
// - ロアとして: 名前と別名がキーワードになり、会話に出たとき／記憶係が選んだときに説明がAIに渡る
// - ステータス管理で: 持ち物・戦利品にアイコンと説明・レア度・売値が付く
// item: { icon, cat, rar: ''|'C'|'U'|'R'|'E'|'L', price, drop }

export const RARITY = [
  { k: 'C', label: 'コモン', w: 60, val: [5, 30] },
  { k: 'U', label: 'アンコモン', w: 25, val: [30, 120] },
  { k: 'R', label: 'レア', w: 10, val: [120, 500] },
  { k: 'E', label: 'エピック', w: 4, val: [500, 2000] },
  { k: 'L', label: '伝説級', w: 1, val: [2000, 8000] },
];
export const RARITY_OPTIONS = [['', 'なし'], ...RARITY.map(r => [r.k, r.label])];

export const newItemData = (o = {}) => ({ icon: '', cat: '', rar: '', price: '', drop: false, ...o });
export const isItem = e => !!e?.item;

const norm = s => String(s || '').trim().toLowerCase();
export const itemKeys = e => [e.title, ...(e.keys || [])].map(norm).filter(Boolean);

// プロットのアイテム図鑑（有効で名前のあるもの）
export const libraryOf = story => (story?.lore || []).filter(e => e.item && e.on && e.title.trim());

// 名前から図鑑の項目を探す（完全一致 → 別名 → 部分一致）
export function findLibItem(story, name) {
  const n = norm(name);
  if (!n) return null;
  const lib = libraryOf(story);
  return lib.find(e => norm(e.title) === n) || lib.find(e => itemKeys(e).includes(n))
    || (n.length > 1 ? lib.find(e => itemKeys(e).some(k => k.length > 1 && (n.includes(k) || k.includes(n)))) : null) || null;
}
