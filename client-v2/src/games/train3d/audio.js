/**
 * 列车音效（Web Audio 合成，无外部音频文件）
 *
 * 声音组成：
 * - 牵引电机低频轰鸣 + 变频器高频啸叫，随速度和牵引挡变化
 * - 轮轨滚动噪声、轨道接缝“咔哒”声，频率随速度变化
 * - 制动放气声、低速制动轻微轮轨尖叫
 * - 到站/发车提示音、发车风笛、手动挡位点击声
 *
 * 浏览器要求用户手势后才能出声：ensureStarted() 在首次 pointerdown / keydown 时调用。
 */

const JOINT_SPACING = 25; // 米，轨道接缝间距（视觉上每根轨枕附近响一下，按 25m 节流）
const MOTOR_MAX_SPEED = 55;

export class TrainAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voice = null;
    this.noise = null;
    this.available = true;
    this.muted = false;
    this.disposed = false;
    this._lastJoint = null;
    this._lastNotch = 0;
    this._lastThrottle = 0;
    this._paramTimer = 0;
    this._signaled = false;
  }

  /** 首次用户手势时创建/恢复 AudioContext，并启动常驻音源 */
  ensureStarted() {
    if (this.disposed || !this.available) return;
    if (!this.ctx) {
      try {
        this._build();
      } catch (error) {
        this.available = false;
        if (this.ctx) {
          try {
            this.ctx.close();
          } catch (closeError) {
            // 忽略关闭失败
          }
        }
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this._signaled && this.master) {
      // 首次开启时给一个很轻的确认音，避免用户以为完全没有声音
      this._signaled = true;
      this._tone({ freq: 660, duration: 0.12, gain: 0.03, when: 0.02 });
      this._tone({ freq: 990, duration: 0.16, gain: 0.02, when: 0.14 });
    }
  }

  _build() {
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) throw new Error('AudioContext not available');

    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.noise = this._createNoiseBuffers(ctx);

    // ---- 牵引电机 ----
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 240;
    motorFilter.Q.value = 0.7;

    const motorGain = ctx.createGain();
    motorGain.gain.value = 0;

    const motor1 = ctx.createOscillator();
    motor1.type = 'triangle';
    motor1.frequency.value = 38;

    const motor2 = ctx.createOscillator();
    motor2.type = 'sine';
    motor2.frequency.value = 76;
    const motor2Gain = ctx.createGain();
    motor2Gain.gain.value = 0.22;

    motor1.connect(motorFilter);
    motor2.connect(motor2Gain);
    motor2Gain.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(master);
    motor1.start();
    motor2.start();

    // ---- 变频器高频啸叫 ----
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 300;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain);
    whineGain.connect(master);
    whine.start();

    // ---- 轮轨滚动噪声 ----
    const rollSource = ctx.createBufferSource();
    rollSource.buffer = this.noise.brown;
    rollSource.loop = true;
    const rollFilter = ctx.createBiquadFilter();
    rollFilter.type = 'lowpass';
    rollFilter.frequency.value = 300;
    rollFilter.Q.value = 0.5;
    const rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollSource.connect(rollFilter);
    rollFilter.connect(rollGain);
    rollGain.connect(master);
    rollSource.start();

    // ---- 空气噪声 ----
    const airSource = ctx.createBufferSource();
    airSource.buffer = this.noise.white;
    airSource.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'highpass';
    airFilter.frequency.value = 900;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    airSource.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(master);
    airSource.start();

    // ---- 制动放气 ----
    const brakeSource = ctx.createBufferSource();
    brakeSource.buffer = this.noise.white;
    brakeSource.loop = true;
    const brakeFilter = ctx.createBiquadFilter();
    brakeFilter.type = 'bandpass';
    brakeFilter.frequency.value = 2200;
    brakeFilter.Q.value = 0.6;
    const brakeGain = ctx.createGain();
    brakeGain.gain.value = 0;
    brakeSource.connect(brakeFilter);
    brakeFilter.connect(brakeGain);
    brakeGain.connect(master);
    brakeSource.start();

    // ---- 低速轮轨尖叫 ----
    const squeal = ctx.createOscillator();
    squeal.type = 'sine';
    squeal.frequency.value = 2600;
    const squealGain = ctx.createGain();
    squealGain.gain.value = 0;
    squeal.connect(squealGain);
    squealGain.connect(master);
    squeal.start();

    this.voice = {
      motor1, motor2, motorFilter, motorGain,
      whine, whineGain,
      rollFilter, rollGain,
      airFilter, airGain,
      brakeFilter, brakeGain,
      squeal, squealGain
    };
  }

  _createNoiseBuffers(ctx) {
    const length = Math.floor(ctx.sampleRate * 2);
    const white = ctx.createBuffer(1, length, ctx.sampleRate);
    const brown = ctx.createBuffer(1, length, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const n = Math.random() * 2 - 1;
      w[i] = n;
      last = (last + 0.02 * n) / 1.02;
      b[i] = last * 3.5;
    }
    return { white, brown };
  }

  /** 每帧调用；内部把连续参数更新节流到 ~20Hz */
  update(dt, state = {}) {
    if (!this.ctx || !this.voice) return;
    const step = Math.max(0, Number(dt) || 0);
    const speed = Math.max(0, Number(state.speed) || 0);
    const throttle = Number(state.throttle) || 0;
    const notch = Number(state.notch) || 0;
    const autoMode = state.autoMode === true;
    const isStopped = state.isStopped === true;
    const travel = Number(state.travel) || 0;
    const v = Math.min(1, speed / MOTOR_MAX_SPEED);
    const power = Math.max(0, throttle) / 8;

    // 手动模式切挡的“咔哒”声
    if (!autoMode && notch !== this._lastNotch) this._click();
    this._lastNotch = notch;

    // 刚开始施加制动时补一声放气
    if (throttle < -0.8 && this._lastThrottle >= -0.2 && speed > 2 && !isStopped) {
      this._brakeHiss();
    }
    this._lastThrottle = throttle;

    // 轨道接缝：每 25m 一声，双轴车两下
    if (speed > 1.2 && !isStopped) {
      const joint = Math.floor(travel / JOINT_SPACING);
      if (this._lastJoint === null) {
        this._lastJoint = joint;
      } else if (joint !== this._lastJoint) {
        this._lastJoint = joint;
        this._clickClack(v);
      }
    } else {
      this._lastJoint = Math.floor(travel / JOINT_SPACING);
    }

    this._paramTimer += step;
    if (this._paramTimer < 0.05) return;
    this._paramTimer = 0;

    const now = this.ctx.currentTime;
    const voice = this.voice;
    const driving = !isStopped && (speed > 0.12 || power > 0.01);
    const moving = !isStopped && speed > 0.12;

    const motorFreq = 34 + v * 96 + power * 16;
    voice.motor1.frequency.setTargetAtTime(motorFreq, now, 0.15);
    voice.motor2.frequency.setTargetAtTime(motorFreq * 2.02, now, 0.15);
    voice.motorFilter.frequency.setTargetAtTime(180 + v * 280 + power * 100, now, 0.15);
    voice.motorGain.gain.setTargetAtTime(
      driving ? 0.005 + power * 0.04 + v * 0.007 : 0,
      now,
      0.12
    );

    // 高速时 1kHz 左右的变频器啸叫很刺耳，直接关掉，只保留低频电机声
    voice.whine.frequency.setTargetAtTime(240 + v * 760 + power * 140, now, 0.12);
    voice.whineGain.gain.setTargetAtTime(0, now, 0.12);

    voice.rollFilter.frequency.setTargetAtTime(220 + v * 300, now, 0.15);
    voice.rollGain.gain.setTargetAtTime(moving ? 0.005 + v * 0.035 : 0, now, 0.15);
    // 持续风噪/制动气流已经证实很刺耳，直接关掉；只在到站/制动瞬间留很轻的放气
    voice.airGain.gain.setTargetAtTime(0, now, 0.2);

    voice.brakeFilter.frequency.setTargetAtTime(1800 + v * 900, now, 0.15);
    voice.brakeGain.gain.setTargetAtTime(0, now, 0.15);

    // 低速制动的高频轮轨尖叫也容易刺耳，先关闭，只保留柔和的低频提示
    voice.squealGain.gain.setTargetAtTime(0, now, 0.1);
    voice.squeal.frequency.setTargetAtTime(2200 + speed * 120, now, 0.2);
  }

  /** 起步：很轻的低频闷响（不是重击） */
  launch() {
    if (!this.ctx) return;
    this._tone({ freq: 80, duration: 0.16, gain: 0.012, type: 'sine', endFreq: 65 });
  }

  /** 到站：下行提示音 + 轻微放气 */
  arrive() {
    if (!this.ctx) return;
    this._chime(true);
    this._noiseBurst({ duration: 0.25, gain: 0.012, type: 'lowpass', frequency: 800 });
  }

  /** 发车：上行提示音 + 风笛 */
  depart() {
    if (!this.ctx) return;
    this._chime(false);
    this._horn(0.45);
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  /** 页面切到后台时暂停，避免循环音源在后台一直响 */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  dispose() {
    this.disposed = true;
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (error) {
        // 已关闭/不可用时忽略
      }
    }
    this.ctx = null;
    this.master = null;
    this.voice = null;
    this.noise = null;
  }

  /* ============================================================
     一次性音效
     ============================================================ */

  _tone({ freq, duration = 0.2, gain = 0.04, type = 'sine', when = 0, endFreq = null }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  _noiseBurst({ duration = 0.08, gain = 0.04, type = 'bandpass', frequency = 1800, Q = 1, when = 0 }) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.white;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  _click() {
    this._tone({ freq: 1500, duration: 0.018, gain: 0.018, type: 'square' });
  }

  _clickClack(v) {
    const gain = 0.016 + v * 0.012;
    this._noiseBurst({ duration: 0.045, gain, type: 'bandpass', frequency: 1200, Q: 1.4 });
    this._noiseBurst({ duration: 0.05, gain: gain * 0.7, type: 'bandpass', frequency: 900, Q: 1.2, when: 0.075 });
  }

  _brakeHiss() {
    this._noiseBurst({ duration: 0.22, gain: 0.012, type: 'lowpass', frequency: 900 });
  }

  _chime(descending) {
    const notes = descending ? [880, 660] : [523, 784];
    notes.forEach((freq, index) => {
      this._tone({ freq, duration: 0.55, gain: 0.065, type: 'sine', when: index * 0.18 });
      this._tone({ freq: freq * 2, duration: 0.4, gain: 0.012, type: 'sine', when: index * 0.18 });
    });
  }

  _horn(when = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const duration = 0.55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    env.gain.setValueAtTime(0.06, t + duration - 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    filter.connect(env);
    env.connect(this.master);
    const oscillators = [];
    for (const freq of [220, 277]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.02);
      oscillators.push(osc);
    }
    const first = oscillators[0];
    if (first) {
      first.onended = () => {
        oscillators.forEach((osc) => osc.disconnect());
        filter.disconnect();
        env.disconnect();
      };
    }
  }
}
