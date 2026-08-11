// AIWorker.js - AI 计算 worker 线程入口
// 在 worker 线程中运行 AIManager 的同步计算，避免阻塞主事件循环
const { parentPort } = require('worker_threads');
const AIManager = require('./AIManager');

const ai = new AIManager();

parentPort.on('message', (msg) => {
  const { id, method, args } = msg;
  try {
    if (typeof ai[method] !== 'function') {
      parentPort.postMessage({ id, error: `方法不存在: ${method}` });
      return;
    }
    const result = ai[method](...args);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message, stack: err.stack });
  }
});

parentPort.postMessage({ type: 'ready' });
