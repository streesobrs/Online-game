# 多棋种联机大厅

## 项目简介

多棋种联机大厅是一个基于 Node.js 和 Socket.io 的在线游戏服务器，支持多种棋类 / 益智游戏的实时联机对战，配套账号、商城、成就、社交、后台管理等完整系统。

**当前版本**：v1.6.1（Build 789）
**README 更新时间**：2026-10-10

## 功能特性

- **游戏**：五子棋、围棋、象棋、贪吃蛇、消消乐（含经典关卡与肉鸽玩法）
- **实时对战**：在线联机、AI 对战、好友挑战、观战系统、断线重连、对局活跃续期
- **账号系统**：注册/登录、游客登录、VIP 会员、账号等级与经验、隐私设置、倍率日历（节假日经验加成）
- **外观系统**：自定义头像、头像框、GIF 头像压缩、界面自定义
- **经济系统**：商城、动态价格商店、经验道具、背包礼包、精华养成（消消乐肉鸽）
- **社交功能**：聊天、好友系统、邮件、用户反馈（投票/评论/楼中楼）
- **成就系统**：成就徽章、成就进度、对局结算弹窗
- **排行榜**：多游戏榜单、消消乐多玩法细分排行
- **管理功能**：管理后台、对局管理、操作日志、反馈管理、系统维护模式
- **系统功能**：版本管理、主题系统、自动更新（更新包上传/校验/回滚）、在线更新日志页面

## 版本更新日志

> 完整更新日志由 git 提交记录自动生成，前端「更新日志」页面读取的是生成结果。

### Build 789 (2026-09-27)
- 重构肉鸽养成系统，图鉴界面改为 5 个分页（养成/里程/祝福/遗物/任务）
- 新增共鸣树左右分栏布局、里程碑分组与红点提醒
- 调整祝福等级上限与单级定价，新增局内任务奖励配置

### Build 783 (2026-09-26)
- 新增经验倍率日历：支持查看任意日期加成、当月统计
- 新增多年份节假日缓存，新增 `/api/multiplier-calendar` 接口

### Build 779 (2026-09-25)
- 新增自定义快捷键，支持个人资料页改键、冲突检测与重置

### Build 770 / 760 / 753 (2026-09-23 ~ 09-25)
- 新增消消乐玩法与肉鸽试炼、局内任务、层间祝福选择
- 新增肉鸽局外养成（精华、祝福解锁升级、共鸣树）与全套成就、排行榜
- 新增对局活跃续期心跳，避免长时间无操作被误踢

### Build 745 / 737 / 728 (2026-09 ~ 2026-09)
- 新增消消乐游戏玩法与配套功能
- 新增全局抽屉布局与界面自定义
- 重构账号条与更新日志页面，优化移动端适配

### v1.6.0
- 排行榜系统重构，新增文件 diff 查看功能
- 后台管理添加仪表盘最近游戏数据接口
- 将 Myers diff 递归改为迭代避免栈溢出，替换为第三方 diff 库

### v1.5.0
- 新增系统维护、自动更新功能与管理员更新面板
- 新增对局管理后台、操作日志、观战系统

### v1.4.0
- 新增成就徽章系统、邮件系统、背包礼包
- 新增贪吃蛇游戏、自定义头像与头像框、VIP 系统
- 新增断线重连、象棋 AI 重构、动态价格商店与经验道具体系

### v1.3.0 (2026-03-22)
- 主题配置从硬编码迁移到 JSON 文件，新增 ThemeManager
- 账号认证优化：前端仅保存 token，修复"幽灵游客账号"问题
- 优化 pkg 打包配置与 .gitignore

### v1.2.0 (2026-03-16)
- 初始版本发布：五子棋、围棋、象棋联机对战，账号/聊天/成就/管理员功能

## 技术栈

- **后端**：Node.js, Express, Socket.io
- **前端**：原生 HTML / JavaScript（`client` 为旧版页面，`client-v2` 为模块化新版）
- **依赖**：
  - compression: ^1.7.4
  - cors: ^2.8.5
  - diff: ^9.0.0
  - express: ^4.18.2
  - helmet: ^7.1.0
  - jsonwebtoken: ^9.0.3
  - socket.io: ^4.7.2
  - yauzl: ^3.4.0

## 安装和运行

### 前提条件

- Node.js 18.x 或更高版本
- git（运行 `npm start` / `npm run dev` 时会自动从提交记录生成更新日志）

### 安装步骤

1. 克隆项目

   ```bash
   git clone https://github.com/streesobrs/Online-game.git
   cd Online-game
   ```

2. 安装依赖

   ```bash
   npm install
   ```

3. 运行项目

   ```bash
   # 开发模式（nodemon，自动重启）
   npm run dev

   # 生产模式
   npm start
   ```

4. 访问页面（默认端口 8080，可用 `PORT` 环境变量覆盖）

   | 路径 | 说明 |
   |------|------|
   | `http://localhost:8080/` | 旧版客户端 |
   | `http://localhost:8080/beta` | 新版客户端（client-v2） |
   | `http://localhost:8080/admin` | 管理后台 |
   | `http://localhost:8080/docs` | 服务端接口文档页 |
   | `http://localhost:8080/health` | 健康检查 |

## 目录结构

```
├── server/                 # 服务端
│   ├── modules/            # 业务模块
│   │   ├── AccountManager.js      # 账号管理
│   │   ├── AchievementManager.js  # 成就管理
│   │   ├── AdminManager.js        # 管理员 / 权限
│   │   ├── AIManager.js           # AI 调度
│   │   ├── AIWorker.js            # AI 计算线程
│   │   ├── ChatManager.js         # 聊天
│   │   ├── FeedbackManager.js     # 用户反馈
│   │   ├── FriendsManager.js      # 好友
│   │   ├── GameManager.js         # 对局与结算
│   │   ├── OperationLogger.js     # 操作日志
│   │   ├── ShopManager.js         # 商城 / 经济
│   │   ├── ThemeManager.js        # 主题
│   │   ├── UpdateManager.js       # 自动更新
│   │   ├── UserManager.js         # 在线用户
│   │   ├── VersionManager.js      # 版本号
│   │   └── runtimeConfig.js       # 运行时配置
│   ├── config/             # 配置
│   │   ├── themes/             # 主题 JSON
│   │   ├── shop/               # 商城 / 道具 / 外观 / 礼包 / VIP
│   │   ├── levelExp.json       # 等级经验
│   │   └── holidayCache.json   # 节假日缓存
│   ├── scripts/            # gen-changelog.js（生成前端更新日志）
│   ├── utils/              # dataStore（数据存储）、logger（日志）
│   ├── assets/             # 服务端静态资源
│   ├── logs/               # 日志输出
│   ├── admin.html          # 管理后台页面
│   ├── docs.html           # 接口文档页
│   ├── config.js           # 服务端配置（端口、Socket、商城、更新等）
│   ├── version.json        # 版本号（major/minor/patch/build）
│   └── server.js           # 服务端入口
├── client/                 # 旧版前端页面（/ 访问）
├── client-v2/              # 新版前端（/beta、/preview 访问）
│   ├── src/
│   │   ├── games/              # gobang、go、chinese-chess、snake、match3
│   │   ├── features/           # auth、lobby、shop、chat、friends、leaderboard、spectate…
│   │   ├── components/         # 通用 UI 组件
│   │   ├── layouts/            # 布局（含全局抽屉）
│   │   ├── core/ config/ data/ styles/ utils/
│   │   └── main.js             # 前端入口
│   ├── themes/                 # 前端主题资源
│   ├── vendor/                 # 第三方库
│   └── index.html
├── updater/                # 独立更新器（updater.js）
├── update/                 # 更新包相关目录（backup / temp / uploads，运行时产生）
├── docs/                   # 本地设计/开发文档（不纳入版本库）
├── data/                   # 运行时数据（不纳入版本库）
├── logs/
├── package.json
├── start.bat / start.ps1   # Windows 启动脚本
├── build-exe.bat           # 构建 EXE
└── package.bat             # 打包发布脚本
```

## 版本号与更新日志

- 版本号保存在 [server/version.json](file:///d:/工程文件/网页游戏/server/version.json)（`major.minor.patch` + 自增 `build`），由 `VersionManager` 管理。
- 更新日志由 git 提交记录生成（遵循 [提交规范](file:///d:/工程文件/网页游戏/.trae/rules/git-commit-message.md)）：

  ```bash
  npm run changelog            # 全量生成
  npm run changelog -- --limit=50   # 只取最近 50 条
  ```

  产物为 `client-v2/src/config/changelog.js`，由前端直接 import。`npm start` / `npm run dev` 会通过 `prestart` / `predev` 自动执行。

## 主题系统

项目支持多种主题配置，服务端主题文件位于 `server/config/themes/` 目录。

### 添加新主题

1. 在 `server/config/themes/` 目录下创建新的 JSON 文件，例如 `mytheme.json`
2. 按照以下格式配置主题：

   ```json
   {
     "id": "mytheme",
     "name": "我的主题",
     "description": "主题描述",
     "background": "背景样式",
     "primaryColor": "#主色调",
     "secondaryColor": "#次要颜色",
     "effects": {
       "global": { },
       "board": { },
       "pieces": { },
       "cells": { }
     },
     "boardBackground": { },
     "pieceColor": { },
     "uiColors": { }
   }
   ```

3. 重启服务器或调用 `/api/themes/reload` 接口重新加载主题

### 主题 API

- `GET /api/themes` - 获取所有主题列表
- `GET /api/themes/:id` - 获取指定主题详情
- `POST /api/themes` - 添加新主题
- `PUT /api/themes/:id` - 更新主题
- `DELETE /api/themes/:id` - 删除主题
- `POST /api/themes/reload` - 重新加载主题

## 构建与打包

```bash
# 打包为 Windows 可执行文件，产物位于 dist/game-server.exe
npm run pkg

# 生成发布压缩包（供在线更新使用）
package.bat
```

## 如何贡献

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详情请参阅 LICENSE 文件

## 联系方式

- 项目链接：https://github.com/streesobrs/Online-game