// AI 出力ブロックの表示（トーク画面・プロット詳細のイントロで共通）
import { esc } from '../core/util.js';
import { charOf } from '../core/store.js';
import { getPlugin, pluginCfg } from '../plugins/registry.js';
import { avatarHTML, ic } from './dom.js';

const paraHTML = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

// env: { chat, msg, isLast, ctx } — プラグインの表示に渡す
export function blocksHTML(blocks, ctx, { tag = '', caret = false, tap = true, env = null } = {}) {
  const ta = tap ? ' data-act="msgTap"' : '';
  return blocks.map((b, i) => {
    const last = i === blocks.length - 1;
    const ps = b.paras.map((p, j) => `<p class="${p.k}">${paraHTML(p.t)}${caret && last && j === b.paras.length - 1 ? '<span class="caret"></span>' : ''}</p>`).join('');
    if (b.type === 'narr') return `<div class="narr"${ta}>${ic('lines', 'sm')}<div class="narr-t">${ps}</div></div>`;
    if (b.type === 'info') return `<div class="infobox"${ta}>${b.paras.map(p => `<div>${paraHTML(p.t)}</div>`).join('')}</div>`;
    if (b.type === 'plug') {
      const p = getPlugin(b.plugin);
      if (p?.renderBlock && env) {
        try { return `<div class="plug-wrap">${p.renderBlock(b, { ...env, cfg: pluginCfg(ctx.story, p) })}</div>`; } catch (e) { console.error(e); }
      }
      return `<div class="narr">${ic('lines', 'sm')}<div class="narr-t">${ps}</div></div>`;
    }
    const c = charOf(b.speaker, ctx.chars);
    return `<div class="say">${avatarHTML(c || { name: b.speaker }, 40)}<div class="say-main"><div class="say-name">${esc(b.speaker)}</div><div class="brow"><div class="bubble ai"${ta}>${ps}</div>${tag ? `<span class="mtag">${esc(tag)}</span>` : ''}</div></div></div>`;
  }).join('');
}
