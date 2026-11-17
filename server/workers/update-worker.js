// update-worker.js - 独立更新进程
// 由主服务 UpdateManager 通过 child_process.fork 启动，在独立进程中执行
// 校验 -> 解压 -> 差异 -> 备份 -> 应用 -> 重启 流程。
// 主服务因此可以继续对外服务，并把这里上报的进度实时转发给管理后台。
const path = require('path');

let manager = null;

function send(message) {
  try {
    if (process.send) process.send(message);
  } catch (e) { /* 主进程已退出时忽略 */ }
}

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'start' || manager) return;

  const UpdateManager = require('../modules/UpdateManager');
  manager = new UpdateManager(null, { mode: 'worker', parentPid: process.ppid });

  try {
    await manager.runInWorker(msg.payload || {});
  } catch (err) {
    // runInWorker 内部已处理常规失败，这里兜底启动阶段异常
    send({
      type: 'error',
      error: err && err.message ? err.message : String(err),
      rolledBack: false,
      status: manager && manager.status ? manager._statusSnapshot() : null
    });
    setTimeout(() => process.exit(1), 300);
  }
});

process.on('uncaughtException', (err) => {
  send({
    type: 'error',
    error: `更新进程异常: ${err && err.message ? err.message : String(err)}`,
    rolledBack: false,
    status: manager && manager.status ? manager._statusSnapshot() : null
  });
  setTimeout(() => process.exit(1), 300);
});

process.on('unhandledRejection', (reason) => {
  send({
    type: 'error',
    error: `更新进程异常: ${reason instanceof Error ? reason.message : String(reason)}`,
    rolledBack: false,
    status: manager && manager.status ? manager._statusSnapshot() : null
  });
  setTimeout(() => process.exit(1), 300);
});

// 主进程一直没派发任务时自动退出，避免残留进程
setTimeout(() => {
  if (!manager) {
    send({ type: 'error', error: '更新进程未收到任务，已退出' });
    process.exit(1);
  }
}, 30000);

process.title = path.basename(__filename);
