/**
 * train3d 音效烟测（Web Audio 用 mock，验证调用链不抛错）
 *
 * 运行：node client-v2/tests/train3d-audio.test.mjs
 */
import assert from 'node:assert/strict';

import { TrainAudio } from '../src/games/train3d/audio.js';

function param() {
  return {
    value: 0,
    setValueAtTime() {},
    setTargetAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}
  };
}

function node() {
  return {
    type: '',
    buffer: null,
    loop: false,
    onended: null,
    gain: param(),
    frequency: param(),
    Q: param(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
    connect() { return this; },
    disconnect() {},
    start() {},
    stop() {}
  };
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = node();
    this.created = 0;
  }
  createGain() { this.created += 1; return node(); }
  createOscillator() { this.created += 1; return node(); }
  createBiquadFilter() { this.created += 1; return node(); }
  createBufferSource() { this.created += 1; return node(); }
  createDynamicsCompressor() { this.created += 1; return node(); }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  \u2717 ${name}\n      ${error.message}`);
  }
}

globalThis.window = { AudioContext: MockAudioContext };

test('首次手势后成功建立音频图', () => {
  const audio = new TrainAudio();
  audio.ensureStarted();
  assert.ok(audio.ctx, '应创建 AudioContext');
  assert.ok(audio.voice, '应创建常驻音源');
  assert.ok(audio.noise, '应创建噪声缓冲');
  assert.ok(audio.ctx.created > 10, '应创建足够多的节点');
  audio.dispose();
});

test('行驶/制动/停站更新不抛错', () => {
  const audio = new TrainAudio();
  audio.ensureStarted();
  for (let i = 0; i < 120; i++) {
    audio.update(1 / 60, {
      speed: (i / 120) * 40,
      throttle: i < 60 ? 8 : -6,
      notch: i < 60 ? 8 : -6,
      autoMode: false,
      isStopped: false,
      travel: (i / 60) * 40
    });
  }
  audio.update(0.2, { speed: 0, throttle: -3, notch: -3, autoMode: true, isStopped: true, travel: 1000 });
  audio.dispose();
});

test('到站/发车/静音事件不抛错', () => {
  const audio = new TrainAudio();
  audio.ensureStarted();
  audio.launch();
  audio.arrive();
  audio.depart();
  audio.setMuted(true);
  audio.update(0.1, { speed: 10, throttle: 4, notch: 4, autoMode: true, isStopped: false, travel: 200 });
  audio.setMuted(false);
  audio.update(0.1, { speed: 10, throttle: 4, notch: 4, autoMode: true, isStopped: false, travel: 220 });
  audio.dispose();
});

test('没有 AudioContext 时降级为不可用，不抛错', () => {
  const previous = globalThis.window;
  globalThis.window = {};
  const audio = new TrainAudio();
  audio.ensureStarted();
  assert.equal(audio.available, false);
  audio.update(0.1, { speed: 10 });
  audio.arrive();
  audio.depart();
  audio.setMuted(true);
  audio.dispose();
  globalThis.window = previous;
});

test('释放后重复调用安全', () => {
  const audio = new TrainAudio();
  audio.ensureStarted();
  audio.dispose();
  audio.dispose();
  audio.update(0.1, { speed: 10 });
  audio.ensureStarted();
  assert.equal(audio.ctx, null);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) {
    console.error(`\nFAIL: ${failure.name}\n  ${failure.message}`);
  }
  process.exitCode = 1;
}
