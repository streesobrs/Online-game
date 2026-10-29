/**
 * 更新日志生成脚本
 *
 * 数据源：git 提交记录（遵循 .trae/rules/git-commit-message.md 的提交规范）
 * 产物：client-v2/src/config/changelog.js（被前端直接 import）
 *
 * 用法：npm run changelog
 *       npm run changelog -- --limit=50    （临时截断条数，默认输出全量）
 *
 * 提交信息解析规则：
 *   标题行  feat(后端-账号): 添加游客登录功能      → 类型 / 范围 / 标题
 *   正文    1. 后端改动：                          → 分组标题
 *              - 具体描述...                       → 分组条目
 *   脚注    Build: 203 -> 212                     → 版本号（取箭头右侧）
 *
 * 注意：脚本自身的提交（标题形如 chore(更新日志): ...）会被自动跳过，
 *       否则每次生成都会把上一次的生成提交也写进日志里。
 *
 * 位置说明：放在 server/ 下是为了能随打包产物一起发布（package.bat 只复制
 *          client / client-v2 / server / updater），所以 ROOT 需要向上两级。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 生成多少条记录（从最新往回取）
 * 0（默认）= 不限，输出全量历史；想截断就改成具体数字
 * 也可用 --limit=N 临时覆盖
 */
const DEFAULT_LIMIT = 0;

/** 实际生效的条数（0 = 不限） */
const LIMIT = parseLimit();

function parseLimit() {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  if (!arg) return DEFAULT_LIMIT;
  const n = Number(arg.slice('--limit='.length));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_LIMIT;
}

/** 跳过脚本自身的生成提交 */
const SKIP_SUBJECT = /^(chore|docs)\(更新日志\)/;

/** 版本脚注：Build: 203 -> 212 */
const BUILD_RE = /^Build:\s*\d+\s*->\s*(\d+)\s*$/i;

/** 没有脚注时的兜底：正文里的「更新build版本号到719」「从710到718」 */
const BUILD_FALLBACK_RE = /\bbuild\b\s*版?本?号?\s*从?\s*\d*\s*到\s*(\d+)/i;

/** 分组标题：1. 后端改动： / 1. 前端改动： / 1. 后端： */
const SECTION_RE = /^\s*\d+\.\s*(.+?)\s*[:：]?\s*$/;

/** 列表条目：- xxx / * xxx / + xxx */
const ITEM_RE = /^\s*[-*+]\s+(.+)$/;

/** 标题行：type(scope): 描述 */
const SUBJECT_RE = /^(\w+)(?:\(([^)]+)\))?[:：]\s*(.+)$/;

/** 转成 UTC+8 的 ISO 字符串（2026-10-29T16:32:05+08:00），git 的 %aI 本身就是本地时区 */
function toUtc8(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT, 'client-v2', 'src', 'config', 'changelog.js');

/** Git 自动更新记录的“当前已部署提交”（见 server/config.js update.git.stateFile） */
const STATE_FILE = path.join(ROOT, 'update', 'git-update-state.json');

/**
 * 服务通过 Git 自动更新后，本地 HEAD 可能仍停留在旧提交，
 * 此时用“已部署提交”生成日志，避免重启后更新日志被旧 HEAD 覆盖。
 * 仅当该提交存在且 HEAD 是它的祖先（即部署代码比本地 HEAD 新）时才使用。
 */
function resolveLogRef() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const commit = state && state.commit;
    if (!commit) return null;
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', commit], { cwd: ROOT, stdio: 'ignore' });
    return commit;
  } catch (e) {
    return null;
  }
}

/**
 * 已部署提交在本地仓库里不存在（例如通过 GitHub API 方式更新，本机连不上 github.com），
 * 此时本地 HEAD 是旧提交，重新生成会把包内较新的更新日志覆盖成旧的。
 * 这种情况直接保留现有 changelog.js，不重新生成。
 */
function deployedCommitMissing() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const commit = state && state.commit;
    if (!commit) return false;
    try {
      execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
      return false;
    } catch (e) {
      return true;
    }
  } catch (e) {
    return false;
  }
}

/** 读取 git 提交记录（记录间用 \x1e 分隔，字段用 \x1f 分隔） */
function readCommits() {
  if (deployedCommitMissing()) {
    console.warn('已部署提交不在本地仓库中，保留现有更新日志');
    return null;
  }

  const SEP = '\x1e';
  const FIELD = '\x1f';
  const format = [`%h`, `%aI`, `%s`, `%b`].join(FIELD);

  // 多取一倍，用于抵消被 SKIP_SUBJECT 跳过的生成提交
  const args = ['log'];
  const ref = resolveLogRef();
  if (ref) args.push(ref);
  if (LIMIT > 0) args.push(`-n${LIMIT * 2}`);
  args.push('--no-merges', `--pretty=format:${SEP}${format}`);

  let raw;
  try {
    raw = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    // 拿不到 git（未装 git / 非仓库 / 无提交）时返回 null，由调用方决定如何处理
    console.warn(`无法读取 git 提交记录：${err.message.split('\n')[0]}`);
    return null;
  }

  return raw
    .split(SEP)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash, date, subject, body] = chunk.split(FIELD);
      return { hash, date, subject: (subject || '').trim(), body: body || '' };
    });
}

/** 把分组名归类到「后端 / 前端 / 其他」 */
function groupOf(label) {
  if (/后端|服务端|服务器/.test(label) && !/前端/.test(label)) return '后端改动';
  if (/前端|客户端|界面|UI/.test(label)) return '前端改动';
  return label.trim();
}

/** 解析单个提交的正文，返回 { build, body } */
function parseBody(body) {
  let build = null;
  const groups = [];
  let current = null;

  const push = (label) => {
    current = { label, items: [] };
    groups.push(current);
  };

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // 版本脚注（不写进正文）
    const buildMatch = BUILD_RE.exec(line);
    if (buildMatch) {
      build = Number(buildMatch[1]);
      continue;
    }

    // 列表条目
    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch) {
      if (!current) push('其他改动');
      current.items.push(itemMatch[1].trim());
      continue;
    }

    // 分组标题
    const secMatch = SECTION_RE.exec(line);
    if (secMatch && !ITEM_RE.test(line)) {
      push(groupOf(secMatch[1]));
      continue;
    }

    // 既不是分词也不是条目 → 当作无分组的普通说明
    if (!current) push('其他改动');
    current.items.push(line);
  }

  // 脚注没写 Build 时，从正文里兜底找一个
  if (build === null) {
    const fallback = BUILD_FALLBACK_RE.exec(body);
    if (fallback) build = Number(fallback[1]);
  }

  // 合并同名分组（例如正文里出现两段「前端改动」）
  const merged = [];
  for (const g of groups) {
    const exist = merged.find((m) => m.label === g.label);
    if (exist) exist.items.push(...g.items);
    else merged.push({ label: g.label, items: [...g.items] });
  }

  const markdown = merged
    .filter((g) => g.items.length)
    .map((g) => `### ${g.label}\n${g.items.map((it) => `- ${it}`).join('\n')}`)
    .join('\n\n');

  return { build, body: markdown };
}

/** 单个提交 → 一条记录（脚本自身的生成提交返回 null） */
function buildEntry(commit) {
  if (SKIP_SUBJECT.test(commit.subject)) return null;

  const { build, body } = parseBody(commit.body);
  const sub = SUBJECT_RE.exec(commit.subject);

  return {
    tag: build ? `Build ${build}` : commit.hash,
    name: sub ? sub[3].trim() : commit.subject,
    type: sub ? sub[1] : '',
    scope: sub && sub[2] ? sub[2] : '',
    hash: commit.hash,
    publishedAt: commit.date,
    body,
  };
}

function buildEntries(commits) {
  const entries = [];

  for (const commit of commits) {
    if (LIMIT > 0 && entries.length >= LIMIT) break;
    const entry = buildEntry(commit);
    if (entry) entries.push(entry);
  }

  return entries;
}

function render(entries) {
  const header = [
    '/**',
    ' * 更新日志（自动生成，请勿手动编辑）',
    ' *',
    ' * 生成命令：npm run changelog',
    ' * 数据源：git 提交记录（遵循 .trae/rules/git-commit-message.md 提交规范）',
    ` * 生成时间：${toUtc8(new Date().toISOString())}`,
    ' */',
    '',
    'export const CHANGELOG = ',
  ].join('\n');

  return `${header}${JSON.stringify(entries, null, 2)};\n`;
}

/** 现有产物里的记录（无 git 时用来和远端记录合并） */
function readExistingEntries() {
  try {
    const raw = fs.readFileSync(OUT_FILE, 'utf8');
    const list = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/**
 * 没有 git 仓库（源码包部署），或已部署提交不在本地仓库时，
 * 从 GitHub API 拉提交记录补日志。
 * 每页 100 条，碰到现有记录里的提交或翻完就停（最多 5 页）。
 */
async function readRemoteCommits(existingHashes) {
  const cfg = require('../config').update.git;
  if (!cfg.enabled) throw new Error('Git 自动更新未启用');

  const headers = { 'User-Agent': 'game-server-changelog', Accept: 'application/vnd.github+json' };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

  const commits = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/commits`
      + `?sha=${encodeURIComponent(cfg.branch)}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(cfg.checkTimeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const list = await res.json();
    if (!Array.isArray(list) || !list.length) break;

    let reachedKnown = false;
    for (const item of list) {
      const message = String((item.commit && item.commit.message) || '');
      const hash = String(item.sha || '').slice(0, 7);
      const [subject, ...rest] = message.split('\n');
      commits.push({
        hash,
        date: toUtc8((item.commit && item.commit.author && item.commit.author.date) || ''),
        subject: subject.trim(),
        body: rest.join('\n'),
      });
      if (existingHashes.has(hash)) reachedKnown = true;
    }

    if (reachedKnown || list.length < 100) break;
  }

  return commits;
}

/** 新记录在前，本次没拉到的旧记录接在后面 */
function mergeEntries(fresh, existing) {
  const seen = new Set(fresh.map((e) => e.hash));
  return fresh.concat(existing.filter((e) => !seen.has(e.hash)));
}

function writeEntries(entries) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  // 启动后才生成时服务已经在跑，先写临时文件再改名，避免读到写了一半的文件
  const tmp = `${OUT_FILE}.tmp`;
  fs.writeFileSync(tmp, render(entries), 'utf8');
  fs.renameSync(tmp, OUT_FILE);
  console.log(`已生成 ${path.relative(ROOT, OUT_FILE)}（${entries.length} 条记录）`);
}

async function main() {
  const commits = readCommits();

  // 有 git 仓库：按本地提交历史完整重算
  if (commits) {
    writeEntries(buildEntries(commits));
    return;
  }

  // 没有 git：从 GitHub API 拉一次，再和现有日志合并
  const existing = readExistingEntries();
  const remote = await readRemoteCommits(new Set(existing.map((e) => e.hash)));
  if (!remote.length) throw new Error('远端没有提交记录');

  writeEntries(mergeEntries(buildEntries(remote), existing));
}

function generate() {
  // 失败绝不能阻断 npm start / 打包，保留原文件即可
  return main().catch((err) => {
    console.warn(`生成更新日志失败，已保留原有文件：${err.message}`);
  });
}

module.exports = { generate };

// 直接运行（npm run changelog / npm start 的 prestart）时立即生成；
// 被 server.js require 时由启动流程调用 generate()
if (require.main === module) {
  generate();
}
