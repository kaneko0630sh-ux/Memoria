// プラグイン: ダイスイベント
// 山場でAIが【ダイス】ブロックを出し、ユーザーが振った出目で成否が決まる
import { definePlugin, pluginState } from './registry.js';
import { S, curChat } from '../core/store.js';
import { esc } from '../core/util.js';
import { sendMessage } from '../engine/chat.js';
import { ic } from '../ui/dom.js';

definePlugin({
  id: 'dice',
  name: 'ダイスイベント',
  desc: '重要な瞬間にプレイヤーが直接ダイスを振ります。その結果によって成功するかどうかが決まります',
  help: '戦闘・説得・危険な行動などの山場で、AIが判定を求めます。「ダイスを振る」を押すと出目が決まり、その結果に従って物語が進みます。',
  defaults: { sides: '20' },
  fields: [{ key: 'sides', label: 'ダイスの面数', type: 'select', options: [['6', '6面'], ['20', '20面'], ['100', '100面']] }],
  blocks: ['ダイス'],

  rules: (ctx, cfg) => `- 戦闘・説得・危険な行動など結果が不確かな山場に限り、応答の最後に【ダイス】ブロックを置いてそこで止める。1行目に「判定: 何を試みるか」、2行目に「目標: 1〜${cfg.sides}の数字（この値以上で成功）」を書き、成否は書かない。{{user}}の次のメッセージで出目が伝えられるので、それに従って成否を描写する。多用しない。`,

  renderBlock(b, env) {
    const lines = b.paras.map(p => p.t);
    const sides = Number(env.cfg.sides) || 20;
    const what = (lines.find(l => /^判定/.test(l)) || lines[0] || '').replace(/^判定\s*[:：]\s*/, '');
    const target = Number((lines.find(l => /^目標/.test(l)) || '').replace(/\D+/g, '')) || Math.ceil(sides / 2);
    const rolled = pluginState(env.chat, 'dice')[env.msg.id];
    const foot = rolled
      ? `<div class="pc-result ${rolled.ok ? 'ok' : 'ng'}">出目 ${rolled.roll} → ${rolled.ok ? '成功' : '失敗'}</div>`
      : env.isLast ? `<button class="btn primary sm" data-act="p:dice:roll" data-msg="${env.msg.id}" data-target="${target}" data-sides="${sides}">${ic('dice', 'sm')}ダイスを振る</button>` : '';
    return `<div class="pcard"><div class="pc-head">${ic('dice', 'sm')}ダイス判定</div><div class="pc-body">${esc(what)}<small>目標 ${target} 以上（${sides}面）</small></div>${foot}</div>`;
  },

  actions: {
    roll(el) {
      const chat = curChat();
      if (!chat || S.gen) return;
      const sides = Number(el.dataset.sides) || 20, target = Number(el.dataset.target) || 10;
      const roll = 1 + Math.floor(Math.random() * sides), ok = roll >= target;
      pluginState(chat, 'dice')[el.dataset.msg] = { roll, ok };
      sendMessage(chat, `*🎲 ダイスを振った: 出目 ${roll}（目標 ${target}）→ ${ok ? '成功' : '失敗'}*`);
    },
  },
});
