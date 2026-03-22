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
      'accounts': 'users'
    };
    // 普通集合的目录映射
    this.collectionDirs = {
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
          const files = await fs.readdir(dirPath);
          const jsonFiles = files.filter(f => f.endsWith('.json'));
          const items = [];

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

      const subDir = this.splitByIdCollections[collection];
      const dirPath = path.join(this.dataDir, subDir);
      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${id}.json`);
      await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf8');

      // 更新缓存
      const cacheKey = `${collection}:${id}`;
      this.cache.set(cacheKey, item);

      return true;
    } catch (err) {
      logger.error('写入单条记录失败', { collection, id, error: err.message });
      return false;
    }
  }

  // 添加记录
  async add(collection, item) {
    const id = item.id || item.userId;

    // 如果是按ID拆分的集合，直接写入单个文件
    if (this.isSplitById(collection) && id) {
      return await this.writeOne(collection, id, item);
    }

    // 普通集合，添加到数组
    const data = await this.read(collection);
    data.push(item);
    return await this.write(collection, data);
  }

  // 更新记录
  async update(collection, query, updates) {
    // 如果是按ID拆分的集合且query是字符串，直接更新单个文件
    if (this.isSplitById(collection) && typeof query === 'string') {
      const item = await this.readOne(collection, query);
      if (item) {
        const updatedItem = { ...item, ...updates, updatedAt: Date.now() };
        return await this.writeOne(collection, query, updatedItem);
      }
      return false;
    }

    // 普通集合，更新数组中的记录
    const data = await this.read(collection);
    const index = data.findIndex(item => {
      if (typeof query === 'string') {
        return item.id === query || item.userId === query;
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
    // 如果是按ID拆分的集合，删除单个文件
    if (this.isSplitById(collection)) {
      try {
        const subDir = this.splitByIdCollections[collection];
        const filePath = path.join(this.dataDir, subDir, `${id}.json`);
        await fs.unlink(filePath);

        // 清除缓存
        const cacheKey = `${collection}:${id}`;
        this.cache.delete(cacheKey);
        // 清除整个集合的缓存，确保下次读取时重新加载
        this.cache.delete(collection);

        return true;
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

  // 查找记录
  async find(collection, query) {
    // 如果是按ID拆分的集合，读取所有文件后过滤
    if (this.isSplitById(collection)) {
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

    // 普通集合
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
    // 如果是按ID拆分的集合且query包含id或userId，直接读取单个文件
    if (this.isSplitById(collection)) {
      if (typeof query === 'object') {
        if (query.id) {
          return await this.readOne(collection, query.id);
        }
        if (query.userId) {
          return await this.readOne(collection, query.userId);
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
