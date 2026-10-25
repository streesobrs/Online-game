/**
 * 列车纵向动力学（纯逻辑，无 three/DOM 依赖）
 *
 * 抽出来是为了让自动驾驶控制器能在 Node 里做无头仿真测试：
 * 浏览器里的 updatePhysics 与测试脚本共用同一套公式，避免"测试通过但游戏里不一样"。
 */

export const MAX_SPEED = 55.6;        // m/s ≈ 200 km/h
export const MAX_TRACTION = 3.5;      // 满牵引加速度（低速）
export const MAX_BRAKE = 3.6;         // 满制动减速度

export function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

/** 基本运行阻力（m/s²） */
export function resistanceAt(speed) {
  return 0.25 + 0.005 * speed + 0.0003 * speed * speed;
}

/** 牵引力随速度衰减系数（高速仍保留足够牵引，才能跑到 200 km/h） */
export function tractionFactor(speed) {
  return Math.max(0.15, 1 - 0.32 * speed / MAX_SPEED);
}

/**
 * 给定挡位（允许小数，自动模式用）计算瞬时加速度。
 * 正挡为牵引，负挡为制动，0 挡惰行。
 */
export function throttleAcceleration(speed, throttle) {
  const t = clamp(throttle, -8, 8);
  let traction = 0;
  let braking = 0;
  if (t > 0) traction = (t / 8) * MAX_TRACTION * tractionFactor(speed);
  else if (t < 0) braking = (-t / 8) * MAX_BRAKE;
  return traction - braking - resistanceAt(speed);
}

/** 单步积分，与旧版 updatePhysics 完全一致 */
export function stepTrain(speed, dt, throttle) {
  return clamp(speed + throttleAcceleration(speed, throttle) * dt, 0, MAX_SPEED);
}

/**
 * 加速度指令 → 挡位（逆动力学 + 阻力前馈）。
 * 想要净加速度 a，牵引时必须额外克服阻力；制动时阻力帮忙，可少用一点制动力。
 */
export function throttleForAcceleration(speed, accel) {
  const res = resistanceAt(speed);
  if (accel >= 0) {
    const traction = accel + res;
    const maxTraction = MAX_TRACTION * tractionFactor(speed);
    return clamp((traction / Math.max(maxTraction, 0.05)) * 8, 0, 8);
  }
  const neededBrake = -accel - res;
  return -clamp((neededBrake / MAX_BRAKE) * 8, 0, 8);
}
