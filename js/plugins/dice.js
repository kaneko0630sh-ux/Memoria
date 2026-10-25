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

  rules: (ctx, cfg) => `- 戦闘・説得・危険な行動など結果が不確かな山場に限り、応答の最後に【ダイス】ブロックを置いてそこで止める。1行目に「判定: 何を試みるか」、2行目に「目標: 1〜${cfg.sides}の数字（この値以上で成功）」、{{user}}のスキルが関係するなら3行目に「技能: そのスキル名」を書き、成否は書かない。仲間が挑む判定なら「判定」に仲間の名前を入れる。{{user}}の次のメッセージで出目（補正込み）が伝えられるので、それに従って成否を描写する。多用しない。`,

  renderBlock(b, env) {
    const lines = b.paras.map(p => p.t);
    const sides = Number(env.cfg.sides) || 20;
    const what = field(lines, /^判定\s*[:：]\s*/) || lines[0] || '';
    // 最初の数だけを読む（「目標: 15（20面）」を1520にしない）。全角数字・「目標値」も可。面数の範囲に収める
    const tm = field(lines, /^目標値?\s*[:：]\s*/).normalize('NFKC').match(/\d+/);
    const target = Math.min(sides, Math.max(1, Number(tm?.[0]) || Math.ceil(sides / 2)));
    const skill = field(lines, /^技能\s*[:：]\s*/);
    const rolled = pluginState(env.chat, 'dice')[env.msg.id];
    const foot = rolled
      ? `<div class="pc-result ${rolled.ok ? 'ok' : 'ng'}">${rolled.total != null ? `合計 ${Number(rolled.total) || 0}` : `出目 ${Number(rolled.roll) || 0}`} → ${rolled.ok ? '成功' : '失敗'}</div>`
      : env.isLast ? `<button class="btn primary sm" data-act="p:dice:roll" data-msg="${env.msg.id}" data-target="${target}" data-sides="${sides}" data-what="${esc(what)}" data-skill="${esc(skill)}">${ic('dice', 'sm')}ダイスを振る</button>` : '';
    return `<div class="pcard"><div class="pc-head">${ic('dice', 'sm')}ダイス判定</div><div class="pc-body">${esc(what)}<small>目標 ${target} 以上（${sides}面）${skill ? `・技能: ${esc(skill)}` : ''}</small></div>${foot}</div>`;
  },

  // 振った結果のカード（吹き出しの代わり）
  renderCard(card) {
    const n = v => Number(v) || 0, roll = n(card.roll), mods = Array.isArray(card.mods) ? card.mods : [];
    const crit = roll === n(card.sides) ? ' crit' : roll === 1 && !card.ok ? ' fumble' : '';
    return `<div class="lcard dice ${card.ok ? 'ok' : 'ng'}${crit}"><div class="lc-head"><span>🎲 ${esc(card.what || '判定')}</span><small>目標 ${n(card.target)}（${n(card.sides)}面）</small></div>
      <div class="dc-body"><div class="dc-roll">${roll}</div>${mods.length ? `<div class="dc-mods">${mods.map(m => `<span>${esc(m.label)} <b>${signed(n(m.v))}</b></span>`).join('')}</div>` : ''}
      <div class="dc-total">${mods.length ? `合計 <b>${n(card.total)}</b>` : ''}<span class="dc-res">${card.ok ? '成功' : '失敗'}</span></div></div></div>`;
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
      // 最大の目は必ず成功、1は必ず失敗（難易度「無双」では1でも合計で決まる）
      const muso = getStory(chat.storyId)?.style?.difficulty === 'muso', fumble = roll === 1 && !muso;
      const ok = roll === sides || (!fumble && total >= target);
      pluginState(chat, 'dice')[el.dataset.msg] = { roll, total, ok };
      const detail = mods.length ? `出目 ${roll} ${mods.map(m => `${signed(m.v)}（${m.label}）`).join(' ')} ＝ ${total}` : `出目 ${roll}`;
      sendMessage(chat, `*🎲 ダイスを振った: ${detail}（目標 ${target}）→ ${ok ? '成功' : '失敗'}${roll === sides ? '（会心）' : fumble ? '（大失敗）' : ''}*`,
        { card: { plugin: 'dice', kind: 'roll', what, target, sides, roll, mods, total, ok } });
    },
  },
});
