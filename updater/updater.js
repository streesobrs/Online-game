const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const http = require('http');

const logFile = path.join(__dirname, '..', 'logs', 'updater.log');
const heartbeatFile = path.join(__dirname, 'updater.heartbeat');

function log(level, message, meta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    pid: process.pid,
    ...meta
  };
  try {
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* ignore */ }
  console.log(`[${level.toUpperCase()}] ${message}`, meta || '');
}

function heartbeat() {
  try {
    fs.writeFileSync(heartbeatFile, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now()
    }), 'utf8');
  } catch (e) { /* ignore */ }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await sleep(500);
    } catch (e) {
      return true;
    }
  }
  return false;
}

async function waitForPort(port, host, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://${host}:${port}/health`, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.status === 'ok') resolve(true);
              else reject(new Error('health not ok'));
            } catch (e) {
              reject(e);
            }
          });
          req.on('error', reject);
        });
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch (e) {
      await sleep(2000);
    }
  }
  return false;
}

async function replaceExe(oldExePath, newExePath) {
  const oldBackup = oldExePath + '.old';
  try {
    if (fs.existsSync(oldBackup)) {
      try { fs.unlinkSync(oldBackup); } catch (e) { /* ignore */ }
    }

    let attempts = 0;
    while (attempts < 30) {
      try {
        if (fs.existsSync(oldExePath)) {
          fs.renameSync(oldExePath, oldBackup);
        }
        break;
      } catch (e) {
        attempts++;
        log('warn', `等待旧EXE释放锁 (${attempts}/30)`);
        await sleep(1000);
      }
    }

    if (fs.existsSync(newExePath)) {
      fs.renameSync(newExePath, oldExePath);
    } else {
      if (fs.existsSync(oldBackup)) {
        fs.renameSync(oldBackup, oldExePath);
      }
      throw new Error('新EXE文件不存在');
    }

    try { if (fs.existsSync(oldBackup)) fs.unlinkSync(oldBackup); } catch (e) { /* ignore */ }
    return true;
  } catch (e) {
    log('error', `EXE替换失败: ${e.message}`);
    try {
      if (fs.existsSync(oldBackup) && !fs.existsSync(oldExePath)) {
        fs.renameSync(oldBackup, oldExePath);
      }
    } catch (e2) { /* ignore */ }
    return false;
  }
}

function rollbackFiles(backupDir, storageRoot) {
  log('info', '开始文件回滚', { backupDir });
  try {
    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      log('error', '备份清单不存在，无法回滚');
      return false;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let restored = 0;
    for (const fileInfo of manifest.files) {
      const backupPath = path.join(backupDir, fileInfo.path);
      const targetPath = path.join(storageRoot, fileInfo.path);
      if (fs.existsSync(backupPath)) {
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(backupPath, targetPath);
          restored++;
        } catch (e) {
          log('warn', `还原文件失败 ${fileInfo.path}: ${e.message}`);
        }
      }
    }
    log('info', `回滚完成，还原 ${restored} 个文件`);
    return true;
  } catch (e) {
    log('error', `回滚失败: ${e.message}`);
    return false;
  }
}

async function main() {
  log('info', '===== 更新守护进程启动 =====', { args: process.argv.slice(2) });
  heartbeat();

  let flagData = null;
  try {
    if (process.argv.length > 2) {
      flagData = JSON.parse(process.argv[2]);
    }
  } catch (e) {
    log('error', `解析参数失败: ${e.message}`);
  }

  if (!flagData) {
    const flagPath = path.join(__dirname, '..', 'restart.flag');
    try {
      if (fs.existsSync(flagPath)) {
        flagData = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
      }
    } catch (e) {
      log('error', `读取flag失败: ${e.message}`);
    }
  }

  if (!flagData) {
    log('error', '没有有效的重启参数，退出');
    process.exit(1);
  }

  const {
    pid: oldPid,
    backupDir,
    isPkg,
    exePath,
    cwd,
    scriptPath,
    useStartBat,
    action,
    port = 8080
  } = flagData;

  const storageRoot = cwd || path.join(__dirname, '..');
  const startBatPath = path.join(storageRoot, 'start.bat');

  log('info', '等待旧进程退出...', { oldPid });
  const exited = await waitForProcessExit(oldPid, 30000);
  if (!exited) {
    log('warn', '旧进程未在超时时间内退出，尝试强制终止');
    try { process.kill(oldPid, 'SIGTERM'); } catch (e) { /* ignore */ }
    await sleep(2000);
    try { process.kill(oldPid, 'SIGKILL'); } catch (e) { /* ignore */ }
    await sleep(1000);
  }
  log('info', '旧进程已退出');
  heartbeat();

  if (isPkg && exePath) {
    const newExe = exePath + '.new';
    if (fs.existsSync(newExe)) {
      log('info', '替换EXE文件...');
      const replaced = await replaceExe(exePath, newExe);
      if (!replaced) {
        log('error', 'EXE替换失败，执行回滚');
        rollbackFiles(backupDir, storageRoot);
        log('info', '启动旧版本...');
        spawnProcess(exePath, [], storageRoot, true);
        process.exit(1);
      }
      log('info', 'EXE替换成功');
    }
  }

  let newProcess = null;
  let launchSuccess = false;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts && !launchSuccess) {
    attempts++;
    log('info', `启动新版本 (尝试 ${attempts}/${maxAttempts})...`);

    try {
      if (isPkg && exePath) {
        newProcess = spawnProcess(exePath, [], storageRoot);
      } else if (useStartBat && fs.existsSync(startBatPath)) {
        newProcess = spawn('cmd.exe', ['/c', 'start.bat'], {
          cwd: storageRoot,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, UPDATE_RESTART: '1' }
        });
        newProcess.unref();
      } else if (scriptPath) {
        newProcess = spawn(process.execPath, [scriptPath], {
          cwd: storageRoot,
          detached: true,
          stdio: 'ignore'
        });
        newProcess.unref();
      } else {
        newProcess = spawn(process.execPath, ['server/server.js'], {
          cwd: storageRoot,
          detached: true,
          stdio: 'ignore'
        });
        newProcess.unref();
      }

      log('info', '等待服务启动...', { newPid: newProcess.pid });
      await sleep(3000);

      const healthy = await waitForPort(port, '127.0.0.1', 60000);
      if (healthy) {
        launchSuccess = true;
        log('info', '服务启动成功，健康检查通过');
      } else {
        log('error', '健康检查失败');
        try {
          if (newProcess && newProcess.pid) {
            process.kill(newProcess.pid, 'SIGTERM');
          }
        } catch (e) { /* ignore */ }
        await sleep(2000);
      }
    } catch (e) {
      log('error', `启动异常: ${e.message}`);
      await sleep(2000);
    }
  }

  const flagPath = path.join(__dirname, '..', 'restart.flag');
  try { if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath); } catch (e) { /* ignore */ }

  if (launchSuccess) {
    log('info', '===== 更新完成 =====');
    heartbeat();
    await sleep(1000);
    process.exit(0);
  } else {
    log('error', '===== 启动失败，执行回滚 =====');

    if (isPkg && exePath) {
      const oldExe = exePath + '.old';
      if (fs.existsSync(oldExe)) {
        try {
          if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
          fs.renameSync(oldExe, exePath);
          log('info', '已还原旧EXE');
        } catch (e) {
          log('error', `还原EXE失败: ${e.message}`);
        }
      }
    }

    if (backupDir) {
      rollbackFiles(backupDir, storageRoot);
    }

    log('info', '启动回滚后的旧版本...');
    try {
      let rollbackProc;
      if (isPkg && exePath) {
        rollbackProc = spawnProcess(exePath, [], storageRoot);
      } else if (useStartBat && fs.existsSync(startBatPath)) {
        rollbackProc = spawn('cmd.exe', ['/c', 'start.bat'], {
          cwd: storageRoot,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, UPDATE_RESTART: '1' }
        });
        rollbackProc.unref();
      } else if (scriptPath) {
        rollbackProc = spawn(process.execPath, [scriptPath], {
          cwd: storageRoot,
          detached: true,
          stdio: 'ignore'
        });
        rollbackProc.unref();
      }

      if (rollbackProc) {
        await sleep(5000);
        const rolledBack = await waitForPort(port, '127.0.0.1', 45000);
        if (rolledBack) {
          log('info', '回滚版本启动成功');
        } else {
          log('error', '回滚版本启动也失败，需要人工介入');
        }
      }
    } catch (e) {
      log('error', `回滚启动异常: ${e.message}`);
    }

    process.exit(1);
  }
}

function spawnProcess(exe, args, cwd, noUnref) {
  const proc = spawn(exe, args, {
    cwd,
    detached: true,
    stdio: 'ignore'
  });
  if (!noUnref) {
    proc.unref();
  }
  return proc;
}

setInterval(heartbeat, 5000);

main().catch(err => {
  log('error', `守护进程异常: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
