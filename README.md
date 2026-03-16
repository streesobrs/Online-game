# 多棋种联机大厅

## 项目简介

多棋种联机大厅是一个基于Node.js和Socket.io的在线游戏服务器，支持多种棋类游戏的联机对战。

**README.md日期**：2026-03-16

## 功能特性

- 支持多种棋类游戏
- 实时在线对战
- 用户账户管理
- 聊天功能
- 成就系统
- 管理员功能
- 版本管理

## 技术栈

- **后端**：Node.js, Express, Socket.io
- **前端**：HTML, JavaScript
- **依赖**：
  - cors: ^2.8.5
  - express: ^4.18.2
  - socket.io: ^4.7.2

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

## 项目结构

```
├── server/                # 服务器端代码
│   ├── modules/           # 功能模块
│   │   ├── AIManager.js       # AI管理
│   │   ├── AccountManager.js  # 账户管理
│   │   ├── AchievementManager.js  # 成就管理
│   │   ├── AdminManager.js    # 管理员管理
│   │   ├── ChatManager.js     # 聊天管理
│   │   ├── GameManager.js     # 游戏管理
│   │   ├── UserManager.js     # 用户管理
│   │   └── VersionManager.js  # 版本管理
│   ├── utils/             # 工具函数
│   │   ├── dataStore.js       # 数据存储
│   │   └── logger.js          # 日志记录
│   ├── admin.html         # 管理员页面
│   ├── config.js          # 配置文件
│   └── server.js          # 服务器入口
├── index.html             # 前端页面
├── package.json           # 项目配置
└── start.bat              # 启动脚本
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
