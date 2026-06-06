const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class FeedbackManager {
  constructor() {
  }

  // 提交反馈
  async submitFeedback(accountId, nickname, type, title, content) {
    try {
      const feedbackId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      const feedback = {
        id: feedbackId,
        accountId,
        nickname,
        type: type || 'other', // bug, feature, question, other
        title,
        content,
        status: 'pending', // pending, processing, resolved, closed
        votes: [],
        comments: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await dataStore.add('feedbacks', feedback);
      logger.info('反馈已提交', { feedbackId, accountId, type, title });
      return { success: true, feedback };
    } catch (err) {
      logger.error('提交反馈失败', { accountId, error: err.message });
      return { success: false, message: '提交失败' };
    }
  }

  // 获取反馈列表
  async getFeedbackList() {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      // 按创建时间倒序排列，最新的在最前面
      return feedbacks.sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      logger.error('获取反馈列表失败', { error: err.message });
      return [];
    }
  }

  // 获取单个反馈详情
  async getFeedback(feedbackId) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedback = feedbacks.find(f => f.id === feedbackId);
      if (!feedback) {
        return { success: false, message: '反馈不存在' };
      }
      return { success: true, feedback };
    } catch (err) {
      logger.error('获取反馈详情失败', { feedbackId, error: err.message });
      return { success: false, message: '获取失败' };
    }
  }

  // 投票
  async voteFeedback(feedbackId, accountId, voteType = 'up') {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) {
        return { success: false, message: '反馈不存在' };
      }

      const feedback = feedbacks[feedbackIndex];

      // 检查是否已经投过票
      const existingVoteIndex = feedback.votes.findIndex(v => v.accountId === accountId);
      if (existingVoteIndex !== -1) {
        // 已投过票，取消投票
        feedback.votes.splice(existingVoteIndex, 1);
      } else {
        // 新投票
        feedback.votes.push({
          accountId,
          type: voteType,
          createdAt: Date.now()
        });
      }

      feedback.updatedAt = Date.now();
      feedbacks[feedbackIndex] = feedback;
      await dataStore.write('feedbacks', feedbacks);
      logger.info('反馈投票', { feedbackId, accountId, voteType });
      return { success: true, feedback };
    } catch (err) {
      logger.error('投票失败', { feedbackId, accountId, error: err.message });
      return { success: false, message: '投票失败' };
    }
  }

  // 添加评论
  async addComment(feedbackId, accountId, nickname, content) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) {
        return { success: false, message: '反馈不存在' };
      }

      const feedback = feedbacks[feedbackIndex];
      const commentId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

      feedback.comments.push({
        id: commentId,
        accountId,
        nickname,
        content,
        createdAt: Date.now()
      });

      feedback.updatedAt = Date.now();
      feedbacks[feedbackIndex] = feedback;
      await dataStore.write('feedbacks', feedbacks);
      logger.info('添加反馈评论', { feedbackId, commentId, accountId });
      return { success: true, feedback };
    } catch (err) {
      logger.error('添加评论失败', { feedbackId, accountId, error: err.message });
      return { success: false, message: '添加评论失败' };
    }
  }

  // 更新反馈状态（管理员功能）
  async updateFeedbackStatus(feedbackId, status) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) {
        return { success: false, message: '反馈不存在' };
      }

      const feedback = feedbacks[feedbackIndex];
      feedback.status = status;
      feedback.updatedAt = Date.now();
      feedbacks[feedbackIndex] = feedback;
      await dataStore.write('feedbacks', feedbacks);
      logger.info('更新反馈状态', { feedbackId, status });
      return { success: true, feedback };
    } catch (err) {
      logger.error('更新反馈状态失败', { feedbackId, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }
}

module.exports = new FeedbackManager();
