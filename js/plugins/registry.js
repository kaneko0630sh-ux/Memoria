// プラグインの登録と呼び出し。プロットごとにオン/オフと設定を持つ
//
// プラグイン定義:
// {
//   id, name, desc, help,
//   defaults: {},                                   プロットごとの設定の初期値
//   fields: [{ key, label, type: 'number'|'select'|'text', options, min, max, hint }]
//                                                   設定UI（エディタのプラグインタブが自動生成）
//   blocks: ['ダイス'],                             AI出力のうち、このプラグインが扱う見出し【…】
//   rules(ctx, cfg) → string                        出力ルール（システムプロンプトに追加。キャッシュ対象）
//   context(ctx, chat, cfg) → string                毎ターンの追加コンテキスト（最新の発言の直前に入る）
//   renderBlock(block, env) → html                  見出しブロックの表示。env = { chat, msg, isLast, ctx, cfg }
//   afterReply(chat, msg, cfg) → Promise            応答が確定した後の処理
//   menu(chat, cfg) → [{ label, sub, val, act }]    トーク画面のメニュー（☰）に出す項目
//   bar(chat, cfg) → html                           トーク画面の上部に出す小さな表示（任意）
//   renderCard(card, env, cfg) → html               msg.card = { plugin, … } を持つメッセージを、吹き出しの代わりにカードで表示
//   renderNote(note, env, cfg) → html               msg.pnote[id] を、そのAIの応答の下に添えて表示
//   memory: {                                       記憶係の呼び出しに相乗りする（APIの呼び出しは増えない）
//     key,                                          記憶係の出力JSONのキー
//     prompt(chat, ctx, cfg) → string               記憶係に渡す指示と現在の状態
//     schema(cfg) → JSON Schema                     出力の形
//     apply(chat, value, cfg, batch) → string       確定したやり取り（batch）の分を反映。通知用の要約を返す
//   }
//   actions: { name(el, event) }                    UIアクション。HTML では data-act="p:<id>:<name>"
// }
//
// データの置き場所:
//   pluginState(chat, id)  トークごと。巻き戻しても戻らない（ダイスの出目など）
//   pluginMem(chat, id)    トークごと。記憶と一緒に保存・巻き戻しされる（所持品など物語の状態）
import { notify } from '../core/hooks.js';

const REG = new Map();

export function definePlugin(def) { REG.set(def.id, def); }
export const allPlugins = () => [...REG.values()];
export const getPlugin = id => REG.get(id);
export const pluginCfg = (story, p) => ({ ...(p.defaults || {}), ...(story?.plugins?.[p.id] || {}) });
export const isPluginOn = (story, id) => !!story?.plugins?.[id]?.on;

export function activePlugins(story) {
  return allPlugins().filter(p => isPluginOn(story, p.id)).map(p => ({ p, cfg: pluginCfg(story, p) }));
}
// AI出力の見出し → プラグインID
export function blockOwners(story) {
  const out = {};
  for (const { p } of activePlugins(story)) for (const b of p.blocks || []) out[b] = p.id;
  return out;
}
// トークごとのプラグイン用データ置き場
export const pluginState = (chat, id) => (chat.pstate[id] ||= {});
export const pluginMem = (chat, id) => ((chat.mem.plug ||= {})[id] ||= {});

// 記憶係に相乗りするプラグイン
export const memoryPlugins = story => activePlugins(story).filter(x => x.p.memory?.key);

// メッセージに付いたプラグインの表示（カード / 応答の下の注記）。プラグインがオフなら空
export function pluginCardHTML(story, msg, env) {
  const p = getPlugin(msg.card?.plugin);
  if (!p?.renderCard || !isPluginOn(story, p.id)) return '';
  try { return p.renderCard(msg.card, env, pluginCfg(story, p)) || ''; } catch (e) { console.error(`[plugin ${p.id}.renderCard]`, e); return ''; }
}
export function pluginNotesHTML(story, msg, env) {
  return Object.entries(msg.pnote || {}).map(([id, note]) => {
    const p = getPlugin(id);
    if (!p?.renderNote || !isPluginOn(story, id)) return '';
    try { return p.renderNote(note, env, pluginCfg(story, p)) || ''; } catch (e) { console.error(`[plugin ${id}.renderNote]`, e); return ''; }
  }).join('');
}

export function collect(story, hook, ...args) {
  const out = [];
  for (const { p, cfg } of activePlugins(story)) {
    if (typeof p[hook] !== 'function') continue;
    try { const r = p[hook](...args, cfg); if (r) out.push(r); } catch (e) { console.error(`[plugin ${p.id}.${hook}]`, e); }
  }
  return out;
}

export async function runAfterReply(chat, story, msg) {
  for (const { p, cfg } of activePlugins(story)) {
    if (!p.afterReply) continue;
    try { await p.afterReply(chat, msg, cfg); } catch (e) { notify(`${p.name}: ${e.message}`, 'warn', 4000); }
  }
}
