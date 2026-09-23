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
//   context(ctx, cfg, chat) → string                毎ターンの追加コンテキスト
//   renderBlock(block, env) → html                  見出しブロックの表示。env = { chat, msg, isLast, ctx, cfg }
//   afterReply(chat, msg, cfg) → Promise            応答が確定した後の処理
//   menu(chat, cfg) → [{ label, sub, val, act }]    トーク画面のメニュー（☰）に出す項目
//   actions: { name(el, event) }                    UIアクション。HTML では data-act="p:<id>:<name>"
// }
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
