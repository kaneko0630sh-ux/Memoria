// マイページ（プロフィール・API・生成・記憶エンジン・表示・データ）
import { S, saveSettings } from '../../core/store.js';
import { esc, getPath, setPath, clone, ymd } from '../../core/util.js';
import { DB } from '../../core/db.js';
import { PROVIDERS, EFFORTS, llmCfg, callLLM, fetchModels, rememberModel } from '../../llm/providers.js';
import { ic, avatarHTML, toast, openSheet, closeAllSheets, saveFile, pickFile, fileToImage } from '../dom.js';
import { defineActions, render, goHome } from '../app.js';
import { importBackupFile } from '../../io/porting.js';

const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
const provList = same => [...(same ? [['', 'メインと同じ']] : []), ...Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])];

function num(path, label, o = {}) {
  return `<label class="field"><span>${label}</span><input type="number" inputmode="${o.dec ? 'decimal' : 'numeric'}" data-set="${path}" data-num="1" value="${getPath(S.settings, path)}"${o.step ? ` step="${o.step}"` : ''}${o.min != null ? ` min="${o.min}"` : ''}>${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</label>`;
}
function keyField(p) {
  const d = PROVIDERS[p];
  if (!d || d.kind === 'mock') return '';
  return `<label class="field"><span>${d.label} のAPIキー</span><div class="inline"><input type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-set="keys.${p}" value="${esc(S.settings.keys[p] || '')}" placeholder="${d.keyHint}"><button class="btn sm" data-act="toggleKey">表示</button></div></label>`;
}
function modelField(path, provider, value, ph = 'モデルID') {
  return `<div class="inline"><input data-set="${path}" value="${esc(value || '')}" list="dl-${path.replace(/\W/g, '')}" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ph}"><button class="btn sm" data-act="pickModel" data-p="${provider}" data-path="${path}">一覧</button></div>
    <datalist id="dl-${path.replace(/\W/g, '')}">${(PROVIDERS[provider]?.suggest || []).map(m => `<option value="${m}">`).join('')}</datalist>`;
}

export function myPageHTML() {
  const s = S.settings, p = s.provider, mp = s.mem.provider;
  return `
<section class="card"><h3>プロフィール</h3>
  <div class="profile-card"><button class="av-pick" data-act="pickPersonaAvatar">${avatarHTML({ name: s.persona.name, avatar: s.persona.avatar }, 64)}<span>${s.persona.avatar ? '変更' : '画像'}</span></button>
  <div class="grow"><label class="field" style="margin:0"><span>名前</span><input data-set="persona.name" data-rerender="1" value="${esc(s.persona.name)}"></label></div></div>
  <label class="field"><span>あなたの設定</span><textarea rows="3" data-set="persona.desc" placeholder="外見・立場・性格など（新しいトークに使われます）">${esc(s.persona.desc)}</textarea></label>
</section>
<section class="card"><h3>API</h3>
  <label class="field"><span>プロバイダ</span><select data-set="provider" data-rerender="1">${opts(provList(false), p)}</select></label>
  ${keyField(p)}
  ${p === 'custom' ? `<label class="field"><span>ベースURL</span><input data-set="customBase" value="${esc(s.customBase)}" placeholder="https://example.com/v1" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url"><div class="hint">OpenAI互換の /chat/completions を持つエンドポイント（ローカルLLMなど）。ブラウザからの接続（CORS）を許可している必要があります。</div></label>` : ''}
  ${p === 'nanogpt' || mp === 'nanogpt' ? `<label class="switch"><span>NanoGPT：サブスク対象のモデルだけ使う</span><input type="checkbox" class="tgl" data-set="nanoSub" ${s.nanoSub ? 'checked' : ''}></label><p class="hint" style="margin-top:-6px">NanoGPT のサブスクに加入している場合はオン。サブスク内のモデルに限定され、従量課金が発生しません。「一覧」もサブスク対象だけになります。</p>` : ''}
  <label class="field"><span>モデル</span>${modelField(`models.${p}`, p, s.models[p])}</label>
  <div class="btn-row"><button class="btn sm" data-act="testApi" data-role="main">接続テスト</button></div>
  <p class="hint">APIキーはこの端末のブラウザ内にだけ保存され、選んだAPIへ直接送信されます。</p>
</section>
<section class="card"><h3>生成</h3>
  <label class="field"><span>思考（考えてから書く）</span><select data-set="effort">${opts(EFFORTS, s.effort)}</select><div class="hint">オフにすると返信が大幅に速くなります（DeepSeek・NanoGPT の思考モデル・Claude Sonnet 5 など）。DeepSeek は既定で長く考えるので、速さ重視ならオフがおすすめです。</div></label>
  <div class="grid2">${num('maxTokens', '最大出力トークン', { min: 256 })}${num('temperature', '温度', { step: 0.05, dec: true, min: 0 })}</div>
  ${num('context', '入力の上限目安（トークン）', { min: 4000, hint: '設定・記憶・履歴を合わせた送信量の上限。超える分は古い履歴から省かれます（省いた分もあらすじで補われます）。' })}
  <label class="switch"><span>ストリーミング表示</span><input type="checkbox" class="tgl" data-set="streaming" ${s.streaming ? 'checked' : ''}></label>
  <label class="field"><span>毎ターンの追加指示（任意）</span><textarea rows="3" data-set="postPrompt" placeholder="例: 今回は会話多めで。">${esc(s.postPrompt)}</textarea></label>
</section>
<section class="card"><h3>記憶エンジン</h3>
  <label class="switch"><span>毎ターン自動で記憶を更新</span><input type="checkbox" class="tgl" data-set="mem.auto" ${s.mem.auto ? 'checked' : ''}></label>
  <label class="field"><span>記憶の渡し方</span><select data-set="mem.inject">${opts([['select', 'AIが場面に合わせて選ぶ（軽い・おすすめ）'], ['all', 'すべて渡す（重い）']], s.mem.inject)}</select><div class="hint">「選ぶ」では、固定・最重要の記憶と進行度は常に渡し、それ以外は記憶係が選んだものと、いまの場面に関わるものだけを渡します。</div></label>
  <label class="field"><span>記憶処理に使うプロバイダ</span><select data-set="mem.provider" data-rerender="1">${opts(provList(true), mp)}</select></label>
  ${mp && mp !== p ? keyField(mp) : ''}
  <label class="field"><span>記憶処理に使うモデル</span>${modelField('mem.model', mp || p, s.mem.model, '空欄＝メインと同じ')}<div class="hint">記憶の抽出・整理・要約と、選択肢・日記に使います。裏で動くので返信の速さには影響しません。</div></label>
  <label class="field"><span>記憶処理の思考</span><select data-set="mem.effort">${opts(EFFORTS, s.mem.effort)}</select></label>
  <div class="grid2">${num('mem.recent', '原文で送る直近の件数', { min: 6 })}${num('mem.chunk', 'あらすじ化の単位（件）', { min: 4 })}</div>
  <div class="lbl" style="margin-top:8px">記憶の容量（字）— 超えると自動で統合・圧縮</div>
  <div class="grid2">${num('mem.budgets.char', 'キャラ記憶（1人あたり）', { min: 300 })}${num('mem.budgets.world', '世界記憶', { min: 300 })}${num('mem.budgets.user', 'ユーザー記憶', { min: 200 })}${num('mem.budgets.chronicle', 'あらすじ', { min: 500 })}${num('mem.budgets.state', '現在の状況', { min: 200 })}</div>
  <div class="lbl" style="margin-top:8px">ロアブック（キーワード発火）</div>
  <div class="grid2">${num('lore.depth', '走査する直近の件数', { min: 1 })}${num('lore.budget', '1回に入れる上限（字）', { min: 500 })}</div>
  <div class="btn-row"><button class="btn sm" data-act="testApi" data-role="mem">記憶モデルを接続テスト</button></div>
</section>
<section class="card"><h3>表示</h3>
  <label class="field"><span>テーマ</span><select data-set="ui.theme">${opts([['dark', 'ダーク'], ['light', 'ライト'], ['auto', '端末に合わせる']], s.ui.theme)}</select></label>
  <div class="grid2"><label class="field"><span>本文フォント</span><select data-set="ui.font">${opts([['gothic', 'ゴシック'], ['serif', '明朝']], s.ui.font)}</select></label>${num('ui.fs', '文字サイズ（px）', { min: 12 })}</div>
</section>
<section class="card"><h3>データ</h3>
  <p class="hint" id="storageInfo">&nbsp;</p>
  <div class="btn-row"><button class="btn sm" data-act="exportAll">${ic('download', 'sm')}バックアップを書き出す</button><button class="btn sm" data-act="importBackup">${ic('upload', 'sm')}バックアップを読み込む</button></div>
  <label class="switch"><span>書き出しにAPIキーを含める</span><input type="checkbox" class="tgl" id="expKeys"></label>
  <div class="btn-row"><button class="btn sm danger" data-act="wipeAll">全データを削除</button></div>
  <p class="hint">iPhone の Safari は、しばらく開かないサイトのデータを消すことがあります。「ホーム画面に追加」して使い、ときどきバックアップを書き出してください。</p>
</section>
<p class="foot">Memoria 3.0</p>`;
}

export function mountMyPage() {
  const el = document.getElementById('storageInfo');
  if (el && navigator.storage?.estimate) navigator.storage.estimate().then(e => {
    el.textContent = `使用中のストレージ: 約${(e.usage / 1048576).toFixed(1)}MB ・ プロット${S.stories.length} / トーク${S.chats.length}`;
  }).catch(() => {});
}

// モデル一覧から選ぶシート（マイページとトーク画面の両方から使う）
export async function openModelPicker(provider, path) {
  toast('モデル一覧を取得中…', '', 1500);
  let list;
  try { list = await fetchModels(provider); } catch (e) { return toast('取得に失敗しました: ' + e.message, 'err', 7000); }
  if (!list.length) return toast('モデルが見つかりませんでした', 'warn');
  const w = openSheet({ id: 'models', title: `モデルを選択（${list.length}件）`, html: `<input type="search" class="model-filter" placeholder="絞り込み…" autocapitalize="off" autocorrect="off" spellcheck="false"><div class="menu model-list">${list.map(m => `<button data-act="chooseModel" data-m="${esc(m)}" data-path="${path}">${esc(m)}</button>`).join('')}</div>` });
  w.querySelector('.model-filter').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    w.querySelectorAll('.model-list button').forEach(b => { b.hidden = !b.dataset.m.toLowerCase().includes(q); });
  });
}

defineActions({
  goMy: () => goHome('my'),
  toggleKey: el => { const i = el.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? '表示' : '隠す'; },
  pickPersonaAvatar: async () => { S.settings.persona.avatar = await fileToImage(await pickFile('image/*'), 256, 256); await saveSettings(); render(); },
  pickModel: el => openModelPicker(el.dataset.p, el.dataset.path),
  chooseModel: async el => {
    const path = el.dataset.path, m = el.dataset.m;
    setPath(S.settings, path, m);
    if (path.startsWith('models.')) rememberModel(path.slice(7), m);
    await saveSettings();
    closeAllSheets();
    render();
    toast('モデル: ' + m, 'ok', 1500);
  },
  testApi: async el => {
    const role = el.dataset.role, cfg = llmCfg(role);
    toast(`接続テスト中…（${cfg.model || 'モデル未設定'}）`, '', 1800);
    try {
      const r = await callLLM({ role, kind: 'test', system: [{ text: 'You are a connection test.' }], messages: [{ role: 'user', content: '「接続OK」とだけ返答してください。' }], maxTokens: 1024 });
      toast(`成功: ${(r.text || '（空の応答）').trim().slice(0, 60)}`, 'ok', 4000);
    } catch (e) { toast('失敗: ' + e.message, 'err', 9000); }
  },
  exportAll: () => {
    const settings = clone(S.settings);
    if (!document.getElementById('expKeys')?.checked) settings.keys = {};
    saveFile(`memoria-backup-${ymd()}.json`, JSON.stringify({ app: 'memoria', version: 3, exportedAt: new Date().toISOString(), settings, stories: S.stories, chats: S.chats }));
  },
  importBackup: async () => { if (await importBackupFile()) render(); },
  wipeAll: async () => {
    if (!confirm('すべてのプロット・トーク・設定を削除します。元に戻せません。')) return;
    if (!confirm('本当に削除しますか？（先にバックアップを書き出すことをおすすめします）')) return;
    for (const s of DB.stores) await DB.clear(s);
    location.reload();
  },
});
