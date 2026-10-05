// プラグイン: ダイスイベント
// 山場でAIが【ダイス】ブロックを出し、ユーザーが振った出目で成否が決まる。
// ほかのプラグインは diceMods(chat, what, skill, sides, cfg) → [{ label, v }] で出目に補正を足せる（例: ステータス管理のスキル・装備）
import { definePlugin, pluginState, collect } from './registry.js';
import { S, curChat, getStory } from '../core/store.js';
import { esc } from '../core/util.js';
import { sendMessage } from '../engine/chat.js';
import { ic } from '../ui/dom.js';

const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const field = (lines, re) => (lines.find(l => re.test(l)) || '').replace(re, '').trim();

definePlugin({
  id: 'dice',
  name: 'ダイスイベント',
  desc: '重要な瞬間にプレイヤーが直接ダイスを振ります。その結果によって成功するかどうかが決まります',
  help: '戦闘・説得・危険な行動などの山場で、AIが判定を求めます。「ダイスを振る」を押すと出目が決まり、その結果に従って物語が進みます。ステータス管理プラグインも使っていると、スキル・レベル・装備・負傷が出目に補正されます。',
  defaults: { sides: '20' },
  fields: [{ key: 'sides', label: 'ダイスの面数', type: 'select', options: [['6', '6面'], ['20', '20面'], ['100', '100面']] }],
  blocks: ['ダイス'],

  rules: (ctx, cfg) => `- 戦闘・説得・危険な行動など結果が不確かな山場に限り、応答の最後に【ダイス】ブロックを置いてそこで止める。1行目に「判定: 何を試みるか」、2行目に「目標: 1〜${cfg.sides}の数字（この値以上で成功）」、{{user}}のスキルが関係するなら3行目に「技能: そのスキル名」を書き、成否は書かない。{{user}}の次のメッセージで出目（補正込み）が伝えられるので、それに従って成否を描写する。多用しない。`,

  renderBlock(b, env) {
    const lines = b.paras.map(p => p.t);
    const sides = Number(env.cfg.sides) || 20;
    const what = field(lines, /^判定\s*[:：]\s*/) || lines[0] || '';
    const target = Number(field(lines, /^目標\s*[:：]\s*/).replace(/\D+/g, '')) || Math.ceil(sides / 2);
    const skill = field(lines, /^技能\s*[:：]\s*/);
    const rolled = pluginState(env.chat, 'dice')[env.msg.id];
    const foot = rolled
      ? `<div class="pc-result ${rolled.ok ? 'ok' : 'ng'}">${rolled.total != null ? `合計 ${rolled.total}` : `出目 ${rolled.roll}`} → ${rolled.ok ? '成功' : '失敗'}</div>`
      : env.isLast ? `<button class="btn primary sm" data-act="p:dice:roll" data-msg="${env.msg.id}" data-target="${target}" data-sides="${sides}" data-what="${esc(what)}" data-skill="${esc(skill)}">${ic('dice', 'sm')}ダイスを振る</button>` : '';
    return `<div class="pcard"><div class="pc-head">${ic('dice', 'sm')}ダイス判定</div><div class="pc-body">${esc(what)}<small>目標 ${target} 以上（${sides}面）${skill ? `・技能: ${esc(skill)}` : ''}</small></div>${foot}</div>`;
  },

  // 振った結果のカード（吹き出しの代わり）
  renderCard(card) {
    const crit = card.roll === card.sides ? ' crit' : card.roll === 1 ? ' fumble' : '';
    return `<div class="lcard dice ${card.ok ? 'ok' : 'ng'}${crit}"><div class="lc-head"><span>🎲 ${esc(card.what || '判定')}</span><small>目標 ${card.target}（${card.sides}面）</small></div>
      <div class="dc-body"><div class="dc-roll">${card.roll}</div>${card.mods.length ? `<div class="dc-mods">${card.mods.map(m => `<span>${esc(m.label)} <b>${signed(m.v)}</b></span>`).join('')}</div>` : ''}
      <div class="dc-total">${card.mods.length ? `合計 <b>${card.total}</b>` : ''}<span class="dc-res">${card.ok ? '成功' : '失敗'}</span></div></div></div>`;
  },

  actions: {
    roll(el) {
      const chat = curChat();
      if (!chat || S.gen) return;
      const sides = Number(el.dataset.sides) || 20, target = Number(el.dataset.target) || 10;
      const what = el.dataset.what || '', skill = el.dataset.skill || '';
      const roll = 1 + Math.floor(Math.random() * sides);
      const mods = collect(getStory(chat.storyId), 'diceMods', chat, what, skill, sides).flat().filter(m => m && m.v);
      const bonus = mods.reduce((a, m) => a + m.v, 0), total = roll + bonus;
      const ok = roll === sides || (roll !== 1 && total >= target); // 最大の目は必ず成功、1は必ず失敗
      pluginState(chat, 'dice')[el.dataset.msg] = { roll, total, ok };
      const detail = mods.length ? `出目 ${roll} ${mods.map(m => `${signed(m.v)}（${m.label}）`).join(' ')} ＝ ${total}` : `出目 ${roll}`;
      sendMessage(chat, `*🎲 ダイスを振った: ${detail}（目標 ${target}）→ ${ok ? '成功' : '失敗'}${roll === sides ? '（会心）' : roll === 1 ? '（大失敗）' : ''}*`,
        { card: { plugin: 'dice', kind: 'roll', what, target, sides, roll, mods, total, ok } });
    },
  },
});
