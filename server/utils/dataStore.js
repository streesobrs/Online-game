// 数据持久化模块
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class DataStore {
  constructor() {
    this.dataDir = config.paths.data;
    this.cache = new Map();
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

      const filePath = path.join(this.dataDir, `${collection}.json`);
      try {
        const data = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        this.cache.set(collection, parsed);
        return parsed;
      } catch (err) {
        if (err.code === 'ENOENT') {
          // 文件不存在，返回空数组
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
      const filePath = path.join(this.dataDir, `${collection}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.cache.set(collection, data);
      return true;
    } catch (err) {
      logger.error('写入数据失败', { collection, error: err.message });
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
  async update(collection, id, updates) {
    const data = await this.read(collection);
    const index = data.findIndex(item => item.id === id);
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
