/**
 * train3d 自动驾驶无头仿真测试
 *
 * 运行：node client-v2/tests/train3d-autopilot.test.mjs
 *
 * 控制器与列车物理均为纯逻辑（autopilot.js / physics.js），这里用与游戏
 * 相同的 60Hz 步进跑完整线路，验证停车精度、平顺性与限速跟随。
 */
import assert from 'node:assert/strict';

import { TrainAutopilot } from '../src/games/train3d/autopilot.js';
import { MAX_SPEED, stepTrain } from '../src/games/train3d/physics.js';

const TRACK_LENGTH = 15800;
const STOP_OFFSET = 22.5;
const STATION_T = [0.05, 0.17, 0.29, 0.42, 0.55, 0.68, 0.81, 0.93];
const STOPS = STATION_T.map((t) => t * TRACK_LENGTH + STOP_OFFSET);
const DT = 1 / 60;

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

function section(title) {
  console.log(`\n${title}`);
}

function formatError(value) {
  return `${value >= 0 ? '越过' : '提前'} ${Math.abs(value).toFixed(2)}m`;
}

/**
 * @param {object} options
 * @param {number} options.startTravel
 * @param {number} [options.startSpeed]
 * @param {boolean} [options.isStopped]
 * @param {number} options.seconds
 * @param {(distance:number)=>number} [options.limitAt]
 * @param {(travel:number, speed:number)=>boolean} [options.onStep] - 返回 true 结束
 */
function simulate({
  startTravel = 0,
  startSpeed = 0,
  isStopped = false,
  seconds = 120,
  limitAt = () => MAX_SPEED,
  onStep,
  stopAfterArrival = false,
  autopilot
} = {}) {
  const ap = autopilot || new TrainAutopilot({
    stops: STOPS,
    trackLength: TRACK_LENGTH,
    limitAt,
    dwellTime: 2
  });
  ap.reset({ travel: startTravel, speed: startSpeed, stopped: isStopped });

  let travel = startTravel;
  let speed = startSpeed;
  let stopped = isStopped;
  let lastAccel = 0;
  let maxAccel = 0;
  let maxDecel = 0;
  let maxJerk = 0;
  let maxJerkInfo = null;
  let maxSpeed = startSpeed;
  let minSpeedAfterStart = startSpeed;
  const arrivals = [];
  const departures = [];
  const steps = Math.round(seconds / DT);

  for (let i = 0; i < steps; i++) {
    const command = ap.update(DT, { travel, speed, isStopped: stopped });
    if (command.arrived) {
      arrivals.push({
        index: command.stopIndex,
        error: command.stopError,
        time: i * DT,
        distance: travel
      });
      speed = 0;
      stopped = true;
      if (stopAfterArrival) break;
    }
    if (command.departed) {
      departures.push({ time: i * DT });
      stopped = false;
    }

    let accel = 0;
    if (!stopped) {
      const before = speed;
      speed = stepTrain(speed, DT, command.throttle);
      accel = (speed - before) / DT;
      travel = (travel + speed * DT) % TRACK_LENGTH;
      maxAccel = Math.max(maxAccel, accel);
      maxDecel = Math.min(maxDecel, accel);
      maxSpeed = Math.max(maxSpeed, speed);
      minSpeedAfterStart = Math.min(minSpeedAfterStart, speed);
      // 停车瞬间速度被钳到 0，会产生无意义的"无穷大 jerk"，只在正常速度区间统计
      if (before > 1.5 && speed > 1.5 && i * DT > 1) {
        const jerk = Math.abs(accel - lastAccel) / DT;
        if (jerk > maxJerk) {
          maxJerk = jerk;
          maxJerkInfo = { time: i * DT, before, speed, accel, lastAccel };
        }
      }
      lastAccel = accel;
    } else {
      lastAccel = 0;
    }

    if (onStep && onStep(travel, speed, command)) break;
  }

  return {
    ap,
    travel,
    speed,
    arrivals,
    departures,
    maxAccel,
    maxDecel,
    maxJerk,
    maxJerkInfo,
    maxSpeed,
    minSpeedAfterStart
  };
}

/* ============================================================
   1. 单次进站：精度、过冲、平顺性
   ============================================================ */
section('单次进站');

for (let index = 0; index < STOPS.length; index++) {
  test(`从 ${index === 0 ? 0 : index} 号站前方 1200m 起步，正点停靠`, () => {
    const start = (STOPS[index] - 1200 + TRACK_LENGTH) % TRACK_LENGTH;
    const autopilot = new TrainAutopilot({
      stops: STOPS,
      trackLength: TRACK_LENGTH,
      limitAt: () => MAX_SPEED,
      dwellTime: 2
    });
    const result = simulate({
      startTravel: start,
      startSpeed: 18,
      seconds: 180,
      stopAfterArrival: true,
      autopilot
    });
    assert.equal(result.arrivals.length, 1, '应该停靠一次');
    const error = result.arrivals[0].error;
    console.log(`      ${index} 号站：${formatError(error)}，制动峰值 ${Math.abs(result.maxDecel).toFixed(2)} m/s²`);
    assert.ok(Math.abs(error) < 0.6, `停车误差应小于 0.6m，实际 ${error.toFixed(2)}m`);
    assert.ok(error < 0.3, `不应明显越过停车点，实际越过 ${error.toFixed(2)}m`);
    assert.ok(result.maxAccel <= 1.75, `牵引加速度应平缓，实际 ${result.maxAccel.toFixed(2)}`);
    assert.ok(Math.abs(result.maxDecel) <= 3.4, `常用制动应平缓，实际 ${result.maxDecel.toFixed(2)}`);
    assert.ok(result.maxJerk <= 5, `冲击应受控，实际 jerk ${result.maxJerk.toFixed(2)}`);
  });
}

/* ============================================================
   2. 连续运行一整圈：每一站都准点，且能自动发车
   ============================================================ */
section('整圈循环');

test('连续停靠 8 站并自动发车', () => {
  const result = simulate({
    startTravel: 0,
    startSpeed: 0,
    seconds: 900,
    limitAt: () => MAX_SPEED
  });
  const errors = result.arrivals.map((a) => a.error);
  console.log(`      停靠 ${result.arrivals.length} 站：${errors.map((e) => formatError(e)).join('，')}`);
  console.log(`      最高速度 ${(result.maxSpeed * 3.6).toFixed(0)} km/h，最大 jerk ${result.maxJerk.toFixed(2)}`);
  assert.ok(result.arrivals.length >= 8, `一圈应停靠至少 8 站，实际 ${result.arrivals.length}`);
  assert.ok(result.maxSpeed * 3.6 >= 145, `巡航速度应接近 150 km/h，实际 ${(result.maxSpeed * 3.6).toFixed(0)}`);
  assert.ok(result.arrivals[7].time < 640, `前 8 站用时过长：${result.arrivals[7].time.toFixed(1)}s`);
  for (const arrival of result.arrivals.slice(0, 8)) {
    assert.ok(Math.abs(arrival.error) < 0.6, `第 ${arrival.index} 站误差 ${arrival.error.toFixed(2)}m`);
  }
  for (let i = 0; i < 8; i++) {
    assert.equal(result.arrivals[i].index, i, `第 ${i} 次停车应停在 ${i} 号站`);
  }
  assert.equal(result.departures.length, result.arrivals.length, '每次停靠后都应自动发车');
  for (let i = 1; i < result.departures.length; i++) {
    const dwell = result.departures[i].time - result.arrivals[i].time;
    assert.ok(dwell >= 1.9 && dwell <= 2.3, `站停时间应约 2s，实际 ${dwell.toFixed(2)}s`);
  }
});

/* ============================================================
   3. 曲线限速前瞻
   ============================================================ */
section('曲线限速');

test('提前减速通过 18 m/s 限速区', () => {
  const zoneStart = 3300;
  const zoneEnd = 3900;
  let zoneMaxSpeed = 0;
  let entrySpeed = 0;
  const result = simulate({
    startTravel: 3000,
    startSpeed: 30,
    seconds: 120,
    limitAt: (distance) => {
      const d = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
      return d >= zoneStart && d <= zoneEnd ? 18 : MAX_SPEED;
    },
    onStep: (travel, speed) => {
      if (travel >= zoneStart && travel <= zoneEnd) {
        if (entrySpeed === 0) entrySpeed = speed;
        zoneMaxSpeed = Math.max(zoneMaxSpeed, speed);
      }
      return travel > zoneEnd + 100;
    }
  });
  console.log(`      进入限速区 ${(entrySpeed * 3.6).toFixed(0)} km/h，区内最高 ${(zoneMaxSpeed * 3.6).toFixed(0)} km/h`);
  assert.ok(entrySpeed <= 18.4, `入区速度 ${entrySpeed.toFixed(2)} m/s 超过限速`);
  assert.ok(zoneMaxSpeed <= 18.5, `区内最高 ${zoneMaxSpeed.toFixed(2)} m/s 超限`);
  assert.ok(Math.abs(result.maxDecel) <= 3.4, `限速制动应在常用制动范围内，实际 ${result.maxDecel.toFixed(2)}`);
});

/* ============================================================
   4. 中途接管：离站很近时也能安全停住
   ============================================================ */
section('中途接管');

test('距停车点 150m、30m/s 时接管，仍能停进站台', () => {
  const targetStop = STOPS[3];
  const result = simulate({
    startTravel: (targetStop - 150 + TRACK_LENGTH) % TRACK_LENGTH,
    startSpeed: 30,
    seconds: 60,
    limitAt: () => MAX_SPEED
  });
  assert.equal(result.arrivals.length, 1, '应该停靠一次');
  const error = result.arrivals[0].error;
  console.log(`      接管后停车：${formatError(error)}，最大减速度 ${Math.abs(result.maxDecel).toFixed(2)} m/s²`);
  assert.ok(error < 1.5, `不应冲过站台，实际越过 ${error.toFixed(2)}m`);
  assert.ok(Math.abs(error) < 2.0, `停车误差应可控，实际 ${error.toFixed(2)}m`);
  assert.ok(Math.abs(result.maxDecel) <= 4.2, `应使用安全制动，实际 ${result.maxDecel.toFixed(2)}`);
});

test('站停中开启自动，倒计时结束后自动发车', () => {
  const targetStop = STOPS[2];
  const result = simulate({
    startTravel: targetStop,
    startSpeed: 0,
    isStopped: true,
    seconds: 10,
    limitAt: () => MAX_SPEED
  });
  assert.equal(result.departures.length, 1, '应自动发车一次');
  assert.ok(result.travel !== targetStop, '发车后应离开停车点');
});

test('发车直接使用 +8 满功率起步', () => {
  const stop = STOPS[0];
  const ap = new TrainAutopilot({
    stops: STOPS,
    trackLength: TRACK_LENGTH,
    limitAt: () => MAX_SPEED,
    dwellTime: 0.5
  });
  ap.reset({ travel: stop, speed: 0, stopped: true });

  let departure = null;
  for (let i = 0; i < 60; i++) {
    const cmd = ap.update(DT, { travel: stop, speed: 0, isStopped: true });
    if (cmd.departed) {
      departure = cmd;
      break;
    }
  }
  assert.ok(departure, '应完成发车');
  assert.equal(departure.throttle, 8, '发车瞬间应为 +8 挡');

  let travel = stop;
  let speed = 0;
  let maxLaunchAccel = 0;
  for (let i = 0; i < 120; i++) {
    const cmd = ap.update(DT, { travel, speed, isStopped: false });
    const before = speed;
    speed = stepTrain(speed, DT, cmd.throttle);
    travel = (travel + speed * DT) % TRACK_LENGTH;
    maxLaunchAccel = Math.max(maxLaunchAccel, (speed - before) / DT);
  }
  console.log(`      发车 2s 内最大加速度 ${maxLaunchAccel.toFixed(2)} m/s²，速度 ${(speed * 3.6).toFixed(0)} km/h`);
  assert.ok(maxLaunchAccel > 2.5, `发车应使用满功率，实际 ${maxLaunchAccel.toFixed(2)} m/s²`);
});

/* ============================================================
   5. 随机起点鲁棒性
   ============================================================ */
section('随机起点');

test('随机位置/速度进入自动，均能在下一站停稳', () => {
  let seed = 20261023;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let worst = 0;
  for (let i = 0; i < 12; i++) {
    const travel = random() * TRACK_LENGTH;
    const speed = random() * 24;
    const result = simulate({
      startTravel: travel,
      startSpeed: speed,
      seconds: 120,
      limitAt: () => MAX_SPEED
    });
    assert.ok(result.arrivals.length >= 1, `样本 ${i} 未停靠`);
    const error = result.arrivals[0].error;
    worst = Math.max(worst, Math.abs(error));
    assert.ok(error < 1.5, `样本 ${i} 冲过停车点 ${error.toFixed(2)}m（起点 ${travel.toFixed(0)}m，${(speed * 3.6).toFixed(0)}km/h）`);
  }
  console.log(`      12 个随机样本最大停车误差 ${worst.toFixed(2)}m`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) {
    console.error(`\nFAIL: ${failure.name}\n  ${failure.message}`);
  }
  process.exitCode = 1;
}
