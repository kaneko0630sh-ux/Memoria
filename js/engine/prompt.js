// 送信プロンプトの組み立て
//   システム（キャッシュ対象）: 基本ルール → 文体・演出 → 出力形式 → プロット → 世界観 → キャラ → 状況例 → ペルソナ → 作者の指示
//   準静的（キャッシュ対象）:   作者メモ → あらすじ
//   履歴:                      あらすじ化されていない直近の会話
//   最新の発言の直前 <context>: 発火したロアブック → プラグイン → 記憶（選択済み）→ 現在の状況
import { S, STYLE_DEFAULTS, txt, isDialog, chatCtx, macros, resolvePersona } from '../core/store.js';
import { estTokens, attr, tl } from '../core/util.js';
import { styleText, formatRules } from './style.js';
import { scanLore, loreText } from './lorebook.js';
import { selectMemories, memoryText } from './memory.js';
import { activePlugins, collect } from '../plugins/registry.js';

const CORE_RULES = `あなたは没入型ロールプレイの作家であり、登場キャラクター全員とナレーションを担当します。{{user}}と共に一つの物語を紡ぎます。

# 原則
- 各キャラクターの性格・口調・一人称・呼び方・価値観・知識の範囲を一貫して守る。キャラが知り得ないことは知らないものとして振る舞う。
- <plot>・<world>・<lore>・<character>・<chronicle>・<memory>・<progress>・<current_state> は物語上の確定事実。矛盾させず、過去の出来事・約束・関係性・未解決の筋を自然に踏まえる。
- <author_guide>・<author_note>・<director_note> は物語の方向性の指示。本文で言及せず、展開の中で自然に反映させる。
- ユーザーメッセージ冒頭の <context> はシステムが自動で添付する最新の設定・記憶・状況であり、{{user}}の発言ではない。<current_state> より会話履歴の方が新しい場合は会話履歴を優先する。
- {{user}}のメッセージ中の *…* は{{user}}の行動や状況の描写、それ以外は{{user}}の台詞として受け取る。
- 物語を能動的に前へ進める。ただし{{user}}の選択を奪わない。`;

function charBlock(c, M) {
  const sec = [['プロフィール', c.profile], ['性格', c.personality], ['口調・話し方', c.speech], ['補足・演技指示', c.note]]
    .filter(([, v]) => v && v.trim()).map(([k, v]) => `【${k}】\n${M(v).trim()}`).join('\n\n');
  return `<character name="${attr(c.name)}">\n${sec || '（設定なし）'}\n</character>`;
}
function examplesBlock(st, ctx, M) {
  const ex = (st?.examples || []).filter(x => x.situation.trim() && x.reply.trim());
  if (!ex.length) return '';
  const name = x => ctx.chars.find(c => c.id === x.charId)?.name || ctx.chars[0]?.name || 'キャラクター';
  return `<examples>\n性格と口調の参考例（内容はそのまま使わない）:\n${ex.map(x => `【状況】${M(x.situation).trim()}\n【${name(x)}】${M(x.reply).trim()}`).join('\n\n')}\n</examples>`;
}
function chronicleText(chat) {
  const c = chat.mem.chronicle;
  if (!c.length) return '';
  return `<chronicle>\nこれまでの物語のあらすじ（古い順）:\n${c.map(x => `【${tl(x.from)}〜${tl(x.to)}】${x.text}`).join('\n\n')}\n</chronicle>`;
}

export function buildChatRequest(chat, { end, mode = 'reply' }) {
  const s = S.settings, ctx = chatCtx(chat), M = t => macros(t, ctx), m = chat.mem, st0 = ctx.story;
  const style = st0?.style || STYLE_DEFAULTS;
  const plugs = activePlugins(st0);

  const sys = [M(CORE_RULES), M(styleText(style)), M(formatRules(ctx, style, collect(st0, 'rules', ctx)))];
  if (st0?.prompt?.trim()) sys.push(`<plot title="${attr(st0.title)}">\n${M(st0.prompt).trim()}\n</plot>`);
  if (st0?.world?.trim()) sys.push(`<world>\n${M(st0.world).trim()}\n</world>`);
  if (ctx.chars.length) sys.push(ctx.chars.map(c => charBlock(c, M)).join('\n\n'));
  const ex = examplesBlock(st0, ctx, M);
  if (ex) sys.push(ex);
  const role = st0?.userRole?.trim() ? `\n【この物語での役柄】\n${M(st0.userRole).trim()}` : '';
  sys.push(`<user_persona name="${attr(ctx.user)}">\n${M(ctx.userDesc || '').trim() || '（特記事項なし）'}${role}\n</user_persona>`);
  if (st0?.guide?.trim()) sys.push(`<author_guide>\n${M(st0.guide).trim()}\n</author_guide>`);
  const sysText = sys.join('\n\n');

  const semi = [];
  if (chat.note?.trim()) semi.push(`<author_note>\n${M(chat.note).trim()}\n</author_note>`);
  const chron = chronicleText(chat);
  if (chron) semi.push(chron);
  const semiText = semi.join('\n\n');

  const lastUser = chat.messages.slice(0, end).reverse().find(x => x.role === 'user');
  const lore = scanLore(st0, chat, end);
  const sel = selectMemories(chat, ctx, lastUser ? txt(lastUser) : '');
  const dyn = [loreText(lore, M), ...collect(st0, 'context', ctx, chat).map(M), memoryText(chat, ctx, sel)].filter(Boolean).join('\n');
  const post = M(s.postPrompt || '').trim();

  let avail = s.context - (estTokens(sysText) + estTokens(semiText) + estTokens(dyn) + estTokens(post) + 60);
  const pool = chat.messages.slice(0, end).filter(x => isDialog(x) && x.id > m.coveredId);
  const picked = [];
  let histTok = 0;
  for (let i = pool.length - 1; i >= 0; i--) {
    const t = estTokens(txt(pool[i])) + 6;
    if (picked.length >= 2 && avail - t < 0) break;
    avail -= t; histTok += t;
    picked.unshift(pool[i]);
  }
  // 途中でプロフィールを切り替えた場合、以前の発言が誰としてのものかを添える
  const cur = chat.persona;
  const said = x => (x.role === 'user' && x.persona && (x.persona.kind !== cur?.kind || x.persona.id !== cur?.id)
    ? `（${resolvePersona(chat, x.persona).name}として）\n` : '') + txt(x);
  const msgs = [];
  for (const x of picked) {
    const r = x.role === 'user' ? 'user' : 'assistant', content = said(x), last = msgs.at(-1);
    if (last && last.role === r) last.content += '\n\n' + content;
    else msgs.push({ role: r, content });
  }
  if (!msgs.length || msgs[0].role === 'assistant') msgs.unshift({ role: 'user', content: '（ロールプレイを開始してください）' });
  if (mode === 'continue') msgs.push({ role: 'user', content: '（直前のあなたの応答の続きを、繰り返さずにそのまま書き継いでください。出力形式は同じ）' });
  else if (msgs.at(-1).role === 'assistant') msgs.push({ role: 'user', content: `（${ctx.user}の発言を待たずに、物語を自然に先へ進めてください）` });
  const last = msgs.at(-1);
  last.content = `<context>\n${dyn}\n</context>\n\n${last.content}${post ? `\n\n<instruction>\n${post}\n</instruction>` : ''}`;
  if (msgs.length >= 2) msgs[msgs.length - 2].cache = true;

  return {
    system: [{ text: sysText, cache: true }, { text: semiText, cache: true }],
    messages: msgs,
    info: {
      system: estTokens(sysText) + estTokens(semiText), memory: estTokens(dyn), history: histTok,
      msgs: picked.length, dropped: pool.length - picked.length,
      refs: sel.list.map(e => e.id), lore: lore.map(e => e.id), used: sel.list.length, total: m.entries.length, all: sel.all,
      plugins: plugs.map(x => x.p.id),
    },
  };
}
