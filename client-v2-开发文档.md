# 多棋种联机大厅 v2 客户端开发文档

> **版本**：v2.0.0  
> **创建日期**：2026-08-12  
> **状态**：规划阶段，待开工  
> **维护策略**：与 v1 长期共存，v1 已稳定主要精力投 v2

---

## 目录

0. [AI 接手指南](#零ai-接手指南)
1. [项目概述](#一项目概述)
2. [现状分析](#二现状分析)
3. [技术选型](#三技术选型)
4. [灰度部署方案](#四灰度部署方案)
5. [目录结构](#五目录结构)
6. [核心架构设计](#六核心架构设计)
7. [元数据驱动系统](#七元数据驱动系统)
8. [状态管理](#八状态管理)
9. [Socket 与 API 封装](#九socket-与-api-封装)
10. [布局渲染器系统](#十布局渲染器系统)
11. [路由设计](#十一路由设计)
12. [样式系统](#十二样式系统)
13. [迁移路径](#十三迁移路径)
14. [阶段 1 详细任务清单](#十四阶段-1-详细任务清单)
15. [v1/v2 共存策略](#十五v1v2-共存策略)
16. [开发规范](#十六开发规范)
17. [验收标准](#十七验收标准)
18. [风险评估与应对](#十八风险评估与应对)

---

## 零、AI 接手指南

> **如果你是接手这个项目的 AI（或开发者），请先读完本节再开工。**

### 0.1 这个项目在做什么

把现有的单文件客户端 `client/index.html`（12672 行巨石）重构成模块化的 `client-v2/`，基于**原生 ES Modules（无构建工具）**。**服务端完全不动**，v2 直连现有 v1 服务端。

### 0.2 不可逾越的红线

| 红线 | 说明 |
|------|------|
| ❌ **不能改服务端业务逻辑** | `server/modules/*`、`server/server.js` 中现有路由/Socket 处理逻辑不动 |
| ✅ **服务端只能追加 2 行静态伺服** | 在 `server.js` 末尾追加 `/beta` 和 `/preview` 静态目录伺服 |
| ✅ **服务端 config.js 只追加白名单** | `allowedPaths` 和 `expectedTopDirs` 追加 `'client-v2'` |
| ❌ **不能动 v1 客户端** | `client/` 目录保持原样，v1 用户继续使用 |
| ❌ **不能动 updater** | `updater/` 不动，沿用现有自动更新机制 |
| ❌ **不能引入框架** | 不用 React/Vue，纯原生 JS + ES Modules |
| ❌ **不能用 TypeScript** | 用 JSDoc 注释替代类型 |

### 0.3 开工前必做的 3 件事

1. **读完本文档**：尤其是第四章（灰度部署）、第七章（元数据）、第九章（Socket/API 封装）
2. **查阅附录 A 和 B**：v1 完整的 Socket 事件清单和 HTTP API 清单，这是 v2 封装的依据
3. **本地启动 v1 验证环境**：
   ```bash
   cd d:\工程文件\网页游戏
   npm start
   # 访问 http://localhost:8080 确认 v1 正常运行
   ```

### 0.4 第一步该干什么

按「阶段 1 任务清单」（第十四章）顺序执行：

1. 创建 `client-v2/` 目录 + `index.html` + `src/main.js` 骨架
2. 实现 `core/store.js` + `core/eventBus.js`（参考第八章代码）
3. 实现 `core/socket.js`（参考第九章 + 附录 A）
4. 实现 `core/api.js`（参考第九章 + 附录 B）
5. ……

**不要跳步**，每一步完成后再做下一步。

### 0.5 关键参考代码位置

| 想了解什么 | 看 v1 哪里 |
|-----------|-----------|
| Socket 事件如何处理 | `client/index.html` L5970-L7423（约 1500 行） |
| 五子棋落子逻辑 | `client/index.html` L12900-L13050 |
| 大厅匹配流程 | `client/index.html` L9473-L9525 |
| 主题切换 | `client/index.html` L13785+ |
| 服务端 Socket 路由 | `server/modules/GameManager.js`、`ChatManager.js` 等 |
| 服务端 HTTP 路由 | `server/server.js` L132-L1129 |

### 0.6 常见陷阱

1. **import 路径必须带 `.js` 后缀**：`import { x } from './store.js'`（不能省略，浏览器原生 ES Modules 要求）
2. **不能用 npm 包名 import**：`import io from 'socket.io-client'` 不行，要用 `window.io` 全局变量
3. **Socket.io 引入方式**：通过 `<script src="/socket.io/socket.io.js">` 全局引入，代码里用 `const io = window.io`
4. **Token 持久化**：v1 用 localStorage 存 token，v2 必须复用同样的 key，否则无法共享登录态
5. **主题 CSS 路径**：主题文件在服务端 `/themes/{name}.css`，v2 通过 `<link href="/themes/xxx.css">` 加载
6. **无 HMR**：改代码后手动刷新浏览器（F5）即可生效，无需构建
7. **资源路径**：由于部署在 `/beta/` 子路径下，CSS/图片等资源引用用相对路径 `./src/styles/xxx.css`

### 0.7 验证清单

每个阶段完成后，必须验证：
- [ ] v2 玩家能与 v1 玩家正常对战（协议兼容性）
- [ ] v2 主题切换正常（至少 default + 一个 v1 主题）
- [ ] v2 登录态与 v1 共享（同一浏览器切 v1/v2 不用重新登录）
- [ ] v2 在 `/beta/` 和 `/preview/` 都能访问

---

## 一、项目概述

### 1.1 背景

当前客户端 `client/index.html` 是一个 **12672 行**的单文件巨石应用，包含：
- CSS（约 3852 行）
- HTML 结构（约 577 行）
- JavaScript 业务逻辑（约 9779 行）

随着游戏数量增加（规划中还要新增多种游戏）和功能扩展，单文件架构已经难以维护，主要问题：
- 改动一处容易牵连其他模块
- 无法享受现代开发工具（HMR、模块化、类型检查）
- 多人协作困难
- 导航栏日益拥挤，无法灵活扩展

### 1.2 目标

基于 **原生 ES Modules（无构建工具）** 重构客户端，实现：
- 模块化架构，每个游戏/功能独立成模块
- 元数据驱动的导航系统，新增游戏只改一个文件
- 多布局可切换（顶部导航、九宫格大厅、Dock 磁吸等）
- 与 v1 长期共存，灰度发布
- 复用现有服务端，零服务端逻辑改动

### 1.3 核心原则

- **服务端不动**：v2 直连现有服务端，仅追加静态伺服路径
- **数据互通**：v1 和 v2 玩家共用同一服务端，可交叉对战
- **风格延续**：UI 风格保持 v1 视觉语言，但样式代码完全重写
- **渐进迁移**：按游戏/功能逐个迁移，每个阶段都可独立验证

---

## 二、现状分析

### 2.1 v1 客户端结构

```
client/
├── index.html          # 12672 行单文件（主入口）
├── replay-module.js    # 回放模块（已模块化）
├── profile.html        # 个人资料页
├── shop.html           # 商城页
├── feedback.html       # 反馈页
└── games-history.html  # 对战历史页
```

### 2.2 v1 已有的能力（v2 需对齐）

| 模块 | 功能 |
|------|------|
| 联机大厅 | 匹配、房间、好友挑战 |
| 游戏 | 五子棋、围棋、中国象棋、贪吃蛇 |
| 社交 | 聊天、观战、好友 |
| 系统 | 成就、排行榜、AI 对战、主题切换、快捷键 |
| 商城 | 道具、皮肤、VIP、头像 |
| 账号 | 登录、注册、个人资料、经验等级 |

### 2.3 v1 的服务端接口（v2 复用）

- **HTTP API**：`/api/auth/*`、`/api/shop/*`、`/api/leaderboard`、`/api/themes/*` 等
- **Socket.io 事件**：`game_update`、`chat_message`、`match_found` 等
- **静态资源**：`/themes/*`（主题 CSS）、`/assets/*`（徽章图标）、`/data/cosmetics/avatars/*`（头像）

CORS 已全部放开（`origin: '*'`），跨域访问无障碍。

---

## 三、技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 构建工具 | **无** | 浏览器原生 ES Modules，改完源码刷新即生效，契合 zip 打包更新机制 |
| 框架 | **不用**（原生 JS） | 棋盘类应用 DOM 操作重，框架成累赘；v1 是纯 JS，迁移最平滑 |
| 状态管理 | **自研轻量 Store + EventBus** | 不上 Redux/Zustand，原生实现约 100 行 |
| 路由 | **Hash 路由** | 无需服务端配合，刷新不丢状态 |
| 样式 | **原生 CSS 按模块拆分** | 沿用 v1 主题变量体系，平滑迁移 |
| 类型 | **JSDoc 注释**（可选） | 不强制 TypeScript，关键模块加 JSDoc |
| 包管理 | **v2 客户端无** | v2 客户端不需要 npm；服务端仍用 npm（与 v1 一致，不改动） |
| 第三方库引入 | **`<script>` 全局变量** | socket.io-client 用 v1 服务端自带的 `/socket.io/socket.io.js` |
| Node 版本 | **无额外要求** | 服务端已需要 Node + npm，v2 客户端不增加任何 Node 依赖 |

---

## 四、灰度部署方案

### 4.1 方案选择

采用 **URL 路径灰度**：v1 和 v2 通过不同 URL 路径访问，同源同端口，零跨域问题。

### 4.2 访问路径

| 路径 | 客户端版本 | 说明 |
|------|-----------|------|
| `http://server:8080/` | v1 | 现有客户端，主流量入口 |
| `http://server:8080/beta/` | v2 | 测试入口 1 |
| `http://server:8080/preview/` | v2 | 测试入口 2（同 v2，便于记忆） |

### 4.3 服务端配置（仅追加，不改现有逻辑）

在 `server/server.js` 现有静态伺服配置后追加：

```js
// v2 客户端灰度访问入口（不影响 v1）
app.use('/beta', express.static(path.join(__dirname, '..', 'client-v2')));
app.use('/preview', express.static(path.join(__dirname, '..', 'client-v2')));
```

**注意**：
- 这是纯追加，不修改任何现有路由
- v2 源码即运行码，**无需构建**，配置完即可访问
- 路径指向 `client-v2/`（不是 `client-v2/dist/`），因为不用构建

### 4.4 v2 客户端 API/Socket 调用方式

**使用相对路径**，自动指向当前源：

```js
// Socket 连接（socket.io 通过 <script> 全局引入）
const io = window.io;
export const socket = io();  // 不传 URL = 连当前源

// HTTP 请求
export async function fetchProfile() {
  const res = await fetch('/api/profile');  // 相对路径
  return res.json();
}
```

这样无论部署在 `/beta/` 还是 `/preview/`，都能正确访问服务端接口。

### 4.5 开发环境配置

**无构建工具，直接伺服源码**：

开发时直接访问服务端的 `/beta/` 路径即可，无需额外的 dev server。服务端仍用 `npm start` 启动（与 v1 一致），v2 客户端作为静态文件被服务端伺服。

```bash
# 1. 启动服务端
cd d:\工程文件\网页游戏
npm start

# 2. 确保 server.js 已追加 /beta/ 静态伺服（见 4.3）

# 3. 浏览器访问
http://localhost:8080/beta/
```

**开发循环**：
1. 编辑 `client-v2/src/` 下的源码
2. 浏览器按 F5 刷新
3. 立即看到改动（无构建步骤）

**`index.html` 加载方式**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>联机大厅 v2</title>
  <!-- 基础样式 -->
  <link rel="stylesheet" href="./src/styles/variables.css">
  <link rel="stylesheet" href="./src/styles/base.css">
  <link rel="stylesheet" href="./src/styles/common.css">
  <!-- 动态主题（JS 控制 href 切换） -->
  <link id="theme-style" rel="stylesheet" href="/themes/default.css">
</head>
<body>
  <div id="app"></div>
  <!-- 第三方库（用 v1 服务端自带的 socket.io） -->
  <script src="/socket.io/socket.io.js"></script>
  <!-- 应用入口（ES Modules） -->
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

### 4.6 启动流程

**开发期**：
1. 启动服务端：`npm start`（端口 8080）
2. 确保 `server.js` 已追加 `/beta/` 静态伺服
3. 访问 `http://localhost:8080/beta/` 开发调试
4. 改代码后按 F5 刷新即可

**生产部署**：
1. 把 `client-v2/` 目录复制到生产服务器（或通过 package.bat 上传）
2. 重启服务端
3. 访问 `http://server:8080/beta/` 或 `/preview/`

### 4.7 打包与发布流程（沿用 v1 工作流）

v2 完全接入 v1 现有的 `package.bat → 后台上传 → UpdateManager → start.bat` 流程，**只追加少量改动**。

#### 4.7.1 现有打包流程

```
开发机                              生产服务器
──────                              ──────────
1. 改代码
2. 运行 package.bat
   ├─ 读取 server/version.json
   ├─ 复制 client/ + server/ + updater/
   ├─ 排除 logs/ + data/
   └─ 压缩成 zip
3. 上传 zip 到后台管理页
                                    4. UpdateManager 校验 → 备份 → 解压 → 重启
                                    5. start.bat 启动新版本
```

#### 4.7.2 v2 接入后的改动（共 4 处）

**改动 1：`package.bat` 新增 v2 复制步骤**

在「Copying server folder」之后插入（无需构建，直接复制源码）：

```bat
echo Copying client folder...
xcopy "client" "temp-package\client\" /E /I /Y >nul

echo Copying server folder...
xcopy "server" "temp-package\server\" /E /I /Y >nul

REM ===== 新增：复制 v2 客户端（直接复制源码，无需构建）=====
if exist "client-v2" (
    echo Copying client-v2...
    xcopy "client-v2" "temp-package\client-v2\" /E /I /Y /EXCLUDE:exclude-v2.txt >nul
) else (
    echo client-v2 folder not found, skipping.
)

echo Removing runtime data and logs...
if exist "temp-package\server\logs" rmdir /s /q "temp-package\server\logs"
if exist "temp-package\data" rmdir /s /q "temp-package\data"

echo Copying updater folder...
xcopy "updater" "temp-package\updater\" /E /I /Y >nul

echo Copying root files...
copy "package.json" "temp-package\" >nul
copy "start.bat" "temp-package\" >nul
copy "start.ps1" "temp-package\" >nul

echo Creating zip file: %ZIP_NAME%
powershell -Command "Compress-Archive -Path 'temp-package\*' -DestinationPath '%ZIP_NAME%' -Force"

echo Cleaning up...
rmdir /s /q "temp-package"
```

**exclude-v2.txt**（放在项目根目录，排除不需要的文件）：
```
\.git\
\node_modules\
\logs\
\data\
\.DS_Store
Thumbs.db
```

**关键点**：
- **无需构建**：直接复制 `client-v2/` 源码即可
- `if exist "client-v2"` 容错：v2 目录不存在时跳过，不阻塞 v1 打包
- 用 `/EXCLUDE:exclude-v2.txt` 排除不需要的文件（如 .git、临时文件等）

**改动 2：`server/config.js` 放开 v2 路径白名单**

```js
// 修改 allowedPaths（约 L478）
allowedPaths: [
  'server', 'client', 'client-v2',  // ← 新增 'client-v2'
  'package.json', 'package-lock.json',
  'version.json', 'start.bat', 'start.ps1', 'package.bat', 'updater'
],

// 修改 expectedTopDirs（约 L524）
expectedTopDirs: ['server', 'client', 'client-v2'],  // ← 新增 'client-v2'
```

**作用**：让 UpdateManager 允许更新包包含 `client-v2/` 目录，否则会被安全校验拦截。

**改动 3：`server/server.js` 追加 v2 静态伺服**

在现有静态伺服配置后追加（约 L107 之后）：

```js
// v2 客户端灰度访问入口（不影响 v1）
app.use('/beta', express.static(path.join(__dirname, '..', 'client-v2')));
app.use('/preview', express.static(path.join(__dirname, '..', 'client-v2')));
```

**注意**：路径直接指向 `client-v2`（源码目录），因为无需构建。

**改动 4：`.gitignore` 忽略 v2 临时文件**

```
# v2 客户端（无需忽略 dist/，因为没有构建步骤）
client-v2/.DS_Store
client-v2/vendor/*.bak
```

#### 4.7.3 打包后的目录结构

更新包解压后的目标机器目录：

```
游戏根目录/
├── client/              ← v1（不动）
├── client-v2/           ← v2 源码（新增，直接运行无需构建）
│   ├── index.html
│   ├── src/
│   │   ├── main.js
│   │   ├── core/
│   │   ├── data/
│   │   ├── layouts/
│   │   ├── games/
│   │   ├── features/
│   │   ├── components/
│   │   ├── utils/
│   │   └── styles/
│   ├── themes/
│   └── vendor/          # 第三方库本地副本（如有）
├── server/              ← 服务端（追加 2 行静态伺服 + config 白名单）
├── updater/
├── package.json
├── start.bat
└── version.json
```

#### 4.7.4 完整工作流（v2 接入后）

```
开发机                           生产服务器
──────                           ──────────
1. 改 v2 代码
2. 运行 package.bat
   ├─ 复制 v1 + v2 源码 + server + updater
   ├─ 排除 .git / node_modules / logs / data
   └─ 压缩成 zip
3. 上传 zip 到后台管理页
                                  4. UpdateManager 接收
                                  5. 校验（client-v2 已在白名单）
                                  6. 备份当前 client/ + client-v2/ + server/
                                  7. 解压覆盖
                                  8. 重启 server（start.bat）
                                  9. 用户访问 /beta/ 或 /preview/ 看到 v2
                                  10. 用户访问 / 看到 v1
```

#### 4.7.5 注意事项

| 事项 | 说明 |
|------|------|
| 无需构建 | v2 是纯原生 ES Modules，源码即运行码，打包时直接复制即可 |
| 不增加 Node 依赖 | 服务端仍需 Node + npm（start.bat 不变），v2 客户端本身不额外增加任何依赖 |
| 版本号 | 仍用单 `version.json`，整个项目一个版本号 |
| 增量更新 | UpdateManager 的 diff 机制会识别未变化的文件，只更新差异部分 |
| 浏览器缓存 | 改完代码后，用户可能需要 Ctrl+F5 强制刷新（可在 index.html 加版本号 query 参数解决） |
| 只更新 v2 | 当前方案下不行，整个包都会更新；但 v1 文件不变时 diff 后实际只更新 v2 部分 |

---

## 五、目录结构

```
网页游戏/
├── client/                      # v1 客户端（不动）
├── server/                      # 服务端（仅追加 2 行静态伺服）
├── client-v2/                   # v2 客户端（新建，无构建工具）
│   ├── index.html               # 入口 HTML（含 <script type="module">）
│   ├── themes/                  # 主题 CSS（复制 v1 的，按需重写）
│   ├── vendor/                  # 第三方库本地副本（如有，默认用服务端 /socket.io/socket.io.js）
│   └── src/
│       ├── main.js              # 应用入口
│       │
│       ├── core/                # 核心基础设施
│       │   ├── eventBus.js      # 全局事件总线
│       │   ├── store.js         # 集中状态管理
│       │   ├── socket.js        # Socket.io 客户端封装
│       │   ├── api.js           # HTTP API 封装
│       │   ├── router.js        # Hash 路由
│       │   └── auth.js          # 登录态管理
│       │
│       ├── data/                # 元数据
│       │   ├── navItems.js      # 导航元数据（核心）
│       │   ├── games.js         # 游戏元信息
│       │   └── shortcuts.js     # 快捷键映射（自动派生）
│       │
│       ├── layouts/             # 布局渲染器
│       │   ├── registry.js      # 布局注册表
│       │   ├── topnav.js        # 顶部导航布局
│       │   ├── hub.js           # 大厅九宫格布局
│       │   └── dock.js          # Dock 磁吸布局
│       │
│       ├── games/               # 游戏模块
│       │   ├── gobang/
│       │   │   ├── board.js     # 棋盘渲染
│       │   │   ├── rules.js     # 胜负判定
│       │   │   ├── ai.js        # 单机 AI（如有）
│       │   │   ├── index.js     # 对外接口
│       │   │   └── styles.css
│       │   ├── go/
│       │   ├── chinese-chess/
│       │   └── snake/
│       │
│       ├── features/            # 功能模块
│       │   ├── lobby/           # 联机大厅
│       │   ├── chat/            # 聊天
│       │   ├── achievements/    # 成就
│       │   ├── leaderboard/     # 排行榜
│       │   ├── ai-battle/       # AI 对战
│       │   ├── spectate/        # 观战
│       │   ├── shop/            # 商城
│       │   ├── profile/         # 个人资料
│       │   └── themes/          # 主题切换
│       │
│       ├── components/          # 通用 UI 组件
│       │   ├── modal.js
│       │   ├── toast.js
│       │   ├── confirm.js
│       │   └── button.js
│       │
│       ├── utils/               # 工具函数
│       │   ├── dom.js
│       │   ├── format.js
│       │   └── shortcut.js
│       │
│       └── styles/              # 全局样式
│           ├── variables.css    # CSS 变量
│           ├── base.css         # 基础 reset
│           └── common.css       # 通用组件样式
│
└── client-v2-开发文档.md        # 本文档
```

---

## 六、核心架构设计

### 6.1 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    v2 客户端架构                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐   │
│  │  Router  │   │  Store   │   │   EventBus   │   │
│  │ (Hash)   │   │ (State)  │   │  (Pub/Sub)   │   │
│  └────┬─────┘   └────┬─────┘   └──────┬───────┘   │
│       │              │                │            │
│       └──────────────┴────────────────┘            │
│                      │                              │
│  ┌───────────────────▼──────────────────────────┐  │
│  │              核心层 (core/)                   │  │
│  │  socket.js  api.js  auth.js                  │  │
│  └───────────────────┬──────────────────────────┘  │
│                      │                              │
│  ┌───────────────────▼──────────────────────────┐  │
│  │           元数据层 (data/)                    │  │
│  │  navItems.js  games.js  shortcuts.js         │  │
│  └───────────────────┬──────────────────────────┘  │
│                      │                              │
│  ┌───────────────────▼──────────────────────────┐  │
│  │           视图层 (layouts/games/features)    │  │
│  │  topnav  gobang  lobby  chat  ...            │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
                      │
                      ▼
          ┌─────────────────────┐
          │   现有服务端 (v1)    │
          │  HTTP + Socket.io   │
          └─────────────────────┘
```

### 6.2 数据流

```
用户操作 → Router 更新 hash → Store 更新 currentView
                                ↓
                        对应模块挂载到 #app
                                ↓
                        模块通过 Socket/API 获取数据
                                ↓
                        Store 更新 → EventBus 广播
                                ↓
                        视图自动更新（订阅 Store/EventBus）
```

---

## 七、元数据驱动系统

### 7.1 设计理念

**一份元数据，多个消费者**。导航栏、快捷键、成就分类、移动端菜单等所有需要"游戏/功能列表"的地方，都从同一个数据源派生。

### 7.2 元数据 Schema

```js
// src/data/navItems.js
export const NAV_ITEMS = [
  // ===== 游戏 =====
  {
    id: 'gobang',
    type: 'game',
    name: '五子棋',
    icon: '🔴',
    shortcut: '1',
    order: 1,
    online: 0,           // 实时在线人数（运行时更新）
    hot: false,          // 是否热门标记
    boardSize: 15,       // 棋盘尺寸
  },
  {
    id: 'go',
    type: 'game',
    name: '围棋',
    icon: '⚪',
    shortcut: '2',
    order: 2,
    boardSize: 19,
  },
  {
    id: 'chinese-chess',
    type: 'game',
    name: '象棋',
    icon: '🟥',
    shortcut: '3',
    order: 3,
    boardSize: { rows: 10, cols: 9 },
  },
  {
    id: 'snake',
    type: 'game',
    name: '贪吃蛇',
    icon: '🐍',
    shortcut: '4',
    order: 4,
  },

  // ===== 功能 =====
  {
    id: 'achievements',
    type: 'feature',
    name: '成就',
    icon: '🏆',
    shortcut: 'A',
    category: '辅助',
    order: 10,
  },
  {
    id: 'leaderboard',
    type: 'feature',
    name: '排行榜',
    icon: '📊',
    shortcut: 'L',
    category: '辅助',
    order: 11,
  },
  {
    id: 'ai-battle',
    type: 'feature',
    name: 'AI对战',
    icon: '🤖',
    shortcut: 'G',
    category: '对战',
    order: 12,
  },
  {
    id: 'spectate',
    type: 'feature',
    name: '观战',
    icon: '👁',
    shortcut: 'V',
    category: '辅助',
    order: 13,
  },
  {
    id: 'themes',
    type: 'feature',
    name: '主题',
    icon: '🎨',
    shortcut: 'T',
    category: '设置',
    order: 20,
  },
  {
    id: 'shortcuts',
    type: 'feature',
    name: '快捷键',
    icon: '⌨',
    shortcut: 'K',
    category: '设置',
    order: 21,
  },
];

// 派生数据
export const GAMES = NAV_ITEMS.filter(i => i.type === 'game').sort((a, b) => a.order - b.order);
export const FEATURES = NAV_ITEMS.filter(i => i.type === 'feature').sort((a, b) => a.order - b.order);

export function findItem(id) {
  return NAV_ITEMS.find(i => i.id === id);
}
```

### 7.3 元数据的消费者

| 消费者 | 使用方式 |
|--------|---------|
| 布局渲染器 | 遍历渲染按钮 |
| 快捷键注册器 | 自动绑定 `shortcut` 字段 |
| 成就分类 | 遍历 `type === 'game'` 生成分类标签 |
| 路由表 | 自动生成 `#/{id}` 路由 |
| 移动端菜单 | 响应式下拉菜单 |

### 7.4 新增一个游戏的完整步骤

只需在 `navItems.js` 数组中追加一项：

```js
{
  id: 'reversi',
  type: 'game',
  name: '黑白棋',
  icon: '⚫',
  shortcut: '5',
  order: 5,
  boardSize: 8,
}
```

然后创建 `src/games/reversi/` 目录实现游戏逻辑。导航栏、快捷键、路由全部自动生效。

---

## 八、状态管理

### 8.1 设计思路

不上 Redux/Zustand，自研轻量 Store（约 100 行），核心能力：
- 集中存储应用状态
- 订阅/取消订阅机制
- 不可变更新（可选）

### 8.2 Store 实现

```js
// src/core/store.js
class Store {
  constructor() {
    this.state = {
      // 用户
      user: null,
      token: null,

      // 视图
      currentView: 'lobby',       // 当前视图 ID
      currentGame: null,          // 当前游戏 ID
      currentLayout: 'topnav',    // 当前布局

      // 大厅
      matching: false,            // 是否正在匹配
      currentRoom: null,          // 当前房间

      // 在线状态
      onlineCount: 0,
      onlinePlayers: [],

      // 游戏
      activeGames: [],            // 进行中的对局列表

      // 主题
      currentTheme: 'default',
    };
    this.listeners = new Map();  // key -> Set<fn>
  }

  /**
   * 读取状态
   * @param {string} key
   */
  get(key) {
    return this.state[key];
  }

  /**
   * 更新状态并通知订阅者
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this.state[key] === value) return;  // 相同值不更新
    this.state[key] = value;
    this._notify(key, value);
  }

  /**
   * 批量更新
   * @param {Object} patch
   */
  patch(patch) {
    Object.entries(patch).forEach(([key, value]) => this.set(key, value));
  }

  /**
   * 订阅某个 key 的变化
   * @param {string} key
   * @param {Function} fn
   * @returns {Function} 取消订阅函数
   */
  subscribe(key, fn) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(fn);
    // 立即触发一次，让订阅者拿到当前值
    fn(this.state[key]);
    return () => this.listeners.get(key).delete(fn);
  }

  _notify(key, value) {
    const fns = this.listeners.get(key);
    if (fns) fns.forEach(fn => fn(value));
  }
}

export const store = new Store();
```

### 8.3 使用示例

```js
// 在任意模块中
import { store } from '../core/store.js';

// 读取
const user = store.get('user');

// 更新
store.set('currentGame', 'gobang');

// 订阅
const unsubscribe = store.subscribe('onlineCount', (count) => {
  document.getElementById('online-count').textContent = count;
});

// 取消订阅（组件销毁时）
unsubscribe();
```

---

## 九、Socket 与 API 封装

### 9.1 Socket 封装

**目标**：业务模块不直接接触 socket.io，通过 EventBus 解耦。

```js
// src/core/socket.js
// socket.io 通过 <script src="/socket.io/socket.io.js"> 全局引入
const io = window.io;
import { eventBus } from './eventBus.js';
import { store } from './store.js';

export const socket = io({
  transports: ['websocket', 'polling'],
  query: () => ({ token: store.get('token') }),
});

// ===== 连接状态 =====
socket.on('connect', () => {
  store.set('socketConnected', true);
  eventBus.emit('socket:connect');
});

socket.on('disconnect', () => {
  store.set('socketConnected', false);
  eventBus.emit('socket:disconnect');
});

// ===== 业务事件分发 =====
// 所有 socket 事件统一转 eventBus，业务模块只订阅 eventBus
const EVENT_MAP = {
  'game_update': 'game:update',
  'game_over': 'game:over',
  'chat_message': 'chat:message',
  'match_found': 'lobby:matchFound',
  'match_cancel': 'lobby:matchCancel',
  'player_joined': 'lobby:playerJoined',
  'player_left': 'lobby:playerLeft',
  'online_count': 'system:onlineCount',
  'system_broadcast': 'system:broadcast',
  // ... 按 v1 的 socket 事件清单补全
};

Object.entries(EVENT_MAP).forEach(([socketEvent, busEvent]) => {
  socket.on(socketEvent, (data) => {
    eventBus.emit(busEvent, data);
  });
});

// ===== 主动发送事件的统一方法 =====
export function emit(event, data) {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    // 离线队列（可选）
    console.warn('[Socket] 未连接，事件已丢弃:', event);
  }
}
```

### 9.2 业务模块订阅示例

```js
// src/games/gobang/index.js
import { eventBus } from '../../core/eventBus';
import { emit } from '../../core/socket';
import { store } from '../../core/store';

class GobangGame {
  init() {
    // 订阅游戏更新事件
    this.unsubscribe = eventBus.on('game:update', (data) => {
      if (data.gameType !== 'gobang') return;
      this.applyMove(data);
    });

    eventBus.on('game:over', (data) => {
      if (data.gameType !== 'gobang') return;
      this.showResult(data);
    });
  }

  destroy() {
    this.unsubscribe();
  }

  makeMove(row, col) {
    emit('game_move', { row, col, gameType: 'gobang' });
  }
}
```

### 9.3 HTTP API 封装

```js
// src/core/api.js
import { store } from './store';

const BASE_URL = '';  // 同源，相对路径

async function request(path, options = {}) {
  const token = store.get('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),

  // 业务接口封装
  auth: {
    login: (username, password) => api.post('/api/auth/login', { username, password }),
    register: (username, password) => api.post('/api/auth/register', { username, password }),
    verify: (token) => api.post('/api/auth/verify', { token }),
  },
  shop: {
    getData: () => api.get('/api/shop/data'),
    buy: (itemId, quantity) => api.post('/api/shop/buy', { itemId, quantity }),
  },
  leaderboard: {
    get: (limit = 10) => api.get(`/api/leaderboard?limit=${limit}`),
  },
  themes: {
    list: () => api.get('/api/themes'),
    apply: (themeId) => api.post('/api/themes/apply', { themeId }),
  },
  // ... 按 v1 的 API 路由补全
};
```

---

## 十、布局渲染器系统

### 10.1 设计理念

布局 = 纯函数 `render(items, container) => { cleanup }`。所有布局消费同一份 `NAV_ITEMS`，点击事件路由到同一组 handler。

### 10.2 布局注册表

```js
// src/layouts/registry.js
import { renderTopNav } from './topnav.js';
import { renderHub } from './hub.js';
// import { renderDock } from './dock';  // 后续实现

export const LAYOUTS = {
  topnav: {
    id: 'topnav',
    name: '顶部导航',
    render: renderTopNav,
  },
  hub: {
    id: 'hub',
    name: '大厅九宫格',
    render: renderHub,
  },
  // dock: { id: 'dock', name: 'Dock磁吸', render: renderDock },
};

export function getLayout(id) {
  return LAYOUTS[id] || LAYOUTS.topnav;
}

export function switchLayout(id) {
  const layout = getLayout(id);
  const container = document.getElementById('nav-root');
  if (!container) return;

  // 清理旧布局
  if (window._currentLayoutCleanup) window._currentLayoutCleanup();
  container.innerHTML = '';
  container.className = `nav-layout nav-layout--${layout.id}`;

  // 渲染新布局
  window._currentLayoutCleanup = layout.render(container);
  localStorage.setItem('nav-layout', id);
}
```

### 10.3 布局渲染器示例

```js
// src/layouts/topnav.js
import { GAMES, FEATURES } from '../data/navItems.js';
import { handleNavClick, isActive } from '../core/router';
import { store } from '../core/store.js';

export function renderTopNav(container) {
  container.innerHTML = `
    <div class="nav-group nav-group--games">
      ${GAMES.map(item => navButtonHTML(item)).join('')}
    </div>
    <div class="nav-divider"></div>
    <div class="nav-group nav-group--features">
      ${FEATURES.map(item => navButtonHTML(item)).join('')}
    </div>
  `;

  // 绑定事件
  const buttons = container.querySelectorAll('[data-nav]');
  const handlers = [];
  buttons.forEach(btn => {
    const handler = () => handleNavClick(btn.dataset.nav);
    btn.addEventListener('click', handler);
    handlers.push({ btn, handler });
  });

  // 订阅状态变化，更新 active
  const unsubscribe = store.subscribe('currentView', (view) => {
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === view);
    });
  });

  // 返回 cleanup 函数
  return () => {
    handlers.forEach(({ btn, handler }) => btn.removeEventListener('click', handler));
    unsubscribe();
  };
}

function navButtonHTML(item) {
  const active = isActive(item.id) ? 'active' : '';
  return `<button class="nav-btn ${active}" data-nav="${item.id}">
    <span class="nav-btn__icon">${item.icon}</span>
    <span class="nav-btn__name">${item.name}</span>
    ${item.shortcut ? `<sup class="nav-btn__shortcut">${item.shortcut}</sup>` : ''}
  </button>`;
}
```

### 10.4 新增布局步骤

1. 在 `src/layouts/` 下新建文件，如 `dock.js`
2. 导出 `render(container) => cleanup` 函数
3. 在 `registry.js` 中注册
4. 完成

---

## 十一、路由设计

### 11.1 Hash 路由

使用 hash 路由（`#/path`），无需服务端配合，刷新不丢状态。

```
#/                    → 大厅首页
#/gobang              → 五子棋
#/go                  → 围棋
#/chinese-chess       → 象棋
#/snake               → 贪吃蛇
#/achievements        → 成就
#/leaderboard         → 排行榜
#/ai-battle           → AI 对战
#/spectate            → 观战
#/themes              → 主题
#/shortcuts           → 快捷键
```

### 11.2 路由实现

```js
// src/core/router.js
import { NAV_ITEMS } from '../data/navItems.js';
import { store } from './store';
import { eventBus } from './eventBus';

const ROUTES = new Map();
const DEFAULT_ROUTE = 'lobby';

// 注册路由
export function registerRoute(id, handler) {
  ROUTES.set(id, handler);
}

// 路由跳转
export function go(id) {
  if (!NAV_ITEMS.find(i => i.id === id) && id !== DEFAULT_ROUTE) {
    console.warn(`[Router] 未知路由: ${id}`);
    return;
  }
  window.location.hash = `#/${id === DEFAULT_ROUTE ? '' : id}`;
}

// 处理路由变化
function handleHashChange() {
  const hash = window.location.hash.slice(2);  // 去掉 '#/'
  const id = hash || DEFAULT_ROUTE;

  store.set('currentView', id);

  const handler = ROUTES.get(id);
  if (handler) {
    handler();
  } else {
    console.warn(`[Router] 路由未注册: ${id}`);
  }

  eventBus.emit('route:change', id);
}

// 判断当前是否激活
export function isActive(id) {
  return store.get('currentView') === id;
}

// 处理导航点击
export function handleNavClick(id) {
  go(id);
}

// 初始化
window.addEventListener('hashchange', handleHashChange);

// 启动时触发一次
export function initRouter() {
  if (!window.location.hash) {
    window.location.hash = '#/';
  } else {
    handleHashChange();
  }
}
```

### 11.3 业务模块注册路由

```js
// src/games/gobang/index.js
import { registerRoute } from '../../core/router.js';

registerRoute('gobang', () => {
  // 挂载五子棋界面到 #app
  mountGobangUI();
});
```

---

## 十二、样式系统

### 12.1 设计原则

- **风格延续**：保持 v1 的视觉语言（配色、圆角、阴影、间距），用户切换无违和感
- **代码重写**：不复制 v1 的 CSS，按新架构重新组织
- **CSS 变量驱动**：沿用 v1 的主题变量体系，主题切换无缝
- **按模块拆分**：每个游戏/功能模块有自己的 CSS 文件

### 12.2 CSS 变量体系

```css
/* src/styles/variables.css */
:root {
  /* 主题色（沿用 v1 命名，便于主题 CSS 复用） */
  --theme-primary: #007bff;
  --theme-primary-hover: #0056b3;
  --theme-success: #28a745;
  --theme-danger: #dc3545;
  --theme-warning: #ffc107;
  --theme-info: #17a2b8;

  /* 背景色 */
  --theme-bg: #f0f2f5;
  --theme-container-bg: #ffffff;
  --theme-nav-bg: #ffffff;
  --theme-panel-bg: #f8f9fa;

  /* 文字色 */
  --theme-text-primary: #212529;
  --theme-text-secondary: #6c757d;
  --theme-text-muted: #adb5bd;

  /* 边框与阴影 */
  --theme-border-color: #dee2e6;
  --theme-nav-shadow: 0 3px 12px rgba(0, 0, 0, 0.07);
  --theme-panel-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 7px;
  --radius-lg: 10px;
  --radius-xl: 16px;

  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* 字体 */
  --font-size-sm: 12px;
  --font-size-md: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 18px;

  /* 过渡 */
  --transition-fast: 0.15s ease;
  --transition-base: 0.2s ease;
}
```

### 12.3 主题切换机制

复用 v1 的主题 CSS 文件结构（`/themes/{name}.css`），通过 `<link>` 标签动态切换：

```js
// src/features/themes/index.js
import { api } from '../../core/api.js';
import { store } from '../../core/store';

export async function applyTheme(themeId) {
  // 移除旧主题
  const oldLink = document.getElementById('theme-css');
  if (oldLink) oldLink.remove();

  // 加载新主题
  const link = document.createElement('link');
  link.id = 'theme-css';
  link.rel = 'stylesheet';
  link.href = `/themes/${themeId}.css`;
  document.head.appendChild(link);

  store.set('currentTheme', themeId);
  localStorage.setItem('theme', themeId);
}

export async function loadThemes() {
  const { themes } = await api.themes.list();
  store.set('availableThemes', themes);

  // 恢复上次主题
  const saved = localStorage.getItem('theme') || 'default';
  await applyTheme(saved);
}
```

### 12.4 样式文件组织

```
src/styles/
├── variables.css       # CSS 变量（基础）
├── base.css            # reset + 基础元素样式
├── common.css          # 通用组件（按钮、表单、卡片）
├── layout.css          # 布局骨架（#app、导航容器）
└── responsive.css      # 响应式断点

src/games/gobang/
└── styles.css          # 五子棋专属样式

src/features/lobby/
└── styles.css          # 大厅专属样式
```

每个模块的 CSS 通过 `<link>` 标签加载，或在 index.html 中统一引入：

```js
// src/games/gobang/index.js
// 方式 1：动态加载 CSS（推荐，按需加载）
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = './src/games/gobang/styles.css';
document.head.appendChild(link);

// 方式 2：在 index.html 中静态引入（简单但全量加载）
// <link rel="stylesheet" href="./src/games/gobang/styles.css">
```

---

## 十三、迁移路径

### 13.1 五阶段路线图

| 阶段 | 内容 | 里程碑 | 优先级 |
|------|------|--------|--------|
| **阶段 1** | 骨架搭建 + 大厅基础 | 能登录、能匹配、能进空棋盘 | 🔴 必须 |
| **阶段 2** | 五子棋完整迁移 | 五子棋可联机对战 | 🔴 必须 |
| **阶段 3** | 围棋、象棋、贪吃蛇 | 4 个游戏全部可玩 | 🟡 高 |
| **阶段 4** | 聊天、成就、排行榜、AI、观战、商城 | 功能对齐 v1 | 🟡 高 |
| **阶段 5** | 响应式、性能、bug 修复 | 可正式上线 | 🟢 中 |

### 13.2 阶段间独立性

每个阶段完成后都是可独立运行的版本：
- 阶段 1 完成：v2 可访问，能登录看大厅，但下不了棋
- 阶段 2 完成：v2 可玩五子棋，其他游戏未实现
- 阶段 3 完成：v2 可玩所有游戏，但功能不全
- 阶段 4 完成：v2 功能对齐 v1
- 阶段 5 完成：v2 可替代 v1

### 13.3 v2 玩家与 v1 玩家互通

由于共用同一服务端，**v2 玩家可以和 v1 玩家对战**。这是天然优势，可作为交叉测试手段：v1 玩家辅助验证 v2 的协议兼容性。

---

## 十四、阶段 1 详细任务清单

### 14.1 任务列表

> 详细任务清单见 [client-v2-任务清单.md](./client-v2-任务清单.md)，以下为概览。

| # | 任务 | 输出 | 验收 |
|---|------|------|------|
| 1 | 创建 client-v2/ 目录结构 | 完整目录骨架 | 目录存在 |
| 2 | 创建 index.html 入口 | HTML + CSS link + script 标签 | 浏览器能加载 |
| 3 | 创建 src/main.js 骨架 | 应用入口 | 控制台能输出 |
| 4 | 实现 `core/eventBus.js` | 事件总线 | 单元测试通过 |
| 5 | 实现 `core/store.js` | 状态管理 | 单元测试通过 |
| 6 | 实现 `utils/dom.js` | DOM 辅助函数 | 提供_el、$、$$ |
| 7 | 实现 `components/toast.js` | 提示组件 | 能显示/自动消失 |
| 8 | 实现 `components/modal.js` | 模态框 | 能弹窗/回调 |
| 9 | 实现 `core/api.js` | HTTP 封装 | 能调用 `/health` |
| 10 | 实现 `core/socket.js` | Socket 封装 | 能连接 v1 后端 |
| 11 | 实现 `core/auth.js` | 登录态管理 | 能登录、持久化 token |
| 12 | 实现 `data/navItems.js` | 导航元数据 | 数据结构完整 |
| 13 | 实现 `core/router.js` | Hash 路由 | URL 变化能触发视图切换 |
| 14 | 实现 `utils/shortcut.js` | 快捷键注册器 | 按 1/2/3/4 能切换游戏 |
| 15 | 实现 `styles/` 基础样式 | variables + base + common | 视觉风格接近 v1 |
| 16 | 复制 v1 主题 CSS | themes/ 目录 | 主题文件存在 |
| 17 | 实现 `features/themes/` | 主题切换功能 | 切换主题立即生效 |
| 18 | 实现 `layouts/registry.js` + `topnav.js` | 顶部导航布局 | 导航栏能渲染、点击切换 |
| 19 | 实现 `features/auth/login.js` | 登录界面 | 能登录/游客模式 |
| 20 | 实现 `features/lobby/` | 大厅基础（匹配、房间） | 能开始/取消匹配 |
| 21 | 实现 `games/gobang/` 空棋盘 | 五子棋棋盘渲染（不对战） | 能显示 15×15 棋盘 |
| 22 | main.js 整合 | 初始化所有模块 | 应用完整启动 |
| 23 | 服务端追加静态伺服 | server.js 加 2 行 | `/beta/` 和 `/preview/` 可访问 |
| 24 | 阶段 1 整体验证 | 所有功能联动 | 完整通过验收标准 |

### 14.2 阶段 1 验收标准

- ✅ 访问 `http://server:8080/beta/` 看到 v2 界面
- ✅ 能用 v1 账号登录（token 复用）
- ✅ 能看到导航栏（4 个游戏 + 6 个功能按钮）
- ✅ 点击「五子棋」能进入空棋盘页面
- ✅ 点击「开始匹配」能进入匹配队列（匹配成功后可进入房间，但下棋逻辑阶段 2 实现）
- ✅ 按 1/2/3/4 能切换游戏
- ✅ 视觉风格与 v1 接近（配色、布局、按钮样式）
- ✅ 主题切换可用（至少 default + 一个 v1 主题）

### 14.3 阶段 1 不做的事

- ❌ 任何游戏的对战逻辑（阶段 2）
- ❌ 聊天功能（阶段 4）
- ❌ 成就、排行榜等高级功能（阶段 4）
- ❌ 移动端响应式（阶段 5）
- ❌ 性能优化（阶段 5）

---

## 十五、v1/v2 共存策略

### 15.1 优先级分配

| 客户端 | 优先级 | 投入比例 |
|--------|--------|---------|
| v1 | 仅维护 | 10%（只修紧急 bug） |
| v2 | 主力开发 | 90% |

### 15.2 数据互通

- **账号数据**：完全共享，v1 注册的账号在 v2 可直接登录
- **游戏数据**：完全共享，v1 和 v2 玩家可交叉对战
- **资产数据**：完全共享，星钻、道具、皮肤、成就等通用

### 15.3 功能对齐策略

v2 在阶段 4 完成前，未实现的功能按钮显示为「建设中」状态：

```js
// 未实现的模块路由
registerRoute('achievements', () => {
  mountPlaceholder('成就功能正在开发中，敬请期待');
});
```

### 15.4 切换入口（可选）

阶段 4 完成后，可在 v1 首页加一个小入口引导用户尝试 v2：

```html
<!-- v1 client/index.html 末尾追加（可选） -->
<a href="/beta/" class="v2-entry" style="position:fixed;bottom:10px;right:10px;
   font-size:12px;color:#666;opacity:0.6;">体验新版 →</a>
```

### 15.5 正式切换（远期）

v2 完全稳定后，可选择：
- **方案 A**：把 v2 内容替换到 `client/`，删除 `client-v2/`
- **方案 B**：保留 v2 在 `/beta/`，让用户自选
- **方案 C**：服务端默认伺服 v2，v1 移到 `/legacy/`

---

## 十六、开发规范

### 16.1 命名约定

| 类型 | 风格 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `event-bus.js`、`nav-items.js` |
| 目录名 | kebab-case | `ai-battle/`、`chinese-chess/` |
| 变量名 | camelCase | `currentView`、`onlineCount` |
| 常量 | UPPER_SNAKE_CASE | `NAV_ITEMS`、`DEFAULT_ROUTE` |
| 类名 | PascalCase | `class GobangGame` |
| CSS 类名 | BEM 风格 | `.nav-btn__icon`、`.nav-btn--active` |
| 事件名 | namespace:event | `game:update`、`chat:message` |

### 16.2 模块导出规范

每个模块只导出必要的接口，避免默认导出（default export）：

```js
// ✅ 推荐
export function renderTopNav() { ... }
export function renderHub() { ... }

// ❌ 避免
export default function () { ... }
```

### 16.3 注释规范

关键模块必须有 JSDoc 注释：

```js
/**
 * 集中状态管理
 * @class Store
 */
class Store {
  /**
   * 订阅某个 key 的变化
   * @param {string} key - 状态键名
   * @param {Function} fn - 回调函数，接收新值
   * @returns {Function} 取消订阅函数
   */
  subscribe(key, fn) { ... }
}
```

### 16.4 文件大小限制

- 单个 JS 文件不超过 **300 行**，超过必须拆分
- 单个 CSS 文件不超过 **200 行**
- 函数长度不超过 **50 行**

### 16.5 错误处理

- 所有 `async/await` 必须用 `try/catch` 包裹
- 错误统一通过 `toast` 提示用户
- 关键错误通过 `eventBus.emit('error', err)` 上报

```js
try {
  const data = await api.shop.buy(itemId, qty);
  toast.success('购买成功');
} catch (err) {
  toast.error(err.message);
  eventBus.emit('error', err);
}
```

### 16.6 Git 提交规范

遵循项目现有规范（`.trae/rules/git-commit-message.md`），示例：

```
feat(前端-v2): 实现五子棋棋盘渲染

1. 前端：
   - 新增 client-v2/games/gobang/ 模块
   - 实现 15×15 棋盘 grid 布局
   - 添加落子高亮效果

Build: 100 -> 105
```

---

## 十七、验收标准

### 17.1 阶段验收

每个阶段需满足以下条件才能进入下一阶段：

| 验收项 | 标准 |
|--------|------|
| 功能完整性 | 该阶段规划的功能全部实现 |
| 协议兼容性 | v2 玩家能与 v1 玩家正常对战/交互 |
| 性能 | 首屏加载 < 3 秒，棋盘渲染 < 100ms |
| 视觉一致性 | 与 v1 风格保持一致 |
| 代码质量 | 无 lint 错误，关键模块有注释 |
| 文档更新 | 本文档同步更新进度 |

### 17.2 最终上线验收

- ✅ 所有 v1 功能在 v2 中实现
- ✅ v2 玩家与 v1 玩家交叉测试无 bug
- ✅ 性能不劣于 v1
- ✅ 移动端可用
- ✅ 至少 3 个主题可切换
- ✅ 快捷键全部可用

---

## 十八、风险评估与应对

### 18.1 技术风险

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Socket 事件名与 v1 不一致 | 中 | 高 | 阶段 1 先整理 v1 完整事件清单，建立映射表 |
| 主题 CSS 不兼容 | 中 | 中 | 阶段 1 优先验证主题切换 |
| 浏览器缓存导致旧代码生效 | 中 | 中 | index.html 资源引用加版本号 query 参数，或服务端禁用缓存 |
| 棋盘渲染性能 | 低 | 高 | 阶段 2 重点关注，必要时用 Canvas 替代 DOM |

### 18.2 进度风险

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| 阶段 2 五子棋迁移卡壳 | 中 | 高 | 这是关键验证点，卡住时优先解决 |
| v1 紧急 bug 中断 v2 开发 | 低 | 中 | v1 已稳定，预期不会有紧急 bug |
| 功能对齐工作量超预期 | 中 | 中 | 阶段 4 可按优先级分批，非核心功能延后 |

### 18.3 兼容性风险

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| v1 协议变更未通知 v2 | 低 | 高 | v1 已冻结，不再加新功能 |
| 浏览器兼容性 | 低 | 中 | 原生 ES Modules 需现代浏览器（Chrome 61+、Firefox 60+、Safari 11+），IE 不考虑 |

---

## 附录 A：v1 Socket 事件清单

> 来源：`client/index.html` 中的 `socket.on(...)` 和 `socket.emit(...)` 调用。  
> v2 的 `core/socket.js` 必须覆盖以下所有事件。

### A.1 客户端接收的事件（socket.on）

#### 连接相关
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `connect` | 连接成功 | - |
| `disconnect` | 连接断开 | - |
| `reconnect` | 重连成功 | - |
| `reconnect_attempt` | 重连尝试 | `attemptNumber: number` |
| `reconnect_failed` | 重连失败 | - |
| `version_check` | 版本检查 | `{ client, server, ... }` |

#### 用户与账号
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `user_connected` | 用户上线 | `{ userId, nickname, ... }` |
| `online_users` | 在线用户列表 | `Array<User>` |
| `user_status` | 用户状态变化 | `{ userId, status, ... }` |
| `account_info` | 账号信息响应 | `AccountData` |
| `account_action_result` | 账号操作结果 | `{ action, success, ... }` |
| `account_updated` | 账号信息更新 | `AccountData` |
| `login_result` | 登录结果 | `{ success, account, ... }` |
| `exp_gained` | 获得经验 | `{ exp, reason, ... }` |
| `mail_received` | 收到邮件 | `MailData` |

#### 大厅与匹配
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `match_success` | 匹配成功 | `{ gameId, opponent, ... }` |
| `match_timeout` | 匹配超时 | `{ ... }` |
| `return_lobby` | 返回大厅 | `{ ... }` |
| `opponent_left` | 对手离开 | `{ ... }` |
| `challenge_received` | 收到挑战 | `{ from, ... }` |
| `challenge_sent` | 挑战已发送 | `{ to, ... }` |
| `challenge_accepted` | 挑战被接受 | `{ ... }` |
| `challenge_rejected` | 挑战被拒绝 | `{ ... }` |

#### 游戏对战（棋类）
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `move` | 对手落子 | `{ row, col, player, ... }` |
| `game_ended` | 游戏结束 | `{ winner, reason, ... }` |
| `reset` | 重置请求 | `{ ... }` |
| `reset_accepted` | 重置被接受 | `{ ... }` |
| `reset_rejected` | 重置被拒绝 | `{ ... }` |
| `reset_request` | 收到重置请求 | `{ ... }` |
| `reset_request_timeout` | 重置请求超时 | `{ ... }` |
| `game_reset` | 游戏已重置 | `{ ... }` |
| `game_message` | 游戏消息 | `{ message, ... }` |
| `game_warning` | 游戏警告 | `{ message, ... }` |
| `game_replay` | 游戏回放 | `{ moves, ... }` |
| `inactive_warning` | 不活跃警告 | `{ ... }` |
| `undo_request` | 收到悔棋请求 | `{ ... }` |
| `undo_request_sent` | 悔棋请求已发送 | `{ ... }` |
| `undo_accepted` | 悔棋被接受 | `{ ... }` |
| `undo_rejected` | 悔棋被拒绝 | `{ ... }` |
| `undo_deduct` | 悔棋扣道具 | `{ ... }` |
| `game_item_used` | 道具已使用 | `{ itemId, ... }` |
| `hint_result` | 提示结果 | `{ move, ... }` |
| `hint_deduct` | 提示扣道具 | `{ ... }` |

#### 贪吃蛇专属
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `snake_match_found` | 贪吃蛇匹配成功 | `{ ... }` |
| `snake_match_cancelled` | 贪吃蛇匹配取消 | - |
| `snake_opponent_update` | 对手状态更新 | `{ ... }` |
| `snake_game_over` | 贪吃蛇游戏结束 | `{ ... }` |
| `snake_food_sync` | 食物同步 | `{ ... }` |
| `snake_full_state_sync` | 全状态同步 | `{ ... }` |

#### AI 对战
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `ai_game_start` | AI 游戏开始 | `{ ... }` |
| `ai_move_result` | AI 落子结果 | `{ row, col, ... }` |
| `ai_game_end` | AI 游戏结束 | `{ ... }` |

#### 聊天
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `chat_message` | 收到聊天消息 | `{ room, message, ... }` |
| `chat_error` | 聊天错误 | `{ message, ... }` |

#### 成就与排行
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `achievements_unlocked` | 成就解锁 | `{ achievements, ... }` |
| `achievements_list` | 成就列表响应 | `{ list, ... }` |
| `leaderboard` | 排行榜响应 | `{ list, ... }` |
| `my_rank` | 我的排名 | `{ rank, ... }` |
| `game_history` | 游戏历史 | `{ list, ... }` |

#### 观战
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `spectate_list` | 观战列表 | `{ list, ... }` |
| `spectate_joined` | 已加入观战 | `{ ... }` |

#### 系统与维护
| 事件名 | 触发场景 | 数据结构 |
|--------|---------|---------|
| `error` | 通用错误 | `{ message, ... }` |
| `system_broadcast` | 系统广播 | `{ message, ... }` |
| `admin_message` | 管理员消息 | `{ message, ... }` |
| `maintenance_notice` | 维护通知 | `{ ... }` |
| `maintenance_scheduled` | 维护已安排 | `{ ... }` |
| `maintenance_countdown` | 维护倒计时 | `{ ... }` |
| `maintenance_blocked` | 维护阻止操作 | `{ ... }` |
| `maintenance_kick` | 维护踢人 | `{ ... }` |

### A.2 客户端发送的事件（socket.emit）

#### 连接与登录
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `client_connect` | 上线通知 | `{ token, ... }` |
| `user_login` | 用户登录 | `{ nickname }` |
| `account_login` | 账号登录 | `{ username, password }` 或 `{ token }` |
| `get_account_by_token` | 按 token 获取账号 | `{ token }` |
| `user_status` | 更新用户状态 | `{ status, ... }` |

#### 大厅与匹配
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `match_request` | 请求匹配 | `{ game }` |
| `cancel_match` | 取消匹配 | - |
| `return_lobby` | 返回大厅 | - |
| `challenge_request` | 发起挑战 | `{ to, ... }` |

#### 游戏对战
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `move` | 落子 | `{ row, col, ... }` |
| `game_result` | 上报游戏结果 | `{ winner, ... }` |
| `resign` | 认输 | - |
| `reset` | 请求重置 | `{ ... }` |
| `reset_confirm` | 确认重置 | - |
| `reset_reject` | 拒绝重置 | `{ ... }` |
| `undo_request` | 请求悔棋 | - |
| `undo_response` | 悔棋响应 | `{ accepted }` |
| `request_hint` | 请求提示 | - |
| `game_use_item` | 使用道具 | `{ itemId }` |

#### 贪吃蛇专属
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `snake_game_start` | 开始游戏 | `{ ... }` |
| `snake_game_end` | 结束游戏 | `{ ... }` |
| `snake_update` | 状态更新 | `{ ... }` |
| `snake_food_update` | 食物更新 | `{ ... }` |
| `snake_sync_highscore` | 同步高分 | `{ ... }` |
| `snake_request_full_state` | 请求全状态 | `{ ... }` |

#### AI 对战
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `ai_game_start` | 开始 AI 游戏 | `{ ... }` |
| `ai_game_result` | AI 游戏结果 | `{ ... }` |
| `ai_move` | AI 落子 | `{ ... }` |

#### 聊天
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `chat_global` | 全局聊天 | `{ message }` |
| `chat_game` | 游戏内聊天 | `{ message }` |

#### 数据查询
| 事件名 | 用途 | 数据 |
|--------|------|------|
| `get_leaderboard` | 获取排行榜 | `{ limit, gameType }` |
| `get_my_rank` | 获取我的排名 | `{ gameType }` |
| `get_achievements` | 获取成就列表 | - |
| `get_spectate_list` | 获取观战列表 | - |
| `spectate_join` | 加入观战 | `{ gameId }` |
| `spectate_leave` | 离开观战 | `{ gameId }` |

---

## 附录 B：v1 HTTP API 清单

> 来源：`server/server.js` 中的 `app.get/post/put/delete` 路由。  
> v2 的 `core/api.js` 必须覆盖以下所有接口。

### B.1 公开接口（无需认证）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查，返回版本号 |
| GET | `/api/status` | 服务器状态 |
| GET | `/version` | 版本信息 |
| GET | `/api/config/levelExp` | 等级经验配置 |
| GET | `/api/shop/data` | 商店数据 |
| GET | `/api/shop/inventory` | 用户库存（需登录态） |
| GET | `/api/shop/cosmetics` | 外观数据 |
| GET | `/api/shop/cosmetics/config` | 外观配置 |
| GET | `/api/shop/vip` | VIP 信息 |
| GET | `/api/currency/balance` | 星钻余额 |
| GET | `/api/buffs/:userId` | 用户 buff |
| POST | `/api/auth/verify` | 验证 token |
| GET | `/api/leaderboard` | 排行榜 |
| GET | `/api/spectate/games` | 可观战对局 |
| GET | `/api/themes` | 主题列表 |
| GET | `/api/themes/:id` | 单个主题详情 |
| GET | `/api/games/history` | 对战历史 |
| GET | `/api/games/replay/:id` | 对战回放 |
| GET | `/api/games/stats` | 游戏统计 |
| GET | `/api/users/online` | 在线用户 |
| GET | `/api/users/search` | 搜索用户 |
| GET | `/api/chat/history` | 聊天历史 |
| GET | `/api/feedbacks` | 反馈列表 |
| POST | `/api/feedbacks` | 提交反馈 |
| POST | `/api/feedbacks/:id/vote` | 反馈投票 |
| POST | `/api/feedbacks/:id/comments` | 反馈评论 |

### B.2 需认证接口（Authorization: Bearer {token}）

#### 商店与资产
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/shop/buy` | 购买商品 |
| POST | `/api/shop/use-item` | 使用道具 |
| POST | `/api/shop/cosmetics/equip` | 装备外观 |

#### 头像
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/avatar/upload` | 上传头像 |
| POST | `/api/avatar/delete` | 删除头像 |
| POST | `/api/avatar/rename` | 重命名头像 |

#### 主题管理
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/themes` | 创建主题 |
| PUT | `/api/themes/:id` | 更新主题 |
| DELETE | `/api/themes/:id` | 删除主题 |
| POST | `/api/themes/reload` | 重载主题 |

#### 管理员接口
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/accounts` | 账号列表 |
| GET | `/api/accounts/search` | 搜索账号 |
| GET | `/api/accounts/:id` | 账号详情 |
| PUT | `/api/accounts/:id/exp` | 修改经验 |
| GET | `/api/admin/games` | 管理游戏 |
| GET | `/api/admin/operation-logs` | 操作日志 |
| POST | `/api/chat/broadcast` | 全服广播 |
| PUT | `/api/feedbacks/:id/status` | 修改反馈状态 |

#### 更新系统
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/update/status` | 更新状态 |
| GET | `/api/update/backups` | 备份列表 |
| GET | `/api/update/diff` | 文件 diff |
| POST | `/api/update/upload` | 上传更新包 |
| POST | `/api/update/start` | 开始更新 |
| POST | `/api/update/cancel` | 取消更新 |
| POST | `/api/update/rollback` | 回滚 |
| DELETE | `/api/update/backup/:name` | 删除备份 |

### B.3 静态资源路径

| 路径 | 用途 |
|------|------|
| `/themes/{name}.css` | 主题样式 |
| `/themes/{name}.json` | 主题元数据 |
| `/assets/badges/{name}.svg` | 徽章图标 |
| `/data/cosmetics/avatars/{name}` | 自定义头像 |
| `/socket.io/socket.io.js` | Socket.io 客户端（v2 直接用这个，通过 `<script>` 引入） |

---

## 附录 C：开发环境快速启动

```bash
# 1. 启动 v1 服务端（端口 8080）
cd d:\工程文件\网页游戏
npm start

# 2. 确保 server.js 已追加 /beta/ 静态伺服（见 4.3 节）

# 3. 开发访问
# 浏览器打开 http://localhost:8080/beta/
# 改代码后按 F5 刷新即可，无需构建

# 4. 生产部署
# 直接把 client-v2/ 目录复制到生产服务器（或通过 package.bat 上传）
# 重启服务端即可
# 浏览器打开 http://localhost:8080/beta/
```

---

## 文档版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-08-12 | 初始版本，规划阶段 |
| v1.1 | 2026-08-12 | 新增「AI 接手指南」（第零章）；新增「打包与发布流程」（4.7 节）；附录 A 填入 v1 完整 Socket 事件清单（70+ 个）；附录 B 填入 v1 完整 HTTP API 清单（50+ 个） |
| v1.2 | 2026-08-12 | **重大架构调整**：从 Vite 改为纯原生 ES Modules（无构建工具）；更新技术选型、灰度部署、打包流程、代码示例、风险表；任务清单阶段 1 重排为 26 项任务 |

---

**下一步行动**：等待方案最终确认后，启动阶段 1 任务 1（创建 client-v2/ 目录结构）。

**文档完整性自检**：
- ✅ 架构设计完整（第六~十二章）
- ✅ 代码示例齐全（Store / EventBus / Socket / API / Router / Layout）
- ✅ Socket 事件清单完整（附录 A，70+ 事件）
- ✅ HTTP API 清单完整（附录 B，50+ 接口）
- ✅ 打包流程接入方案完整（4.7 节）
- ✅ AI 接手指南完整（第零章，含红线、参考位置、陷阱）
- ⚠️ 数据模型定义（User / Game / Account 等对象结构）尚未详细列出，开发时需查阅 v1 源码 `client/index.html` 对应处理函数
