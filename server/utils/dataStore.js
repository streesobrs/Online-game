// 数据持久化模块
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class DataStore {
  constructor() {
    this.dataDir = config.paths.data;
    this.cache = new Map();
    this.collectionDirs = {
      'accounts': 'users',
      'games': 'games',
      'globalChats': 'chats',
      'gameChats': 'chats',
      'systemStats': 'system'
    };
    this.init();
  }

  // 初始化数据目录
  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      logger.info('数据存储目录初始化完成');
    } catch (err) {
      logger.error('初始化数据目录失败', { error: err.message });
    }
  }

  // 读取数据
  async read(collection) {
    try {
      // 先检查缓存
      if (this.cache.has(collection)) {
        return this.cache.get(collection);
      }

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

  // 读取数据（支持子目录）
  async readWithDir(collection, subDir) {
    try {
      const cacheKey = `${subDir}/${collection}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const dirPath = path.join(this.dataDir, subDir);
      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${collection}.json`);
      try {
        const data = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        this.cache.set(cacheKey, parsed);
        return parsed;
      } catch (err) {
        if (err.code === 'ENOENT') {
          return [];
        }
        throw err;
      }
    } catch (err) {
      logger.error('读取数据失败', { collection, subDir, error: err.message });
      return [];
    }
  }

  // 写入数据
  async write(collection, data) {
    try {
      const subDir = this.collectionDirs[collection] || '';
      const filePath = subDir
        ? path.join(this.dataDir, subDir, `${collection}.json`)
        : path.join(this.dataDir, `${collection}.json`);

      if (subDir) {
        await fs.mkdir(path.join(this.dataDir, subDir), { recursive: true });
      }

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.cache.set(collection, data);
      return true;
    } catch (err) {
      logger.error('写入数据失败', { collection, error: err.message });
      return false;
    }
  }

  // 写入数据（支持子目录）
  async writeWithDir(collection, data, subDir) {
    try {
      const dirPath = path.join(this.dataDir, subDir);
      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${collection}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.cache.set(`${subDir}/${collection}`, data);
      return true;
    } catch (err) {
      logger.error('写入数据失败', { collection, subDir, error: err.message });
      return false;
    }
  }

  // 添加记录
  async add(collection, item) {
    const data = await this.read(collection);
    data.push(item);
    return await this.write(collection, data);
  }

  // 更新记录
  async update(collection, query, updates) {
    const data = await this.read(collection);
    const index = data.findIndex(item => {
      if (typeof query === 'string') {
        return item.id === query;
      } else if (typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
          if (item[key] !== value) return false;
        }
        return true;
      }
      return false;
    });
    if (index !== -1) {
      data[index] = { ...data[index], ...updates, updatedAt: Date.now() };
      return await this.write(collection, data);
    }
    return false;
  }

  // 删除记录
  async delete(collection, id) {
    const data = await this.read(collection);
    const filtered = data.filter(item => item.id !== id);
    if (filtered.length !== data.length) {
      return await this.write(collection, filtered);
    }
    return false;
  }

  // 查找记录
  async find(collection, query) {
    const data = await this.read(collection);
    return data.filter(item => {
      for (const [key, value] of Object.entries(query)) {
        // 支持 $ne 操作符
        if (value && typeof value === 'object' && value.$ne !== undefined) {
          if (item[key] === value.$ne) return false;
        } else if (item[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  // 查找单条记录
  async findOne(collection, query) {
    const results = await this.find(collection, query);
    return results[0] || null;
  }

  // 清空缓存
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new DataStore();
