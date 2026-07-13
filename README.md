# 多棋种联机大厅

## 项目简介

多棋种联机大厅是一个基于Node.js和Socket.io的在线游戏服务器，支持多种棋类游戏的联机对战。

**README.md日期**：2026-07-13

## 版本更新日志

### v1.6.0
- **排行榜系统重构**
  - 重构排行榜系统
  - 新增文件diff查看功能
- **后台管理增强**
  - 添加仪表盘最近游戏数据接口
- **性能优化**
  - 将Myers diff递归改为迭代避免栈溢出
  - 替换自定义diff实现为第三方diff库

### v1.5.0
- **系统更新功能**
  - 添加系统维护功能与管理后台支持
  - 添加系统自动更新功能与管理员后台更新面板
  - 完善更新包清理逻辑并优化重启流程
- **后台管理增强**
  - 添加对局管理后台功能与日志时区优化
  - 添加操作日志功能与后台管理页面
  - 添加观战系统与全量操作日志功能

### v1.4.0
- **成就与邮件系统**
  - 新增成就徽章系统与账号管理优化
  - 新增邮件系统、背包礼包功能与成就徽章资源
- **游戏扩展**
  - 添加贪吃蛇游戏支持
- **账号与外观系统**
  - 添加自定义头像与头像框系统
  - 添加自定义头像重命名功能
  - 完善VIP系统（年卡、GIF头像压缩、会员商城优化）
  - 实现账号私人通知功能
- **游戏功能增强**
  - 添加游戏断线重连功能
  - 象棋AI重构
  - 拆分前端页面
- **商店与经济系统**
  - 新增动态价格商店与全新经验道具体系
  - 商城、VIP、数据统计功能更新与体验优化

### v1.3.0 (2026-03-22)
- **主题系统重构**
  - 将主题配置从硬编码迁移到JSON配置文件
  - 主题文件从 `server/data/themes/` 迁移到 `server/config/themes/`
  - 实现通用主题处理系统，前端代码不再包含特定主题的硬编码
  - 新增ThemeManager模块管理主题配置
- **账号认证优化**
  - 前端仅保存token，通过token向服务端请求账号信息
  - 修复"幽灵游客账号"问题
  - 解决游客账号刷新页面后创建新ID的问题
- **打包脚本优化**
  - 优化pkg配置，避免打包不必要的文件
  - 更新.gitignore，忽略打包生成的zip文件

### v1.2.0 (2026-03-16)
- 初始版本发布
- 支持五子棋、围棋、象棋三种棋类游戏
- 实现实时在线对战功能
- 用户账户管理系统
- 聊天功能
- 成就系统
- 管理员功能
- 版本管理

## 功能特性

- **棋类游戏**：五子棋、围棋、象棋、贪吃蛇
- **实时对战**：在线联机对战、观战系统、好友挑战系统
- **账户系统**：用户账户管理、VIP会员系统、私人通知、节假日经验加成
- **外观系统**：自定义头像、头像框、GIF头像压缩
- **经济系统**：商城、动态价格商店、经验道具体系、背包礼包
- **社交功能**：聊天系统、邮件系统、用户反馈系统（投票/评论/楼中楼）
- **成就系统**：成就徽章、成就管理
- **管理功能**：管理员后台、对局管理、操作日志、系统维护、动态管理员Token
- **系统功能**：版本管理、主题系统、自动更新、断线重连、维护模式细粒度控制

## 技术栈

- **后端**：Node.js, Express, Socket.io
- **前端**：HTML, JavaScript
- **依赖**：
  - cors: ^2.8.5
  - express: ^4.18.2
  - socket.io: ^4.7.2
  - jsonwebtoken: ^9.0.3
  - diff: ^9.0.0
  - yauzl: ^3.4.0

## 安装和运行

### 前提条件

- Node.js 18.x 或更高版本

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
   # 开发模式（使用nodemon）
   npm run dev
   
   # 生产模式
   npm start
   ```

4. 访问项目
   打开浏览器，访问 `http://localhost:8080`（默认端口）

## 主题系统

项目支持多种主题配置，主题文件位于 `server/config/themes/` 目录。

### 添加新主题

1. 在 `server/config/themes/` 目录下创建新的JSON文件，例如 `mytheme.json`
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

### 主题API

- `GET /api/themes` - 获取所有主题列表
- `GET /api/themes/:id` - 获取指定主题详情
- `POST /api/themes` - 添加新主题
- `PUT /api/themes/:id` - 更新主题
- `DELETE /api/themes/:id` - 删除主题
- `POST /api/themes/reload` - 重新加载主题

## 项目结构

```
├── server/                # 服务器端代码
│   ├── modules/           # 功能模块
│   │   ├── AIManager.js       # AI管理
│   │   ├── AccountManager.js  # 账户管理
│   │   ├── AchievementManager.js  # 成就管理
│   │   ├── AdminManager.js    # 管理员管理
│   │   ├── ChatManager.js     # 聊天管理
│   │   ├── FeedbackManager.js # 反馈管理
│   │   ├── GameManager.js     # 游戏管理
│   │   ├── OperationLogger.js # 操作日志
│   │   ├── ShopManager.js     # 商店管理
│   │   ├── ThemeManager.js    # 主题管理
│   │   ├── UpdateManager.js   # 更新管理
│   │   ├── UserManager.js     # 用户管理
│   │   ├── VersionManager.js  # 版本管理
│   │   └── runtimeConfig.js   # 运行时配置
│   ├── config/            # 配置文件
│   │   ├── themes/            # 主题配置
│   │   │   ├── cyberpunk.json     # 赛博朋克主题
│   │   │   ├── forest.json        # 森林主题
│   │   │   └── ocean.json         # 海洋主题
│   │   ├── shop/              # 商店配置
│   │   │   ├── config.json        # 商店配置
│   │   │   ├── items.json         # 道具配置
│   │   │   ├── cosmetics.json     # 外观配置
│   │   │   ├── packs.json         # 礼包配置
│   │   │   └── vip.json           # VIP配置
│   │   ├── levelExp.json      # 等级经验配置
│   │   └── holidayCache.json  # 节假日缓存
│   ├── assets/            # 静态资源
│   │   └── lucy.png           # 主题图片资源
│   ├── utils/             # 工具函数
│   │   ├── dataStore.js       # 数据存储
│   │   └── logger.js          # 日志记录
│   ├── admin.html         # 管理员页面
│   ├── config.js          # 配置文件
│   └── server.js          # 服务器入口
├── index.html             # 前端页面
├── package.json           # 项目配置
├── start.bat              # Windows启动脚本
├── start.ps1              # PowerShell启动脚本
├── build-exe.bat          # 构建EXE脚本
└── package.bat            # 打包脚本
```

## 构建可执行文件

项目支持将Node.js应用打包为Windows可执行文件：

```bash
npm run pkg
```

构建后的可执行文件将位于 `dist/game-server.exe`

## 如何贡献

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详情请参阅 LICENSE 文件

## 联系方式

- 项目链接：https://github.com/streesobrs/Online-game
