// ステータス管理プラグインのひな型。プロットの設定で空欄の項目は、選んだひな型の値を使う
// 一覧は「カンマ区切り」、持ち物・装備・スキルは「1行に1つ」でも「カンマ区切り」でもよい

export const RARITY = [
  { k: 'C', label: 'コモン', w: 60, val: [5, 30] },
  { k: 'U', label: 'アンコモン', w: 25, val: [30, 120] },
  { k: 'R', label: 'レア', w: 10, val: [120, 500] },
  { k: 'E', label: 'エピック', w: 4, val: [500, 2000] },
  { k: 'L', label: '伝説級', w: 1, val: [2000, 8000] },
];

export const PRESETS = {
  simple: {
    label: 'シンプル',
    currency: 'G', money: 100,
    cats: '消耗品,素材,貴重品,重要',
    slots: '武器,防具,装飾品',
    gauges: 'HP:100',
    items: '', equip: '', skills: '',
    prices: '',
    life: 'off', explore: 'off',
    factions: '', carry: 0, weights: '',
    relic: '未鑑定の品', legend: '伝説級',
    materials: '素材', consumables: '回復薬', moneyFind: 20,
  },
  adventurer: {
    label: '冒険者・生活（ファンタジー）',
    currency: 'G', money: 120,
    cats: '消耗品,素材,装備品,貴重品,重要',
    slots: '武器,防具,装飾品',
    gauges: 'HP:50,MP:20,スタミナ:30',
    items: '回復薬×2（消耗品）\n携帯食×3（消耗品）\n松明×1（消耗品）',
    equip: '武器: ショートソード\n防具: 革の鎧',
    skills: '剣術: 初級\n採集: 初級',
    prices: 'パン 3G／食堂の定食 12G\n宿代（1泊・食事なし）50G\n回復薬 30G／解毒薬 45G\n鉄の剣 300G／革の鎧 250G\n借家の家賃（30日）1,500G\n小さな家を建てる 30,000G〜',
    life: 'on', explore: 'on',
    factions: '冒険者ギルド,商人組合,騎士団',
    carry: 0, weights: '',
    relic: '未鑑定の魔道具', legend: '伝説級',
    materials: '魔物の牙,獣の毛皮,鉄鉱石,薬草,月光苔,銀糸蜘蛛の糸,魔石のかけら',
    consumables: '回復薬,解毒薬,携帯食,松明',
    moneyFind: 25,
  },
  salvage: {
    label: '荒廃SF・サルベージ',
    currency: 'C', money: 80,
    cats: '遺品,部品,弾薬・電池,食料・水,医療品,重要',
    slots: '武器,防具,ツール,義体',
    gauges: 'HP:40,電力:100,フィルター:100,汚染度:0/100',
    items: '弾薬×20（弾薬・電池）\n電池×3（弾薬・電池）\n浄水タブレット×4（食料・水）\n合成食×3（食料・水）',
    equip: '武器: 改造パルスライフル\n防具: 防塵コート\nツール: 携帯スキャナー',
    skills: '解析: 初級\n修理: 初級\nハッキング: 入門',
    prices: 'スクラップ（1kg）2C\n合成食 5C／浄水 3C\n弾薬（10発）12C／電池 15C\nフィルター交換 40C\nコンテナハウスの賃料（7日）150C\n義体の簡易修理 120C〜',
    life: 'on', explore: 'on',
    factions: '企業連合,スカベンジャー組合,鉄の教団',
    carry: 20, weights: '遺品:2,部品:1,弾薬・電池:0,食料・水:0.5,医療品:0.5,重要:0',
    relic: '未鑑定の遺品', legend: '遺物級',
    materials: '電子基板,銅線の束,劣化バッテリー,光ファイバー,精密ギア,装甲片,冷却ユニット',
    consumables: '弾薬,電池,浄水タブレット,合成食,止血パッチ',
    moneyFind: 15,
  },
};
export const PRESET_OPTIONS = Object.entries(PRESETS).map(([k, v]) => [k, v.label]);

// プロットの設定（空欄はひな型）→ 実際に使う設定
export function effective(cfg) {
  const base = PRESETS[cfg.preset] || PRESETS.simple, out = { ...base };
  for (const [k, v] of Object.entries(cfg || {})) if (v !== '' && v != null && k in base) out[k] = v;
  out.preset = PRESETS[cfg.preset] ? cfg.preset : 'simple';
  return out;
}
