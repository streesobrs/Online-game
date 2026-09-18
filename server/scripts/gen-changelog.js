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

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT, 'client-v2', 'src', 'config', 'changelog.js');

/** 读取 git 提交记录（记录间用 \x1e 分隔，字段用 \x1f 分隔） */
function readCommits() {
  const SEP = '\x1e';
  const FIELD = '\x1f';
  const format = [`%h`, `%aI`, `%s`, `%b`].join(FIELD);

  // 多取一倍，用于抵消被 SKIP_SUBJECT 跳过的生成提交
  const args = ['log'];
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

function buildEntries(commits) {
  const entries = [];

  for (const commit of commits) {
    if (LIMIT > 0 && entries.length >= LIMIT) break;
    if (SKIP_SUBJECT.test(commit.subject)) continue;

    const { build, body } = parseBody(commit.body);
    const sub = SUBJECT_RE.exec(commit.subject);

    entries.push({
      tag: build ? `Build ${build}` : commit.hash,
      name: sub ? sub[3].trim() : commit.subject,
      type: sub ? sub[1] : '',
      scope: sub && sub[2] ? sub[2] : '',
      hash: commit.hash,
      publishedAt: commit.date,
      body,
    });
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
    ` * 生成时间：${new Date().toISOString()}`,
    ' */',
    '',
    'export const CHANGELOG = ',
  ].join('\n');

  return `${header}${JSON.stringify(entries, null, 2)};\n`;
}

function main() {
  const commits = readCommits();

  // 拿不到 git 历史时不能中断启动/打包流程
  if (!commits) {
    if (fs.existsSync(OUT_FILE)) {
      console.warn('已保留原有更新日志，本次跳过生成');
    } else {
      fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
      fs.writeFileSync(OUT_FILE, render([]), 'utf8');
      console.warn('已生成空的更新日志（页面会显示"还没有更新记录"）');
    }
    return;
  }

  const entries = buildEntries(commits);
  fs.writeFileSync(OUT_FILE, render(entries), 'utf8');
  console.log(`已生成 ${path.relative(ROOT, OUT_FILE)}（${entries.length} 条记录）`);
}

try {
  main();
} catch (err) {
  // 生成失败绝不能阻断 npm start / 打包
  console.warn(`生成更新日志失败，已跳过：${err.message}`);
}
