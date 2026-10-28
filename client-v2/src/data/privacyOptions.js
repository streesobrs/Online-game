/**
 * 个人主页隐私项（设置页与个人资料页共用，避免两处文案/默认值漂移）
 * key 对应服务端 account.privacy 的字段名
 */
export const PRIVACY_OPTIONS = [
  { key: 'bio', label: '个性签名', default: true, hint: '别人查看你的主页时能看到你的签名' },
  { key: 'stats', label: '战绩统计', default: true, hint: '对局数、胜/负、胜率、连胜' },
  { key: 'achievements', label: '徽章 / 成就', default: true, hint: '已解锁的徽章和成就进度' },
  { key: 'createdAt', label: '注册时间', default: true, hint: '显示你的账号注册时间' },
  { key: 'isAdmin', label: '管理员身份', default: true, hint: '是否显示你是管理员' },
  { key: 'loginCount', label: '登录次数', default: false, hint: '显示你总共登录过多少次' },
  { key: 'lastLogin', label: '最后登录时间', default: false, hint: '显示你最近一次登录的时间' },
  { key: 'lastSeen', label: '最后在线时间', default: false, hint: '显示你最近一次上线的时间' },
];
