/**
 * 关卡 payload 结构校验（开发方案 4.5 UGC-ready）
 *
 * 纯结构校验，不启动引擎。将来接入关卡平台时由上传前调用；
 * 服务端只有静态限制表、不做玩法校验（见《关卡平台-设计方案.md》第四章）
 */
import { BLOCKER_KINDS, BOARD_LIMITS, COLOR_LIMITS, SHUFFLE } from './config.js';
import { parseMask } from './grid.js';

/** 当前 payload 结构版本，结构不兼容变更时递增 */
export const LEVEL_SCHEMA_VERSION = 1;

const GOAL_TYPES = ['score', 'collect', 'clearBlockers'];
const GRAVITY_DIRECTIONS = ['down'];

function isInteger(value) {
  return Number.isInteger(value);
}

function withinBoard(value, limit) {
  return isInteger(value) && value >= 0 && value < limit;
}

/**
 * 校验关卡配置
 * @param {object} payload 关卡配置（levels.js 单关结构）
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateLevel(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['关卡必须是一个对象'] };
  }

  const errors = [];
  const { rows, cols } = payload;

  // 版本
  if (payload.schemaVersion != null && payload.schemaVersion !== LEVEL_SCHEMA_VERSION) {
    errors.push(`schemaVersion 不支持：${payload.schemaVersion}（当前 ${LEVEL_SCHEMA_VERSION}）`);
  }

  // 棋盘尺寸
  const rowsOk = isInteger(rows) && rows >= BOARD_LIMITS.minRows && rows <= BOARD_LIMITS.maxRows;
  if (!rowsOk) {
    errors.push(`rows 必须是 ${BOARD_LIMITS.minRows}~${BOARD_LIMITS.maxRows} 的整数`);
  }
  const colsOk = isInteger(cols) && cols >= BOARD_LIMITS.minCols && cols <= BOARD_LIMITS.maxCols;
  if (!colsOk) {
    errors.push(`cols 必须是 ${BOARD_LIMITS.minCols}~${BOARD_LIMITS.maxCols} 的整数`);
  }
  const sizeOk = rowsOk && colsOk;
  if (sizeOk && rows * cols > BOARD_LIMITS.maxCells) {
    errors.push(`格子上限 ${BOARD_LIMITS.maxCells}，当前 ${rows * cols}`);
  }

  // 可玩格遮罩
  let playable = null;
  if (sizeOk && payload.mask != null) {
    playable = parseMask(rows, cols, payload.mask);
    if (!Array.isArray(payload.mask) || payload.mask.length !== rows) {
      errors.push(`mask 必须是长度为 ${rows} 的数组`);
      playable = null;
    } else {
      const badLine = payload.mask.findIndex(
        (line) => typeof line !== 'string' || line.length !== cols || /[^01]/.test(line),
      );
      if (badLine !== -1) {
        errors.push(`mask 第 ${badLine + 1} 行必须是长度为 ${cols} 的 0/1 字符串`);
        playable = null;
      } else {
        let count = 0;
        for (let i = 0; i < playable.length; i += 1) {
          if (playable[i]) count += 1;
        }
        const ratio = count / playable.length;
        if (ratio < SHUFFLE.minPlayableRatio) {
          errors.push(`可玩格子占比过低：${(ratio * 100).toFixed(0)}%（下限 ${SHUFFLE.minPlayableRatio * 100}%）`);
        }
      }
    }
  }

  // 元素种类
  const { colors } = payload;
  if (!isInteger(colors) || colors < COLOR_LIMITS.min || colors > COLOR_LIMITS.max) {
    errors.push(`colors 必须是 ${COLOR_LIMITS.min}~${COLOR_LIMITS.max} 的整数`);
  }

  // 步数（闯关模式必填）
  if (payload.moves != null && (!isInteger(payload.moves) || payload.moves <= 0)) {
    errors.push('moves 必须是正整数');
  }

  // 目标
  if (!Array.isArray(payload.goals) || payload.goals.length === 0) {
    errors.push('goals 必须是非空数组');
  } else {
    payload.goals.forEach((goal, k) => {
      if (!goal || !GOAL_TYPES.includes(goal.type)) {
        errors.push(`goals[${k}].type 必须是 ${GOAL_TYPES.join(' / ')} 之一`);
        return;
      }
      if (!Number.isFinite(goal.target) || goal.target <= 0) {
        errors.push(`goals[${k}].target 必须是正数`);
      }
      if (goal.type === 'collect') {
        if (!isInteger(goal.color) || goal.color < 1 || goal.color > COLOR_LIMITS.max) {
          errors.push(`goals[${k}].color 必须是 1~${COLOR_LIMITS.max} 的整数`);
        } else if (isInteger(colors) && goal.color > colors) {
          // 颜色数不够时该颜色根本不会出现，目标永远无法达成
          errors.push(`goals[${k}].color 超出该关颜色数：${goal.color} > colors ${colors}`);
        }
      }
    });
  }

  // 障碍
  if (payload.blockers != null) {
    if (!Array.isArray(payload.blockers)) {
      errors.push('blockers 必须是数组');
    } else if (sizeOk) {
      payload.blockers.forEach((blocker, k) => {
        if (!blocker || !withinBoard(blocker.r, rows) || !withinBoard(blocker.c, cols)) {
          errors.push(`blockers[${k}] 坐标越界`);
          return;
        }
        if (playable && !playable[blocker.r * cols + blocker.c]) {
          errors.push(`blockers[${k}] 落在洞上`);
        }
        if (blocker.kind != null && !BLOCKER_KINDS.includes(blocker.kind)) {
          errors.push(`blockers[${k}].kind 必须是 ${BLOCKER_KINDS.join(' / ')} 之一`);
        }
        if (blocker.hp != null && (!isInteger(blocker.hp) || blocker.hp <= 0)) {
          errors.push(`blockers[${k}].hp 必须是正整数`);
        }
      });
    }
  }

  // 星级阈值
  if (payload.starScore != null && (!Number.isFinite(payload.starScore) || payload.starScore <= 0)) {
    errors.push('starScore 必须是正数');
  }

  // 重力方向（v1 仅支持 down，开发方案 3.2 的 L3 预留）
  if (payload.gravity != null && !GRAVITY_DIRECTIONS.includes(payload.gravity)) {
    errors.push(`gravity 目前仅支持 ${GRAVITY_DIRECTIONS.join(' / ')}`);
  }

  return { ok: errors.length === 0, errors };
}
