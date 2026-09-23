// 読み込み・書き出し・移行・サンプル
import { S, DEFAULT_SETTINGS, normalizeStory, normalizeChar, normalizeChat, saveStory, saveSettings } from '../core/store.js';
import { DB } from '../core/db.js';
import { uid, now, clone, deepMerge, b64utf8 } from '../core/util.js';
import { stEntriesToLore } from '../engine/lorebook.js';
import { pickFile, fileToImage, toast } from '../ui/dom.js';

/* ---------- キャラクターカード（SillyTavern PNG / JSON） ---------- */
function pngText(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out = {}, dec = new TextDecoder('latin1');
  if (u8.length < 8 || v.getUint32(0) !== 0x89504e47) return out;
  let p = 8;
  while (p + 8 <= u8.length) {
    const len = v.getUint32(p), type = dec.decode(u8.subarray(p + 4, p + 8)), data = u8.subarray(p + 8, p + 8 + len);
    if (type === 'tEXt') { const z = data.indexOf(0); out[dec.decode(data.subarray(0, z))] = dec.decode(data.subarray(z + 1)); }
    else if (type === 'iTXt') {
      const z = data.indexOf(0), key = dec.decode(data.subarray(0, z));
      if (!data[z + 1]) { let q = data.indexOf(0, z + 3) + 1; q = data.indexOf(0, q) + 1; out[key] = new TextDecoder().decode(data.subarray(q)); }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}
const cardData = j => (j.data && typeof j.data === 'object' ? j.data : j);
const isPng = f => /\.png$/i.test(f.name) || f.type === 'image/png';

async function parseCard(f) {
  let json, image = '';
  if (isPng(f)) {
    const t = pngText(await f.arrayBuffer()), b64 = t.chara || t.ccv3;
    if (!b64) throw new Error('この画像にはキャラクター情報が含まれていません');
    json = JSON.parse(b64utf8(b64));
    image = await fileToImage(f, 480, 640);
  } else json = JSON.parse(await f.text());
  const d = cardData(json);
  const char = normalizeChar({
    name: d.name || '名無し', images: image ? [image] : [], profile: d.description || '', personality: d.personality || '', speech: d.mes_example || '',
    note: [d.system_prompt, d.post_history_instructions].filter(Boolean).join('\n').replace(/\{\{original\}\}/g, '').trim(),
  });
  return { json, d, char, image, scenario: d.scenario || '', firstMes: d.first_mes || '', lore: stEntriesToLore(d.character_book?.entries) };
}

// エディタでキャラを追加するとき用
export async function readCardFile() {
  const f = await pickFile('.json,.png,image/png,application/json');
  try { return await parseCard(f); } catch (e) { toast('読み込みに失敗しました: ' + e.message, 'err', 6000); return null; }
}

// 「作成」タブの「ファイルから読み込む」: カード / Memoria のプロット書き出し
export async function importStoryFile() {
  const f = await pickFile('.json,.png,image/png,application/json');
  try {
    let st;
    const json = isPng(f) ? null : JSON.parse(await f.text());
    if (json?.app === 'memoria-story' && json.story) {
      const src = clone(json.story);
      st = normalizeStory({ ...src, id: uid(), chars: (src.chars || []).map(c => ({ ...c, id: uid() })), createdAt: now(), draft: false });
    } else if (json?.app === 'memoria') {
      throw new Error('これはバックアップです。マイページ →「バックアップを読み込む」から読み込んでください');
    } else {
      const r = await parseCard(f);
      st = normalizeStory({
        title: r.char.name, cover: r.image ? await fileToImage(f, 600, 800) : '', description: (r.d.creator_notes || r.d.description || '').replace(/\s+/g, ' ').slice(0, 80),
        tags: (r.d.tags || []).slice(0, 6), chars: [r.char], prompt: r.scenario, opening: r.firstMes, lore: r.lore,
      });
    }
    await saveStory(st);
    toast(`プロット「${st.title}」を読み込みました`, 'ok');
    return st;
  } catch (e) {
    toast('読み込みに失敗しました: ' + e.message, 'err', 6000);
    return null;
  }
}

/* ---------- バックアップ ---------- */
export async function importBackupFile() {
  const f = await pickFile('.json,application/json');
  let j;
  try { j = JSON.parse(await f.text()); } catch { toast('JSONとして読み込めませんでした', 'err'); return false; }
  if (j.app !== 'memoria') { toast('Memoria のバックアップファイルではありません', 'err'); return false; }
  const ns = (j.stories || []).length, nc = (j.chats || []).length;
  if (!confirm(`プロット${ns}件・トーク${nc}件を読み込みます。同じIDのデータは上書きされます。よろしいですか？`)) return false;
  for (const raw of j.stories || []) await saveStory(normalizeStory(raw));
  for (const raw of j.chats || []) {
    const c = normalizeChat(raw), i = S.chats.findIndex(x => x.id === c.id);
    if (i >= 0) S.chats[i] = c; else S.chats.push(c);
    await DB.put('chats', c);
  }
  if (j.chars || j.worlds || j.plots) await migrateLegacy(j.chars || [], j.worlds || [], j.plots || []);
  if (j.settings && confirm('設定も読み込みますか？（APIキーが含まれていない場合は現在のキーを残します）')) {
    const keys = S.settings.keys;
    S.settings = deepMerge(DEFAULT_SETTINGS, j.settings);
    for (const p of Object.keys(keys)) if (!S.settings.keys[p]) S.settings.keys[p] = keys[p];
    await saveSettings();
  }
  toast('バックアップを読み込みました', 'ok');
  return true;
}

/* ---------- v1（キャラ・世界・プロットが別々）→ 現行形式 ---------- */
export async function migrateLegacy(oldChars, oldWorlds, oldPlots) {
  const used = new Set();
  for (const chat of S.chats) {
    if (chat.storyId) continue;
    const chars = (chat.charIds || []).map(id => oldChars.find(c => c.id === id)).filter(Boolean);
    chars.forEach(c => used.add(c.id));
    const w = oldWorlds.find(x => x.id === chat.worldId), p = oldPlots.find(x => x.id === chat.plotId);
    const st = normalizeStory({
      title: chat.title || chars[0]?.name || '無題', description: (chars[0]?.description || '').replace(/\s+/g, ' ').slice(0, 80),
      chars: chars.map(legacyChar), world: w?.content || '', prompt: p?.content || '', opening: chars[0]?.firstMessage || '', createdAt: chat.createdAt || now(),
    });
    await saveStory(st);
    chat.storyId = st.id;
    await DB.put('chats', chat);
  }
  for (const c of oldChars) {
    if (used.has(c.id) || S.stories.some(s => s.chars.some(x => x.id === c.id))) continue;
    await saveStory(normalizeStory({ title: c.name, description: (c.description || '').replace(/\s+/g, ' ').slice(0, 80), chars: [legacyChar(c)], opening: c.firstMessage || '', createdAt: c.createdAt || now() }));
  }
}
const legacyChar = c => normalizeChar({
  id: c.id, name: c.name, images: c.avatar ? [c.avatar] : [], profile: [c.description, c.scenario].filter(Boolean).join('\n\n'),
  personality: c.personality || '', speech: c.examples || '', note: [c.charNote, c.lore].filter(Boolean).join('\n\n'),
});

/* ---------- サンプル ---------- */
export async function loadSamples() {
  const a = normalizeStory({
    title: '霧の港町の古書店',
    description: '閉店間際、霧を連れて入ってきた客に、店主代理の少女は静かに問う。「あなたは、何を探しに？」',
    tags: ['ミステリー', 'ファンタジー', '古書店'],
    prompt: '静かなミステリー。舞台は一年の大半を海霧に包まれた港町ヴェルナ。{{user}}は、三年前に失踪した古書店主エドガーについて何かを知っている人物として、店主代理のリーネと出会う。互いに探り合いながら、エドガーが残した航海日誌の暗号を一つずつ解いていく。',
    guide: '信頼関係はゆっくり育てる。数ターンに一度、密輸組合「灰の手」の影をちらつかせる。',
    userRole: '霧の夜に古書店を訪ねてきた旅人。エドガーの名を知っている。',
    world: '【霧の港町ヴェルナ】\n大陸西端の港町。一年の大半を海霧に包まれている。港を治めるのは商会連合だが、裏では密輸組合が力を持つ。古書店「栞と錨」は灯台通りの坂の途中にある。',
    lore: [
      { title: '灰の手', keys: ['灰の手', '密輸'], content: '港の裏を仕切る密輸組合。第三埠頭の倉庫に拠点を持ち、衛兵隊にも手が回っている。構成員は左手首に灰色の刺青を入れている。' },
      { title: '刻印術', keys: ['刻印', '魔法', '紋'], content: 'この世界で唯一の魔法。金属板に紋を刻み、触れた者の体温で発動する。高価で庶民には縁遠い。' },
      { title: '霧精', keys: ['霧精', '記憶を喰う'], content: '霧の濃い夜に現れ、本名を名乗った者の記憶を奪うという迷信上の存在。実在するかは誰も知らない。' },
      { title: '第三埠頭', keys: ['第三埠頭', '倉庫'], content: '港の倉庫街。夜間は立ち入り禁止。「灰の手」の荷がひそかに出入りしている。' },
      { title: 'エドガー', keys: ['エドガー', '師匠'], content: '「栞と錨」の店主でリーネの師匠。三年前に失踪した。元は船乗りで、航海日誌に暗号めいた書き込みを残している。' },
    ],
    chars: [{
      name: 'リーネ',
      profile: '19歳。古書店「栞と錨」の店主代理。灰色がかった銀髪を低い位置でひとつに結び、丸眼鏡をかけている。指先にはいつもインクの染み。三年前に失踪した師匠エドガーの行方を、ひとりで探し続けている。',
      personality: '物静かで観察眼が鋭い。本の話になると早口になる。人を信用するまで時間がかかるが、一度信じた相手には誠実。嘘が下手で、動揺すると眼鏡を押し上げる癖がある。',
      speech: '一人称は「私」。丁寧語だが素っ気ない。{{user}}のことは最初「あなた」と呼ぶ。',
    }],
    examples: [{ situation: '{{user}}が高価そうな本を乱暴に扱った', reply: '*無言で本を取り上げ、背表紙の傷を指でなぞる*\nこの装丁、二百年ものです。……次に同じことをしたら、出ていってもらいます。' }],
    profiles: [{ name: '旅人', desc: '霧の夜に古書店を訪ねてきた旅人。エドガーの名を知っている。素性は自分で決めてよい。' }],
    style: { mood: ['mystery'], pace: 'slow' },
    opening: '【ナレーション】\n閉店まであと五分。海霧が灯台通りの坂を這い上がって、ランプの明かりを滲ませていた。古書店「栞と錨」の扉の鈴が、からん、と鳴る\n【リーネ】\n*帳簿から顔を上げた。丸眼鏡の奥の灰色の目が、濡れた外套から靴の泥まで、静かに{{user}}を測っていく*\n……いらっしゃいませ。もう閉めるところでしたけど。\n*ペンを置く。こんな時間に来る客は、ろくでもないか、切羽詰まっているかのどちらかだ*\n霧の夜に古書店を訪ねる人は、たいてい何か探し物をしています。……あなたは、何を？',
  });
  const b = normalizeStory({
    title: '竜騎士学院の落ちこぼれ寮',
    description: '入学初日、あなたが配属されたのは"問題児"だらけの第七寮だった。',
    tags: ['学園', 'ファンタジー', 'コメディ'],
    prompt: '寮生活中心の学園ファンタジーコメディ。舞台は竜騎士を育てる全寮制の王立ラグナ学院。成績不振者と問題児が集められる第七寮に配属された{{user}}が、寮長代理のミオと無口なシグに振り回されながら、入学から一か月以内に相棒の竜と契約することを目指す。',
    guide: 'ミオとシグの対照的な反応を描き分け、{{user}}を巻き込んだ騒動を起こす。3〜5ターンに一度、小さな事件を起こす。',
    userRole: '今日入学した新入生。相棒の竜はまだいない。',
    world: '【王立ラグナ学院】\n竜騎士を育てる全寮制の学院。全七寮。第七寮は敷地の端にある古い寮。\n・新入生は入学から一か月以内に相棒の竜と契約しなければ退学になる。\n・竜は契約者の感情に反応して、火や雷を漏らすことがある。',
    chars: [
      { name: 'ミオ', profile: '16歳。第七寮の寮長代理。赤毛のポニーテール。竜との相性は学年一だが、座学は壊滅的。', personality: '明るくてお節介。思い立ったら即行動。落ち込むのも立ち直るのも早い。', speech: '一人称は「あたし」。{{user}}を「新入り」と呼ぶ。語尾が跳ねる。' },
      { name: 'シグ', profile: '16歳。第七寮の寮生。無口な銀髪の少年。相棒は手のひらサイズの黒竜ノクス。実技は首席だが協調性ゼロ。', personality: '無愛想で口数が少ない。面倒くさがりだが、実は面倒見がいい。皮肉がうまい。', speech: '一人称は「俺」。短く言い切る。' },
    ],
    style: { prose: 'lightnovel', mood: ['fantasy'], expr: 'dialog' },
    plugins: { dice: { on: true, sides: '20' } },
    opening: '【ナレーション】\n王立ラグナ学院、入学式の夜。割り当て表を握りしめた{{user}}が辿り着いたのは、敷地の端に建つ古びた第七寮だった。扉を開けた瞬間、藁と、焦げた何かの匂いが鼻を刺す\n【ミオ】\n*階段の上から身を乗り出した。赤いポニーテールが大きく揺れる*\nあっ、来た来た！ 新入り！ ようこそ第七寮へ――\n*言いかけて、廊下の奥を二度見した。黒い煙がもくもく上がっている*\nちょっとシグ！ 歓迎の横断幕、燃やしたでしょ！\n【シグ】\n*壁にもたれたまま、片目だけ開けた。肩の上で、小さな黒竜があくびをする*\n燃やしたのはノクスだ。俺じゃない。\n*黒竜が得意げに煙を吐いた。横断幕は「歓迎」の二文字だけ、きれいに焼け残っていた*',
  });
  await saveStory(a);
  await saveStory(b);
  toast('サンプルのプロットを2つ追加しました', 'ok', 3000);
}
