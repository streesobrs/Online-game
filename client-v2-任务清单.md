# v2 客户端任务清单

> **配套文档**：[client-v2-开发文档.md](./client-v2-开发文档.md)  
> **创建日期**：2026-08-12  
> **总任务数**：68 项（5 个阶段）

---

## 工作流说明

### 任务状态图例

| 标记 | 含义 | 操作者 |
|------|------|--------|
| `[ ]` | 未开始 / 待修复 | 默认状态 |
| `[x]` | AI 已完成，**待用户验证** | AI 修改 |
| `[x] ✅ 已验证` | 用户验证通过 | 用户追加「✅ 已验证」 |

### 执行规则

1. **顺序执行**：AI 按任务编号顺序执行，**一次只做一个任务**
2. **AI 完成后**：
   - 将 `[ ]` 改为 `[x]`
   - 在任务下方「**完成说明**」处填写：做了什么、改了哪些文件、如何验证
   - 停下来等用户验证
3. **用户验证**：
   - **通过**：在任务后追加 `✅ 已验证` 字样
   - **不通过**：将 `[x]` 改回 `[ ]`，在「**完成说明**」下方追加「**问题反馈**」描述问题
4. **AI 修复**：看到 `[ ]` + 问题反馈后，修复并重新标记 `[x]`，循环直到通过
5. **阶段门槛**：一个阶段所有任务都 `✅ 已验证` 后，才能进入下一阶段
6. **依赖关系**：任务标注「依赖：X.X.X」，必须等依赖任务 `✅ 已验证` 后才能开始

### 验证模板

AI 完成任务时填写：
```
**完成说明**：
- 修改文件：xxx.js、xxx.css
- 实现内容：简述
- 自测方式：如何验证（如访问 xxx URL、执行 xxx 命令）
```

用户验证后填写：
```
✅ 已验证（2026-08-12）
```
或
```
**问题反馈**：
- 问题描述：xxx
- 期望行为：xxx
```

---

## 进度总览

| 阶段 | 任务数 | 完成 | 已验证 | 状态 |
|------|--------|------|--------|------|
| 阶段 1：骨架搭建 | 26 | 26 | 26 | ✅ 已完成 |
| 阶段 2：五子棋迁移 | 12 | 12 | 12 | ✅ 已完成 |
| 阶段 3：其余游戏迁移 | 12 | 0 | 0 | 未开始 |
| 阶段 4：功能模块迁移 | 17 | 0 | 0 | 未开始 |
| 阶段 5：打磨上线 | 6 | 0 | 0 | 未开始 |
| **合计** | **73** | **38** | **38** | — |

---

## 阶段 1：骨架搭建 [26/26] ✅

> **目标**：v2 可访问、能登录、能匹配、能进空棋盘  
> **验收标准**：访问 `http://server:8080/beta/` 看到 v2 界面，能用 v1 账号登录  
> **架构说明**：纯原生 ES Modules，无构建工具，无 npm 依赖，改完源码刷新即生效

### 1.1 项目脚手架（能跑空页面） [4/4]

- [x] **1.1.1** 创建 client-v2/ 目录结构
  - 依赖：无
  - 验证：`src/core/`、`src/data/`、`src/layouts/`、`src/games/`、`src/features/`、`src/components/`、`src/utils/`、`src/styles/`、`vendor/` 目录存在
  - **完成说明**：
    - 修改文件：无（纯目录创建）
    - 实现内容：按开发文档第五章目录结构创建 `client-v2/` 完整目录骨架，共 24 个目录：
      - `client-v2/themes/`、`client-v2/vendor/`
      - `client-v2/src/core/`（eventBus/store/socket/api/router/auth 将放这里）
      - `client-v2/src/data/`（navItems/games/shortcuts 元数据）
      - `client-v2/src/layouts/`（registry/topnav/hub/dock）
      - `client-v2/src/games/`（gobang、go、chinese-chess、snake 四个游戏）
      - `client-v2/src/features/`（lobby、chat、achievements、leaderboard、ai-battle、spectate、shop、profile、themes 九个功能）
      - `client-v2/src/components/`、`client-v2/src/utils/`、`client-v2/src/styles/`
    - 自测方式：已执行 `Get-ChildItem -Path client-v2 -Recurse -Directory` 验证，24 个目录全部存在且层级正确，与开发文档第五章结构一致

✅ 已验证（2026-08-13）

- [x] **1.1.2** 创建 index.html 入口
  - 依赖：1.1.1
  - 验证：
    - `<script src="/socket.io/socket.io.js">` 引入 socket.io（用 v1 服务端自带）
    - `<script type="module" src="./src/main.js">` 引入应用入口
    - `<link>` 引入基础 CSS
    - `<div id="app">` 挂载点存在
  - **完成说明**：
    - 修改文件：client-v2/index.html
    - 实现内容：创建 v2 入口 HTML，包含：
      - `<script src="/socket.io/socket.io.js">` 全局引入 socket.io（绝对路径，服务端自带，挂到 window.io）
      - `<script type="module" src="./src/main.js">` 应用入口（相对路径）
      - 3 个 `<link>` 引入基础 CSS（variables/base/common，相对路径）
      - `<div id="app">` 挂载点
      - `<link id="theme-style">` 主题占位（空 href，运行时由主题模块填充，避免静态引用 v1 服务端不存在的 /themes/default.css 产生 404）
    - 自测方式：浏览器打开 `client-v2/index.html` 检查上述标签存在；控制台 socket.io 已全局加载（main.js 尚未创建，属预期）

✅ 已验证（2026-08-13）

- [x] **1.1.3** 创建 src/main.js 骨架
  - 依赖：1.1.2
  - 验证：main.js 能被浏览器加载（控制台看到 `console.log` 输出，无报错）
  - **完成说明**：
    - 修改文件：client-v2/src/main.js；client-v2/src/styles/variables.css、base.css、common.css
    - 实现内容：
      - main.js 骨架：控制台输出 `[v2] main.js 已加载`，并校验 `#app` 挂载点；不 import 任何模块（完整初始化在任务 1.8.1 整合）
      - 为满足「控制台无报错」，index.html 已引用的 3 个基础 CSS 先行创建最小占位（完整样式由任务 1.5.1 实现）
    - 自测方式：浏览器打开 `/beta/`，控制台看到 `[v2] main.js 已加载` 且无报错

✅ 已验证（2026-08-13）

- [x] **1.1.4** 验证：服务端追加 /beta/ 静态伺服后能访问
  - 依赖：1.1.3
  - 验证：访问 `http://localhost:8080/beta/` 看到空白页面，控制台无报错
  - **完成说明**：
    - 修改文件：server/server.js（红线允许的纯追加）
    - 实现内容：在现有静态伺服配置后追加 2 行：
      - `app.use('/beta', express.static(path.join(__dirname, '..', 'client-v2')));`
      - `app.use('/preview', express.static(path.join(__dirname, '..', 'client-v2')));`
      - 不影响 v1 任何路由；v1 未改动
    - 自测方式：`npm start`（或 `start.bat`）启动服务端后访问 `http://localhost:8080/beta/` 与 `/preview/`，均能看到 v2 空白页面、控制台无报错。注意：AI 终端沙箱无法监听端口（ENOTSOCK），需在用户自己的终端启动服务端

✅ 已验证（2026-08-13）

### 1.2 调试基础设施（先有 toast 才好排错） [5/5]

- [x] **1.2.1** 实现 core/eventBus.js（事件总线）
  - 依赖：1.1.3
  - 验证：`eventBus.on('test', fn)` + `eventBus.emit('test', data)` 能触发回调
  - **完成说明**：
    - 修改文件：client-v2/src/core/eventBus.js
    - 实现内容：实现 `class EventBus` 并导出全局唯一实例 `eventBus`，提供：
      - `on(event, fn)`：订阅，返回取消订阅函数
      - `off(event, fn)`：取消订阅
      - `emit(event, data)`：触发，单个处理器异常不影响其他处理器（try/catch 包裹）
      - `once(event, fn)`：一次性订阅
      - `removeAll(event)`：清空某事件监听器
    - 自测方式：浏览器控制台执行 `eventBus.on('test', d => console.log(d)); eventBus.emit('test', 'hello')` 应输出 `hello`

✅ 已验证（2026-08-13）

- [x] **1.2.2** 实现 core/store.js（状态管理）
  - 依赖：1.2.1
  - 验证：`store.set('key', val)` + `store.subscribe('key', fn)` 能触发订阅；取消订阅后不再触发
  - **完成说明**：
    - 修改文件：client-v2/src/core/store.js
    - 实现内容：实现 `class Store` 并导出全局唯一实例 `store`，参照开发文档第八章实现：
      - 状态：user/token、socketConnected、currentView/currentGame/currentLayout、matching/currentRoom、onlineCount/onlinePlayers、activeGames、currentTheme
      - `get(key)`、`set(key, value)`（相同值不触发）、`patch({k:v})` 批量更新
      - `subscribe(key, fn)`：订阅立即回调一次当前值，返回取消订阅函数
    - 自测方式：控制台执行 `const off = store.subscribe('currentView', v => console.log('view:', v)); store.set('currentView', 'gobang'); off(); store.set('currentView', 'snake')`，应只输出 `view: lobby` 和 `view: gobang`

✅ 已验证（2026-08-13）

- [x] **1.2.3** 实现 utils/dom.js（DOM 辅助函数）
  - 依赖：1.1.3
  - 验证：提供 `el(tag, props, children)`、`$`、`$$` 等辅助函数，方便后续创建 DOM
  - **完成说明**：
    - 修改文件：client-v2/src/utils/dom.js
    - 实现内容：
      - `el(tag, props, ...children)`：创建元素，props 支持 className、style 对象、html、`on*` 事件绑定、普通属性；children 支持字符串/数字/Node/嵌套数组（自动 flat 展开）
      - `$(selector, root=document)`：querySelector 包装
      - `$$(selector, root=document)`：querySelectorAll 包装，返回数组
    - 自测方式：控制台执行 `document.body.append(el('button', { class: 'test-btn', onClick: () => alert('ok') }, '按钮'))`，页面出现按钮且点击弹出 ok

✅ 已验证（2026-08-13）

- [x] **1.2.4** 实现 components/toast.js（提示组件）
  - 依赖：1.2.3
  - 验证：`toast.success('test')`、`toast.error('test')` 能在页面右上角显示提示，3 秒后自动消失
  - **完成说明**：
    - 修改文件：client-v2/src/components/toast.js
    - 实现内容：导出 `toast` 对象，提供 `success/error/info/show(message, type, duration)`：
      - 固定右上角容器，默认 3 秒自动消失（带淡入/滑入过渡）
      - 样式自包含：首次调用时注入 `<style>`，不依赖外部样式表（后续可迁移至 common.css）
    - 自测方式：控制台执行 `toast.success('测试成功')`、`toast.error('测试失败')`，右上角出现绿色/红色提示且 3 秒后消失

✅ 已验证（2026-08-13）

- [x] **1.2.5** 实现 components/modal.js（模态框）
  - 依赖：1.2.3
  - 验证：`modal.show({ title, content, onConfirm })` 能显示模态框，点击确认/取消能回调
  - **完成说明**：
    - 修改文件：client-v2/src/components/modal.js
    - 实现内容：导出 `modal` 对象，提供 `show(options)` / `close()`：
      - 支持 title、content（字符串或 DOM 节点）、onConfirm/onCancel 回调、confirmText/cancelText、showCancel
      - 取消途径：取消按钮、右上角 ×、点击遮罩；同一时刻仅一个模态框
      - 样式自包含：首次调用时注入 `<style>`（含遮罩淡入、弹窗 pop 动画），不依赖外部样式表
    - 自测方式：控制台执行 `modal.show({ title: '测试', content: '这是内容', onConfirm: () => console.log('确认'), onCancel: () => console.log('取消') })`，点击确定/取消/遮罩均能触发对应回调

✅ 已验证（2026-08-13）

### 1.3 网络通信层 [3/3]

- [x] **1.3.1** 实现 core/api.js（HTTP API 封装）
  - 依赖：1.2.4
  - 验证：`api.get('/health')` 能返回 v1 服务端版本号；`api.post(...)` 带 token 自动注入
  - **完成说明**：
    - 修改文件：client-v2/src/core/api.js
    - 实现内容：实现 `request()` 基础封装 + `api` 对象：
      - `get/post/put/delete` 方法；自动从 store 读 token 注入 `Authorization: Bearer {token}`
      - 网络异常 toast 提示；HTTP 非 2xx 时解析服务端 message 抛出
      - 业务封装（按附录 B，后续按需补全）：auth.verify、shop、leaderboard、themes、users、chat、games、spectate、feedback
      - 注：v1 登录/注册走 Socket（HTTP 仅 /api/auth/verify），已核实 server.js 无 /api/auth/login 路由
    - 自测方式：控制台执行 `await api.get('/health')` 返回 `{ status:'ok', version:'1.6.x' }`；`await api.get('/api/themes')` 返回 3 个主题

✅ 已验证（2026-08-13）

- [x] **1.3.2** 实现 core/socket.js（Socket.io 封装）
  - 依赖：1.2.1、1.2.2
  - 验证：
    - 用 `window.io`（来自 `/socket.io/socket.io.js`）连接服务端
    - 控制台看到 `connect` 事件
    - 断网/重连能正确触发 store 更新
    - 封装事件分发：socket.on → eventBus.emit（业务模块不直接接触 socket）
  - **完成说明**：
    - 修改文件：client-v2/src/core/socket.js
    - 实现内容：
      - 连接配置与 v1 完全一致（transports/autoConnect/reconnection/attempts/delay/timeout），不传 token 到 query（token 通过 client_connect 事件发送，符合 v1 协议）
      - 连接状态（connect/disconnect/reconnect/reconnect_attempt/reconnect_failed）更新 store.socketConnected 并转发 eventBus
      - 按附录 A 建立完整 EVENT_MAP（70+ 事件，socket.on → eventBus.emit），命名空间为 user:*/lobby:*/game:*/snake:*/ai:*/chat:*/achievement:*/leaderboard:*/spectate:*/system:*
      - 导出 `emit(event, data)` 统一发送（未连接时告警丢弃）
    - 自测方式：F5 刷新 `/beta/`，控制台看到 `[Socket] 已连接`；执行 `store.get('socketConnected')` 返回 true；执行 `socket.emit('get_leaderboard', { limit: 5, gameType: 'all' })` 后 `eventBus.on('leaderboard:update', d => console.log(d))` 能收到数据

✅ 已验证（2026-08-13）

- [x] **1.3.3** 实现 core/auth.js（登录态管理）
  - 依赖：1.3.1、1.3.2
  - 验证：能持久化 token 到 localStorage（key 与 v1 一致）；v1 和 v2 切换浏览器 tab 时登录态共享
  - **完成说明**：
    - 修改文件：client-v2/src/core/auth.js、client-v2/src/main.js
    - 实现内容：
      - localStorage key 与 v1 完全一致：`userToken` / `currentAccountId` / `nickname` / `loginStatus`（已核实 v1 源码）
      - `initAuth()`：恢复 token 到 store；订阅 login_result / account_info；socket 连接后自动 `get_account_by_token`
      - `login(用户名,密码)` → account_login；`guestLogin()` → guest_login；`register()` → account_register；`logout()` → 清除登录态（与 v1 clearAccount 一致）
      - 登录成功统一处理：保存 token、规范化账号数据结构（兼容 v1 两种结构）、发 user_login
      - main.js 挂载 `window.auth` 并调用 `initAuth()`（调试辅助，正式整合见 1.8.1）
    - 自测方式：v1 已登录时刷新 `/beta/`，控制台 `store.get('user')` 自动恢复账号；未登录时执行 `auth.login('用户名','密码')`，login_result 触发后 `localStorage.getItem('userToken')` 有值

✅ 已验证（2026-08-13）

### 1.4 元数据与路由 [3/3]

- [x] **1.4.1** 实现 data/navItems.js（导航元数据）
  - 依赖：1.1.3
  - 验证：导出 `NAV_ITEMS`、`GAMES`、`FEATURES`；包含 4 个游戏 + 6 个功能
  - **完成说明**：
    - 修改文件：client-v2/src/data/navItems.js
    - 实现内容：按开发文档 7.2 完整实现 NAV_ITEMS 元数据（10 项）：
      - 4 个游戏：gobang/go/chinese-chess/snake，含 icon、shortcut（1/2/3/4）、order、boardSize（五子棋 15、围棋 19、象棋 {rows:10,cols:9}）
      - 6 个功能：achievements/leaderboard/ai-battle/spectate/themes/shortcuts，含 category（辅助/对战/设置）、shortcut（A/L/G/V/T/K）
      - 导出派生集合 GAMES、FEATURES（按 order 排序）和 findItem(id)
    - 自测方式：控制台执行 `navItems.GAMES.length`（4）、`navItems.FEATURES.length`（6）、`navItems.findItem('gobang').shortcut`（'1'）

✅ 已验证（2026-08-13）

- [x] **1.4.2** 实现 core/router.js（Hash 路由）
  - 依赖：1.2.2
  - 验证：URL 输入 `#/gobang` 能触发路由变化，`store.currentView` 更新为 'gobang'
  - **完成说明**：
    - 修改文件：client-v2/src/core/router.js
    - 实现内容：按开发文档 11.2 实现：
      - ROUTES Map + registerRoute(id, handler)；DEFAULT_ROUTE = 'lobby'
      - go(id)：校验 id 在 NAV_ITEMS 或为 lobby，写 `#/` 或 `#/id`
      - handleHashChange：更新 store.currentView → 调用 handler（未注册时 console.warn）→ emit 'route:change'
      - isActive(id)、handleNavClick(id)；initRouter() 无 hash 时置 '#/'，否则立即处理
      - main.js 已调用 initRouter()
    - 自测方式：控制台执行 `registerRoute('gobang', () => console.log('进入五子棋'))` 后输入 URL `#/gobang`，控制台输出"进入五子棋"且 `store.get('currentView')` 为 'gobang'

✅ 已验证（2026-08-13）

- [x] **1.4.3** 实现 utils/shortcut.js（快捷键注册器）
  - 依赖：1.4.1、1.4.2
  - 验证：按 `1`/`2`/`3`/`4` 能触发对应游戏路由切换
  - **完成说明**：
    - 修改文件：client-v2/src/utils/shortcut.js
    - 实现内容：
      - 从 NAV_ITEMS 的 shortcut 字段自动派生键位映射（元数据驱动，新增导航项无需改代码）
      - initShortcuts() 注册 window keydown 监听；输入框（input/textarea/select/contentEditable）和 ctrl/meta/alt 组合键不触发
      - 按键命中时 e.preventDefault() + go(id)
      - main.js 已调用 initShortcuts()
    - 自测方式：按键盘 1/2/3/4 分别切换，URL hash 变为 `#/gobang`、`#/go`、`#/chinese-chess`、`#/snake`；在输入框内按键不触发

✅ 已验证（2026-08-13）

### 1.5 样式与主题 [3/3]

- [x] **1.5.1** 实现 styles/variables.css + base.css + common.css
  - 依赖：1.1.2
  - 验证：页面有基础样式（背景色、字体），CSS 变量可生效
  - **完成说明**：
    - 修改文件：client-v2/src/styles/variables.css、base.css、common.css
    - 实现内容：
      - variables.css：完整复刻 v1 内嵌 :root 的 `--theme-*` 变量体系（全局/大厅/棋盘/棋子/导航/按钮/面板/聊天/蛇/Toast/登录/排行榜等全部变量），保证 v1 主题 CSS（body[data-theme] 覆盖同名变量）可直接复用
      - base.css：全局重置 + body 基础样式（字体 PingFang SC/Microsoft Yahei、背景 var(--theme-bg)、交互元素过渡、滚动条），与 v1 一致
      - common.css：通用组件类（.btn 系列 / .input / .panel / 文本辅助 / 布局辅助 / .theme-btn.active 高亮）
      - index.html 移除空 href 占位 link（主题 CSS 改由 features/themes 动态注入）
    - 自测方式：F5 刷新 `/beta/`，页面出现浅灰渐变背景；控制台 `getComputedStyle(document.body).background` 非空；`getComputedStyle(document.body).getPropertyValue('--theme-primary')` 为 `#007bff`

✅ 已验证（2026-08-13）

- [x] **1.5.2** 复制 v1 主题 CSS 到 client-v2/themes/
  - 依赖：1.1.1
  - 验证：`themes/cyberpunk.css`、`ocean.css`、`forest.css` 存在
  - **完成说明**：
    - 修改文件：client-v2/themes/{cyberpunk,ocean,forest}.css（从 server/config/themes/ 复制，服务端文件未动）
    - 实现内容：3 个主题 CSS 与 v1 完全一致（body[data-theme] 作用域覆盖 --theme-* 变量），v2 用本地相对路径加载
    - 自测方式：`client-v2/themes/` 下存在 3 个 css 文件；`themes/cyberpunk.css` 首行为注释、含 `body[data-theme="cyberpunk"]` 选择器

✅ 已验证（2026-08-13）

- [x] **1.5.3** 实现 features/themes/（主题切换功能）
  - 依赖：1.5.1、1.5.2
  - 验证：
    - 主题选择面板列出所有可用主题
    - 切换主题后页面样式立即变化
    - 刷新后保持选择（localStorage 持久化）
  - **完成说明**：
    - 修改文件：client-v2/src/features/themes/index.js、client-v2/src/main.js
    - 实现内容：机制与 v1 applyTheme 一致：
      - THEMES 列表：default（本地变量）+ cyberpunk/forest/ocean（./themes/xxx.css 相对路径）
      - `applyTheme(id)`：设置 body.dataset.theme → 动态加载主题 CSS（fetch + `<style id="theme-dynamic-css">`，按 cssUrl 缓存）→ 写 localStorage（key `selectedTheme` 与 v1 一致）
      - `initThemes()`：启动时应用 selectedTheme（v1/v2 共享主题选择）
      - `renderThemePanel(container)`：按钮式主题面板，当前主题高亮
      - main.js 挂载 `window.themes` 并调用 `initThemes()`
    - 自测方式：控制台 `themes.renderThemePanel(document.body)` 出现 4 个主题按钮；点击「赛博朋克」页面立即变紫黑且 `localStorage.getItem('selectedTheme')` 为 'cyberpunk'；F5 刷新后保持该主题；v1 页面主题选择同步（共享 key）

✅ 已验证（2026-08-13）

### 1.6 布局与导航 [2/2]

- [x] **1.6.1** 实现 layouts/registry.js（布局注册表）
  - 依赖：1.4.1
  - 验证：`switchLayout('topnav')` 能切换布局，localStorage 持久化
  - **完成说明**：
    - 修改文件：client-v2/src/layouts/registry.js
    - 实现内容：按开发文档第十章 10.2 实现：
      - LAYOUTS 注册表（topnav 已注册；hub/dock 留注释待后续任务）
      - getLayout(id)：未知 id 回退 topnav
      - switchLayout(id)：清理旧布局（cleanup + innerHTML 清空）→ 渲染新布局到 #nav-root（不存在则 #app）→ localStorage 持久化（key `nav-layout`）
    - 自测方式：F5 刷新 `/beta/` 出现顶部导航栏；控制台执行 `switchLayout('topnav')` 导航重渲染且 `localStorage.getItem('nav-layout')` 为 'topnav'

✅ 已验证（2026-08-13）

- [x] **1.6.2** 实现 layouts/topnav.js（顶部导航布局）
  - 依赖：1.6.1、1.4.2
  - 验证：导航栏显示 4 游戏 + 6 功能按钮；点击按钮能切换路由；active 状态正确
  - **完成说明**：
    - 修改文件：client-v2/src/layouts/topnav.js、client-v2/src/styles/common.css、client-v2/src/main.js
    - 实现内容：按开发文档第十章 10.3 实现（用 el() 构建，比文档模板字符串更安全）：
      - 导航栏：游戏组（GAMES 4 个）+ 分隔线 + 功能组（FEATURES 6 个），按钮含 icon/name/快捷键角标
      - 点击 → handleNavClick(id) 路由切换；store.subscribe('currentView') 同步 active 高亮
      - 返回 cleanup：取消订阅 + 销毁 DOM（事件监听随元素释放）
      - common.css 新增导航样式（.nav-layout/.nav-group/.nav-btn 系列，全部基于 --theme-nav-* 变量，主题可换肤）
      - main.js 挂载 `window.switchLayout` 并调用 `switchLayout(localStorage.getItem('nav-layout') || 'topnav')`
    - 自测方式：F5 刷新 `/beta/` 导航栏显示 4 游戏 + 6 功能按钮；点击「五子棋」URL hash 变 `#/gobang` 且该按钮高亮；按快捷键 3 高亮切到「象棋」（内容区暂无视图属预期，1.7 注册）

✅ 已验证（2026-08-13）

### 1.7 业务界面 [3/3]

- [x] **1.7.1** 实现 features/auth/login.js（登录界面）
  - 依赖：1.3.3、1.2.5
  - 验证：
    - 显示登录弹窗（用户名 + 密码输入框）
    - 登录成功后关闭弹窗，更新 store.user
    - 登录失败显示 toast 错误提示
    - 支持游客登录、账号登录两种模式
  - **完成说明**：
    - 修改文件：client-v2/src/features/auth/login.js
    - 实现内容：
      - `showLoginModal()`：modal 弹窗含用户名/密码输入框（回车可提交）、游客登录按钮、提示文案
      - `checkLogin()`：未登录弹窗并返回 false（供 1.8.1 自动登录检测使用）
      - `isLoggedIn()`：基于 store.user
      - store.subscribe('user')：登录成功后自动关闭弹窗（账号/游客均生效）
      - 登录协议复用 core/auth.js（account_login / guest_login）；失败 toast 由 auth.js loginResult 处理
    - 自测方式：控制台执行 `login.showLoginModal()` 出现登录弹窗；输入 v1 账号密码点「登 录」→ 弹窗自动关闭、`store.get('user')` 有值、`localStorage.getItem('userToken')` 已写入；输入错误密码 → 右上角红色错误提示

✅ 已验证（2026-08-13）

- [x] **1.7.2** 实现 features/lobby/（大厅匹配）
  - 依赖：1.3.2、1.6.2
  - 验证：能显示「开始匹配」按钮；点击后向服务端发送 `match_request`；能取消匹配
  - **完成说明**：
    - 修改文件：client-v2/src/features/lobby/index.js、client-v2/src/utils/dom.js、client-v2/index.html、client-v2/src/styles/common.css
    - 实现内容：
      - `renderLobby(container)`：游戏选择（4 游戏按钮，默认选中五子棋）+「开始匹配」/「取消匹配」+ 状态文案
      - 开始匹配：`emit('match_request', { game })`（协议与 v1 一致），切换等待态；取消：`emit('cancel_match')` 恢复
      - 匹配中禁止切换游戏；未连接/未登录时 toast 拦截
      - 订阅 lobby:matchSuccess / lobby:matchTimeout（基础提示，完整对战逻辑见阶段 2）；cleanup 时若匹配中自动发 cancel_match
      - 配套：dom.js 新增 `viewRoot()`（#view-root 内容容器）；index.html #app 内拆分为 nav-root + view-root；common.css 新增 #view-root/.btn-secondary/.lobby-game-btn.active 样式
    - 自测方式：F5 刷新 `/beta/` 默认显示大厅（匹配按钮）；选「贪吃蛇」点「开始匹配」→ 状态变"正在寻找贪吃蛇对手"，服务端收到 match_request（另一浏览器/v1 可匹配）；点「取消匹配」→ 状态恢复、发送 cancel_match

✅ 已验证（2026-08-13）

- [x] **1.7.3** 实现 games/gobang/ 空棋盘渲染
  - 依赖：1.6.2
  - 验证：点击「五子棋」导航，显示 15×15 空棋盘；棋盘视觉风格接近 v1
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/index.js、client-v2/src/styles/common.css
    - 实现内容：
      - `renderGobang(container)`：CSS grid 渲染 15×15 空棋盘（.gobang-board），背景用 --theme-board-gobang（木色，与 v1 一致）
      - 格子线用 ::before/::after 背景线实现（无 1px 双线）；hover 显示落子预览（.gobang-cell--preview），纯前端无落子逻辑
      - 返回 cleanup；main.js 已注册 'gobang' 路由
    - 自测方式：点击导航「五子棋」或按 1 → #view-root 出现 15×15 木色棋盘，鼠标悬停格子显示蓝色预览

✅ 已验证（2026-08-13）

### 1.8 应用整合与部署 [2/3]

- [x] **1.8.1** main.js 整合（初始化所有模块）
  - 依赖：1.2.1~1.2.5、1.3.1~1.3.3、1.4.1~1.4.3、1.5.3、1.6.2、1.7.1~1.7.3
  - 验证：
    - main.js 按正确顺序初始化：eventBus → store → socket → api → auth → router → shortcut → layout → 默认视图
    - 访问 `/beta/` 自动检测登录态，未登录显示登录弹窗
    - 登录后显示导航栏 + 默认大厅视图
  - **完成说明**：
    - 修改文件：client-v2/src/main.js、client-v2/src/features/auth/login.js
    - 实现内容：
      - main.js 完整整合，按顺序初始化：auth → themes → 路由注册 → initRouter → initShortcuts → switchLayout → login.initLoginCheck()
      - login.js 新增 `initLoginCheck()`：socket 连接后无 token → 直接弹登录框；有 token 但 account_info 失败（token 失效）→ 弹登录框；已登录（token 有效）→ 不弹窗
      - 有 token 自动登录：initAuth 恢复 token → socket connect → get_account_by_token → store.user 恢复
    - 自测方式：清除 localStorage 的 userToken 后 F5 刷新 `/beta/` → 自动弹出登录框；登录后关闭并显示导航栏 + 大厅；不清 token 刷新 → 不弹窗且 `store.get('user')` 自动恢复

- [x] **1.8.2** 服务端追加 /beta/ + /preview/ 静态伺服
  - 依赖：1.8.1
  - 验证：
    - 在 server.js 追加 2 行 `app.use('/beta', ...)` 和 `app.use('/preview', ...)`
    - 重启服务端后访问 `http://localhost:8080/beta/` 看到 v2
    - 访问 `http://localhost:8080/preview/` 同样看到 v2
  - **完成说明**：
    - 修改文件：server/server.js（已随任务 1.1.4 追加，本次仅核对）
    - 实现内容：server.js L113-114 已存在：
      - `app.use('/beta', express.static(path.join(__dirname, '..', 'client-v2')))`
      - `app.use('/preview', express.static(path.join(__dirname, '..', 'client-v2')))`
      - 属红线允许的 2 行静态伺服，未动服务端业务逻辑
    - 自测方式：**重启服务端**后访问 `http://localhost:8080/beta/` 和 `http://localhost:8080/preview/`，均显示 v2 界面

- [x] **1.8.3** 阶段 1 整体验证
  - 依赖：1.8.2
  - 验证：
    - [x] `/beta/` 和 `/preview/` 都能访问
    - [x] 能用 v1 账号登录
    - [x] 登录态与 v1 共享（同浏览器切 v1/v2 不用重新登录）
    - [x] 导航栏 4 游戏 + 6 功能按钮正常
    - [x] 点击五子棋能进空棋盘
    - [x] 能开始/取消匹配
    - [x] 主题切换可用（至少 default + 1 个 v1 主题）
    - [x] 快捷键 1/2/3/4 能切换游戏
  - **完成说明**：
    - 用户已逐项确认全部通过（2026-08-13）
    - 阶段 1 目标达成：v2 可访问、能登录、能匹配、能进空棋盘，登录态与 v1 共享

✅ 已验证（2026-08-13）

---

## 阶段 2：五子棋完整迁移 [12/12] ✅

> **目标**：v2 五子棋可联机对战，v2 玩家能和 v1 玩家对弈  
> **前置条件**：阶段 1 全部 ✅ 已验证 ✅

### 2.1 棋盘与渲染 [3/3]

- [x] **2.1.1** 实现 gobang/board.js（棋盘渲染与交互）
  - 依赖：1.7.3
  - 验证：鼠标点击棋盘交叉点能放置棋子；黑白子交替显示
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/board.js、client-v2/src/games/gobang/index.js
    - 实现内容：
      - `createBoard(container, options)`：渲染 19×19 棋盘（与 v1 一致，v1 五子棋为 19×19，非 15×15；1.7.3 的 15×15 空棋盘已由新实现替换）
      - 数据模型与 v1 一致：`board[r][c] = 0 空 / 1 黑 / 2 白`，黑棋先行
      - 点击落子：本地模式自动交替黑白；`onPlace` 回调可让外部接管（联机/AI 用）
      - 棋子 DOM 与 v1 一致：cell 内子元素 `div.gobang-black/.gobang-white`；落子动画/涟漪样式随 2.1.2
      - 返回 API：`board`/`turn`/`lastMove`/`place`/`reset`/`destroy`
      - index.js 改用 createBoard 渲染，并挂 `window.gobangBoard` 供控制台调试
    - 自测方式：F5 刷新 → 点导航「五子棋」→ 点击格子：黑棋落子，再点另一格白棋，依次交替；`gobangBoard.board` 可见 19×19 数组；`gobangBoard.place(3,3,1)` 可编程落子

- [x] **2.1.2** 实现 gobang/styles.css（专属样式）
  - 依赖：2.1.1
  - 验证：棋盘视觉与 v1 接近（线条、棋子样式、悬停高亮）
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/styles.css、client-v2/index.html、client-v2/src/styles/common.css
    - 实现内容：
      - 完整移植 v1 棋盘视觉：19×19 grid（cell 36px）、木色背景（--theme-board-gobang）、深色网格线（repeating-linear-gradient）、边框 4px #8b6914、棋盘光泽、棋子渐变立体样式（--theme-piece-gobang-black/white）、stoneDrop 落子动画、hover 高亮
      - 样式文件名与任务一致（styles.css），index.html 静态引入；common.css 中 15×15 旧棋盘样式已移除（迁移到 styles.css）
      - 已预留 .stone-preview（悬停预览棋子，2.1.3 使用）与 .last-move 脉动光圈样式
    - 自测方式：刷新后五子棋棋盘为 19×19 木色棋盘（36px 格、深色线、金棕色边框），落子时棋子带掉落动画，hover 格子有浅色高亮

✅ 已验证（2026-08-13）

- [x] **2.1.3** 实现最后落子高亮、悬停预览
  - 依赖：2.1.1
  - 验证：落子后该位置有高亮标记；鼠标悬停显示半透明预览棋子
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/board.js
    - 实现内容：
      - 最后落子高亮：`markLastMove(r, c)` 在最新落子格加 `.last-move` 类（蓝色脉动光圈，样式随 2.1.2 的 .last-move::before + gobang-pulse 动画），落新子时先清除旧高亮
      - 悬停预览：mouseenter → 空格子显示 `.stone-preview`（preview-black/preview-white 半透明棋子，颜色 = 当前 turn），mouseleave 移除
      - 落子后自动移除该格残留预览（updateCell）；reset 清空预览元素
    - 自测方式：刷新后点五子棋 → 鼠标悬停空格显示当前回合颜色半透明棋子；落子后该格有蓝色脉动光圈且只保留最后一手；已有棋子的格子悬停不显示预览

✅ 已验证（2026-08-13）

### 2.2 规则与判定 [3/3]

- [x] **2.2.1** 实现 gobang/rules.js（胜负判定）
  - 依赖：2.1.1
  - 验证：横、竖、斜、反斜四个方向五连判定正确；边界情况（封堵）正确
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/rules.js
    - 实现内容：
      - `checkWin(board, r, c, color, size)`：以最后一手为原点，四方向（[0,1] 横 / [1,0] 竖 / [1,1] 斜 / [1,-1] 反斜）正反延伸计数，≥5 即赢；逻辑与 v1 checkGobangWin 完全一致
      - `maxChain(board, r, c, color)`：最长连子数（对齐 v1 calculateGobangChain）
      - `countEmpty(board)`：剩余空位数
      - 说明：PvP 真正胜负由服务端判定（handleMove → checkGameOver → game_result），本模块用于本地即时反馈 / AI 模式判定 / 状态统计
    - 自测方式：控制台（进入 #/gobang 后）：
      ```js
      const { checkWin, maxChain } = await import('./src/games/gobang/rules.js');
      // 构造五连棋盘（竖线 (0,9)~(4,9) 均为黑 1）
      const b = new Array(19).fill(0).map(() => new Array(19).fill(0));
      for (let i = 0; i < 5; i++) b[i][9] = 1;
      checkWin(b, 4, 9, 1);  // true
      checkWin(b, 4, 8, 1);  // false（被堵/不在连线上）
      maxChain(b, 2, 9, 1);  // 5
      ```

- [x] **2.2.2** 实现禁手判定（如有，按 v1 逻辑）
  - 依赖：2.2.1
  - 验证：与 v1 行为一致（v1 是否实现禁手需查源码确认）
  - **完成说明**：
    - 修改文件：无（仅确认结论）
    - 查证结果：v1 客户端与服务端均**未实现**禁手判定。证据：
      - v1 规则文案（index.html L4666）：`禁止三三、四四、长连等禁手（本版本简化规则）`
      - v1 客户端 checkGobangWin：四方向 count ≥ 5 即赢（长连 >5 也算赢，无禁手拦截）
      - v1 服务端 GameManager.checkGobangWin（L2851-2874）：同样 count ≥ 5 判赢，无禁手逻辑；executeMove 不拦截
    - v2 按 v1 行为保持一致：不实现禁手，长连判赢。后续若需禁手属功能增强，不在本迁移范围

- [x] **2.2.3** 实现平局判定（棋盘满）
  - 依赖：2.2.1
  - 验证：棋盘填满后判定平局，触发 `game_result` 事件
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/rules.js
    - 实现内容：
      - `checkDraw(board, size)`：棋盘是否已填满（无空位）；`countEmpty` 统计空位数
      - 联机上报协议已确认：v1 服务端 handleGameResult 支持 `emit('game_result', { result: 'draw' })` → endGame('draw') 并广播 game_result 给双方（server.js L2793）
      - 平局触发点：本地判定平局 → 触发 eventBus `gobang:draw` → 对局模块（2.3.3）上报服务端并展示平局结果；19×19 棋盘几乎不会实际下满，属理论完备性处理
    - 自测方式：控制台：
      ```js
      const { checkDraw, countEmpty } = await import('./src/games/gobang/rules.js');
      const full = new Array(19).fill(0).map(() => new Array(19).fill(2));
      checkDraw(full);   // true
      countEmpty(full);  // 0
      const b2 = new Array(19).fill(0).map(() => new Array(19).fill(0));
      countEmpty(b2);    // 361
      ```

✅ 已验证（2026-08-13）

### 2.3 联机对战 [3/3]

- [x] **2.3.1** 实现联机落子同步（emit move + on move）
  - 依赖：2.2.1、1.7.2
  - 验证：v2 玩家 vs v1 玩家能正常对弈，双方落子实时同步
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js、client-v2/src/features/lobby/index.js、client-v2/src/games/gobang/index.js
    - 实现内容：
      - `startMatch(container, matchData)`：对局控制器，`createBoard` 以 onPlace 回调接管落子流程
      - 我方落子：校验轮到己方 → `board.place` → `socket.emit('move', { r, c, game: 'gobang' })`（协议与 v1 一致，服务端自行判定 color 并转发）
      - 对手落子：订阅 `game:move`（socket 'move' → eventBus）→ 校验位置/跳过自己 → `board.place(data.r, data.c, data.color)` → `board.turn = me`
      - 回合控制：`board.turn` 表示当前应落子方，黑先；本地 checkWin 仅做即时提示，正式结果以服务端 game_ended 为准
    - 自测方式：v2 与 v1（或两个 v2）匹配后对弈，双方落子实时同步、回合互斥（非己回合落子被拦截）

- [x] **2.3.2** 实现匹配成功后进入对局房间
  - 依赖：2.3.1
  - 验证：匹配成功后显示对手信息、先手方、计时器
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js、client-v2/src/features/lobby/index.js、client-v2/src/games/gobang/styles.css
    - 实现内容：
      - lobby 订阅 `lobby:matchSuccess`（match_success → { gameId, opponentId, color }）：写入 `store.pendingMatch` 并 `go('#/gobang')`
      - renderGobang 检测 pendingMatch → 以对局模式启动 startMatch，清空 pendingMatch
      - 对局信息栏（.gobang-match-info）：对手信息（👤 对手）、当前回合/先手方（我的回合·黑棋 / 对方回合·白棋，轮到己方高亮）、计时器（⏱ mm:ss，每秒刷新）、返回大厅按钮
      - gobang/styles.css 新增信息栏样式
    - 自测方式：匹配成功后自动进入对局界面，信息栏显示对手、先手方（黑先）、计时器开始走动

- [x] **2.3.3** 实现游戏结束流程（胜负展示、返回大厅）
  - 依赖：2.3.1
  - 验证：游戏结束显示胜利提示；点击返回大厅能正常回到大厅
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js
    - 实现内容：
      - 订阅 `game:ended`（game_ended → { gameId, result, winner, reason }）：按 result 展示结果文案（win/draw/resign/timeout），弹出 modal「游戏结束」+「返回大厅」按钮
      - 订阅 `lobby:opponentLeft`：对手认输/离开处理，同样弹出结果提示
      - 返回大厅：modal 确认 → `go('#/lobby')`；信息栏「返回大厅」按钮对局中二次确认（确认后 emit return_lobby）
      - 平局路径：2.2.3 的 checkDraw 供本地预判，联机终局统一以服务端 game_ended(result=draw) 为准（服务端 handleGameResult 支持客户端上报 draw）
    - 自测方式：对局五连后服务端广播 game_ended → 弹出「你获胜了/你输了」；点击「返回大厅」回到大厅；认输场景（v1 侧认输）v2 收到 opponent_left 提示

### 2.4 辅助功能 [3/3]

- [x] **2.4.1** 实现悔棋功能（undo_request / undo_response）
  - 依赖：2.3.1
  - 验证：v2 玩家能发起悔棋；v1 玩家发起悔棋时 v2 能收到提示
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js、client-v2/src/games/gobang/board.js
    - 实现内容：
      - 发起：信息栏「⏪ 悔棋」→ `emit('undo_request')` → 收到 `undo_request_sent`（game:undoRequestSent）提示等待对方
      - 响应：收到 `undo_request`（game:undoRequest，{ from, fromNickname }）→ modal 确认 → 同意 `emit('undo_response',{accepted:true})` / 拒绝 `{accepted:false}`
      - 结果：`undo_accepted`（game:undoAccepted）携带服务端完整棋盘数据 { board, currentPlayer, moveCount, gameType } → board.js 新增 `restore(board, currentPlayer)` 重建棋盘与回合（服务端 executeUndoMove 撤销双方最近两步）；`undo_rejected`（game:undoRejected）提示拒绝
      - 游戏结束后拦截悔棋请求
    - 自测方式：对局中我方点「悔棋」→ 对方弹确认框；同意后双方棋盘回退两步、回合正确；拒绝则提示「悔棋请求被拒绝」

✅ 已验证（2026-08-13）

- [x] **2.4.2** 实现认输功能（resign）
  - 依赖：2.3.1
  - 验证：点击认输后游戏结束，对手胜利
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js
    - 实现内容：
      - 信息栏「🏳️ 认输」→ modal 二次确认 → `emit('resign')`
      - 结束展示复用 2.3.3：认输方/对手分别收到 game_ended(result='resign') 或 opponent_left(result='resign')，弹窗显示「对方认输，你获胜了/你认输了」+ 返回大厅
    - 自测方式：对局中点「认输」确认 → 游戏结束弹窗「你认输了」，对方（v1）显示「对方认输，你获胜了」

  **问题反馈**：
  - 问题描述：v2 点认输后仅提示「已认输，等待结果…」，游戏不结束，对方无反应
  - 期望行为：认输后游戏结束，认输方/对方均收到结果
  - **AI 修复**：服务端（server.js）**没有** `socket.on('resign')` 监听，认输唯一途径是 `game_result {result:'resign'}`（与 v1 落子获胜上报 game_result 同机制）。已将 play.js 认输确认回调由 `emit('resign')` 改为 `emit('game_result', { result: 'resign', reason: '主动认输' })`，服务端 handleGameResult 校验通过后 endGame 广播 game_ended，v2 侧 game:ended 弹窗正常展示胜负

✅ 已验证（2026-08-13）

- [x] **2.4.3** 实现重置游戏（reset 系列）
  - 依赖：2.3.1
  - 验证：能发起重置请求；对方同意/拒绝后行为正确
  - **完成说明**：
    - 修改文件：client-v2/src/games/gobang/play.js
    - 实现内容：
      - 发起：信息栏「🔄 重置」→ modal 确认 → `emit('reset')`（v1 协议，resetGame(true) 同款，服务端转发 `reset_request` 给对方并设 30 秒超时）
      - 响应：收到 `reset_request`（game:resetRequest，含 message/requestId，兼容「再来一局」文案）→ modal → 同意 `emit('reset_confirm')` / 拒绝 `emit('reset_reject',{requestId})`
      - 结果：双方收到 `reset`（game:resetDone）→ board.reset() 重建空棋盘、回合黑先、计时归零；请求方另收 `reset_accepted`；拒绝 `reset_rejected`；超时 `reset_request_timeout`
    - 自测方式：对局中点「重置」→ 对方弹确认框；同意后双方棋盘清空重开；拒绝则提示「对方拒绝了重置请求」

  **问题反馈**：
  - 问题描述：v1 确认重置后，v2 棋盘未清空；v1 提示「错误，没有待处理的悔棋请求」
  - 期望行为：v1 确认后双方棋盘清空重开
  - **AI 修复**：
    - v2 棋盘未清空根因：服务端 handleResetConfirm 确认后广播的是 `reset` 事件（EVENT_MAP → `game:reset`），而 play.js 误监听 `game:resetDone`（对应 `game_reset`，是管理员强制重置专用事件），事件名不匹配导致无人处理。已改为监听 `game:reset` → board.reset() 重建空棋盘
    - v1 报「没有待处理的悔棋请求」是 v1 自身确认按钮事件冲突（showConfirmDialog 用 onclick 覆盖赋值 + DOMContentLoaded 用 addEventListener，同一点同意按钮同时触发残留的 undo_response 与 reset_confirm），属 v1 侧问题，红线不允许修改；服务端 reset_confirm 仍正常执行，v2 修复后功能不受影响

✅ 已验证（2026-08-13）

---

## 阶段 3：其余游戏迁移 [0/12]

> **目标**：v2 支持 4 个游戏全部可玩  
> **前置条件**：阶段 2 全部 ✅ 已验证

### 3.1 围棋 [0/4]

- [x] **3.1.1** 实现 go/board.js（19×19 棋盘渲染）
  - 依赖：阶段 2
  - 验证：19×19 棋盘正确显示，星位标记正确
  - **完成说明**：
    - 修改文件：client-v2/src/games/go/board.js（新建）、client-v2/src/games/go/styles.css（新建）、client-v2/src/games/go/index.js（新建）、client-v2/src/main.js、client-v2/index.html
    - 实现内容：
      - 尺寸说明：任务清单标题「19×19」为笔误，v1 客户端 `gameConfigs.go.size = 21` 且服务端 `initializeGoBoard` 为 21×21，联机尺寸必须与服务端一致，故实现为 **21×21**
      - board.js：仿 gobang/board.js 结构，提供 place/reset/restore/destroy、turn/lastMove、悬停预览；星位按 v1 `initGoBoard` 逻辑（3/9/15 行×3/9/15 列交叉点）；棋子 DOM 类名 go-black/go-white 与 v1 一致
      - styles.css：移植 v1 围棋视觉（21×21 grid、cell 34px、木色底+网格线、星位 8px、渐变立体棋子、落子动画、红色 last-move 光圈）
      - index.js：视图入口，本地模式渲染棋盘；对局模式 pendingMatch 暂提示「开发中」（3.1.3 接入）
      - main.js 注册 `go` 路由；index.html 引入 go/styles.css
    - 自测方式：访问 `/beta/#/go`，21×21 棋盘显示，3/9/15 交叉点有 9 个星位，点击交替落黑/白子，悬停有半透明预览

✅ 已验证（2026-08-13）
（视觉微调记录：网格线相位对齐 cell 中心、横线按反馈上移 14px、外圈经 padding 41px 整体内缩半格）

- [x] **3.1.2** 实现 go/rules.js（提子规则）
  - 依赖：3.1.1
  - 验证：包围对方棋子能正确提子；自杀手判定正确
  - **完成说明**：
    - 修改文件：client-v2/src/games/go/rules.js（新建）、client-v2/src/games/go/index.js（本地模式接入规则）
    - 实现内容：
      - rules.js 纯函数模块：getGroup（DFS 连通块）、hasLiberty（块是否有气）、capturedStones（收集无气块）、tryPlace（完整落子流程：落子 → 提对方无气块 → 自杀检查）、countEmpty（预留 3.1.4 数目判定）
      - 与 v1 逻辑一致：提子=整块无气全提；自杀=落子后己方块无气则禁止（v1 removeCapturedStones / hasGroupLiberty 同款）
      - 服务端 executeGoMove 只落子不提子，提子由客户端本地完成，故纯函数不可变设计（返回新棋盘 + captured）便于联机双方本地同步（3.1.3 复用）
      - index.js 本地模式接入 tryPlace：提子 toast 提示颗数、自杀位置提示无法落子
    - 自测方式：Node 运行 8 个断言用例全部通过（提单子/提整块/角部自杀/提对方获得气/占用位置不可落），已删除临时测试文件

✅ 已验证（2026-08-13）
（后续修复：本地模式由 restore 全量重绘改为 removeStone+place 增量更新，消除落子时所有棋子跳动）

- [x] **3.1.3** 实现围棋联机对战
  - 依赖：3.1.2
  - 验证：v2 vs v1 围棋对弈正常
  - **完成说明**：
    - 修改文件：client-v2/src/games/go/play.js（新建）、client-v2/src/games/go/index.js（对局模式接入 startMatch）、client-v2/src/games/go/styles.css（信息栏样式）
    - 实现内容：
      - play.js 联机控制器（仿 gobang/play.js）：信息栏（回合/对手/计时/认输/返回大厅）、落子同步、game:ended / lobby:opponentLeft 结束弹窗
      - 提子/自杀/打劫客户端本地处理：服务端 executeGoMove 只落子、checkGoWin 恒 false（与 v1 一致），本地用 tryPlace（落子+提对方+自杀检查）+ removeStone 增量渲染；打劫 isKo/koPosition/koColor 复刻 v1（上一手只提一子形成劫位，对方不能立即回提）
      - 终局判定复刻 v1 checkGoWin：棋盘填满 ≥95% 或双方均无合法手（hasValidMove 用 tryPlace 不可变探测）→ `game_result {result:'win', reason:'棋盘填满'}`
      - 认输与五子棋一致：`game_result {result:'resign'}`（服务端无 resign 事件）
      - index.js：pendingMatch 存在时 startMatch 启动联机对局（window.goMatch）
    - 自测方式：v1 大厅选「围棋」匹配 + v2 大厅选「围棋」匹配 → 双方对弈：落子同步、提子一致、自杀/打劫提示、认输或填满结束

✅ 已验证（2026-08-13）
（用户放行红线，顺带修复 v1 固有 bug：handleBoardMove 接收落子后补提子逻辑 removeCapturedStones(3-对方色)，使 v1 vs v1 / v2 vs v1 双方棋盘同步、提子显示一致）

- [x] **3.1.4** 实现数目/终局判定（按 v1 逻辑）
  - 依赖：3.1.2
  - 验证：与 v1 行为一致
  - **完成说明**：
    - 修改文件：client-v2/src/games/go/rules.js（countScore/getTerritory）、client-v2/src/games/go/play.js（finishGo 接入点目弹窗）
    - 实现内容：
      - rules.js 新增 `countScore(board, size, komi=7.5)`（复刻 v1 countGoScore）：黑分 = 子数 + 纯黑边界空域；白分 = 子数 + 纯白边界空域 + 贴目 7.5；`getTerritory` 复刻 v1 getGoTerritory（空域 BFS + 边界黑白标记，混合边界不计）
      - play.js `finishGo` 终局时调用 `showScoreModal` 本地点目弹窗（复刻 v1 showGameResult：胜者标题、黑白双卡[分数/子数/领地/贴目]、胜负差），同时仍发 `game_result` 由服务端结算；game:ended 弹窗与本地点目框不冲突（gameOver 守卫）
    - 自测方式：Node 运行 6 个断言用例全部通过（空棋盘贴目、环形黑领地、混合边界不计、贴目胜者判定），已删除临时测试文件；浏览器填满/无合法手终局后弹出数子结果框

### 3.2 中国象棋 [0/4]

- [ ] **3.2.1** 实现 chinese-chess/board.js（9×10 棋盘渲染）
  - 依赖：阶段 2
  - 验证：棋盘 9 列 10 行正确；楚河汉界显示
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.2.2** 实现 chinese-chess/rules.js（走子规则）
  - 依赖：3.2.1
  - 验证：车马炮相士帅兵卒走子规则正确；蹩马腿、塞象眼等限制正确
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.2.3** 实现象棋联机对战
  - 依赖：3.2.2
  - 验证：v2 vs v1 象棋对弈正常
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.2.4** 实现将军/将死判定
  - 依赖：3.2.2
  - 验证：将军提示正确；将死结束游戏
  - **完成说明**：
    <!-- AI 填写 -->

### 3.3 贪吃蛇 [0/4]

- [ ] **3.3.1** 实现 snake/board.js（游戏区域渲染）
  - 依赖：阶段 2
  - 验证：游戏区域显示；蛇身、食物正确渲染
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.3.2** 实现 snake 控制逻辑（方向键 + 虚拟按键）
  - 依赖：3.3.1
  - 验证：键盘方向键和虚拟按键都能控制蛇移动
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.3.3** 实现贪吃蛇联机对战
  - 依赖：3.3.2
  - 验证：v2 vs v1 贪吃蛇对战正常，食物同步、状态同步
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **3.3.4** 实现蛇死亡/游戏结束逻辑
  - 依赖：3.3.3
  - 验证：撞墙/撞自己判定正确；游戏结束流程正确
  - **完成说明**：
    <!-- AI 填写 -->

---

## 阶段 4：功能模块迁移 [0/17]

> **目标**：v2 功能对齐 v1  
> **前置条件**：阶段 3 全部 ✅ 已验证

### 4.1 聊天 [0/2]

- [ ] **4.1.1** 实现 features/chat/（全局聊天 + 游戏内聊天）
  - 依赖：阶段 3
  - 验证：能发送/接收消息；全局和游戏内聊天切换正确
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.1.2** 实现聊天历史加载、禁言提示
  - 依赖：4.1.1
  - 验证：进入大厅能加载最近聊天记录；被禁言时发送有提示
  - **完成说明**：
    <!-- AI 填写 -->

### 4.2 成就 [0/2]

- [ ] **4.2.1** 实现 features/achievements/（成就列表展示）
  - 依赖：阶段 3
  - 验证：成就页面正确显示所有成就；已解锁/未解锁状态正确
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.2.2** 实现成就解锁通知、分类筛选
  - 依赖：4.2.1
  - 验证：解锁成就时收到通知；按游戏分类筛选正常
  - **完成说明**：
    <!-- AI 填写 -->

### 4.3 排行榜 [0/2]

- [ ] **4.3.1** 实现 features/leaderboard/（排行榜展示）
  - 依赖：阶段 3
  - 验证：默认显示全游戏 Top 20；显示玩家名、等级、胜场等
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.3.2** 实现按游戏分类筛选、显示我的排名
  - 依赖：4.3.1
  - 验证：切换游戏类型排行榜更新；底部显示「我的排名」
  - **完成说明**：
    <!-- AI 填写 -->

### 4.4 AI 对战 [0/2]

- [ ] **4.4.1** 实现 features/ai-battle/（AI 对战入口）
  - 依赖：阶段 3
  - 验证：选择游戏 + 难度后能开始 AI 对战
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.4.2** 实现 AI 落子响应、对战结束流程
  - 依赖：4.4.1
  - 验证：AI 能正常落子；游戏结束后能返回 AI 对战入口
  - **完成说明**：
    <!-- AI 填写 -->

### 4.5 观战 [0/2]

- [ ] **4.5.1** 实现 features/spectate/（观战列表）
  - 依赖：阶段 3
  - 验证：显示当前可观战的对局列表
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.5.2** 实现加入观战、实时同步棋盘
  - 依赖：4.5.1
  - 验证：点击观战能进入对局；棋盘实时同步双方落子
  - **完成说明**：
    <!-- AI 填写 -->

### 4.6 商城 [0/3]

- [ ] **4.6.1** 实现 features/shop/（商品列表）
  - 依赖：阶段 3
  - 验证：显示道具、皮肤、VIP 等商品分类
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.6.2** 实现购买流程、星钻余额展示
  - 依赖：4.6.1
  - 验证：能购买商品；余额正确扣减；库存更新
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.6.3** 实现道具使用、外观装备
  - 依赖：4.6.2
  - 验证：能使用道具（双倍经验等）；能装备/卸下外观
  - **完成说明**：
    <!-- AI 填写 -->

### 4.7 个人资料 [0/2]

- [ ] **4.7.1** 实现 features/profile/（资料展示）
  - 依赖：阶段 3
  - 验证：显示用户名、等级、经验、胜场等基础信息
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.7.2** 实现头像管理、对战历史查看
  - 依赖：4.7.1
  - 验证：能上传/切换头像；能查看最近对战历史
  - **完成说明**：
    <!-- AI 填写 -->

### 4.8 主题切换 [0/2]

- [ ] **4.8.1** 实现 features/themes/（主题选择面板）
  - 依赖：阶段 3
  - 验证：主题面板列出所有可用主题；当前主题高亮
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **4.8.2** 实现主题切换、持久化
  - 依赖：4.8.1
  - 验证：切换主题后页面样式立即变化；刷新后保持选择
  - **完成说明**：
    <!-- AI 填写 -->

---

## 阶段 5：打磨上线 [0/6]

> **目标**：v2 可正式上线，性能不劣于 v1  
> **前置条件**：阶段 4 全部 ✅ 已验证

### 5.1 响应式适配 [0/2]

- [ ] **5.1.1** 移动端适配（768px 以下）
  - 依赖：阶段 4
  - 验证：手机浏览器访问布局正常；棋盘可触摸操作
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **5.1.2** 小屏手机适配（480px 以下）
  - 依赖：5.1.1
  - 验证：小屏手机布局不溢出；棋盘尺寸合适
  - **完成说明**：
    <!-- AI 填写 -->

### 5.2 性能优化 [0/2]

- [ ] **5.2.1** 首屏加载优化（代码分割、懒加载）
  - 依赖：阶段 4
  - 验证：首屏加载 < 3 秒；非首屏游戏按需加载
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **5.2.2** 棋盘渲染性能优化（如需用 Canvas）
  - 依赖：5.2.1
  - 验证：棋盘渲染 < 100ms；连续落子无卡顿
  - **完成说明**：
    <!-- AI 填写 -->

### 5.3 最终验收 [0/2]

- [ ] **5.3.1** v1/v2 交叉测试（所有游戏 + 所有功能）
  - 依赖：5.2.2
  - 验证：v2 玩家与 v1 玩家在所有游戏模式下均能正常对战
  - **完成说明**：
    <!-- AI 填写 -->

- [ ] **5.3.2** 文档同步、版本号更新、上线发布
  - 依赖：5.3.1
  - 验证：开发文档与最终代码一致；version.json 更新；package.bat 打包成功
  - **完成说明**：
    <!-- AI 填写 -->

---

## 变更记录

| 日期 | 变更内容 | 操作者 |
|------|---------|--------|
| 2026-08-12 | 初始版本，68 项任务 | - |

---

## 备注

- 本清单与 [client-v2-开发文档.md](./client-v2-开发文档.md) 配套使用
- 任务执行中如发现新需求或问题，可在对应任务下追加「**补充说明**」
- 阶段任务数可能在实际执行中调整（增减），调整时同步更新「进度总览」
