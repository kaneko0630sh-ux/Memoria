// 直近のAIの応答で使い回している言い回し・文頭・本心の説明を数え、次の応答で避けさせる（APIは使わない）
import { txt } from '../core/store.js';

const RECENT = 6, MIN_REPLIES = 3, MAX_PHRASES = 6;
const OPENER = /^([^、。！？\s]{1,5})、/; // 「けれど、」「ふと、」など
// 本心を地の文で説明する書き方
const SPELL_OUT = /(けれど|しかし|だが|でも|それでも)[、,]?[^。\n]{0,30}(本当は|本心|内心|隠しきれない|滲ん|裏腹|ときめき)|言葉とは裏腹|隠しきれない[^。\n]{0,12}(が|を)/;

const clean = s => s.replace(/^\s*【[^】]*】.*$/gm, '').replace(/[*＊]/g, '');
const kanjiKana = s => (s.match(/[一-鿿゠-ヿ]/g) || []).length;

// exclude: 名前・設定の固有名詞・キャラ設定に書かれた口癖など、繰り返して当然の語
export function repetitionHint(chat, ctx, end = chat.messages.length) {
  const replies = chat.messages.slice(0, end).filter(m => m.role === 'ai').slice(-RECENT).map(m => clean(txt(m)));
  if (replies.length < MIN_REPLIES) return '';
  const st = ctx.story;
  const names = [ctx.user, ...ctx.chars.map(c => c.name), ...(st?.lore || []).flatMap(e => [e.title, ...e.keys])].filter(s => s && s.length > 1);
  const sheet = ctx.chars.map(c => [c.profile, c.personality, c.speech, c.note].join('\n')).join('\n');
  const notes = [];

  // 1) 3つ以上の応答に出てくる言い回し（6〜24字。句読点・かっこはまたがない。長い方を残す）
  const counts = new Map();
  for (const r of replies) {
    const seen = new Set();
    for (const seg of r.split(/[。！？!?\n「」『』（）()、,…]+/)) {
      const s = seg.trim();
      for (let n = 6; n <= 24; n++) for (let i = 0; i + n <= s.length; i++) {
        const g = s.slice(i, i + n);
        if (!seen.has(g)) { seen.add(g); counts.set(g, (counts.get(g) || 0) + 1); }
      }
    }
  }
  const rep = [...counts].filter(([g, c]) => c >= MIN_REPLIES && kanjiKana(g) >= 2 && !names.some(n => g.includes(n)) && !sheet.includes(g))
    .sort((a, b) => b[0].length - a[0].length);
  const kept = [];
  for (const [g, c] of rep) if (!kept.some(([k, kc]) => k.includes(g) && kc >= c) && kept.length < MAX_PHRASES) kept.push([g, c]);
  if (kept.length) notes.push(kept.map(([g]) => `「${g}」`).join(''));

  // 2) 同じ文頭のくり返し（直近の応答で4回以上、3つ以上の応答にまたがる）
  const openers = new Map();
  replies.forEach((r, i) => {
    for (const sent of r.split(/[。！？\n]+/)) {
      const m = sent.trim().match(OPENER);
      if (!m || names.includes(m[1])) continue;
      const o = openers.get(m[1]) || { n: 0, in: new Set() };
      o.n++; o.in.add(i);
      openers.set(m[1], o);
    }
  });
  const heads = [...openers].filter(([, o]) => o.n >= 4 && o.in.size >= MIN_REPLIES).map(([w]) => `「${w}、」`);
  if (heads.length) notes.push(`文頭の${heads.join('')}`);

  // 3) 本心の答え合わせ（直近3つの応答で見つかったら、その例を添える）
  const spelled = replies.slice(-3).join('\n').match(SPELL_OUT);
  if (spelled) {
    const at = replies.slice(-3).join('\n'), i = at.indexOf(spelled[0]);
    notes.push(`本心を地の文で説明する書き方（例: ${at.slice(i, i + 30).replace(/\s+/g, ' ')}…）`);
  }

  return notes.length ? `<variety>\n直近の応答で繰り返しが目立つもの。今回は使わず、別の言い方・別の描写にする:\n${notes.map(n => `- ${n}`).join('\n')}\n</variety>` : '';
}
