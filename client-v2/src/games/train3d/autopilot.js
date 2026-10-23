/**
 * train3d 自动驾驶控制器（纯逻辑，可在 Node 中无头仿真）
 *
 * 设计目标（对比旧版"挡位乒乓"控制）：
 * 1. 速度规划：以"进站停车曲线 + 前方曲线限速"取最小允许速度，
 *    用前馈（按规划减速度）+ 反馈（速度误差）算出加速度指令；
 * 2. 平滑执行：加速度受 jerk 限制、挡位受变化率限制，自动模式使用
 *    无级挡位（小数），避免 0/1 挡反复跳变造成的顿挫；
 * 3. 精确停车：低速满足制动距离时锁定制动，停稳判定误差通常在 ±0.2m；
 * 4. 不冒进：任何时刻都按"当前速度刹停所需距离"做安全校核，晚接管时
 *    会自动加大制动力，绝不带着速度冲过站台；
 * 5. 站停/发车状态机内聚在本类中，主循环只需处理 arrived/departed 事件。
 */

import { MAX_SPEED, clamp, throttleForAcceleration } from './physics.js';

export const AUTOPILOT_DEFAULTS = Object.freeze({
  cruiseSpeed: 150 / 3.6,   // 区间目标速度 ≈150 km/h（曲线区自动降速）
  dwellTime: 5.0,           // 站停时间（秒）
  planDecel: 2.8,           // 规划减速度（常用制动，进站更果断）
  stopGap: 0.12,            // 停车曲线终点距停车点的小偏移
  maxAccel: 1.6,            // 自动模式巡航段最大加速度（干脆利落）
  launchThrottle: 8,        // 发车启动挡位：直接满功率 +8
  launchSpeed: 12,          // 启动阶段持续到该速度（m/s ≈43 km/h）
  launchTime: 4.0,          // 启动阶段最长时间（秒，兜底）
  maxDecel: 3.35,           // 安全校核允许的最大减速度
  jerkLimit: 3.2,           // 加速度变化率上限（m/s³）
  speedGain: 0.55,          // 速度误差反馈增益
  integralGain: 0.025,      // 速度误差积分增益（消除巡航稳态误差）
  integralLimit: 5,         // 积分限幅
  curveMargin: 0.3,         // 曲线限速规划余量（m/s）
  curvePreviewTime: 2.2,    // 曲线限速时间预览（秒）：提前收油/制动，避免入弯超速
  lookaheadStep: 6,         // 曲线限速前瞻步长（米）
  lookaheadExtra: 140,      // 前瞻距离余量（米）
  throttleRate: 10,         // 自动挡位变化率上限（挡/秒）
  brakeLatchSpeed: 1.0,     // 低于该速度且满足制动距离时锁定制动
  brakeLatchDecel: 2.1,     // 锁定制动时假设的减速度
  captureSpeed: 0.05,       // 停稳判定速度（m/s）
  captureDist: 0.6          // 停稳判定距离（米，兜底）
});

export class TrainAutopilot {
  /**
   * @param {object} options
   * @param {number[]} options.stops - 各站停车点（车头位置，米，沿轨道弧长）
   * @param {number} options.trackLength - 轨道总长（米）
   * @param {(distance:number)=>number} [options.limitAt] - 轨道某点的曲线限速（m/s）
   * @param {number} [options.cruiseSpeed]
   * @param {number} [options.dwellTime]
   * @param {object} [options.tuning] - 覆盖 AUTOPILOT_DEFAULTS 中的任意项
   */
  constructor({
    stops = [],
    trackLength = 0,
    limitAt,
    cruiseSpeed,
    dwellTime,
    tuning = {}
  } = {}) {
    this.stops = stops.map(Number).filter(Number.isFinite);
    this.trackLength = Math.max(1, Number(trackLength) || 1);
    this.limitAt = typeof limitAt === 'function' ? limitAt : () => MAX_SPEED;
    this.cfg = {
      ...AUTOPILOT_DEFAULTS,
      ...tuning
    };
    if (Number.isFinite(cruiseSpeed) && cruiseSpeed > 0) this.cfg.cruiseSpeed = cruiseSpeed;
    if (Number.isFinite(dwellTime) && dwellTime >= 0) this.cfg.dwellTime = dwellTime;
    this.cfg.cruiseSpeed = clamp(this.cfg.cruiseSpeed, 1, MAX_SPEED);

    this.targetIdx = 0;
    this.phase = 'cruise';        // cruise | brake | dwell
    this.autoThrottle = 0;
    this.accel = 0;
    this.integral = 0;
    this.dwellElapsed = 0;
    this.brakingLatch = false;
    this.launching = false;
    this.launchElapsed = 0;
    this.lastTargetSpeed = 0;
    this.lastLimitSpeed = MAX_SPEED;
    this.lastDist = 0;
    this.reset({ travel: 0, speed: 0, stopped: false });
  }

  /** 进入/退出自动驾驶、或列车状态被外部改变后重新规划 */
  reset({ travel = 0, speed = 0, stopped = false } = {}) {
    this.phase = stopped ? 'dwell' : 'cruise';
    this.dwellElapsed = 0;
    this.autoThrottle = 0;
    this.accel = 0;
    this.integral = 0;
    this.brakingLatch = false;
    // 静止且不在站停状态（例如线路起点、或刚被自动接管）时，也按发车处理
    this.launching = !stopped && speed < 0.2;
    this.launchElapsed = 0;
    this.lastTargetSpeed = 0;
    this.lastLimitSpeed = this.limitAt(travel);
    this.lastDist = this.stops.length ? this._signedDistance(travel) : 0;
    if (!this.stops.length) {
      this.phase = 'dwell';
      this.launching = false;
      return;
    }
    this.targetIdx = stopped
      ? this._nearestStopIndex(travel)
      : this._nextStopIndex(travel, speed);
  }

  /**
   * 每个物理帧调用一次（需在列车物理之前）。
   * @param {number} dt
   * @param {{travel:number, speed:number, isStopped:boolean}} train
   */
  update(dt, train = {}) {
    const step = clamp(Number(dt) || 0, 0, 0.1);
    const travel = Number(train.travel) || 0;
    const speed = Math.max(0, Number(train.speed) || 0);

    if (!this.stops.length) {
      this.autoThrottle = 0;
      return this._snapshot({});
    }

    /* ---------- 站停倒计时 ---------- */
    if (this.phase === 'dwell') {
      this.dwellElapsed += step;
      this.autoThrottle = -3;
      this.lastDist = 0;
      this.lastTargetSpeed = 0;
      if (this.dwellElapsed >= this.cfg.dwellTime) {
        this.dwellElapsed = 0;
        this.targetIdx = (this.targetIdx + 1) % this.stops.length;
        this.phase = 'cruise';
        this.brakingLatch = false;
        this.accel = 0;
        this.integral = 0;
        // 发车：直接满功率 +8 起步，到 launchSpeed 或 launchTime 后交回巡航控制
        this.launching = true;
        this.launchElapsed = 0;
        this.autoThrottle = this.cfg.launchThrottle;
        this.lastLimitSpeed = this.limitAt(travel);
        this.lastDist = this._signedDistance(travel);
        this.lastTargetSpeed = this.cfg.launchSpeed;
        return this._snapshot({ departed: true });
      }
      return this._snapshot({});
    }

    const distToStop = this._signedDistance(travel);
    this.lastDist = distToStop;
    this.lastLimitSpeed = this.limitAt(travel);

    /* ---------- 发车启动：满功率 +8 ---------- */
    if (this.launching) {
      this.launchElapsed += step;
      // 下一站太近、或站外曲线限速已经低于启动目标时，不用满功率，直接交给巡航控制
      const canLaunch = distToStop > 150 && this.lastLimitSpeed > this.cfg.launchSpeed + 2;
      if (!canLaunch || speed >= this.cfg.launchSpeed || this.launchElapsed >= this.cfg.launchTime) {
        this.launching = false;
      } else {
        this.phase = 'cruise';
        this.autoThrottle = this.cfg.launchThrottle;
        this.lastTargetSpeed = this.cfg.launchSpeed;
        return this._snapshot({});
      }
    }

    /* ---------- 已越过停车点：全力制动，绝不再牵引 ---------- */
    if (distToStop <= 0) {
      this.phase = 'brake';
      this.launching = false;
      this.lastTargetSpeed = 0;
      this.autoThrottle = -8;
      if (speed <= this.cfg.captureSpeed) {
        return this._arrive(distToStop);
      }
      return this._snapshot({});
    }

    /* ---------- 停稳判定（低速+贴近停车点） ---------- */
    if (distToStop <= this.cfg.captureDist && speed <= this.cfg.captureSpeed) {
      return this._arrive(distToStop);
    }

    this.phase = 'cruise';

    /* ---------- 速度规划 ---------- */
    const stopSpeed = Math.sqrt(
      2 * this.cfg.planDecel * Math.max(0, distToStop - this.cfg.stopGap)
    );
    const limitNow = Math.max(0, this.lastLimitSpeed - this.cfg.curveMargin);
    let targetSpeed = Math.min(
      this.cfg.cruiseSpeed,
      limitNow,
      stopSpeed
    );
    // 记录"最紧的前方限速约束"，用于计算曲线制动的加速度前馈
    let bindingLimit = limitNow;
    let bindingAhead = 0;
    const horizon = clamp(
      (speed * speed) / (2 * this.cfg.planDecel) + this.cfg.lookaheadExtra,
      180,
      900
    );
    for (let ahead = this.cfg.lookaheadStep; ahead <= horizon; ahead += this.cfg.lookaheadStep) {
      const limit = Math.max(0, this.limitAt(travel + ahead) - this.cfg.curveMargin);
      const allowed = Math.sqrt(limit * limit + 2 * this.cfg.planDecel * ahead);
      if (allowed < targetSpeed) {
        targetSpeed = allowed;
        bindingLimit = limit;
        bindingAhead = ahead;
      }
    }
    // 时间预览：把未来约 2 秒内会出现的最低限速直接作为当前目标。
    // 纯距离前瞻只能保证"来得及刹"，但挡位/jerk 响应有延迟，入弯仍会短暂超速；
    // 提前按时间收油可以让车速平滑地贴住限速曲线。
    const previewDistance = Math.min(360, Math.max(50, speed * this.cfg.curvePreviewTime));
    for (let ahead = 0; ahead <= previewDistance; ahead += this.cfg.lookaheadStep) {
      const limit = Math.max(0, this.limitAt(travel + ahead) - this.cfg.curveMargin);
      if (limit < targetSpeed) {
        targetSpeed = limit;
        bindingLimit = limit;
        bindingAhead = Math.max(ahead, 1);
      }
    }
    this.lastTargetSpeed = targetSpeed;

    /* ---------- 停车锁止：已进入制动距离就只刹车，不再犹豫 ---------- */
    const latchDistance = (speed * speed) / (2 * this.cfg.brakeLatchDecel) + 0.04;
    if (!this.brakingLatch && speed <= this.cfg.brakeLatchSpeed && distToStop <= latchDistance) {
      this.brakingLatch = true;
    }
    if (this.brakingLatch) {
      if (speed <= this.cfg.captureSpeed) return this._arrive(distToStop);
      // 常用制动即可停稳，避免最后几米出现"急刹点头"
      this.autoThrottle = -4;
      return this._snapshot({});
    }

    /* ---------- 加速度指令：进站/曲线前馈 + 速度误差反馈 ---------- */
    let feedForward = 0;
    if (stopSpeed < this.cfg.cruiseSpeed && distToStop > 0.5) {
      feedForward = -this.cfg.planDecel * speed / Math.max(stopSpeed, 0.8);
    }
    // 曲线限速是"上限"而不是巡航目标：按到该限速点的实际距离反推所需减速度，
    // 否则 P 控制器会把"还没超速"误判成"可以加速"，导致入弯超速。
    if (bindingAhead > 0 && targetSpeed < stopSpeed - 1e-6) {
      const required = (speed * speed - bindingLimit * bindingLimit) / (2 * bindingAhead);
      if (required > 0) {
        feedForward -= Math.min(required, this.cfg.planDecel * 2);
      }
    }
    const error = targetSpeed - speed;
    if (Math.abs(error) < 1.6) {
      this.integral = clamp(
        this.integral + error * step,
        -this.cfg.integralLimit,
        this.cfg.integralLimit
      );
    } else {
      this.integral *= Math.exp(-step * 2);
    }

    let accelCmd = feedForward + this.cfg.speedGain * error + this.cfg.integralGain * this.integral;

    // 安全校核：按"当前速度在剩余距离内刹停"反推所需减速度
    const requiredDecel = (speed * speed) / (2 * Math.max(0.2, distToStop - 0.1));
    const allowedDecel = Math.max(this.cfg.maxDecel, requiredDecel + 0.3);
    accelCmd = clamp(accelCmd, -allowedDecel, this.cfg.maxAccel);

    // jerk 限制 → 挡位变化率限制
    const maxAccelStep = this.cfg.jerkLimit * step;
    this.accel += clamp(accelCmd - this.accel, -maxAccelStep, maxAccelStep);
    const targetThrottle = throttleForAcceleration(speed, this.accel);
    const maxThrottleStep = this.cfg.throttleRate * step;
    this.autoThrottle = clamp(
      this.autoThrottle + clamp(targetThrottle - this.autoThrottle, -maxThrottleStep, maxThrottleStep),
      -8,
      8
    );

    return this._snapshot({});
  }

  /* ============================================================
     内部工具
     ============================================================ */

  _arrive(distToStop) {
    this.phase = 'dwell';
    this.dwellElapsed = 0;
    this.autoThrottle = -4;
    this.accel = 0;
    this.integral = 0;
    this.brakingLatch = false;
    this.launching = false;
    this.launchElapsed = 0;
    this.lastTargetSpeed = 0;
    this.lastDist = 0;
    return this._snapshot({
      arrived: true,
      // 负值 = 提前停车，正值 = 越过停车点
      stopError: -distToStop
    });
  }

  _snapshot(extra) {
    return {
      throttle: this.autoThrottle,
      phase: this.phase,
      label: this._label(),
      targetSpeed: this.lastTargetSpeed,
      limitSpeed: this.lastLimitSpeed,
      distToStop: Math.max(0, this.lastDist),
      stopIndex: this.targetIdx,
      dwellRemain: this.phase === 'dwell'
        ? Math.max(0, this.cfg.dwellTime - this.dwellElapsed)
        : 0,
      arrived: false,
      departed: false,
      stopError: 0,
      ...extra
    };
  }

  _label() {
    if (this.phase === 'dwell') return '站内停靠';
    if (this.launching) return '满功率发车';
    if (this.phase === 'brake') return '紧急制动';
    if (this.brakingLatch) return '准点停车';
    if (this.lastDist < 400 && this.lastTargetSpeed < this.cfg.cruiseSpeed - 0.1) return '进站制动';
    if (this.autoThrottle > 0.6) return '牵引加速';
    if (this.autoThrottle < -0.6) return '制动减速';
    return '惰行巡航';
  }

  /** 到当前目标停车点的有符号距离（正=尚未到达，负=已越过） */
  _signedDistance(travel) {
    const stop = this.stops[this.targetIdx];
    let dist = (stop - travel) % this.trackLength;
    if (dist < 0) dist += this.trackLength;
    if (dist > this.trackLength / 2) dist -= this.trackLength;
    return dist;
  }

  _nearestStopIndex(travel) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.stops.length; i++) {
      let dist = Math.abs(this.stops[i] - travel);
      dist = Math.min(dist, this.trackLength - dist);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  _nextStopIndex(travel, speed) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.stops.length; i++) {
      let dist = (this.stops[i] - travel) % this.trackLength;
      if (dist < 0) dist += this.trackLength;
      // 正好压在停车点上且仍有速度时，直接去下一站，避免立即触发紧急制动
      if (dist < 1.5 && speed > 2) dist += this.trackLength;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
