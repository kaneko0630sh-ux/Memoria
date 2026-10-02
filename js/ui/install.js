// PC（Chrome / Edge）でアプリとしてインストールする（専用ウィンドウ・スタートメニュー・タスクバー）
// ブラウザがインストール可能と判断すると beforeinstallprompt が来るので、取っておいてボタンから出す
import { emit } from '../core/hooks.js';

let deferred = null;

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferred = e;
  emit('install:changed');
});
addEventListener('appinstalled', () => {
  deferred = null;
  emit('install:changed');
});

export const canInstall = () => !!deferred;
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit('install:changed');
  return outcome === 'accepted';
}
