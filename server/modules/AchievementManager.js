// AchievementManager.js - 成就管理模块
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class AchievementManager {
  constructor(accountManager = null, userManager = null) {
    this.accountManager = accountManager;
    this.userManager = userManager;
    this.operationLogger = null;
    this.achievements = this.loadAchievements();
  }

  // 加载成就配置
  loadAchievements() {
    return [
      // 新手成就
      {
        id: 1,
        name: '初露锋芒',
        description: '获得第一场胜利',
        type: 'game',
        condition: { wins: 1 },
        reward: { exp: 100, badge: 'first_win' }
      },
      {
        id: 2,
        name: '渐入佳境',
        description: '获得五场胜利',
        type: 'game',
        condition: { wins: 5 },
        reward: { exp: 200, badge: 'five_wins' }
      },
      {
        id: 3,
        name: '常胜将军',
        description: '获得十场胜利',
        type: 'game',
        condition: { wins: 10 },
        reward: { exp: 400, badge: 'ten_wins' }
      },
      {
        id: 4,
        name: '百战百胜',
        description: '获得二十场胜利',
        type: 'game',
        condition: { wins: 20 },
        reward: { exp: 800, badge: 'twenty_wins' }
      },
      {
        id: 5,
        name: '棋坛宗师',
        description: '获得五十场胜利',
        type: 'game',
        condition: { wins: 50 },
        reward: { exp: 2000, badge: 'fifty_wins' }
      },
      {
        id: 6,
        name: '一代棋圣',
        description: '获得一百场胜利',
        type: 'game',
        condition: { wins: 100 },
        reward: { exp: 3500, badge: 'hundred_wins' }
      },
      {
        id: 7,
        name: '千场不败',
        description: '获得两百场胜利',
        type: 'game',
        condition: { wins: 200 },
        reward: { exp: 10000, badge: 'thousand_wins' }
      },
      // 游戏类型成就
      {
        id: 10,
        name: '五子棋新手',
        description: '在五子棋中获得5场胜利',
        type: 'game_type',
        condition: { gameType: 'gobang', wins: 5 },
        reward: { exp: 200, badge: 'gobang_beginner' }
      },
      {
        id: 11,
        name: '五子棋大师',
        description: '在五子棋中获得20场胜利',
        type: 'game_type',
        condition: { gameType: 'gobang', wins: 20 },
        reward: { exp: 1000, badge: 'gobang_expert' }
      },
      {
        id: 12,
        name: '五子棋宗师',
        description: '在五子棋中获得50场胜利',
        type: 'game_type',
        condition: { gameType: 'gobang', wins: 50 },
        reward: { exp: 2000, badge: 'gobang_master' }
      },
      {
        id: 13,
        name: '五子棋传奇',
        description: '在五子棋中获得100场胜利',
        type: 'game_type',
        condition: { gameType: 'gobang', wins: 100 },
        reward: { exp: 4000, badge: 'gobang_legend' }
      },
      {
        id: 20,
        name: '象棋新手',
        description: '在象棋中获得5场胜利',
        type: 'game_type',
        condition: { gameType: 'chinese-chess', wins: 5 },
        reward: { exp: 200, badge: 'chess_beginner' }
      },
      {
        id: 21,
        name: '象棋大师',
        description: '在象棋中获得20场胜利',
        type: 'game_type',
        condition: { gameType: 'chinese-chess', wins: 20 },
        reward: { exp: 1000, badge: 'chess_expert' }
      },
      {
        id: 22,
        name: '象棋宗师',
        description: '在象棋中获得50场胜利',
        type: 'game_type',
        condition: { gameType: 'chinese-chess', wins: 50 },
        reward: { exp: 2000, badge: 'chess_master' }
      },
      {
        id: 23,
        name: '象棋传奇',
        description: '在象棋中获得100场胜利',
        type: 'game_type',
        condition: { gameType: 'chinese-chess', wins: 100 },
        reward: { exp: 5000, badge: 'chess_legend' }
      },
      // 贪吃蛇成就
      {
        id: 24,
        name: '贪吃蛇新手',
        description: '在贪吃蛇中获得5场胜利',
        type: 'game_type',
        condition: { gameType: 'snake', wins: 5 },
        reward: { exp: 200, badge: 'snake_beginner' }
      },
      {
        id: 25,
        name: '贪吃蛇高手',
        description: '在贪吃蛇中获得20场胜利',
        type: 'game_type',
        condition: { gameType: 'snake', wins: 20 },
        reward: { exp: 1000, badge: 'snake_expert' }
      },
      {
        id: 26,
        name: '贪吃蛇大师',
        description: '在贪吃蛇中获得50场胜利',
        type: 'game_type',
        condition: { gameType: 'snake', wins: 50 },
        reward: { exp: 2000, badge: 'snake_master' }
      },
      {
        id: 27,
        name: '贪吃蛇传奇',
        description: '在贪吃蛇中获得100场胜利',
        type: 'game_type',
        condition: { gameType: 'snake', wins: 100 },
        reward: { exp: 4000, badge: 'snake_legend' }
      },
      {
        id: 28,
        name: '蛇王',
        description: '贪吃蛇最高分达到200分',
        type: 'game_type',
        condition: { gameType: 'snake', highScore: 200 },
        reward: { exp: 500, badge: 'snake_king' }
      },
      {
        id: 29,
        name: '蛇神',
        description: '贪吃蛇最高分达到500分',
        type: 'game_type',
        condition: { gameType: 'snake', highScore: 500 },
        reward: { exp: 1500, badge: 'snake_god' }
      },
      {
        id: 30,
        name: '围棋新手',
        description: '在围棋中获得5场胜利',
        type: 'game_type',
        condition: { gameType: 'go', wins: 5 },
        reward: { exp: 200, badge: 'go_beginner' }
      },
      {
        id: 31,
        name: '围棋大师',
        description: '在围棋中获得20场胜利',
        type: 'game_type',
        condition: { gameType: 'go', wins: 20 },
        reward: { exp: 1000, badge: 'go_expert' }
      },
      {
        id: 32,
        name: '围棋宗师',
        description: '在围棋中获得50场胜利',
        type: 'game_type',
        condition: { gameType: 'go', wins: 50 },
        reward: { exp: 2000, badge: 'go_master' }
      },
      {
        id: 33,
        name: '围棋传奇',
        description: '在围棋中获得100场胜利',
        type: 'game_type',
        condition: { gameType: 'go', wins: 100 },
        reward: { exp: 5000, badge: 'go_legend' }
      },
      // 等级成就
      {
        id: 40,
        name: '入门新手',
        description: '达到5级',
        type: 'level',
        condition: { level: 5 },
        reward: { exp: 400, badge: 'level_5' }
      },
      {
        id: 41,
        name: '登堂入室',
        description: '达到10级',
        type: 'level',
        condition: { level: 10 },
        reward: { exp: 1000, badge: 'level_10' }
      },
      {
        id: 42,
        name: '炉火纯青',
        description: '达到15级',
        type: 'level',
        condition: { level: 15 },
        reward: { exp: 1500, badge: 'level_15' }
      },
      {
        id: 43,
        name: '一代宗师',
        description: '达到20级',
        type: 'level',
        condition: { level: 20 },
        reward: { exp: 2000, badge: 'level_20' }
      },
      {
        id: 44,
        name: '棋坛泰斗',
        description: '达到25级',
        type: 'level',
        condition: { level: 25 },
        reward: { exp: 3000, badge: 'level_25' }
      },
      {
        id: 45,
        name: '传奇棋圣',
        description: '达到30级',
        type: 'level',
        condition: { level: 30 },
        reward: { exp: 3500, badge: 'level_30' }
      },
      {
        id: 46,
        name: '神话传说',
        description: '达到50级',
        type: 'level',
        condition: { level: 50 },
        reward: { exp: 10000, badge: 'level_50' }
      },
      // 连胜成就
      {
        id: 50,
        name: '势如破竹',
        description: '获得3连胜',
        type: 'streak',
        condition: { streak: 3 },
        reward: { exp: 300, badge: 'streak_3' }
      },
      {
        id: 51,
        name: '势不可挡',
        description: '获得5连胜',
        type: 'streak',
        condition: { streak: 5 },
        reward: { exp: 500, badge: 'streak_5' }
      },
      {
        id: 52,
        name: '无人能敌',
        description: '获得10连胜',
        type: 'streak',
        condition: { streak: 10 },
        reward: { exp: 600, badge: 'streak_10' }
      },
      {
        id: 53,
        name: '传奇连胜',
        description: '获得15连胜',
        type: 'streak',
        condition: { streak: 15 },
        reward: { exp: 1000, badge: 'streak_15' }
      },
      {
        id: 54,
        name: '不败神话',
        description: '获得20连胜',
        type: 'streak',
        condition: { streak: 20 },
        reward: { exp: 2000, badge: 'streak_20' }
      },
      {
        id: 55,
        name: '永恒传奇',
        description: '获得30连胜',
        type: 'streak',
        condition: { streak: 30 },
        reward: { exp: 5000, badge: 'streak_50' }
      },
      // 特殊成就
      {
        id: 60,
        name: '完美胜利',
        description: '在10步内获得胜利',
        type: 'game',
        condition: { maxMoves: 10, result: 'win' },
        reward: { exp: 300, badge: 'perfect_win' }
      },
      {
        id: 61,
        name: '逆转乾坤',
        description: '在落后情况下获得胜利',
        type: 'game',
        condition: { comeback: true, result: 'win' },
        reward: { exp: 400, badge: 'comeback_win' }
      },
      {
        id: 62,
        name: '握手言和',
        description: '获得第一场平局',
        type: 'game',
        condition: { draws: 1 },
        reward: { exp: 200, badge: 'first_draw' }
      },
      {
        id: 63,
        name: '百场平局',
        description: '获得十场平局',
        type: 'game',
        condition: { draws: 10 },
        reward: { exp: 600, badge: 'hundred_draws' }
      },
      // AI 相关成就
      {
        id: 70,
        name: '战胜简单AI',
        description: '在人机对战中战胜简单难度AI',
        type: 'ai',
        condition: { difficulty: 'easy', result: 'win' },
        reward: { exp: 100, badge: 'beat_ai_easy' }
      },
      {
        id: 71,
        name: '战胜中等AI',
        description: '在人机对战中战胜中等难度AI',
        type: 'ai',
        condition: { difficulty: 'medium', result: 'win' },
        reward: { exp: 500, badge: 'beat_ai_medium' }
      },
      {
        id: 72,
        name: '战胜困难AI',
        description: '在人机对战中战胜困难难度AI',
        type: 'ai',
        condition: { difficulty: 'hard', result: 'win' },
        reward: { exp: 1000, badge: 'beat_ai_hard' }
      },
      {
        id: 73,
        name: 'AI杀手',
        description: '在人机对战中获得10场胜利',
        type: 'ai',
        condition: { wins: 10 },
        reward: { exp: 2000, badge: 'ai_killer' }
      },
      {
        id: 74,
        name: 'AI大师',
        description: '在人机对战中获得20场胜利',
        type: 'ai',
        condition: { wins: 20 },
        reward: { exp: 3500, badge: 'ai_master' }
      },
      {
        id: 75,
        name: 'AI终结者',
        description: '在人机对战中获得50场胜利',
        type: 'ai',
        condition: { wins: 50 },
        reward: { exp: 10000, badge: 'ai_terminator' }
      },
      // 创意成就
      {
        id: 100,
        name: '第一步',
        description: '进行第一场游戏',
        type: 'creative',
        condition: { firstGame: true },
        reward: { exp: 200, badge: 'first_move' }
      },
      {
        id: 101,
        name: '夜猫子',
        description: '在凌晨2点到6点之间进行游戏',
        type: 'creative',
        condition: { nightGame: true },
        reward: { exp: 300, badge: 'night_owl' }
      },
      {
        id: 102,
        name: '周末战士',
        description: '在周末进行游戏',
        type: 'creative',
        condition: { weekendGame: true },
        reward: { exp: 300, badge: 'weekend_warrior' }
      },
      {
        id: 103,
        name: '话痨',
        description: '发送50条聊天消息',
        type: 'creative',
        condition: { chatMessages: 50 },
        reward: { exp: 600, badge: 'chatty_cathy' }
      },
      {
        id: 104,
        name: '沉默杀手',
        description: '在游戏中不发送任何消息并获得胜利',
        type: 'creative',
        condition: { silentWin: true },
        reward: { exp: 400, badge: 'silent_killer' }
      },
      {
        id: 105,
        name: '逆袭之王',
        description: '连续3场在落后情况下获得胜利',
        type: 'creative',
        condition: { comebackStreak: 3 },
        reward: { exp: 800, badge: 'comeback_kid' }
      },
      {
        id: 106,
        name: '全能选手',
        description: '在所有棋种中至少获得1场胜利',
        type: 'creative',
        condition: { allGameTypes: true },
        reward: { exp: 500, badge: 'jack_of_all_trades' }
      },
      {
        id: 107,
        name: '专精选手',
        description: '只玩一种棋种并获得20场胜利',
        type: 'creative',
        condition: { singleGameType: true },
        reward: { exp: 1000, badge: 'specialist' }
      },
      {
        id: 108,
        name: '快枪手',
        description: '在5分钟内完成一场游戏',
        type: 'creative',
        condition: { quickGame: true },
        reward: { exp: 100, badge: 'quick_draw' }
      },
      {
        id: 109,
        name: '慢玩家',
        description: '完成一场超过15分钟的游戏',
        type: 'creative',
        condition: { slowGame: true },
        reward: { exp: 300, badge: 'slow_play' }
      },
      {
        id: 110,
        name: '幸运星',
        description: '在游戏中获得一次幸运胜利',
        type: 'creative',
        condition: { luckyWin: true },
        reward: { exp: 300, badge: 'lucky_star' }
      },
      {
        id: 111,
        name: '倒霉蛋',
        description: '在游戏中获得一次不幸失败',
        type: 'creative',
        condition: { unluckyLoss: true },
        reward: { exp: 200, badge: 'unlucky' }
      },
      {
        id: 114,
        name: '成就猎人',
        description: '解锁10个成就',
        type: 'creative',
        condition: { achievements: 10 },
        reward: { exp: 1000, badge: 'achievement_hunter' }
      },
      {
        id: 115,
        name: '成就大师',
        description: '解锁所有成就',
        type: 'creative',
        condition: { allAchievements: true },
        reward: { exp: 2000, badge: 'achievement_master' }
      },
      {
        id: 118,
        name: '收藏家',
        description: '收集10个徽章',
        type: 'creative',
        condition: { badges: 10 },
        reward: { exp: 1000, badge: 'badge_collector' }
      },
      {
        id: 119,
        name: '徽章大师',
        description: '收集所有徽章',
        type: 'creative',
        condition: { allBadges: true },
        reward: { exp: 2000, badge: 'badge_master' }
      },
      {
        id: 120,
        name: '游戏狂人',
        description: '一天内进行10场游戏',
        type: 'creative',
        condition: { dailyGames: 10 },
        reward: { exp: 1000, badge: 'game_maniac' }
      },
      {
        id: 121,
        name: '游戏达人',
        description: '一周内进行30场游戏',
        type: 'creative',
        condition: { weeklyGames: 30 },
        reward: { exp: 2000, badge: 'game_daily' }
      },
      {
        id: 122,
        name: '游戏宗师',
        description: '一个月内进行100场游戏',
        type: 'creative',
        condition: { monthlyGames: 100 },
        reward: { exp: 4000, badge: 'game_monthly' }
      },
      {
        id: 125,
        name: '聊天之王',
        description: '发送200条聊天消息',
        type: 'creative',
        condition: { chatMessages: 200 },
        reward: { exp: 500, badge: 'chat_king' }
      },
      {
        id: 127,
        name: '逆转之王',
        description: '连续5场在落后情况下获得胜利',
        type: 'creative',
        condition: { comebackStreak: 5 },
        reward: { exp: 1000, badge: 'comeback_king' }
      },
      {
        id: 128,
        name: '完美之王',
        description: '在8步内获得胜利',
        type: 'creative',
        condition: { maxMoves: 8, result: 'win' },
        reward: { exp: 200, badge: 'perfect_king' }
      },
      {
        id: 129,
        name: '持久战之王',
        description: '完成一场超过30分钟的游戏',
        type: 'creative',
        condition: { slowGame: true, minDuration: 30 },
        reward: { exp: 200, badge: 'long_game_king' }
      },
      {
        id: 130,
        name: '新手保护',
        description: '在10级以下获得10场胜利',
        type: 'creative',
        condition: { lowLevelWins: 10 },
        reward: { exp: 600, badge: 'newbie_protection' }
      },
      {
        id: 131,
        name: '老手回归',
        description: '7天未登录后回归游戏',
        type: 'creative',
        condition: { returnPlayer: true },
        reward: { exp: 300, badge: 'return_player' }
      },
      {
        id: 132,
        name: '长期离线',
        description: '30天未登录后回归游戏',
        type: 'creative',
        condition: { longReturnPlayer: true },
        reward: { exp: 1000, badge: 'long_return_player' }
      }
    ];
  }

  // 将成就数据统一转为纯ID数组（兼容旧格式 [{id, unlockedAt}]）
  _normalizeAchievements(achievements) {
    if (!achievements || achievements.length === 0) return [];
    if (typeof achievements[0] === 'number' || typeof achievements[0] === 'string') {
      return achievements.slice();
    }
    return achievements.map(a => a.id);
  }

  // 检查成就
  async checkAchievements(id, stats) {
    const account = await this.accountManager.getAccount(id);
    if (!account) {
      return [];
    }

    const unlockedAchievements = [];
    // 兼容新旧格式
    const currentAchievements = this._normalizeAchievements(account.achievements || []);

    // 添加成就数量到统计数据
    stats.achievementCount = currentAchievements.length;

    // 检查每个成就
    for (const achievement of this.achievements) {
      // 已经解锁的成就跳过
      if (currentAchievements.includes(achievement.id)) {
        continue;
      }

      // 检查成就条件
      if (this.checkCondition(achievement, stats)) {
        // 解锁成就
        currentAchievements.push(achievement.id);
        unlockedAchievements.push(achievement);

        // 给予奖励
        if (achievement.reward) {
          await this.giveReward(id, achievement.reward);
        }
      }
    }

    // 保存成就
    if (unlockedAchievements.length > 0) {
      await dataStore.update('accounts', id, { achievements: currentAchievements });
      logger.info('成就解锁', { id, achievements: unlockedAchievements.map(a => a.id) });

      // 记录操作日志
      if (this.operationLogger) {
        const account = await this.accountManager.getAccount(id);
        const username = account?.account?.nickname || account?.account?.username || '';
        for (const achievement of unlockedAchievements) {
          this.operationLogger.getAchievementUnlock(id, username, achievement.id, achievement.name);
        }
      }
    }

    // 重新计算徽章数量并更新勋章列表
    if (unlockedAchievements.length > 0) {
      const updatedAccount = await this.accountManager.getAccount(id);
      if (updatedAccount && updatedAccount.achievements) {
        // 获取已有勋章列表
        const existingBadges = updatedAccount.badges || [];
        const newBadges = [];

        const badgeCount = updatedAccount.achievements.filter(aid => {
          const achievement = this.achievements.find(a => a.id === aid);
          if (achievement && achievement.reward && achievement.reward.badge) {
            // 如果勋章不在已有列表中，添加到新列表
            if (!existingBadges.includes(achievement.reward.badge)) {
              newBadges.push(achievement.reward.badge);
            }
            return true;
          }
          return false;
        }).length;

        const allBadges = [...new Set([...existingBadges, ...newBadges])];
        await dataStore.update('accounts', { 'account.id': id }, {
          badges: allBadges,
          'stats.badges': badgeCount
        });
      }
    }

    return unlockedAchievements;
  }

  // 检查成就条件
  checkCondition(achievement, stats) {
    switch (achievement.type) {
      case 'game':
        if (achievement.condition.wins !== undefined) {
          return stats.wins >= achievement.condition.wins;
        }
        if (achievement.condition.draws !== undefined) {
          return stats.draws >= achievement.condition.draws;
        }
        if (achievement.condition.maxMoves !== undefined && achievement.condition.result) {
          return stats.result === achievement.condition.result && stats.maxMoves <= achievement.condition.maxMoves;
        }
        return false;
      case 'level':
        return stats.level >= achievement.condition.level;
      case 'streak':
        return stats.streak >= achievement.condition.streak || stats.maxStreak >= achievement.condition.streak;
      case 'game_type':
        if (achievement.condition.wins !== undefined) {
          return stats.gameTypeWins &&
            stats.gameTypeWins[achievement.condition.gameType] >= achievement.condition.wins;
        }
        if (achievement.condition.highScore !== undefined) {
          return stats.gameTypeHighScores &&
            stats.gameTypeHighScores[achievement.condition.gameType] >= achievement.condition.highScore;
        }
        return false;
      case 'ai':
        if (achievement.condition.wins !== undefined) {
          return stats.aiWins >= achievement.condition.wins;
        }
        if (achievement.condition.difficulty && achievement.condition.result) {
          // 只检查当前游戏的AI对战结果
          return stats.aiDifficulty === achievement.condition.difficulty &&
            stats.aiResult === achievement.condition.result &&
            stats.result === achievement.condition.result;
        }
        return false;
      case 'creative':
        const condition = achievement.condition;
        if (condition.firstGame !== undefined) return stats.firstGame;
        if (condition.nightGame !== undefined) return stats.nightGame;
        if (condition.weekendGame !== undefined) return stats.weekendGame;
        if (condition.chatMessages !== undefined) return stats.chatMessages >= condition.chatMessages;
        if (condition.silentWin !== undefined) return stats.silentWin && stats.result === 'win';
        if (condition.comebackStreak !== undefined) return stats.comebackStreak >= condition.comebackStreak;
        if (condition.allGameTypes !== undefined) return stats.allGameTypes;
        if (condition.singleGameType !== undefined) return stats.singleGameType;
        if (condition.quickGame !== undefined) return stats.quickGame;
        if (condition.slowGame !== undefined) {
          // 支持 minDuration（分钟）阈值，如持久战之王需要 180 分钟
          if (condition.minDuration && stats.gameDuration) {
            return stats.slowGame && stats.gameDuration >= condition.minDuration;
          }
          return stats.slowGame;
        }
        if (condition.luckyWin !== undefined) return stats.luckyWin && stats.result === 'win';
        if (condition.unluckyLoss !== undefined) return stats.unluckyLoss && stats.result === 'loss';
        if (condition.friends !== undefined) return stats.friends >= condition.friends;
        if (condition.lonerWin !== undefined) return stats.lonerWin && stats.result === 'win';
        if (condition.signInStreak !== undefined) return stats.signInStreak >= condition.signInStreak;
        if (condition.badges !== undefined) return stats.badges >= condition.badges;
        if (condition.dailyGames !== undefined) return stats.dailyGames >= condition.dailyGames;
        if (condition.weeklyGames !== undefined) return stats.weeklyGames >= condition.weeklyGames;
        if (condition.monthlyGames !== undefined) return stats.monthlyGames >= condition.monthlyGames;
        if (condition.lowLevelWins !== undefined) return stats.lowLevelWins >= condition.lowLevelWins;
        if (condition.returnPlayer !== undefined) return stats.returnPlayer;
        if (condition.longReturnPlayer !== undefined) return stats.longReturnPlayer;
        if (condition.invites !== undefined) return stats.invites >= condition.invites;
        if (condition.achievements !== undefined) {
          return stats.achievementCount >= condition.achievements;
        }
        if (condition.allAchievements !== undefined) {
          return stats.achievementCount >= this.achievements.length;
        }
        if (condition.allBadges !== undefined) {
          return stats.badges >= this.achievements.filter(a => a.reward && a.reward.badge).length;
        }
        return false;
      default:
        return false;
    }
  }

  // 给予奖励
  async giveReward(id, reward) {
    if (reward.exp) {
      const result = await this.accountManager.addExp(id, reward.exp, false, 'achievement');

      // 通知客户端经验值更新
      if (result.success && this.userManager) {
        const userSession = this.userManager.getUserByAccountId(id);
        if (userSession && userSession.socket) {
          // 获取更新后的账号信息
          const updatedAccount = await this.accountManager.getAccount(id);
          userSession.socket.emit('account_updated', { account: updatedAccount });
        }
      }
    }

    if (reward.badge) {
      // 可以在这里添加徽章系统
    }
  }

  // 获取用户成就
  async getUserAchievements(id) {
    const account = await this.accountManager.getAccount(id);
    if (!account) {
      return [];
    }

    const userAchievements = this._normalizeAchievements(account.achievements || []);
    return this.achievements.filter(a => userAchievements.includes(a.id));
  }

  // 获取所有成就
  getAllAchievements() {
    return this.achievements;
  }

  // 计算成就进度
  calculateAchievementProgress(achievement, stats) {
    switch (achievement.type) {
      case 'game':
        if (achievement.condition.wins !== undefined) {
          return {
            current: stats.wins || 0,
            target: achievement.condition.wins,
            percent: Math.min(100, Math.round(((stats.wins || 0) / achievement.condition.wins) * 100))
          };
        }
        if (achievement.condition.draws !== undefined) {
          return {
            current: stats.draws || 0,
            target: achievement.condition.draws,
            percent: Math.min(100, Math.round(((stats.draws || 0) / achievement.condition.draws) * 100))
          };
        }
        break;
      case 'level':
        return {
          current: stats.level || 1,
          target: achievement.condition.level,
          percent: Math.min(100, Math.round(((stats.level || 1) / achievement.condition.level) * 100))
        };
      case 'streak':
        return {
          current: stats.maxStreak || 0,
          target: achievement.condition.streak,
          percent: Math.min(100, Math.round(((stats.maxStreak || 0) / achievement.condition.streak) * 100))
        };
      case 'game_type':
        if (achievement.condition.wins !== undefined) {
          return {
            current: stats.gameTypeWins?.[achievement.condition.gameType] || 0,
            target: achievement.condition.wins,
            percent: Math.min(100, Math.round(((stats.gameTypeWins?.[achievement.condition.gameType] || 0) / achievement.condition.wins) * 100))
          };
        }
        if (achievement.condition.highScore !== undefined) {
          return {
            current: stats.gameTypeHighScores?.[achievement.condition.gameType] || 0,
            target: achievement.condition.highScore,
            percent: Math.min(100, Math.round(((stats.gameTypeHighScores?.[achievement.condition.gameType] || 0) / achievement.condition.highScore) * 100))
          };
        }
        break;
      case 'ai':
        if (achievement.condition.wins !== undefined) {
          return {
            current: stats.aiWins || 0,
            target: achievement.condition.wins,
            percent: Math.min(100, Math.round(((stats.aiWins || 0) / achievement.condition.wins) * 100))
          };
        }
        break;
      case 'creative':
        const condition = achievement.condition;
        if (condition.chatMessages !== undefined) {
          return {
            current: stats.chatMessages || 0,
            target: condition.chatMessages,
            percent: Math.min(100, Math.round(((stats.chatMessages || 0) / condition.chatMessages) * 100))
          };
        }
        if (condition.friends !== undefined) {
          return {
            current: stats.friends || 0,
            target: condition.friends,
            percent: Math.min(100, Math.round(((stats.friends || 0) / condition.friends) * 100))
          };
        }
        if (condition.signInStreak !== undefined) {
          return {
            current: stats.signInStreak || 0,
            target: condition.signInStreak,
            percent: Math.min(100, Math.round(((stats.signInStreak || 0) / condition.signInStreak) * 100))
          };
        }
        if (condition.dailyGames !== undefined) {
          return {
            current: stats.dailyGames || 0,
            target: condition.dailyGames,
            percent: Math.min(100, Math.round(((stats.dailyGames || 0) / condition.dailyGames) * 100))
          };
        }
        if (condition.weeklyGames !== undefined) {
          return {
            current: stats.weeklyGames || 0,
            target: condition.weeklyGames,
            percent: Math.min(100, Math.round(((stats.weeklyGames || 0) / condition.weeklyGames) * 100))
          };
        }
        if (condition.monthlyGames !== undefined) {
          return {
            current: stats.monthlyGames || 0,
            target: condition.monthlyGames,
            percent: Math.min(100, Math.round(((stats.monthlyGames || 0) / condition.monthlyGames) * 100))
          };
        }
        if (condition.achievements !== undefined) {
          return {
            current: stats.achievementCount || 0,
            target: condition.achievements,
            percent: Math.min(100, Math.round(((stats.achievementCount || 0) / condition.achievements) * 100))
          };
        }
        break;
    }
    return null;
  }

  // 获取分类的成就列表
  getAchievementsByCategory(stats = {}) {
    const categories = {
      game: { name: '🏆 胜利成就', achievements: [] },
      game_type: { name: '🎯 棋种成就', achievements: [] },
      level: { name: '📈 等级成就', achievements: [] },
      streak: { name: '🔥 连胜成就', achievements: [] },
      ai: { name: '🤖 AI对战', achievements: [] },
      creative: { name: '✨ 特殊成就', achievements: [] }
    };

    this.achievements.forEach(achievement => {
      const progress = this.calculateAchievementProgress(achievement, stats);
      const achievementWithProgress = {
        ...achievement,
        progress: progress
      };
      if (categories[achievement.type]) {
        categories[achievement.type].achievements.push(achievementWithProgress);
      }
    });

    return categories;
  }

  // 获取勋章定义列表
  getBadgeDefinitions() {
    const badgeDefs = {};
    this.achievements.forEach(achievement => {
      if (achievement.reward && achievement.reward.badge) {
        badgeDefs[achievement.reward.badge] = {
          name: achievement.name,
          description: achievement.description,
          icon: `/assets/badges/${achievement.reward.badge}.svg`
        };
      }
    });
    return badgeDefs;
  }

  // 根据勋章ID获取图标
  getBadgeIcon(badgeId) {
    const iconMap = {
      // 胜利系列
      first_win: '🏆',
      five_wins: '⭐',
      ten_wins: '',
      twenty_wins: '💫',
      fifty_wins: '✨',
      hundred_wins: '💯',
      thousand_wins: '👑',
      // 五子棋系列
      gobang_beginner: '🔴',
      gobang_expert: '🔴',
      gobang_master: '🔴',
      gobang_legend: '',
      // 象棋系列
      chess_beginner: '♟️',
      chess_expert: '♟️',
      chess_master: '♟️',
      chess_legend: '♟️',
      // 围棋系列
      go_beginner: '⚫',
      go_expert: '⚫',
      go_master: '⚫',
      go_legend: '⚫',
      // 贪吃蛇系列
      snake_beginner: '🐍',
      snake_expert: '🐍',
      snake_master: '🐍',
      snake_legend: '🐍',
      snake_king: '👑',
      snake_god: '💎',
      // 等级系列
      level_5: '5️',
      level_10: '🔟',
      level_15: '🎯',
      level_20: '🎖️',
      level_25: '🏆',
      level_30: '👑',
      level_50: '💎',
      // 连胜系列
      streak_3: '🔥',
      streak_5: '🔥',
      streak_10: '🔥',
      streak_15: '🔥',
      streak_20: '🔥',
      streak_50: '🔥',
      // 特殊系列
      perfect_win: '💯',
      comeback_win: '💪',
      first_draw: '🤝',
      hundred_draws: '🤝',
      beat_ai_easy: '🤖',
      beat_ai_medium: '🤖',
      beat_ai_hard: '🤖',
      ai_killer: '🤖',
      ai_master: '',
      ai_terminator: '🤖',
      first_move: '',
      night_owl: '',
      weekend_warrior: '🎮',
      chatty_cathy: '💬',
      silent_killer: '',
      comeback_kid: '💪',
      jack_of_all_trades: '🌟',
      specialist: '🎯'
    };
    return iconMap[badgeId] || '🏅';
  }

  // 同步所有账号的勋章列表（迁移用）
  async syncAllBadges() {
    try {
      const accounts = await dataStore.find('accounts', {});
      let syncedCount = 0;

      for (const account of accounts) {
        const acctId = account.account?.id;
        if (!acctId) continue;

        const achievements = account.achievements || [];
        const existingBadges = account.badges || [];

        // 如果已经有勋章列表且不为空，跳过
        if (existingBadges.length > 0) continue;

        // 计算应该有哪些勋章
        const newBadges = [];
        for (const aid of achievements) {
          const achievement = this.achievements.find(a => a.id === aid);
          if (achievement && achievement.reward && achievement.reward.badge) {
            if (!newBadges.includes(achievement.reward.badge)) {
              newBadges.push(achievement.reward.badge);
            }
          }
        }

        // 如果有勋章需要添加
        if (newBadges.length > 0) {
          await dataStore.update('accounts', { 'account.id': acctId }, {
            badges: newBadges,
            'stats.badges': newBadges.length
          });
          syncedCount++;
          logger.info(`同步勋章: ${acctId} badges=${newBadges.length}`);
        }
      }

      if (syncedCount > 0) {
        logger.info(`勋章数据同步完成，共处理 ${syncedCount} 个账号`);
      } else {
        logger.info('勋章数据同步完成，无需更新的账号');
      }
    } catch (err) {
      logger.error('勋章数据同步失败', err);
    }
  }
}

module.exports = AchievementManager;