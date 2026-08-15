/**
 * 中国象棋棋盘模块（任务 3.2.1）
 * 9 列 × 10 行，与 v1 一致（40px 格距，楚河汉界，九宫斜线，红下黑上）。
 * 数据模型：board[r][c] = { name: '车', color: 'red'|'black' } | null
 * 棋子 DOM 与 v1 一致：绝对定位圆形汉字棋子（chess-red / chess-black）。
 */
import { el } from '../../utils/dom.js';
import { fitBoard } from '../../utils/responsive.js';

export const BOARD_W = 9;   // 列
export const BOARD_H = 10;  // 行
export const CELL = 40;     // 格距（与 v1 一致）
export const RED = 'red';
export const BLACK = 'black';

/** 标准初始布局（与 v1 chessPieces 一致：红方在下、黑方在上） */
export function defaultLayout() {
    const board = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));
    const redBack = ['车', '马', '相', '仕', '帅', '仕', '相', '马', '车'];
    const blackBack = ['车', '马', '象', '士', '将', '士', '象', '马', '车'];
    redBack.forEach((name, c) => (board[9][c] = { name, color: RED }));
    blackBack.forEach((name, c) => (board[0][c] = { name, color: BLACK }));
    board[7][1] = { name: '炮', color: RED };
    board[7][7] = { name: '炮', color: RED };
    board[2][1] = { name: '炮', color: BLACK };
    board[2][7] = { name: '炮', color: BLACK };
    for (const c of [0, 2, 4, 6, 8]) {
        board[6][c] = { name: '兵', color: RED };
        board[3][c] = { name: '卒', color: BLACK };
    }
    return board;
}

/**
 * 创建象棋棋盘
 * @param {HTMLElement} container - 棋盘挂载容器
 * @param {Object} [options]
 * @param {(r: number, c: number) => void} [options.onCellClick] - 交叉点点击回调（外部接管选子/走子）
 * @param {boolean} [options.flip] - 黑方视角：棋盘整体 180° 旋转，黑棋显示在下方（内部坐标不变）
 * @returns {Object} 棋盘 API
 */
export function createChessBoard(container, options = {}) {
    const { onCellClick, flip = false } = options;
    let board = defaultLayout();
    let selected = null; // {r, c}
    let validMoves = [];
    let lastMove = null; // {r, c}
    let destroyed = false;

    const root = el('div', { class: `chess-board${flip ? ' chess-board--flipped' : ''}` });
    const cells = [];
    const pieceEls = new Map(); // key `${r},${c}` -> 棋子 DOM

    // ========== SVG 网格线（复刻 v1：竖线河界断开、九宫斜线） ==========
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'chess-grid');
    const W = BOARD_W * CELL;   // 320
    const H = BOARD_H * CELL;   // 360

    // 竖线（9 条）：边线连续，中间线在河界上下分开（复刻 v1：上段 0-160、下段 200-360）
    for (let c = 0; c < BOARD_W; c++) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', c * CELL);
        line.setAttribute('y1', 0);
        line.setAttribute('x2', c * CELL);
        line.setAttribute('y2', c === 0 || c === BOARD_W - 1 ? H : 160);
        svg.appendChild(line);
        if (c > 0 && c < BOARD_W - 1) {
            const bottom = document.createElementNS(NS, 'line');
            bottom.setAttribute('x1', c * CELL);
            bottom.setAttribute('y1', 200);
            bottom.setAttribute('x2', c * CELL);
            bottom.setAttribute('y2', H);
            svg.appendChild(bottom);
        }
    }
    // 横线（10 条）
    for (let r = 0; r < BOARD_H; r++) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', r * CELL);
        line.setAttribute('x2', W);
        line.setAttribute('y2', r * CELL);
        svg.appendChild(line);
    }
    // 九宫斜线（黑方 0-2 行、红方 7-9 行，3-5 列）
    const diagonals = [
        [[120, 0, 200, 80], [200, 0, 120, 80]],      // 黑方九宫
        [[120, 280, 200, 360], [200, 280, 120, 360]], // 红方九宫
    ];
    for (const diag of diagonals) {
        for (const [x1, y1, x2, y2] of diag) {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            svg.appendChild(line);
        }
    }

    // ========== 交叉点（90 个） ==========
    for (let r = 0; r < BOARD_H; r++) {
        cells[r] = [];
        for (let c = 0; c < BOARD_W; c++) {
            const cell = el('div', { class: 'chess-intersection' });
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.style.left = `${c * CELL + 20}px`;
            cell.style.top = `${r * CELL + 20}px`;
            cell.addEventListener('click', () => {
                if (!destroyed && typeof onCellClick === 'function') onCellClick(r, c);
            });
            cells[r][c] = cell;
            root.appendChild(cell);

            // 兵位标记（与 v1 一致）
            if (
                ((r === 3 || r === 6) && (c === 0 || c === 2 || c === 4 || c === 6 || c === 8)) ||
                ((r === 2 || r === 7) && (c === 1 || c === 7)) ||
                ((r === 0 || r === 9) && (c === 0 || c === 2 || c === 4 || c === 6 || c === 8))
            ) {
                cell.appendChild(el('div', { class: 'chess-position' }));
            }
        }
    }

    // ========== 河界文字 ==========
    const river = el('div', { class: 'chess-river' });

    root.append(svg, river);
    container.appendChild(root); // 挂载到容器（与 gobang/go 一致）
    const fit = fitBoard(root, container);

    // ========== 棋子渲染 ==========
    function makePieceEl(piece) {
        const p = el('div', { class: `chess-piece ${piece.color === RED ? 'chess-red' : 'chess-black'}` });
        // 文字用 span 包裹：黑方视角翻转时仅反转文字，保持可读（棋子外层定位 transform 不受影响）
        const label = el('span', { class: `chess-piece-label${flip ? ' chess-piece-label--flipped' : ''}` }, piece.name);
        p.appendChild(label);
        p.dataset.name = piece.name;
        p.dataset.color = piece.color;
        return p;
    }

    function renderPieces() {
        for (const node of pieceEls.values()) node.remove();
        pieceEls.clear();
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) {
                const piece = board[r][c];
                if (piece) {
                    const node = makePieceEl(piece);
                    node.dataset.r = r;
                    node.dataset.c = c;
                    node.style.left = `${c * CELL + 20}px`;
                    node.style.top = `${r * CELL + 20}px`;
                    node.style.transform = 'translate(-50%, -50%)'; // 居中到交叉点（与 v1 一致）
                    // 点击棋子同样触发选子（棋子覆盖在交叉点上方，需单独绑定，与 v1 棋子 onclick 对应）
                    node.addEventListener('click', () => {
                        if (!destroyed && typeof onCellClick === 'function') {
                            onCellClick(Number(node.dataset.r), Number(node.dataset.c));
                        }
                    });
                    root.appendChild(node);
                    pieceEls.set(`${r},${c}`, node);
                }
            }
        }
    }

    // ========== 公共 API ==========
    renderPieces(); // 创建时渲染初始布局（标准开局）

    return {
        /** 原始数据数组（10×9，可读） */
        get board() {
            return board;
        },

        /** 用数据初始化棋盘（layout = 10×9 数组） */
        init(layout = defaultLayout()) {
            board = layout;
            selected = null;
            lastMove = null;
            validMoves = [];
            renderPieces();
        },

        /** 恢复标准开局 */
        reset() {
            this.init(defaultLayout());
        },

        /** 读取格子数据 */
        get(r, c) {
            return board[r][c] || null;
        },

        /**
         * 移动棋子（更新数据 + DOM，含吃子）
         * @returns {{name: string, color: string}|null} 被吃掉的棋子（无则 null）
         */
        movePiece(fromR, fromC, toR, toC) {
            const piece = board[fromR][fromC];
            if (!piece) return null;
            const captured = board[toR][toC];
            // 数据
            board[toR][toC] = piece;
            board[fromR][fromC] = null;
            // DOM：先移除目标格上的被吃棋子
            const capturedNode = pieceEls.get(`${toR},${toC}`);
            if (capturedNode) {
                capturedNode.remove();
                pieceEls.delete(`${toR},${toC}`);
            }
            // 再移动棋子 DOM
            const node = pieceEls.get(`${fromR},${fromC}`);
            if (node) {
                node.classList.remove('selected'); // 移动后取消选中（复用节点仍带旧选中态，需移除）
                node.dataset.r = toR;
                node.dataset.c = toC;
                node.style.left = `${toC * CELL + 20}px`;
                node.style.top = `${toR * CELL + 20}px`;
                pieceEls.set(`${toR},${toC}`, node);
                pieceEls.delete(`${fromR},${fromC}`);
            }
            return captured;
        },

        /** 选中棋子（高亮） */
        select(r, c) {
            this.clearSelection();
            selected = { r, c };
            const node = pieceEls.get(`${r},${c}`);
            if (node) node.classList.add('selected');
        },

        /** 当前选中位置 */
        getSelected() {
            return selected;
        },

        /** 显示合法走位标记 */
        setValidMoves(moves) {
            validMoves.forEach(({ r, c }) => cells[r][c].classList.remove('valid-move'));
            validMoves = moves || [];
            validMoves.forEach(({ r, c }) => cells[r][c].classList.add('valid-move'));
        },

        /** 清除选中与走位标记 */
        clearSelection() {
            if (selected) {
                const node = pieceEls.get(`${selected.r},${selected.c}`);
                if (node) node.classList.remove('selected');
                selected = null;
            }
            this.setValidMoves([]);
        },

        /** 标记最后一步位置 */
        setLastMove(r, c) {
            if (lastMove) cells[lastMove.r][lastMove.c].classList.remove('last-move');
            lastMove = { r, c };
            if (r !== undefined) cells[r][c].classList.add('last-move');
        },

        /** 销毁棋盘 DOM */
        destroy() {
            destroyed = true;
            fit.destroy();
            root.remove();
        },
    };
}
