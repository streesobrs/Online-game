/**
 * 对局音效（WebAudio 合成，无外部资源）
 *
 * 仅在对局里使用：落子 / 提子吃子 / 胜利 / 错误 / 按钮点击。
 * 开关统一走 core/prefs 的 ui-sfx-enabled（设置页可改）。
 * AudioContext 懒创建，首次播放时若处于 suspended 会自动 resume；
 * 任何异常都静默吞掉，绝不影响对局逻辑。
 */
import { getUiPrefs, setUiPrefs } from './prefs.js';

let ctx = null;
let enabled = getUiPrefs().sfxEnabled;

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * 播放一段频率滑音
 * @param {number} from 起始频率
 * @param {number} to 结束频率
 * @param {number} duration 秒
 * @param {number} volume 0~1
 * @param {'sine'|'triangle'|'square'} type 波形
 * @param {number} delay 相对当前时间的延迟（秒）
 */
function tone(from, to, duration, volume, type = 'sine', delay = 0) {
  const audio = ensureContext();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});

  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const SOUNDS = {
  // 落子：短促下滑音
  place: () => tone(800, 400, 0.08, 0.18, 'triangle'),
  // 吃子 / 提子：更低沉
  capture: () => {
    tone(600, 200, 0.16, 0.22, 'square');
    tone(300, 120, 0.12, 0.12, 'sine', 0.02);
  },
  // 胜利：上行琶音
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.18, 0.16, 'sine', i * 0.11));
  },
  // 错误：低沉提示
  error: () => tone(200, 150, 0.2, 0.2, 'sawtooth'),
  // 按钮点击
  click: () => tone(1000, 500, 0.05, 0.1, 'sine'),
};

export const sfx = {
  /** 播放指定音效；未知类型与异常均静默 */
  play(type) {
    if (!enabled) return;
    const fn = SOUNDS[type];
    if (!fn) return;
    try {
      fn();
    } catch {
      /* 静默：音频不可用时不影响对局 */
    }
  },

  isEnabled() {
    return enabled;
  },

  /** 设置并持久化音效开关 */
  setEnabled(value) {
    enabled = !!value;
    setUiPrefs({ sfxEnabled: enabled });
  },
};

export default sfx;
