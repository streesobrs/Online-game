/**
 * 帮助/反馈模块（任务 6）
 * 复刻 v1 feedback.html：提交反馈 + 反馈列表 + 点赞 + 评论（含楼中楼回复/评论点赞/删除自己的评论）。
 *
 * 数据流：
 * - 初始加载与提交：HTTP（GET/POST /api/feedbacks，对齐 v1）
 * - 投票/评论/回复/点赞/删除：socket 事件，服务端操作成功后广播 feedbacks_list → eventBus 'feedback:list' 全量刷新
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { api } from '../../core/api.js';
import { go } from '../../core/router.js';

// ===== 类型/状态配置（对齐 v1 feedback.html）=====
const TYPE_CONFIG = {
  bug: { label: 'Bug 反馈', cls: 'type-bug' },
  feature: { label: '功能建议', cls: 'type-feature' },
  question: { label: '问题咨询', cls: 'type-question' },
  other: { label: '其他', cls: 'type-other' },
};
const STATUS_CONFIG = {
  pending: { label: '待处理', cls: 'status-pending' },
  processing: { label: '处理中', cls: 'status-processing' },
  resolved: { label: '已解决', cls: 'status-resolved' },
  closed: { label: '已关闭', cls: 'status-closed' },
};

// 当前登录账号
const myAccountId = localStorage.getItem('currentAccountId');
const myNickname = localStorage.getItem('nickname') || '玩家';

// 展开状态（列表重渲染时保留）
const state = {
  expanded: new Set(), // 已展开的评论区（feedbackId）
  shownReplies: new Set(), // 已展开全部回复的节点 key: `${feedbackId}:${commentId}`
};

// ===== 工具函数 =====
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 递归统计评论总数（含楼中楼） */
function countAllComments(comments) {
  if (!comments || !comments.length) return 0;
  return comments.reduce((sum, c) => sum + 1 + countAllComments(c.replies), 0);
}

/** 递归收集某条评论的所有回复（含嵌套），replyToNickname 为被回复者的昵称 */
function collectReplies(node, result, replyToNickname) {
  if (node.replies && node.replies.length) {
    node.replies.forEach((reply) => {
      result.push({ reply, replyToNickname });
      collectReplies(reply, result, reply.nickname);
    });
  }
}

/** 提取反馈列表（兼容 HTTP 返回 {success,data} 与 socket 广播 {feedbacks}） */
function extractList(data) {
  if (data && Array.isArray(data.feedbacks)) return data.feedbacks;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

/** 首字母头像 */
function avatar(nickname) {
  return el('div', { class: 'fb-avatar' },
    el('div', { class: 'fb-avatar-circle' }, String(nickname || '匿').charAt(0))
  );
}

// ===== socket 交互（操作成功后服务端广播 feedbacks_list 自动刷新）=====
function vote(feedbackId) {
  if (!myAccountId) { toast.warn('请先登录'); return; }
  emit('vote_feedback', { feedbackId, voteType: 'up' });
}

function addComment(feedbackId, input) {
  const content = input.value.trim();
  if (!content) { toast.warn('请输入评论内容'); return; }
  if (!myAccountId) { toast.warn('请先登录'); return; }
  input.value = '';
  emit('add_comment', { feedbackId, content });
}

function sendReply(feedbackId, commentId, input) {
  const content = input.value.trim();
  if (!content) return;
  if (!myAccountId) { toast.warn('请先登录'); return; }
  input.value = '';
  emit('reply_comment', { feedbackId, commentId, content });
}

function likeComment(feedbackId, commentId) {
  if (!myAccountId) { toast.warn('请先登录'); return; }
  emit('like_comment', { feedbackId, commentId });
}

function deleteComment(feedbackId, nodeId) {
  if (!myAccountId) return;
  modal.show({
    title: '删除评论',
    content: '确定删除这条评论吗？',
    confirmText: '删除',
    onConfirm: () => emit('delete_comment', { feedbackId, commentId: nodeId }),
  });
}

/** 展开/收起回复输入框 */
function toggleReplyBox(replyBox) {
  replyBox.style.display = replyBox.style.display === 'flex' ? 'none' : 'flex';
  if (replyBox.style.display === 'flex') replyBox.querySelector('input').focus();
}

/**
 * 渲染帮助/反馈视图（路由 #/feedback）
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderFeedback(container = viewRoot()) {
  container.innerHTML = '';

  // 登录检测：v1 要求登录才能打开反馈页
  if (!localStorage.getItem('userToken')) {
    container.append(
      el('div', { class: 'fb-page' }, [
        el('div', { class: 'fb-title' }, '📝 帮助/反馈'),
        el('div', { class: 'fb-login-tip' }, [
          el('p', {}, '登录后才能提交反馈与评论'),
          el('button', { class: 'lobby-btn', onClick: () => go('games') }, '返回大厅'),
        ]),
      ])
    );
    return () => {};
  }

  const listEl = el('div', { class: 'fb-list' });
  const typeSelect = el('select', { class: 'fb-select' },
    Object.entries(TYPE_CONFIG).map(([key, cfg]) => el('option', { value: key }, cfg.label))
  );
  const titleInput = el('input', { class: 'fb-input', placeholder: '一句话概括你的问题或建议', maxlength: 50 });
  const contentInput = el('textarea', { class: 'fb-textarea', placeholder: '详细描述你的问题或建议（可附操作步骤）' });
  const submitBtn = el('button', { class: 'fb-submit-btn' }, '提交反馈');

  container.append(
    el('div', { class: 'fb-page' }, [
      el('div', { class: 'fb-title' }, '📝 帮助/反馈'),
      el('div', { class: 'fb-submit-card' }, [
        el('h2', { class: 'fb-submit-title' }, '✍️ 提交反馈'),
        el('div', { class: 'fb-form-row' }, [typeSelect, titleInput]),
        contentInput,
        submitBtn,
      ]),
      el('div', { class: 'fb-list-title' }, '📋 全部反馈'),
      listEl,
    ])
  );

  // 当前反馈列表（广播/加载时更新，供局部重渲染）
  let currentList = [];

  /** 渲染单条评论/回复（B站风格，带头像与楼中楼） */
  function renderCommentNode(node, feedback, isNested = false, replyToNickname = null) {
    const liked = node.likes && node.likes.indexOf(myAccountId) !== -1;
    const isOwner = node.accountId === myAccountId;
    const key = `${feedback.id}:${node.id}`;

    const replyInput = el('input', { class: 'fb-reply-input', placeholder: `回复 ${node.nickname}...` });
    replyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendReply(feedback.id, node.id, replyInput);
    });
    const replyBox = el('div', { class: 'fb-reply-box', style: { display: 'none' } }, [
      replyInput,
      el('button', { class: 'fb-reply-send', onClick: () => sendReply(feedback.id, node.id, replyInput) }, '发送'),
    ]);

    const actionBtns = [
      el('span', { class: 'fb-comment-time' }, formatDate(node.createdAt)),
      el('button', { class: `fb-like-btn ${liked ? 'liked' : ''}`, onClick: () => likeComment(feedback.id, node.id) }, `👍 ${(node.likes && node.likes.length) || 0}`),
      el('button', { class: 'fb-reply-btn', onClick: () => toggleReplyBox(replyBox) }, '回复'),
    ];
    if (isOwner) {
      actionBtns.push(el('button', { class: 'fb-delete-btn', onClick: () => deleteComment(feedback.id, node.id) }, '删除'));
    }

    // 内容（楼中楼显示 @被回复者）
    const contentEls = [];
    if (isNested && replyToNickname) {
      contentEls.push(el('span', { class: 'fb-at-user' }, `@${replyToNickname}`), ' ');
    }
    contentEls.push(node.content);

    // 楼中楼回复：默认只展示前 2 条，超出部分可展开
    const replies = [];
    collectReplies(node, replies, node.nickname);
    const replyNodes = [];
    if (replies.length > 0) {
      const showCount = state.shownReplies.has(key) ? replies.length : Math.min(2, replies.length);
      for (let i = 0; i < showCount; i++) {
        const showAt = replies[i].replyToNickname !== node.nickname;
        replyNodes.push(renderCommentNode(replies[i].reply, feedback, true, showAt ? replies[i].replyToNickname : null));
      }
      if (replies.length > 2) {
        replyNodes.push(el('button', {
          class: 'fb-view-more',
          onClick: () => {
            if (state.shownReplies.has(key)) state.shownReplies.delete(key);
            else state.shownReplies.add(key);
            render();
          },
        }, state.shownReplies.has(key) ? '收起回复' : `共${replies.length}条回复，点击查看`));
      }
    }

    return el('div', { class: `fb-comment-item ${isNested ? 'fb-comment-nested' : ''}` }, [
      avatar(node.nickname),
      el('div', { class: 'fb-comment-main' }, [
        el('div', { class: 'fb-comment-author' }, node.nickname),
        el('div', { class: 'fb-comment-content' }, contentEls),
        el('div', { class: 'fb-comment-actions' }, actionBtns),
        replyBox,
        ...(replyNodes.length ? [el('div', { class: 'fb-replies' }, replyNodes)] : []),
      ]),
    ]);
  }

  /** 渲染单条反馈卡片 */
  function renderCard(fb) {
    const type = TYPE_CONFIG[fb.type] || TYPE_CONFIG.other;
    const status = STATUS_CONFIG[fb.status] || STATUS_CONFIG.pending;
    const voteCount = fb.votes?.length || 0;
    const hasVoted = fb.votes?.some((v) => v.accountId === myAccountId);
    const totalComments = countAllComments(fb.comments);
    const isOpen = state.expanded.has(fb.id);

    const commentInput = el('input', { class: 'fb-comment-input', placeholder: '写下你的评论...' });
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addComment(fb.id, commentInput);
    });

    return el('div', { class: 'fb-card' }, [
      el('div', { class: 'fb-head' }, [
        avatar(fb.nickname),
        el('div', { class: 'fb-main' }, [
          el('div', { class: 'fb-title' }, fb.title),
          el('div', { class: 'fb-author' }, `${fb.nickname} · ${formatDate(fb.createdAt)}`),
          el('div', { class: 'fb-content' }, fb.content),
          el('div', { class: 'fb-actions' }, [
            el('button', {
              class: `fb-vote-btn ${hasVoted ? 'voted' : ''}`,
              onClick: () => vote(fb.id),
            }, ['👍 ', el('span', { class: 'fb-vote-count' }, String(voteCount))]),
            el('button', {
              class: 'fb-toggle-comments',
              onClick: () => {
                if (state.expanded.has(fb.id)) state.expanded.delete(fb.id);
                else state.expanded.add(fb.id);
                render();
              },
            }, `💬 ${totalComments} 条评论`),
          ]),
        ]),
        el('div', { class: 'fb-meta' }, [
          el('span', { class: `fb-type ${type.cls}` }, type.label),
          el('span', { class: `fb-status ${status.cls}` }, status.label),
        ]),
      ]),
      el('div', { class: `fb-comments ${isOpen ? 'open' : ''}` }, [
        el('div', { class: 'fb-add-comment' }, [
          commentInput,
          el('button', { class: 'fb-comment-send', onClick: () => addComment(fb.id, commentInput) }, '发送'),
        ]),
        el('div', { class: 'fb-comments-list' },
          fb.comments && fb.comments.length
            ? fb.comments.map((c) => renderCommentNode(c, fb))
            : [el('div', { class: 'fb-comments-empty' }, '暂无评论')]
        ),
      ]),
    ]);
  }

  /** 渲染反馈列表 */
  function renderList(list) {
    listEl.innerHTML = '';
    if (!list || !list.length) {
      listEl.append(el('div', { class: 'fb-empty' }, '还没有反馈，快来提交第一条吧 📝'));
      return;
    }
    list.forEach((fb) => listEl.append(renderCard(fb)));
  }

  /** 局部重渲染（评论展开/收起、查看回复时保留展开状态） */
  function render() {
    renderList(currentList);
  }

  // 提交反馈（HTTP，对齐 v1；提交后服务端不广播，主动刷新）
  submitBtn.addEventListener('click', async () => {
    const type = typeSelect.value;
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    if (!title || !content) { toast.warn('请填写标题和内容'); return; }
    if (!myAccountId) { toast.warn('请先登录'); return; }
    submitBtn.disabled = true;
    try {
      const res = await api.feedback.submit({ accountId: myAccountId, nickname: myNickname, type, title, content });
      if (res && res.success) {
        toast.success('反馈提交成功！');
        titleInput.value = '';
        contentInput.value = '';
        const updated = await api.feedback.list();
        currentList = extractList(updated);
        renderList(currentList);
      } else {
        toast.error((res && res.message) || '提交失败');
      }
    } catch (err) {
      toast.error(err.message || '提交失败，请重试');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // 服务端广播（任何用户投票/评论/回复/点赞/删除后触发）
  const offList = eventBus.on('feedback:list', (data) => {
    currentList = extractList(data);
    renderList(currentList);
  });

  // socket 操作失败提示
  const offError = eventBus.on('system:error', (data) => {
    if (data && data.message) toast.error(data.message);
  });

  // 初始加载（HTTP）
  listEl.append(el('div', { class: 'fb-empty' }, '📥 加载中...'));
  api.feedback.list()
    .then((res) => {
      currentList = extractList(res);
      renderList(currentList);
    })
    .catch((err) => {
      console.error('[v2] 加载反馈失败:', err);
      listEl.innerHTML = '';
      listEl.append(el('div', { class: 'fb-empty' }, '加载失败，请稍后重试'));
    });

  return () => {
    offList();
    offError();
    container.innerHTML = '';
  };
}
