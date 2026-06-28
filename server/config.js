const path = require('path');

function getStorageRoot() {
  if (process.env.STORAGE_ROOT) {
    return process.env.STORAGE_ROOT;
  }
  const isPkg = typeof process.pkg !== 'undefined';
  if (isPkg) {
    return path.dirname(process.execPath);
  } else {
    return path.join(__dirname, '..');
  }
}

const storageRoot = getStorageRoot();

module.exports = {
  // 版本号 (语义化版本：MAJOR.MINOR.PATCH)
  version: '1.6.0',

  // ========== 服务器基础配置 ==========
  server: {
    port: process.env.PORT || 8080,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
    // Socket.IO 实时通信配置
    socket: {
      pingTimeout: 120000,        // ping超时时间（毫秒），超过此时间无响应判定为断开（2分钟）
      pingInterval: 30000,        // ping心跳包发送间隔（毫秒）（30秒）
      upgradeTimeout: 10000,      // 协议升级超时时间（毫秒）（10秒）
      maxHttpBufferSize: 1e6      // HTTP最大缓冲区大小（字节），限制单条消息大小（1MB）
    },
    // HTTP 请求体限制
    http: {
      bodyLimit: '10mb'           // Express请求体最大大小（用于上传头像等）
    }
  },

  // ========== 管理员后台配置 ==========
  admin: {
    token: process.env.ADMIN_TOKEN || 'admin-secret-token',
    updateInterval: 2000,                          // 管理后台数据自动刷新间隔（毫秒）
    tokenExpiry: 24 * 60 * 60 * 1000,              // 管理员登录Token有效期（24小时）
    maxActiveSessions: 3,                          // 同一管理员最大同时在线会话数
    enableDynamicTokens: true,                     // 是否启用动态Token生成
    tokenCleanupInterval: 5 * 60 * 1000,           // 过期Token定期清理间隔（5分钟）
    tokenBytes: 32,                                // 动态Token随机字节数（64位十六进制）
    defaultMuteMinutes: 10,                        // 管理员一键禁言默认时长（分钟）
    allowedUsernames: process.env.ADMIN_USERNAMES ? process.env.ADMIN_USERNAMES.split(',') : ['admin'],
    upgradeKey: process.env.ADMIN_UPGRADE_KEY || 'ccccccccccccccccccc'
  },

  // ========== 系统运维配置 ==========
  system: {
    maintenanceEnabled: false,                      // 维护模式开关
    maintenanceMessage: '系统维护中，请稍后再试',     // 维护提示消息
    maintenanceBlockNewGames: true,                 // 维护中阻止开新局
    maintenanceBlockChat: false,                    // 维护中阻止聊天
    maintenanceBlockShop: true,                     // 维护中阻止商城购买
    maintenanceBlockMail: true,                     // 维护中阻止邮件发送
    maintenanceBlockRegister: true,                 // 维护中阻止新用户注册
    maintenanceBlockProfile: false,                 // 维护中阻止修改资料
    maintenanceKickOnEnable: false,                 // 开启维护时是否踢出所有玩家
    maintenanceCountdownMinutes: 0,                 // 维护预计时长（分钟），0为不确定
    maintenanceNoticeMinutes: 5                     // 开启维护前提前通知分钟数
  },

  // ========== 游戏基础配置 ==========
  game: {
    types: {
      GOBANG: 'gobang',
      GO: 'go',
      CHINESE_CHESS: 'chinese-chess',
      SNAKE: 'snake'
    },
    maxWaitTime: 300000,                           // 匹配队列最大等待时间（5分钟）
    maxGameTime: 3600000,                          // 单局游戏最大时长（1小时），超时强制结束
    inactivityTimeout: 30 * 60 * 1000,             // 玩家长时间无操作超时（30分钟）
    challengeTimeout: 60000,                        // 好友挑战请求超时时间（60秒）
    gameIdSuffixLength: 9,                         // 游戏ID随机后缀长度（位）
    boardSizes: {
      gobang: 15,                                   // 五子棋棋盘 15×15
      go: 19,                                       // 围棋棋盘 19×19
      chineseChess: { rows: 10, cols: 9 }           // 中国象棋棋盘 10行×9列
    }
  },

  // ========== 数据存储路径 ==========
  paths: {
    data: path.join(storageRoot, 'data'),
    logs: path.join(storageRoot, 'logs'),
    accounts: path.join(storageRoot, 'data', 'accounts'),
    games: path.join(storageRoot, 'data', 'games'),
    stats: path.join(storageRoot, 'data', 'stats.json')
  },

  // ========== 日志配置 ==========
  log: {
    level: process.env.LOG_LEVEL || 'info',         // 日志级别: debug/info/warn/error
    maxFiles: 7,                                     // 日志文件最大保留天数
    maxSize: '10m',                                  // 单个日志文件最大大小
    adminBufferSize: 500,                            // 管理后台实时日志缓冲区大小（条）
    adminMaxDisplay: 1000,                           // 管理后台日志页面最大显示条数
    adminFileReadLines: 500,                         // 查看历史日志文件时默认读取行数
    adminFileReadMaxLines: 2000                      // 查看历史日志文件时最大允许读取行数
  },

  // ========== 用户权限配置 ==========
  permissions: {
    // 游客权限
    guest: {
      canPlayGames: true, canChat: true, canViewLeaderboard: true,
      canViewProfiles: false, canEditProfile: false, canChangePassword: false,
      canSaveStats: false, canCreateRooms: false, canInviteFriends: false,
      maxGamesPerDay: 10, maxChatMessages: 50
    },
    // 注册用户权限
    registered: {
      canPlayGames: true, canChat: true, canViewLeaderboard: true,
      canViewProfiles: true, canEditProfile: true, canChangePassword: true,
      canSaveStats: true, canCreateRooms: true, canInviteFriends: true,
      maxGamesPerDay: 100, maxChatMessages: 500
    },
    // 管理员权限
    admin: {
      canPlayGames: true, canChat: true, canViewLeaderboard: true,
      canViewProfiles: true, canEditProfile: true, canChangePassword: true,
      canSaveStats: true, canCreateRooms: true, canInviteFriends: true,
      canManageUsers: true, canManageGames: true, canViewSystemStats: true,
      maxGamesPerDay: 1000, maxChatMessages: 1000
    }
  },

  // ========== API限流配置 ==========
  rateLimit: {
    windowMs: 60000,                                // 限流统计时间窗口（1分钟）
    maxRequests: 100                                // 窗口内最大请求数
  },

  // ========== FFmpeg配置（GIF头像压缩） ==========
  ffmpeg: {
    path: process.env.FFMPEG_PATH || null,          // ffmpeg可执行文件路径（null为自动检测）
    maxSize: 512,                                   // GIF最大尺寸（像素）
    fps: 15,                                        // GIF帧率
    maxColors: 128,                                 // GIF调色板颜色数
    timeout: 30000,                                 // 单个GIF处理最大时长（30秒）
    versionCheckTimeout: 2000,                      // ffmpeg版本检测超时（毫秒）
    registryQueryTimeout: 3000                      // Windows注册表查询超时（毫秒）
  },

  // ========== 安全与认证配置 ==========
  security: {
    passwordHashIterations: 10000,                  // PBKDF2密码哈希迭代次数（越高越安全但越慢）
    passwordKeyLength: 64,                          // 密码哈希密钥长度（字节）
    passwordSaltBytes: 16,                          // 密码盐值随机字节数
    userIdBytes: 8,                                 // 注册用户ID随机字节数（16位十六进制）
    guestUserIdBytes: 4,                            // 游客/会话级短ID字节数（8位十六进制）
    sessionTokenBytes: 16,                          // 会话Token随机字节数（32位十六进制）
    sessionTokenExpiry: 7 * 24 * 60 * 60 * 1000,   // 会话Token有效期（7天）
    randomIdSuffixLength: 5,                        // 交易记录等随机ID后缀长度
    adminTokenBytes: 32                             // 管理员动态Token随机字节数
  },

  // ========== 经验值系统配置 ==========
  exp: {
    baseExpPerLevel: 100,                           // 等级经验基数（每级所需经验 = (level-1) × 该值）
    // 按等级段的经验获取倍率（高等级倍率越高，升级越快）
    levelMultipliers: {
      low: { maxLevel: 10, multiplier: 1.0 },       // Lv1-10：1倍经验
      mid: { maxLevel: 20, multiplier: 1.5 },       // Lv11-20：1.5倍经验
      high: { maxLevel: 30, multiplier: 2.0 },      // Lv21-30：2倍经验
      veryHigh: { maxLevel: 40, multiplier: 2.5 },  // Lv31-40：2.5倍经验
      max: { multiplier: 3.0 }                       // Lv41+：3倍经验
    },
    weekendMultiplier: 1.5,                         // 周末经验倍率
    weekendHolidayMultiplier: 1.5,                  // 周末+节假日叠加倍率
    defaultHolidayMultiplier: 2.0,                  // 节假日API获取失败时的默认倍率
    workdayMultiplier: 1.0,                         // 补班日（调休上班）倍率（无加成）
    // 道具经验倍率
    itemMultipliers: {
      doubleExp: 2.0,                               // 双倍经验卡倍率
      tripleExp: 3.0                                // 三倍经验卡倍率
    },
    vipDefaultMultiplier: 2.0,                      // VIP月卡默认经验加成倍率
    expToCoinRatio: 10,                             // 经验兑换星钻比率（每10点经验兑换1星钻）
    levelUpCoinReward: 50,                          // 每升1级奖励星钻数量
    defaultQueryLimit: 50                           // 经验记录默认查询条数
  },

  // ========== 节假日经验倍率配置 ==========
  holidays: {
    // 固定日期的普通节假日（2倍经验），格式 MMDD
    majorHolidays: {
      '0101': 2.0,    // 元旦
      '0501': 2.0,    // 劳动节
      '0405': 2.0,    // 清明节（近似日期，实际以API返回为准）
      '0622': 2.0,    // 端午节（近似日期）
      '0929': 2.0,    // 中秋节（近似日期）
    },
    majorHolidayMultiplier: 2.5,                    // 重大节假日倍率（春节/除夕/国庆节，由API名称匹配）
    normalHolidayMultiplier: 2.0                    // 普通节假日倍率
  },

  // ========== 对战经验奖励配置 ==========
  gameRewards: {
    // PvP玩家对战基础经验
    pvp: {
      win: 300,                                     // 胜利奖励经验
      draw: 150,                                    // 平局奖励经验
      lose: 75                                      // 失败安慰经验
    },
    // AI对战基础经验
    ai: {
      win: 200,                                     // 胜利奖励经验
      draw: 100,                                    // 平局奖励经验
      lose: 50                                      // 失败安慰经验
    },
    // AI难度倍率（基础经验 × 难度倍率 = 实际获得）
    aiDifficultyMultiplier: {
      easy: 1.0,                                    // 简单难度：1倍
      medium: 1.5,                                  // 中等难度：1.5倍
      hard: 2.0                                     // 困难难度：2倍
    },
    quickGameThreshold: 5 * 60 * 1000,              // 快速游戏判定（5分钟内结束，经验打折）
    slowGameThreshold: 15 * 60 * 1000               // 慢速游戏判定（15分钟以上，经验加成）
  },

  // ========== 贪吃蛇游戏奖励配置 ==========
  snakeRewards: {
    winScoreThreshold: 100,                         // 胜利分数阈值（达到该分数判定胜利）
    baseExp: 50,                                    // 游戏结束基础经验奖励
    expPerScoreDivisor: 2                           // 经验换算除数（每N分1经验，即分数/2）
  },

  // ========== 道具系统配置 ==========
  items: {
    // 时效性道具持续时间（毫秒）
    durations: {
      doubleExp: 60 * 60 * 1000,                    // 双倍经验卡：1小时
      luckyCharm: 60 * 60 * 1000,                   // 幸运符（星钻翻倍）：1小时
      tripleExp: 60 * 60 * 1000                     // 三倍经验卡：1小时
    },
    // 即时使用道具效果数值
    effects: {
      expPotion: 500,                               // 经验药水：使用后立即获得500经验
      expPackage: 3000,                             // 奖励经验包：使用后立即获得3000经验
      undoCard: 3,                                  // 悔棋卡：使用后获得3次悔棋机会
      hintCard: 5                                   // 提示卡：使用后获得5次提示机会
    },
    // 道具ID常量（须与 server/config/shop/items.json 保持一致）
    ids: {
      exp_potion: 'item_exp_potion',
      exp_pack: 'item_exp_pack',
      reward_exp: 'item_reward_exp',
      undo: 'item_undo',
      hint: 'item_hint',
      double_exp: 'item_double_exp',
      triple_exp: 'item_triple_exp',
      luck_boost: 'item_luck_boost',
      level_up: 'item_level_up',
      snake_revive: 'item_snake_revive'
    },
    undoCardGrants: 3,                              // 每张悔棋卡增加的悔棋次数
    hintCardGrants: 5                               // 每张提示卡增加的提示次数
  },

  // ========== 等级里程碑奖励配置 ==========
  // 每5级一个奖励里程碑，玩家达到等级后可在资料页领取
  levelRewards: {
    milestones: {
      5: { starCoins: 100, expPotions: 3, undoCards: 1 },
      10: { starCoins: 250, expPotions: 5, doubleExpCards: 2, hintCards: 3, vipDays: 7, vipMultiplier: 2.0 },
      15: { starCoins: 500, expPotions: 10, doubleExpCards: 3, undoCards: 3 },
      20: { starCoins: 800, expPotions: 10, doubleExpCards: 5, hintCards: 5, luckyCharms: 1, vipDays: 30, vipMultiplier: 2.0 },
      25: { starCoins: 1200, tripleExpCards: 2, undoCards: 5, hintCards: 5 },
      30: { starCoins: 1800, tripleExpCards: 3, expPotions: 20, luckyCharms: 3, vipDays: 30, vipMultiplier: 2.0 },
      40: { starCoins: 3000, tripleExpCards: 5, expPotions: 30, levelUpTickets: 1, vipDays: 30, vipMultiplier: 2.0 },
      50: { starCoins: 5000, tripleExpCards: 10, expPotions: 50, levelUpTickets: 3, luckyCharms: 5, vipDays: 30, vipMultiplier: 2.0 }
    }
  },

  // ========== 老玩家补偿配置 ==========
  compensation: {
    newPlayerGiftCoins: 500,                        // 新手礼包基础星钻
    expToCoinRate: 10,                              // 历史经验补偿率（每10点经验补1星钻）
    perLevelCoins: 50,                              // 每达到1级补偿50星钻
    perAchievementCoins: 50,                        // 每个已解锁成就补偿50星钻
    perGameCoins: 5,                                // 每局对战补偿5星钻
    perWinCoins: 10                                 // 每场胜利额外补偿10星钻
  },

  // ========== 会话与连接配置 ==========
  session: {
    reconnectGracePeriod: 30000,                    // 断开重连宽限期（30秒内重连可恢复会话）
    inactiveWarningTime: 15 * 60 * 1000,            // 不活跃用户警告时间（15分钟无操作发提醒）
    inactiveKickDelay: 30000,                       // 警告后延迟断开时间（30秒）
    aiGameCleanupDelay: 5000                        // AI游戏结束后延迟清理时间（5秒，等待结算动画）
  },

  // ========== 游戏超时与计时配置 ==========
  gameTimeouts: {
    matchTimeout: 30000,                            // 匹配超时（30秒未匹配成功自动取消）
    snakeGameDuration: 120,                         // 贪吃蛇单局时长（秒）
    snakeSyncDelay: 500,                            // 贪吃蛇开局同步延迟（毫秒，等待双方准备）
    inactivityWarn: 5 * 60 * 1000,                  // 长时间未落子警告（5分钟）
    timerCheckInterval: 30000,                      // 游戏计时器检查间隔（30秒巡检一次）
    resetRequestTimeout: 30000,                     // 重置游戏请求响应超时（30秒）
    earlyGameAbortTime: 60000,                      // 开局1分钟内离开判定为无效游戏
    earlyGameAbortMoves: 5,                         // 无效游戏步数阈值（步数<5且时间<1分钟）
    quickDrawTime: 2 * 60 * 1000,                   // 开局2分钟内离开判定为快速平局
    quickDrawMoves: 10,                             // 快速平局步数阈值（步数<10且时间<2分钟）
    defaultBoardSize: 15                            // 默认棋盘大小（五子棋/围棋）
  },

  // ========== 聊天系统配置 ==========
  chat: {
    maxHistoryMessages: 100,                        // 单房间内存中保留的最大聊天历史条数
    defaultMuteDuration: 60 * 60 * 1000,            // 默认禁言时长（1小时）
    rateLimitWindowMs: 60000,                       // 消息频率限制时间窗口（1分钟）
    maxMessagesPerMinute: 20,                       // 每分钟最大消息数（防刷屏）
    maxMessageLength: 500,                          // 单条消息最大字符数
    permanentMuteThresholdMinutes: 365 * 24 * 60,   // 永久禁言判定阈值（分钟，设为1年以上视为永久）
    defaultHistoryLimit: 50,                        // 聊天历史默认加载条数
    defaultQueryLimit: 50                           // 聊天记录管理后台默认查询条数
  },

  // ========== 输入验证与查询限制配置 ==========
  validation: {
    usernameMinLength: 3,                           // 用户名最小长度
    usernameMaxLength: 20,                          // 用户名最大长度
    passwordMinLength: 6,                           // 密码最小长度
    defaultAccountListLimit: 50,                    // 账号列表默认分页条数
    defaultTransactionQueryLimit: 50,               // 交易/经验记录默认查询条数
    accountSearchLimit: 100,                        // 后台搜索账号时最大加载数量
    defaultLogLimit: 100,                           // 日志查询默认条数
    defaultLeaderboardLimit: 10,                    // 排行榜默认显示条数
    defaultGameHistoryLimit: 50,                    // 游戏记录默认查询条数
    defaultUserGameHistoryLimit: 20                 // 用户个人游戏历史默认查询条数
  },

  // ========== 商店配置 ==========
  shop: {
    configCheckInterval: 30000,                     // 商店配置热更新检查间隔（30秒）
    vipDiscountPercent: 10,                         // VIP折扣百分比（10=9折，即价格×90%）
    discountDenominator: 100,                       // 折扣计算分母（百分比换算）
    userGrayMod: 100,                               // 用户灰度哈希取模值（百分比分流）
    defaultHotUpdateInterval: 30000,                // 默认热更新检查间隔（毫秒）
    maxPurchaseQuantity: 999                        // 单次购买最大数量限制
  },

  // ========== 头像配置 ==========
  avatar: {
    defaultSlots: 3,                                // 默认自定义头像槽位数
    vipBonusSlots: 10                               // VIP用户额外头像槽位数
  },

  // ========== 动态定价配置 ==========
  // 等级经验包等商品的价格随等级动态变化
  dynamicPricing: {
    levelRatios: {
      low: { maxLevel: 10, ratio: 0.5 },            // Lv1-10：价格系数0.5（低等级便宜）
      mid: { maxLevel: 25, ratio: 0.35 },           // Lv11-25：价格系数0.35
      high: { maxLevel: 40, ratio: 0.25 },          // Lv26-40：价格系数0.25
      max: { ratio: 0.18 }                          // Lv41+：价格系数0.18（高等级贵）
    },
    maxRatio: 0.5,                                  // 动态价格最大系数（最低价格）
    minRatio: 0.18,                                 // 动态价格最小系数（最高价格）
    curveExponent: 0.7                              // 价格曲线幂次（控制平滑度）
  },

  // ========== 系统自动更新配置 ==========
  update: {
    enabled: true,                                  // 是否启用自动更新功能
    maxUploadSize: 100 * 1024 * 1024,              // 更新包最大大小 100MB
    maxExtractSize: 500 * 1024 * 1024,             // 解压后最大总大小 500MB
    maxFileCount: 2000,                             // 最大文件数量
    allowedPaths: [                                 // 允许更新的路径前缀
      'server', 'client', 'package.json', 'package-lock.json',
      'version.json', 'start.bat', 'start.ps1'
    ],
    blockedPaths: [                                 // 禁止更新的路径
      'data', 'logs', 'update', 'config.js', '.env', 'updater'
    ],
    backupDir: 'update/backup',                     // 备份目录
    tempDir: 'update/temp',                         // 临时解压目录
    uploadDir: 'update/uploads',                    // 上传包临时存储
    statusFile: 'update/update-status.json',        // 更新状态文件
    lockFile: 'update/update.lock',                 // 更新锁文件
    flagFile: 'restart.flag',                       // 重启标记文件
    maxBackups: 3,                                  // 保留的最大版本备份数
    gracePeriodSeconds: 30,                         // 优雅关闭等待时间（秒）
    restartTimeoutSeconds: 60,                      // 新进程启动超时（秒）
    healthCheckRetries: 30,                         // 健康检查最大重试次数
    healthCheckIntervalMs: 2000,                    // 健康检查间隔（毫秒）
    rollbackOnStartupFailure: true,                 // 启动失败自动回滚
    autoRollbackCrashThreshold: 3,                  // 时间窗口内崩溃多少次触发自动回滚
    autoRollbackCrashWindowMs: 10 * 60 * 1000,     // 崩溃计数时间窗口（10分钟）
    requireSignature: false,                        // 是否要求数字签名（默认关闭，可后续开启）
    chunkSize: 5 * 1024 * 1024                     // 分片上传大小 5MB
  },

  // ========== 数据存储配置 ==========
  dataStore: {
    renameRetries: 5,                               // 文件原子写入重命名最大重试次数
    retryDelayBaseMs: 50                            // 重试延迟基数（毫秒），实际延迟 = base × 重试次数
  },

  // ========== 界面显示配置 ==========
  display: {
    nicknameTruncateLength: 8                       // 日志中昵称/ID显示截断长度（字符）
  }
};
