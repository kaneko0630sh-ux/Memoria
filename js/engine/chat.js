// トークの進行（生成・送信・選択肢・巻き戻し）。UIには hooks で通知する
import { S, txt, isDialog, lastDialog, maxTurn, chatCtx, macros, touch, saveChat, saveSettings, getStory, newMem } from '../core/store.js';
import { uid, now, parseJSON } from '../core/util.js';
import { emit, notify } from '../core/hooks.js';
import { callLLM, llmCfg, rememberModel } from '../llm/providers.js';
import { buildChatRequest } from './prompt.js';
import { commitMemory, restoreMemoryBefore, logLines } from './memory.js';
import { runAfterReply } from '../plugins/registry.js';

const CHOICE_SYS = 'あなたはロールプレイの進行補助です。{{user}}が次に取りうる行動や台詞の選択肢を提案します。出力はJSONのみです。';
const CHOICE_SCHEMA = { type: 'object', additionalProperties: false, required: ['choices'], properties: { choices: { type: 'array', items: { type: 'string' } } } };
const isCut = stop => /max_tokens|length|MAX_TOKENS/.test(stop || '');

export function createTalk(story, profile) {
  const n = S.chats.filter(c => c.storyId === story.id).length;
  const persona = S.settings.persona;
  const chat = {
    id: uid(), storyId: story.id, title: story.title + (n ? `（${n + 1}）` : ''),
    userName: profile?.name || persona.name || 'あなた', userDesc: profile ? profile.desc : persona.desc || '',
    note: '', choices: !!story.style?.choices, messages: [], seq: 0, createdAt: now(), updatedAt: now(),
    mem: newMem(), snaps: [], pstate: {},
  };
  const ctx = chatCtx(chat);
  if (story.opening?.trim()) chat.messages.push({ id: ++chat.seq, role: 'ai', swipes: [macros(story.opening, ctx).trim()], sw: 0, turn: 0, t: now(), mdl: [] });
  return chat;
}

export async function generate(chat, { mode = 'reply', regenMsg = null } = {}) {
  if (S.gen) { notify('生成中です'); return; }
  const s = S.settings;
  let target, end, base = '';
  if (regenMsg) {
    target = regenMsg;
    end = chat.messages.indexOf(target);
    target.swipes.push('');
    target.sw = target.swipes.length - 1;
  } else if (mode === 'continue') {
    target = lastDialog(chat);
    if (!target || target.role !== 'ai') { notify('続きを書かせる応答がありません'); return; }
    end = chat.messages.length;
    base = txt(target);
  } else {
    target = { id: ++chat.seq, role: 'ai', swipes: [''], sw: 0, turn: maxTurn(chat), t: now(), mdl: [] };
    chat.messages.push(target);
    end = chat.messages.length - 1;
  }
  const idx = target.sw, cfg = llmCfg('main');
  target.mdl ||= [];
  const prevMdl = target.mdl[idx];
  target.mdl[idx] = cfg.def.kind === 'mock' ? 'demo' : cfg.model;
  const setText = t => { target.swipes[idx] = base ? base.trimEnd() + '\n' + t.replace(/^\s+/, '') : t.replace(/^\s+/, ''); };
  const ctrl = new AbortController();
  S.gen = { chatId: chat.id, msgId: target.id, ctrl, status: 'wait', t0: now() };
  chat.lastChoices = null;
  emit('gen:changed', chat);
  let ok = false;
  try {
    const req = buildChatRequest(chat, { end, mode });
    S.lastPrompt[chat.id] = req;
    target.refs = req.info.refs;
    target.lore = req.info.lore;
    const res = await callLLM({
      role: 'main', kind: 'chat', demoName: chatCtx(chat).chars[0]?.name,
      system: req.system, messages: req.messages, maxTokens: s.maxTokens, temperature: s.temperature,
      stream: s.streaming, signal: ctrl.signal,
      onText: t => { S.gen.status = 'writing'; setText(t); emit('gen:delta', chat, target); },
      onStatus: st => { if (S.gen.status !== 'writing') { S.gen.status = st; emit('gen:status', chat); } },
    });
    const out = String(res.text || '').replace(/<context>[\s\S]*?<\/context>/g, '').replace(/^\s*<\/?(context|instruction)>\s*/g, '');
    setText(out);
    if (!out.trim()) {
      throw new Error(res.stop === 'refusal' ? 'モデルが応答を辞退しました（refusal）。表現を変えるか、別のモデルでお試しください。'
        : isCut(res.stop) ? '最大出力トークンに達し、本文が空でした。マイページで最大出力トークンを増やすか、思考の深さを下げてください。'
        : '空の応答が返りました。');
    }
    if (isCut(res.stop)) notify('最大出力トークンで途中終了しました（メッセージをタップ →「続きを書かせる」）', 'warn', 4000);
    if (rememberModel(cfg.provider, cfg.model)) saveSettings();
    ok = true;
  } catch (e) {
    if (e.name === 'AbortError') ok = txt(target).trim().length > (base ? base.trim().length : 0);
    else notify(e.message, 'err', 9000);
  }
  if (!ok) {
    if (regenMsg) { target.swipes.splice(idx, 1); target.mdl.splice(idx, 1); target.sw = Math.max(0, target.swipes.length - 1); }
    else if (mode === 'continue') { target.swipes[idx] = base; target.mdl[idx] = prevMdl; }
    else chat.messages.splice(chat.messages.indexOf(target), 1);
  }
  S.gen = null;
  touch(chat);
  await saveChat(chat);
  emit('gen:changed', chat);
  if (!ok) return;
  if (chat.choices && mode !== 'continue') fetchChoices(chat, target);
  runAfterReply(chat, getStory(chat.storyId), target).then(() => saveChat(chat));
}

export async function sendMessage(chat, text) {
  if (!chat || S.gen) return;
  text = String(text || '').trim();
  if (!text) return aiTurn(chat);
  commitMemory(chat, chat.messages.at(-1)?.id || 0);
  chat.messages.push({ id: ++chat.seq, role: 'user', swipes: [text], sw: 0, turn: maxTurn(chat) + 1, t: now() });
  touch(chat);
  await saveChat(chat);
  return generate(chat, { mode: 'reply' });
}

// 自分は発言せず、AIに物語を進めてもらう
export function aiTurn(chat) {
  const last = lastDialog(chat);
  if (last?.role === 'ai') commitMemory(chat, last.id);
  return generate(chat, { mode: 'reply' });
}

export function regenerate(chat) {
  const msg = lastDialog(chat);
  if (msg?.role === 'ai') return generate(chat, { regenMsg: msg });
}

// 候補の切り替え。最後の候補の次へ進むと新しく生成する
export function swipe(chat, msg, dir) {
  if (S.gen) return;
  const next = msg.sw + dir;
  if (next < 0) return;
  if (next >= msg.swipes.length) return generate(chat, { regenMsg: msg });
  msg.sw = next;
  chat.lastChoices = null;
  saveChat(chat);
  emit('gen:changed', chat);
}

// このメッセージ以降を削除し、記憶もその時点へ戻す
export async function rewindTo(chat, msg) {
  const r = restoreMemoryBefore(chat, msg.id);
  chat.messages.splice(chat.messages.indexOf(msg));
  chat.lastChoices = null;
  touch(chat);
  await saveChat(chat);
  emit('memory:changed', chat);
  return r;
}

export async function fetchChoices(chat, msg) {
  const ctx = chatCtx(chat);
  S.choiceBusy[chat.id] = true;
  emit('choices:changed', chat);
  try {
    const recent = chat.messages.filter(isDialog).slice(-4);
    const content = `直近のやり取り:\n${logLines(chat, recent, ctx)}\n\n${ctx.user}が次に取りうる行動・台詞の選択肢を3つ、方向性を変えて提案してください。各40字以内。台詞はそのまま書き、行動は *…* で囲む。\n出力: {"choices":["...","...","..."]}`;
    const res = await callLLM({ role: 'mem', kind: 'choices', system: [{ text: macros(CHOICE_SYS, ctx) }], messages: [{ role: 'user', content }], maxTokens: 2000, schema: CHOICE_SCHEMA, temperature: 0.9 });
    const items = (parseJSON(res.text)?.choices || []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
    if (items.length && lastDialog(chat)?.id === msg.id) { chat.lastChoices = { msgId: msg.id, items }; saveChat(chat); }
  } catch (e) {
    notify('選択肢の生成に失敗しました: ' + e.message, 'warn', 4000);
  } finally {
    delete S.choiceBusy[chat.id];
    emit('choices:changed', chat);
  }
}
