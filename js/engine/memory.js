// 記憶エンジン
// - 毎ターン: 確定したやり取りから事実を抽出し、キャラ/世界/ユーザー別の記憶帳に積む。
//   同時に「現在の状況」「進行度（局面・未解決の筋・関係）」「次の場面で使う記憶」「演出メモ」を更新する
// - 容量超過: その記憶帳だけを統合・圧縮して一定量に保つ（ピン留めは保護）
// - 直近ウィンドウから外れた会話: 「あらすじ」に要約して引き継ぐ
// - 注入時: 常駐（固定・★5・進行度）＋記憶係が選んだ記憶＋場面の要素に結びつく記憶だけを渡す
import { S, txt, isDialog, chatCtx, macros, charOf, findChar, saveChat, newMem, resolvePersona } from '../core/store.js';
import { clone, clamp, now, uid, tl, estTokens, parseJSON } from '../core/util.js';
import { emit } from '../core/hooks.js';
import { callLLM } from '../llm/providers.js';

export const TAGS = { event: '出来事', relation: '関係', promise: '約束', secret: '秘密', status: '状態', lore: '設定', item: '所持品' };
const TAG_KEYS = Object.keys(TAGS);
const MEM_BATCH = 12;
const SCENE_MAX = 14, SCENE_CHARS = 2200;

const EXTRACT_SYS = `あなたはロールプレイ小説の「記憶係」です。新しい会話ログを読み、物語の一貫性を保つための記憶データベースを更新します。出力はJSONのみです。

## 記憶の区分 (scope)
- "world": 世界・場所・組織・NPC・社会的な出来事・世界のルールについて判明した事実
- "user": {{user}}自身について判明した事実（素性・能力・所持品・負傷・重要な発言）
- キャラクター名（{{chars}} のいずれかをそのまま書く）: そのキャラクター自身の状態・感情の変化・関係性・約束・秘密、そのキャラが知ったこと／知らないこと

## ルール
1. add: 新しく確定した事実だけを追加する。既存記憶や静的設定と同じ内容は追加しない。
2. update: 既存記憶の内容が変化した（関係の進展、状態の変化、所持品の移動、真相の判明など）場合、そのIDの文を最新の内容に書き換える。
3. remove: 完全に誤り・無効になった記憶のIDのみ。迷ったら残す。「固定」の記憶は変更しない。
4. 1項目＝1つの事実。主語を明記した簡潔な文（目安80字以内）。代名詞や「さっき」などの相対表現は使わない。
5. 物語中で確定したことだけを書く。推測・予想・比喩は書かない。キャラの嘘は「〜と主張した」と書く。
6. 誰が何を知っているかを区別する（例:「リーネは{{user}}の正体を知らない」）。
7. imp（重要度1〜5）: 5=物語の根幹（正体・誓い・死・重大な秘密） 4=関係性や目的の大きな変化・重要な約束 3=今後参照されうる出来事や設定 2=細部 1=些細
8. tag: event(出来事) / relation(関係) / promise(約束) / secret(秘密) / status(状態) / lore(設定) / item(所持品)
9. ents: 各記憶（add / update）に、関わる固有の要素（場所・物・組織・脇役・出来事や筋の呼び名）を0〜4個。短い名詞で、表記を毎回そろえる（例: "航海日誌" "第三埠頭" "灰の手"）。{{user}}と登場キャラの名前は入れない。
10. state: 最新の「現在の状況」を丸ごと書き直す。箇条書きで、日時・時間帯／現在地／その場にいる人物と様子（服装・負傷・感情）／重要な所持品／進行中の目的。{{stateBudget}}字以内。
11. arc: 物語の現在の局面と当面の目標を1〜2文で書き直す。
12. threads: 未解決の筋（約束・伏線・謎・目的・対立）を最大8件、丸ごと書き直す。t=短い名前、s="未着手" か "進行中"、n=現状を1文。解決した筋は外し、必要なら add で記憶に残す。
13. rel: 登場キャラごとに、{{user}}との関係の現在地を1文（感情、信頼の段階、呼び方の変化など）。
14. scene: 直近の場面に出ている要素（場所・物・その場の脇役・話題）を短い名詞で最大8個。表記は ents とそろえる。
15. recall: existing_memory の中から、次の場面の応答で踏まえるべき記憶のIDを最大12件。今の話題・場所・人物・未解決の筋に関わるもの、今こそ効いてくる伏線や約束を優先する。
16. brief: 次の応答で書き手が意識すべきことを150字以内で（例: 約束の期限が今夜に迫っている／ミオはまだ竜の名前を明かしていない）。
17. 追加するものがなければ空配列にする。

出力形式:
{"state":"...","arc":"...","threads":[{"t":"...","s":"進行中","n":"..."}],"rel":[{"name":"...","text":"..."}],"scene":["..."],"recall":["m3"],"brief":"...","add":[{"scope":"...","text":"...","imp":3,"tag":"event","ents":["..."]}],"update":[{"id":"m12","text":"...","imp":4,"ents":["..."]}],"remove":["m3"]}`;

const CONS_SYS = 'あなたはロールプレイ小説の記憶を整理する編集者です。重要な情報を失わずに記憶を統合・圧縮します。出力はJSONのみです。';
const CHRON_SYS = `あなたはロールプレイ小説のあらすじ編集者です。後から物語を続ける作者が読むための要約を書きます。
- 時系列で「誰が・どこで・何をして・どうなったか」を簡潔に。
- 重要な台詞・約束・伏線・秘密の開示、関係や感情の転機は必ず残す。
- {{user}}と各キャラクターの名前を明記し、代名詞に頼らない。
- 前置き・見出し・記号は不要。要約本文のみを出力する。`;

const strArr = { type: 'array', items: { type: 'string' } };
function extractSchema(names) {
  const obj = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });
  return obj({
    state: { type: 'string' }, arc: { type: 'string' },
    threads: { type: 'array', items: obj({ t: { type: 'string' }, s: { type: 'string', enum: ['未着手', '進行中'] }, n: { type: 'string' } }) },
    rel: { type: 'array', items: obj({ name: { type: 'string' }, text: { type: 'string' } }) },
    scene: strArr, recall: strArr, brief: { type: 'string' },
    add: { type: 'array', items: obj({ scope: { type: 'string', enum: [...new Set(['world', 'user', ...names])] }, text: { type: 'string' }, imp: { type: 'integer' }, tag: { type: 'string', enum: TAG_KEYS }, ents: strArr }) },
    update: { type: 'array', items: obj({ id: { type: 'string' }, text: { type: 'string' }, imp: { type: 'integer' }, ents: strArr }) },
    remove: strArr,
  });
}
const CONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['entries'],
  properties: { entries: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'imp', 'tag', 'ents', 'from'], properties: {
    text: { type: 'string' }, imp: { type: 'integer' }, tag: { type: 'string', enum: TAG_KEYS }, ents: strArr, from: strArr } } } },
};

/* ---------- helpers ---------- */
export const clampImp = v => clamp(Math.round(Number(v) || 3), 1, 5);
export const scopeBudget = sc => { const b = S.settings.mem.budgets; return sc === 'world' ? b.world : sc === 'user' ? b.user : b.char; };
const scopeChars = (chat, sc) => chat.mem.entries.filter(e => e.scope === sc).reduce((a, e) => a + e.text.length, 0);
export const entryNum = e => Number(String(e.id).replace(/\D/g, '')) || 0;
const cleanEnts = a => (Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(x => x && x.length <= 24).slice(0, 5);
export const isMemBusy = chat => !!S.memJobs[chat.id];

export function scopeLabel(sc, ctx) {
  if (sc === 'world') return '世界';
  if (sc === 'user') return ctx.user;
  const id = sc.slice(2);
  return ctx.chars.find(c => c.id === id)?.name || findChar(id)?.name || '（削除されたキャラ）';
}
export function memScopes(chat, ctx) {
  const ids = ctx.chars.map(c => 'c:' + c.id);
  for (const e of chat.mem.entries) if (e.scope.startsWith('c:') && !ids.includes(e.scope)) ids.push(e.scope);
  return [...ids, 'world', 'user'];
}
export function memLog(chat, text, err = false) {
  chat.mem.log.push({ t: now(), text, err });
  if (chat.mem.log.length > 80) chat.mem.log.splice(0, chat.mem.log.length - 80);
}
export function logLines(chat, msgs, ctx) {
  const aiName = ctx.chars.map(c => c.name).join('・') || 'AI';
  const who = x => (x.role === 'user' ? (x.persona ? resolvePersona(chat, x.persona).name : ctx.user) : aiName);
  return msgs.map(x => `[${tl(x.turn)}] ${who(x)}: ${txt(x)}`).join('\n\n');
}
function resolveScope(s, ctx) {
  s = String(s || '').trim();
  const low = s.toLowerCase();
  if (!s || low === 'world' || s === '世界') return 'world';
  if (low === 'user' || s === '{{user}}' || s === ctx.user) return 'user';
  const c = charOf(s, ctx.chars);
  return c ? 'c:' + c.id : 'world';
}
const changed = chat => emit('memory:changed', chat);

/* ---------- snapshots（巻き戻し用） ---------- */
function pushSnap(chat, at) {
  const d = clone(chat.mem);
  d.log = [];
  const last = chat.snaps.at(-1);
  if (last && last.at === at) last.data = d;
  else chat.snaps.push({ at, data: d });
  while (chat.snaps.length > 15) chat.snaps.shift();
}
// msgId 以降を消したとき、その直前時点の記憶へ戻す。戻り値: none / ok / fail
export function restoreMemoryBefore(chat, msgId) {
  const m = chat.mem;
  if (m.lastId < msgId) return 'none';
  const snap = chat.snaps.filter(s => s.at <= msgId).at(-1);
  if (!snap) { m.rev++; return 'fail'; }
  const log = m.log, rev = m.rev + 1;
  chat.mem = clone(snap.data);
  chat.mem.rev = rev;
  chat.mem.log = log;
  chat.snaps = chat.snaps.filter(s => s.at < snap.at);
  memLog(chat, `巻き戻しに合わせて記憶を${tl(chat.mem.turn)}時点へ復元しました`);
  return 'ok';
}

/* ---------- ジョブの実行 ---------- */
export function queueMemory(chat, uptoId, opts = {}) {
  const prev = S.memJobs[chat.id] || Promise.resolve();
  const job = prev.catch(() => {}).then(() => memoryJob(chat, uptoId, opts))
    .catch(e => { memLog(chat, '記憶更新エラー: ' + e.message, true); emit('memory:flash', chat, '記憶の更新に失敗しました', true); saveChat(chat); })
    .finally(() => { if (S.memJobs[chat.id] === job) delete S.memJobs[chat.id]; changed(chat); });
  S.memJobs[chat.id] = job;
  changed(chat);
  return job;
}
// 新しい発言を送った時点で、それまでのやり取りは「確定」→ 記憶へ
export function commitMemory(chat, uptoId) {
  if (S.settings.mem.auto && uptoId > chat.mem.lastId) queueMemory(chat, uptoId);
}

async function memoryJob(chat, uptoId, opts) {
  const tot = { add: 0, upd: 0, del: 0 };
  const alive = () => S.chats.includes(chat);
  for (let guard = 0; guard < 300; guard++) {
    const pending = chat.messages.filter(x => isDialog(x) && x.id > chat.mem.lastId && x.id <= uptoId);
    if (!pending.length) break;
    const batch = pending.slice(0, MEM_BATCH), rev = chat.mem.rev;
    pushSnap(chat, batch[0].id);
    const res = await extractFacts(chat, batch);
    if (!alive()) return;
    if (chat.mem.rev !== rev || !batch.every(b => chat.messages.includes(b))) { memLog(chat, '会話が変更されたため、今回の抽出結果を破棄しました'); return; }
    const r = applyExtraction(chat, res, batch);
    tot.add += r.add; tot.upd += r.upd; tot.del += r.del;
    chat.mem.lastId = batch.at(-1).id;
    chat.mem.turn = Math.max(chat.mem.turn, batch.at(-1).turn);
    await saveChat(chat);
    changed(chat);
    await maintain(chat);
  }
  if (opts.consolidateScope) await consolidate(chat, opts.consolidateScope, true);
  else await maintain(chat);
  if (tot.add || tot.upd || tot.del) emit('memory:flash', chat, `記憶 +${tot.add}${tot.upd ? `・更新${tot.upd}` : ''}${tot.del ? `・削除${tot.del}` : ''}`);
}

async function maintain(chat) {
  try {
    const scopes = [...new Set(chat.mem.entries.map(e => e.scope))].filter(sc => scopeChars(chat, sc) > scopeBudget(sc));
    for (const sc of scopes) { if (!S.chats.includes(chat)) return; await consolidate(chat, sc, false); }
    await updateChronicle(chat);
  } catch (e) {
    memLog(chat, '整理処理エラー: ' + e.message, true);
  }
}

async function extractFacts(chat, batch) {
  const s = S.settings, ctx = chatCtx(chat), m = chat.mem, M = t => macros(t, ctx);
  const names = ctx.chars.map(c => c.name);
  const prev = chat.messages.slice(0, chat.messages.indexOf(batch[0])).filter(isDialog).slice(-2);
  const existing = m.entries.slice().sort((a, b) => a.turn - b.turn || entryNum(a) - entryNum(b))
    .map(e => `[${e.id}] (${scopeLabel(e.scope, ctx)} ★${e.imp} ${tl(e.turn)}${e.ents?.length ? ` 〈${e.ents.join('・')}〉` : ''}${e.pinned ? ' 固定' : ''}) ${e.text}`).join('\n');
  const st = ctx.story;
  const statics = [
    st?.prompt?.trim() ? `【ストーリー】\n${M(st.prompt).slice(0, 1500)}` : '',
    st?.world?.trim() ? `【世界観・設定】\n${M(st.world).slice(0, 1500)}` : '',
    ...ctx.chars.map(c => `【${c.name}】\n${M([c.profile, c.personality].filter(Boolean).join('\n')).slice(0, 800)}`),
  ].filter(Boolean).join('\n\n');
  const sys = M(EXTRACT_SYS.replaceAll('{{chars}}', names.join('、') || '（なし）').replaceAll('{{stateBudget}}', String(s.mem.budgets.state)));
  const user = `登場キャラクター: ${names.join('、') || '（なし）'}\nユーザーの名前: ${ctx.user}\n\n`
    + (statics ? `<static_settings>（既に設定済み。重複して記憶しない）\n${statics}\n</static_settings>\n\n` : '')
    + `<existing_memory>\n${existing || '（なし）'}\n</existing_memory>\n\n`
    + `<current_state>\n${m.state || '（未記録）'}\n</current_state>\n\n<current_progress>\n${progressText(m) || '（未記録）'}\n</current_progress>\n\n`
    + (prev.length ? `<previous_context>（参考のみ・抽出対象外）\n${logLines(chat, prev, ctx)}\n</previous_context>\n\n` : '')
    + `<new_log>（ここから抽出する）\n${logLines(chat, batch, ctx)}\n</new_log>`;
  const call = content => callLLM({ role: 'mem', kind: 'extract', system: [{ text: sys, cache: true }], messages: [{ role: 'user', content }], maxTokens: 8000, schema: extractSchema(names), temperature: 0.2 });
  let j = parseJSON((await call(user)).text);
  if (!j) j = parseJSON((await call(user + '\n\n※出力は有効なJSONオブジェクトのみ。前置きやコードブロックは付けない。')).text);
  if (!j) throw new Error('記憶抽出の結果をJSONとして読み取れませんでした');
  return j;
}

function applyExtraction(chat, res, batch) {
  const m = chat.mem, ctx = chatCtx(chat), turn = batch.at(-1).turn;
  const r = { add: 0, upd: 0, del: 0 };
  const str = v => (typeof v === 'string' ? v.trim() : '');
  if (str(res.state)) m.state = str(res.state);
  if (str(res.arc)) m.arc = str(res.arc);
  if (Array.isArray(res.threads)) m.threads = res.threads.filter(t => str(t?.t)).slice(0, 10).map(t => ({ t: str(t.t), s: t.s === '未着手' ? '未着手' : '進行中', n: str(t.n) }));
  if (Array.isArray(res.rel)) m.rel = res.rel.filter(x => str(x?.name) && str(x?.text)).slice(0, 8).map(x => ({ name: str(x.name), text: str(x.text) }));
  if (Array.isArray(res.scene)) m.scene = res.scene.map(x => str(String(x))).filter(x => x && x.length <= 24).slice(0, 10);
  if (typeof res.brief === 'string') m.brief = str(res.brief).slice(0, 300);
  for (const a of Array.isArray(res.add) ? res.add : []) {
    const text = str(a?.text);
    if (!text) continue;
    const scope = resolveScope(a.scope, ctx);
    if (m.entries.some(e => e.scope === scope && e.text === text)) continue;
    m.entries.push({ id: 'm' + (++m.seq), scope, text, imp: clampImp(a.imp), tag: TAG_KEYS.includes(a.tag) ? a.tag : '', ents: cleanEnts(a.ents), turn, src: 'auto' });
    r.add++;
  }
  for (const u of Array.isArray(res.update) ? res.update : []) {
    const e = m.entries.find(e => e.id === u?.id), text = str(u?.text);
    if (!e || e.pinned || !text) continue;
    if (cleanEnts(u.ents).length) e.ents = cleanEnts(u.ents);
    if (e.text !== text || e.imp !== clampImp(u.imp)) { e.text = text; e.imp = clampImp(u.imp); e.turn = turn; r.upd++; }
  }
  for (const id of Array.isArray(res.remove) ? res.remove : []) {
    const i = m.entries.findIndex(e => e.id === id);
    if (i >= 0 && !m.entries[i].pinned) { m.entries.splice(i, 1); r.del++; }
  }
  if (Array.isArray(res.recall)) m.recall = res.recall.filter(id => m.entries.some(e => e.id === id)).slice(0, 14);
  memLog(chat, `${tl(batch[0].turn)}〜${tl(turn)} を記憶: 追加${r.add}・更新${r.upd}・削除${r.del}`);
  return r;
}

async function consolidate(chat, scope, force) {
  const ctx = chatCtx(chat), m = chat.mem, rev = m.rev;
  const budget = scopeBudget(scope);
  const items = m.entries.filter(e => e.scope === scope && !e.pinned);
  const pinnedChars = m.entries.filter(e => e.scope === scope && e.pinned).reduce((a, e) => a + e.text.length, 0);
  const cur = items.reduce((a, e) => a + e.text.length, 0);
  if (items.length < 3 || cur < 200) return;
  if (!force && cur + pinnedChars <= budget) return;
  const target = Math.max(150, Math.floor(Math.min(budget, cur + pinnedChars) * 0.7) - pinnedChars);
  const label = scopeLabel(scope, ctx);
  const list = items.slice().sort((a, b) => a.turn - b.turn).map(e => `[${e.id}] ★${e.imp} ${tl(e.turn)}${e.ents?.length ? ` 〈${e.ents.join('・')}〉` : ''} ${e.text}`).join('\n');
  const prompt = `次は「${label}」についての記憶一覧です（合計${cur}字）。重要な情報を失わずに、合計${target}字以内に整理・統合してください。

ルール:
- ★4〜5の記憶は内容を保ったまま残す（文の短縮は可）。
- 関連する記憶は1つにまとめる。古く些細な記憶は要約するか削除する。
- 同じ事柄で新旧が矛盾する場合は新しいターンの内容を正とする。
- 各項目は主語を明記した簡潔な文にする。ents は統合元の要素をそろえて引き継ぐ。
- from には統合元のIDを列挙する。

<memories>
${list}
</memories>

出力形式: {"entries":[{"text":"...","imp":3,"tag":"event","ents":["..."],"from":["m1","m4"]}]}`;
  const res = await callLLM({ role: 'mem', kind: 'consolidate', demo: items, system: [{ text: macros(CONS_SYS, ctx) }], messages: [{ role: 'user', content: macros(prompt, ctx) }], maxTokens: 8000, schema: CONS_SCHEMA, temperature: 0.3 });
  if (chat.mem.rev !== rev || !S.chats.includes(chat)) return;
  const out = (parseJSON(res.text)?.entries || []).filter(e => e && String(e.text || '').trim());
  if (!out.length) throw new Error(`${label}の記憶の圧縮結果が空でした`);
  const newChars = out.reduce((a, e) => a + String(e.text).trim().length, 0);
  if (newChars >= cur) { memLog(chat, `${label}: 圧縮しても短くならなかったため見送りました`); return; }
  const byId = new Map(items.map(e => [e.id, e]));
  chat.mem.entries = chat.mem.entries.filter(e => !byId.has(e.id));
  for (const e of out) {
    const src = (Array.isArray(e.from) ? e.from : []).map(id => byId.get(id)).filter(Boolean);
    const ents = cleanEnts(e.ents).length ? cleanEnts(e.ents) : cleanEnts([...new Set(src.flatMap(x => x.ents || []))]);
    chat.mem.entries.push({ id: 'm' + (++chat.mem.seq), scope, text: String(e.text).trim(), imp: clampImp(e.imp), tag: TAG_KEYS.includes(e.tag) ? e.tag : '', ents, turn: src.length ? Math.max(...src.map(x => x.turn)) : chat.mem.turn, src: 'merged' });
  }
  chat.mem.recall = chat.mem.recall.filter(id => chat.mem.entries.some(x => x.id === id));
  memLog(chat, `${label}の記憶を整理: ${items.length}件 ${cur}字 → ${out.length}件 ${newChars}字`);
  await saveChat(chat);
  changed(chat);
}

async function updateChronicle(chat) {
  const s = S.settings;
  for (let guard = 0; guard < 60; guard++) {
    const m = chat.mem;
    const raw = chat.messages.filter(x => isDialog(x) && x.id > m.coveredId);
    const rawTok = raw.reduce((a, x) => a + estTokens(txt(x)), 0);
    const over = raw.length > s.mem.recent + s.mem.chunk || (rawTok > s.context * 0.6 && raw.length > 8);
    if (!over) break;
    const chunk = raw.slice(0, Math.max(2, Math.min(s.mem.chunk, raw.length - 6)));
    if (chunk.at(-1).id > m.lastId) break; // 事実抽出が済んでから要約する
    const rev = m.rev;
    const text = await summarizeChunk(chat, chunk);
    if (chat.mem.rev !== rev || !S.chats.includes(chat) || !chunk.every(c => chat.messages.includes(c))) return;
    chat.mem.chronicle.push({ id: uid(), from: chunk[0].turn, to: chunk.at(-1).turn, text });
    chat.mem.coveredId = chunk.at(-1).id;
    memLog(chat, `あらすじに追加: ${tl(chunk[0].turn)}〜${tl(chunk.at(-1).turn)}（${text.length}字）`);
    await saveChat(chat);
    changed(chat);
  }
  const total = chat.mem.chronicle.reduce((a, c) => a + c.text.length, 0);
  if (total > s.mem.budgets.chronicle && chat.mem.chronicle.length >= 2) await compressChronicle(chat, total);
}

async function summarizeChunk(chat, chunk) {
  const ctx = chatCtx(chat), log = logLines(chat, chunk, ctx);
  const n = clamp(Math.round(log.length * 0.12), 150, 600);
  const prev = chat.mem.chronicle.at(-1)?.text || '';
  const content = (prev ? `<previous_summary>（直前のあらすじ・参考）\n${prev}\n</previous_summary>\n\n` : '')
    + `以下のロールプレイログ（${tl(chunk[0].turn)}〜${tl(chunk.at(-1).turn)}）のあらすじを${n}字以内で書いてください。\n\n<log>\n${log}\n</log>`;
  const res = await callLLM({ role: 'mem', kind: 'chronicle', system: [{ text: macros(CHRON_SYS, ctx) }], messages: [{ role: 'user', content }], maxTokens: 4000, temperature: 0.3 });
  const text = (res.text || '').trim();
  if (!text) throw new Error('あらすじの生成結果が空でした');
  return text;
}

async function compressChronicle(chat, total) {
  const ctx = chatCtx(chat), m = chat.mem, rev = m.rev;
  let acc = 0, k = 0;
  while (k < m.chronicle.length && (acc < total / 2 || k < 2)) acc += m.chronicle[k++].text.length;
  const olds = m.chronicle.slice(0, k);
  const n = Math.floor(S.settings.mem.budgets.chronicle * 0.35);
  const content = `以下は物語のあらすじの連続した断片です。これらを1つの「前史」として${n}字以内に統合してください。重要な出来事・約束・関係の変化・伏線を優先して残し、時系列を保ってください。\n\n${olds.map(c => `【${tl(c.from)}〜${tl(c.to)}】${c.text}`).join('\n\n')}`;
  const res = await callLLM({ role: 'mem', kind: 'compress', system: [{ text: macros(CHRON_SYS, ctx) }], messages: [{ role: 'user', content }], maxTokens: 4000, temperature: 0.3 });
  if (chat.mem.rev !== rev || !S.chats.includes(chat)) return;
  const text = (res.text || '').trim();
  if (!text || text.length >= acc) return;
  if (chat.mem.chronicle.indexOf(olds[0]) !== 0 || !olds.every(o => chat.mem.chronicle.includes(o))) return;
  chat.mem.chronicle.splice(0, k, { id: uid(), from: olds[0].from, to: olds.at(-1).to, text, merged: true });
  memLog(chat, `あらすじを統合: ${k}件 ${acc}字 → ${text.length}字`);
  await saveChat(chat);
}

/* ---------- 手動操作 ---------- */
export function consolidateNow(chat, scope) { return queueMemory(chat, chat.mem.lastId, { consolidateScope: scope }); }
export function updateNow(chat) {
  const last = chat.messages.at(-1);
  if (last) queueMemory(chat, last.id);
}
export function rebuildMemory(chat) {
  const log = chat.mem.log, rev = chat.mem.rev + 1;
  chat.mem = { ...newMem(), rev, log };
  chat.snaps = [];
  memLog(chat, '記憶の作り直しを開始しました');
  updateNow(chat);
}
export function resetMemoryItems(chat) {
  Object.assign(chat.mem, { entries: [], state: '', arc: '', threads: [], rel: [], scene: [], recall: [], brief: '' });
  chat.mem.rev++;
  chat.mem.lastId = Math.max(chat.mem.lastId, chat.messages.at(-1)?.id || 0);
  memLog(chat, '記憶項目をすべて消去しました');
}

/* ---------- 注入する記憶の選択（B: 記憶係の選択 / A: 場面の要素との結びつき） ---------- */
export function selectMemories(chat, ctx, userText = '') {
  const m = chat.mem;
  if (S.settings.mem.inject === 'all') return { list: m.entries, sceneIds: [], active: [], all: true };
  const skip = new Set([ctx.user, ...ctx.chars.map(c => c.name)]);
  const ok = x => x && x.length >= 2 && !skip.has(x);
  const active = new Set((m.scene || []).filter(ok));
  for (const t of m.threads || []) if (ok(t.t)) active.add(t.t);
  for (const x of new Set(m.entries.flatMap(e => e.ents || []))) if (ok(x) && userText.includes(x)) active.add(x);
  const act = [...active];
  const core = m.entries.filter(e => e.pinned || e.imp >= 5);
  const seen = new Set(core.map(e => e.id)), recall = new Set(m.recall || []);
  const scored = [];
  for (const e of m.entries) {
    if (seen.has(e.id)) continue;
    let sc = 0;
    if (recall.has(e.id)) sc = 100;
    else if ((e.ents || []).some(x => act.some(a => a.includes(x) || x.includes(a)))) sc = 20;
    else if (act.some(a => e.text.includes(a))) sc = 10;
    if (sc) scored.push([sc + e.imp, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].turn - a[1].turn);
  const scene = [];
  let chars = 0;
  for (const [, e] of scored) {
    if (scene.length >= SCENE_MAX || chars + e.text.length > SCENE_CHARS) break;
    scene.push(e);
    chars += e.text.length;
  }
  return { list: [...core, ...scene], sceneIds: scene.map(e => e.id), active: act, all: false };
}
export function progressText(m) {
  const p = [];
  if (m.arc) p.push(`局面: ${m.arc}`);
  if (m.threads?.length) p.push('未解決の筋:\n' + m.threads.map(t => `- [${t.s}] ${t.t}：${t.n}`).join('\n'));
  if (m.rel?.length) p.push('関係の現在地:\n' + m.rel.map(r => `- ${r.name}: ${r.text}`).join('\n'));
  return p.join('\n');
}
export function memoryText(chat, ctx, sel) {
  const m = chat.mem, ids = new Set(sel.list.map(e => e.id));
  const lines = sc => m.entries.filter(e => e.scope === sc && ids.has(e.id)).sort((a, b) => a.turn - b.turn)
    .map(e => `- [${tl(e.turn)}]${e.imp >= 4 ? '【重要】' : ''} ${e.text}`).join('\n');
  const parts = [];
  const prog = progressText(m);
  if (prog) parts.push(`<progress>\n${prog}\n</progress>`);
  const w = lines('world'); if (w) parts.push(`<world_memory>\n${w}\n</world_memory>`);
  for (const c of ctx.chars) { const t = lines('c:' + c.id); if (t) parts.push(`<character_memory name="${c.name}">\n${t}\n</character_memory>`); }
  const u = lines('user'); if (u) parts.push(`<user_memory name="${ctx.user}">\n${u}\n</user_memory>`);
  if (m.brief) parts.push(`<director_note>\n${m.brief}\n</director_note>`);
  const excerpt = !sel.all && m.entries.length > sel.list.length ? ' note="今の場面に関係する記憶の抜粋"' : '';
  return (parts.length ? `<memory${excerpt}>\n${parts.join('\n')}\n</memory>` : '<memory>（まだ記憶はありません）</memory>')
    + `\n<current_state as_of="${tl(m.turn)}">\n${m.state || '（未記録）'}\n</current_state>`;
}
