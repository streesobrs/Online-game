const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ThemeManager {
  constructor(dataStore) {
    this.dataStore = dataStore;
    this.themes = new Map();
    this.themesDir = path.join(__dirname, '..', 'config', 'themes');
    this.cssBaseUrl = '/themes';
    this.init();
  }

  async init() {
    try {
      await this.loadThemes();
      logger.info('主题管理器初始化完成', { themeCount: this.themes.size });
    } catch (err) {
      logger.error('主题管理器初始化失败', { error: err.message });
    }
  }

  async loadThemes() {
    try {
      if (!fs.existsSync(this.themesDir)) {
        fs.mkdirSync(this.themesDir, { recursive: true });
        logger.info('创建主题目录', { dir: this.themesDir });
      }

      const files = fs.readdirSync(this.themesDir);
      const themeFiles = files.filter(file => file.endsWith('.json'));

      for (const file of themeFiles) {
        try {
          const filePath = path.join(this.themesDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const theme = JSON.parse(content);

          if (theme.id && theme.name) {
            // 关联同目录下的主题 CSS 文件（新皮肤格式：元数据 json + 样式 css）
            const cssFile = `${theme.id}.css`;
            if (fs.existsSync(path.join(this.themesDir, cssFile))) {
              theme.cssUrl = `${this.cssBaseUrl}/${cssFile}`;
            } else {
              theme.cssUrl = '';
            }
            this.themes.set(theme.id, theme);
            logger.info('加载主题', { id: theme.id, name: theme.name, cssUrl: theme.cssUrl });
          }
        } catch (err) {
          logger.warn('加载主题文件失败', { file, error: err.message });
        }
      }

      logger.info('主题加载完成', { count: this.themes.size });
    } catch (err) {
      logger.error('加载主题失败', { error: err.message });
    }
  }

  getAllThemes() {
    const themes = {};
    this.themes.forEach((theme, id) => {
      themes[id] = theme;
    });
    return themes;
  }

  getTheme(id) {
    return this.themes.get(id);
  }

  async addTheme(theme) {
    try {
      if (!theme.id || !theme.name) {
        return {
          success: false,
          message: '主题ID和名称不能为空'
        };
      }

      if (this.themes.has(theme.id)) {
        return {
          success: false,
          message: '主题ID已存在'
        };
      }

      this.themes.set(theme.id, theme);

      const filePath = path.join(this.themesDir, `${theme.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(theme, null, 2), 'utf8');

      logger.info('添加主题', { id: theme.id, name: theme.name });

      return {
        success: true,
        message: '主题添加成功',
        data: theme
      };
    } catch (err) {
      logger.error('添加主题失败', { error: err.message });
      return {
        success: false,
        message: '添加主题失败'
      };
    }
  }

  async updateTheme(id, updates) {
    try {
      const theme = this.themes.get(id);
      if (!theme) {
        return {
          success: false,
          message: '主题不存在'
        };
      }

      const updatedTheme = { ...theme, ...updates };
      this.themes.set(id, updatedTheme);

      const filePath = path.join(this.themesDir, `${id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(updatedTheme, null, 2), 'utf8');

      logger.info('更新主题', { id, name: updatedTheme.name });

      return {
        success: true,
        message: '主题更新成功',
        data: updatedTheme
      };
    } catch (err) {
      logger.error('更新主题失败', { id, error: err.message });
      return {
        success: false,
        message: '更新主题失败'
      };
    }
  }

  async deleteTheme(id) {
    try {
      if (!this.themes.has(id)) {
        return {
          success: false,
          message: '主题不存在'
        };
      }

      const theme = this.themes.get(id);
      this.themes.delete(id);

      const filePath = path.join(this.themesDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      logger.info('删除主题', { id, name: theme.name });

      return {
        success: true,
        message: '主题删除成功'
      };
    } catch (err) {
      logger.error('删除主题失败', { id, error: err.message });
      return {
        success: false,
        message: '删除主题失败'
      };
    }
  }

  async reloadThemes() {
    this.themes.clear();
    await this.loadThemes();
    return {
      success: true,
      message: '主题重新加载完成',
      data: { count: this.themes.size }
    };
  }
}

module.exports = ThemeManager;