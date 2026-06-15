/**
 * 独立游戏回放模块
 * 提供统一的回放弹窗功能，可供 index.html 和 games-history.html 共同使用
 * 用法：ReplayModule.showReplay(replayData)
 */
(function () {
  'use strict';

  // ========== 内部状态 ==========
  var state = {
    replay: null,
    currentMoveIndex: 0,
    isPlaying: false,
    playInterval: null,
    speed: 1000
  };

  // ========== 公开 API ==========
  var ReplayModule = {
    showReplay: showReplay,
    close: closeModal
  };

  // 暴露到全局
  window.ReplayModule = ReplayModule;

  // ========== 弹窗管理 ==========
  function showReplay(replay) {
    // 兼容旧数据：chess → chinese-chess
    if (replay.gameType === 'chess' || replay.gameType === 'xiangqi') {
      replay.gameType = 'chinese-chess';
    }
    state.replay = replay;
    state.currentMoveIndex = 0;
    state.isPlaying = false;
    state.playInterval = null;
    state.speed = 1000;

    var gameTypeNames = {
      'gobang': '五子棋',
      'go': '围棋',
      'chinese-chess': '中国象棋',
      'snake': '贪吃蛇'
    };

    var modal = document.createElement('div');
    modal.className = 'account-modal-overlay';
    modal.id = 'replay-modal';
    modal.innerHTML = [
      '<div class="account-modal" style="max-width:700px;max-height:98vh;display:flex;flex-direction:column;position:relative;">',
      '<button id="replay-close-btn" style="position:absolute;top:10px;right:10px;background:#e74c3c;color:white;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;z-index:10;">✕</button>',
      '<div class="account-modal-title" style="padding-right:40px;">🎬 游戏回放 - ' + (gameTypeNames[replay.gameType] || replay.gameType) + '</div>',
      replay.gameType !== 'snake' ? [
        '<div style="display:flex;gap:20px;margin-bottom:10px;">',
        '<div style="flex:1;background:#f7fafc;padding:8px;border-radius:8px;text-align:center;">',
        '<div style="font-weight:bold;color:#2d3748;font-size:14px;">',
        (replay.gameType === 'chinese-chess' ? '🔴' : '⚫'),
        ' ' + (replay.player1 ? replay.player1.nickname : '玩家1'),
        '</div>',
        '<div style="font-size:11px;color:#718096;">' + (replay.gameType === 'chinese-chess' ? '红方' : '黑方') + '</div>',
        '</div>',
        '<div style="flex:1;background:#f7fafc;padding:8px;border-radius:8px;text-align:center;">',
        '<div style="font-weight:bold;color:#2d3748;font-size:14px;">',
        (replay.gameType === 'chinese-chess' ? '⚫' : '⚪'),
        ' ' + (replay.player2 ? replay.player2.nickname : '玩家2'),
        '</div>',
        '<div style="font-size:11px;color:#718096;">' + (replay.gameType === 'chinese-chess' ? '黑方' : '白方') + '</div>',
        '</div>',
        '</div>'
      ].join('') : (replay.gameType === 'snake' ? [
        '<div style="display:flex;gap:20px;margin-bottom:10px;">',
        '<div style="flex:1;background:#f7fafc;padding:8px;border-radius:8px;text-align:center;">',
        '<div style="font-weight:bold;color:#2d3748;font-size:14px;">🏆 最终分数</div>',
        '<div style="font-size:18px;color:#e74c3c;font-weight:bold;">' + (replay.score || 0) + '</div>',
        '</div>',
        '<div style="flex:1;background:#f7fafc;padding:8px;border-radius:8px;text-align:center;">',
        '<div style="font-weight:bold;color:#2d3748;font-size:14px;">🐍 最大长度</div>',
        '<div style="font-size:18px;color:#27ae60;font-weight:bold;">' + (replay.maxLength || 1) + '</div>',
        '</div>',
        '<div style="flex:1;background:#f7fafc;padding:8px;border-radius:8px;text-align:center;">',
        '<div style="font-weight:bold;color:#2d3748;font-size:14px;">🍎 吃食物</div>',
        '<div style="font-size:18px;color:#f39c12;font-weight:bold;">' + (replay.foodEaten || 0) + '</div>',
        '</div>',
        '</div>'
      ].join('') : ''),
      '<div id="replay-board-container" style="display:flex;justify-content:center;margin-bottom:10px;overflow:auto;flex-shrink:1;">',
      generateBoardHTML(replay.gameType),
      '</div>',
      '<div style="background:#f7fafc;padding:8px 12px;border-radius:8px;margin-bottom:10px;flex-shrink:0;">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">',
      '<span style="font-size:13px;color:#4a5568;">步数: <span id="replay-move-count">0</span> / ' + replay.moves.length + '</span>',
      '<span style="font-size:13px;color:#4a5568;">速度: <span id="replay-speed-display">1秒/步</span></span>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;">',
      '<input type="range" id="replay-progress" min="0" max="' + replay.moves.length + '" value="0" style="flex:1;">',
      '</div>',
      '</div>',
      '<div style="display:flex;justify-content:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;flex-shrink:0;">',
      '<button id="replay-prev" style="padding:6px 12px;font-size:13px;background:#3498db;">⏮ 上一步</button>',
      '<button id="replay-play" style="padding:6px 16px;font-size:13px;background:#27ae60;">▶ 播放</button>',
      '<button id="replay-next" style="padding:6px 12px;font-size:13px;background:#3498db;">下一步 ⏭</button>',
      '<button id="replay-first" style="padding:6px 12px;font-size:13px;background:#9b59b6;">⏮ 开始</button>',
      '<button id="replay-last" style="padding:6px 12px;font-size:13px;background:#9b59b6;">结束 ⏭</button>',
      '</div>',
      '<div style="display:flex;justify-content:center;gap:8px;margin-bottom:10px;flex-shrink:0;">',
      '<button data-speed="2000" style="padding:4px 10px;font-size:11px;background:#6c757d;">慢速</button>',
      '<button data-speed="1000" style="padding:4px 10px;font-size:11px;background:#3498db;">正常</button>',
      '<button data-speed="500" style="padding:4px 10px;font-size:11px;background:#e67e22;">快速</button>',
      '<button data-speed="200" style="padding:4px 10px;font-size:11px;background:#e74c3c;">极速</button>',
      '</div>',
      '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;margin-bottom:10px;flex-shrink:0;">',
      '<div style="display:flex;align-items:center;gap:10px;width:100%;max-width:300px;">',
      '<span style="font-size:12px;color:#4a5568;min-width:60px;">速度:</span>',
      '<input type="range" id="replay-speed-slider" min="5" max="100" step="5" value="50" style="flex:1;">',
      '<span id="replay-speed-value" style="font-size:12px;color:#4a5568;min-width:60px;text-align:right;">1.0步/秒</span>',
      '</div>',
      '<div style="display:flex;justify-content:space-between;width:100%;max-width:300px;font-size:11px;color:#718096;"><span>慢</span><span>快</span></div>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);

    // 绑定关闭按钮
    document.getElementById('replay-close-btn').onclick = closeModal;

    // 绑定进度条事件
    document.getElementById('replay-progress').addEventListener('input', function (e) {
      jumpToMove(parseInt(e.target.value));
    });

    // 绑定速度滑动条
    var speedSlider = document.getElementById('replay-speed-slider');
    var speedValueEl = document.getElementById('replay-speed-value');
    if (speedSlider && speedValueEl) {
      var stepsPerSec = 1000 / state.speed;
      speedSlider.value = Math.max(5, Math.min(100, Math.round(stepsPerSec * 10)));
      speedValueEl.textContent = stepsPerSec.toFixed(1) + '步/秒';

      speedSlider.addEventListener('input', function (e) {
        var sliderVal = parseInt(e.target.value);
        var sps = sliderVal / 10;
        setSpeed(Math.round(1000 / sps));
        speedValueEl.textContent = sps.toFixed(1) + '步/秒';
      });
    }

    // 绑定按钮事件
    document.getElementById('replay-prev').onclick = replayPrev;
    document.getElementById('replay-next').onclick = replayNext;
    document.getElementById('replay-play').onclick = togglePlay;
    document.getElementById('replay-first').onclick = replayFirst;
    document.getElementById('replay-last').onclick = replayLast;

    // 绑定速度按钮
    var speedBtns = modal.querySelectorAll('[data-speed]');
    for (var si = 0; si < speedBtns.length; si++) {
      speedBtns[si].onclick = function () {
        setSpeed(parseInt(this.getAttribute('data-speed')));
      };
    }

    renderBoard();
  }

  function closeModal() {
    stopPlay();
    var modal = document.getElementById('replay-modal');
    if (modal) {
      modal.remove();
    }
  }

  // ========== 棋盘生成 ==========
  function generateBoardHTML(gameType) {
    // 兼容旧数据
    if (gameType === 'chess' || gameType === 'xiangqi') gameType = 'chinese-chess';
    if (gameType === 'gobang') {
      return '<div id="replay-gobang-board" class="gobang-board replay-board" style="display:grid;"></div>';
    }
    if (gameType === 'go') {
      return '<div id="replay-go-board" class="go-board replay-board" style="display:grid;"></div>';
    }
    if (gameType === 'chinese-chess') {
      var cs = 30, pw = 20;
      var bw = cs * 8, bh = cs * 9;
      var tw = bw + pw * 2, th = bh + pw * 2;
      var svg = '';
      svg += '<svg width="' + tw + '" height="' + th + '" style="position:absolute;top:0;left:0;pointer-events:none;">';
      svg += '<rect width="' + tw + '" height="' + th + '" fill="#f0d9b5" rx="4"/>';
      for (var i = 0; i < 10; i++) {
        var y = pw + i * cs;
        svg += '<line x1="' + pw + '" y1="' + y + '" x2="' + (pw + bw) + '" y2="' + y + '" stroke="#5c4033" stroke-width="1"/>';
      }
      for (var j = 0; j < 9; j++) {
        var x = pw + j * cs;
        if (j === 0 || j === 8) {
          svg += '<line x1="' + x + '" y1="' + pw + '" x2="' + x + '" y2="' + (pw + bh) + '" stroke="#5c4033" stroke-width="1"/>';
        } else {
          svg += '<line x1="' + x + '" y1="' + pw + '" x2="' + x + '" y2="' + (pw + cs * 4) + '" stroke="#5c4033" stroke-width="1"/>';
          svg += '<line x1="' + x + '" y1="' + (pw + cs * 5) + '" x2="' + x + '" y2="' + (pw + bh) + '" stroke="#5c4033" stroke-width="1"/>';
        }
      }
      // 九宫格斜线
      var p1x = pw + 3 * cs, p2x = pw + 5 * cs;
      svg += '<line x1="' + p1x + '" y1="' + pw + '" x2="' + p2x + '" y2="' + (pw + 2 * cs) + '" stroke="#5c4033" stroke-width="1"/>';
      svg += '<line x1="' + p2x + '" y1="' + pw + '" x2="' + p1x + '" y2="' + (pw + 2 * cs) + '" stroke="#5c4033" stroke-width="1"/>';
      svg += '<line x1="' + p1x + '" y1="' + (pw + 7 * cs) + '" x2="' + p2x + '" y2="' + (pw + 9 * cs) + '" stroke="#5c4033" stroke-width="1"/>';
      svg += '<line x1="' + p2x + '" y1="' + (pw + 7 * cs) + '" x2="' + p1x + '" y2="' + (pw + 9 * cs) + '" stroke="#5c4033" stroke-width="1"/>';
      svg += '<text x="' + (pw + bw / 2 - cs * 2.5) + '" y="' + (pw + cs * 4.6) + '" fill="#5c4033" font-size="16" font-family="KaiTi,serif">楚河</text>';
      svg += '<text x="' + (pw + bw / 2 + cs * 0.5) + '" y="' + (pw + cs * 4.6) + '" fill="#5c4033" font-size="16" font-family="KaiTi,serif">汉界</text>';
      svg += '</svg>';
      return '<div id="replay-chess-board" style="position:relative;width:' + tw + 'px;height:' + th + 'px;margin:0 auto;">' +
        svg +
        '<div id="replay-chess-pieces" style="position:absolute;top:0;left:0;width:' + tw + 'px;height:' + th + 'px;"></div></div>';
    }
    if (gameType === 'snake') {
      return '<div style="text-align:center;"><canvas id="replay-snake-canvas" width="400" height="400" style="border:2px solid #37474f;background:#263238;"></canvas></div>';
    }
    return '';
  }

  // ========== 棋盘渲染 ==========
  function renderBoard() {
    var gameType = state.replay.gameType;
    if (gameType === 'gobang') renderGobang();
    else if (gameType === 'go') renderGo();
    else if (gameType === 'chinese-chess') renderChineseChess();
    else if (gameType === 'snake') renderSnake();
  }

  function renderGobang() {
    var board = document.getElementById('replay-gobang-board');
    if (!board) return;
    var size = 19;

    if (!board.hasChildNodes()) {
      board.style.gridTemplateColumns = 'repeat(' + size + ', 30px)';
      board.style.gridTemplateRows = 'repeat(' + size + ', 30px)';
      board.style.padding = '15px';
      board.style.display = 'grid';
      board.style.gap = '0';
      var html = '';
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          html += '<div class="gobang-cell" data-r="' + r + '" data-c="' + c + '" style="width:30px;height:30px;"></div>';
        }
      }
      board.innerHTML = html;
    }

    board.querySelectorAll('.last-move').forEach(function (el) { el.classList.remove('last-move'); });

    var targetIndex = state.currentMoveIndex;
    var moves = state.replay.moves;

    for (var i = 0; i < moves.length; i++) {
      var move = moves[i];
      if (!move.position) continue;
      var cell = board.querySelector('[data-r="' + move.position.r + '"][data-c="' + move.position.c + '"]');
      if (!cell) continue;
      var existing = cell.querySelector('.gobang-black, .gobang-white');
      if (i < targetIndex) {
        if (!existing) {
          var piece = document.createElement('div');
          piece.className = move.color === 1 ? 'gobang-black' : 'gobang-white';
          piece.style.width = '24px';
          piece.style.height = '24px';
          cell.appendChild(piece);
        }
        if (i === targetIndex - 1) cell.classList.add('last-move');
      } else {
        if (existing) existing.remove();
      }
    }
  }

  function renderGo() {
    var board = document.getElementById('replay-go-board');
    if (!board) return;
    var size = 19;

    if (!board.hasChildNodes()) {
      board.style.gridTemplateColumns = 'repeat(' + size + ', 28px)';
      board.style.gridTemplateRows = 'repeat(' + size + ', 28px)';
      board.style.padding = '15px';
      board.style.display = 'grid';
      board.style.gap = '0';
      var html = '';
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          html += '<div class="go-cell" data-r="' + r + '" data-c="' + c + '" style="width:28px;height:28px;"></div>';
        }
      }
      board.innerHTML = html;
    }

    board.querySelectorAll('.last-move').forEach(function (el) { el.classList.remove('last-move'); });

    var targetIndex = state.currentMoveIndex;
    var moves = state.replay.moves;

    for (var i = 0; i < moves.length; i++) {
      var move = moves[i];
      if (!move.position) continue;
      var cell = board.querySelector('[data-r="' + move.position.r + '"][data-c="' + move.position.c + '"]');
      if (!cell) continue;
      var existing = cell.querySelector('.go-black, .go-white');
      if (i < targetIndex) {
        if (!existing) {
          var piece = document.createElement('div');
          piece.className = move.color === 1 ? 'go-black' : 'go-white';
          piece.style.width = '22px';
          piece.style.height = '22px';
          cell.appendChild(piece);
        }
        if (i === targetIndex - 1) cell.classList.add('last-move');
      } else {
        if (existing) existing.remove();
      }
    }
  }

  function getInitialChessBoard() {
    return [
      ['b-ju', 'b-ma', 'b-xiang', 'b-shi', 'b-jiang', 'b-shi', 'b-xiang', 'b-ma', 'b-ju'],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 'b-pao', 0, 0, 0, 0, 0, 'b-pao', 0],
      ['b-zu', 0, 'b-zu', 0, 'b-zu', 0, 'b-zu', 0, 'b-zu'],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['r-bing', 0, 'r-bing', 0, 'r-bing', 0, 'r-bing', 0, 'r-bing'],
      [0, 'r-pao', 0, 0, 0, 0, 0, 'r-pao', 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['r-ju', 'r-ma', 'r-xiang', 'r-shi', 'r-shuai', 'r-shi', 'r-xiang', 'r-ma', 'r-ju']
    ];
  }

  function renderChineseChess() {
    var boardContainer = document.getElementById('replay-chess-board');
    if (!boardContainer) return;

    var cs = 30, pw = 20;
    var moves = state.replay.moves;
    var targetIndex = state.currentMoveIndex;

    // 从初始棋盘开始应用所有步数
    var board = getInitialChessBoard();
    for (var i = 0; i < targetIndex && i < moves.length; i++) {
      var move = moves[i];
      if (move.position && move.position.fromR !== undefined) {
        var fr = move.position.fromR, fc = move.position.fromC;
        var tr = move.position.toR, tc = move.position.toC;
        if (board[fr] && board[fr][fc]) {
          board[tr][tc] = board[fr][fc];
          board[fr][fc] = 0;
        }
      }
    }

    var piecesContainer = document.getElementById('replay-chess-pieces');
    if (!piecesContainer) return;
    piecesContainer.innerHTML = '';

    // 高亮位置
    var lastFR = -1, lastFC = -1, lastTR = -1, lastTC = -1;
    if (targetIndex > 0 && targetIndex <= moves.length) {
      var lastMove = moves[targetIndex - 1];
      if (lastMove.position && lastMove.position.fromR !== undefined) {
        lastFR = lastMove.position.fromR;
        lastFC = lastMove.position.fromC;
        lastTR = lastMove.position.toR;
        lastTC = lastMove.position.toC;
      }
    }

    var redMap = { 'ju': '车', 'ma': '马', 'xiang': '相', 'shi': '仕', 'shuai': '帅', 'pao': '炮', 'bing': '兵', 'jiang': '将', 'zu': '卒' };
    var blackMap = { 'ju': '车', 'ma': '马', 'xiang': '象', 'shi': '士', 'jiang': '将', 'pao': '炮', 'zu': '卒' };
    var pieceSize = 26;

    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 9; c++) {
        var cell = board[r][c];
        if (cell && cell !== 0) {
          var color = cell.startsWith('r-') ? 'red' : 'black';
          var type = cell.substring(2);
          var name = color === 'red' ? (redMap[type] || type) : (blackMap[type] || type);
          var isRed = color === 'red';

          var piece = document.createElement('div');
          piece.textContent = name;
          var px = pw + c * cs - pieceSize / 2;
          var py = pw + r * cs - pieceSize / 2;

          piece.style.cssText = [
            'position:absolute;',
            'left:' + px + 'px;',
            'top:' + py + 'px;',
            'width:' + pieceSize + 'px;',
            'height:' + pieceSize + 'px;',
            'border-radius:50%;',
            'display:flex;',
            'align-items:center;',
            'justify-content:center;',
            'font-weight:bold;',
            'font-size:14px;',
            'cursor:default;',
            'border:2px solid rgba(255,255,255,0.4);',
            'box-shadow:0 2px 6px rgba(0,0,0,0.3);',
            'z-index:10;',
            isRed ? 'background:radial-gradient(circle at 35% 35%,#ff7b7b 0%,#e04848 50%,#c0392b 100%);color:white;text-shadow:0 1px 2px rgba(0,0,0,0.3);' : 'background:radial-gradient(circle at 35% 35%,#5d6d7e 0%,#3d4c53 50%,#2c3e50 100%);color:white;text-shadow:0 1px 2px rgba(0,0,0,0.4);'
          ].join('');
          piecesContainer.appendChild(piece);
        }
      }
    }

    // 高亮目标
    if (lastTR >= 0) {
      var hl = document.createElement('div');
      var hlSize = 28;
      hl.style.cssText = 'position:absolute;left:' + (pw + lastTC * cs - hlSize / 2) + 'px;top:' + (pw + lastTR * cs - hlSize / 2) + 'px;width:' + hlSize + 'px;height:' + hlSize + 'px;border-radius:50%;border:2px solid #f1c40f;box-shadow:0 0 8px rgba(241,196,15,0.6);pointer-events:none;z-index:5;animation:none;';
      piecesContainer.appendChild(hl);
    }
    if (lastFR >= 0 && (lastFR !== lastTR || lastFC !== lastTC)) {
      var hl2 = document.createElement('div');
      var hlSize2 = 28;
      hl2.style.cssText = 'position:absolute;left:' + (pw + lastFC * cs - hlSize2 / 2) + 'px;top:' + (pw + lastFR * cs - hlSize2 / 2) + 'px;width:' + hlSize2 + 'px;height:' + hlSize2 + 'px;border-radius:50%;border:2px dashed #e74c3c;opacity:0.5;pointer-events:none;z-index:5;';
      piecesContainer.appendChild(hl2);
    }
  }

  function renderSnake() {
    var canvas = document.getElementById('replay-snake-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var cellSize = 20, gridSize = 20;

    ctx.fillStyle = '#263238';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var i = 0; i <= gridSize; i++) {
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, canvas.height);
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(canvas.width, i * cellSize);
    }
    ctx.stroke();

    var targetIndex = state.currentMoveIndex;
    var moves = state.replay.moves;
    if (targetIndex === 0) return;

    var snake = [], foods = [];
    if (moves.length > 0 && moves[0][0] === 'init') {
      var initMove = moves[0];
      snake = initMove[3].map(function (s) { return { x: s[0], y: s[1] }; });
      // init格式: ['init', timestamp, direction, snake, foodCount, f1x, f1y, ..., score]
      var initFoodCount = initMove[4];
      if (typeof initFoodCount === 'number' && initFoodCount > 0) {
        for (var fi = 0; fi < initFoodCount; fi++) {
          var fx = initMove[5 + fi * 2];
          var fy = initMove[6 + fi * 2];
          if (typeof fx === 'number' && typeof fy === 'number') {
            foods.push({ x: fx, y: fy });
          }
        }
      }
    }

    for (var i2 = 1; i2 < targetIndex && i2 < moves.length; i2++) {
      var mv = moves[i2];
      if (Array.isArray(mv)) {
        var head = { x: mv[1], y: mv[2] };
        var ate = mv[3] === 1;
        if (snake.length > 0) {
          snake.unshift(head);
          if (!ate) snake.pop();
        }
        if (ate && mv.length > 5) {
          // 格式: [..., foodCount, f1x, f1y, f2x, f2y, ...]
          var foodCount = mv[4];
          foods = [];
          if (typeof foodCount === 'number' && foodCount > 0) {
            for (var fj = 0; fj < foodCount; fj++) {
              var fxx = mv[5 + fj * 2];
              var fyy = mv[6 + fj * 2];
              if (typeof fxx === 'number' && typeof fyy === 'number') {
                foods.push({ x: fxx, y: fyy });
              }
            }
          }
        }
      }
    }

    if (snake.length === 0 && moves.length > 0 && moves[0][0] === 'init') {
      var initMove2 = moves[0];
      snake = initMove2[3].map(function (s) { return { x: s[0], y: s[1] }; });
    }

    // 渲染所有食物
    if (foods && foods.length > 0) {
      ctx.fillStyle = '#ff6b6b';
      for (var fi2 = 0; fi2 < foods.length; fi2++) {
        ctx.beginPath();
        ctx.arc(foods[fi2].x * cellSize + cellSize / 2, foods[fi2].y * cellSize + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 渲染蛇（蛇头为亮青色，身体为深蓝色）
    if (snake && snake.length > 0) {
      ctx.fillStyle = '#45b7d1';
      for (var s = 1; s < snake.length; s++) {
        ctx.fillRect(snake[s].x * cellSize + 1, snake[s].y * cellSize + 1, cellSize - 2, cellSize - 2);
      }
      ctx.fillStyle = '#4ecdc4';
      ctx.fillRect(snake[0].x * cellSize + 1, snake[0].y * cellSize + 1, cellSize - 2, cellSize - 2);
    }
  }

  // ========== UI 更新 ==========
  function updateUI() {
    var moveCount = document.getElementById('replay-move-count');
    var progress = document.getElementById('replay-progress');
    if (moveCount) moveCount.textContent = state.currentMoveIndex;
    if (progress) progress.value = state.currentMoveIndex;
  }

  // ========== 导航 ==========
  function replayPrev() {
    if (state.currentMoveIndex > 0) {
      state.currentMoveIndex--;
      renderBoard();
      updateUI();
    }
  }

  function replayNext() {
    if (state.currentMoveIndex < state.replay.moves.length) {
      state.currentMoveIndex++;
      renderBoard();
      updateUI();
    }
  }

  function replayFirst() {
    stopPlay();
    state.currentMoveIndex = 0;
    renderBoard();
    updateUI();
  }

  function replayLast() {
    stopPlay();
    state.currentMoveIndex = state.replay.moves.length;
    renderBoard();
    updateUI();
  }

  function jumpToMove(index) {
    stopPlay();
    state.currentMoveIndex = Math.max(0, Math.min(index, state.replay.moves.length));
    renderBoard();
    updateUI();
  }

  // ========== 播放控制 ==========
  function togglePlay() {
    if (state.isPlaying) {
      stopPlay();
    } else {
      startPlay();
    }
  }

  function startPlay() {
    if (state.currentMoveIndex >= state.replay.moves.length) {
      state.currentMoveIndex = 0;
      renderBoard();
      updateUI();
    }

    state.isPlaying = true;
    var playBtn = document.getElementById('replay-play');
    if (playBtn) {
      playBtn.textContent = '⏸ 暂停';
      playBtn.style.background = '#e74c3c';
    }

    state.playInterval = setInterval(function () {
      if (state.currentMoveIndex < state.replay.moves.length) {
        state.currentMoveIndex++;
        renderBoard();
        updateUI();
      } else {
        stopPlay();
      }
    }, state.speed);
  }

  function stopPlay() {
    state.isPlaying = false;
    if (state.playInterval) {
      clearInterval(state.playInterval);
      state.playInterval = null;
    }
    var playBtn = document.getElementById('replay-play');
    if (playBtn) {
      playBtn.textContent = '▶ 播放';
      playBtn.style.background = '#27ae60';
    }
  }

  // ========== 速度控制 ==========
  function setSpeed(speed) {
    state.speed = speed;
    var speedDisplay = document.getElementById('replay-speed-display');
    if (speedDisplay) {
      if (speed >= 2000) speedDisplay.textContent = '2秒/步';
      else if (speed >= 1000) speedDisplay.textContent = '1秒/步';
      else if (speed >= 500) speedDisplay.textContent = '0.5秒/步';
      else speedDisplay.textContent = '0.2秒/步';
    }

    var speedSlider = document.getElementById('replay-speed-slider');
    var speedValueEl = document.getElementById('replay-speed-value');
    if (speedSlider && speedValueEl) {
      var sps = 1000 / speed;
      speedSlider.value = Math.max(5, Math.min(100, Math.round(sps * 10)));
      speedValueEl.textContent = sps.toFixed(1) + '步/秒';
    }

    if (state.isPlaying) {
      stopPlay();
      startPlay();
    }
  }

})();