const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');
const config = require('../config');

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
      await this.enrichNicknames(feedbacks);
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
      await this.enrichNicknames([feedback]);
      return { success: true, feedback };
    } catch (err) {
      logger.error('获取反馈详情失败', { feedbackId, error: err.message });
      return { success: false, message: '获取失败' };
    }
  }

  // 动态填充评论/回复中的当前昵称
  async enrichNicknames(feedbacks) {
    if (!this.accountManager) return; // 未注入时跳过
    const cache = {};
    const getNickname = async (accountId) => {
      if (cache[accountId]) return cache[accountId];
      const account = await this.accountManager.getAccount(accountId);
      cache[accountId] = account?.account?.nickname || account?.account?.username || accountId?.slice(0, config.display.nicknameTruncateLength) || '未知';
      return cache[accountId];
    };

    for (const fb of feedbacks) {
      if (fb.accountId) fb.nickname = await getNickname(fb.accountId);
      for (const c of (fb.comments || [])) {
        c.nickname = await getNickname(c.accountId);
        // 递归填充楼中楼
        await this._enrichReplies(c.replies || [], getNickname);
      }
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

  // 递归查找评论树中的某个节点（通过ID）
  _findNode(comments, targetId) {
    for (const c of comments) {
      if (c.id === targetId) return c;
      if (c.replies && c.replies.length > 0) {
        const found = this._findNode(c.replies, targetId);
        if (found) return found;
      }
    }
    return null;
  }

  // 递归删除评论树中的某个节点
  _deleteNode(comments, targetId, accountId) {
    for (let i = 0; i < comments.length; i++) {
      if (comments[i].id === targetId) {
        if (comments[i].accountId !== accountId) return { success: false, message: '无权删除' };
        comments.splice(i, 1);
        return { success: true };
      }
      if (comments[i].replies && comments[i].replies.length > 0) {
        const result = this._deleteNode(comments[i].replies, targetId, accountId);
        if (result) return result;
      }
    }
    return null;
  }

  // 递归填充昵称
  async _enrichReplies(replies, getNickname) {
    if (!replies) return;
    for (const r of replies) {
      r.nickname = await getNickname(r.accountId);
      if (r.replies && r.replies.length > 0) {
        await this._enrichReplies(r.replies, getNickname);
      }
    }
  }

  // 添加评论
  async addComment(feedbackId, accountId, content) {
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
        content,
        replies: [],
        likes: [],
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

  // 楼中楼回复（支持无限嵌套，任意节点均可回复）
  async replyComment(feedbackId, nodeId, accountId, content) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) return { success: false, message: '反馈不存在' };

      // 递归查找目标节点（顶层评论或任意嵌套回复）
      const target = this._findNode(feedbacks[feedbackIndex].comments, nodeId);
      if (!target) return { success: false, message: '目标节点不存在' };

      if (!target.replies) target.replies = [];
      target.replies.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        accountId,
        content,
        replies: [],
        createdAt: Date.now()
      });

      feedbacks[feedbackIndex].updatedAt = Date.now();
      await dataStore.write('feedbacks', feedbacks);
      logger.info('楼中楼回复', { feedbackId, nodeId, accountId });
      return { success: true, feedback: feedbacks[feedbackIndex] };
    } catch (err) {
      logger.error('楼中楼回复失败', { error: err.message });
      return { success: false, message: '回复失败' };
    }
  }

  // 评论点赞/取消点赞（递归支持任意嵌套层级）
  async likeComment(feedbackId, nodeId, accountId) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) return { success: false, message: '反馈不存在' };

      const feedback = feedbacks[feedbackIndex];

      // 递归查找目标节点
      let target = null;
      for (const c of feedback.comments) {
        if (c.id === nodeId) { target = c; break; }
        if (c.replies && c.replies.length > 0) {
          target = this._findNode(c.replies, nodeId);
          if (target) break;
        }
      }
      if (!target) return { success: false, message: '节点不存在' };

      if (!target.likes) target.likes = [];
      const idx = target.likes.indexOf(accountId);
      if (idx !== -1) {
        target.likes.splice(idx, 1); // 取消点赞
      } else {
        target.likes.push(accountId); // 点赞
      }

      feedback.updatedAt = Date.now();
      await dataStore.write('feedbacks', feedbacks);
      return { success: true, feedback };
    } catch (err) {
      logger.error('评论点赞失败', { error: err.message });
      return { success: false, message: '点赞失败' };
    }
  }

  // 删除自己的评论或回复（递归支持无限嵌套，nodeId可以是任意层级节点）
  async deleteComment(feedbackId, nodeId, accountId) {
    try {
      const feedbacks = await dataStore.read('feedbacks');
      const feedbackIndex = feedbacks.findIndex(f => f.id === feedbackId);
      if (feedbackIndex === -1) return { success: false, message: '反馈不存在' };

      const feedback = feedbacks[feedbackIndex];
      const comments = feedback.comments;

      // 1. 尝试查找顶层评论
      const cIdx = comments.findIndex(c => c.id === nodeId);
      if (cIdx !== -1) {
        if (comments[cIdx].accountId !== accountId) return { success: false, message: '无权删除' };
        comments.splice(cIdx, 1);
        feedback.updatedAt = Date.now();
        await dataStore.write('feedbacks', feedbacks);
        return { success: true, feedback };
      }

      // 2. 递归查找嵌套回复
      for (const c of comments) {
        if (c.replies && c.replies.length > 0) {
          const result = this._deleteNode(c.replies, nodeId, accountId);
          if (result) {
            if (!result.success) return result;
            feedback.updatedAt = Date.now();
            await dataStore.write('feedbacks', feedbacks);
            return { success: true, feedback };
          }
        }
      }

      return { success: false, message: '节点不存在' };
    } catch (err) {
      logger.error('删除评论失败', { error: err.message });
      return { success: false, message: '删除失败' };
    }
  }
}

module.exports = new FeedbackManager();
