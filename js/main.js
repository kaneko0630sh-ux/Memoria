// 起動処理: データ読み込み → 形式の移行 → 画面開始
import { DB } from './core/db.js';
import { S, DEFAULT_SETTINGS, normalizeStory, normalizeChat } from './core/store.js';
import { deepMerge } from './core/util.js';
import { migrateLegacy } from './io/porting.js';
import { startApp } from './ui/app.js';
// 画面とプラグインは読み込むだけで登録される
import './ui/views/home.js';
import './ui/views/story.js';
import './ui/views/editor.js';
import './ui/views/chat.js';
import './ui/views/memory-panel.js';
import './ui/views/settings.js';
import './plugins/dice.js';
import './plugins/diary.js';

async function boot() {
  try { await DB.open(); } catch {
    document.body.innerHTML = '<p style="padding:32px;color:#eee;font-family:sans-serif">ストレージ（IndexedDB）を開けませんでした。プライベートブラウズを解除するか、別のブラウザでお試しください。</p>';
    return;
  }
  const saved = await DB.get('kv', 'settings');
  S.settings = deepMerge(DEFAULT_SETTINGS, saved?.data || {});
  delete S.settings.systemPrompt; // v2 まであった編集可能なシステムプロンプト（文体は内蔵に移行）

  const [stories, chats, oldChars, oldWorlds, oldPlots] = await Promise.all(['stories', 'chats', 'chars', 'worlds', 'plots'].map(s => DB.all(s)));
  S.stories = stories.map(normalizeStory);
  S.chats = chats.map(normalizeChat);
  for (const st of S.stories) if (stories.find(x => x.id === st.id)?.v !== 3) await DB.put('stories', st);
  if (S.chats.some(c => !c.storyId) || (oldChars.length && !S.stories.length)) {
    await migrateLegacy(oldChars, oldWorlds, oldPlots);
    for (const s of ['chars', 'worlds', 'plots']) await DB.clear(s);
  }

  startApp();
  navigator.storage?.persist?.().catch(() => {});
}

boot();
