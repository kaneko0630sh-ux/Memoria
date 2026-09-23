// LLM プロバイダの登録と呼び出し。プロバイダを増やすときは PROVIDERS に1件足すだけでよい
import { S } from '../core/store.js';
import { sleep, clamp } from '../core/util.js';
import { plainText } from '../engine/parse.js';

export class ApiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const origin = () => (/^https?:/.test(location.origin) ? { 'HTTP-Referer': location.origin } : {});

// kind: anthropic / compat（OpenAI互換） / gemini / mock
export const PROVIDERS = {
  anthropic: { label: 'Anthropic（Claude）', kind: 'anthropic', keyHint: 'sk-ant-...', suggest: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1', 'claude-opus-4-8'] },
  openai: { label: 'OpenAI', kind: 'compat', keyHint: 'sk-...', suggest: [], base: () => 'https://api.openai.com/v1', maxTokensKey: 'max_completion_tokens' },
  openrouter: { label: 'OpenRouter', kind: 'compat', keyHint: 'sk-or-...', suggest: [], base: () => 'https://openrouter.ai/api/v1', headers: () => ({ 'X-Title': 'Memoria', ...origin() }) },
  nanogpt: {
    label: 'NanoGPT', kind: 'compat', keyHint: 'NanoGPTのAPIキー', suggest: ['anthropic/claude-sonnet-5', 'deepseek-chat', 'moonshotai/kimi-k2.6', 'z-ai/glm-5.3-flash'],
    base: () => (S.settings.nanoSub ? 'https://nano-gpt.com/api/subscription/v1' : 'https://nano-gpt.com/api/v1'),
    thinking: (body, effort) => { body.reasoning_effort = effort === 'off' ? 'none' : effort; },
  },
  deepseek: {
    label: 'DeepSeek', kind: 'compat', keyHint: 'sk-...', suggest: ['deepseek-flash', 'deepseek-v4-pro'], base: () => 'https://api.deepseek.com',
    // DeepSeek は既定で思考あり（effort=high）。オフにすると大幅に速くなる
    thinking: (body, effort) => { if (effort === 'off') body.thinking = { type: 'disabled' }; else body.reasoning_effort = effort; },
  },
  gemini: { label: 'Google Gemini', kind: 'gemini', keyHint: 'AIza...', suggest: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  custom: { label: 'OpenAI互換（カスタムURL）', kind: 'compat', keyHint: '不要なら空欄', suggest: [], keyOptional: true, base: () => (S.settings.customBase || '').trim().replace(/\/+$/, '') },
  mock: { label: 'デモ（APIなし・動作確認用）', kind: 'mock', keyHint: '', suggest: ['demo'], keyOptional: true },
};

export const EFFORTS = [
  ['off', 'オフ（最速）'], ['low', 'low（速い）'], ['medium', 'medium'], ['high', 'high（じっくり）'], ['', '指定しない（モデル任せ）'],
];

export function llmCfg(role = 'main') {
  const s = S.settings;
  let provider = s.provider, model = s.models[provider], effort = s.effort;
  if (role === 'mem') {
    if (s.mem.provider) { provider = s.mem.provider; model = s.mem.model || s.models[provider]; }
    else if (s.mem.model) model = s.mem.model;
    effort = s.mem.effort;
  }
  if (!PROVIDERS[provider]) provider = 'mock';
  return { provider, def: PROVIDERS[provider], model: (model || '').trim(), key: (s.keys[provider] || '').trim(), effort };
}

/* ---------- 共通の通信処理 ---------- */
async function httpErr(res) {
  let t = '';
  try { t = await res.text(); } catch {}
  let msg = t;
  try { const j = JSON.parse(t); const e = Array.isArray(j) ? j[0]?.error : j.error; msg = e?.message || j.message || t; } catch {}
  const hint = res.status === 401 || res.status === 403 ? '（APIキーが無効か権限がありません）'
    : res.status === 429 ? '（レート制限または残高不足）'
    : res.status === 529 || res.status === 503 ? '（サーバー混雑中）' : '';
  return new ApiError(res.status, `HTTP ${res.status}${hint}: ${String(msg).slice(0, 400)}`);
}

async function* sseEvents(res, io) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    io.alive();
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') { reader.cancel().catch(() => {}); return; }
      if (!d) continue;
      try { yield JSON.parse(d); } catch {}
    }
  }
}

// 400系で弾かれたオプションを外して再送する（モデルごとの対応差を吸収）
async function withAdapt(body, attempt, adapters) {
  const used = new Set();
  for (;;) {
    try { return await attempt(body); } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      const i = adapters.findIndex((a, k) => !used.has(k) && a.test(body, e.message || ''));
      if (i < 0) throw e;
      used.add(i);
      adapters[i].apply(body);
    }
  }
}

/* ---------- 呼び出し口 ---------- */
// o: { role, kind, system:[{text,cache}], messages:[{role,content,cache}], maxTokens, temperature, stream, schema, signal, onText, onStatus }
// 無通信が続いたら打ち切る（思考中のデータ受信は「通信あり」として扱う）
const IDLE_MS = { stream: 120000, once: 240000 };

export async function callLLM(o) {
  const cfg = llmCfg(o.role);
  if (cfg.def.kind === 'mock') return callMock(o);
  if (!cfg.key && !cfg.def.keyOptional) throw new Error(`${cfg.def.label} のAPIキーが未設定です（マイページ → API）`);
  if (!cfg.model) throw new Error('モデルが未設定です（マイページ → API）');
  const fn = { anthropic: callAnthropic, compat: callCompat, gemini: callGemini }[cfg.def.kind];
  let started = false;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const outer = () => ctrl.abort();
    o.signal?.addEventListener('abort', outer);
    let timer, timedOut = false;
    const alive = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, o.stream ? IDLE_MS.stream : IDLE_MS.once); };
    const io = { alive, signal: ctrl.signal };
    alive();
    try {
      return await fn(cfg, { ...o, onText: o.onText && (t => { started = true; o.onText(t); }) }, io);
    } catch (e) {
      if (timedOut) throw new Error(`応答が途絶えました（${(o.stream ? IDLE_MS.stream : IDLE_MS.once) / 1000}秒間データなし）。混雑しているか思考に時間がかかっています。再生成するか、別のモデルをお試しください。`);
      if (e.name === 'AbortError') throw e;
      const retryable = [429, 500, 502, 503, 504, 529].includes(e.status);
      if (retryable && !started && attempt < 2) { await sleep(attempt ? 4000 : 1500); continue; }
      if (e instanceof TypeError) throw new Error('通信エラー: ' + e.message + '（ネットワーク、またはURL/CORSを確認してください）');
      throw e;
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', outer);
    }
  }
}

async function callAnthropic(cfg, o, io) {
  const m = cfg.model;
  const body = {
    model: m, max_tokens: o.maxTokens || 4000,
    messages: o.messages.map(x => ({ role: x.role, content: x.cache ? [{ type: 'text', text: x.content, cache_control: { type: 'ephemeral' } }] : x.content })),
  };
  const sys = (o.system || []).filter(b => b.text && b.text.trim())
    .map(b => (b.cache ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: b.text }));
  if (sys.length) body.system = sys;
  if (o.stream) body.stream = true;
  const modern = /opus-5|sonnet-5|fable|mythos|opus-4-[78]/.test(m);
  if (!modern && o.temperature != null) body.temperature = clamp(o.temperature, 0, 1); // 新世代モデルは temperature 非対応
  const oc = {};
  if (cfg.effort === 'off') {
    if (/sonnet-5|opus-4-[78]/.test(m)) body.thinking = { type: 'disabled' };
    else if (/opus-5|fable|mythos/.test(m)) oc.effort = 'low'; // 思考を切れない/切らない方がよいモデルは最小に
  } else if (cfg.effort && /opus-5|sonnet-5|fable|mythos|opus-4-[5-8]|sonnet-4-6/.test(m)) oc.effort = cfg.effort;
  if (o.schema) oc.format = { type: 'json_schema', schema: o.schema };
  if (Object.keys(oc).length) body.output_config = oc;
  if (/^claude-(opus-5|fable-5-1)$/.test(m)) body.fallbacks = 'default';

  const attempt = async b => {
    const headers = { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (b.fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(b), signal: io.signal });
    io.alive();
    if (!res.ok) throw await httpErr(res);
    if (!b.stream) {
      const j = await res.json();
      return { text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), stop: j.stop_reason, usage: j.usage };
    }
    let text = '', stop = null, usage = {};
    for await (const ev of sseEvents(res, io)) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; o.onText?.(text); }
      else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') o.onStatus?.('thinking');
      else if (ev.type === 'message_start') usage = { ...(ev.message?.usage || {}) };
      else if (ev.type === 'message_delta') { stop = ev.delta?.stop_reason || stop; Object.assign(usage, ev.usage || {}); }
      else if (ev.type === 'error') throw new ApiError(ev.error?.type === 'overloaded_error' ? 529 : 500, ev.error?.message || 'stream error');
    }
    return { text, stop, usage };
  };
  const dropOC = (b, k) => { delete b.output_config[k]; if (!Object.keys(b.output_config).length) delete b.output_config; };
  return withAdapt(body, attempt, [
    { test: (b, msg) => b.fallbacks && /fallback|beta/i.test(msg), apply: b => delete b.fallbacks },
    { test: (b, msg) => b.thinking && /thinking/i.test(msg), apply: b => delete b.thinking },
    { test: (b, msg) => b.output_config?.format && /format|schema|output_config/i.test(msg), apply: b => dropOC(b, 'format') },
    { test: (b, msg) => b.output_config?.effort && /effort/i.test(msg), apply: b => dropOC(b, 'effort') },
    { test: (b, msg) => b.temperature != null && /temperature/i.test(msg), apply: b => delete b.temperature },
  ]);
}

async function callCompat(cfg, o, io) {
  const base = cfg.def.base();
  if (!base) throw new Error('カスタムのベースURLが未設定です（マイページ → API）');
  const sysText = (o.system || []).map(b => b.text).filter(t => t && t.trim()).join('\n\n');
  const body = {
    model: cfg.model,
    messages: [...(sysText ? [{ role: 'system', content: sysText }] : []), ...o.messages.map(x => ({ role: x.role, content: x.content }))],
  };
  body[cfg.def.maxTokensKey || 'max_tokens'] = o.maxTokens || 4000;
  if (o.temperature != null) body.temperature = o.temperature;
  if (o.schema) body.response_format = { type: 'json_object' };
  if (o.stream) body.stream = true;
  if (cfg.effort && cfg.def.thinking) cfg.def.thinking(body, cfg.effort);
  const headers = { 'content-type': 'application/json', ...(cfg.def.headers?.() || {}) };
  if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;

  const attempt = async b => {
    const res = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(b), signal: io.signal });
    io.alive();
    if (!res.ok) throw await httpErr(res);
    if (!b.stream) {
      const j = await res.json();
      if (j.error) throw new ApiError(500, j.error.message || 'error');
      const c = j.choices?.[0];
      return { text: c?.message?.content || '', stop: c?.finish_reason, usage: j.usage };
    }
    let text = '', stop = null, usage = null;
    for await (const ev of sseEvents(res, io)) {
      if (ev.error) throw new ApiError(500, ev.error.message || 'stream error');
      const c = ev.choices?.[0], d = c?.delta;
      if (d?.content) { text += d.content; o.onText?.(text); }
      else if (d?.reasoning || d?.reasoning_content) o.onStatus?.('thinking');
      if (c?.finish_reason) stop = c.finish_reason;
      if (ev.usage) usage = ev.usage;
    }
    return { text, stop, usage };
  };
  return withAdapt(body, attempt, [
    { test: (b, m) => 'max_tokens' in b && /max_tokens|max_completion_tokens/i.test(m), apply: b => { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; } },
    { test: (b, m) => 'max_completion_tokens' in b && /max_completion_tokens/i.test(m), apply: b => { b.max_tokens = b.max_completion_tokens; delete b.max_completion_tokens; } },
    { test: (b, m) => 'temperature' in b && /temperature/i.test(m), apply: b => delete b.temperature },
    { test: (b, m) => b.response_format && /response_format|json/i.test(m), apply: b => delete b.response_format },
    { test: (b, m) => (b.reasoning_effort || b.thinking) && /reasoning|thinking/i.test(m), apply: b => { delete b.reasoning_effort; delete b.thinking; } },
  ]);
}

async function callGemini(cfg, o, io) {
  const model = cfg.model.replace(/^models\//, '');
  const sysText = (o.system || []).map(b => b.text).filter(t => t && t.trim()).join('\n\n');
  const contents = [];
  for (const x of o.messages) {
    const role = x.role === 'assistant' ? 'model' : 'user', last = contents.at(-1);
    if (last && last.role === role) last.parts[0].text += '\n\n' + x.content;
    else contents.push({ role, parts: [{ text: x.content }] });
  }
  const body = { contents, generationConfig: { maxOutputTokens: o.maxTokens || 4000 } };
  if (o.temperature != null) body.generationConfig.temperature = o.temperature;
  if (sysText) body.systemInstruction = { parts: [{ text: sysText }] };
  if (o.schema) body.generationConfig.responseMimeType = 'application/json';
  const pick = j => (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');

  const attempt = async b => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${o.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key }, body: JSON.stringify(b), signal: io.signal });
    io.alive();
    if (!res.ok) throw await httpErr(res);
    if (!o.stream) {
      const j = await res.json();
      if (!j.candidates?.length && j.promptFeedback?.blockReason) throw new ApiError(500, '入力がブロックされました: ' + j.promptFeedback.blockReason);
      return { text: pick(j), stop: j.candidates?.[0]?.finishReason, usage: j.usageMetadata };
    }
    let text = '', stop = null, usage = null;
    for await (const ev of sseEvents(res, io)) {
      if (ev.error) throw new ApiError(500, ev.error.message || 'stream error');
      if (ev.promptFeedback?.blockReason && !ev.candidates) throw new ApiError(500, '入力がブロックされました: ' + ev.promptFeedback.blockReason);
      const t = pick(ev);
      if (t) { text += t; o.onText?.(text); } else if (ev.candidates?.[0]?.content?.parts?.some(p => p.thought)) o.onStatus?.('thinking');
      stop = ev.candidates?.[0]?.finishReason || stop;
      usage = ev.usageMetadata || usage;
    }
    return { text, stop, usage };
  };
  return withAdapt(body, attempt, [
    { test: (b, m) => b.generationConfig.responseMimeType && /mime|json/i.test(m), apply: b => delete b.generationConfig.responseMimeType },
  ]);
}

// APIなしで画面と記憶の流れを確かめるためのデモ
async function callMock(o) {
  await sleep(250);
  const lastUser = [...o.messages].reverse().find(m => m.role === 'user')?.content || '';
  const plain = lastUser.replace(/<context>[\s\S]*?<\/context>/, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const block = (lastUser.match(/<(?:new_log|log)>[^\n]*\n([\s\S]*?)<\/(?:new_log|log)>/) || [])[1];
  const first = block ? block.split('\n').find(l => /^\[/.test(l.trim())) || '' : plain;
  const snip = plainText(first.replace(/^\[[^\]]+\]\s*[^:：]+[:：]\s*/, '')).slice(0, 36);
  const ids = [...lastUser.matchAll(/\[(m\d+)\]/g)].map(m => m[1]);
  if (o.kind === 'extract') {
    return { text: JSON.stringify({
      state: `- 時刻: 夜\n- 場所: デモの舞台\n- 直近の出来事: ${snip}`, arc: '（デモ）物語の序盤', threads: [{ t: 'デモの謎', s: '進行中', n: '手掛かりを探している' }],
      rel: [], scene: ['デモの舞台'], recall: ids.slice(-2), brief: '（デモ）次は謎に一歩近づく',
      add: snip ? [{ scope: 'world', text: `（デモ）${snip}`, imp: 2, tag: 'event', ents: ['デモの舞台'] }] : [], update: [], remove: [],
    }) };
  }
  if (o.kind === 'consolidate') {
    const d = o.demo || [];
    return { text: JSON.stringify({ entries: d.slice(-Math.max(1, Math.ceil(d.length * 0.6))).map(e => ({ text: e.text, imp: e.imp, tag: e.tag || 'event', ents: e.ents || [], from: [e.id] })) }) };
  }
  if (o.kind === 'chronicle' || o.kind === 'compress') return { text: `（デモ要約）${snip || '物語'}……などの出来事があった。` };
  if (o.kind === 'choices') return { text: JSON.stringify({ choices: ['それで、君はどうしたい？', '*黙って隣に座る*', '……少し、歩かないか'] }) };
  if (o.kind === 'diary') return { text: '（デモ日記）今日は、少しだけ心が動いた日だった。あの人の言葉を、まだ何度も思い出している。' };
  if (o.kind === 'test') return { text: '接続OK（デモ）' };
  const name = o.demoName || 'キャラクター';
  const said = plainText(plain).slice(0, 24) || '……';
  const reply = `【ナレーション】\n窓の外で、霧笛が低く鳴った。古い柱時計が、少し遅れて十時を打つ\n【${name}】\n*言葉を反芻するように、少しだけ首をかしげた。${said}。頭の中で、その一言が何度も跳ね返る*\n……本気で言ってます？\n*テーブルに置いた指先が、とん、と一度だけ鳴った*\nいいですよ。続き、聞かせてください。\n【ナレーション】\nこれはAPIを使わないデモ応答。マイページでAPIキーとモデルを設定すると、本物のAIが物語を紡ぐ`;
  o.onStatus?.('thinking');
  await sleep(400);
  let out = '';
  for (const ch of reply.match(/[\s\S]{1,3}/g)) {
    if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    out += ch;
    o.onText?.(out);
    await sleep(16);
  }
  return { text: out, stop: 'end_turn' };
}

export async function fetchModels(p) {
  const def = PROVIDERS[p], key = (S.settings.keys[p] || '').trim();
  if (def.kind === 'mock') return ['demo'];
  if (def.kind === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!r.ok) throw await httpErr(r);
    return ((await r.json()).data || []).map(m => m.id);
  }
  if (def.kind === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw await httpErr(r);
    return ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  }
  const base = def.base();
  if (!base) throw new Error('ベースURLが未設定です');
  const r = await fetch(base + '/models', { headers: key ? { authorization: 'Bearer ' + key } : {} });
  if (!r.ok) throw await httpErr(r);
  return ((await r.json()).data || []).map(m => m.id).sort();
}

// 使ったモデルを「最近」に記録（モデル切替シートで上に出す）
export function rememberModel(provider, model) {
  if (!model || PROVIDERS[provider]?.kind === 'mock') return false;
  const r = (S.settings.recentModels[provider] || []).filter(x => x !== model);
  r.unshift(model);
  S.settings.recentModels[provider] = r.slice(0, 8);
  return true;
}
