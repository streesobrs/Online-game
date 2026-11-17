/**
 * 刷怪肉鸽云存档同步
 *
 * - 本地 localStorage 仍是唯一读取路径，服务端只做镜像
 * - 登录账号进入游戏时拉取一次：服务端较新则覆盖本地，否则上传本地
 * - 存档变化后节流上传，失败静默降级（游客不发任何请求）
 */
import { api } from '../../core/api.js';
import { getMeta, setMeta } from './meta.js';
import { loadBest, setBest } from './helpers.js';
import { getRawRun, setRawRun } from './save.js';

const SYNC_KEY = 'survivorsSyncAt';
const UPLOAD_DELAY = 5000;

let uploadTimer = 0;
let uploading = false;
let pending = false;

function accountId() {
  try {
    return localStorage.getItem('currentAccountId') || '';
  } catch (e) {
    return '';
  }
}

function readSyncAt() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(SYNC_KEY)) || 0));
  } catch (e) {
    return 0;
  }
}

function writeSyncAt(ts) {
  try {
    localStorage.setItem(SYNC_KEY, String(Math.max(0, Math.floor(Number(ts) || 0))));
  } catch (e) {
    // 忽略
  }
}

/** 当前本地存档快照 */
export function snapshot() {
  return {
    meta: getMeta(),
    best: loadBest(),
    run: getRawRun(),
    clientUpdatedAt: readSyncAt(),
  };
}

/** 用服务端存档覆盖本地 */
export function applyServerSave(save) {
  if (!save) return false;
  setMeta(save.meta || {});
  setBest(save.best || {});
  setRawRun(save.run ?? null);
  writeSyncAt(save.updatedAt || 0);
  return true;
}

export async function pullSave() {
  if (!accountId()) return null;
  const res = await api.survivors.getSave();
  return res?.save || null;
}

export async function pushSave() {
  if (!accountId()) return false;
  const res = await api.survivors.putSave(snapshot());
  writeSyncAt(res?.updatedAt || Date.now());
  return true;
}

/**
 * 进入游戏时同步一次
 * @returns {Promise<boolean>} 是否应用了服务端存档
 */
export async function syncOnEnter() {
  if (!accountId()) return false;
  try {
    const remote = await pullSave();
    if (!remote) {
      await pushSave();
      return false;
    }
    if ((remote.updatedAt || 0) > readSyncAt()) {
      return applyServerSave(remote);
    }
    await pushSave();
    return false;
  } catch (e) {
    console.debug('[survivors] 云存档同步失败，使用本地存档', e?.message || e);
    return false;
  }
}

/** 节流上传：5 秒内的多次变化合并为一次 */
export function scheduleUpload() {
  if (!accountId()) return;
  pending = true;
  if (uploadTimer) return;
  uploadTimer = setTimeout(() => {
    uploadTimer = 0;
    flushUpload();
  }, UPLOAD_DELAY);
}

/** 立即上传（结算 / 离开页面时调用） */
export function flushUpload() {
  if (!accountId() || !pending || uploading) return;
  pending = false;
  uploading = true;
  pushSave()
    .catch((e) => {
      console.debug('[survivors] 云存档上传失败', e?.message || e);
    })
    .finally(() => {
      uploading = false;
      if (pending) flushUpload();
    });
}

/** 离开视图时取消待执行的定时器（已挂起的变化交由 flushUpload 处理） */
export function cancelScheduledUpload() {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = 0;
  }
}
