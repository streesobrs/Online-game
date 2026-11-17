/** 感电·雷暴：感电触发时在触发点释放雷暴 */
export default {
  id: 'electrostorm',
  icon: '🌩️',
  name: '感电·雷暴',
  desc: '感电触发时在触发点释放雷暴',
  detail: '感电触发时，以触发怪为中心释放半径 80 的雷暴，造成 35% 基础伤害；每层 +15 半径、+15% 伤害。',
  max: 4,
  order: 56,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    return `雷暴半径 ${80 + 15 * lv} · ${Math.round((0.35 + 0.15 * lv) * 100)}% 伤害`;
  },
  apply(p) {
    p.electroStormLevel += 1;
  },
};
