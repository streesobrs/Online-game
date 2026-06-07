// 数据持久化模块
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class DataStore {
  constructor() {
    this.dataDir = config.paths.data;
    this.cache = new Map();
    // 按ID拆分的集合配置
    this.splitByIdCollections = {
      'accounts': 'accounts',
      'games': 'games', // 游戏记录按ID拆分存储
      'currencyTransactions': 'currency_transactions', // 星钻交易记录按用户ID拆分存储
      'expTransactions': 'exp_transactions' // 经验变动记录按用户ID拆分存储
    };

    // 普通集合的目录映射
    this.collectionDirs = {
      'globalChats': 'chats',
      'gameChats': 'chats',
      'systemStats': 'system',
      'feedbacks': 'feedbacks'
    };
    this.init();
  }

  // 初始化数据目录
  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      logger.info('数据存储目录初始化完成', { path: this.dataDir });
    } catch (err) {
      logger.error('初始化数据目录失败', { error: err.message, path: this.dataDir });
    }
  }

  // 判断是否按ID拆分存储
  isSplitById(collection) {
    return this.splitByIdCollections.hasOwnProperty(collection);
  }

  // 获取集合的子目录
  getSubDir(collection) {
    return this.splitByIdCollections[collection] || this.collectionDirs[collection] || '';
  }

  // 读取数据
  async read(collection) {
    try {
      // 先检查缓存
      if (this.cache.has(collection)) {
        return this.cache.get(collection);
      }

      // 如果是按ID拆分的集合，读取整个目录
      if (this.isSplitById(collection)) {
        const subDir = this.splitByIdCollections[collection];
        const dirPath = path.join(this.dataDir, subDir);
        await fs.mkdir(dirPath, { recursive: true });

        try {
          const items = [];

          // 游戏记录需要遍历所有游戏类型文件夹
          if (collection === 'games') {
            // 读取所有游戏类型文件夹
            const gameTypeDirs = await fs.readdir(dirPath, { withFileTypes: true });
            const subdirectories = gameTypeDirs.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

            // 遍历每个游戏类型文件夹
            for (const gameType of subdirectories) {
              const gameTypePath = path.join(dirPath, gameType);
              const files = await fs.readdir(gameTypePath);
              const jsonFiles = files.filter(f => f.endsWith('.json'));

              for (const file of jsonFiles) {
                try {
                  const filePath = path.join(gameTypePath, file);
                  const data = await fs.readFile(filePath, 'utf8');
                  const item = JSON.parse(data);
                  items.push(item);
                } catch (err) {
                  logger.error('读取单个文件失败', { file, error: err.message });
                }
              }
            }
          } else {
            // 其他集合直接读取
            const files = await fs.readdir(dirPath);
            const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.backup'));

            for (const file of jsonFiles) {
              try {
                const filePath = path.join(dirPath, file);
                const data = await fs.readFile(filePath, 'utf8');
                const item = JSON.parse(data);
                items.push(item);
              } catch (err) {
                logger.error('读取单个文件失败', { file, error: err.message });
              }
            }
          }

          this.cache.set(collection, items);
          return items;
        } catch (err) {
          if (err.code === 'ENOENT') {
            return [];
          }
          throw err;
        }
      }

      // 普通集合，读取单个文件
      const subDir = this.collectionDirs[collection] || '';
      const filePath = subDir
        ? path.join(this.dataDir, subDir, `${collection}.json`)
        : path.join(this.dataDir, `${collection}.json`);

      if (subDir) {
        await fs.mkdir(path.join(this.dataDir, subDir), { recursive: true });
      }

      try {
        const data = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        this.cache.set(collection, parsed);
        return parsed;
      } catch (err) {
        if (err.code === 'ENOENT') {
          return [];
        }
        throw err;
      }
    } catch (err) {
      logger.error('读取数据失败', { collection, error: err.message });
      return [];
    }
  }

  // 写入数据
  async write(collection, data) {
    try {
      // 如果是按ID拆分的集合，逐个写入文件
      if (this.isSplitById(collection)) {
        const subDir = this.splitByIdCollections[collection];
        const dirPath = path.join(this.dataDir, subDir);
        await fs.mkdir(dirPath, { recursive: true });

        for (const item of data) {
          const id = item.id || item.userId;
          if (id) {
            const filePath = path.join(dirPath, `${id}.json`);
            await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf8');
          }
        }

        this.cache.set(collection, data);
        return true;
      }

      // 普通集合，写入单个文件
      const subDir = this.collectionDirs[collection] || '';
      const filePath = subDir
        ? path.join(this.dataDir, subDir, `${collection}.json`)
        : path.join(this.dataDir, `${collection}.json`);

      if (subDir) {
        await fs.mkdir(path.join(this.dataDir, subDir), { recursive: true });
      }

      logger.info('普通集合数据已保存', { collection, path: filePath });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.cache.set(collection, data);
      return true;
    } catch (err) {
      logger.error('写入数据失败', { collection, error: err.message });
      return false;
    }
  }

  // 读取单个记录（用于按ID拆分的集合）
  async readOne(collection, id) {
    try {
      if (!this.isSplitById(collection)) {
        // 非拆分集合，从缓存或文件中查找
        const data = await this.read(collection);
        return data.find(item => item.id === id || item.userId === id) || null;
      }

      const subDir = this.splitByIdCollections[collection];

      // 游戏记录需要遍历所有游戏类型文件夹查找
      if (collection === 'games') {
        const gamesDir = path.join(this.dataDir, subDir);

        try {
          // 读取所有游戏类型文件夹
          const gameTypeDirs = await fs.readdir(gamesDir, { withFileTypes: true });
          const subdirectories = gameTypeDirs.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

          // 遍历每个游戏类型文件夹查找记录
          for (const gameType of subdirectories) {
            const filePath = path.join(gamesDir, gameType, `${id}.json`);
            try {
              const data = await fs.readFile(filePath, 'utf8');
              return JSON.parse(data);
            } catch (err) {
              // 文件不存在，继续查找
              if (err.code !== 'ENOENT') {
                throw err;
              }
            }
          }
          // 所有文件夹都查找过了，没找到
          return null;
        } catch (err) {
          if (err.code === 'ENOENT') {
            return null;
          }
          throw err;
        }
      } else {
        // 其他集合直接查找
        const filePath = path.join(this.dataDir, subDir, `${id}.json`);

        try {
          const data = await fs.readFile(filePath, 'utf8');
          return JSON.parse(data);
        } catch (err) {
          if (err.code === 'ENOENT') {
            return null;
          }
          throw err;
        }
      }
    } catch (err) {
      logger.error('读取单条记录失败', { collection, id, error: err.message });
      return null;
    }
  }

  // 写入单个记录（用于按ID拆分的集合）
  async writeOne(collection, id, item) {
    try {
      if (!this.isSplitById(collection)) {
        // 非拆分集合，使用普通更新
        return await this.update(collection, id, item);
      }

      let subDir = this.splitByIdCollections[collection];
      let dirPath;

      // 游戏记录按类型存储到不同子文件夹
      if (collection === 'games' && item.gameType) {
        dirPath = path.join(this.dataDir, subDir, item.gameType);
      } else {
        dirPath = path.join(this.dataDir, subDir);
      }

      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${id}.json`);
      // 先写临时文件，再重命名，避免写入过程中崩溃导致文件损坏
      const tmpPath = filePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(item, null, 2), 'utf8');
      await fs.rename(tmpPath, filePath);

      logger.info('数据已保存到文件', { collection, id, path: filePath });

      // 更新缓存
      const cacheKey = `${collection}:${id}`;
      this.cache.set(cacheKey, item);
      // 清除集合缓存，确保下次读取时重新加载所有数据
      this.cache.delete(collection);

      return true;
    } catch (err) {
      logger.error('写入单条记录失败', { collection, id, error: err.message });
      return false;
    }
  }

  // 添加记录
  async add(collection, item) {
    let id = item.id || item.userId;

    // 游戏记录使用gameId作为ID
    if (collection === 'games' && item.gameId) {
      id = item.gameId;
    }

    // 如果顶层没有 id，尝试从 account.id 获取
    if (!id && item.account && item.account.id) {
      id = item.account.id;
    }

    logger.info('准备添加数据', {
      collection,
      itemId: item.id,
      itemUserId: item.userId,
      computedId: id,
      isSplitById: this.isSplitById(collection)
    });

    // 如果是按ID拆分的集合，直接写入单个文件
    if (this.isSplitById(collection) && id) {
      logger.info('使用 writeOne 保存数据', { collection, id });
      return await this.writeOne(collection, id, item);
    }

    logger.info('使用普通 write 保存数据', { collection });
    // 普通集合，添加到数组
    const data = await this.read(collection);
    data.push(item);
    return await this.write(collection, data);
  }

  // 处理嵌套字段更新
  processNestedUpdates(item, updates) {
    const updatedItem = { ...item };

    for (const [key, value] of Object.entries(updates)) {
      if (key.includes('.')) {
        // 处理嵌套字段，如 'stats.returnPlayer'
        const parts = key.split('.');
        let current = updatedItem;

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        current[lastPart] = value;
      } else {
        // 普通字段直接更新
        updatedItem[key] = value;
      }
    }

    return updatedItem;
  }

  // 更新记录
  async update(collection, query, updates) {
    // 如果是按ID拆分的集合，尝试提取ID并更新单个文件
    if (this.isSplitById(collection)) {
      let id;
      if (typeof query === 'string') {
        id = query;
      } else if (typeof query === 'object') {
        // 尝试从查询条件中提取ID
        if (query.id) {
          id = query.id;
        } else if (query.userId) {
          id = query.userId;
        } else if (query['account.id']) {
          id = query['account.id'];
        } else {
          // 如果查询条件是其他字段，先查找记录获取ID
          const items = await this.find(collection, query);
          if (items.length > 0) {
            id = items[0].id || items[0].userId;
          }
        }
      }

      if (id) {
        const item = await this.readOne(collection, id);
        if (item) {
          const updatedItem = this.processNestedUpdates(item, updates);
          updatedItem.updatedAt = Date.now();
          return await this.writeOne(collection, id, updatedItem);
        }
        return false;
      }
    }

    // 普通集合，更新数组中的记录
    const data = await this.read(collection);
    const index = data.findIndex(item => {
      if (typeof query === 'string') {
        return item.id === query || item.userId === query;
      } else if (typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
          if (this.getNestedValue(item, key) !== value) return false;
        }
        return true;
      }
      return false;
    });

    if (index !== -1) {
      data[index] = this.processNestedUpdates(data[index], updates);
      data[index].updatedAt = Date.now();
      return await this.write(collection, data);
    }
    return false;
  }

  // 删除记录
  async delete(collection, id) {
    // 如果是按ID拆分的集合，删除单个文件
    if (this.isSplitById(collection)) {
      try {
        const subDir = this.splitByIdCollections[collection];

        // 游戏记录需要遍历所有游戏类型文件夹查找
        if (collection === 'games') {
          const gamesDir = path.join(this.dataDir, subDir);

          try {
            // 读取所有游戏类型文件夹
            const gameTypeDirs = await fs.readdir(gamesDir, { withFileTypes: true });
            const subdirectories = gameTypeDirs.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

            // 遍历每个游戏类型文件夹查找并删除记录
            for (const gameType of subdirectories) {
              const filePath = path.join(gamesDir, gameType, `${id}.json`);
              try {
                await fs.unlink(filePath);

                // 清除缓存
                const cacheKey = `${collection}:${id}`;
                this.cache.delete(cacheKey);
                // 清除整个集合的缓存，确保下次读取时重新加载
                this.cache.delete(collection);

                return true;
              } catch (err) {
                // 文件不存在，继续查找
                if (err.code !== 'ENOENT') {
                  throw err;
                }
              }
            }
            // 所有文件夹都查找过了，没找到
            return false;
          } catch (err) {
            if (err.code === 'ENOENT') {
              return false;
            }
            throw err;
          }
        } else {
          // 其他集合直接删除
          const filePath = path.join(this.dataDir, subDir, `${id}.json`);
          await fs.unlink(filePath);

          // 清除缓存
          const cacheKey = `${collection}:${id}`;
          this.cache.delete(cacheKey);
          // 清除整个集合的缓存，确保下次读取时重新加载
          this.cache.delete(collection);

          return true;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          return false;
        }
        logger.error('删除文件失败', { collection, id, error: err.message });
        return false;
      }
    }

    // 普通集合，从数组中删除
    const data = await this.read(collection);
    const filtered = data.filter(item => item.id !== id);
    if (filtered.length !== data.length) {
      return await this.write(collection, filtered);
    }
    return false;
  }

  // 获取嵌套字段值
  getNestedValue(item, key) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let current = item;
      for (const part of parts) {
        if (!current || typeof current !== 'object') {
          return undefined;
        }
        current = current[part];
      }
      return current;
    }
    return item[key];
  }

  // 查找记录
  async find(collection, query) {
    // 如果是按ID拆分的集合，读取所有文件后过滤
    if (this.isSplitById(collection)) {
      const data = await this.read(collection);
      return data.filter(item => {
        for (const [key, value] of Object.entries(query)) {
          // 支持 $ne 操作符
          if (value && typeof value === 'object' && value.$ne !== undefined) {
            if (this.getNestedValue(item, key) === value.$ne) return false;
          } else if (this.getNestedValue(item, key) !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // 普通集合
    const data = await this.read(collection);
    return data.filter(item => {
      for (const [key, value] of Object.entries(query)) {
        // 支持 $ne 操作符
        if (value && typeof value === 'object' && value.$ne !== undefined) {
          if (this.getNestedValue(item, key) === value.$ne) return false;
        } else if (this.getNestedValue(item, key) !== value) {
          return false;
        }
      }
      return true;
    });
  }

  // 查找单条记录
  async findOne(collection, query) {
    // 如果是按ID拆分的集合且query包含id或userId，直接读取单个文件
    if (this.isSplitById(collection)) {
      if (typeof query === 'object') {
        if (query.id) {
          return await this.readOne(collection, query.id);
        }
        if (query.userId) {
          return await this.readOne(collection, query.userId);
        }
        if (query['account.id']) {
          return await this.readOne(collection, query['account.id']);
        }
      }
    }

    const results = await this.find(collection, query);
    return results[0] || null;
  }

  // 清空缓存
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new DataStore();
