// プラグイン: キャラクターの日記
// 数ターンごとにキャラクターが自分の視点で日記を書き、☰ メニューから読める
import { definePlugin, pluginState } from './registry.js';
import { S, curChat, chatCtx, macros, isDialog, maxTurn, saveChat } from '../core/store.js';
import { esc, uid, now, tl } from '../core/util.js';
import { notify } from '../core/hooks.js';
import { callLLM } from '../llm/providers.js';
import { logLines } from '../engine/memory.js';
import { ic, openSheet, closeAllSheets, setSheetBody } from '../ui/dom.js';

const entriesOf = chat => (pluginState(chat, 'diary').entries ||= []);

async function writeDiary(chat) {
  const ctx = chatCtx(chat), list = entriesOf(chat);
  const c = ctx.chars[list.length % Math.max(1, ctx.chars.length)];
  if (!c) return;
  const recent = chat.messages.filter(isDialog).slice(-12);
  const mem = chat.mem.entries.filter(e => e.scope === 'c:' + c.id).slice(-15).map(e => '- ' + e.text).join('\n');
  const content = `あなたは${c.name}です。最近の出来事を振り返り、${c.name}の一人称で日記を書いてください。{{user}}には見せないつもりの本音も含めてよい。200〜400字。日付や見出しは付けず本文のみ。

<character>
${[c.profile, c.personality, c.speech && '口調: ' + c.speech].filter(Boolean).join('\n')}
</character>

<memories>
${mem || '（なし）'}
</memories>

<recent>
${logLines(chat, recent, ctx)}
</recent>`;
  const res = await callLLM({ role: 'mem', kind: 'diary', system: [{ text: 'あなたはロールプレイのキャラクターとして、その人物の日記を書きます。' }], messages: [{ role: 'user', content: macros(content, ctx) }], maxTokens: 3000, temperature: 0.9 });
  const text = (res.text || '').trim();
  if (!text) return;
  list.push({ id: uid(), turn: maxTurn(chat), charId: c.id, name: c.name, text, t: now() });
  await saveChat(chat);
  notify(`${c.name}が日記を書きました（☰ → キャラクターの日記）`, 'ok', 3000);
}

const listHTML = chat => {
  const list = entriesOf(chat).slice().reverse();
  return `<div class="btn-row"><button class="btn sm" data-act="p:diary:write">${ic('edit', 'sm')}今すぐ書かせる</button></div>`
    + (list.length ? list.map(d => `<div class="diary"><div class="diary-h">${esc(d.name)}の日記 <span class="meta">${tl(d.turn)}</span></div><div class="pre">${esc(d.text)}</div></div>`).join('')
      : '<p class="empty-s">まだ日記はありません。トークが進むと書かれます。</p>');
};

definePlugin({
  id: 'diary',
  name: 'キャラクターの日記',
  desc: 'プレイ中にキャラクターが残した日記を読むことができます',
  help: '設定したターン数ごとに、キャラクターが自分の視点で日記を書きます。トーク画面の ☰ メニューから読めます。日記の作成には記憶処理用のモデルを使います。',
  defaults: { every: 8 },
  fields: [{ key: 'every', label: '日記を書く間隔（ターン）', type: 'number', min: 3, max: 50 }],

  async afterReply(chat, msg, cfg) {
    const last = entriesOf(chat).at(-1)?.turn || 0;
    if (msg.turn - last >= (Number(cfg.every) || 8)) await writeDiary(chat);
  },
  menu: chat => [{ label: 'キャラクターの日記', val: `${entriesOf(chat).length}件`, act: 'p:diary:open' }],

  actions: {
    open() {
      const chat = curChat();
      if (!chat) return;
      closeAllSheets();
      openSheet({ id: 'diary', title: 'キャラクターの日記', full: true, html: listHTML(chat) });
    },
    async write() {
      const chat = curChat();
      if (!chat || S.gen) return;
      notify('日記を書いています…', '', 1800);
      try { await writeDiary(chat); setSheetBody('diary', listHTML(chat)); } catch (e) { notify('日記の作成に失敗しました: ' + e.message, 'err', 6000); }
    },
  },
});
