// アプリの状態・データ形式・保存処理。データの形はここだけで定義する
import { DB } from './db.js';
import { uid, now, deepMerge } from './util.js';
import { newItemData } from './items.js';

export const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  keys: {},
  models: { anthropic: 'claude-opus-5', deepseek: 'deepseek-flash', mock: 'demo' },
  recentModels: {},
  customBase: '',
  nanoSub: false,
  maxTokens: 4000,
  temperature: 1,
  effort: 'low',
  speed: false, // 速度優先: 思考オフ＋原文で送る会話を短く
  streaming: true,
  context: 48000,
  mem: {
    auto: true,
    inject: 'select', // select: AIが場面に合わせて選ぶ / all: 全部渡す
    provider: '', model: '', effort: 'medium',
    recent: 30, chunk: 10,
    budgets: { char: 2000, world: 2500, user: 1200, chronicle: 3500, state: 700 },
  },
  lore: { depth: 4, budget: 3000, ai: true }, // ai: キーワードに加えて、記憶係が場面に合う項目も選ぶ
  postPrompt: '',
  adapt: {}, // モデルが受け付けなかった送信オプション（'provider|model' → { ids, t }）。次から最初から外して送る
  personas: [], // トークプロフィール（ペルソナ）: { id, name, desc, avatar }
  defaultPersona: '',
  ui: { theme: 'dark', font: 'gothic', fs: 16 },
};

export const STYLE_DEFAULTS = {
  choices: false, infoBg: 'off', infoChar: 'off',
  difficulty: 'normal', pace: 'natural',
  pov: '3rd', tense: 'past', length: 'auto', expr: 'basic', mood: [], prose: 'real',
};

export const LIMITS = { title: 30, charName: 20, chars: 10, images: 5, profiles: 5, promptSoft: 6000 };

export const S = {
  settings: null,
  stories: [],
  chats: [],
  draft: null, // 編集中のプロット（エディタ専用のコピー）
  gen: null, // { chatId, msgId, ctrl }
  memJobs: {},
  choiceBusy: {},
  lastPrompt: {},
  ui: {
    stack: [{ v: 'home', p: {} }], lastKey: '',
    tab: 'home', homeSort: 'rec', homeTag: '', homeQ: null,
    heroIdx: 0, expand: {}, edTab: 'prompt', edOpen: {},
    memTab: 'state', memEditing: null, drafts: {}, showN: {},
  },
};

// 原文のまま送る直近の会話の量。速度優先のときは短くし、古い分はあらすじと記憶で補う
export const SPEED_WINDOW = { recent: 12, chunk: 6 };
export const memWindow = () => (S.settings.speed ? SPEED_WINDOW : { recent: S.settings.mem.recent, chunk: S.settings.mem.chunk });

/* ---------- getters ---------- */
export const getStory = id => S.stories.find(x => x.id === id);
export const getChat = id => S.chats.find(x => x.id === id);
export const talksOf = sid => S.chats.filter(c => c.storyId === sid).sort((a, b) => b.updatedAt - a.updatedAt);
export const curView = () => S.ui.stack.at(-1);
export const curChatId = () => (curView().v === 'chat' ? curView().p.id : null);
export const curChat = () => getChat(curChatId());

export const txt = m => m.swipes[m.sw] ?? '';
export const isDialog = m => m.role === 'user' || m.role === 'ai';
export function lastDialog(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) if (isDialog(chat.messages[i])) return chat.messages[i];
  return null;
}
export const maxTurn = chat => chat.messages.reduce((a, m) => Math.max(a, m.turn || 0), 0);
export const msgCount = sid => S.chats.filter(c => c.storyId === sid).reduce((a, c) => a + c.messages.filter(isDialog).length, 0);

export const charAvatar = c => c?.images?.[0] || c?.avatar || '';
export function charOf(name, chars) {
  if (!name) return null;
  return chars.find(c => c.name === name) || chars.find(c => name.length > 1 && (name.includes(c.name) || c.name.includes(name))) || null;
}
export function findChar(id) {
  for (const st of S.stories) { const c = st.chars.find(c => c.id === id); if (c) return c; }
  return null;
}

/* ---------- personas（トークプロフィール） ----------
   トークは chat.persona = { kind: 'mine' | 'plot', id } で参照する。
   mine: マイページで保存したもの / plot: プロットが用意したもの */
export const newPersona = (o = {}) => ({ id: uid(), name: '', desc: '', avatar: '', ...o });
export const defaultPersona = () => S.settings.personas.find(p => p.id === S.settings.defaultPersona) || S.settings.personas[0] || newPersona({ name: 'あなた' });
export const defaultPersonaRef = () => ({ kind: 'mine', id: defaultPersona().id });
// ref を省略するとトークの現在のプロフィール。メッセージごとの ref（送信時点のもの）も渡せる
export function resolvePersona(chat, ref = chat?.persona) {
  if (ref?.kind === 'plot') {
    const p = getStory(chat.storyId)?.profiles.find(x => x.id === ref.id);
    if (p) return { ...p, kind: 'plot' };
  }
  const p = S.settings.personas.find(x => x.id === ref?.id) || defaultPersona();
  return { ...p, kind: 'mine' };
}

/* ---------- context ---------- */
export function chatCtx(chat) {
  const story = getStory(chat.storyId), chars = story?.chars.filter(c => c.name.trim()) || [];
  const persona = resolvePersona(chat);
  return { story, chars, persona, user: persona.name || 'あなた', char: chars.map(c => c.name).join('、') || 'キャラクター', userDesc: persona.desc || '' };
}
export function storyCtx(story) {
  const chars = story.chars.filter(c => c.name.trim()), persona = defaultPersona();
  return { story, chars, persona, user: persona.name || 'あなた', char: chars.map(c => c.name).join('、') || 'キャラクター', userDesc: persona.desc || '' };
}
export function macros(s, ctx) {
  return String(s ?? '').replace(/\{\{char\}\}|<BOT>/gi, () => ctx.char).replace(/\{\{user\}\}|<USER>/gi, () => ctx.user);
}

/* ---------- factories & normalization（古い形式もここで現行形式に揃える） ---------- */
export const newMem = () => ({
  rev: 0, seq: 0, lastId: 0, coveredId: 0, turn: 0,
  state: '', entries: [], chronicle: [], log: [],
  arc: '', threads: [], rel: [], scene: [], recall: [], loreRecall: [], brief: '',
  plug: {}, // プラグインの物語状態（registry の pluginMem）
});

// 文章の項目は文字列に揃える（null が入っていると .trim() で画面が落ちる）
const strFields = (o, keys) => { for (const k of keys) if (typeof o[k] !== 'string') o[k] = o[k] == null ? '' : String(o[k]); return o; };

export function normalizeChar(c = {}) {
  const out = strFields({ id: uid(), name: '', images: [], profile: '', personality: '', speech: '', note: '', ...c }, ['name', 'profile', 'personality', 'speech', 'note']);
  if (!Array.isArray(out.images)) out.images = [];
  if (!out.images?.length && c.avatar) out.images = [c.avatar];
  if (c.examples && !out.speech) out.speech = c.examples;
  delete out.avatar;
  delete out.examples;
  out.images = (out.images || []).filter(Boolean);
  return out;
}
// item があればアイテム図鑑の項目（core/items.js）
export const normalizeLore = (e = {}) => {
  const out = strFields({ id: uid(), title: '', keys: [], content: '', always: false, on: true, item: null, ...e }, ['title', 'content']);
  out.keys = (Array.isArray(out.keys) ? out.keys : []).filter(k => k != null).map(String);
  if (out.item) out.item = newItemData(out.item);
  return out;
};

export function normalizeStory(s = {}) {
  const st = {
    id: uid(), v: 3, title: '', description: '', prompt: '', guide: '', userRole: '',
    cover: '', tags: [], creatorNote: '', world: '', opening: '', fav: false, draft: false,
    createdAt: now(), updatedAt: now(), ...s,
  };
  if (s.direction && !s.prompt) st.prompt = s.direction;
  delete st.direction;
  strFields(st, ['title', 'description', 'prompt', 'guide', 'userRole', 'world', 'opening', 'creatorNote', 'cover']);
  st.style = { ...STYLE_DEFAULTS, ...(s.style || {}) };
  st.style.mood = Array.isArray(st.style.mood) ? st.style.mood.slice(0, 2) : [];
  st.chars = (s.chars || []).map(normalizeChar);
  st.lore = (s.lore || []).map(normalizeLore);
  st.examples = (s.examples || []).map(x => strFields({ id: uid(), charId: '', situation: '', reply: '', ...x }, ['situation', 'reply']));
  st.profiles = (s.profiles || []).map(x => strFields({ id: uid(), name: '', desc: '', avatar: '', ...x }, ['name', 'desc', 'avatar']));
  st.tags = Array.isArray(s.tags) ? s.tags.filter(t => t != null).map(String) : [];
  st.plugins = s.plugins && typeof s.plugins === 'object' ? s.plugins : {};
  st.v = 3;
  return st;
}
export const newStory = () => normalizeStory({ draft: true, chars: [normalizeChar()] });

export function normalizeChat(c) {
  c.mem = deepMerge(newMem(), c.mem || {});
  c.snaps ||= [];
  c.pstate ||= {};
  c.messages ||= [];
  c.note ??= '';
  c.choices ??= false;
  return c;
}

/* ---------- 読み込んだファイル（他の人が作ったかもしれない）の検査 ----------
   起動時の読み込みには使わない（手元のデータの ID を変えると、トークとプロットのつながりが切れるため）。
   ID は HTML の属性に入るので、文字・数字・_ . - だけにする（日本語の ID はそのまま残る） */
const SAFE_ID = /^[\p{L}\p{N}_.-]{1,64}$/u;
export const safeId = v => (SAFE_ID.test(String(v ?? '')) ? String(v) : uid());
const rows = a => (Array.isArray(a) ? a : []).filter(e => e && typeof e === 'object');
const SCOPE = /^(world|user|c:[\p{L}\p{N}_.-]{1,64})$/u;

export function sanitizeStory(st) {
  st.id = safeId(st.id);
  for (const list of [st.chars, st.lore, st.examples, st.profiles]) for (const x of list) x.id = safeId(x.id);
  for (const x of st.examples) x.charId = x.charId ? safeId(x.charId) : '';
  return st;
}
function sanitizeMem(m) {
  m.entries = rows(m.entries).map(e => ({ ...e, id: safeId(e.id), scope: SCOPE.test(String(e.scope)) ? e.scope : 'world', text: String(e.text ?? ''), imp: Math.max(1, Math.min(5, Math.round(Number(e.imp)) || 3)), turn: Number(e.turn) || 0 }));
  m.chronicle = rows(m.chronicle).map(x => ({ ...x, id: safeId(x.id), text: String(x.text ?? ''), from: Number(x.from) || 0, to: Number(x.to) || 0 }));
  for (const k of ['lastId', 'coveredId', 'turn', 'seq', 'rev']) m[k] = Number(m[k]) || 0;
  return m;
}
export function sanitizeChat(c) {
  c.id = safeId(c.id);
  if (c.storyId) c.storyId = safeId(c.storyId); // ない（v1 のトーク）なら、そのまま移行の対象にする
  c.messages = rows(c.messages).filter(m => Number.isFinite(Number(m.id)) && Array.isArray(m.swipes));
  for (const m of c.messages) {
    m.id = Number(m.id); m.turn = Number(m.turn) || 0; m.swipes = m.swipes.map(s => (s == null ? '' : String(s))); m.sw = Math.max(0, Math.min(m.swipes.length - 1, Number(m.sw) || 0));
    // 速度の記録（候補ごと）: 数だけを残す
    if (Array.isArray(m.perf)) m.perf = m.perf.map(p => (p && typeof p === 'object' ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v) || 0])) : null));
    else delete m.perf;
  }
  sanitizeMem(c.mem);
  c.snaps = rows(c.snaps).filter(s => s.data && typeof s.data === 'object').map(s => ({ at: Number(s.at) || 0, data: sanitizeMem(deepMerge(newMem(), s.data)) }));
  return c;
}

// v3.0 までの「単一のペルソナ」「トークごとの名前と設定」をペルソナ一覧に移す
export function migratePersonas(legacy) {
  const s = S.settings;
  if (!s.personas.length) {
    const p = newPersona({ name: legacy?.name || 'あなた', desc: legacy?.desc || '', avatar: legacy?.avatar || '' });
    s.personas.push(p);
    s.defaultPersona = p.id;
  }
  const changed = [];
  for (const c of S.chats) {
    if (c.persona) continue;
    const plot = getStory(c.storyId)?.profiles.find(p => p.name && p.name === c.userName);
    let ref;
    if (plot) ref = { kind: 'plot', id: plot.id };
    else {
      let p = s.personas.find(p => p.name === (c.userName || defaultPersona().name));
      if (!p) { p = newPersona({ name: c.userName, desc: c.userDesc || '' }); s.personas.push(p); }
      ref = { kind: 'mine', id: p.id };
    }
    c.persona = ref;
    delete c.userName;
    delete c.userDesc;
    changed.push(c);
  }
  return changed;
}

// プロットを「完成」にするための必須項目
export function storyIssues(st) {
  const prompt = [];
  if (!st.title.trim()) prompt.push('題名');
  if (!st.chars.some(c => c.name.trim())) prompt.push('キャラクターの名前');
  return { prompt, ok: !prompt.length };
}
export function promptChars(st) {
  return [st.title, st.prompt, st.guide, st.userRole, ...st.chars.flatMap(c => [c.name, c.profile, c.personality, c.speech, c.note])]
    .reduce((a, t) => a + String(t || '').length, 0);
}

/* ---------- persistence ---------- */
export const touch = chat => { chat.updatedAt = now(); };
export const saveSettings = () => DB.put('kv', { id: 'settings', data: S.settings });
export async function saveChat(chat) { if (S.chats.includes(chat)) await DB.put('chats', chat); }
export async function saveStory(st) {
  st.updatedAt = now();
  const i = S.stories.findIndex(x => x.id === st.id);
  if (i >= 0) S.stories[i] = st; else S.stories.push(st);
  await DB.put('stories', st);
}
export async function addChat(chat) {
  S.chats.push(chat);
  await DB.put('chats', chat);
}
export async function removeChat(chat) {
  if (S.gen?.chatId === chat.id) S.gen.ctrl.abort();
  S.chats = S.chats.filter(c => c !== chat);
  await DB.del('chats', chat.id);
}
export async function removeStory(st) {
  for (const c of talksOf(st.id)) await removeChat(c);
  S.stories = S.stories.filter(x => x !== st);
  await DB.del('stories', st.id);
}
