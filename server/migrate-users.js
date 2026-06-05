const fs = require('fs');
const path = require('path');

const usersDir = path.join(__dirname, 'data', 'users');

function migrateUserData(oldData) {
  const now = Date.now();

  // 创建新数据结构
  const newData = {
    account: {
      id: oldData.id,
      type: oldData.type || 'guest',
      username: oldData.username || null,
      nickname: oldData.nickname || `玩家${oldData.id.substring(0, 4)}`,
      createdAt: oldData.createdAt || now,
      updatedAt: oldData.updatedAt || now,
      lastSeen: oldData.lastSeen || now,
      lastLogin: oldData.lastLogin || now,
      loginCount: oldData.stats?.loginCount || 1,
      profile: {
        avatar: oldData.profile?.avatar || null,
        bio: oldData.profile?.bio || '',
        exp: oldData.profile?.exp || 0,
        level: oldData.profile?.level || 1
      },
      security: {
        passwordSalt: oldData.passwordSalt || null,
        passwordHash: oldData.passwordHash || null
      },
      activity: {
        chatMessages: oldData.stats?.chatMessages || 0,
        signInStreak: oldData.stats?.signInStreak || 0,
        returnPlayer: oldData.stats?.returnPlayer || false,
        longReturnPlayer: oldData.stats?.longReturnPlayer || false,
        dailyGames: oldData.stats?.dailyGames || 0,
        weeklyGames: oldData.stats?.weeklyGames || 0,
        monthlyGames: oldData.stats?.monthlyGames || 0,
        lastDailyReset: oldData.stats?.lastDailyReset || now,
        lastWeeklyReset: oldData.stats?.lastWeeklyReset || now,
        lastMonthlyReset: oldData.stats?.lastMonthlyReset || now
      }
    },
    games: {
      gobang: {
        wins: oldData.stats?.gameTypeWins?.gobang || 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        streak: 0,
        maxStreak: 0,
        aiWins: oldData.stats?.aiWins || 0,
        aiDifficulty: oldData.stats?.aiDifficulty || null,
        aiResult: oldData.stats?.aiResult || null,
        lastPlayedAt: null
      },
      chess: {
        wins: oldData.stats?.gameTypeWins?.chess || 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        streak: 0,
        maxStreak: 0,
        lastPlayedAt: null
      },
      go: {
        wins: oldData.stats?.gameTypeWins?.go || 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        streak: 0,
        maxStreak: 0,
        lastPlayedAt: null
      },
      snake: {
        totalGames: oldData.stats?.snakeGames?.totalGames || 0,
        highScore: oldData.stats?.snakeGames?.highScore || 0,
        totalScore: oldData.stats?.snakeGames?.totalScore || 0,
        lastPlayedAt: null
      }
    },
    stats: {
      totalGames: oldData.stats?.totalGames || 0,
      totalWins: oldData.stats?.wins || 0,
      totalLosses: oldData.stats?.losses || 0,
      totalDraws: oldData.stats?.draws || 0,
      comebackStreak: oldData.stats?.comebackStreak || 0,
      lowLevelWins: oldData.stats?.lowLevelWins || 0,
      lastGamePlayedAt: oldData.stats?.lastGamePlayedAt || null,
      flags: {
        firstGame: oldData.stats?.firstGame !== undefined ? oldData.stats.firstGame : true,
        nightGame: oldData.stats?.nightGame || false,
        weekendGame: oldData.stats?.weekendGame || false,
        silentWin: oldData.stats?.silentWin || false,
        allGameTypes: oldData.stats?.allGameTypes || false,
        singleGameType: oldData.stats?.singleGameType || false,
        quickGame: oldData.stats?.quickGame !== undefined ? oldData.stats.quickGame : true,
        slowGame: oldData.stats?.slowGame || false,
        luckyWin: oldData.stats?.luckyWin || false,
        unluckyLoss: oldData.stats?.unluckyLoss || false,
        lonerWin: oldData.stats?.lonerWin || false
      }
    },
    permissions: {
      role: oldData.type || 'guest',
      access: {
        chat: true,
        createGame: true,
        joinGame: true,
        spectate: true,
        leaderboard: true
      }
    },
    social: {
      friends: oldData.stats?.friends || 0,
      invites: oldData.stats?.invites || 0
    },
    achievements: []
  };

  // 迁移成就数据
  if (oldData.achievements && Array.isArray(oldData.achievements)) {
    newData.achievements = oldData.achievements.map(achievementId => ({
      id: achievementId,
      unlockedAt: oldData.createdAt || now
    }));
  }

  // 计算各游戏的总数
  const gameTypes = ['gobang', 'chess', 'go'];
  gameTypes.forEach(gameType => {
    const wins = newData.games[gameType].wins || 0;
    const losses = newData.games[gameType].losses || 0;
    const draws = newData.games[gameType].draws || 0;
    newData.games[gameType].totalGames = wins + losses + draws;
    newData.stats.totalGames += wins + losses + draws;
    newData.stats.totalWins += wins;
    newData.stats.totalLosses += losses;
    newData.stats.totalDraws += draws;
  });

  // 贪吃蛇游戏统计
  if (newData.games.snake.totalGames > 0) {
    newData.stats.totalGames += newData.games.snake.totalGames;
  }

  // 更新连胜信息到五子棋
  if (oldData.stats?.streak !== undefined) {
    newData.games.gobang.streak = oldData.stats.streak;
  }
  if (oldData.stats?.maxStreak !== undefined) {
    newData.games.gobang.maxStreak = oldData.stats.maxStreak;
  }

  return newData;
}

function migrateAllUsers() {
  console.log('开始迁移用户数据...');

  const files = fs.readdirSync(usersDir);
  const jsonFiles = files.filter(file => file.endsWith('.json') && !file.startsWith('new_structure'));

  let successCount = 0;
  let errorCount = 0;

  jsonFiles.forEach(file => {
    try {
      const filePath = path.join(usersDir, file);
      const oldData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // 检查是否已经是新结构
      if (oldData.account && oldData.games && oldData.stats) {
        console.log(`跳过 ${file} - 已经是新结构`);
        successCount++;
        return;
      }

      const newData = migrateUserData(oldData);

      // 备份原文件
      const backupPath = filePath + '.backup';
      fs.writeFileSync(backupPath, JSON.stringify(oldData, null, 2));

      // 写入新数据
      fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));

      console.log(`✓ 成功迁移 ${file}`);
      successCount++;
    } catch (error) {
      console.error(`✗ 迁移失败 ${file}:`, error.message);
      errorCount++;
    }
  });

  console.log(`\n迁移完成！`);
  console.log(`成功: ${successCount} 个文件`);
  console.log(`失败: ${errorCount} 个文件`);
  console.log(`备份文件已创建，后缀为 .backup`);
}

if (require.main === module) {
  migrateAllUsers();
}

module.exports = { migrateUserData };