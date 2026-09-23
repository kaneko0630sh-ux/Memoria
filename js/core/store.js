// アプリの状態・データ形式・保存処理。データの形はここだけで定義する
import { DB } from './db.js';
import { uid, now, deepMerge } from './util.js';

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
  streaming: true,
  context: 48000,
  mem: {
    auto: true,
    inject: 'select', // select: AIが場面に合わせて選ぶ / all: 全部渡す
    provider: '', model: '', effort: 'medium',
    recent: 30, chunk: 10,
    budgets: { char: 2000, world: 2500, user: 1200, chronicle: 3500, state: 700 },
  },
  lore: { depth: 4, budget: 3000 },
  postPrompt: '',
  persona: { name: 'あなた', desc: '', avatar: '' },
  ui: { theme: 'dark', font: 'gothic', fs: 16 },
};

export const STYLE_DEFAULTS = {
  choices: false, infoBg: 'off', infoChar: 'off',
  difficulty: 'normal', pace: 'natural',
  pov: '3rd', tense: 'past', length: 'auto', expr: 'basic', mood: [], prose: 'real',
};

export const LIMITS = { title: 30, charName: 20, chars: 10, images: 5, profiles: 5, promptSoft: 4000 };

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

/* ---------- context ---------- */
export function chatCtx(chat) {
  const story = getStory(chat.storyId), chars = story?.chars.filter(c => c.name.trim()) || [];
  const user = chat.userName || S.settings.persona.name || 'あなた';
  return { story, chars, user, char: chars.map(c => c.name).join('、') || 'キャラクター', userDesc: chat.userDesc ?? S.settings.persona.desc ?? '' };
}
export function storyCtx(story) {
  const chars = story.chars.filter(c => c.name.trim());
  return { story, chars, user: S.settings.persona.name || 'あなた', char: chars.map(c => c.name).join('、') || 'キャラクター', userDesc: S.settings.persona.desc || '' };
}
export function macros(s, ctx) {
  return String(s ?? '').replace(/\{\{char\}\}|<BOT>/gi, () => ctx.char).replace(/\{\{user\}\}|<USER>/gi, () => ctx.user);
}

/* ---------- factories & normalization（古い形式もここで現行形式に揃える） ---------- */
export const newMem = () => ({
  rev: 0, seq: 0, lastId: 0, coveredId: 0, turn: 0,
  state: '', entries: [], chronicle: [], log: [],
  arc: '', threads: [], rel: [], scene: [], recall: [], brief: '',
});

export function normalizeChar(c = {}) {
  const out = { id: uid(), name: '', images: [], profile: '', personality: '', speech: '', note: '', ...c };
  if (!out.images?.length && c.avatar) out.images = [c.avatar];
  if (c.examples && !out.speech) out.speech = c.examples;
  delete out.avatar;
  delete out.examples;
  out.images = (out.images || []).filter(Boolean);
  return out;
}
export const normalizeLore = (e = {}) => ({ id: uid(), title: '', keys: [], content: '', always: false, on: true, ...e });

export function normalizeStory(s = {}) {
  const st = {
    id: uid(), v: 3, title: '', description: '', prompt: '', guide: '', userRole: '',
    cover: '', tags: [], creatorNote: '', world: '', opening: '', fav: false, draft: false,
    createdAt: now(), updatedAt: now(), ...s,
  };
  if (s.direction && !s.prompt) st.prompt = s.direction;
  delete st.direction;
  st.style = { ...STYLE_DEFAULTS, ...(s.style || {}) };
  st.style.mood = Array.isArray(st.style.mood) ? st.style.mood.slice(0, 2) : [];
  st.chars = (s.chars || []).map(normalizeChar);
  st.lore = (s.lore || []).map(normalizeLore);
  st.examples = (s.examples || []).map(x => ({ id: uid(), charId: '', situation: '', reply: '', ...x }));
  st.profiles = (s.profiles || []).map(x => ({ id: uid(), name: '', desc: '', ...x }));
  st.tags = Array.isArray(s.tags) ? s.tags : [];
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
