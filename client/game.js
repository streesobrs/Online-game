  <script>
    // 鐗堟湰鍙?(璇箟鍖栫増鏈? MAJOR.MINOR.PATCH)
    const CLIENT_VERSION = '1.5.0';

    // 鍏ㄥ眬娓告垙鍙橀噺
    let currentGame = 'gobang'; // 褰撳墠閫夋嫨鐨勬绉嶏細gobang, go, chess, snake
    let accountId = null; // 鐢辨湇鍔″櫒鍒嗛厤

    // 浠巐ocalStorage鑾峰彇鎴栫敓鎴愮敤鎴稩D
    function getSavedUserId() {
      try {
        let saved = localStorage.getItem('gameUserId');
        if (!saved) {
          // 鐢熸垚鏂扮殑鐢ㄦ埛ID骞朵繚瀛?
          saved = generateClientUserId();
          localStorage.setItem('gameUserId', saved);
        }
        return saved;
      } catch (e) {
        console.warn('鏃犳硶璁块棶localStorage:', e);
        return generateClientUserId();
      }
    }

    // 鐢熸垚瀹㈡埛绔敤鎴稩D
    function generateClientUserId() {
      return 'user_' + Math.random().toString(36).substr(2, 9);
    }

    // 淇濆瓨鐢ㄦ埛ID
    function saveUserId(id) {
      try {
        localStorage.setItem('gameUserId', id);
      } catch (e) {
        console.warn('鏃犳硶淇濆瓨鐢ㄦ埛ID:', e);
      }
    }

    // 澶у巺鍜屽尮閰嶇浉鍏冲彉閲?
    let isMatching = false;
    let matchedOpponentId = null;
    let userStatus = 'online';
    let onlineUsers = new Map();

    // 鑱婂ぉ棰戦亾鐩稿叧鍙橀噺
    let currentChatChannel = 'global';
    let globalChatHistory = [];
    let gameChatHistory = [];

    // 璐﹀彿鐩稿叧鍙橀噺
    let currentAccount = null;
    let lastExp = 0;
    let lastLevel = 1;
    let pendingRegisterInfo = null; // 淇濆瓨娉ㄥ唽淇℃伅鐢ㄤ簬鑷姩鐧诲綍

    // Socket.io 杩炴帴
    const socket = io({
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    // 绔嬪嵆璁剧疆Socket.io浜嬩欢鐩戝惉
    setupSocketListeners();

    // 娓告垙鐘舵€佸彉閲?
    let gameState = {
      board: null,
      turn: 1,
      me: 0,
      gameOver: false,
      isConnected: false,
      moveCount: 0,
      moveLog: [],
      blackCount: 0,
      whiteCount: 0,
      gameStartTime: 0,
      gameTimer: null,
      maxChain: 0,
      moveTimestamps: [],
      networkLatency: 0,
      selectedPiece: null,
      validMoves: [],
      koPosition: null, // 鎵撳姭浣嶇疆
      koColor: null // 鎵撳姭棰滆壊
    };

    // 閲嶇疆璇锋眰鏁版嵁
    let currentResetRequest = null;

    // DOM 鍏冪礌
    const themeBg = document.getElementById('theme-bg');
    const winAlert = document.getElementById('win-alert');
    const winText = document.getElementById('win-text');
    const roleEl = document.getElementById('role');
    const myColorEl = document.getElementById('my-color');
    const statusEl = document.getElementById('status');
    const connectStatusEl = document.getElementById('connect-status');
    const gameStatusEl = document.getElementById('game-status');
    const currentTurnEl = document.getElementById('current-turn');
    const lastMoveEl = document.getElementById('last-move');
    const moveCountEl = document.getElementById('move-count');
    const winnerEl = document.getElementById('winner');
    const moveLogEl = document.getElementById('move-log');
    const mousePosEl = document.getElementById('mouse-pos');
    const blackCountEl = document.getElementById('black-count');
    const whiteCountEl = document.getElementById('white-count');
    const gameTimeEl = document.getElementById('game-time');
    const advancedStatsEl = document.getElementById('advanced-stats');
    const totalCellsEl = document.getElementById('total-cells');
    const filledRateEl = document.getElementById('filled-rate');
    const blackWinRateEl = document.getElementById('black-win-rate');
    const whiteWinRateEl = document.getElementById('white-win-rate');
    const fastestWinStepsEl = document.getElementById('fastest-win-steps');
    const maxChainEl = document.getElementById('max-chain');
    const networkLatencyEl = document.getElementById('network-latency');
    const currentChainEl = document.getElementById('current-chain');
    const winConditionEl = document.getElementById('win-condition');
    const emptyCountEl = document.getElementById('empty-count');
    const moveFrequencyEl = document.getElementById('move-frequency');
    const avgMoveIntervalEl = document.getElementById('avg-move-interval');
    const boardFillRateEl = document.getElementById('board-fill-rate');
    const currentGameEl = document.getElementById('current-game');
    const tipPopup = document.getElementById('tip-popup');
    const tipPopupTitle = document.getElementById('tip-popup-title');
    const tipPopupContent = document.getElementById('tip-popup-content');
    const tipPopupClose = document.getElementById('tip-popup-close');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatContainer = document.getElementById('chat-container');
    const clientVersionDisplay = document.getElementById('client-version-display');
    const systemBroadcast = document.getElementById('system-broadcast');
    const broadcastContent = document.getElementById('broadcast-content');
    const broadcastTime = document.getElementById('broadcast-time');
    const channelGlobalBtn = document.getElementById('channel-global');
    const channelGameBtn = document.getElementById('channel-game');

    // 鎸戞垬鐩稿叧DOM
    let challengeModal, challengeTitle, challengeMessage, challengeAcceptBtn, challengeRejectBtn;



    const lobbyContainer = document.getElementById('lobby-container');
    const infoContainer = document.getElementById('info-container');
    const gameControls = document.getElementById('game-controls');
    const statusBox = document.getElementById('status');
    const moveLogPanel = document.getElementById('move-log-panel');
    const lobbyStatus = document.getElementById('lobby-status');
    const matchBtn = document.getElementById('match-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const userList = document.getElementById('user-list');
    const lobbyTitle = document.querySelector('.lobby-title');
    const onlineUsersElement = document.querySelector('.online-users');
    const onlineUsersTitle = document.querySelector('.online-users-title');
    const leaderboardContainer = document.querySelector('.leaderboard-container');
    const leaderboardTitle = document.querySelector('.leaderboard-title');
    const leaderboardList = document.getElementById('leaderboard-list');

    // 妫嬬洏DOM
    const gobangBoard = document.getElementById('gobang-board');
    const goBoard = document.getElementById('go-board');
    const chessBoard = document.getElementById('chess-board');

    // 娓告垙閰嶇疆
    const gameConfigs = {
      gobang: {
        size: 19,
        totalCells: 361,
        winCondition: '浜斿瓙杩炵彔',
        colorNames: ['榛戞', '鐧芥'],
        pieceClasses: ['gobang-black', 'gobang-white'],
        boardClass: 'gobang-board',
        cellClass: 'gobang-cell',
        emoji: '馃敶',
        rules: `浜斿瓙妫嬭鍒欙細
鈥?榛戠櫧鍙屾柟杞祦钀藉瓙锛岄粦妫嬪厛琛?
鈥?鍏堝湪涓€鏉＄洿绾匡紙妯€佺珫銆佹枩锛変笂褰㈡垚浜斿瓙杩炵彔鑰呰幏鑳?
鈥?钀藉瓙鍚庝笉鑳界Щ鍔ㄦ垨鎷挎帀浠讳綍妫嬪瓙
鈥?绂佹闀胯繛锛堣秴杩囦簲棰楁瀛愯繛鎴愪竴绾匡級
鈥?绂佹涓変笁銆佸洓鍥涖€侀暱杩炵瓑绂佹墜锛堟湰鐗堟湰绠€鍖栬鍒欙級`
      },
      go: {
        size: 21,
        totalCells: 441,
        winCondition: '棰嗗湴鏈€澶?,
        colorNames: ['榛戞', '鐧芥'],
        pieceClasses: ['go-black', 'go-white'],
        boardClass: 'go-board',
        cellClass: 'go-cell',
        emoji: '鈿?,
        rules: `鍥存瑙勫垯锛?
鈥?榛戠櫧鍙屾柟杞祦钀藉瓙锛岄粦妫嬪厛琛?
鈥?妫嬪瓙鏀惧湪浜ゅ弶鐐逛笂锛屼笉鑳界Щ鍔?
鈥?褰撲竴缁勬瀛愮殑姘旓紙鐩搁偦绌烘牸锛夎瀵规柟濉弧鏃讹紝杩欑粍妫嬪瓙琚彁璧?
鈥?绂佹鑷潃锛堣惤瀛愬悗浣胯嚜宸辩殑妫嬪瓙绔嬪嵆鏃犳皵锛?
鈥?绂佹鎵撳姭锛堢珛鍗虫彁鍥炶鎻愯蛋鐨勬瀛愶級
鈥?娓告垙缁撴潫鏃讹紝棰嗗湴鍜屾瀛愭暟閲忎箣鍜屽鑰呰幏鑳渀
      },
      'chinese-chess': {
        size: { width: 9, height: 10 },
        totalCells: 90,
        winCondition: '灏嗗竻琚悆',
        colorNames: ['绾㈡柟', '榛戞柟'],
        pieceClasses: ['chess-red', 'chess-black'],
        boardClass: 'chess-board',
        cellClass: 'chess-intersection',
        emoji: '馃煡',
        rules: `璞℃瑙勫垯锛?
鈥?绾㈡柟鍏堣锛屽弻鏂硅疆娴佺Щ鍔ㄦ瀛?
鈥?椹蛋鏃ワ紝璞¤蛋鐢帮紝杞﹁蛋鐩寸嚎鐐炕灞?
鈥?澹蛋鏂滅嚎鎶ゅ皢杈癸紝灏嗗湪涔濆杞湀鍦?
鈥?鍏靛崚杩囨渤妯珫璧帮紝杩囨渤涔嬪墠鍙悜鍓?
鈥?鍚冩帀瀵规柟鐨勫皢甯呰幏鑳?
鈥?涓嶈兘闀垮皢銆侀暱鎹夈€侀暱鏉€绛夐噸澶嶅惊鐜痐
      }
    };

    // ========== 蹇嵎閿郴缁?==========
    // 榛樿蹇嵎閿厤缃?
    const defaultShortcuts = {
      // ========== 娓告垙鍒囨崲 ==========
      '1': { action: 'switchGame', args: ['gobang'], description: '鍒囨崲鍒颁簲瀛愭', category: '娓告垙鍒囨崲' },
      '2': { action: 'switchGame', args: ['go'], description: '鍒囨崲鍒板洿妫?, category: '娓告垙鍒囨崲' },
      '3': { action: 'switchGame', args: ['chinese-chess'], description: '鍒囨崲鍒拌薄妫?, category: '娓告垙鍒囨崲' },
      '4': { action: 'switchGame', args: ['snake'], description: '鍒囨崲鍒拌椽鍚冭泧', category: '娓告垙鍒囨崲' },

      // ========== 鍖归厤绯荤粺 ==========
      'm': { action: 'startMatch', description: '寮€濮嬪尮閰?, category: '鍖归厤绯荤粺' },
      'Escape': { action: 'cancelMatch', description: '鍙栨秷鍖归厤/鍏抽棴寮圭獥', category: '鍖归厤绯荤粺' },
      'r': { action: 'returnToLobby', description: '杩斿洖澶у巺', category: '鍖归厤绯荤粺' },

      // ========== 鐣岄潰鍔熻兘 ==========
      't': { action: 'showGameTips', description: '鏄剧ず娓告垙瑙勫垯', category: '鐣岄潰鍔熻兘' },
      'a': { action: 'showAchievements', description: '鏄剧ず鎴愬氨', category: '鐣岄潰鍔熻兘' },
      'l': { action: 'showLeaderboard', description: '鏄剧ず鎺掕姒?, category: '鐣岄潰鍔熻兘' },
      'i': { action: 'showProfile', description: '涓汉璧勬枡', category: '鐣岄潰鍔熻兘' },
      'h': { action: 'showGameHistory', description: '娓告垙鍘嗗彶', category: '鐣岄潰鍔熻兘' },
      'g': { action: 'showAIGame', description: 'AI瀵规垬', category: '鐣岄潰鍔熻兘' },
      'v': { action: 'showTheme', description: '涓婚璁剧疆', category: '鐣岄潰鍔熻兘' },
      'k': { action: 'showCustomShortcuts', description: '鑷畾涔夊揩鎹烽敭', category: '鐣岄潰鍔熻兘' },
      '?': { action: 'showShortcuts', description: '鏄剧ず蹇嵎閿府鍔?, category: '鐣岄潰鍔熻兘' },
      's': { action: 'toggleSound', description: '鍒囨崲闊虫晥', category: '鐣岄潰鍔熻兘' },
      'q': { action: 'showLogin', description: '鐧诲綍', category: '鐣岄潰鍔熻兘' },
      'e': { action: 'showRegister', description: '娉ㄥ唽', category: '鐣岄潰鍔熻兘' },

      // ========== 娓告垙鎿嶄綔 ==========
      'z': { action: 'undoMove', description: '鎮旀', category: '娓告垙鎿嶄綔' },
      'Shift+Z': { action: 'redoMove', description: '閲嶅仛', category: '娓告垙鎿嶄綔' },
      'u': { action: 'resign', description: '璁よ緭', category: '娓告垙鎿嶄綔' },
      'n': { action: 'newGame', description: '鏂版父鎴?, category: '娓告垙鎿嶄綔' },
      'p': { action: 'togglePause', description: '鏆傚仠/缁х画', category: '娓告垙鎿嶄綔' },
      'f5': { action: 'restartGame', description: '閲嶆柊寮€濮?, category: '娓告垙鎿嶄綔' },

      // 鏂瑰悜閿紙璐悆铔囷級
      'ArrowUp': { action: 'snakeUp', description: '璐悆铔囧悜涓?, category: '璐悆铔囨搷浣? },
      'ArrowDown': { action: 'snakeDown', description: '璐悆铔囧悜涓?, category: '璐悆铔囨搷浣? },
      'ArrowLeft': { action: 'snakeLeft', description: '璐悆铔囧悜宸?, category: '璐悆铔囨搷浣? },
      'ArrowRight': { action: 'snakeRight', description: '璐悆铔囧悜鍙?, category: '璐悆铔囨搷浣? },
      'w': { action: 'snakeUp', description: '璐悆铔囧悜涓?W)', category: '璐悆铔囨搷浣? },
      's': { action: 'snakeDown', description: '璐悆铔囧悜涓?S)', category: '璐悆铔囨搷浣? },
      'a': { action: 'snakeLeft', description: '璐悆铔囧悜宸?A)', category: '璐悆铔囨搷浣? },
      'd': { action: 'snakeRight', description: '璐悆铔囧悜鍙?D)', category: '璐悆铔囨搷浣? },
      ' ': { action: 'snakePause', description: '璐悆铔囨殏鍋?绌烘牸)', category: '璐悆铔囨搷浣? }
    };

    // 浠庢湰鍦板瓨鍌ㄥ姞杞借嚜瀹氫箟蹇嵎閿紝娌℃湁鍒欎娇鐢ㄩ粯璁?
    let shortcuts = loadCustomShortcuts();
    let soundMuted = false;

    function loadCustomShortcuts() {
      try {
        const saved = localStorage.getItem('gameShortcuts');
        if (saved) {
          const custom = JSON.parse(saved);
          return { ...defaultShortcuts, ...custom };
        }
      } catch (e) {
        console.error('鍔犺浇蹇嵎閿け璐?', e);
      }
      return { ...defaultShortcuts };
    }

    function saveCustomShortcuts() {
      try {
        localStorage.setItem('gameShortcuts', JSON.stringify(shortcuts));
      } catch (e) {
        console.error('淇濆瓨蹇嵎閿け璐?', e);
      }
    }

    function resetShortcuts() {
      shortcuts = { ...defaultShortcuts };
      saveCustomShortcuts();
      updateStatus('鉁?蹇嵎閿凡閲嶇疆涓洪粯璁?);
    }

    function handleKeydown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
      const shortcut = shortcuts[key] || shortcuts[e.key];

      if (shortcut) {
        e.preventDefault();
        executeShortcut(shortcut);
      }
    }

    function executeShortcut(shortcut) {
      switch (shortcut.action) {
        // ========== 娓告垙鍒囨崲 ==========
        case 'switchGame':
          switchGame(shortcut.args[0]);
          break;

        // ========== 鍖归厤绯荤粺 ==========
        case 'startMatch':
          if (!isMatching) {
            startMatching();
          }
          break;
        case 'cancelMatch':
          if (isMatching) {
            cancelMatching();
          } else {
            document.querySelectorAll('.modal, .tip-popup, .win-alert').forEach(el => {
              el.style.display = 'none';
            });
          }
          break;
        case 'returnToLobby':
          returnToLobby();
          break;

        // ========== 鐣岄潰鍔熻兘 ==========
        case 'showGameTips':
          showGameTips();
          break;
        case 'showAchievements':
          showAchievements();
          break;
        case 'showLeaderboard':
          showLeaderboard();
          break;
        case 'showProfile':
          showProfileModal();
          break;
        case 'showGameHistory':
          showGameHistoryModal();
          break;
        case 'showAIGame':
          showAIGame();
          break;
        case 'showTheme':
          showThemeModal();
          break;
        case 'showCustomShortcuts':
          showCustomShortcutsPanel();
          break;
        case 'showShortcuts':
          showShortcutsHelp();
          break;
        case 'toggleSound':
          soundMuted = !soundMuted;
          Object.keys(soundEnabled).forEach(k => {
            soundEnabled[k] = !soundMuted;
          });
          updateStatus(soundMuted ? '馃攪 闊虫晥宸插叧闂? : '馃攰 闊虫晥宸插紑鍚?);
          break;
        case 'showLogin':
          showLoginModal();
          break;
        case 'showRegister':
          showRegisterModal();
          break;
        case 'showSettings':
          showSettingsModal();
          break;
        case 'closeModals':
          document.querySelectorAll('.modal, .tip-popup, .win-alert').forEach(el => {
            el.style.display = 'none';
          });
          break;
        case 'toggleTheme':
          cycleTheme();
          break;
        case 'undoMove':
          requestUndo();
          break;
        case 'redoMove':
          handleRedo();
          break;
        case 'resign':
          handleResign();
          break;
        case 'newGame':
          handleNewGame();
          break;
        case 'togglePause':
          togglePause();
          break;
        case 'restartGame':
          restartCurrentGame();
          break;
        case 'snakeUp':
        case 'snakeDown':
        case 'snakeLeft':
        case 'snakeRight':
          handleSnakeDirection(shortcut.action.replace('snake', '').toLowerCase());
          break;
        case 'snakePause':
          toggleSnakePause();
          break;
      }
    }

    function showShortcutsHelp() {
      const categories = {};
      Object.entries(shortcuts).forEach(([key, info]) => {
        if (!categories[info.category]) {
          categories[info.category] = [];
        }
        categories[info.category].push({ key, ...info });
      });

      const helpContent = `
        <div style="padding: 20px; max-width: 500px; background: white; border-radius: 12px; max-height: 80vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="color: #667eea;">鈱笍 蹇嵎閿府鍔?/h3>
            <button onclick="showCustomShortcutsPanel()" style="padding: 6px 12px; font-size: 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">
              鈿欙笍 鑷畾涔?
            </button>
          </div>
          ${Object.entries(categories).map(([category, items]) => `
            <div style="margin-bottom: 15px;">
              <h4 style="color: #495057; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid #eee; padding-bottom: 4px;">${category}</h4>
              <div style="display: grid; gap: 6px; font-size: 13px;">
                ${items.map(({ key, description }) => `
                  <div style="display: flex; justify-content: space-between; padding: 4px 8px; background: #f8f9fa; border-radius: 4px;">
                    <kbd style="background: #e9ecef; padding: 3px 6px; border-radius: 3px; font-family: monospace; font-weight: bold; font-size: 11px;">${key === ' ' ? 'Space' : key.toUpperCase()}</kbd>
                    <span style="color: #666;">${description}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.display = 'flex';
      modal.innerHTML = helpContent;
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }

    function showCustomShortcutsPanel() {
      const categories = {};
      Object.entries(defaultShortcuts).forEach(([key, info]) => {
        if (!categories[info.category]) {
          categories[info.category] = [];
        }
        categories[info.category].push({ key, ...info });
      });

      const panelContent = `
        <div style="padding: 20px; max-width: 550px; background: white; border-radius: 12px; max-height: 85vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="color: #667eea;">鈿欙笍 鑷畾涔夊揩鎹烽敭</h3>
            <div style="display: flex; gap: 8px;">
              <button onclick="resetShortcuts(); showCustomShortcutsPanel()" style="padding: 6px 12px; font-size: 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                閲嶇疆榛樿
              </button>
              <button onclick="document.querySelector('.modal').remove()" style="padding: 6px 12px; font-size: 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                鍏抽棴
              </button>
            </div>
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 15px; padding: 10px; background: #fff3cd; border-radius: 6px;">
            馃挕 鎻愮ず锛氱偣鍑绘寜閿緭鍏ユ鍚庯紝鐩存帴鎸変笅鎯宠璁剧疆鐨勫揩鎹烽敭鍗冲彲
          </div>
          ${Object.entries(categories).map(([category, items]) => `
            <div style="margin-bottom: 18px;">
              <h4 style="color: #495057; margin-bottom: 10px; font-size: 13px; border-bottom: 2px solid #667eea; padding-bottom: 4px;">${category}</h4>
              <div style="display: grid; gap: 8px;">
                ${items.map(({ key, description }) => {
        const currentKey = Object.keys(shortcuts).find(k =>
          shortcuts[k].action === defaultShortcuts[key].action &&
          JSON.stringify(shortcuts[k].args) === JSON.stringify(defaultShortcuts[key].args)
        ) || key;
        return `
                    <div style="display: flex; align-items: center; gap: 10px; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                      <span style="flex: 1; color: #495057; font-size: 13px;">${description}</span>
                      <input type="text" 
                        data-default="${key}" 
                        value="${currentKey === ' ' ? 'Space' : currentKey}" 
                        style="width: 60px; padding: 6px; text-align: center; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;"
                        onfocus="this.dataset.oldValue = this.value; this.value = '...'; this.style.borderColor = '#667eea';"
                        onblur="if(this.value === '...') this.value = this.dataset.oldValue; this.style.borderColor = '#ddd';"
                        onkeydown="handleKeyBind(event, this); return false;">
                    </div>
                  `;
      }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.display = 'flex';
      modal.innerHTML = panelContent;
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }

    function handleKeyBind(e, input) {
      e.preventDefault();

      let key = e.key;
      if (key === ' ') key = ' ';
      else if (key.length > 1) key = e.key;
      else key = key.toLowerCase();

      // 妫€鏌ユ槸鍚﹀凡琚叾浠栧姛鑳藉崰鐢?
      const existingAction = Object.entries(shortcuts).find(([k, v]) => k === key);
      if (existingAction && existingAction[0] !== input.dataset.oldValue) {
        alert(`蹇嵎閿?${key === ' ' ? 'Space' : key} 宸茶 "${existingAction[1].description}" 浣跨敤`);
        input.value = input.dataset.oldValue;
        return;
      }

      // 绉婚櫎鏃х殑缁戝畾
      if (input.dataset.oldValue !== key) {
        delete shortcuts[input.dataset.oldValue];
      }

      // 璁剧疆鏂扮殑缁戝畾
      const defaultKey = input.dataset.default;
      shortcuts[key] = { ...defaultShortcuts[defaultKey] };

      input.value = key === ' ' ? 'Space' : key;
      saveCustomShortcuts();
      updateStatus(`鉁?蹇嵎閿凡鏇存柊: ${key === ' ' ? 'Space' : key.toUpperCase()}`);
    }

    // ========== 鎮旀绯荤粺 ==========

    // 璇锋眰鎮旀
    function requestUndo() {
      // 妫€鏌ユ槸鍚︽湁瓒冲鐨勬倲妫嬫鏁?
      let undoCount = 0;
      let itemUndoCount = 0;
      if (currentAccount) {
        const accData = currentAccount.account;
        undoCount = accData.inventory?.undoCount || 0;
        itemUndoCount = (accData.inventory?.items?.item_undo || 0) * 3;
      }

      const totalUndo = undoCount + itemUndoCount;

      if (totalUndo <= 0) {
        showToast('鈴?鎮旀娆℃暟涓嶈冻锛岃璐拱鎮旀鍗?, 'warning');
        return;
      }

      // 濡傛灉鐩存帴娆℃暟涓嶅浣嗚繕鏈夐亾鍏峰崱锛岃嚜鍔ㄤ娇鐢ㄤ竴寮?
      if (undoCount <= 0 && itemUndoCount > 0) {
        socket.emit('game_use_item', { itemId: 'item_undo' });
        updateStatus('鈴?姝ｅ湪浣跨敤鎮旀鍗?..');
        return;
      }

      if (gameState.gameOver) {
        showToast('鉂?娓告垙宸茬粨鏉燂紝鏃犳硶鎮旀', 'warning');
        return;
      }

      if (currentGame === 'snake') {
        showToast('鉂?璐悆铔囦笉鏀寔鎮旀', 'warning');
        return;
      }

      if (socket && socket.connected) {
        socket.emit('undo_request');
        updateStatus('鈴?鍙戦€佹倲妫嬭姹?..');
      } else {
        showToast('鉂?鏈繛鎺ユ湇鍔″櫒', 'error');
      }
    }

    // 澶勭悊鎮旀琚帴鍙楀悗鐨勬鐩樻洿鏂?
    function handleUndoAccepted(data) {
      // 浣跨敤鏈嶅姟鍣ㄦ彁渚涚殑瀹屾暣妫嬬洏鏁版嵁鎭㈠
      if (data.board) {
        gameState.board = data.board;
      }

      if (currentGame === 'chinese-chess') {
        // 閲嶆柊娓叉煋璞℃妫嬪瓙
        if (data.board) {
          const pieces = convertBackendBoardToFrontend(data.board);
          chessPieces.red = pieces.red;
          chessPieces.black = pieces.black;
        }
        renderChessPieces();
      } else if (currentGame === 'gobang') {
        renderGobangBoard();
      } else if (currentGame === 'go') {
        renderGoBoard();
      }

      gameState.turn = data.currentPlayer || 1;
      gameState.gameOver = false;
      gameState.moveCount = data.moveCount || 0;

      // 鏇存柊钀藉瓙璁板綍锛堣鍓埌鏈嶅姟绔繑鍥炵殑姝ｇ‘闀垮害锛?
      const targetLength = data.moveCount || 0;
      if (targetLength < gameState.moveLog.length) {
        gameState.moveLog.length = targetLength;
      }

      // 鏇存柊褰撳墠鐜╁鏄剧ず
      updateTurnDisplay();

      // 闅愯棌鍐嶆潵涓€灞€鎸夐挳
      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) playAgainBtn.style.display = 'none';

      updateStatus('鉁?鎮旀鎴愬姛锛岃疆鍒颁綘浜?);
    }

    // ========== 鎻愮ず绯荤粺 ==========

    // 璇锋眰鎻愮ず
    function requestHint() {
      let hintCount = 0;
      let itemHintCount = 0;
      if (currentAccount) {
        const accData = currentAccount.account;
        hintCount = accData.inventory?.hintCount || 0;
        itemHintCount = (accData.inventory?.items?.item_hint || 0) * 5;
      }

      const totalHint = hintCount + itemHintCount;

      if (totalHint <= 0) {
        showToast('馃挕 鎻愮ず娆℃暟涓嶈冻锛岃璐拱鎻愮ず鍗?, 'warning');
        return;
      }

      // 濡傛灉鐩存帴娆℃暟涓嶅浣嗚繕鏈夐亾鍏峰崱锛岃嚜鍔ㄤ娇鐢ㄤ竴寮?
      if (hintCount <= 0 && itemHintCount > 0) {
        socket.emit('game_use_item', { itemId: 'item_hint' });
        updateStatus('馃挕 姝ｅ湪浣跨敤鎻愮ず鍗?..');
        return;
      }

      if (gameState.gameOver) {
        showToast('鉂?娓告垙宸茬粨鏉?, 'warning');
        return;
      }

      if (currentGame === 'snake') {
        showToast('鉂?璐悆铔囦笉鏀寔鎻愮ず鍔熻兘', 'warning');
        return;
      }

      if (socket && socket.connected) {
        socket.emit('request_hint');
        updateStatus('馃挕 姝ｅ湪璁＄畻鏈€浣充綅缃?..');
      } else {
        showToast('鉂?鏈繛鎺ユ湇鍔″櫒', 'error');
      }
    }

    // 澶勭悊鎻愮ず缁撴灉
    function handleHintResult(data) {
      if (!data.move) {
        updateStatus('鉂?鏃犳硶璁＄畻鎻愮ず浣嶇疆');
        return;
      }

      const { move, gameType } = data;

      // 鍦ㄦ鐩樹笂楂樹寒鎻愮ず浣嶇疆
      if (gameType === 'gobang') {
        highlightCell(move.r, move.c, '#00ff00');
      } else if (gameType === 'go') {
        highlightCell(move.r, move.c, '#00ff00');
      } else if (gameType === 'chinese-chess') {
        highlightChessMove(move);
      }

      updateStatus(`馃挕 鎻愮ず锛?{formatHintPosition(move, gameType)}`);
      showToast(`馃挕 寤鸿浣嶇疆锛?{formatHintPosition(move, gameType)}`, 'info', 5000);
    }

    // 鏍煎紡鍖栨彁绀轰綅缃樉绀?
    function formatHintPosition(move, gameType) {
      if (gameType === 'chinese-chess') {
        return `浠?${move.fromR},${move.fromC})绉诲姩鍒?${move.toR},${move.toC})`;
      }
      return `(${move.r}, ${move.c})`;
    }

    // 楂樹寒妫嬬洏鍗曞厓鏍?
    function highlightCell(r, c, color) {
      // 浜斿瓙妫?
      const gobangCells = document.querySelectorAll('#gobang-board .cell');
      if (gobangCells.length > 0) {
        gobangCells.forEach(cell => {
          const row = parseInt(cell.dataset.r);
          const col = parseInt(cell.dataset.c);
          if (row === r && col === c) {
            cell.style.boxShadow = `0 0 8px 3px ${color}`;
            cell.style.animation = 'hintPulse 1s ease-in-out infinite';
            setTimeout(() => {
              cell.style.boxShadow = '';
              cell.style.animation = '';
            }, 4000);
          }
        });
        return;
      }

      // 鍥存
      const goCells = document.querySelectorAll('#go-board .cell');
      if (goCells.length > 0) {
        goCells.forEach(cell => {
          const row = parseInt(cell.dataset.r);
          const col = parseInt(cell.dataset.c);
          if (row === r && col === c) {
            cell.style.boxShadow = `0 0 8px 3px ${color}`;
            cell.style.animation = 'hintPulse 1s ease-in-out infinite';
            setTimeout(() => {
              cell.style.boxShadow = '';
              cell.style.animation = '';
            }, 4000);
          }
        });
      }
    }

    // 楂樹寒璞℃绉诲姩
    function highlightChessMove(move) {
      // 楂樹寒鏉ユ簮涓庣洰鏍囦綅缃?
      const cells = document.querySelectorAll('#chess-board .chess-intersection');
      cells.forEach(cell => {
        const row = parseInt(cell.dataset.r);
        const col = parseInt(cell.dataset.c);
        if ((row === move.fromR && col === move.fromC) || (row === move.toR && col === move.toC)) {
          cell.style.boxShadow = `0 0 8px 3px #00ff00`;
          cell.style.animation = 'hintPulse 1s ease-in-out infinite';
          setTimeout(() => {
            cell.style.boxShadow = '';
            cell.style.animation = '';
          }, 4000);
        }
      });
    }

    // 閲嶅仛鍔熻兘
    function handleRedo() {
      updateStatus('鈴?閲嶅仛鍔熻兘');
    }

    function handleResign() {
      if (confirm('纭畾瑕佽杈撳悧锛?)) {
        updateStatus('馃彸锔?宸茶杈?);
        // 瀹為檯璁よ緭閫昏緫
      }
    }

    // 鏄剧ず鎮旀鍜屾彁绀烘寜閽紙浠呭妫嬬被娓告垙锛?
    function showBoardGameActionButtons() {
      const undoBtn = document.getElementById('undo-btn');
      const hintBtn = document.getElementById('hint-btn');
      if (currentGame === 'gobang' || currentGame === 'go' || currentGame === 'chinese-chess') {
        if (undoBtn) undoBtn.style.display = 'inline-block';
        if (hintBtn) hintBtn.style.display = 'inline-block';
      }
    }

    // 闅愯棌鎮旀鍜屾彁绀烘寜閽?
    function hideBoardGameActionButtons() {
      const undoBtn = document.getElementById('undo-btn');
      const hintBtn = document.getElementById('hint-btn');
      if (undoBtn) undoBtn.style.display = 'none';
      if (hintBtn) hintBtn.style.display = 'none';
    }

    function restartCurrentGame() {
      if (currentGame === 'snake') {
        restartSnakeGame();
      } else if (gameState && gameState.difficulty) {
        restartAIGame();
      } else {
        if (confirm('纭畾瑕侀噸鏂板紑濮嬪綋鍓嶆父鎴忓悧锛?)) {
          updateStatus('馃攧 閲嶆柊寮€濮嬫父鎴?);
          // 瀹為檯閲嶆柊寮€濮嬮€昏緫
        }
      }
    }

    function handleNewGame() {
      if (confirm('纭畾瑕佸紑濮嬫柊娓告垙鍚楋紵')) {
        updateStatus('馃啎 鏂版父鎴忓紑濮?);
        // 瀹為檯鏂版父鎴忛€昏緫
      }
    }

    function togglePause() {
      updateStatus('鈴革笍 娓告垙宸叉殏鍋?);
    }

    function handleSnakeDirection(dir) {
      if (currentGame === 'snake') {
        // 瀹為檯璐悆铔囨柟鍚戞帶鍒?
      }
    }

    function toggleSnakePause() {
      if (currentGame === 'snake') {
        // 瀹為檯璐悆铔囨殏鍋滈€昏緫
      }
    }

    document.addEventListener('keydown', handleKeydown);

    // 璞℃妫嬪瓙閰嶇疆锛堟纭殑璞℃妫嬪瓙浣嶇疆锛?
    const chessPieces = {
      red: [
        { name: '甯?, r: 9, c: 4, moves: 'general' },
        { name: '浠?, r: 9, c: 3, moves: 'advisor' },
        { name: '浠?, r: 9, c: 5, moves: 'advisor' },
        { name: '鐩?, r: 9, c: 2, moves: 'elephant' },
        { name: '鐩?, r: 9, c: 6, moves: 'elephant' },
        { name: '椹?, r: 9, c: 1, moves: 'horse' },
        { name: '椹?, r: 9, c: 7, moves: 'horse' },
        { name: '杞?, r: 9, c: 0, moves: 'chariot' },
        { name: '杞?, r: 9, c: 8, moves: 'chariot' },
        { name: '鐐?, r: 7, c: 1, moves: 'cannon' },
        { name: '鐐?, r: 7, c: 7, moves: 'cannon' },
        { name: '鍏?, r: 6, c: 0, moves: 'soldier' },
        { name: '鍏?, r: 6, c: 2, moves: 'soldier' },
        { name: '鍏?, r: 6, c: 4, moves: 'soldier' },
        { name: '鍏?, r: 6, c: 6, moves: 'soldier' },
        { name: '鍏?, r: 6, c: 8, moves: 'soldier' }
      ],
      black: [
        { name: '灏?, r: 0, c: 4, moves: 'general' },
        { name: '澹?, r: 0, c: 3, moves: 'advisor' },
        { name: '澹?, r: 0, c: 5, moves: 'advisor' },
        { name: '璞?, r: 0, c: 2, moves: 'elephant' },
        { name: '璞?, r: 0, c: 6, moves: 'elephant' },
        { name: '椹?, r: 0, c: 1, moves: 'horse' },
        { name: '椹?, r: 0, c: 7, moves: 'horse' },
        { name: '杞?, r: 0, c: 0, moves: 'chariot' },
        { name: '杞?, r: 0, c: 8, moves: 'chariot' },
        { name: '鐐?, r: 2, c: 1, moves: 'cannon' },
        { name: '鐐?, r: 2, c: 7, moves: 'cannon' },
        { name: '鍗?, r: 3, c: 0, moves: 'soldier' },
        { name: '鍗?, r: 3, c: 2, moves: 'soldier' },
        { name: '鍗?, r: 3, c: 4, moves: 'soldier' },
        { name: '鍗?, r: 3, c: 6, moves: 'soldier' },
        { name: '鍗?, r: 3, c: 8, moves: 'soldier' }
      ]
    };

    // 璐悆铔囨父鎴忛厤缃?
    const snakeGameConfig = {
      gridSize: 20,
      cellSize: 20,
      initialSpeed: 150,
      canvasWidth: 400,
      canvasHeight: 400,
      initialFoodCount: 3, // 鍒濆椋熺墿鏁伴噺
      maxFoodCount: 8,    // 鏈€澶ч鐗╂暟閲?
      foodScore: 10,       // 姣忎釜椋熺墿鍒嗘暟
      colors: {
        snakeHead: '#4ecdc4',
        snakeBody: '#45b7d1',
        food: '#ff6b6b',
        foodSpecial: '#ffd93d',
        grid: '#2d2d44',
        background: '#1a1a2e'
      },
      rules: `璐悆铔囪鍒欙細
鈥?浣跨敤鏂瑰悜閿垨WASD鎺у埗铔囩殑绉诲姩鏂瑰悜
鈥?鍚冨埌椋熺墿鍚庤泧韬彉闀匡紝鍒嗘暟澧炲姞
鈥?鎾炲埌澧欏鎴栬嚜宸辩殑韬綋鍒欐父鎴忕粨鏉?
鈥?闅忕潃鍒嗘暟澧炲姞锛岃泧鐨勭Щ鍔ㄩ€熷害浼氶€愭笎鍔犲揩
鈥?鎸夌┖鏍奸敭鍙互鏆傚仠/缁х画娓告垙

馃崕 澶氶鐗╂満鍒讹細
鈥?鍦哄湴涓婂悓鏃跺瓨鍦ㄥ涓鐗╋紙鍒濆3涓級
鈥?闅忕潃鍒嗘暟鎻愰珮锛岄鐗╂暟閲忔渶澶氬彲澧炶嚦8涓?
鈥?椋熺墿棰滆壊浜ゆ浛鏄剧ず锛屼究浜庡尯鍒?

馃帓 閬撳叿璇存槑锛?
鈥?澶嶆椿鍗★紙鉂わ笍锛夛細浣跨敤鍚庝笅娆＄鎾炲彲鍘熷湴澶嶆椿涓€娆★紝淇濈暀褰撳墠鍒嗘暟
鈥?鍔犻€熷崱锛堚殹锛夛細10绉掑唴绉诲姩閫熷害缈诲€嶏紝蹇€熷啿鍒鸿幏鍙栭珮鍒?
鈥?鍙屽€嶅崱锛堚湒锔?锛夛細15绉掑唴鍚冩帀椋熺墿鑾峰緱鍙屽€嶅垎鏁?
鈥?缂╃煭鍗★紙馃斀锛夛細韬綋绔嬪嵆缂╃煭3鑺傦紝闄嶄綆纰版挒椋庨櫓
浣跨敤鏂规硶锛氬湪娓告垙涓弻鍑婚亾鍏锋爮涓殑閬撳叿鍗冲彲浣跨敤锛堝晢搴楄喘涔板悗鑷姩鍚屾锛塦
    };

    // 鍙屼汉妯″紡閰嶇疆
    const snakeDualConfig = {
      gridSize: 30,
      cellSize: 18,
      initialSpeed: 120,
      canvasWidth: 540,
      canvasHeight: 540,
      gameDuration: 120, // 娓告垙鏃堕暱锛堢锛?
      maxFoodCount: 8, // 鏈€澶ч鐗╂暟閲?
      respawnDelay: 1000, // 澶嶆椿寤惰繜锛堟绉掞級
      colors: {
        snake1Head: '#4ecdc4',
        snake1Body: '#45b7d1',
        snake2Head: '#ff6b6b',
        snake2Body: '#ee5a24',
        food: '#ffd93d',
        grid: '#2d2d44',
        background: '#1a1a2e'
      },
      rules: `鍙屼汉妯″紡瑙勫垯锛?
馃幃 鐜╁1锛氫娇鐢ㄦ柟鍚戦敭鎺у埗
馃幃 鐜╁2锛氫娇鐢╓ASD鎺у埗
鈴憋笍 娓告垙鏃堕棿锛?鍒嗛挓
馃攧 鏃犻檺澶嶆椿锛堟浜″悗1绉掑娲伙級
馃崕 鍦板浘涓湁鏇村椋熺墿
馃弳 鏃堕棿缁撴潫鍚庡垎鏁伴珮鑰呰幏鑳滐紒`
    };

    // ========== 闊虫晥绯荤粺 ==========
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const soundEnabled = {
      stonePlace: true,
      capture: true,
      win: true,
      error: true,
      click: true
    };

    function playSound(type) {
      if (!soundEnabled[type]) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      switch (type) {
        case 'stonePlace':
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.15);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.15);
          break;
        case 'capture':
          oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.2);
          gainNode.gain.setValueAtTime(0.35, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
          break;
        case 'win':
          oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15);
          oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.3);
          oscillator.frequency.setValueAtTime(1046.50, audioContext.currentTime + 0.45);
          gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.6);
          break;
        case 'error':
          oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(150, audioContext.currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
          break;
        case 'click':
          oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(500, audioContext.currentTime + 0.05);
          gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.05);
          break;
        case 'move':
          oscillator.frequency.setValueAtTime(700, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(350, audioContext.currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.1);
          break;
      }
    }

    // ========== 鍒濆鍖?==========
    async function init() {
      // 鍔犺浇淇濆瓨鐨勮处鍙蜂俊鎭苟妫€鏌ョ櫥褰曠姸鎬?
      const isLoggedIn = await loadSavedAccount();

      if (!isLoggedIn) {
        // 濡傛灉娌℃湁鐧诲綍锛屾樉绀鸿嚜鍔ㄧ櫥褰曟ā鎬佺獥鍙?
        setTimeout(() => {
          showAutoLoginModal();
        }, 1000);
      }

      // 浠庢湇鍔″櫒鑾峰彇涓婚
      await fetchThemesFromServer();

      // 鍒濆鍖栫紦瀛?
      moveLogEl.dataset.lastIndex = "-1";
      // 鏇存柊瀹㈡埛绔増鏈樉绀?
      if (clientVersionDisplay) {
        clientVersionDisplay.textContent = CLIENT_VERSION;
      }
      // 鍒濆鏇存柊楂樼骇缁熻
      updateAdvancedStats();
      // 鍒濆鍖栧綋鍓嶆绉嶆樉绀?
      updateGameDisplay();
      // 鍒濆鍖栨鐩?
      initBoards();
    }

    // 缁熶竴閿欒鎻愮ず鍑芥暟
    function showToast(message, type = 'info', duration = 3000) {
      // 绉婚櫎鐜版湁鐨勬彁绀?
      const existingToasts = document.querySelectorAll('.error-toast, .success-toast, .warning-toast');
      existingToasts.forEach(toast => toast.remove());

      const toast = document.createElement('div');
      toast.className = type === 'error' ? 'error-toast' :
        type === 'success' ? 'success-toast' : 'warning-toast';
      toast.textContent = message;

      document.body.appendChild(toast);

      setTimeout(() => {
        if (toast.parentNode) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(100%)';
          setTimeout(() => toast.remove(), 300);
        }
      }, duration);
    }

    // 闈為樆濉炵‘璁ゅ璇濇
    let pendingConfirmCallback = null;
    function showConfirmDialog(message, onConfirm) {
      const modal = document.getElementById('custom-confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn = document.getElementById('confirm-no');
      if (!modal || !msgEl) return;

      titleEl.textContent = '纭鎿嶄綔';
      msgEl.textContent = message;
      pendingConfirmCallback = onConfirm;
      modal.style.display = 'block';

      // 缁戝畾鎸夐挳浜嬩欢锛堝厛绉婚櫎鏃х洃鍚紝閬垮厤閲嶅锛?
      const handleYes = () => {
        modal.style.display = 'none';
        pendingConfirmCallback = null;
        if (typeof onConfirm === 'function') onConfirm();
      };
      const handleNo = () => {
        modal.style.display = 'none';
        pendingConfirmCallback = null;
      };
      yesBtn.onclick = handleYes;
      noBtn.onclick = handleNo;
      modal.onclick = (e) => {
        if (e.target === modal) handleNo();
      };
    }

    // 澧炲己鐨勮緭鍏ラ獙璇佸嚱鏁?
    function validateUsername(username) {
      if (!username || username.trim().length === 0) {
        return { valid: false, message: '鐢ㄦ埛鍚嶄笉鑳戒负绌? };
      }

      const trimmed = username.trim();
      if (trimmed.length < 3 || trimmed.length > 20) {
        return { valid: false, message: '鐢ㄦ埛鍚嶉暱搴﹀繀椤诲湪3-20浣嶄箣闂? };
      }

      if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        return { valid: false, message: '鐢ㄦ埛鍚嶅彧鑳藉寘鍚瓧姣嶃€佹暟瀛楀拰涓嬪垝绾? };
      }

      return { valid: true };
    }

    function validatePassword(password) {
      if (!password || password.length === 0) {
        return { valid: false, message: '瀵嗙爜涓嶈兘涓虹┖' };
      }

      if (password.length < 6) {
        return { valid: false, message: '瀵嗙爜闀垮害鑷冲皯6浣? };
      }

      if (password.length > 50) {
        return { valid: false, message: '瀵嗙爜闀垮害涓嶈兘瓒呰繃50浣? };
      }

      return { valid: true };
    }

    function validateNickname(nickname) {
      if (!nickname || nickname.trim().length === 0) {
        return { valid: true }; // 鏄电О鍙€?
      }

      const trimmed = nickname.trim();
      if (trimmed.length > 20) {
        return { valid: false, message: '鏄电О闀垮害涓嶈兘瓒呰繃20浣? };
      }

      // 妫€鏌ユ槸鍚︽湁鏁忔劅瀛楃
      const forbiddenChars = /[<>\"'&]/;
      if (forbiddenChars.test(trimmed)) {
        return { valid: false, message: '鏄电О鍖呭惈涓嶅厑璁哥殑鐗规畩瀛楃' };
      }

      return { valid: true };
    }

    // 澧炲己鐨勮〃鍗曢獙璇佸嚱鏁?
    function validateLoginForm(username, password) {
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return usernameValidation;
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return passwordValidation;
      }

      return { valid: true };
    }

    function validateRegisterForm(username, password, confirmPassword, nickname) {
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return usernameValidation;
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return passwordValidation;
      }

      if (password !== confirmPassword) {
        return { valid: false, message: '涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷? };
      }

      const nicknameValidation = validateNickname(nickname);
      if (!nicknameValidation.valid) {
        return nicknameValidation;
      }

      return { valid: true };
    }

    // 绛夊緟socket杩炴帴
    async function waitForSocketConnection(timeout = 10000) {
      return new Promise((resolve) => {
        if (socket && socket.connected) {
          resolve(true);
          return;
        }

        const checkInterval = setInterval(() => {
          if (socket && socket.connected) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(false);
        }, timeout);
      });
    }

    // 閫氳繃token浠庢湇鍔＄鑾峰彇璐﹀彿淇℃伅
    async function fetchAccountByToken() {
      return new Promise(async (resolve) => {
        const token = localStorage.getItem('userToken');
        if (!token) {
          resolve(null);
          return;
        }

        // 绛夊緟socket杩炴帴
        const isConnected = await waitForSocketConnection();
        if (!isConnected) {
          console.warn('Socket鏈繛鎺ワ紝鏃犳硶鑾峰彇璐﹀彿淇℃伅');
          resolve(null);
          return;
        }

        socket.emit('get_account_by_token', { token });

        // 璁剧疆涓€娆℃€х洃鍚櫒鏉ユ帴鏀跺搷搴?
        const handleAccountInfo = (data) => {
          socket.off('account_info', handleAccountInfo);
          if (data.success && data.data) {
            // 淇濆瓨鏈嶅姟绔繑鍥炵殑鏂皌oken锛堣嚜鍔ㄧ画鏈燂級
            if (data.data.token) {
              localStorage.setItem('userToken', data.data.token);
            }
            resolve(data.data);
          } else {
            resolve(null);
          }
        };

        socket.on('account_info', handleAccountInfo);

        // 璁剧疆瓒呮椂
        setTimeout(() => {
          socket.off('account_info', handleAccountInfo);
          resolve(null);
        }, 5000);
      });
    }

    // 鍔犺浇淇濆瓨鐨勮处鍙蜂俊鎭?
    async function loadSavedAccount() {
      try {
        const accountData = await fetchAccountByToken();
        if (accountData) {
          // 璁剧疆姝ｇ‘鐨勬暟鎹粨鏋勶紝淇濇寔涓庢父鎴忕粨鏉熷悗鏇存柊鐨勬暟鎹粨鏋勪竴鑷?
          currentAccount = {
            ...accountData,
            account: accountData.account,
            stats: accountData.account.stats || {}
          };
          // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
          const userAccountData = currentAccount.account.account || currentAccount.account;
          lastExp = userAccountData?.profile?.exp || 0;
          lastLevel = userAccountData?.profile?.level || 1;
          updateAccountBar();
          console.log('宸叉仮澶嶇櫥褰曠姸鎬?, currentAccount);
          console.log('currentAccount.stats:', currentAccount.stats);
          console.log('currentAccount.account.stats:', currentAccount.account?.stats);
          return true;
        }
      } catch (e) {
        console.error('鍔犺浇璐﹀彿淇℃伅澶辫触', e);
      }
      return false;
    }

    // 淇濆瓨token
    function saveToken(token) {
      try {
        localStorage.setItem('userToken', token);
        console.log('Token宸蹭繚瀛?);
      } catch (e) {
        console.error('淇濆瓨token澶辫触', e);
      }
    }

    // 娓呴櫎璐﹀彿淇℃伅
    function clearAccount() {
      try {
        localStorage.removeItem('userToken');
        localStorage.removeItem('loginStatus');
        localStorage.removeItem('currentAccountId');
        console.log('璐﹀彿淇℃伅宸叉竻闄?);
      } catch (e) {
        console.error('娓呴櫎璐﹀彿淇℃伅澶辫触', e);
      }
    }

    // 璁剧疆Socket.io浜嬩欢鐩戝惉锛堝湪socket鍒濆鍖栧悗绔嬪嵆璋冪敤锛?
    function setupSocketListeners() {
      let isInitialized = false;

      socket.on('connect', async () => {
        console.log('Socket.io杩炴帴鎴愬姛');
        connectStatusEl.textContent = '宸茶繛鎺?;
        connectStatusEl.className = 'info-value value-connected';

        // 闅愯棌鏂紑杩炴帴鎻愮ず妗?
        hideDisconnectWarning();

        // 鍙湪绗竴娆¤繛鎺ユ椂鍒濆鍖?
        if (!isInitialized) {
          isInitialized = true;
          await init();
        }

        // 鍙戦€佸鎴风杩炴帴璇锋眰锛堝寘鍚増鏈彿鍜宼oken锛?
        // 娉ㄦ剰锛歩nit()鍑芥暟浼氭仮澶峜urrentAccount锛屾墍浠ヨ繖閲屽彲浠ヨ幏鍙栧埌姝ｇ‘鐨則oken
        socket.emit('client_connect', {
          clientVersion: CLIENT_VERSION,
          token: localStorage.getItem('userToken') || 'none'
        });

        // 濡傛灉宸茬粡鏈夎处鍙蜂俊鎭紝鍙戦€佺敤鎴风櫥褰曚簨浠?
        // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
        const accountData = currentAccount.account.account || currentAccount.account;
        if (currentAccount && accountData?.nickname) {
          socket.emit('user_login', { nickname: accountData.nickname });
        }

        // 鑾峰彇鎺掕姒?
        socket.emit('get_leaderboard', { limit: 10 });

        // 妫€鏌ユ槸鍚︽湁寰呮挱鏀剧殑鍥炴斁
        checkReplayOnLoad();
      });

      socket.on('disconnect', () => {
        console.log('Socket.io鏂紑杩炴帴');
        connectStatusEl.textContent = '宸叉柇寮€';
        connectStatusEl.className = 'info-value value-danger';

        // 鏄剧ず鏂紑杩炴帴鎻愮ず妗?
        showDisconnectWarning();
      });

      socket.on('reconnect', () => {
        console.log('Socket.io閲嶆柊杩炴帴鎴愬姛');
        connectStatusEl.textContent = '宸茶繛鎺?;
        connectStatusEl.className = 'info-value value-connected';
        hideDisconnectWarning();
        updateStatus('閲嶆柊杩炴帴鎴愬姛');
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('姝ｅ湪灏濊瘯閲嶆柊杩炴帴...', attemptNumber);
        updateStatus(`姝ｅ湪閲嶆柊杩炴帴... (${attemptNumber}/5)`);
      });

      socket.on('reconnect_failed', () => {
        console.log('閲嶆柊杩炴帴澶辫触');
        updateStatus('閲嶆柊杩炴帴澶辫触锛岃鐐瑰嚮閲嶈繛鎸夐挳');
      });

      // 澶勭悊鐗堟湰妫€鏌ョ粨鏋?
      socket.on('version_check', (data) => {
        console.log('鐗堟湰妫€鏌ョ粨鏋?', data);
        if (!data.compatible) {
          alert('鐗堟湰涓嶅吋瀹癸細' + data.reason + '\n璇锋洿鏂版偍鐨勫鎴风鎴栨湇鍔＄');
        } else if (data.warning) {
          console.warn('鐗堟湰璀﹀憡锛?, data.warning);
        }

        // 鏄剧ず鏈嶅姟鍣ㄧ増鏈彿
        const serverVersionDisplay = document.getElementById('server-version-display');
        if (serverVersionDisplay && data.serverVersion) {
          serverVersionDisplay.textContent = `(鏈嶅姟鍣? ${data.serverVersion})`;
        }
      });

      socket.on('user_connected', (data) => {
        accountId = data.accountId;
        console.log('鑾峰緱鐢ㄦ埛ID:', accountId);
        // 淇濆瓨鐢ㄦ埛ID鍒發ocalStorage
        saveUserId(accountId);
        initUserStatus();
      });

      socket.on('online_users', (users) => {
        onlineUsers.clear();
        users.forEach(user => {
          onlineUsers.set(user.accountId, {
            status: user.status,
            game: user.gameType,
            nickname: user.nickname,
            lastUpdate: Date.now(),
            level: user.level,
            accountType: user.accountType
          });
        });
        updateUserList();
        updateGameChannelButton();
      });

      socket.on('user_status', (data) => {
        if (data.accountId !== accountId) {
          onlineUsers.set(data.accountId, {
            status: data.status,
            game: data.gameType,
            nickname: data.nickname,
            lastUpdate: Date.now()
          });
          updateUserList();
          updateGameChannelButton();
        }
      });

      socket.on('match_success', (data) => {
        console.log('鍖归厤鎴愬姛:', data);
        matchedOpponentId = data.opponentId;
        gameId = data.gameId;
        startGameWithOpponent(data.opponentId, data.color);
      });

      socket.on('move', (data) => {
        console.log('鏀跺埌绉诲姩:', data);
        console.log('褰撳墠accountId:', accountId);
        console.log('娑堟伅from:', data.from);
        console.log('鏄惁鏄嚜宸辩殑娑堟伅:', data.from === accountId);
        if (gameState.gameOver) return;

        // 妫€鏌ユ槸鍚︽槸鑷繁鐨勮惤瀛愶紝濡傛灉鏄垯璺宠繃
        if (data.from === accountId) {
          console.log('鏀跺埌鑷繁鐨勮惤瀛愭秷鎭紝璺宠繃');
          return;
        }

        if (data.game === 'chinese-chess') {
          handleChessMove(data);
        } else {
          handleBoardMove(data);
        }
      });

      socket.on('reset', (data) => {
        resetGame(false);
      });

      // 閲嶇疆璇锋眰琚帴鍙?
      socket.on('reset_accepted', (data) => {
        console.log('閲嶇疆璇锋眰琚帴鍙?', data);
        resetGame(false);
        showBroadcast(data.message || '瀵规柟宸插悓鎰忛噸缃父鎴?, '绯荤粺', Date.now());
      });

      // 閲嶇疆璇锋眰琚嫆缁?
      socket.on('reset_rejected', (data) => {
        console.log('閲嶇疆璇锋眰琚嫆缁?', data);
        showBroadcast(data.message || '瀵规柟鎷掔粷浜嗛噸缃姹?, '绯荤粺', Date.now());
      });

      // 閲嶇疆璇锋眰瓒呮椂
      socket.on('reset_request_timeout', (data) => {
        console.log('閲嶇疆璇锋眰瓒呮椂:', data);
        showBroadcast(data.message || '閲嶇疆璇锋眰瓒呮椂锛屽鏂规湭鍥炲簲', '绯荤粺', Date.now());
      });

      socket.on('reset_request', (data) => {
        let confirmMessage = '';
        if (data.message && data.message.includes('鍐嶆潵涓€灞€')) {
          confirmMessage = data.message + '锛屾槸鍚﹀悓鎰忥紵';
        } else {
          confirmMessage = `${data.from} 璇锋眰閲嶇疆妫嬬洏锛屾槸鍚﹀悓鎰忥紵`;
        }

        // 淇濆瓨褰撳墠璇锋眰鏁版嵁
        currentResetRequest = data;

        // 鏄剧ず鑷畾涔夋ā鎬佹
        const confirmModal = document.getElementById('custom-confirm-modal');
        const confirmMessageEl = document.getElementById('confirm-message');
        const confirmTitle = document.getElementById('confirm-title');

        if (data.message && data.message.includes('鍐嶆潵涓€灞€')) {
          confirmTitle.textContent = '鍐嶆潵涓€灞€璇锋眰';
        } else {
          confirmTitle.textContent = '閲嶇疆妫嬬洏璇锋眰';
        }

        confirmMessageEl.textContent = confirmMessage;
        confirmModal.style.display = 'block';
      });

      socket.on('return_lobby', (data) => {
        if (matchedOpponentId === data.userId) {
          showToast('瀵规墜宸茶繑鍥炲ぇ鍘?, 'warning');
          returnToLobby();
        }
        onlineUsers.set(data.userId, {
          status: 'online',
          game: currentGame,
          lastUpdate: Date.now()
        });
        updateUserList();
        updateGameChannelButton();
      });

      socket.on('opponent_left', (data) => {
        console.log('瀵规墜绂诲紑娓告垙:', data);

        let message = '';
        if (data.reason === '娓告垙鍒氬紑濮嬶紝鍒ゅ畾涓烘棤鏁堟父鎴?) {
          message = `瀵规柟(${data.nickname})鍦ㄦ父鎴忓垰寮€濮嬫椂绂诲紑锛屾湰灞€鍒ゅ畾涓烘棤鏁堟父鎴廯;
        } else if (data.reason === '娓告垙杩涜涓紝鍒ゅ畾涓哄钩灞€') {
          message = `瀵规柟(${data.nickname})鍦ㄦ父鎴忚繘琛屼腑绂诲紑锛屾湰灞€鍒ゅ畾涓哄钩灞€`;
        } else if (data.result === 'resign') {
          message = `瀵规柟(${data.nickname})宸茶杈擄紝浣犺幏鑳滀簡锛侌煄塦;
        } else {
          message = `瀵规柟(${data.nickname})宸茬寮€娓告垙锛?{data.reason}`;
        }

        // 鏄剧ず鏇村弸濂界殑鎻愮ず
        showWinAlert(message);
        updateStatus(`馃弳 ${message}`);

        // 寤惰繜杩斿洖澶у巺锛岃鐢ㄦ埛鐪嬪埌鎻愮ず
        setTimeout(() => {
          returnToLobby();
        }, 3000);
      });

      socket.on('game_ended', (data) => {
        console.log('娓告垙缁撴潫:', data);
        gameState.gameOver = true;

        let winMsg = '';
        if (data.result === 'win') {
          if (data.winner === accountId) {
            winMsg = '馃帀 浣犺幏鑳滀簡锛?;
          } else {
            winMsg = '馃槩 浣犺緭浜嗭紒';
          }
        } else if (data.result === 'draw') {
          winMsg = '馃 骞冲眬锛?;
        } else if (data.result === 'resign') {
          if (data.winner === accountId) {
            winMsg = '馃帀 瀵规柟璁よ緭锛屼綘鑾疯儨浜嗭紒';
          } else {
            winMsg = '馃槩 浣犺杈撲簡锛?;
          }
        } else if (data.result === 'timeout') {
          winMsg = '鈴?娓告垙瓒呮椂锛?;
        } else if (data.result === 'admin') {
          winMsg = '馃洃 ' + (data.reason || '娓告垙宸茬粨鏉?);
        } else {
          winMsg = '馃洃 娓告垙宸茬粨鏉?;
        }

        winnerEl.textContent = data.winner === accountId ? '浣? : '瀵规墜';
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg}`);
        updateAdvancedStats();

        const playAgainBtn = document.getElementById('play-again-btn');
        if (playAgainBtn) {
          playAgainBtn.style.display = 'inline-block';
        }

        setTimeout(() => {
          socket.emit('get_leaderboard', { limit: 10 });
        }, 500);
      });

      // 鎴愬氨瑙ｉ攣浜嬩欢
      socket.on('achievements_unlocked', (data) => {
        if (data.achievements && data.achievements.length > 0) {
          showAchievementUnlockModal(data.achievements);
        }
      });

      // 鏄剧ず鎴愬氨瑙ｉ攣妯℃€佹
      function showAchievementUnlockModal(achievements) {
        const modal = document.createElement('div');
        modal.className = 'achievement-unlock-modal';

        let achievementsHtml = '';
        achievements.forEach((achievement, index) => {
          achievementsHtml += `
            <div style="margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%); border-radius: 12px; border: 2px solid #48bb78;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <div style="font-size: 32px; margin-right: 15px;">馃弳</div>
                <div>
                  <div style="font-size: 20px; font-weight: bold; color: #2d3748;">${achievement.name}</div>
                  <div style="font-size: 14px; color: #4a5568; margin-top: 2px;">${achievement.description}</div>
                </div>
              </div>
              ${achievement.reward ? `<div style="font-size: 16px; font-weight: bold; color: #ed8936; margin-top: 5px;">+${achievement.reward.exp} EXP</div>` : ''}
            </div>
          `;
        });

        modal.innerHTML = `
          <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
            <div style="background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3); max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 48px; margin-bottom: 10px;">馃帀</div>
                <div style="font-size: 24px; font-weight: bold; color: #38a169;">瑙ｉ攣鎴愬氨</div>
                <div style="font-size: 14px; color: #718096; margin-top: 5px;">鎭枩浣犺В閿佷簡 ${achievements.length} 涓垚灏憋紒</div>
              </div>
              <div style="margin-bottom: 20px;">
                ${achievementsHtml}
              </div>
              <div style="text-align: center;">
                <button onclick="this.closest('.achievement-unlock-modal').remove();" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s ease;">
                  纭畾
                </button>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(modal);
      }

      // 鎴愬氨鍒楄〃浜嬩欢
      socket.on('achievements_list', (data) => {
        if (!data.categories) return;

        const achievementsList = document.getElementById('achievements-list');
        const unlockedIds = Array.isArray(data.userAchievements) ? data.userAchievements : [];
        const totalAchievements = data.totalAchievements || 0;
        const unlockedCount = unlockedIds.length;
        const progressPercent = totalAchievements > 0 ? Math.round((unlockedCount / totalAchievements) * 100) : 0;

        let html = `
          <div style="margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; color: white;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 18px; font-weight: bold;">鎴愬氨杩涘害</span>
              <span style="font-size: 24px; font-weight: bold;">${unlockedCount}/${totalAchievements}</span>
            </div>
            <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.3); border-radius: 4px; overflow: hidden;">
              <div style="width: ${progressPercent}%; height: 100%; background: #4ade80; border-radius: 4px; transition: width 0.5s ease;"></div>
            </div>
            <div style="text-align: center; margin-top: 8px; font-size: 14px; opacity: 0.9;">宸插畬鎴?${progressPercent}%</div>
          </div>
        `;

        // 娓叉煋姣忎釜鍒嗙被
        Object.entries(data.categories).forEach(([type, category]) => {
          if (!category.achievements || category.achievements.length === 0) return;

          const categoryUnlocked = category.achievements.filter(a => unlockedIds.includes(a.id)).length;

          html += `
            <div style="margin-bottom: 25px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">
                <span style="font-size: 16px; font-weight: bold; color: #2d3748;">${category.name}</span>
                <span style="font-size: 13px; color: #718096; background: #f7fafc; padding: 4px 10px; border-radius: 12px;">${categoryUnlocked}/${category.achievements.length}</span>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
          `;

          category.achievements.forEach(achievement => {
            const isUnlocked = unlockedIds.includes(achievement.id);
            const cardBg = isUnlocked ? 'linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%)' : '#f7fafc';
            const borderColor = isUnlocked ? '#48bb78' : '#e2e8f0';
            const statusText = isUnlocked ? '鉁?宸茶В閿? : '鈼?鏈В閿?;
            const statusColor = isUnlocked ? '#38a169' : '#a0aec0';
            const icon = isUnlocked ? '馃弳' : '馃敀';
            const opacity = isUnlocked ? '1' : '0.7';

            html += `
              <div style="padding: 15px; background: ${cardBg}; border-radius: 10px; border: 2px solid ${borderColor}; opacity: ${opacity}; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display: flex; align-items: center; margin-bottom: 8px;">
                  <span style="font-size: 24px; margin-right: 10px;">${icon}</span>
                  <span style="font-weight: bold; color: #2d3748; font-size: 15px;">${achievement.name}</span>
                </div>
                <div style="font-size: 13px; color: #4a5568; margin-bottom: 10px; line-height: 1.4;">${achievement.description}</div>
                ${achievement.progress ? `
                  <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                      <span>杩涘害</span>
                      <span>${achievement.progress.current}/${achievement.progress.target}</span>
                    </div>
                    <div style="height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                      <div style="width: ${achievement.progress.percent}%; height: 100%; background: ${isUnlocked ? '#48bb78' : '#ed8936'}; transition: width 0.5s ease;"></div>
                    </div>
                  </div>
                ` : ''}
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: ${statusColor}; font-weight: 600; padding: 3px 8px; background: ${isUnlocked ? '#c6f6d5' : '#e2e8f0'}; border-radius: 10px;">${statusText}</span>
                  ${achievement.reward ? `<span style="font-size: 11px; color: #ed8936;">+${achievement.reward.exp} EXP</span>` : ''}
                </div>
              </div>
            `;
          });

          html += '</div></div>';
        });

        achievementsList.innerHTML = html;
      });

      // ========== AI瀵规垬浜嬩欢澶勭悊 ==========

      // AI娓告垙寮€濮?
      socket.on('ai_game_start', (data) => {
        console.log('AI娓告垙寮€濮?', data);
        // 濡傛灉鏄薄妫嬫父鎴忥紝鍚屾鍚庣妫嬬洏
        if (data.gameType === 'chinese-chess' && data.board) {
          const pieces = convertBackendBoardToFrontend(data.board);
          chessPieces.red = pieces.red;
          chessPieces.black = pieces.black;
          // 鍚屾 gameState.board
          gameState.board = data.board;
          renderChessPieces();
        }
      });

      // AI绉诲姩缁撴灉
      socket.on('ai_move_result', (data) => {
        console.log('鏀跺埌AI绉诲姩缁撴灉:', data);
        handleAIMoveResult(data);
      });

      // AI娓告垙缁撴潫
      socket.on('ai_game_end', (data) => {
        console.log('AI娓告垙缁撴潫:', data);
        gameState.gameOver = true;

        let winMsg = '';
        if (data.result === 'win') {
          winMsg = '馃帀 浣犳垬鑳滀簡AI锛?;
        } else if (data.result === 'loss') {
          winMsg = '馃槩 浣犺緭缁欎簡AI锛?;
        } else {
          winMsg = '馃 娓告垙缁撴潫';
        }

        winnerEl.textContent = data.result === 'win' ? '浣? : 'AI';
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg}`);
        updateAdvancedStats();

        const playAgainBtn = document.getElementById('play-again-btn');
        if (playAgainBtn) {
          playAgainBtn.style.display = 'inline-block';
        }

        // 鍙戦€丄I娓告垙缁撴灉鍒版湇鍔″櫒
        sendAIGameResult(data.result);
      });

      socket.on('chat_message', (data) => {
        console.log('鏀跺埌鑱婂ぉ娑堟伅:', data);
        const isOther = data.userId !== accountId;
        const scope = data.scope || 'global';

        // 淇濆瓨鍒板搴旈閬撶殑鍘嗗彶璁板綍
        const messageData = {
          userId: data.userId,
          nickname: data.nickname || '鐜╁',
          message: data.message,
          scope: scope,
          timestamp: Date.now()
        };

        if (scope === 'global') {
          globalChatHistory.push(messageData);
          if (globalChatHistory.length > 100) {
            globalChatHistory.shift();
          }
        } else {
          gameChatHistory.push(messageData);
          if (gameChatHistory.length > 100) {
            gameChatHistory.shift();
          }
        }

        // 濡傛灉鏄綋鍓嶉閬擄紝鍒欐樉绀?
        if (scope === currentChatChannel) {
          addChatMessage(data.nickname || '鐜╁', data.message, isOther, scope);
        }
      });

      socket.on('chat_error', (data) => {
        console.error('鑱婂ぉ閿欒:', data);
        updateStatus('鈿狅笍 ' + data.message);
        // 濡傛灉鏄绂佽█锛屾樉绀哄箍鎾€氱煡
        if (data.message && data.message.includes('绂佽█')) {
          showBroadcast(data.message, '绯荤粺', Date.now());
        }
      });

      socket.on('error', (data) => {
        console.error('鏈嶅姟鍣ㄩ敊璇?', data);
        alert('閿欒: ' + data.message);
      });

      // 绯荤粺骞挎挱
      socket.on('system_broadcast', (data) => {
        console.log('鏀跺埌绯荤粺骞挎挱:', data);
        showBroadcast(data.message, data.from, data.timestamp);
      });

      // 缁存姢妯″紡閫氱煡
      socket.on('maintenance_notice', (data) => {
        console.log('缁存姢妯″紡閫氱煡:', data);
        if (data.enabled) {
          showBroadcast(data.message, '绯荤粺缁存姢', data.timestamp);
        }
      });

      // 绠＄悊鍛樻秷鎭?
      socket.on('admin_message', (data) => {
        console.log('鏀跺埌绠＄悊鍛樻秷鎭?', data);
        showBroadcast(data.message, data.from || '绠＄悊鍛?, data.timestamp);
      });

      // 娓告垙琚噸缃?
      socket.on('game_reset', (data) => {
        console.log('娓告垙琚噸缃?', data);
        gameState.gameOver = true;
        showBroadcast(data.message || '娓告垙宸茶绠＄悊鍛橀噸缃?, '绯荤粺', Date.now());
        returnToLobby();
      });

      // 娓告垙娑堟伅
      socket.on('game_message', (data) => {
        console.log('鏀跺埌娓告垙娑堟伅:', data);
        if (data.type === 'opponent_left') {
          showBroadcast(data.message, '绯荤粺', data.timestamp);
        }
      });

      // ========== 鎸戞垬鐩稿叧浜嬩欢 ==========

      socket.on('challenge_received', (data) => {
        console.log('鏀跺埌鎸戞垬璇锋眰:', data);
        currentChallenge = data;
        showChallengeModal(data.fromNickname, data.game);
      });

      socket.on('challenge_sent', (data) => {
        console.log('鎸戞垬璇锋眰宸插彂閫?', data);
        if (data.success) {
          updateStatus(data.message);
        } else {
          updateStatus('鉂?' + data.message);
        }
      });

      socket.on('challenge_accepted', (data) => {
        console.log('鎸戞垬琚帴鍙?', data);
        hideChallengeModal();
        updateStatus(`鉁?鐜╁ ${data.fromNickname || data.toNickname} 鎺ュ彈浜嗕綘鐨勬寫鎴橈紒娓告垙寮€濮嬶紒`);
        // 娓告垙寮€濮嬮€昏緫鐢?match_success 澶勭悊
      });

      socket.on('challenge_rejected', (data) => {
        console.log('鎸戞垬琚嫆缁?', data);
        hideChallengeModal();
        updateStatus(`鉂?鐜╁ ${data.fromNickname || data.toNickname} 鎷掔粷浜嗕綘鐨勬寫鎴樸€俙);
      });

      // ========== 璐﹀彿绯荤粺浜嬩欢 ==========

      // 澶勭悊鐧诲綍缁撴灉
      socket.on('login_result', (data) => {
        console.log('鐧诲綍缁撴灉:', data);
        const { success, message, data: resultData } = data;

        // 鎭㈠鎸夐挳鐘舵€?
        const loginBtn = document.querySelector('#account-modal .btn-primary');
        if (loginBtn && loginBtn.textContent === '鐧诲綍涓?..') {
          loginBtn.textContent = '鐧诲綍';
          loginBtn.disabled = false;
        }

        if (success && resultData) {
          // 鐧诲綍鎴愬姛
          // 璁剧疆姝ｇ‘鐨勬暟鎹粨鏋勶紝淇濇寔涓庨〉闈㈠埛鏂板悗涓€鑷?
          currentAccount = {
            ...resultData,
            account: resultData.account,
            stats: resultData.account.stats || {}
          };

          // 淇濆瓨token鍜岃处鍙稩D鍒版湰鍦板瓨鍌?
          localStorage.setItem('userToken', resultData.token);

          // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
          let accountId, nickname, username;
          if (resultData.account.account) {
            // 璐﹀彿鐧诲綍鐨勬暟鎹粨鏋?
            accountId = resultData.account.account.id;
            nickname = resultData.account.account.nickname;
            username = resultData.account.account.username;
          } else {
            // 娓稿鐧诲綍鐨勬暟鎹粨鏋?
            accountId = resultData.account.id;
            nickname = resultData.account.nickname;
            username = resultData.account.username;
          }

          localStorage.setItem('currentAccountId', accountId);
          localStorage.setItem('nickname', nickname || username || '鐜╁');

          // 鏇存柊鐣岄潰
          updateAccountBar();
          closeAutoLoginModal();
          closeAccountModal();

          // 鍙戦€佺敤鎴风櫥褰曚簨浠?
          if (nickname) {
            socket.emit('user_login', { nickname: nickname });
          }

          showToast('鐧诲綍鎴愬姛锛佹杩?' + (nickname || username), 'success');

          // 鏍规嵁鏉冮檺鍔犺浇鍔熻兘妯″潡
          loadPermissions(resultData.permissions);
        } else {
          // 鐧诲綍澶辫触
          showToast(message || '鐧诲綍澶辫触锛岃妫€鏌ョ敤鎴峰悕鍜屽瘑鐮?, 'error');
        }
      });

      socket.on('account_action_result', (data) => {
        console.log('璐﹀彿鎿嶄綔缁撴灉:', data);

        // 鎭㈠鎸夐挳鐘舵€?
        const loginBtn = document.querySelector('#account-modal .btn-primary');
        const registerBtn = document.querySelector('#account-modal .btn-success');
        if (loginBtn && loginBtn.textContent === '鐧诲綍涓?..') {
          loginBtn.textContent = '鐧诲綍';
          loginBtn.disabled = false;
        }
        if (registerBtn && registerBtn.textContent === '娉ㄥ唽涓?..') {
          registerBtn.textContent = '娉ㄥ唽';
          registerBtn.disabled = false;
        }

        if (data.action === 'register') {
          if (data.success) {
            // 娉ㄥ唽鎴愬姛鍚庤嚜鍔ㄧ櫥褰?
            if (pendingRegisterInfo) {
              socket.emit('account_login', {
                username: pendingRegisterInfo.username,
                password: pendingRegisterInfo.password
              });
              pendingRegisterInfo = null; // 娓呴櫎淇濆瓨鐨勪俊鎭?
            } else {
              showToast('娉ㄥ唽鎴愬姛锛岃鎵嬪姩鐧诲綍', 'success');
            }
          } else {
            showToast('娉ㄥ唽澶辫触锛? + data.message, 'error');
            pendingRegisterInfo = null; // 娓呴櫎淇濆瓨鐨勪俊鎭?
          }
        } else if (data.action === 'update_profile') {
          if (data.success) {
            if (data.account) {
              // 璁剧疆姝ｇ‘鐨勬暟鎹粨鏋勶紝淇濇寔涓庣櫥褰曟椂涓€鑷?
              currentAccount = {
                ...currentAccount,
                account: data.account,
                stats: data.account.stats || currentAccount.stats || {}
              };
              updateAccountBar();
            }
            closeAccountModal();
            showToast('璧勬枡鏇存柊鎴愬姛锛?, 'success');
          } else {
            showToast('璧勬枡鏇存柊澶辫触锛? + data.message, 'error');
          }
        } else if (data.action === 'change_password') {
          if (data.success) {
            closeAccountModal();
            showToast('瀵嗙爜淇敼鎴愬姛锛?, 'success');
          } else {
            showToast('瀵嗙爜淇敼澶辫触锛? + data.message, 'error');
          }
        } else if (data.action === 'reset_password') {
          // 鎭㈠閲嶇疆鎸夐挳鐘舵€?
          const resetBtn = document.querySelector('#account-modal .btn-primary');
          if (resetBtn && resetBtn.textContent === '閲嶇疆涓?..') {
            resetBtn.textContent = '閲嶇疆瀵嗙爜';
            resetBtn.disabled = false;
          }
          if (data.success) {
            closeAccountModal();
            showLoginModal();
            showToast('瀵嗙爜閲嶇疆鎴愬姛锛岃浣跨敤鏂板瘑鐮佺櫥褰?, 'success');
          } else {
            showToast('瀵嗙爜閲嶇疆澶辫触锛? + data.message, 'error');
          }
        }
      });

      socket.on('game_warning', (data) => {
        console.warn('娓告垙璀﹀憡:', data);
        updateStatus('鈿狅笍 ' + data.message);
      });

      // 澶勭悊涓嶆椿璺冭鍛?
      socket.on('inactive_warning', (data) => {
        console.warn('涓嶆椿璺冭鍛?', data);

        if (data.level === 'warning') {
          showToast(data.message, 'warning', 10000); // 10绉掓樉绀烘椂闂?
        } else if (data.level === 'critical') {
          showToast(data.message, 'error', 15000); // 15绉掓樉绀烘椂闂?

          // 濡傛灉鏄弗閲嶈鍛婏紝鍙互娣诲姞棰濆鐨勮瑙夋彁绀?
          const statusEl = document.getElementById('lobby-status');
          if (statusEl) {
            statusEl.style.animation = 'criticalFlash 1s infinite';
            setTimeout(() => {
              statusEl.style.animation = '';
            }, 15000);
          }
        }
      });

      socket.on('leaderboard', (data) => {
        console.log('鏀跺埌鎺掕姒滄暟鎹?', data);
        updateLeaderboard(data.leaderboard, currentLeaderboardGameType);
      });

      socket.on('game_history', (data) => {
        console.log('鏀跺埌娓告垙鍘嗗彶璁板綍:', data);
        updateGameHistory(data.history);
      });

      // 璐悆铔囧尮閰嶇浉鍏充簨浠?
      socket.on('snake_match_found', (data) => {
        console.log('璐悆铔囧尮閰嶆垚鍔?', data);

        // 鍏堟仮澶嶆父鎴忕晫闈紝鍐嶅惎鍔ㄦ父鎴?
        showSnakeGameInterface();

        // 寤惰繜鍚姩娓告垙锛岀‘淇滵OM鍏冪礌宸插垱寤?
        setTimeout(() => {
          startMatchedSnakeGame(data);

          // 璇锋眰鍏ㄩ噺鐘舵€佸悓姝?
          if (socket && socket.connected) {
            socket.emit('snake_request_full_state', {
              matchId: data.matchId
            });
          }

          // 瀹氭湡璇锋眰鐘舵€佸悓姝ワ紝纭繚鐘舵€佷竴鑷?
          if (snakeGameState.syncInterval) {
            clearInterval(snakeGameState.syncInterval);
          }
          snakeGameState.syncInterval = setInterval(() => {
            if (socket && socket.connected && snakeGameState.isDualMode && snakeGameState.matchId) {
              socket.emit('snake_request_full_state', {
                matchId: snakeGameState.matchId
              });
            }
          }, 2000);
        }, 100);
      });

      socket.on('match_timeout', (data) => {
        console.log('鍖归厤瓒呮椂:', data);
        showToast(data.message || '鍖归厤瓒呮椂锛岃绋嶅悗閲嶈瘯', 'warning');
        showSnakeGameInterface();
        updateStatus('鍖归厤宸茶秴鏃?);
      });

      socket.on('snake_opponent_update', (data) => {
        handleOpponentUpdate(data);
      });

      socket.on('snake_game_over', (data) => {
        console.log('璐悆铔囨父鎴忕粨鏉?', data);
        endDualSnakeGame();
      });

      socket.on('snake_match_cancelled', () => {
        console.log('璐悆铔囧尮閰嶅凡鍙栨秷');
        showSnakeGameInterface();
        updateStatus('鍖归厤宸插彇娑?);
      });

      socket.on('snake_food_sync', (data) => {
        console.log('鍚屾椋熺墿鐘舵€?', data);
        if (snakeGameState.isDualMode && data.foods) {
          snakeGameState.foods = data.foods;
        }
      });

      socket.on('snake_full_state_sync', (data) => {
        console.log('鍏ㄩ噺鍚屾娓告垙鐘舵€?', data);
        if (snakeGameState.isDualMode) {
          snakeGameState.snake = data.isPlayer1 ? data.player1Snake : data.player2Snake;
          snakeGameState.score = data.isPlayer1 ? data.player1Score : data.player2Score;
          snakeGameState.snake2 = data.isPlayer1 ? data.player2Snake : data.player1Snake;
          snakeGameState.score2 = data.isPlayer1 ? data.player2Score : data.player1Score;
          snakeGameState.foods = data.foods || snakeGameState.foods;
          snakeGameState.gameTimeLeft = data.gameTimeLeft !== undefined ? data.gameTimeLeft : snakeGameState.gameTimeLeft;

          // 鏇存柊UI
          updateDualSnakeScore();
          updateDualGameTime();
        }
      });

      socket.on('account_updated', (data) => {
        if (data.account) {
          // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
          const accountData = data.account.account || data.account;
          const newExp = accountData?.profile?.exp || 0;
          const newLevel = accountData?.profile?.level || 1;

          if (newExp > lastExp) {
            const expGained = newExp - lastExp;
            showExpAnimation(expGained);
          }

          if (newLevel > lastLevel) {
            showLevelUpAnimation(lastLevel, newLevel);
          }

          lastExp = newExp;
          lastLevel = newLevel;

          // 姝ｇ‘鏇存柊 currentAccount锛屼繚鎸佷笌鐧诲綍鏃剁浉鍚岀殑鏁版嵁缁撴瀯
          currentAccount = {
            ...data,
            account: data.account,
            stats: data.account.stats || {}
          };
          updateAccountBar();

          // 鍚屾鏈嶅姟绔殑璐悆铔囨渶楂樺垎鍒板鎴风鏄剧ず
          const serverSnakeHighScore = currentAccount.account?.games?.snake?.highScore ||
            currentAccount.stats?.snakeGames?.highScore || 0;
          if (serverSnakeHighScore > 0) {
            // 鏇存柊 localStorage 鍙栦袱鑰呬腑鐨勬渶澶у€?
            const localHighScore = parseInt(localStorage.getItem('snakeHighScore') || '0');
            if (serverSnakeHighScore > localHighScore) {
              localStorage.setItem('snakeHighScore', String(serverSnakeHighScore));
            }
            // 濡傛灉璐悆铔囩晫闈㈠綋鍓嶅彲瑙侊紝鏇存柊鏄剧ず
            const highScoreEl = document.getElementById('snake-highscore');
            if (highScoreEl) {
              const displayScore = Math.max(serverSnakeHighScore, parseInt(localStorage.getItem('snakeHighScore') || '0'));
              highScoreEl.textContent = displayScore;
              snakeGameState.highScore = displayScore;
            }
          }

          // 濡傛灉璧勬枡妯℃€佹宸叉墦寮€锛岄噸鏂版洿鏂板叾鍐呭
          const profileModal = document.getElementById('account-modal');
          if (profileModal) {
            // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
            const accountData = currentAccount.account.account || currentAccount.account;
            const statsData = currentAccount.stats || {};

            // 閲嶆柊鎵撳紑璧勬枡妯℃€佹浠ユ樉绀烘渶鏂版暟鎹?
            const modal = profileModal;
            modal.innerHTML = `
              <div class="account-modal" style="max-width: 500px;">
                <div class="account-modal-title">馃懁 鐢ㄦ埛璧勬枡</div>
                
                <div class="account-form-group">
                  <label class="account-form-label">鐢ㄦ埛鍚?/label>
                  <input type="text" class="account-form-input" value="${accountData?.username}" disabled style="background: #f7fafc; cursor: not-allowed;">
                </div>
                
                <div class="account-form-group">
                  <label class="account-form-label">鏄电О</label>
                  <input type="text" class="account-form-input" id="profile-nickname" value="${accountData?.nickname || ''}" placeholder="璇疯緭鍏ユ樀绉?>
                </div>
                
                <div class="account-form-group">
                  <label class="account-form-label">涓汉绠€浠?/label>
                  <textarea class="account-form-input" id="profile-bio" rows="3" placeholder="浠嬬粛涓€涓嬭嚜宸?..">${accountData?.profile?.bio || ''}</textarea>
                </div>
                
                <div class="account-form-group">
                  <label class="account-form-label">绛夌骇</label>
                  <input type="text" class="account-form-input" value="Lv.${accountData?.profile?.level || 1}" disabled style="background: #f7fafc; cursor: not-allowed;">
                </div>
                
                <div class="account-form-group">
                  <label class="account-form-label">缁忛獙鍊?/label>
                  <div style="background: #f7fafc; padding: 12px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
                      <span>${accountData?.profile?.exp || 0} EXP</span>
                      <span>缁忛獙: ${accountData?.profile?.exp || 0}</span>
                    </div>
                  </div>
                </div>
                
                <div class="account-form-group">
                  <label class="account-form-label">娓告垙缁熻</label>
                  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 20px; font-weight: bold; color: #38a169;">${statsData?.wins || 0}</div>
                      <div style="font-size: 12px; color: #718096;">鑳?/div>
                    </div>
                    <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 20px; font-weight: bold; color: #e53e3e;">${statsData?.losses || 0}</div>
                      <div style="font-size: 12px; color: #718096;">璐?/div>
                    </div>
                    <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                      <div style="font-size: 20px; font-weight: bold; color: #d69e2e;">${statsData?.draws || 0}</div>
                      <div style="font-size: 12px; color: #718096;">骞?/div>
                    </div>
                  </div>
                </div>
                
                <div class="account-form-actions">
                  <button class="account-btn btn-secondary" onclick="closeAccountModal()">杩斿洖</button>
                  <button class="account-btn btn-info" onclick="showGameHistoryModal()">娓告垙鍘嗗彶</button>
                  <button class="account-btn btn-warning" onclick="showChangePasswordModal()">淇敼瀵嗙爜</button>
                  <button class="account-btn btn-primary" onclick="saveProfile()">淇濆瓨璧勬枡</button>
                </div>
              </div>
            `;
          }
        }
      });
    }

    // 缁忛獙鑾峰緱閫氱煡锛氭樉绀哄熀纭€缁忛獙 + 棰濆缁忛獙
    socket.on('exp_gained', (data) => {
      const r = data.expResult;
      if (!r) return;
      const bonus = r.bonusExp || 0;
      const base = r.baseExp || 0;
      const total = r.finalExp || (base + bonus);
      let msg = `鉁?鑾峰緱 ${total} 缁忛獙鍊糮;
      if (bonus > 0 && r.eventLabel) {
        msg += `锛堝熀纭€ ${base} + ${r.eventLabel} 棰濆 ${bonus}锛塦;
      } else if (bonus > 0) {
        msg += `锛堝熀纭€ ${base} + 棰濆 ${bonus}锛塦;
      }
      showToast(msg, 'success');
    });

    // 鏇存柊鎺掕姒滄樉绀?
    // 褰撳墠鎺掕姒滈€変腑鐨勬父鎴忕被鍨?
    let currentLeaderboardGameType = 'all';

    function updateLeaderboard(leaderboard, gameType) {
      const list = document.getElementById('leaderboard-list');
      if (!list) return;

      if (!leaderboard || leaderboard.length === 0) {
        list.innerHTML = '<div style="color: #718096; font-size: 12px;">鏆傛棤鏁版嵁</div>';
        return;
      }

      list.innerHTML = leaderboard.map(player => {
        const rankClass = player.rank <= 3 ? `top-${player.rank}` : '';
        const name = player.name || player.username || '鏈煡鐜╁';
        const isSnake = gameType === 'snake';
        return `
          <div class="leaderboard-item ${rankClass}">
            <div class="leaderboard-left">
              <div class="leaderboard-rank">#${player.rank}</div>
              <div>
                <div class="leaderboard-name">${name}</div>
                <div class="leaderboard-level">Lv.${player.level || 1}</div>
              </div>
            </div>
            <div class="leaderboard-stats">
              ${isSnake ?
            `<div class="leaderboard-wins">${player.score || 0}鍒?/div>
                     <div class="leaderboard-winrate">鏈€楂樺垎鏁?/div>` :
            `<div class="leaderboard-wins">${player.wins || 0}鑳?/div>
                     <div class="leaderboard-winrate">鑳滅巼 ${player.winrate || '0%'}</div>`
          }
            </div>
          </div>
        `;
      }).join('');
      applyThemeToLeaderboard();
    }

    function applyThemeToLeaderboard() {
      if (!leaderboardList) return;
      const theme = themes[currentTheme];
      const leaderboardItems = leaderboardList.querySelectorAll('.leaderboard-item');
      leaderboardItems.forEach(item => {
        item.style.background = theme.uiColors.leaderboardItemBg;
        const rankEl = item.querySelector('.leaderboard-rank');
        if (rankEl) {
          rankEl.style.color = theme.uiColors.rankColor;
        }
        const nameEl = item.querySelector('.leaderboard-name');
        if (nameEl) {
          nameEl.style.color = theme.uiColors.nameColor;
        }
        const levelEl = item.querySelector('.leaderboard-level');
        if (levelEl) {
          levelEl.style.color = theme.uiColors.levelColor;
        }
        const winsEl = item.querySelector('.leaderboard-wins');
        if (winsEl) {
          winsEl.style.color = theme.uiColors.winsColor;
        }
        const winrateEl = item.querySelector('.leaderboard-winrate');
        if (winrateEl) {
          winrateEl.style.color = theme.uiColors.winrateColor;
        }
      });
    }

    // 鏄剧ず绯荤粺骞挎挱
    function showBroadcast(message, from = '绠＄悊鍛?, timestamp = Date.now()) {
      broadcastContent.textContent = message;
      const time = new Date(timestamp);
      broadcastTime.textContent = time.toLocaleString('zh-CN');
      systemBroadcast.classList.add('show');

      // 30绉掑悗鑷姩闅愯棌
      setTimeout(() => {
        hideBroadcast();
      }, 30000);
    }

    // ========== 鎮旀绯荤粺 ==========

    // 鏀跺埌瀵规墜鐨勬倲妫嬭姹?
    socket.on('undo_request', (data) => {
      const accepted = confirm(`鐜╁ ${data.fromNickname || '瀵规墜'} 璇锋眰鎮旀锛屾槸鍚﹀悓鎰忥紵`);
      socket.emit('undo_response', { accepted });
    });

    // 鎮旀璇锋眰宸插彂閫?
    socket.on('undo_request_sent', (data) => {
      updateStatus(data.message || '鈴?宸插彂閫佹倲妫嬭姹傦紝绛夊緟瀵规墜鍥炲簲');
    });

    // 鎮旀琚帴鍙?
    socket.on('undo_accepted', (data) => {
      updateStatus('鉁?鎮旀鎴愬姛锛?);
      handleUndoAccepted(data);
    });

    // 鎮旀琚嫆缁?
    socket.on('undo_rejected', (data) => {
      updateStatus(`鉂?${data.message || '鎮旀璇锋眰琚嫆缁?}`);
    });

    // 鎮旀鎵ｉ櫎鍙嶉
    socket.on('undo_deduct', (data) => {
      if (data.success) {
        // 鏇存柊鏈湴搴撳瓨
        if (currentAccount) {
          const accData = currentAccount.account;
          if (accData.inventory) {
            accData.inventory.undoCount = (accData.inventory.undoCount || 1) - 1;
          }
          updateAccountBar();
        }
      }
    });

    // 娓告垙鍐呴亾鍏蜂娇鐢ㄥ弽棣?
    socket.on('game_item_used', (data) => {
      if (data.success) {
        // 鏇存柊鏈湴搴撳瓨鏁版嵁
        if (currentAccount) {
          const accData = currentAccount.account;
          if (!accData.inventory) accData.inventory = {};
          if (data.itemId === 'item_undo') {
            // 鍒犻櫎涓€寮犻亾鍏峰崱锛屽姞涓?娆＄洿鎺ヤ娇鐢ㄦ鏁?
            const items = accData.inventory.items || {};
            if (items.item_undo) items.item_undo -= 1;
            accData.inventory.undoCount = data.undoCount || 0;
          } else if (data.itemId === 'item_hint') {
            const items = accData.inventory.items || {};
            if (items.item_hint) items.item_hint -= 1;
            accData.inventory.hintCount = data.hintCount || 0;
          }
          // 鏇存柊 items 鏁版嵁
          if (data.items) {
            accData.inventory.items = data.items;
          }
          updateAccountBar();
        }
        // 閲嶈瘯璇锋眰
        if (data.itemId === 'item_undo') {
          requestUndo();
        } else if (data.itemId === 'item_hint') {
          requestHint();
        }
      } else {
        showToast(`鉂?浣跨敤閬撳叿澶辫触锛?{data.message || '鏈煡閿欒'}`, 'error');
        updateStatus('鉂?浣跨敤閬撳叿澶辫触');
      }
    });

    // ========== 鎻愮ず绯荤粺 ==========

    // 鏀跺埌鎻愮ず缁撴灉
    socket.on('hint_result', (data) => {
      handleHintResult(data);
    });

    // 鎻愮ず鎵ｉ櫎鍙嶉
    socket.on('hint_deduct', (data) => {
      if (data.success) {
        // 鏇存柊鏈湴搴撳瓨
        if (currentAccount) {
          const accData = currentAccount.account;
          if (accData.inventory) {
            accData.inventory.hintCount = data.hintCount !== undefined ? data.hintCount : (accData.inventory.hintCount || 1) - 1;
          }
          updateAccountBar();
        }
        if (data.message) {
          updateStatus(`馃挕 ${data.message}`);
        }
      } else {
        updateStatus(`鉂?${data.message || '鎻愮ず娆℃暟涓嶈冻'}`);
      }
    });

    // 闅愯棌绯荤粺骞挎挱
    function hideBroadcast() {
      systemBroadcast.classList.remove('show');
    }

    // 鍒濆鍖栨墍鏈夋鐩?
    function initBoards() {
      initGobangBoard();
      initGoBoard();
      initChessBoard();
    }

    // 鍒濆鍖栦簲瀛愭妫嬬洏
    function initGobangBoard() {
      const config = gameConfigs.gobang;
      gobangBoard.innerHTML = '';

      for (let r = 0; r < config.size; r++) {
        for (let c = 0; c < config.size; c++) {
          const cell = document.createElement('div');
          cell.className = config.cellClass;
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.onclick = () => handleGobangClick(r, c);
          cell.onmousemove = () => updateMousePos(r, c);
          gobangBoard.appendChild(cell);
        }
      }
    }

    // 鍒濆鍖栧洿妫嬫鐩?
    function initGoBoard() {
      const config = gameConfigs.go;
      goBoard.innerHTML = '';

      for (let r = 0; r < config.size; r++) {
        for (let c = 0; c < config.size; c++) {
          const cell = document.createElement('div');
          cell.className = config.cellClass;
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.onclick = () => handleGoClick(r, c);
          cell.onmousemove = () => updateMousePos(r, c);

          // 娣诲姞鏄熶綅
          if ((r === 3 || r === 9 || r === 15) && (c === 3 || c === 9 || c === 15)) {
            const star = document.createElement('div');
            star.className = 'go-star';
            cell.appendChild(star);
          }

          goBoard.appendChild(cell);
        }
      }

      // 娣诲姞娌崇晫鍜屼節瀹牸鏍囪锛堝洿妫嬩笉闇€瑕侊級
    }

    // 鍒濆鍖栬薄妫嬫鐩?
    function initChessBoard() {
      const config = gameConfigs['chinese-chess'];
      chessBoard.innerHTML = '';

      // ========================================
      // 1. 鍒涘缓SVG鏉ョ粯鍒剁簿纭殑妫嬬洏绾挎潯鍜屼節瀹牸
      // ========================================
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.position = 'absolute';
      svg.style.top = '20px';
      svg.style.left = '20px';
      svg.style.width = '320px';
      svg.style.height = '360px';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '1';

      // 缁樺埗绔栫嚎锛?鏉★級
      for (let c = 0; c < 9; c++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', c * 40);
        line.setAttribute('y1', 0);
        line.setAttribute('x2', c * 40);
        // 宸﹀彸杈圭嚎鏄繛缁殑
        if (c === 0 || c === 8) {
          line.setAttribute('y2', 360);
        } else {
          // 涓棿鐨勭珫绾匡紝娌崇晫涓婁笅鍒嗗紑鐢?
          line.setAttribute('y2', 160); // 0-4琛?
        }
        line.setAttribute('stroke', 'rgba(0,0,0,0.35)');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        // 涓棿绔栫嚎鐨勪笅鍗婇儴鍒嗭紙5-9琛岋級
        if (c > 0 && c < 8) {
          const lineBottom = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          lineBottom.setAttribute('x1', c * 40);
          lineBottom.setAttribute('y1', 200);
          lineBottom.setAttribute('x2', c * 40);
          lineBottom.setAttribute('y2', 360);
          lineBottom.setAttribute('stroke', 'rgba(0,0,0,0.35)');
          lineBottom.setAttribute('stroke-width', '1');
          svg.appendChild(lineBottom);
        }
      }

      // 缁樺埗妯嚎锛?0鏉★級
      for (let r = 0; r < 10; r++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', r * 40);
        line.setAttribute('x2', 320);
        line.setAttribute('y2', r * 40);
        line.setAttribute('stroke', 'rgba(0,0,0,0.35)');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);
      }

      // 缁樺埗榛戞柟涔濆鏍兼枩绾匡紙0-2琛岋紝3-5鍒楋級
      const blackDiag1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      blackDiag1.setAttribute('x1', 120);
      blackDiag1.setAttribute('y1', 0);
      blackDiag1.setAttribute('x2', 200);
      blackDiag1.setAttribute('y2', 80);
      blackDiag1.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      blackDiag1.setAttribute('stroke-width', '1');
      svg.appendChild(blackDiag1);

      const blackDiag2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      blackDiag2.setAttribute('x1', 200);
      blackDiag2.setAttribute('y1', 0);
      blackDiag2.setAttribute('x2', 120);
      blackDiag2.setAttribute('y2', 80);
      blackDiag2.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      blackDiag2.setAttribute('stroke-width', '1');
      svg.appendChild(blackDiag2);

      // 缁樺埗绾㈡柟涔濆鏍兼枩绾匡紙7-9琛岋紝3-5鍒楋級
      const redDiag1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      redDiag1.setAttribute('x1', 120);
      redDiag1.setAttribute('y1', 280);
      redDiag1.setAttribute('x2', 200);
      redDiag1.setAttribute('y2', 360);
      redDiag1.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      redDiag1.setAttribute('stroke-width', '1');
      svg.appendChild(redDiag1);

      const redDiag2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      redDiag2.setAttribute('x1', 200);
      redDiag2.setAttribute('y1', 280);
      redDiag2.setAttribute('x2', 120);
      redDiag2.setAttribute('y2', 360);
      redDiag2.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      redDiag2.setAttribute('stroke-width', '1');
      svg.appendChild(redDiag2);

      chessBoard.appendChild(svg);

      // ========================================
      // 2. 鍒涘缓浜ゅ弶鐐?
      // ========================================
      for (let r = 0; r < config.size.height; r++) {
        for (let c = 0; c < config.size.width; c++) {
          const intersection = document.createElement('div');
          intersection.className = 'chess-intersection';
          intersection.dataset.r = r;
          intersection.dataset.c = c;
          intersection.style.left = (c * 40 + 20) + 'px';
          intersection.style.top = (r * 40 + 20) + 'px';
          intersection.onclick = () => handleChessClick(r, c);
          intersection.onmousemove = () => updateMousePos(r, c);

          // 娣诲姞鍏典綅鏍囪
          if (((r === 3 || r === 6) && (c === 0 || c === 2 || c === 4 || c === 6 || c === 8)) ||
            ((r === 2 || r === 7) && (c === 1 || c === 7)) ||
            ((r === 0 || r === 9) && (c === 0 || c === 2 || c === 4 || c === 6 || c === 8))) {
            const pos = document.createElement('div');
            pos.className = 'chess-position';
            pos.style.left = '50%';
            pos.style.top = '50%';
            pos.style.transform = 'translate(-50%, -50%)';
            intersection.appendChild(pos);
          }

          chessBoard.appendChild(intersection);
        }
      }

      // ========================================
      // 3. 娣诲姞娌崇晫鏂囧瓧
      // ========================================
      const river = document.createElement('div');
      river.className = 'chess-river';
      chessBoard.appendChild(river);

      // 娓叉煋妫嬪瓙
      renderChessPieces();
    }

    // 娓叉煋璞℃妫嬪瓙
    function renderChessPieces() {
      // 娓呴櫎鐜版湁妫嬪瓙
      const existingPieces = chessBoard.querySelectorAll('.chess-piece');
      existingPieces.forEach(piece => piece.remove());

      // 娓叉煋绾㈡柟妫嬪瓙
      chessPieces.red.forEach(piece => {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'chess-piece chess-red';
        pieceEl.textContent = piece.name;
        pieceEl.dataset.name = piece.name;
        pieceEl.dataset.color = 'red';
        pieceEl.dataset.r = piece.r;
        pieceEl.dataset.c = piece.c;
        pieceEl.style.position = 'absolute';
        pieceEl.style.left = (piece.c * 40 + 20) + 'px';
        pieceEl.style.top = (piece.r * 40 + 20) + 'px';
        pieceEl.style.transform = 'translate(-50%, -50%)';
        pieceEl.onclick = () => handleChessPieceClick(piece.r, piece.c, piece.name, 'red');
        chessBoard.appendChild(pieceEl);
      });

      // 娓叉煋榛戞柟妫嬪瓙
      chessPieces.black.forEach(piece => {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'chess-piece chess-black';
        pieceEl.textContent = piece.name;
        pieceEl.dataset.name = piece.name;
        pieceEl.dataset.color = 'black';
        pieceEl.dataset.r = piece.r;
        pieceEl.dataset.c = piece.c;
        pieceEl.style.position = 'absolute';
        pieceEl.style.left = (piece.c * 40 + 20) + 'px';
        pieceEl.style.top = (piece.r * 40 + 20) + 'px';
        pieceEl.style.transform = 'translate(-50%, -50%)';
        pieceEl.onclick = () => handleChessPieceClick(piece.r, piece.c, piece.name, 'black');
        chessBoard.appendChild(pieceEl);
      });
    }

    // 鍚庣妫嬪瓙绫诲瀷鍒颁腑鏂囧悕绉扮殑鏄犲皠
    const chessPieceMap = {
      'ju': '杞?,
      'ma': '椹?,
      'xiang': '鐩?,
      'shi': '浠?,
      'shuai': '甯?,
      'pao': '鐐?,
      'bing': '鍏?,
      'jiang': '灏?,
      'zu': '鍗?
    };

    // 涓枃鍚嶇О鍒板悗绔瀛愮被鍨嬬殑鍙嶅悜鏄犲皠锛堢孩鏂癸級
    const chessTypeMapRed = {
      '杞?: 'ju',
      '椹?: 'ma',
      '鐩?: 'xiang',
      '浠?: 'shi',
      '甯?: 'shuai',
      '鐐?: 'pao',
      '鍏?: 'bing'
    };

    // 涓枃鍚嶇О鍒板悗绔瀛愮被鍨嬬殑鍙嶅悜鏄犲皠锛堥粦鏂癸級
    const chessTypeMapBlack = {
      '杞?: 'ju',
      '椹?: 'ma',
      '璞?: 'xiang',
      '澹?: 'shi',
      '灏?: 'jiang',
      '鐐?: 'pao',
      '鍗?: 'zu'
    };

    // 浠庡悗绔鐩樻暟鎹浆鎹负鍓嶇 chessPieces 鏍煎紡
    function convertBackendBoardToFrontend(board) {
      const pieces = { red: [], black: [] };

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const cell = board[r][c];
          if (cell && cell !== 0) {
            const colorPrefix = cell.substring(0, 2);
            const type = cell.substring(2);
            const name = chessPieceMap[type];
            const color = colorPrefix === 'r-' ? 'red' : 'black';

            if (color === 'red') {
              pieces.red.push({ name: name, r: r, c: c, moves: '' });
            } else {
              pieces.black.push({ name: name, r: r, c: c, moves: '' });
            }
          }
        }
      }

      return pieces;
    }

    // 浠庡墠绔?chessPieces 鏁版嵁杞崲涓哄悗绔鐩樻牸寮?
    function convertFrontendPiecesToBackend() {
      const board = Array(10).fill().map(() => Array(9).fill(0));

      chessPieces.red.forEach(piece => {
        const type = chessTypeMapRed[piece.name];
        board[piece.r][piece.c] = 'r-' + type;
      });

      chessPieces.black.forEach(piece => {
        const type = chessTypeMapBlack[piece.name];
        board[piece.r][piece.c] = 'b-' + type;
      });

      return board;
    }

    // ========== 妫嬬鍒囨崲鍔熻兘 ==========
    function switchGame(game) {
      if (isMatching || matchedOpponentId) {
        updateStatus('鉂?鍖归厤涓垨娓告垙涓笉鑳藉垏鎹㈡绉?);
        return;
      }

      currentGame = game;
      updateGameDisplay();

      // 鏇存柊瀵艰埅鎸夐挳鐘舵€?
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        // 娓呴櫎鎵€鏈夊唴鑱旇儗鏅壊锛堝寘鎷?data-game 鍜?data-page 鐨勬寜閽級
        btn.style.background = '';
      });
      const activeBtn = document.querySelector(`[data-game="${game}"]`);
      if (activeBtn) {
        activeBtn.classList.add('active');
        // 濡傛灉鏈変富棰橈紝搴旂敤涓婚棰滆壊
        if (currentTheme && themes[currentTheme]) {
          activeBtn.style.background = themes[currentTheme].primaryColor;
        }
      }

      // 闅愯棌鎴愬氨銆丄I瀵规垬銆佷富棰橀〉闈?
      document.getElementById('achievements-container').style.display = 'none';
      document.getElementById('ai-game-container').style.display = 'none';
      document.getElementById('leaderboard-page').style.display = 'none';
      document.getElementById('theme-container').style.display = 'none';

      // 鏄剧ず鍦ㄧ嚎鐜╁闈㈡澘锛堝甫鍔ㄧ敾锛?
      const onlineUsersPanelEl = document.getElementById('online-users-panel');
      onlineUsersPanelEl.style.opacity = '0';
      onlineUsersPanelEl.style.transform = 'translateY(20px)';
      onlineUsersPanelEl.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        onlineUsersPanelEl.style.opacity = '1';
        onlineUsersPanelEl.style.transform = 'translateY(0)';
      }, 10);

      // 璐悆铔囨父鎴忕壒娈婂鐞?
      if (game === 'snake') {
        // 闅愯棌澶у巺鍜屾父鎴忔帶鍒?
        lobbyContainer.style.display = 'none';
        gameControls.style.display = 'none';
        statusBox.style.display = 'none';
        moveLogPanel.style.display = 'none';
        chatContainer.classList.remove('show');

        // 闅愯棌鍏朵粬妫嬬洏
        document.getElementById('gobang-board').style.display = 'none';
        document.getElementById('go-board').style.display = 'none';
        document.getElementById('chess-board').style.display = 'none';

        // 鏄剧ず璐悆铔囨父鎴?
        document.getElementById('snake-game-container').style.display = 'block';

        // 鍒濆鍖栬椽鍚冭泧娓告垙
        initSnakeGame();

        updateStatus('馃悕 璐悆铔囨父鎴忓凡鍑嗗灏辩华锛岀偣鍑?寮€濮嬫父鎴?寮€濮嬶紒');
        return;
      }

      // 鏄剧ず澶у巺
      lobbyContainer.style.display = 'block';

      // 闅愯棌璐悆铔囨父鎴?
      document.getElementById('snake-game-container').style.display = 'none';

      // 鏄剧ず瀵瑰簲娓告垙鐨勬鐩?
      document.getElementById('gobang-board').style.display = game === 'gobang' ? 'grid' : 'none';
      document.getElementById('go-board').style.display = game === 'go' ? 'grid' : 'none';
      document.getElementById('chess-board').style.display = game === 'chinese-chess' ? 'block' : 'none';

      // 鏄剧ず鏅鸿兘鎻愮ず
      showGameTips();

      updateStatus(`鉁?宸插垏鎹㈠埌${gameConfigs[game].emoji} ${gameConfigs[game].colorNames[0]}${gameConfigs[game].colorNames[1]}锛岀偣鍑?寮€濮嬪尮閰?瀵绘壘瀵规墜`);
    }

    // 鏇存柊瀵艰埅鎸夐挳閫変腑鐘舵€侊紙鐢ㄤ簬鎴愬氨銆丄I瀵规垬銆佷富棰橀〉闈級
    function updateNavActiveState(page) {
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        // 娓呴櫎鍐呰仈鑳屾櫙鑹?
        btn.style.background = '';
      });

      const activeBtn = document.querySelector(`[data-page="${page}"]`);
      if (activeBtn) {
        activeBtn.classList.add('active');
        // 濡傛灉鏈変富棰橈紝搴旂敤涓婚棰滆壊
        if (currentTheme && themes[currentTheme]) {
          activeBtn.style.background = themes[currentTheme].primaryColor;
        }
      }
    }

    // 鏇存柊娓告垙鏄剧ず
    function updateGameDisplay() {
      // 璐悆铔囨父鎴忎笉闇€瑕佹洿鏂版鐩樻樉绀?
      if (currentGame === 'snake') {
        return;
      }

      const config = gameConfigs[currentGame];

      // 鏇存柊褰撳墠妫嬬鏄剧ず
      currentGameEl.textContent = `${config.emoji} ${currentGame === 'gobang' ? '浜斿瓙妫? : currentGame === 'go' ? '鍥存' : '璞℃'}`;

      // 鏇存柊鑳滆礋鍒ゅ畾鏄剧ず
      winConditionEl.textContent = config.winCondition;

      // 鏇存柊鎬绘牸瀛愭暟
      totalCellsEl.textContent = config.totalCells;
      emptyCountEl.textContent = config.totalCells;

      // 闅愯棌鎵€鏈夋鐩橈紝鏄剧ず褰撳墠妫嬬鐨勬鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      if (currentGame === 'gobang') {
        gobangBoard.style.display = 'grid';
      } else if (currentGame === 'go') {
        goBoard.style.display = 'grid';
      } else if (currentGame === 'chinese-chess') {
        chessBoard.style.display = 'grid';
      }

      // 娣诲姞鍒囨崲鍔ㄧ敾
      const currentBoard = document.querySelector(`.${config.boardClass}`);
      if (currentBoard) {
        currentBoard.classList.add('board-fade');
        setTimeout(() => {
          currentBoard.classList.remove('board-fade');
        }, 500);
      }
    }





    // ========== 娓告垙鏍稿績閫昏緫 ==========
    function resetGameState() {
      const config = gameConfigs[currentGame];

      if (currentGame === 'chinese-chess') {
        gameState.board = Array(config.size.height).fill().map(() => Array(config.size.width).fill(0));
        // 閲嶆柊娓叉煋妫嬪瓙
        renderChessPieces();
      } else {
        gameState.board = Array(config.size).fill().map(() => Array(config.size).fill(0));
      }

      gameState.turn = 1; // 榛戞鍏堟墜
      gameState.gameOver = false;
      gameState.isConnected = true;
      gameState.moveCount = 0;
      gameState.moveLog = [];
      gameState.blackCount = 0;
      gameState.whiteCount = 0;
      gameState.maxChain = 0;
      gameState.moveTimestamps = [];
      gameState.networkLatency = 0;
      gameState.selectedPiece = null;
      gameState.validMoves = [];
    }



    // ========== 浜斿瓙妫嬮€昏緫 ==========
    function handleGobangClick(r, c) {
      if (currentGame !== 'gobang' || gameState.gameOver || gameState.turn !== gameState.me || gameState.board[r][c] !== 0 || (!matchedOpponentId && !gameState.difficulty)) return;

      gameState.board[r][c] = gameState.me;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: gameState.me,
        r: r,
        c: c,
        isOpponent: false
      });
      gameState.moveTimestamps.push(Date.now());

      // 璁板綍鏈€鏂扮Щ鍔?
      gameState.lastMove = { r: r, c: c, color: gameState.me };

      if (gameState.me === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      const chain = calculateGobangChain(r, c, gameState.me);
      if (chain > gameState.maxChain) {
        gameState.maxChain = chain;
      }

      // 鎾斁钀藉瓙闊虫晥
      playSound('stonePlace');

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, gameState.me);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃搶 浣犲凡钀藉瓙 (${r},${c})锛岀瓑寰呭鏂瑰洖鍚坄);

      if (matchedOpponentId) {
        sendMessage({
          type: 'move',
          game: currentGame,
          r: r,
          c: c,
          color: gameState.me,
          to: matchedOpponentId,
          timestamp: Date.now()
        });
      } else {
        // AI瀵规垬锛屽彂閫佺Щ鍔ㄧ粰鏈嶅姟鍣?
        if (socket) {
          socket.emit('ai_move', {
            position: { r, c }
          });
        }
      }

      if (checkGobangWin(r, c, gameState.me)) {
        gameState.gameOver = true;
        const winMsg = gameState.me === 1 ? '榛戞鑾疯儨锛? : '鐧芥鑾疯儨锛?;
        const winColor = gameState.me === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${gameState.me === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';

        // 鎾斁鑳滃埄闊虫晥
        playSound('win');

        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();

        // 鍙戦€?AI 娓告垙缁撴灉
        sendAIGameResult('win');
      }
    }

    function calculateGobangChain(r, c, color) {
      const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
      let max = 0;

      for (let [dr, dc] of directions) {
        let count = 1;

        for (let i = 1; i < 5; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= gameConfigs.gobang.size || nc < 0 || nc >= gameConfigs.gobang.size || gameState.board[nr][nc] !== color) break;
          count++;
          if (count >= 5) return 5;
        }

        for (let i = 1; i < 5; i++) {
          const nr = r - dr * i;
          const nc = c - dc * i;
          if (nr < 0 || nr >= gameConfigs.gobang.size || nc < 0 || nc >= gameConfigs.gobang.size || gameState.board[nr][nc] !== color) break;
          count++;
          if (count >= 5) return 5;
        }

        if (count > max) max = count;
      }

      return max;
    }

    function checkGobangWin(r, c, color) {
      const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

      for (let [dr, dc] of directions) {
        let count = 1;

        for (let i = 1; i < 5; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= gameConfigs.gobang.size || nc < 0 || nc >= gameConfigs.gobang.size || gameState.board[nr][nc] !== color) break;
          count++;
          if (count >= 5) return true;
        }

        for (let i = 1; i < 5; i++) {
          const nr = r - dr * i;
          const nc = c - dc * i;
          if (nr < 0 || nr >= gameConfigs.gobang.size || nc < 0 || nc >= gameConfigs.gobang.size || gameState.board[nr][nc] !== color) break;
          count++;
          if (count >= 5) return true;
        }

        if (count >= 5) return true;
      }

      return false;
    }

    // ========== 鍥存閫昏緫 ==========
    function handleGoClick(r, c) {
      if (currentGame !== 'go' || gameState.gameOver || gameState.turn !== gameState.me || gameState.board[r][c] !== 0 || (!matchedOpponentId && !gameState.difficulty)) return;

      // 妫€鏌ユ槸鍚︽墦鍔?
      if (isKo(r, c, gameState.me)) {
        updateStatus(`鉂?鎵撳姭锛屼笉鑳界珛鍗冲洖鎻恅);
        return;
      }

      // 绠€鍗曠殑鍥存钀藉瓙閫昏緫锛堝疄闄呭洿妫嬭鍒欐洿澶嶆潅锛?
      gameState.board[r][c] = gameState.me;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: gameState.me,
        r: r,
        c: c,
        isOpponent: false
      });
      gameState.moveTimestamps.push(Date.now());

      // 璁板綍鏈€鏂扮Щ鍔?
      gameState.lastMove = { r: r, c: c, color: gameState.me };

      if (gameState.me === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      // 绠€鍗曠殑鎻愬瓙閫昏緫
      const captured = removeCapturedStones(3 - gameState.me);

      // 妫€鏌ユ槸鍚﹀舰鎴愭墦鍔紙鍙彁浜嗕竴涓瓙锛?
      if (captured === 1) {
        // 鎵惧埌琚彁鐨勫瓙鐨勪綅缃?
        for (let i = 0; i < gameConfigs.go.size; i++) {
          for (let j = 0; j < gameConfigs.go.size; j++) {
            if (gameState.board[i][j] === 0) {
              // 妫€鏌ヨ繖涓綅缃槸鍚︽槸鍒氳鎻愮殑瀛?
              const wasCaptured = !gameState.moveLog.some(move => move.r === i && move.c === j && move.color === 3 - gameState.me);
              if (wasCaptured) {
                // 璁剧疆鎵撳姭浣嶇疆锛屽鏂逛笅涓€鍥炲悎涓嶈兘绔嬪嵆鍥炴彁
                gameState.koPosition = { r: i, c: j };
                gameState.koColor = 3 - gameState.me;
                break;
              }
            }
          }
        }
      } else {
        // 涓嶆槸鎵撳姭锛屾竻闄ゆ墦鍔姸鎬?
        gameState.koPosition = null;
        gameState.koColor = null;
      }
      const myGroup = getGoGroup(r, c, gameState.me);
      if (!hasGroupLiberty(myGroup)) {
        // 鑷潃锛屾挙閿€钀藉瓙
        gameState.board[r][c] = 0;
        gameState.moveCount--;
        gameState.moveLog.pop();
        gameState.moveTimestamps.pop();
        gameState.lastMove = gameState.moveLog.length > 0 ? {
          r: gameState.moveLog[gameState.moveLog.length - 1].r,
          c: gameState.moveLog[gameState.moveLog.length - 1].c,
          color: gameState.moveLog[gameState.moveLog.length - 1].color
        } : null;

        if (gameState.me === 1) {
          gameState.blackCount--;
        } else {
          gameState.whiteCount--;
        }

        // 鎭㈠鎵撳姭鐘舵€?
        gameState.koPosition = null;
        gameState.koColor = null;

        updateTurnDisplay();
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();

        updateStatus(`鉂?璇ヤ綅缃細瀵艰嚧鑷潃锛屾棤娉曡惤瀛恅);
        return;
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, gameState.me);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃搶 浣犲凡钀藉瓙 (${r},${c})锛岀瓑寰呭鏂瑰洖鍚坄);

      if (matchedOpponentId) {
        sendMessage({
          type: 'move',
          game: currentGame,
          r: r,
          c: c,
          color: gameState.me,
          to: matchedOpponentId,
          timestamp: Date.now()
        });
      } else {
        // AI瀵规垬锛屽彂閫佺Щ鍔ㄧ粰鏈嶅姟鍣?
        if (socket) {
          socket.emit('ai_move', {
            position: { r, c }
          });
        }
      }

      // 鍥存閫氬父閫氳繃棰嗗湴鍒ゅ畾鑳滆礋锛岃繖閲岀畝鍖栧鐞?
      if (checkGoWin()) {
        gameState.gameOver = true;

        // 鏄剧ず鐐圭洰缁撴灉
        setTimeout(() => {
          showGameResult();
        }, 500);

        const winMsg = gameState.me === 1 ? '榛戞鑾疯儨锛? : '鐧芥鑾疯儨锛?;
        const winColor = gameState.me === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${gameState.me === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();

        socket.emit('game_result', {
          result: 'win',
          reason: '妫嬬洏濉弧'
        });
      }
    }

    // 鍥存鎻愬瓙閫昏緫锛堝畬鍠勭増锛?
    function removeCapturedStones(color) {
      const capturedStones = [];

      // 妫€鏌ュ鎵嬬殑妫嬪瓙鏄惁鏈夋皵
      for (let r = 0; r < gameConfigs.go.size; r++) {
        for (let c = 0; c < gameConfigs.go.size; c++) {
          if (gameState.board[r][c] === color) {
            // 妫€鏌ヨ繖涓瀛愭墍鍦ㄧ殑涓€鍧楁鏄惁鏈夋皵
            const group = getGoGroup(r, c, color);
            if (!hasGroupLiberty(group)) {
              // 鏁村潡妫嬮兘琚彁璧?
              group.forEach(stone => {
                if (!capturedStones.some(s => s.r === stone.r && s.c === stone.c)) {
                  capturedStones.push(stone);
                }
              });
            }
          }
        }
      }

      // 绉婚櫎琚彁鐨勬瀛?
      capturedStones.forEach(stone => {
        gameState.board[stone.r][stone.c] = 0;
        if (stone.color === 1) {
          gameState.blackCount--;
        } else {
          gameState.whiteCount--;
        }
      });

      return capturedStones.length;
    }

    // 鑾峰彇鍥存妫嬪瓙鎵€鍦ㄧ殑鏁村潡
    function getGoGroup(startR, startC, color) {
      const group = [];
      const visited = new Set();
      const stack = [{ r: startR, c: startC }];

      while (stack.length > 0) {
        const { r, c } = stack.pop();
        const key = `${r},${c}`;

        if (visited.has(key)) continue;
        visited.add(key);
        group.push({ r, c, color });

        // 妫€鏌ュ洓涓柟鍚?
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of directions) {
          const nr = r + dr;
          const nc = c + dc;

          if (nr >= 0 && nr < gameConfigs.go.size && nc >= 0 && nc < gameConfigs.go.size) {
            if (gameState.board[nr][nc] === color) {
              stack.push({ r: nr, c: nc });
            }
          }
        }
      }

      return group;
    }

    // 妫€鏌ユ暣鍧楁鏄惁鏈夋皵
    function hasGroupLiberty(group) {
      const checked = new Set();

      for (const stone of group) {
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of directions) {
          const nr = stone.r + dr;
          const nc = stone.c + dc;
          const key = `${nr},${nc}`;

          if (checked.has(key)) continue;
          checked.add(key);

          if (nr >= 0 && nr < gameConfigs.go.size && nc >= 0 && nc < gameConfigs.go.size) {
            if (gameState.board[nr][nc] === 0) {
              return true; // 鎵惧埌姘?
            }
          }
        }
      }

      return false; // 娌℃湁姘?
    }

    // 妫€鏌ュ崟涓瀛愭槸鍚︽湁姘?
    function hasLiberty(r, c, color) {
      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < gameConfigs.go.size && nc >= 0 && nc < gameConfigs.go.size) {
          if (gameState.board[nr][nc] === 0) {
            return true; // 鎵惧埌姘?
          }
        }
      }
      return false;
    }

    // 妫€鏌ユ槸鍚︽墦鍔?
    function isKo(r, c, color) {
      // 妫€鏌ユ槸鍚﹀湪鎵撳姭浣嶇疆
      if (gameState.koPosition && gameState.koPosition.r === r && gameState.koPosition.c === c && gameState.koColor === color) {
        return true;
      }
      return false;
    }

    function checkGoWin() {
      // 鍥存鑳滆礋鍒ゅ畾锛氭暟瀛愭硶
      const totalCells = gameConfigs.go.totalCells;
      const filledCells = gameState.blackCount + gameState.whiteCount;

      // 褰撳弻鏂归兘 pass 鎴栬€呮鐩樺熀鏈～婊℃椂缁撴潫
      if (filledCells >= totalCells * 0.95) {
        return true;
      }

      // 妫€鏌ユ槸鍚﹁繕鏈夊悎娉曠Щ鍔?
      if (!hasValidGoMove(1) && !hasValidGoMove(2)) {
        return true;
      }

      return false;
    }

    // 妫€鏌ユ槸鍚﹁繕鏈夊悎娉曠Щ鍔?
    function hasValidGoMove(color) {
      for (let r = 0; r < gameConfigs.go.size; r++) {
        for (let c = 0; c < gameConfigs.go.size; c++) {
          if (gameState.board[r][c] === 0) {
            // 妫€鏌ヨ繖涓綅缃槸鍚﹀彲浠ヨ惤瀛愶紙鏈夋皵鎴栬兘鎻愬瓙锛?
            gameState.board[r][c] = color;
            const hasLib = hasLiberty(r, c, color);

            // 淇濆瓨褰撳墠鐨勮鏁扮姸鎬?
            const originalBlackCount = gameState.blackCount;
            const originalWhiteCount = gameState.whiteCount;

            const canCapture = removeCapturedStones(3 - color) > 0;

            // 鎭㈠璁℃暟鐘舵€?
            gameState.blackCount = originalBlackCount;
            gameState.whiteCount = originalWhiteCount;

            gameState.board[r][c] = 0;

            if (hasLib || canCapture) {
              return true;
            }
          }
        }
      }
      return false;
    }

    // 鍥存鐐圭洰锛堢畝鍖栫増锛?
    function countGoScore() {
      let blackScore = gameState.blackCount;
      let whiteScore = gameState.whiteCount + 7.5; // 璐寸洰

      // 璁＄畻绌哄湴褰掑睘
      const visited = new Set();

      for (let r = 0; r < gameConfigs.go.size; r++) {
        for (let c = 0; c < gameConfigs.go.size; c++) {
          if (gameState.board[r][c] === 0 && !visited.has(`${r},${c}`)) {
            const territory = getGoTerritory(r, c);
            territory.visited.forEach(key => visited.add(key));

            if (territory.blackBorder && !territory.whiteBorder) {
              blackScore += territory.emptyCount;
            } else if (territory.whiteBorder && !territory.blackBorder) {
              whiteScore += territory.emptyCount;
            }
          }
        }
      }

      return { black: blackScore, white: whiteScore };
    }

    // 鑾峰彇绌哄湴褰掑睘
    function getGoTerritory(startR, startC) {
      const visited = new Set();
      let emptyCount = 0;
      let blackBorder = false;
      let whiteBorder = false;
      const stack = [{ r: startR, c: startC }];

      while (stack.length > 0) {
        const { r, c } = stack.pop();
        const key = `${r},${c}`;

        if (visited.has(key)) continue;
        visited.add(key);
        emptyCount++;

        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of directions) {
          const nr = r + dr;
          const nc = c + dc;

          if (nr >= 0 && nr < gameConfigs.go.size && nc >= 0 && nc < gameConfigs.go.size) {
            if (gameState.board[nr][nc] === 0) {
              stack.push({ r: nr, c: nc });
            } else if (gameState.board[nr][nc] === 1) {
              blackBorder = true;
            } else if (gameState.board[nr][nc] === 2) {
              whiteBorder = true;
            }
          }
        }
      }

      return { visited, emptyCount, blackBorder, whiteBorder };
    }

    // ========== 璞℃閫昏緫 ==========
    // 澶勭悊妫嬪瓙鐐瑰嚮
    function handleChessPieceClick(r, c, name, color) {
      handleChessClick(r, c);
    }

    function handleChessClick(r, c) {
      if (currentGame !== 'chinese-chess' || gameState.gameOver || (!matchedOpponentId && !gameState.difficulty)) return;

      const piece = getChessPieceAt(r, c);

      if (gameState.selectedPiece) {
        if (piece && piece.dataset.color === (gameState.turn === 1 ? 'red' : 'black')) {
          // 閫夋嫨鏂扮殑妫嬪瓙
          selectChessPiece(r, c);
        } else {
          // 绉诲姩妫嬪瓙
          moveChessPiece(gameState.selectedPiece.dataset.r, gameState.selectedPiece.dataset.c, r, c);
        }
      } else if (piece && piece.dataset.color === (gameState.turn === 1 ? 'red' : 'black')) {
        selectChessPiece(r, c);
      }
    }

    function getChessPieceAt(r, c) {
      return document.querySelector(`.chess-piece[data-r="${r}"][data-c="${c}"]`);
    }

    function selectChessPiece(r, c) {
      if (gameState.turn !== gameState.me) return;

      const piece = getChessPieceAt(r, c);
      if (!piece || piece.dataset.color !== (gameState.turn === 1 ? 'red' : 'black')) return;

      // 娓呴櫎涔嬪墠鐨勯€変腑鐘舵€?
      clearChessSelection();

      gameState.selectedPiece = piece;

      // 淇濆瓨鍘熷鏍峰紡
      piece.dataset.originalBoxShadow = piece.style.boxShadow || '';
      piece.dataset.originalFilter = piece.style.filter || '';

      // 娣诲姞閫変腑鐘舵€?
      piece.classList.add('selected');

      // 涓婚鐗规畩澶勭悊
      const theme = themes[currentTheme];
      const pieceEffects = theme.effects?.pieces;
      if (pieceEffects) {
        piece.style.boxShadow = pieceEffects.shadow || '';
        piece.style.filter = pieceEffects.filter || '';
      }

      // 璁＄畻鏈夋晥绉诲姩浣嶇疆
      gameState.validMoves = calculateChessMoves(r, c, piece.dataset.name, piece.dataset.color);

      // 鏄剧ず鏈夋晥绉诲姩浣嶇疆
      gameState.validMoves.forEach(pos => {
        const cell = document.querySelector(`.chess-intersection[data-r="${pos.r}"][data-c="${pos.c}"]`);
        if (cell) {
          // 鏍规嵁涓婚閰嶇疆璁剧疆棰滆壊
          const theme = themes[currentTheme];
          const cellEffects = theme.effects?.cells;
          if (cellEffects) {
            cell.style.backgroundColor = cellEffects.background || 'rgba(0,123,255,0.25)';
          } else {
            cell.style.backgroundColor = 'rgba(0,123,255,0.25)';
          }
          cell.style.borderRadius = '50%';
        }
      });
    }

    function clearChessSelection() {
      if (gameState.selectedPiece) {
        // 鎭㈠鍘熷鏍峰紡
        if (gameState.selectedPiece.dataset.originalBoxShadow !== undefined) {
          const theme = themes[currentTheme];
          const pieceEffects = theme.effects?.pieces;
          if (pieceEffects) {
            gameState.selectedPiece.style.boxShadow = pieceEffects.shadow || '';
            gameState.selectedPiece.style.filter = pieceEffects.filter || '';
          } else {
            gameState.selectedPiece.style.boxShadow = gameState.selectedPiece.dataset.originalBoxShadow;
            gameState.selectedPiece.style.filter = gameState.selectedPiece.dataset.originalFilter;
          }
        }
        gameState.selectedPiece.classList.remove('selected');
        gameState.selectedPiece = null;
      }

      // 娓呴櫎鏈夋晥绉诲姩鏍囪
      document.querySelectorAll('.chess-intersection').forEach(cell => {
        cell.style.backgroundColor = '';
        cell.style.borderRadius = '';
      });

      gameState.validMoves = [];
    }

    function calculateChessMoves(r, c, type, color) {
      const moves = [];
      const directions = [];
      const isRed = color === 'red';

      switch (type) {
        case '甯?:
        case '灏?:
          // 灏嗗竻鍙兘鍦ㄤ節瀹唴绉诲姩
          const palaceR = isRed ? [7, 8, 9] : [0, 1, 2];
          const palaceC = [3, 4, 5];
          const kingDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

          kingDirs.forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            if (palaceR.includes(nr) && palaceC.includes(nc)) {
              const piece = getChessPieceAt(nr, nc);
              if (!piece || piece.dataset.color !== color) {
                moves.push({ r: nr, c: nc });
              }
            }
          });
          break;

        case '浠?:
        case '澹?:
          // 澹彧鑳借蛋鏂滅嚎
          const advisorDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
          const advisorPalaceR = isRed ? [7, 8, 9] : [0, 1, 2];
          const advisorPalaceC = [3, 4, 5];

          advisorDirs.forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            if (advisorPalaceR.includes(nr) && advisorPalaceC.includes(nc)) {
              const piece = getChessPieceAt(nr, nc);
              if (!piece || piece.dataset.color !== color) {
                moves.push({ r: nr, c: nc });
              }
            }
          });
          break;

        case '鐩?:
        case '璞?:
          // 璞¤蛋鐢?
          const elephantDirs = [[-2, -2], [-2, 2], [2, -2], [2, 2]];

          elephantDirs.forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            const midR = r + dr / 2;
            const midC = c + dc / 2;

            // 涓嶈兘杩囨渤
            if ((isRed && nr < 5) || (!isRed && nr > 4)) return;

            // 璞＄溂涓嶈兘鏈夋瀛?
            if (!getChessPieceAt(midR, midC)) {
              const piece = getChessPieceAt(nr, nc);
              if (!piece || piece.dataset.color !== color) {
                moves.push({ r: nr, c: nc });
              }
            }
          });
          break;

        case '椹?:
          // 椹蛋鏃?
          const horseDirs = [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1]
          ];

          horseDirs.forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            const midR = r + Math.sign(dr);
            const midC = c + Math.sign(dc);

            // 椹吙涓嶈兘鏈夋瀛?
            if (!getChessPieceAt(midR, midC)) {
              if (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
                const piece = getChessPieceAt(nr, nc);
                if (!piece || piece.dataset.color !== color) {
                  moves.push({ r: nr, c: nc });
                }
              }
            }
          });
          break;

        case '杞?:
          // 杞﹁蛋鐩寸嚎
          const chariotDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

          chariotDirs.forEach(([dr, dc]) => {
            for (let i = 1; i <= 9; i++) {
              const nr = r + dr * i;
              const nc = c + dc * i;

              if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) break;

              const piece = getChessPieceAt(nr, nc);
              if (!piece) {
                moves.push({ r: nr, c: nc });
              } else {
                if (piece.dataset.color !== color) {
                  moves.push({ r: nr, c: nc });
                }
                break;
              }
            }
          });
          break;

        case '鐐?:
          // 鐐炕灞?
          const cannonDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

          cannonDirs.forEach(([dr, dc]) => {
            let jumped = false;

            for (let i = 1; i <= 9; i++) {
              const nr = r + dr * i;
              const nc = c + dc * i;

              if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) break;

              const piece = getChessPieceAt(nr, nc);
              if (!piece) {
                if (!jumped) {
                  moves.push({ r: nr, c: nc });
                }
              } else {
                if (!jumped) {
                  jumped = true;
                } else {
                  if (piece.dataset.color !== color) {
                    moves.push({ r: nr, c: nc });
                  }
                  break;
                }
              }
            }
          });
          break;

        case '鍏?:
        case '鍗?:
          // 鍏靛崚杩囨渤鍓嶅彧鑳藉悜鍓嶏紝杩囨渤鍚庡彲浠ュ乏鍙?
          const soldierDirs = isRed ? [[-1, 0]] : [[1, 0]];

          if ((isRed && r < 5) || (!isRed && r > 4)) {
            soldierDirs.push([0, -1], [0, 1]);
          }

          soldierDirs.forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;

            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
              const piece = getChessPieceAt(nr, nc);
              if (!piece || piece.dataset.color !== color) {
                moves.push({ r: nr, c: nc });
              }
            }
          });
          break;
      }

      return moves;
    }

    function moveChessPiece(fromR, fromC, toR, toC) {
      if (gameState.turn !== gameState.me) return;

      fromR = parseInt(fromR);
      fromC = parseInt(fromC);

      const piece = gameState.selectedPiece;
      if (!piece) return;

      const isValidMove = gameState.validMoves.some(move => move.r === toR && move.c === toC);
      if (!isValidMove) {
        clearChessSelection();
        return;
      }

      // 1. 澶勭悊鍚冨瓙锛屽悓鏃舵洿鏂?DOM 鍜?chessPieces 鏁版嵁
      const capturedPiece = getChessPieceAt(toR, toC);
      if (capturedPiece) {
        // 浠?chessPieces 鏁版嵁涓Щ闄?
        const capturedColor = capturedPiece.dataset.color;
        if (capturedColor === 'red') {
          chessPieces.red = chessPieces.red.filter(p => !(p.r === toR && p.c === toC));
          gameState.blackCount--;
        } else {
          chessPieces.black = chessPieces.black.filter(p => !(p.r === toR && p.c === toC));
          gameState.whiteCount--;
        }
        // 浠?DOM 涓Щ闄?
        capturedPiece.remove();
      }

      // 2. 鏇存柊 chessPieces 鏁版嵁涓殑妫嬪瓙浣嶇疆
      const pieceColor = piece.dataset.color;
      const pieceName = piece.dataset.name;
      if (pieceColor === 'red') {
        const pieceIndex = chessPieces.red.findIndex(p => p.r === fromR && p.c === fromC);
        if (pieceIndex !== -1) {
          chessPieces.red[pieceIndex].r = toR;
          chessPieces.red[pieceIndex].c = toC;
        }
      } else {
        const pieceIndex = chessPieces.black.findIndex(p => p.r === fromR && p.c === fromC);
        if (pieceIndex !== -1) {
          chessPieces.black[pieceIndex].r = toR;
          chessPieces.black[pieceIndex].c = toC;
        }
      }

      // 3. 鏇存柊 DOM 涓殑妫嬪瓙浣嶇疆
      piece.dataset.r = toR;
      piece.dataset.c = toC;
      piece.style.top = `${toR * 40 + 20}px`;
      piece.style.left = `${toC * 40 + 20}px`;
      piece.style.transform = 'translate(-50%, -50%)';

      // 4. 鍚屾 gameState.board
      gameState.board = convertFrontendPiecesToBackend();

      // 璁板綍鏈€鏂扮Щ鍔?
      gameState.lastMove = { r: toR, c: toC, color: gameState.turn };

      // 鏍囪鏈€鏂扮Щ鍔ㄤ綅缃?
      document.querySelectorAll('.chess-intersection.last-move').forEach(cell => {
        cell.classList.remove('last-move');
      });
      const lastMoveCell = document.querySelector(`.chess-intersection[data-r="${toR}"][data-c="${toC}"]`);
      if (lastMoveCell) {
        lastMoveCell.classList.add('last-move');
      }

      gameState.moveCount++;
      gameState.moveLog.push({
        color: gameState.turn,
        fromR: parseInt(fromR),
        fromC: parseInt(fromC),
        toR: toR,
        toC: toC,
        piece: pieceName,
        isOpponent: false
      });
      gameState.moveTimestamps.push(Date.now());

      clearChessSelection();

      const currentTurn = gameState.turn;

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(toR, toC, currentTurn);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
      });

      updateStatus(`馃搶 浣犲凡绉诲姩 ${piece.dataset.name} 鍒?(${toR},${toC})锛岀瓑寰呭鏂瑰洖鍚坄);

      if (matchedOpponentId) {
        sendMessage({
          type: 'move',
          game: currentGame,
          fromR: parseInt(fromR),
          fromC: parseInt(fromC),
          toR: toR,
          toC: toC,
          color: gameState.turn,
          piece: piece.dataset.name,
          to: matchedOpponentId,
          timestamp: Date.now()
        });
      } else {
        // AI瀵规垬锛屽彂閫佺Щ鍔ㄧ粰鏈嶅姟鍣?
        if (socket) {
          socket.emit('ai_move', {
            position: { fromR: parseInt(fromR), fromC: parseInt(fromC), toR: toR, toC: toC }
          });
        }
      }

      // 妫€鏌ユ父鎴忕粨鏉熸潯浠?
      const winResult = checkChessWin();
      if (winResult) {
        gameState.gameOver = true;
        const winMsg = winResult.winner === 1 ? '绾㈡柟鑾疯儨锛? : '缁挎柟鑾疯儨锛?;
        const winColor = winResult.winner === 1 ? '绾㈡柟' : '缁挎柟';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${winResult.winner === 1 ? 'value-red' : 'value-green'}`;
        gameStatusEl.textContent = `娓告垙缁撴潫 - ${winResult.reason}`;
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(`${winMsg}锛?{winResult.reason}锛塦);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫 - ${winResult.reason}`);
        updateAdvancedStats();

        if (socket && socket.connected) {
          socket.emit('game_result', {
            result: 'win',
            reason: winResult.reason
          });
        }
      } else {
        // 鍒囨崲鍥炲悎鍒板鏂?
        gameState.turn = 3 - gameState.me;
        updateTurnDisplay();
      }
    }

    function checkChessWin() {
      // 妫€鏌ュ皢甯呮槸鍚﹁鍚?
      const redGeneral = document.querySelector('.chess-piece[data-name="甯?]');
      const blackGeneral = document.querySelector('.chess-piece[data-name="灏?]');

      if (!redGeneral) return { winner: 2, reason: '绾㈠竻琚悆' };
      if (!blackGeneral) return { winner: 1, reason: '榛戝皢琚悆' };

      // 妫€鏌ュ皢甯呮槸鍚﹀闈紙褰撳墠鐜╁绉诲姩鍚庨€犳垚瀵归潰锛屽綋鍓嶇帺瀹惰緭锛?
      if (checkGeneralsFacing()) {
        return { winner: 3 - gameState.turn, reason: '灏嗗竻瀵归潰' };
      }

      // 妫€鏌ュ鏂规槸鍚﹀洶姣欙紙鏃犲瓙鍙姩锛屽綋鍓嶇帺瀹惰耽锛?
      if (isStalemate(3 - gameState.turn)) {
        return { winner: gameState.turn, reason: '鍥版瘷' };
      }

      return null;
    }

    // 妫€鏌ュ皢甯呮槸鍚﹀闈?
    function checkGeneralsFacing() {
      const redGeneral = document.querySelector('.chess-piece[data-name="甯?]');
      const blackGeneral = document.querySelector('.chess-piece[data-name="灏?]');

      if (!redGeneral || !blackGeneral) return false;

      const redR = parseInt(redGeneral.dataset.r);
      const redC = parseInt(redGeneral.dataset.c);
      const blackR = parseInt(blackGeneral.dataset.r);
      const blackC = parseInt(blackGeneral.dataset.c);

      // 涓嶅湪鍚屼竴鍒?
      if (redC !== blackC) return false;

      // 妫€鏌ヤ腑闂存槸鍚︽湁妫嬪瓙
      const minR = Math.min(redR, blackR);
      const maxR = Math.max(redR, blackR);

      for (let r = minR + 1; r < maxR; r++) {
        if (getChessPieceAt(r, redC)) {
          return false; // 涓棿鏈夋瀛?
        }
      }

      return true; // 灏嗗竻瀵归潰
    }

    // 妫€鏌ユ槸鍚﹀洶姣?
    function isStalemate(color) {
      const colorStr = color === 1 ? 'red' : 'black';
      const pieces = document.querySelectorAll(`.chess-piece[data-color="${colorStr}"]`);

      for (const piece of pieces) {
        const r = parseInt(piece.dataset.r);
        const c = parseInt(piece.dataset.c);
        const type = piece.dataset.name;

        const moves = calculateChessMoves(r, c, type, colorStr);
        if (moves.length > 0) {
          return false; // 鏈夊悎娉曠Щ鍔?
        }
      }

      return true; // 鍥版瘷
    }

    // 妫€鏌ョЩ鍔ㄥ悗鏄惁閫犳垚灏嗗竻瀵归潰
    function wouldCauseFacing(fromR, fromC, toR, toC) {
      // 涓存椂绉诲姩妫嬪瓙
      const piece = getChessPieceAt(fromR, fromC);
      if (!piece) return false;

      const originalR = piece.dataset.r;
      const originalC = piece.dataset.c;

      // 鎵ц涓存椂绉诲姩
      piece.dataset.r = toR;
      piece.dataset.c = toC;
      piece.style.top = `${toR * 40 + 20}px`;
      piece.style.left = `${toC * 40 + 20}px`;

      const facing = checkGeneralsFacing();

      // 鎭㈠鍘熶綅
      piece.dataset.r = originalR;
      piece.dataset.c = originalC;
      piece.style.top = `${originalR * 40 + 20}px`;
      piece.style.left = `${originalC * 40 + 20}px`;

      return facing;
    }

    // ========== 閫氫俊鍜屾秷鎭鐞?==========


    function handleBoardMove(data) {
      console.log('澶勭悊瀵规墜钀藉瓙:', data);
      console.log('褰撳墠妫嬬洏鐘舵€?', gameState.board[data.r][data.c]);
      console.log('鏄惁鏄嚜宸辩殑娑堟伅:', data.from === accountId);

      // 妫€鏌ユ槸鍚︽槸鑷繁鐨勮惤瀛愶紝濡傛灉鏄垯璺宠繃
      if (data.from === accountId) {
        console.log('璺宠繃鑷繁鐨勮惤瀛愭秷鎭?);
        return;
      }

      // 妫€鏌ヤ綅缃槸鍚﹀凡缁忔湁妫嬪瓙
      if (gameState.board[data.r][data.c] !== 0) {
        console.warn('浣嶇疆宸叉湁妫嬪瓙锛岃烦杩?', data);
        return;
      }

      // 妫€鏌ユ槸鍚﹀凡缁忚褰曡繃杩欎釜浣嶇疆鐨勮惤瀛?
      const existingMove = gameState.moveLog.find(move => move.r === data.r && move.c === data.c);
      if (existingMove) {
        console.warn('閲嶅钀藉瓙璁板綍锛岃烦杩?', data);
        return;
      }

      // 纭繚棰滆壊姝ｇ‘ - 瀵规墜鐨勯鑹插氨鏄粬浠殑钀藉瓙棰滆壊
      const opponentColor = data.color;
      gameState.board[data.r][data.c] = opponentColor;
      gameState.turn = 3 - opponentColor; // 鍒囨崲鍥炲悎
      gameState.moveCount++;
      gameState.moveLog.push({
        color: opponentColor,
        r: data.r,
        c: data.c,
        isOpponent: true
      });
      gameState.moveTimestamps.push(Date.now());

      if (opponentColor === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      if (currentGame === 'gobang') {
        const chain = calculateGobangChain(data.r, data.c, opponentColor);
        if (chain > gameState.maxChain) {
          gameState.maxChain = chain;
        }
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(data.r, data.c, opponentColor);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`鈿?瀵规柟宸茶惤瀛?(${data.r},${data.c})锛岃浣犱簡锛乣);

      if (currentGame === 'gobang' && checkGobangWin(data.r, data.c, opponentColor)) {
        gameState.gameOver = true;
        const winMsg = opponentColor === 1 ? '榛戞鑾疯儨锛? : '鐧芥鑾疯儨锛?;
        const winColor = opponentColor === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${opponentColor === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();
      }
    }

    function handleChessMove(data) {
      const fromR = data.fromR;
      const fromC = data.fromC;
      const toR = data.toR;
      const toC = data.toC;
      const color = data.color;
      const pieceType = data.piece;

      // 绉婚櫎琚悆鐨勬瀛愶紝鍚屾椂鏇存柊 chessPieces 鏁版嵁
      const capturedPiece = getChessPieceAt(toR, toC);
      if (capturedPiece) {
        const capturedColor = capturedPiece.dataset.color;
        if (capturedColor === 'red') {
          chessPieces.red = chessPieces.red.filter(p => !(p.r === toR && p.c === toC));
          gameState.blackCount--;
        } else {
          chessPieces.black = chessPieces.black.filter(p => !(p.r === toR && p.c === toC));
          gameState.whiteCount--;
        }
        capturedPiece.remove();
      }

      // 绉诲姩瀵规柟鐨勬瀛愶紝鍚屾椂鏇存柊 chessPieces 鏁版嵁
      const opponentPiece = document.querySelector(`.chess-piece[data-r="${fromR}"][data-c="${fromC}"]`);
      if (opponentPiece) {
        const opponentColor = opponentPiece.dataset.color;
        if (opponentColor === 'red') {
          const idx = chessPieces.red.findIndex(p => p.r === fromR && p.c === fromC);
          if (idx !== -1) {
            chessPieces.red[idx].r = toR;
            chessPieces.red[idx].c = toC;
          }
        } else {
          const idx = chessPieces.black.findIndex(p => p.r === fromR && p.c === fromC);
          if (idx !== -1) {
            chessPieces.black[idx].r = toR;
            chessPieces.black[idx].c = toC;
          }
        }
        opponentPiece.dataset.r = toR;
        opponentPiece.dataset.c = toC;
        opponentPiece.style.top = `${toR * 40 + 20}px`;
        opponentPiece.style.left = `${toC * 40 + 20}px`;
      }

      // 鍚屾 gameState.board
      gameState.board = convertFrontendPiecesToBackend();

      gameState.moveCount++;
      gameState.moveLog.push({
        color: color,
        fromR: fromR,
        fromC: fromC,
        toR: toR,
        toC: toC,
        piece: pieceType,
        isOpponent: true
      });
      gameState.moveTimestamps.push(Date.now());

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(toR, toC, color);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
      });

      updateStatus(`鈿?瀵规柟宸茬Щ鍔?${pieceType} 鍒?(${toR},${toC})锛岃浣犱簡锛乣);

      const winResult = checkChessWin();
      if (winResult) {
        gameState.gameOver = true;
        const isPlayerWin = winResult.winner !== color;
        const winMsg = isPlayerWin ? '浣犺幏鑳滀簡锛? : '浣犺緭浜嗭紒';
        const winColor = winResult.winner === 1 ? '绾㈡柟' : '榛戞柟';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${winResult.winner === 1 ? 'value-red' : 'value-green'}`;
        gameStatusEl.textContent = `娓告垙缁撴潫 - ${winResult.reason}`;
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫 - ${winResult.reason}`);
        updateAdvancedStats();

        if (gameState.difficulty) {
          sendAIGameResult(isPlayerWin ? 'win' : 'loss');
        } else {
          socket.emit('game_result', {
            result: isPlayerWin ? 'win' : 'loss',
            reason: winResult.reason
          });
        }
      } else {
        gameState.turn = 3 - color;
        updateTurnDisplay();
      }
    }

    function sendMessage(data) {
      try {
        socket.emit(data.type, {
          ...data,
          timestamp: data.timestamp || Date.now()
        });
      } catch (e) {
        if (userStatus === 'playing') {
          updateStatus('鉂?娑堟伅鍙戦€佸け璐ワ紝璇峰埛鏂伴〉闈㈤噸璇?);
        } else {
          lobbyStatus.textContent = '鉂?娑堟伅鍙戦€佸け璐ワ紝璇峰埛鏂伴〉闈㈤噸璇?;
        }
      }
    }

    // ========== 璐悆铔囨父鎴忛€昏緫 ==========

    // 璐悆铔囨父鎴忕姸鎬?
    const snakeGameState = {
      snake: [],
      direction: 'right',
      nextDirection: 'right',
      foods: [],           // 澶氫釜椋熺墿鏁扮粍锛堝崟浜烘ā寮忥級
      score: 0,
      highScore: 0,
      gameLoop: null,
      isPaused: false,
      speed: snakeGameConfig.initialSpeed,
      canvas: null,
      ctx: null,
      snakePositions: new Set(), // 鐢ㄤ簬蹇€熺鎾炴娴?
      moveHistory: [], // 鎿嶄綔鍘嗗彶璁板綍
      maxLength: 0, // 铔囩殑鏈€澶ч暱搴?
      foodEaten: 0, // 鍚冨埌鐨勯鐗╂暟閲?
      lastDirection: 'right', // 涓婁竴娆＄殑鏂瑰悜
      lastFood: null, // 涓婁竴娆＄殑椋熺墿浣嶇疆
      lastScore: 0, // 涓婁竴娆＄殑鍒嗘暟
      // 閬撳叿绯荤粺
      activeItems: [],       // 褰撳墠鐢熸晥鐨勯亾鍏峰垪琛?
      itemEffects: {},       // 閬撳叿鏁堟灉鐘舵€?{ type: { remaining, multiplier, etc } }
      resurrectionUsed: false, // 鏈眬鏄惁宸蹭娇鐢ㄥ娲诲崱
      scoreMultiplier: 1,    // 寰楀垎鍊嶇巼
      speedBoostEndTime: 0,  // 鍔犻€熺粨鏉熸椂闂?
      doubleScoreEndTime: 0, // 鍙屽€嶅緱鍒嗙粨鏉熸椂闂?
      isDualMode: false, // 鏄惁涓哄弻浜烘ā寮?
      // 鍙屼汉妯″紡鐘舵€?
      snake2: [],
      direction2: 'left',
      nextDirection2: 'left',
      score2: 0,
      snake2Positions: new Set(),
      foods: [], // 澶氫釜椋熺墿
      gameTimeLeft: 0, // 鍓╀綑鏃堕棿锛堝弻浜烘ā寮忥級
      gameTimer: null, // 娓告垙璁℃椂鍣?
      isRespawning1: false, // 鐜╁1鏄惁姝ｅ湪澶嶆椿
      isRespawning2: false, // 鐜╁2鏄惁姝ｅ湪澶嶆椿
      respawnTimer1: null, // 鐜╁1澶嶆椿璁℃椂鍣?
      respawnTimer2: null // 鐜╁2澶嶆椿璁℃椂鍣?
    };

    // 鍒濆鍖栬椽鍚冭泧娓告垙
    function initSnakeGame() {
      snakeGameState.canvas = document.getElementById('snake-canvas');
      snakeGameState.ctx = snakeGameState.canvas.getContext('2d');

      // 鍔犺浇鏈€楂樺垎
      const savedHighScore = localStorage.getItem('snakeHighScore');
      if (savedHighScore) {
        snakeGameState.highScore = parseInt(savedHighScore);
        document.getElementById('snake-highscore').textContent = snakeGameState.highScore;
      }

      // 鍚屾瀹㈡埛绔湰鍦版渶楂樺垎鍒版湇鍔＄锛堢‘淇濇帓琛屾鏁版嵁鏈€鏂帮級
      if (socket && socket.connected) {
        socket.emit('snake_sync_highscore', {
          highScore: parseInt(localStorage.getItem('snakeHighScore') || '0')
        });
      }

      // 鏄剧ず娓告垙瑙勫垯
      document.getElementById('snake-rules').textContent = snakeGameConfig.rules;

      // 鎭㈠铏氭嫙鎸夐敭鐨勬樉绀虹姸鎬?
      const savedVirt = localStorage.getItem('snakeVirtualControls');
      const virtEl = document.getElementById('snake-virtual-controls');
      if (savedVirt === 'visible' && virtEl) {
        virtEl.style.display = 'flex';
      }

      // 缁戝畾閿洏浜嬩欢
      document.addEventListener('keydown', handleSnakeKeydown);

      renderSnakeGame();
    }

    // 鑾峰彇褰撳墠娓告垙閰嶇疆
    function getSnakeConfig() {
      return snakeGameState.isDualMode ? snakeDualConfig : snakeGameConfig;
    }

    // 寮€濮嬭椽鍚冭泧娓告垙
    function startSnakeGame() {
      if (snakeGameState.gameLoop) return;

      // 璁＄畻椋熺墿鏁伴噺锛堟牴鎹綋鍓嶈泧鏈€澶ч暱搴﹀姩鎬佽皟鏁达級
      const currentConfig = snakeGameConfig;
      const baseFoodCount = currentConfig.initialFoodCount;
      // 鍒嗘暟瓒婇珮椋熺墿瓒婂锛屾渶楂樹笉瓒呰繃maxFoodCount
      const extraFood = Math.min(Math.floor(snakeGameState.highScore / 200), currentConfig.maxFoodCount - baseFoodCount);
      const foodCount = Math.min(baseFoodCount + extraFood, currentConfig.maxFoodCount);

      // 閲嶇疆娓告垙鐘舵€?
      snakeGameState.snake = [{ x: 10, y: 10 }];
      snakeGameState.direction = 'right';
      snakeGameState.nextDirection = 'right';
      snakeGameState.score = 0;
      snakeGameState.isPaused = false;
      snakeGameState.speed = snakeGameConfig.initialSpeed;
      // 鐢熸垚澶氫釜椋熺墿
      snakeGameState.foods = generateSnakeFoods(foodCount);
      snakeGameState.snakePositions.clear();
      snakeGameState.snakePositions.add('10,10');
      snakeGameState.moveHistory = []; // 娓呯┖鎿嶄綔鍘嗗彶
      snakeGameState.maxLength = 1; // 鍒濆闀垮害
      snakeGameState.foodEaten = 0; // 鍒濆椋熺墿鏁伴噺
      snakeGameState.lastDirection = 'right'; // 鍒濆鏂瑰悜
      snakeGameState.lastFood = snakeGameState.foods.length > 0 ? snakeGameState.foods[0] : null; // 鍒濆椋熺墿浣嶇疆
      snakeGameState.lastScore = 0; // 鍒濆鍒嗘暟
      snakeGameState.lastTime = Date.now(); // 鐢ㄤ簬鎺у埗娓告垙閫熷害
      // 閲嶇疆閬撳叿鐘舵€?
      snakeGameState.resurrectionUsed = false;
      snakeGameState.scoreMultiplier = 1;
      snakeGameState.speedBoostEndTime = 0;
      snakeGameState.doubleScoreEndTime = 0;
      snakeGameState.activeItems = [];
      snakeGameState.itemEffects = {};
      // 鍔犺浇鑳屽寘涓殑閬撳叿
      loadSnakeItems();

      // 绂佺敤瑙︽懜榛樿琛屼负锛岄槻姝㈠弻鍑绘斁澶?
      const canvas = document.getElementById('snake-canvas');
      const virtualControls = document.querySelector('.virtual-controls');
      if (canvas) canvas.classList.add('touch-disabled');
      if (virtualControls) virtualControls.classList.add('touch-disabled');

      // 璁板綍鍒濆鐘舵€侊紙浣跨敤绱у噾鏁扮粍琛ㄧず锛?
      snakeGameState.moveHistory.push([
        'init', // 绫诲瀷
        Date.now(), // 鏃堕棿鎴?
        snakeGameState.direction, // 鏂瑰悜
        snakeGameState.snake.map(segment => [segment.x, segment.y]), // 铔囩殑鍒濆浣嶇疆
        snakeGameState.foods.length > 0 ? [snakeGameState.foods[0].x, snakeGameState.foods[0].y] : null, // 鍒濆椋熺墿浣嶇疆
        snakeGameState.score // 鍒嗘暟
      ]);

      // 鏇存柊UI
      updateSnakeScore();
      updateSnakeSpeed();
      updateSnakeFoodCount();

      // 鍚姩娓告垙寰幆
      function gameLoop() {
        if (snakeGameState.isPaused) {
          snakeGameState.gameLoop = requestAnimationFrame(gameLoop);
          return;
        }

        // 鎺у埗娓告垙閫熷害
        const currentTime = Date.now();
        const deltaTime = currentTime - snakeGameState.lastTime;

        // 鍙湁褰撴椂闂村樊瓒呰繃speed鏃舵墠鎵ц娓告垙閫昏緫
        if (deltaTime >= snakeGameState.speed) {
          // 鏇存柊鏂瑰悜
          snakeGameState.direction = snakeGameState.nextDirection;

          // 璁＄畻鏂板ご閮ㄤ綅缃?
          const head = { x: snakeGameState.snake[0].x, y: snakeGameState.snake[0].y };
          switch (snakeGameState.direction) {
            case 'up': head.y--; break;
            case 'down': head.y++; break;
            case 'left': head.x--; break;
            case 'right': head.x++; break;
          }

          // 纰版挒妫€娴?
          if (checkSnakeCollision(head)) {
            // 灏濊瘯浣跨敤澶嶆椿鍗?
            if (tryUseResurrection()) {
              // 澶嶆椿锛氬彇娑堟湰娆＄Щ鍔紝铔囦繚鎸佸師浣?
              console.log('馃悕 浣跨敤澶嶆椿鍗★紝铔囧凡澶嶆椿锛?);
              showToast('鉂わ笍 浣跨敤澶嶆椿鍗★紝铔囧凡澶嶆椿锛?, 'success', 2000);
              // 閲嶇疆铔囩殑浣嶇疆鍒板畨鍏ㄤ綅缃紙鍊掗€€涓€姝ワ級
              snakeGameState.snake = snakeGameState.snake.slice(0, Math.max(1, snakeGameState.snake.length - 1));
              if (snakeGameState.snake.length === 0) {
                snakeGameState.snake = [{ x: 10, y: 10 }];
              }
              snakeGameState.snakePositions.clear();
              snakeGameState.snake.forEach(seg => snakeGameState.snakePositions.add(`${seg.x},${seg.y}`));
              snakeGameState.lastTime = currentTime;
              renderSnakeGame();
              snakeGameState.gameLoop = requestAnimationFrame(gameLoop);
              return;
            }
            console.log('馃悕 璐悆铔囩鎾炴娴?, {
              headPosition: head,
              snakeLength: snakeGameState.snake.length,
              score: snakeGameState.score,
              reason: '澧欏鎴栬嚜韬鎾?
            });
            endSnakeGame();
            return;
          }

          // 绉诲姩铔?
          const tail = snakeGameState.snake[snakeGameState.snake.length - 1];
          snakeGameState.snake.unshift(head);
          snakeGameState.snakePositions.add(`${head.x},${head.y}`);

          // 妫€鏌ラ€熷害澧炵泭鏄惁杩囨湡
          if (snakeGameState.speedBoostEndTime > 0 && Date.now() > snakeGameState.speedBoostEndTime) {
            snakeGameState.speedBoostEndTime = 0;
            snakeGameState.speed = snakeGameConfig.initialSpeed - Math.min(Math.floor(snakeGameState.score / 100) * 10, 90);
            updateSnakeSpeed();
            showToast('鈿?鍔犻€熸晥鏋滃凡缁撴潫', 'info', 1500);
          }

          // 妫€鏌ュ弻鍊嶅緱鍒嗘槸鍚﹁繃鏈?
          if (snakeGameState.doubleScoreEndTime > 0 && Date.now() > snakeGameState.doubleScoreEndTime) {
            snakeGameState.doubleScoreEndTime = 0;
            snakeGameState.scoreMultiplier = 1;
            showToast('鉁栵笍2 鍙屽€嶅緱鍒嗘晥鏋滃凡缁撴潫', 'info', 1500);
          }

          // 妫€鏌ユ槸鍚﹀悆鍒伴鐗╋紙閬嶅巻鎵€鏈夐鐗╋級
          let ateFood = false;
          let foodIndex = -1;
          let oldFood = null;

          for (let i = 0; i < snakeGameState.foods.length; i++) {
            if (head.x === snakeGameState.foods[i].x && head.y === snakeGameState.foods[i].y) {
              ateFood = true;
              foodIndex = i;
              oldFood = snakeGameState.foods[i];
              break;
            }
          }

          if (ateFood) {
            // 绉婚櫎琚悆鎺夌殑椋熺墿
            snakeGameState.foods.splice(foodIndex, 1);

            // 璁＄畻寰楀垎锛堣€冭檻鍙屽€嶆晥鏋滐級
            const baseScore = snakeGameConfig.foodScore;
            const finalScore = baseScore * snakeGameState.scoreMultiplier;
            snakeGameState.score += finalScore;
            snakeGameState.foodEaten += 1;
            updateSnakeScore();

            // 鐢熸垚鏂伴鐗╋紙淇濇寔椋熺墿鏁伴噺鍦ㄥ悎鐞嗚寖鍥村唴锛?
            const currentFoodCount = snakeGameState.foods.length;
            const targetFoodCount = Math.min(
              snakeGameConfig.initialFoodCount + Math.min(Math.floor(snakeGameState.score / 200), snakeGameConfig.maxFoodCount - snakeGameConfig.initialFoodCount),
              snakeGameConfig.maxFoodCount
            );
            if (currentFoodCount < targetFoodCount) {
              const newFood = generateSnakeFood();
              if (newFood) snakeGameState.foods.push(newFood);
            }

            // 鏇存柊铔囩殑鏈€澶ч暱搴?
            if (snakeGameState.snake.length > snakeGameState.maxLength) {
              snakeGameState.maxLength = snakeGameState.snake.length;
            }

            console.log('馃悕 璐悆铔囧悆鍒伴鐗?, {
              position: oldFood,
              score: snakeGameState.score,
              foodEaten: snakeGameState.foodEaten,
              maxLength: snakeGameState.maxLength,
              snakeLength: snakeGameState.snake.length,
              multiplier: snakeGameState.scoreMultiplier,
              foodsRemaining: snakeGameState.foods.length
            });

            // 鍔犻€燂紙姣?00鍒嗗姞閫熶竴娆★級
            if (snakeGameState.score % 100 === 0 && snakeGameState.speed > 50) {
              snakeGameState.speed -= 10;
              updateSnakeSpeed();
              console.log('馃悕 璐悆铔囧姞閫?, {
                newSpeed: snakeGameState.speed,
                score: snakeGameState.score
              });
            }
          } else {
            snakeGameState.snake.pop();
            snakeGameState.snakePositions.delete(`${tail.x},${tail.y}`);
          }

          // 璁板綍鎵€鏈夋楠わ紙浣跨敤瓒呯揣鍑戞牸寮忥級
          const moveRecord = [
            snakeGameState.direction, // 鏂瑰悜锛?瀛楃锛?
            head.x, // 澶撮儴x鍧愭爣锛堟暟瀛楋級
            head.y, // 澶撮儴y鍧愭爣锛堟暟瀛楋級
            ateFood ? 1 : 0 // 鏄惁鍚冨埌椋熺墿锛?/1锛?
          ];

          // 鍙湪鍚冨埌椋熺墿鏃舵坊鍔犳墍鏈夐鐗╃殑鍧愭爣淇℃伅
          if (ateFood) {
            moveRecord.push(snakeGameState.foods.length);
            snakeGameState.foods.forEach(f => moveRecord.push(f.x, f.y));
          }

          snakeGameState.moveHistory.push(moveRecord);

          // 鏇存柊lastTime锛岀‘淇濇父鎴忛€熷害绋冲畾
          snakeGameState.lastTime = currentTime;
        }

        // 姣忔requestAnimationFrame閮芥覆鏌擄紝淇濊瘉鍔ㄧ敾娴佺晠
        renderSnakeGame();
        snakeGameState.gameLoop = requestAnimationFrame(gameLoop);
      }

      snakeGameState.gameLoop = requestAnimationFrame(gameLoop);

      console.log('馃悕 璐悆铔囨父鎴忓紑濮?, {
        initialSpeed: snakeGameState.speed,
        initialDirection: snakeGameState.direction,
        initialPosition: snakeGameState.snake[0],
        foodPosition: snakeGameState.food
      });

      // 鍙戦€佹父鎴忓紑濮嬩簨浠跺埌鏈嶅姟鍣?
      if (socket && socket.connected) {
        socket.emit('snake_game_start', {
          gameType: 'snake'
        });
        console.log('馃悕 鍙戦€佽椽鍚冭泧娓告垙寮€濮嬩簨浠跺埌鏈嶅姟鍣?);
      }

      updateStatus('馃幃 璐悆铔囨父鎴忓紑濮嬶紒');
    }

    // 寮€濮嬪弻浜烘ā寮忚椽鍚冭泧娓告垙锛堝尮閰嶆ā寮忥級
    function startSnakeDualGame() {
      if (!socket || !socket.connected) {
        alert('璇峰厛鐧诲綍锛?);
        return;
      }

      // 鍙戦€佸尮閰嶈姹傦紙浣跨敤缁熶竴鐨勫尮閰嶇郴缁燂級
      socket.emit('match_request', {
        game: 'snake'
      });

      // 鏄剧ず鍖归厤绛夊緟鐣岄潰
      showSnakeMatchWaiting();
    }

    // 鏄剧ず鍖归厤绛夊緟鐣岄潰
    function showSnakeMatchWaiting() {
      const container = document.getElementById('snake-game-container');
      container.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 20px;">馃攳</div>
          <div style="font-size: 24px; font-weight: bold; color: #2d3748; margin-bottom: 10px;">
            姝ｅ湪瀵绘壘瀵规墜...
          </div>
          <div style="font-size: 16px; color: #718096; margin-bottom: 30px;">
            璇风◢鍊欙紝绯荤粺姝ｅ湪涓烘偍鍖归厤瀵规墜
          </div>
          <div style="width: 60px; height: 60px; margin: 0 auto; border: 4px solid #e2e8f0; border-top-color: #4299e1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <button onclick="cancelSnakeMatch()" style="margin-top: 30px; padding: 12px 24px; background: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">
            鍙栨秷鍖归厤
          </button>
        </div>
        <style>
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      `;
    }

    // 鍙栨秷鍖归厤
    function cancelSnakeMatch() {
      if (socket && socket.connected) {
        socket.emit('cancel_match');
      }
      // 鎭㈠璐悆铔囩晫闈?
      showSnakeGameInterface();
    }

    // 鏄剧ず璐悆铔囨父鎴忕晫闈?
    function showSnakeGameInterface() {
      const container = document.getElementById('snake-game-container');
      container.innerHTML = `
        <div class="game-info">
          <div class="info-item">
            <span class="info-label">鍒嗘暟锛?/span>
            <span class="info-value" id="snake-score">0</span>
          </div>
          <div class="info-item">
            <span class="info-label">鏈€楂樺垎锛?/span>
            <span class="info-value" id="snake-highscore">0</span>
          </div>
          <div class="info-item">
            <span class="info-label">閫熷害锛?/span>
            <span class="info-value" id="snake-speed">150</span>
          </div>
          <div class="info-item">
            <span class="info-label">鈴憋笍 鏃堕棿锛?/span>
            <span class="info-value" id="snake-time">2:00</span>
          </div>
          <div class="info-item">
            <span class="info-label">馃崕 椋熺墿锛?/span>
            <span class="info-value" id="snake-food-count">0</span>
          </div>
        </div>
        <canvas id="snake-canvas" width="400" height="400"></canvas>

        <!-- 閬撳叿鏍?-->
        <div class="snake-item-bar" id="snake-item-bar" style="display: none; margin: 10px auto; padding: 8px 12px; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 500px; border: 1px solid #e9ecef;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 14px; font-weight: 600; color: #495057;">馃帓 閬撳叿</span>
            <span style="font-size: 12px; color: #6c757d;">鍙屽嚮浣跨敤</span>
          </div>
          <div id="snake-item-list" style="display: flex; gap: 8px; flex-wrap: wrap; min-height: 36px;"></div>
        </div>

        <!-- 铏氭嫙鎸夐敭 -->
        <div class="virtual-controls" id="snake-virtual-controls"
          style="display: none; flex-direction: column; align-items: center; margin-top: 30px;">
          <div class="virtual-btn up-btn" onclick="handleVirtualKey('up')"
            style="width: 80px; height: 80px; background: #4ecdc4; border: none; border-radius: 15px; color: white; font-size: 32px; margin-bottom: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);">
            鈫?/div>
          <div style="display: flex; gap: 15px;">
            <div class="virtual-btn left-btn" onclick="handleVirtualKey('left')"
              style="width: 80px; height: 80px; background: #4ecdc4; border: none; border-radius: 15px; color: white; font-size: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);">
              鈫?/div>
            <div class="virtual-btn down-btn" onclick="handleVirtualKey('down')"
              style="width: 80px; height: 80px; background: #4ecdc4; border: none; border-radius: 15px; color: white; font-size: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);">
              鈫?/div>
            <div class="virtual-btn right-btn" onclick="handleVirtualKey('right')"
              style="width: 80px; height: 80px; background: #4ecdc4; border: none; border-radius: 15px; color: white; font-size: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);">
              鈫?/div>
          </div>
        </div>

        <div class="game-rules">
          <div class="rules-title">馃摐 娓告垙瑙勫垯</div>
          <div class="rules-content" id="snake-rules"></div>
        </div>
        <div class="game-controls">
          <button class="lobby-btn" id="snake-start" onclick="startSnakeGame()">馃幃 鍗曚汉妯″紡</button>
          <button class="lobby-btn" id="snake-dual" onclick="startSnakeDualGame()" style="background: #667eea;">馃悕馃悕 鍙屼汉妯″紡</button>
          <button class="lobby-btn" id="snake-restart" onclick="restartSnakeGame()">馃攧 閲嶆柊寮€濮?/button>
          <button class="lobby-btn" id="snake-virt-btn" onclick="toggleVirtualControls()" style="background: #9b59b6;">馃暪锔?鎸夐敭</button>
          <button class="lobby-btn" id="snake-quit" onclick="quitSnakeGame()" style="background: #e74c3c;">馃毆 閫€鍑?/button>
        </div>
      `;

      // 閲嶆柊鍒濆鍖栫敾甯?
      snakeGameState.canvas = document.getElementById('snake-canvas');
      snakeGameState.ctx = snakeGameState.canvas.getContext('2d');
      renderSnakeGame();

      // 鎭㈠铏氭嫙鎸夐敭鐨勬樉绀虹姸鎬?
      const savedVirt = localStorage.getItem('snakeVirtualControls');
      if (savedVirt === 'visible') {
        const virtEl = document.getElementById('snake-virtual-controls');
        if (virtEl) {
          virtEl.style.display = 'flex';
        }
      }
    }

    // 鍒囨崲铏氭嫙鎸夐敭鏄剧ず/闅愯棌
    function toggleVirtualControls() {
      const virtEl = document.getElementById('snake-virtual-controls');
      if (!virtEl) return;
      if (virtEl.style.display === 'none' || virtEl.style.display === '') {
        virtEl.style.display = 'flex';
        localStorage.setItem('snakeVirtualControls', 'visible');
      } else {
        virtEl.style.display = 'none';
        localStorage.setItem('snakeVirtualControls', 'hidden');
      }
    }

    // 寮€濮嬪尮閰嶅悗鐨勫弻浜烘父鎴?
    function startMatchedSnakeGame(gameData) {
      // 璁剧疆涓哄弻浜烘ā寮?
      snakeGameState.isDualMode = true;
      snakeGameState.matchId = gameData.matchId;
      snakeGameState.playerId = gameData.playerId;

      // 璋冩暣鐢诲竷澶у皬
      const config = snakeDualConfig;
      const canvas = document.getElementById('snake-canvas');
      canvas.width = config.canvasWidth;
      canvas.height = config.canvasHeight;

      // 閲嶇疆娓告垙鐘舵€?
      snakeGameState.snake = gameData.snake || [{ x: 5, y: Math.floor(config.gridSize / 2) }];
      snakeGameState.direction = 'right';
      snakeGameState.nextDirection = 'right';
      snakeGameState.score = 0;

      // 纭繚snake2濮嬬粓鏄湁鏁堢殑鏁扮粍
      if (gameData.opponentSnake && Array.isArray(gameData.opponentSnake) && gameData.opponentSnake.length > 0) {
        snakeGameState.snake2 = gameData.opponentSnake;
      } else {
        snakeGameState.snake2 = [{ x: config.gridSize - 6, y: Math.floor(config.gridSize / 2) }];
      }
      snakeGameState.direction2 = 'left';
      // 瀵规墜鏂瑰悜锛堜粎鐢ㄤ簬鏄剧ず锛?
      snakeGameState.score2 = 0;

      snakeGameState.isPaused = false;
      snakeGameState.speed = config.initialSpeed;
      snakeGameState.gameTimeLeft = config.gameDuration;

      // 鐢熸垚澶氫釜椋熺墿
      snakeGameState.foods = gameData.foods || [];
      snakeGameState.snakePositions = new Set();
      snakeGameState.snake2Positions = new Set();
      snakeGameState.snakePositions.add(`${snakeGameState.snake[0].x},${snakeGameState.snake[0].y}`);
      snakeGameState.snake2Positions.add(`${snakeGameState.snake2[0].x},${snakeGameState.snake2[0].y}`);

      snakeGameState.isRespawning1 = false;
      snakeGameState.isRespawning2 = false;

      // 鏇存柊UI
      updateDualSnakeScore();
      updateDualGameTime();
      document.getElementById('snake-rules').textContent = config.rules;

      // 鍖归厤妯″紡闅愯棌鏆傚仠鍜岄噸鏂板紑濮嬫寜閽紝淇濈暀閫€鍑烘寜閽?
      const pauseBtn = document.getElementById('snake-pause');
      const restartBtn = document.getElementById('snake-restart');
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (restartBtn) restartBtn.style.display = 'none';

      // 鍚姩娓告垙璁℃椂鍣?
      snakeGameState.gameTimer = setInterval(() => {
        snakeGameState.gameTimeLeft--;
        updateDualGameTime();

        if (snakeGameState.gameTimeLeft <= 0) {
          endDualSnakeGame();
        }
      }, 1000);

      // 鍚姩娓告垙寰幆
      function gameLoop() {
        if (snakeGameState.isPaused) {
          snakeGameState.gameLoop = requestAnimationFrame(gameLoop);
          return;
        }

        const currentTime = Date.now();
        const deltaTime = currentTime - snakeGameState.lastTime;

        if (deltaTime >= snakeGameState.speed) {
          // 鍙洿鏂拌嚜宸辩殑铔?
          if (!snakeGameState.isRespawning1) {
            updateSnakePlayer(1);
            // 鍙戦€佹洿鏂板埌鏈嶅姟鍣?
            sendSnakeUpdate();
          }

          snakeGameState.lastTime = currentTime;
        }

        renderDualSnakeGame();
        snakeGameState.gameLoop = requestAnimationFrame(gameLoop);
      }

      snakeGameState.lastTime = Date.now();
      snakeGameState.gameLoop = requestAnimationFrame(gameLoop);

      console.log('馃悕馃悕 鍖归厤鎴愬姛锛屽弻浜鸿椽鍚冭泧娓告垙寮€濮?);
      updateStatus('馃幃 鍖归厤鎴愬姛锛佸弻浜鸿椽鍚冭泧娓告垙寮€濮嬶紒');
    }

    // 鍙戦€佽泧鐨勬洿鏂板埌鏈嶅姟鍣?
    function sendSnakeUpdate() {
      if (!socket || !socket.connected || !snakeGameState.matchId) return;

      socket.emit('snake_update', {
        matchId: snakeGameState.matchId,
        playerId: snakeGameState.playerId,
        snake: snakeGameState.snake,
        direction: snakeGameState.direction,
        score: snakeGameState.score,
        foods: snakeGameState.foods,
        gameTimeLeft: snakeGameState.gameTimeLeft
      });
    }

    // 澶勭悊瀵规墜鐨勬洿鏂?
    function handleOpponentUpdate(data) {
      console.log('鏀跺埌瀵规墜鏇存柊:', data);

      snakeGameState.snake2 = data.snake;
      snakeGameState.score2 = data.score;

      // 鍚屾椋熺墿鍜屾椂闂?
      if (data.foods) {
        console.log('鍚屾椋熺墿鐘舵€?', data.foods);
        snakeGameState.foods = data.foods;
      }
      if (data.gameTimeLeft !== undefined) {
        console.log('鍚屾娓告垙鏃堕棿:', data.gameTimeLeft);
        snakeGameState.gameTimeLeft = data.gameTimeLeft;
      }

      updateDualSnakeScore();
      updateDualGameTime();
    }

    // 鏇存柊鍗曚釜鐜╁铔囩殑閫昏緫
    function updateSnakePlayer(player) {
      const config = snakeDualConfig;
      const state = snakeGameState;
      const isPlayer1 = player === 1;

      // 鑾峰彇鐜╁鐘舵€?
      const snake = isPlayer1 ? state.snake : state.snake2;
      const positions = isPlayer1 ? state.snakePositions : state.snake2Positions;
      let direction = isPlayer1 ? state.direction : state.direction2;
      const nextDirection = isPlayer1 ? state.nextDirection : state.nextDirection2;

      // 纭繚铔囩姸鎬佹湁鏁?
      if (!snake || !Array.isArray(snake) || snake.length === 0) {
        console.error(`鐜╁${player}鐨勮泧鐘舵€佹棤鏁?`, snake);
        // 鍒濆鍖栭粯璁よ泧鐘舵€?
        const defaultSnake = isPlayer1 ?
          [{ x: 5, y: Math.floor(config.gridSize / 2) }] :
          [{ x: config.gridSize - 6, y: Math.floor(config.gridSize / 2) }];

        if (isPlayer1) {
          state.snake = defaultSnake;
        } else {
          state.snake2 = defaultSnake;
        }
        return;
      }

      // 纭繚鏂瑰悜鏈夋晥
      const validDirections = ['up', 'down', 'left', 'right'];
      if (!validDirections.includes(direction)) {
        direction = isPlayer1 ? 'right' : 'left';
      }
      if (!validDirections.includes(nextDirection)) {
        nextDirection = direction;
      }

      // 鏇存柊鏂瑰悜
      direction = nextDirection;
      if (isPlayer1) {
        state.direction = direction;
      } else {
        state.direction2 = direction;
      }

      // 璁＄畻鏂板ご閮ㄤ綅缃?
      const head = { x: snake[0].x, y: snake[0].y };
      switch (direction) {
        case 'up': head.y--; break;
        case 'down': head.y++; break;
        case 'left': head.x--; break;
        case 'right': head.x++; break;
      }

      // 纰版挒妫€娴?
      if (checkDualCollision(head, player)) {
        respawnPlayer(player);
        return;
      }

      // 绉诲姩铔?
      const tail = snake[snake.length - 1];
      snake.unshift(head);
      positions.add(`${head.x},${head.y}`);

      // 妫€鏌ユ槸鍚﹀悆鍒伴鐗?
      let ateFood = false;
      const foodIndex = state.foods.findIndex(f => f.x === head.x && f.y === head.y);

      if (foodIndex !== -1) {
        ateFood = true;
        state.foods.splice(foodIndex, 1);
        const newFood = generateDualFood();
        state.foods.push(newFood);

        // 鍙戦€侀鐗╂洿鏂板埌鏈嶅姟鍣?
        if (socket && socket.connected && state.matchId) {
          socket.emit('snake_food_update', {
            matchId: state.matchId,
            playerId: state.playerId,
            foods: state.foods
          });
        }

        if (isPlayer1) {
          state.score += 10;
        } else {
          state.score2 += 10;
        }
        updateDualSnakeScore();
      } else {
        snake.pop();
        positions.delete(`${tail.x},${tail.y}`);
      }
    }

    // 鍙屼汉妯″紡纰版挒妫€娴?
    function checkDualCollision(head, player) {
      const config = snakeDualConfig;
      const state = snakeGameState;

      // 澧欏纰版挒
      if (head.x < 0 || head.x >= config.gridSize ||
        head.y < 0 || head.y >= config.gridSize) {
        return true;
      }

      // 鑷韩纰版挒
      const selfPositions = player === 1 ? state.snakePositions : state.snake2Positions;
      if (selfPositions.has(`${head.x},${head.y}`)) {
        return true;
      }

      // 鎾炲埌瀵规柟铔?
      const otherPositions = player === 1 ? state.snake2Positions : state.snakePositions;
      if (otherPositions.has(`${head.x},${head.y}`)) {
        return true;
      }

      return false;
    }

    // 鐜╁澶嶆椿
    function respawnPlayer(player) {
      const config = snakeDualConfig;
      const state = snakeGameState;
      const isPlayer1 = player === 1;

      if (isPlayer1) {
        state.isRespawning1 = true;
        state.snake = [];
        state.snakePositions.clear();
      } else {
        state.isRespawning2 = true;
        state.snake2 = [];
        state.snake2Positions.clear();
      }

      setTimeout(() => {
        if (!state.gameLoop) return;

        if (isPlayer1) {
          state.snake = [{ x: 5, y: Math.floor(config.gridSize / 2) }];
          state.direction = 'right';
          state.nextDirection = 'right';
          state.snakePositions.add(`${state.snake[0].x},${state.snake[0].y}`);
          state.isRespawning1 = false;
        } else {
          state.snake2 = [{ x: config.gridSize - 6, y: Math.floor(config.gridSize / 2) }];
          state.direction2 = 'left';
          state.nextDirection2 = 'left';
          state.snake2Positions.add(`${state.snake2[0].x},${state.snake2[0].y}`);
          state.isRespawning2 = false;
        }
      }, config.respawnDelay);
    }

    // 鐢熸垚鍙屼汉妯″紡椋熺墿
    function generateDualFood() {
      const config = snakeDualConfig;
      let food;
      do {
        food = {
          x: Math.floor(Math.random() * config.gridSize),
          y: Math.floor(Math.random() * config.gridSize)
        };
      } while (snakeGameState.snakePositions.has(`${food.x},${food.y}`) ||
        snakeGameState.snake2Positions.has(`${food.x},${food.y}`));
      return food;
    }

    // 缁撴潫鍙屼汉妯″紡娓告垙
    function endDualSnakeGame() {
      // 鍋滄娓告垙寰幆
      if (snakeGameState.gameLoop) {
        cancelAnimationFrame(snakeGameState.gameLoop);
        snakeGameState.gameLoop = null;
      }

      // 鍋滄璁℃椂鍣?
      if (snakeGameState.gameTimer) {
        clearInterval(snakeGameState.gameTimer);
        snakeGameState.gameTimer = null;
      }

      // 鍒ゅ畾鑳滆礋
      let result;
      if (snakeGameState.score > snakeGameState.score2) {
        result = '鐜╁1鑾疯儨锛?;
      } else if (snakeGameState.score2 > snakeGameState.score) {
        result = '鐜╁2鑾疯儨锛?;
      } else {
        result = '骞冲眬锛?;
      }

      updateStatus(`鈴?娓告垙缁撴潫锛?{result} 鐜╁1: ${snakeGameState.score}鍒? 鐜╁2: ${snakeGameState.score2}鍒哷);
      showToast(`娓告垙缁撴潫锛?{result} 鐜╁1: ${snakeGameState.score}鍒? 鐜╁2: ${snakeGameState.score2}鍒哷, 'info', 5000);

      // 閲嶇疆涓哄崟浜烘ā寮忛厤缃?
      resetSnakeCanvas();

      // 鎭㈠娓告垙鐣岄潰锛堥殣钘忔殏鍋?閲嶆柊寮€濮嬫寜閽紝鏄剧ず鍖归厤/鍗曚汉鎸夐挳锛?
      showSnakeGameInterface();

      // 鍛婅瘔鏈嶅姟绔繑鍥炲ぇ鍘?
      if (socket && socket.connected) {
        socket.emit('return_lobby');
      }
    }

    // 閲嶇疆鐢诲竷涓哄崟浜烘ā寮?
    function resetSnakeCanvas() {
      snakeGameState.isDualMode = false;
      const canvas = document.getElementById('snake-canvas');
      canvas.width = snakeGameConfig.canvasWidth;
      canvas.height = snakeGameConfig.canvasHeight;
      document.getElementById('snake-rules').textContent = snakeGameConfig.rules;
    }

    // 璐悆铔囨父鎴忓惊鐜紙宸叉暣鍚堝埌startSnakeGame鍑芥暟涓級
    function snakeGameLoop() {
      // 宸叉暣鍚堝埌startSnakeGame鍑芥暟涓?
    }

    // 纰版挒妫€娴?
    function checkSnakeCollision(head) {
      const config = getSnakeConfig();
      // 澧欏纰版挒
      if (head.x < 0 || head.x >= config.gridSize ||
        head.y < 0 || head.y >= config.gridSize) {
        return true;
      }

      // 鑷韩纰版挒锛堜娇鐢⊿et蹇€熸娴嬶級
      return snakeGameState.snakePositions.has(`${head.x},${head.y}`);
    }

    // 鐢熸垚澶氫釜椋熺墿
    function generateSnakeFoods(count) {
      const foods = [];
      for (let i = 0; i < count; i++) {
        const food = generateSnakeFood();
        if (food) foods.push(food);
      }
      return foods;
    }

    // 鐢熸垚鍗曚釜椋熺墿
    function generateSnakeFood() {
      let food;
      let attempts = 0;
      do {
        food = {
          x: Math.floor(Math.random() * snakeGameConfig.gridSize),
          y: Math.floor(Math.random() * snakeGameConfig.gridSize)
        };
        attempts++;
        if (attempts > 500) return null; // 闃叉姝诲惊鐜?
      } while (snakeGameState.snakePositions.has(`${food.x},${food.y}`) ||
        snakeGameState.foods.some(f => f.x === food.x && f.y === food.y));

      return food;
    }

    // 娓叉煋璐悆铔囨父鎴?
    function renderSnakeGame() {
      const ctx = snakeGameState.ctx;
      const cellSize = snakeGameConfig.cellSize;
      const gridSize = snakeGameConfig.gridSize;
      const canvasWidth = snakeGameState.canvas.width;
      const canvasHeight = snakeGameState.canvas.height;

      // 娓呯┖鐢诲竷
      ctx.fillStyle = snakeGameConfig.colors.background;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 缁樺埗缃戞牸
      ctx.strokeStyle = snakeGameConfig.colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 0; i <= gridSize; i++) {
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvasHeight);
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvasWidth, i * cellSize);
      }
      ctx.stroke();

      // 缁樺埗澶氫釜椋熺墿
      const fr = cellSize / 2 - 2;
      snakeGameState.foods.forEach((food, index) => {
        const fx = food.x * cellSize + cellSize / 2;
        const fy = food.y * cellSize + cellSize / 2;
        // 浜ゆ浛棰滆壊澧炲姞杈ㄨ瘑搴?
        ctx.fillStyle = index % 2 === 0 ? snakeGameConfig.colors.food : snakeGameConfig.colors.foodSpecial;
        ctx.beginPath();
        ctx.arc(fx, fy, fr, 0, Math.PI * 2);
        ctx.fill();
      });

      // 缁樺埗铔?- 浣跨敤璺緞鎵归噺缁樺埗
      const snakeHeadColor = snakeGameConfig.colors.snakeHead;
      const snakeBodyColor = snakeGameConfig.colors.snakeBody;
      const rectSize = cellSize - 2;
      const offset = 1;

      // 鎵归噺缁樺埗铔囪韩
      if (snakeGameState.snake.length > 1) {
        ctx.fillStyle = snakeBodyColor;
        ctx.beginPath();
        for (let i = 1; i < snakeGameState.snake.length; i++) {
          const segment = snakeGameState.snake[i];
          ctx.rect(segment.x * cellSize + offset, segment.y * cellSize + offset, rectSize, rectSize);
        }
        ctx.fill();
      }

      // 缁樺埗铔囧ご
      if (snakeGameState.snake.length > 0) {
        const head = snakeGameState.snake[0];
        ctx.fillStyle = snakeHeadColor;
        ctx.fillRect(head.x * cellSize + offset, head.y * cellSize + offset, rectSize, rectSize);
      }
    }

    // 鍙屼汉妯″紡娓叉煋
    function renderDualSnakeGame() {
      const ctx = snakeGameState.ctx;
      const config = snakeDualConfig;
      const cellSize = config.cellSize;
      const gridSize = config.gridSize;
      const canvasWidth = snakeGameState.canvas.width;
      const canvasHeight = snakeGameState.canvas.height;

      // 娓呯┖鐢诲竷
      ctx.fillStyle = config.colors.background;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 缁樺埗缃戞牸
      ctx.strokeStyle = config.colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 0; i <= gridSize; i++) {
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvasHeight);
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvasWidth, i * cellSize);
      }
      ctx.stroke();

      // 缁樺埗澶氫釜椋熺墿
      ctx.fillStyle = config.colors.food;
      ctx.beginPath();
      snakeGameState.foods.forEach(food => {
        const fx = food.x * cellSize + cellSize / 2;
        const fy = food.y * cellSize + cellSize / 2;
        const fr = cellSize / 2 - 2;
        ctx.moveTo(fx + fr, fy);
        ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      });
      ctx.fill();

      // 缁樺埗鐜╁1鐨勮泧
      const rectSize = cellSize - 2;
      const offset = 1;

      // 鐜╁1铔囪韩
      if (snakeGameState.snake.length > 1) {
        ctx.fillStyle = config.colors.snake1Body;
        ctx.beginPath();
        for (let i = 1; i < snakeGameState.snake.length; i++) {
          const segment = snakeGameState.snake[i];
          ctx.rect(segment.x * cellSize + offset, segment.y * cellSize + offset, rectSize, rectSize);
        }
        ctx.fill();
      }

      // 鐜╁1铔囧ご
      if (snakeGameState.snake.length > 0) {
        const head = snakeGameState.snake[0];
        ctx.fillStyle = config.colors.snake1Head;
        ctx.fillRect(head.x * cellSize + offset, head.y * cellSize + offset, rectSize, rectSize);
      }

      // 缁樺埗鐜╁2鐨勮泧
      if (snakeGameState.snake2 && Array.isArray(snakeGameState.snake2)) {
        // 鐜╁2铔囪韩
        if (snakeGameState.snake2.length > 1) {
          ctx.fillStyle = config.colors.snake2Body;
          ctx.beginPath();
          for (let i = 1; i < snakeGameState.snake2.length; i++) {
            const segment = snakeGameState.snake2[i];
            ctx.rect(segment.x * cellSize + offset, segment.y * cellSize + offset, rectSize, rectSize);
          }
          ctx.fill();
        }

        // 鐜╁2铔囧ご
        if (snakeGameState.snake2.length > 0) {
          const head = snakeGameState.snake2[0];
          ctx.fillStyle = config.colors.snake2Head;
          ctx.fillRect(head.x * cellSize + offset, head.y * cellSize + offset, rectSize, rectSize);
        }
      }
    }

    // 鏇存柊鍙屼汉妯″紡鍒嗘暟鏄剧ず
    function updateDualSnakeScore() {
      const scoreElement = document.getElementById('snake-score');
      if (scoreElement) {
        scoreElement.innerHTML = `
          <div style="display: flex; justify-content: space-around; gap: 20px;">
            <div style="text-align: center;">
              <div style="font-size: 14px; color: #6c757d; margin-bottom: 4px;">鐜╁1 馃數</div>
              <div style="font-size: 20px; font-weight: 700; color: #4ecdc4;">${snakeGameState.score}</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 14px; color: #6c757d; margin-bottom: 4px;">鐜╁2 馃敶</div>
              <div style="font-size: 20px; font-weight: 700; color: #ff6b6b;">${snakeGameState.score2}</div>
            </div>
          </div>
        `;
      }
    }

    // 鏇存柊鍙屼汉妯″紡娓告垙鏃堕棿
    function updateDualGameTime() {
      const timeElement = document.getElementById('snake-time');
      if (timeElement) {
        const minutes = Math.floor(snakeGameState.gameTimeLeft / 60);
        const seconds = snakeGameState.gameTimeLeft % 60;
        timeElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    // 閿洏鎺у埗
    function handleSnakeKeydown(e) {
      // 鍗曚汉妯″紡鍜屽湪绾垮弻浜烘ā寮忛兘浣跨敤鐩稿悓鐨勬帶鍒?
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          if (snakeGameState.direction !== 'down') {
            snakeGameState.nextDirection = 'up';
          }
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          if (snakeGameState.direction !== 'up') {
            snakeGameState.nextDirection = 'down';
          }
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (snakeGameState.direction !== 'right') {
            snakeGameState.nextDirection = 'left';
          }
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (snakeGameState.direction !== 'left') {
            snakeGameState.nextDirection = 'right';
          }
          break;
      }

      e.preventDefault();
    }

    // 铏氭嫙鎸夐敭鎺у埗
    function handleVirtualKey(direction) {
      switch (direction) {
        case 'up':
          if (snakeGameState.direction !== 'down') {
            snakeGameState.nextDirection = 'up';
          }
          break;
        case 'down':
          if (snakeGameState.direction !== 'up') {
            snakeGameState.nextDirection = 'down';
          }
          break;
        case 'left':
          if (snakeGameState.direction !== 'right') {
            snakeGameState.nextDirection = 'left';
          }
          break;
        case 'right':
          if (snakeGameState.direction !== 'left') {
            snakeGameState.nextDirection = 'right';
          }
          break;
      }
    }

    // 鏇存柊鍒嗘暟
    function updateSnakeScore() {
      document.getElementById('snake-score').textContent = snakeGameState.score;
      updateSnakeFoodCount();

      if (snakeGameState.score > snakeGameState.highScore) {
        snakeGameState.highScore = snakeGameState.score;
        document.getElementById('snake-highscore').textContent = snakeGameState.highScore;
        localStorage.setItem('snakeHighScore', snakeGameState.highScore);
      }
    }

    // 鏇存柊椋熺墿鏁伴噺鏄剧ず
    function updateSnakeFoodCount() {
      const el = document.getElementById('snake-food-count');
      if (el) {
        el.textContent = snakeGameState.foods ? snakeGameState.foods.length : 0;
      }
    }

    // 鏇存柊閫熷害鏄剧ず
    function updateSnakeSpeed() {
      document.getElementById('snake-speed').textContent = snakeGameState.speed;
    }

    // ========== 璐悆铔囬亾鍏风郴缁?==========

    // 閬撳叿閰嶇疆
    const SNAKE_ITEM_TYPES = {
      'item_snake_revive': { id: 'item_snake_revive', name: '澶嶆椿鍗?, icon: '鉂わ笍', desc: '鎾炲鎴栨挒韬悗鍙師鍦板娲讳竴娆?, type: 'revive', price: 100 },
      'item_snake_speed': { id: 'item_snake_speed', name: '鍔犻€熷崱', icon: '鈿?, desc: '10绉掑唴绉诲姩閫熷害缈诲€?, type: 'speed', price: 80 },
      'item_snake_double': { id: 'item_snake_double', name: '鍙屽€嶅崱', icon: '鉁栵笍2', desc: '15绉掑唴寰楀垎缈诲€?, type: 'double', price: 120 },
      'item_snake_shrink': { id: 'item_snake_shrink', name: '缂╃煭鍗?, icon: '馃斀', desc: '韬綋缂╃煭3鑺?, type: 'shrink', price: 60 }
    };

    // 鐜╁鑳屽寘涓殑璐悆铔囬亾鍏?
    let snakeInventory = {};

    // 浠巐ocalStorage鍔犺浇閬撳叿锛堝苟灏濊瘯浠庢湇鍔″櫒鍚屾锛?
    function loadSnakeItems() {
      try {
        const saved = localStorage.getItem('snakeItemInventory');
        snakeInventory = saved ? JSON.parse(saved) : {};
      } catch (e) {
        snakeInventory = {};
      }
      // 灏濊瘯浠庢湇鍔″櫒鍚屾閬撳叿
      syncServerSnakeItems();
      updateSnakeItemBar();
    }

    // 浠庢湇鍔″櫒鍚屾璐悆铔囬亾鍏?
    async function syncServerSnakeItems() {
      try {
        const userId = localStorage.getItem('gameUserId') || 'guest';
        const res = await fetch(`/api/shop/inventory?userId=${userId}`);
        const data = await res.json();
        if (data.success && data.inventory && data.inventory.items) {
          const snakeItemIds = Object.keys(SNAKE_ITEM_TYPES);
          let changed = false;
          for (const [itemId, count] of Object.entries(data.inventory.items)) {
            if (snakeItemIds.includes(itemId) && count > 0) {
              snakeInventory[itemId] = (snakeInventory[itemId] || 0) + count;
              changed = true;
            }
          }
          if (changed) {
            saveSnakeItems();
            updateSnakeItemBar();
          }
        }
      } catch (e) {
        // 闈欓粯澶辫触锛屼娇鐢ㄦ湰鍦版暟鎹?
        console.log('鍚屾鏈嶅姟鍣ㄩ亾鍏峰け璐ワ紝浣跨敤鏈湴鏁版嵁');
      }
    }

    // 淇濆瓨閬撳叿鍒發ocalStorage
    function saveSnakeItems() {
      try {
        localStorage.setItem('snakeItemInventory', JSON.stringify(snakeInventory));
      } catch (e) {
        console.warn('淇濆瓨閬撳叿澶辫触:', e);
      }
    }

    // 娣诲姞閬撳叿
    function addSnakeItem(itemId, count = 1) {
      if (!SNAKE_ITEM_TYPES[itemId]) return;
      snakeInventory[itemId] = (snakeInventory[itemId] || 0) + count;
      saveSnakeItems();
      updateSnakeItemBar();
    }

    // 鏇存柊閬撳叿鏍忔樉绀?
    function updateSnakeItemBar() {
      const bar = document.getElementById('snake-item-bar');
      const list = document.getElementById('snake-item-list');
      if (!bar || !list) return;

      const hasItems = Object.values(snakeInventory).some(c => c > 0);
      bar.style.display = hasItems ? 'block' : 'none';

      if (!hasItems) {
        list.innerHTML = '<span style="font-size: 12px; color: #adb5bd;">鏆傛棤閬撳叿锛屽墠寰€鍟嗗簵璐拱</span>';
        return;
      }

      list.innerHTML = '';
      for (const [itemId, count] of Object.entries(snakeInventory)) {
        if (count <= 0) continue;
        const config = SNAKE_ITEM_TYPES[itemId];
        if (!config) continue;

        const itemEl = document.createElement('div');
        itemEl.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: #f0f4ff; border: 1px solid #d0d8f0; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s;';
        itemEl.title = `${config.name}: ${config.desc}\n鍙屽嚮浣跨敤`;
        itemEl.innerHTML = `
          <span>${config.icon}</span>
          <span style="font-weight: 600; color: #495057;">${config.name}</span>
          <span style="color: #007bff; font-weight: 700;">脳${count}</span>
        `;
        // 鎮仠鏁堟灉
        itemEl.onmouseenter = () => { itemEl.style.background = '#e0e8ff'; itemEl.style.borderColor = '#9ab0e8'; };
        itemEl.onmouseleave = () => { itemEl.style.background = '#f0f4ff'; itemEl.style.borderColor = '#d0d8f0'; };
        // 鍙屽嚮浣跨敤
        itemEl.ondblclick = () => useSnakeItem(itemId);
        list.appendChild(itemEl);
      }
    }

    // 浣跨敤閬撳叿
    function useSnakeItem(itemId) {
      if (!snakeGameState.gameLoop) {
        showToast('璇峰厛寮€濮嬫父鎴忓啀浣跨敤閬撳叿', 'warning');
        return;
      }
      if (snakeGameState.isPaused) {
        showToast('璇峰厛缁х画娓告垙', 'warning');
        return;
      }
      if (!snakeInventory[itemId] || snakeInventory[itemId] <= 0) {
        showToast('閬撳叿涓嶈冻', 'error');
        return;
      }

      const config = SNAKE_ITEM_TYPES[itemId];
      if (!config) return;

      // 鎵ц閬撳叿鏁堟灉
      switch (config.type) {
        case 'revive':
          // 澶嶆椿鍗?- 璁剧疆鏍囪锛岀鎾炴椂鑷姩浣跨敤
          if (snakeGameState.resurrectionUsed) {
            showToast('鏈眬宸蹭娇鐢ㄨ繃澶嶆椿鍗?, 'warning');
            return;
          }
          snakeGameState.resurrectionUsed = true;
          showToast('鉂わ笍 澶嶆椿鍗″凡灏辩华锛屼笅娆＄鎾炴椂鑷姩鐢熸晥', 'success', 2000);
          break;

        case 'speed':
          // 鍔犻€熷崱 - 閫熷害缈诲€嶆寔缁?0绉?
          if (snakeGameState.speedBoostEndTime > Date.now()) {
            showToast('鍔犻€熸晥鏋滃凡鐢熸晥涓?, 'warning');
            return;
          }
          snakeGameState.speed = Math.max(30, Math.floor(snakeGameState.speed / 2));
          snakeGameState.speedBoostEndTime = Date.now() + 10000;
          updateSnakeSpeed();
          showToast('鈿?鍔犻€熷崱宸蹭娇鐢紝閫熷害缈诲€嶆寔缁?0绉掞紒', 'success', 2000);
          break;

        case 'double':
          // 鍙屽€嶅緱鍒嗗崱 - 15绉掑唴寰楀垎缈诲€?
          if (snakeGameState.doubleScoreEndTime > Date.now()) {
            showToast('鍙屽€嶅緱鍒嗗凡鐢熸晥涓?, 'warning');
            return;
          }
          snakeGameState.scoreMultiplier = 2;
          snakeGameState.doubleScoreEndTime = Date.now() + 15000;
          showToast('鉁栵笍2 鍙屽€嶅緱鍒嗗崱宸蹭娇鐢紝鎸佺画15绉掞紒', 'success', 2000);
          break;

        case 'shrink':
          // 缂╃煭鍗?- 韬綋缂╃煭3鑺?
          if (snakeGameState.snake.length <= 2) {
            showToast('铔囧凡缁忓お鐭簡锛屾棤娉曞啀缂╃煭', 'warning');
            return;
          }
          const shrinkCount = Math.min(3, snakeGameState.snake.length - 1);
          const removed = snakeGameState.snake.splice(snakeGameState.snake.length - shrinkCount, shrinkCount);
          removed.forEach(seg => snakeGameState.snakePositions.delete(`${seg.x},${seg.y}`));
          showToast(`馃斀 韬綋缂╃煭${shrinkCount}鑺傦紒`, 'success', 2000);
          break;
      }

      // 娑堣€楅亾鍏凤紙鏈湴锛?
      snakeInventory[itemId]--;
      saveSnakeItems();
      updateSnakeItemBar();

      // 鍚屾鍒版湇鍔″櫒锛堝鏋滅敤鎴峰凡鐧诲綍锛?
      consumeServerItem(itemId);
    }

    // 娑堣€楁湇鍔″櫒绔亾鍏?
    async function consumeServerItem(itemId) {
      try {
        const userId = localStorage.getItem('gameUserId');
        if (!userId) return;
        await fetch('/api/shop/use-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, itemId })
        });
      } catch (e) {
        // 闈欓粯澶勭悊
        console.log('鍚屾娑堣€楁湇鍔″櫒閬撳叿澶辫触');
      }
    }

    // 灏濊瘯浣跨敤澶嶆椿鍗★紙纰版挒鏃惰皟鐢級
    function tryUseResurrection() {
      if (snakeGameState.resurrectionUsed) {
        // 妫€鏌ヨ儗鍖呬腑鏄惁鏈夊娲诲崱
        if (snakeInventory['item_snake_revive'] && snakeInventory['item_snake_revive'] > 0) {
          snakeInventory['item_snake_revive']--;
          saveSnakeItems();
          updateSnakeItemBar();
          snakeGameState.resurrectionUsed = true;
          return true;
        }
        return false;
      }
      return false;
    }

    // 娓呴櫎閬撳叿鏁堟灉锛堟父鎴忕粨鏉熸椂璋冪敤锛?
    function clearSnakeItemEffects() {
      snakeGameState.resurrectionUsed = false;
      snakeGameState.scoreMultiplier = 1;
      snakeGameState.speedBoostEndTime = 0;
      snakeGameState.doubleScoreEndTime = 0;
    }

    // 缁撴潫娓告垙
    function endSnakeGame() {
      if (snakeGameState.gameLoop) {
        cancelAnimationFrame(snakeGameState.gameLoop);
        snakeGameState.gameLoop = null;
      }

      // 娓呴櫎閬撳叿鏁堟灉
      clearSnakeItemEffects();

      // 鎭㈠瑙︽懜榛樿琛屼负
      const canvas = document.getElementById('snake-canvas');
      const virtualControls = document.querySelector('.virtual-controls');
      if (canvas) canvas.classList.remove('touch-disabled');
      if (virtualControls) virtualControls.classList.remove('touch-disabled');

      const winMsg = `娓告垙缁撴潫锛佸緱鍒嗭細${snakeGameState.score}`;
      showWinAlert(winMsg);
      updateStatus(`馃弳 ${winMsg}`);

      console.log('馃悕 璐悆铔囨父鎴忕粨鏉?, {
        score: snakeGameState.score,
        highScore: snakeGameState.highScore,
        snakeLength: snakeGameState.snake.length,
        finalSpeed: snakeGameState.speed
      });

      // 鍙戦€佸垎鏁板埌鏈嶅姟鍣?
      if (socket && socket.connected) {
        socket.emit('snake_game_end', {
          score: snakeGameState.score,
          highScore: snakeGameState.highScore,
          gameType: 'snake',
          moveHistory: snakeGameState.moveHistory,
          maxLength: snakeGameState.maxLength,
          foodEaten: snakeGameState.foodEaten
        });
        console.log('馃悕 鍙戦€佽椽鍚冭泧娓告垙缁撴灉鍒版湇鍔″櫒', {
          score: snakeGameState.score,
          maxLength: snakeGameState.maxLength,
          foodEaten: snakeGameState.foodEaten,
          moveCount: snakeGameState.moveHistory.length
        });
      }
    }

    // 閲嶆柊寮€濮?
    function restartSnakeGame() {
      // 鍋滄娓告垙寰幆
      if (snakeGameState.gameLoop) {
        cancelAnimationFrame(snakeGameState.gameLoop);
        snakeGameState.gameLoop = null;
      }

      // 鍋滄璁℃椂鍣紙鍙屼汉妯″紡锛?
      if (snakeGameState.gameTimer) {
        clearInterval(snakeGameState.gameTimer);
        snakeGameState.gameTimer = null;
      }

      console.log('馃悕 璐悆铔囨父鎴忛噸鏂板紑濮?, {
        previousScore: snakeGameState.score,
        highScore: snakeGameState.highScore
      });

      // 鏍规嵁褰撳墠妯″紡閲嶆柊寮€濮?
      if (snakeGameState.isDualMode) {
        startSnakeDualGame();
      } else {
        startSnakeGame();
      }
    }

    // 閫€鍑烘父鎴?
    function quitSnakeGame() {
      showConfirmDialog('纭畾瑕侀€€鍑哄綋鍓嶆父鎴忓悧锛?, () => {
        // 鍋滄娓告垙寰幆
        if (snakeGameState.gameLoop) {
          cancelAnimationFrame(snakeGameState.gameLoop);
          snakeGameState.gameLoop = null;
        }

        // 鍋滄璁℃椂鍣紙鍙屼汉妯″紡锛?
        if (snakeGameState.gameTimer) {
          clearInterval(snakeGameState.gameTimer);
          snakeGameState.gameTimer = null;
        }

        // 濡傛灉鏄弻浜烘ā寮忥紝閫氱煡鏈嶅姟鍣ㄨ繑鍥炲ぇ鍘?
        if (snakeGameState.isDualMode) {
          if (socket && socket.connected) {
            socket.emit('return_lobby');
          }
        }

        // 閲嶇疆涓哄崟浜烘ā寮忛厤缃?
        resetSnakeCanvas();

        // 鎭㈠娓告垙鐣岄潰
        showSnakeGameInterface();

        updateStatus('馃毆 宸查€€鍑烘父鎴?);
      });
    }

    // ========== 娓叉煋鍜屾洿鏂板嚱鏁?==========
    function renderBoard() {
      if (currentGame === 'gobang') {
        renderGobangBoard();
      } else if (currentGame === 'go') {
        renderGoBoard();
      }
      // 璞℃妫嬬洏涓嶉渶瑕侀噸鏂版覆鏌擄紝鍥犱负妫嬪瓙鏄疍OM鍏冪礌
    }

    function renderGobangBoard() {
      const config = gameConfigs.gobang;
      const cells = document.querySelectorAll(`.${config.cellClass}`);

      // 绉婚櫎鎵€鏈?last-move 鏍囪
      document.querySelectorAll('.gobang-cell.last-move').forEach(cell => {
        cell.classList.remove('last-move');
      });

      cells.forEach((cell, index) => {
        const r = Math.floor(index / config.size);
        const c = index % config.size;
        const currentContent = cell.innerHTML;
        const newContent = gameState.board[r][c] === 1 ? `<div class="${config.pieceClasses[0]}"></div>` :
          gameState.board[r][c] === 2 ? `<div class="${config.pieceClasses[1]}"></div>` : '';

        if (currentContent !== newContent) {
          cell.innerHTML = newContent;
        }

        // 鏍囪鏈€鏂拌惤瀛愪綅缃?
        if (gameState.lastMove && gameState.lastMove.r === r && gameState.lastMove.c === c) {
          cell.classList.add('last-move');
        }
      });
    }

    function renderGoBoard() {
      const config = gameConfigs.go;
      const cells = document.querySelectorAll(`.${config.cellClass}`);

      // 绉婚櫎鎵€鏈?last-move 鏍囪
      document.querySelectorAll('.go-cell.last-move').forEach(cell => {
        cell.classList.remove('last-move');
      });

      cells.forEach((cell, index) => {
        const r = Math.floor(index / config.size);
        const c = index % config.size;
        const currentContent = cell.querySelector('.go-black, .go-white');
        const newColor = gameState.board[r][c];

        if (currentContent) {
          if (newColor === 0) {
            currentContent.remove();
          }
        } else if (newColor !== 0) {
          const piece = document.createElement('div');
          piece.className = newColor === 1 ? config.pieceClasses[0] : config.pieceClasses[1];
          cell.appendChild(piece);
        }

        // 鏍囪鏈€鏂拌惤瀛愪綅缃?
        if (gameState.lastMove && gameState.lastMove.r === r && gameState.lastMove.c === c) {
          cell.classList.add('last-move');
        }
      });
    }

    function updateTurnDisplay() {
      const config = gameConfigs[currentGame];
      const turnText = config.colorNames[gameState.turn - 1];
      const turnClass = gameState.turn === 1 ? (currentGame === 'chinese-chess' ? 'value-red' : 'value-black') : (currentGame === 'chinese-chess' ? 'value-green' : 'value-white');

      currentTurnEl.textContent = turnText;
      currentTurnEl.className = `info-value value-turn ${turnClass}`;
    }

    function updateLastMove(r, c, color) {
      const config = gameConfigs[currentGame];
      const colorText = config.colorNames[color - 1];
      const colorClass = color === 1 ? (currentGame === 'chinese-chess' ? 'value-red' : 'value-black') : (currentGame === 'chinese-chess' ? 'value-green' : 'value-white');

      if (currentGame === 'chinese-chess') {
        const move = gameState.moveLog[gameState.moveLog.length - 1];
        lastMoveEl.textContent = `${colorText} ${move.piece} (${move.fromR},${move.fromC})鈫?${r},${c})`;
      } else {
        lastMoveEl.textContent = `${colorText} (${r},${c})`;
      }

      lastMoveEl.className = `info-value ${colorClass}`;
    }

    function updateMoveCount() {
      moveCountEl.textContent = gameState.moveCount;
    }

    function updateColorCount() {
      blackCountEl.textContent = gameState.blackCount;
      whiteCountEl.textContent = gameState.whiteCount;

      const config = gameConfigs[currentGame];
      const emptyCount = config.totalCells - (gameState.blackCount + gameState.whiteCount);
      emptyCountEl.textContent = emptyCount;
    }

    function updateMoveLog() {
      if (gameState.moveLog.length === 0) {
        moveLogEl.innerHTML = '绛夊緟钀藉瓙...';
        return;
      }

      if (moveLogEl.dataset.lastIndex !== (gameState.moveLog.length - 1).toString()) {
        let logHtml = '';
        gameState.moveLog.forEach((move, index) => {
          const config = gameConfigs[currentGame];
          const colorText = config.colorNames[move.color - 1];
          const roleText = move.isOpponent ? '瀵规柟' : '鑷繁';
          const logClass = move.color === 1 ? (currentGame === 'chinese-chess' ? 'move-log-red' : 'move-log-black') : (currentGame === 'chinese-chess' ? 'move-log-green' : 'move-log-white');

          if (currentGame === 'chinese-chess') {
            logHtml += `<div class="move-log-item ${logClass}">${index + 1}. ${roleText}(${colorText})${move.piece}锛?${move.fromR},${move.fromC})鈫?${move.toR},${move.toC})</div>`;
          } else {
            logHtml += `<div class="move-log-item ${logClass}">${index + 1}. ${roleText}(${colorText})锛?${move.r},${move.c})</div>`;
          }
        });
        moveLogEl.innerHTML = logHtml;
        moveLogEl.dataset.lastIndex = (gameState.moveLog.length - 1).toString();

        if (moveLogEl.scrollTop + moveLogEl.clientHeight >= moveLogEl.scrollHeight - 10) {
          moveLogEl.scrollTop = moveLogEl.scrollHeight;
        }
      }
    }

    function updateAdvancedStats() {
      const config = gameConfigs[currentGame];
      if (!config) return;
      const totalCells = config.totalCells;

      totalCellsEl.textContent = totalCells;

      const filledRate = ((gameState.blackCount + gameState.whiteCount) / totalCells) * 100;
      filledRateEl.textContent = filledRate.toFixed(2) + '%';
      boardFillRateEl.textContent = filledRate.toFixed(2) + '%';

      const blackWinRate = gameState.gameOver && winnerEl.textContent === config.colorNames[0] ? 100 : 0;
      const whiteWinRate = gameState.gameOver && winnerEl.textContent === config.colorNames[1] ? 100 : 0;
      blackWinRateEl.textContent = blackWinRate + '%';
      whiteWinRateEl.textContent = whiteWinRate + '%';

      if (gameState.gameOver) {
        fastestWinStepsEl.textContent = gameState.moveCount;
      } else {
        fastestWinStepsEl.textContent = '--';
      }

      maxChainEl.textContent = gameState.maxChain;
      currentChainEl.textContent = gameState.maxChain;

      if (gameState.moveTimestamps.length >= 2) {
        let totalInterval = 0;
        for (let i = 1; i < gameState.moveTimestamps.length; i++) {
          totalInterval += gameState.moveTimestamps[i] - gameState.moveTimestamps[i - 1];
        }
        const avgInterval = Math.floor(totalInterval / (gameState.moveTimestamps.length - 1));
        avgMoveIntervalEl.textContent = `${avgInterval}ms`;
      } else {
        avgMoveIntervalEl.textContent = '0ms';
      }
    }

    function updateGameTime() {
      if (!gameState.gameStartTime || gameState.gameOver) return;

      const now = Date.now();
      const diff = Math.floor((now - gameState.gameStartTime) / 1000);
      const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
      const seconds = (diff % 60).toString().padStart(2, '0');
      gameTimeEl.textContent = `${minutes}:${seconds}`;

      if (gameState.moveCount > 0 && diff > 0) {
        const frequency = (gameState.moveCount / diff).toFixed(2);
        moveFrequencyEl.textContent = `${frequency} 姝?绉抈;
      }
    }

    function updateMousePos(r, c) {
      mousePosEl.textContent = `(${r},${c})`;
    }

    function updateStatus(text) {
      statusEl.textContent = `鐘舵€侊細${text}`;
    }

    function showWinAlert(text) {
      winText.textContent = text;
      winAlert.style.display = 'block';
      setTimeout(() => {
        winAlert.style.display = 'none';
      }, 3000);
    }

    function toggleAdvancedStats() {
      advancedStatsEl.classList.toggle('show');
    }

    function exportGameData() {
      const gameData = {
        version: "4.0",
        timestamp: new Date().toISOString(),
        gameType: currentGame,
        gameDuration: gameTimeEl.textContent,
        totalMoves: gameState.moveCount,
        blackMoves: gameState.blackCount,
        whiteMoves: gameState.whiteCount,
        winner: winnerEl.textContent,
        maxChain: gameState.maxChain,
        myColor: gameState.me === 1 ? 'black' : 'white',
        opponentId: matchedOpponentId ? matchedOpponentId.substring(0, 4) + '****' : '鏈煡',
        moveLog: gameState.moveLog.map((m, index) => {
          const log = {
            color: m.color === 1 ? 'black' : 'white',
            isSelf: !m.isOpponent,
            timestamp: gameState.moveTimestamps[index] || 0
          };

          if (currentGame === 'chinese-chess') {
            log.fromPosition = [m.fromR, m.fromC];
            log.toPosition = [m.toR, m.toC];
            log.piece = m.piece;
          } else {
            log.position = [m.r, m.c];
          }

          return log;
        })
      };

      const blob = new Blob([JSON.stringify(gameData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `妫嬬被瀵瑰眬鏁版嵁_${currentGame}_${new Date().getTime()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      updateStatus('鉁?瀵瑰眬鏁版嵁宸插鍑猴紒');
    }

    // ========== 鏅鸿兘鎻愮ず绯荤粺 ==========
    function showGameTips() {
      const config = gameConfigs[currentGame];
      tipPopupTitle.textContent = `${config.emoji} ${currentGame === 'gobang' ? '浜斿瓙妫? : currentGame === 'go' ? '鍥存' : '璞℃'}瑙勫垯`;
      tipPopupContent.textContent = config.rules;
      tipPopup.classList.add('show');

      setTimeout(() => {
        hideGameTips();
      }, 10000);
    }

    function hideGameTips() {
      tipPopup.classList.remove('show');
    }

    // ========== 鑱婂ぉ绯荤粺 ==========
    function addChatMessage(nickname, message, isOther, scope = 'global') {
      const messageEl = document.createElement('div');
      messageEl.className = `chat-message ${isOther ? 'other' : 'self'}`;

      const scopeLabel = scope === 'global' ? '澶у巺' : '灞€鍐?;
      const scopeClass = scope === 'global' ? 'global' : 'game';

      messageEl.innerHTML = `
        <div class="chat-sender">
          <span class="chat-scope ${scopeClass}">${scopeLabel}</span>
          <span>${nickname}</span>
        </div>
        <div>${message}</div>
      `;
      chatMessages.appendChild(messageEl);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 鍒囨崲鑱婂ぉ棰戦亾
    function switchChatChannel(channel) {
      currentChatChannel = channel;

      // 鏇存柊鎸夐挳鐘舵€?
      channelGlobalBtn.classList.remove('active');
      channelGameBtn.classList.remove('active');

      if (channel === 'global') {
        channelGlobalBtn.classList.add('active');
      } else {
        channelGameBtn.classList.add('active');
      }

      // 娓呯┖骞堕噸鏂版樉绀哄搴旈閬撶殑娑堟伅
      chatMessages.innerHTML = '';
      const history = channel === 'global' ? globalChatHistory : gameChatHistory;
      history.forEach(msg => {
        addChatMessage(msg.nickname, msg.message, msg.userId !== accountId, msg.scope);
      });
    }

    // 鏇存柊灞€鍐呴閬撴寜閽姸鎬佸苟鑷姩鍒囨崲
    function updateGameChannelButton() {
      const inGame = userStatus === 'playing' || userStatus === 'spectating';
      channelGameBtn.disabled = !inGame;

      // 鑷姩鍒囨崲鍒板搴旈閬?
      if (inGame && currentChatChannel !== 'game') {
        // 杩涘叆娓告垙鏃惰嚜鍔ㄥ垏鎹㈠埌灞€鍐呴閬?
        switchChatChannel('game');
      } else if (!inGame && currentChatChannel !== 'global') {
        // 閫€鍑烘父鎴忔椂鑷姩鍒囨崲鍒板ぇ鍘呴閬?
        switchChatChannel('global');
      }
    }

    function sendChatMessage() {
      const message = chatInput.value.trim();
      if (!message) return;

      if (currentChatChannel === 'global') {
        socket.emit('chat_global', {
          message: message
        });
      } else {
        socket.emit('chat_game', {
          message: message
        });
      }

      chatInput.value = '';
    }

    function handleChatKeypress(event) {
      if (event.key === 'Enter') {
        sendChatMessage();
      }
    }

    // ========== 鍖归厤鍜屾父鎴忛€昏緫 ==========
    function initUserStatus() {
      onlineUsers.set(accountId, {
        status: 'online',
        game: currentGame,
        lastUpdate: Date.now()
      });
      updateUserList();
      updateGameChannelButton();

      socket.emit('user_status', {
        status: 'online',
        game: currentGame
      });
    }

    function updateUserList() {
      if (onlineUsers.size === 0) {
        userList.innerHTML = '鏆傛棤鍦ㄧ嚎鐜╁';
        return;
      }

      let html = '';
      onlineUsers.forEach((user, uid) => {
        const isMe = uid === accountId;
        const statusClass = user.status === 'waiting' ? 'waiting' :
          user.status === 'playing' ? 'playing' : '';
        const gameClass = user.game || '';
        const statusText = user.status === 'online' ? '鍦ㄧ嚎' :
          user.status === 'waiting' ? '绛夊緟涓? :
            user.status === 'playing' ? '娓告垙涓? : '';

        // 浼樺厛鏄剧ず鏄电О锛屽鏋滄病鏈夋樀绉板垯鏄剧ずID
        const displayName = user.nickname || (isMe ? '鎴? : '鐜╁' + uid.substring(0, 4));

        html += `<div class="user-item ${statusClass} ${gameClass} ${isMe ? 'me' : ''}">
          <span>${isMe ? '馃懁' : '馃懃'}</span>
          <span>${displayName}${isMe ? ' (鎴?' : ''}</span>
          <span style="color: #718096;">鑳? ${user.stats?.wins || 0}</span>
          <span>${statusText}</span>
          ${!isMe && user.status === 'online' ? `<button class="challenge-btn" onclick="sendChallenge('${uid}')">鎸戞垬</button>` : ''}
        </div>`;
      });
      userList.innerHTML = html;
      applyThemeToUserList();
    }

    function applyThemeToUserList() {
      if (!userList) return;
      const theme = themes[currentTheme];
      const userItems = userList.querySelectorAll('.user-item');
      userItems.forEach(item => {
        item.style.background = theme.uiColors.userItemBg;
        item.style.color = theme.uiColors.userItemColor;
      });
    }

    function sendChallenge(opponentId) {
      if (matchedOpponentId) {
        updateStatus('鉂?姝ｅ湪娓告垙涓紝鏃犳硶鍙戣捣鎸戞垬');
        return;
      }
      if (isMatching) {
        updateStatus('鉂?姝ｅ湪鍖归厤涓紝鏃犳硶鍙戣捣鎸戞垬');
        return;
      }
      if (opponentId === accountId) {
        updateStatus('鉂?涓嶈兘鎸戞垬鑷繁');
        return;
      }

      updateStatus(`鈴?姝ｅ湪鍚戠帺瀹?${opponentId.substring(0, 4)}**** 鍙戣捣鎸戞垬...`);
      socket.emit('challenge_request', {
        to: opponentId,
        game: currentGame
      });
    }

    function startMatching() {
      if (isMatching || matchedOpponentId) return;

      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
      }

      isMatching = true;
      userStatus = 'waiting';

      onlineUsers.set(accountId, {
        status: 'waiting',
        game: currentGame,
        lastUpdate: Date.now()
      });
      updateUserList();
      updateGameChannelButton();

      matchBtn.disabled = true;
      cancelBtn.disabled = false;
      matchBtn.innerHTML = '<div class="loading-spinner"></div>鍖归厤涓?..';
      lobbyStatus.textContent = `馃攳 姝ｅ湪瀵绘壘${gameConfigs[currentGame].emoji} ${currentGame === 'gobang' ? '浜斿瓙妫? : currentGame === 'go' ? '鍥存' : '璞℃'}瀵规墜...`;

      socket.emit('match_request', { game: currentGame });
    }

    function cancelMatching() {
      if (!isMatching) return;

      isMatching = false;
      userStatus = 'online';

      onlineUsers.set(accountId, {
        status: 'online',
        game: currentGame,
        lastUpdate: Date.now()
      });
      updateUserList();
      updateGameChannelButton();

      matchBtn.disabled = false;
      cancelBtn.disabled = true;
      matchBtn.innerHTML = '馃幆 寮€濮嬪尮閰?;
      lobbyStatus.textContent = '娆㈣繋鏉ュ埌澶氭绉嶈仈鏈哄ぇ鍘咃紒閫夋嫨妫嬬鍚庣偣鍑?寮€濮嬪尮閰?瀵绘壘瀵规墜';

      socket.emit('cancel_match');
    }

    function startGameWithOpponent(opponentId, color) {
      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
      }

      isMatching = false;
      userStatus = 'playing';

      onlineUsers.set(accountId, {
        status: 'playing',
        game: currentGame,
        lastUpdate: Date.now()
      });
      updateUserList();
      updateGameChannelButton();

      lobbyContainer.style.display = 'none';
      infoContainer.style.display = 'flex';
      gameControls.style.display = 'flex';
      statusBox.style.display = 'block';

      // 鏄剧ず钀藉瓙璁板綍闈㈡澘鍜屽湪绾跨帺瀹堕潰鏉匡紙甯﹀姩鐢伙級
      const moveLogPanelEl = document.getElementById('move-log-panel');
      moveLogPanelEl.style.opacity = '0';
      moveLogPanelEl.style.transform = 'translateY(20px)';
      moveLogPanelEl.style.display = 'block';

      const onlineUsersPanelEl = document.getElementById('online-users-panel');
      onlineUsersPanelEl.style.opacity = '0';
      onlineUsersPanelEl.style.transform = 'translateY(20px)';
      onlineUsersPanelEl.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        moveLogPanelEl.style.opacity = '1';
        moveLogPanelEl.style.transform = 'translateY(0)';
        onlineUsersPanelEl.style.opacity = '1';
        onlineUsersPanelEl.style.transform = 'translateY(0)';
      }, 10);

      const config = gameConfigs[currentGame];

      if (currentGame === 'gobang') {
        gobangBoard.style.display = 'grid';
      } else if (currentGame === 'go') {
        goBoard.style.display = 'grid';
      } else if (currentGame === 'chinese-chess') {
        chessBoard.style.display = 'block';
      }

      initGameBoard();

      gameState.me = color;
      gameState.turn = 1;
      gameState.gameOver = false;
      gameState.moveCount = 0;
      gameState.moveLog = [];
      gameState.blackCount = 0;
      gameState.whiteCount = 0;
      gameState.gameStartTime = Date.now();
      gameState.maxChain = 0;
      gameState.moveTimestamps = [];
      gameState.selectedPiece = null;
      gameState.validMoves = [];

      roleEl.textContent = '鐜╁';
      const myColorText = config.colorNames[color - 1];
      myColorEl.textContent = myColorText;
      myColorEl.className = `info-value ${color === 1 ? (currentGame === 'chinese-chess' ? 'value-red' : 'value-black') : (currentGame === 'chinese-chess' ? 'value-green' : 'value-white')}`;
      gameStatusEl.textContent = '娓告垙涓?;
      gameStatusEl.className = 'info-value value-connected';

      if (gameState.gameTimer) clearInterval(gameState.gameTimer);
      gameState.gameTimer = setInterval(updateGameTime, 1000);

      updateTurnDisplay();
      updateGameDisplay();
      updateStatus('馃幃 鍖归厤鎴愬姛锛佷綘鏄?' + myColorText + (color === 1 ? '锛岃鍏堣惤瀛愶紒' : '锛岀瓑寰呭鏂硅惤瀛愶紒'));

      // 鏄剧ず鎮旀鍜屾彁绀烘寜閽?
      showBoardGameActionButtons();
    }

    function initGameBoard() {
      if (currentGame === 'gobang') {
        gameState.board = create2DArray(gameConfigs.gobang.size, 0);
      } else if (currentGame === 'go') {
        gameState.board = create2DArray(gameConfigs.go.size, 0);
      } else if (currentGame === 'chinese-chess') {
        renderChessPieces();
        gameState.board = convertFrontendPiecesToBackend();
      }
    }

    function create2DArray(size, fillValue) {
      const board = [];
      for (let i = 0; i < size; i++) {
        const row = [];
        for (let j = 0; j < size; j++) {
          row.push(fillValue);
        }
        board.push(row);
      }
      return board;
    }

    function returnToLobby() {
      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
      }

      // 妫€鏌ユ槸鍚︿粠AI瀵规垬杩斿洖
      const isFromAI = gameState.difficulty !== null;

      // 闅愯棌鎵€鏈夐〉闈?
      lobbyContainer.style.display = isFromAI ? 'none' : 'flex';
      infoContainer.style.display = 'none';
      gameControls.style.display = 'none';
      statusBox.style.display = 'none';
      moveLogPanel.style.display = 'none';
      chatContainer.classList.remove('show');
      document.getElementById('achievements-container').style.display = 'none';
      document.getElementById('ai-game-container').style.display = isFromAI ? 'block' : 'none';

      // 鏄剧ず鍦ㄧ嚎鐜╁闈㈡澘锛堝甫鍔ㄧ敾锛?
      if (!isFromAI) {
        const onlineUsersPanelEl = document.getElementById('online-users-panel');
        onlineUsersPanelEl.style.opacity = '0';
        onlineUsersPanelEl.style.transform = 'translateY(20px)';
        onlineUsersPanelEl.style.display = 'block';

        // 娣诲姞鍔ㄧ敾鏁堟灉
        setTimeout(() => {
          onlineUsersPanelEl.style.opacity = '1';
          onlineUsersPanelEl.style.transform = 'translateY(0)';
        }, 10);
      }

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 濡傛灉涓嶆槸浠嶢I瀵规垬杩斿洖锛屾樉绀哄綋鍓嶉€変腑鐨勬绉嶆鐩橈紙绌烘鐩橈級
      if (!isFromAI) {
        if (currentGame === 'gobang') {
          gobangBoard.style.display = 'grid';
        } else if (currentGame === 'go') {
          goBoard.style.display = 'grid';
        } else if (currentGame === 'chinese-chess') {
          chessBoard.style.display = 'block';
        }
      }

      isMatching = false;
      matchedOpponentId = null;

      // 鍏堝彂閫佽繑鍥炲ぇ鍘呰姹?
      socket.emit('return_lobby');

      // 鍐嶆洿鏂扮敤鎴风姸鎬?
      userStatus = 'online';

      // 娓呴櫎AI瀵规垬鏍囪
      gameState.difficulty = null;

      matchBtn.disabled = false;
      cancelBtn.disabled = true;
      matchBtn.innerHTML = '馃幆 寮€濮嬪尮閰?;
      lobbyStatus.textContent = '娆㈣繋鏉ュ埌澶氭绉嶈仈鏈哄ぇ鍘咃紒閫夋嫨妫嬬鍚庣偣鍑?寮€濮嬪尮閰?瀵绘壘瀵规墜';

      if (gameState.gameTimer) clearInterval(gameState.gameTimer);

      resetGame(false);
      // 纭繚娓告垙鐘舵€佷繚鎸佷负缁撴潫鐘舵€?
      gameState.gameOver = true;

      socket.emit('user_status', {
        status: 'online',
        game: currentGame
      });

      onlineUsers.set(accountId, {
        status: 'online',
        game: currentGame,
        lastUpdate: Date.now()
      });
      updateUserList();
      updateGameChannelButton();
    }

    function showAchievements() {
      // 鏇存柊瀵艰埅鎸夐挳鐘舵€?
      updateNavActiveState('achievements');

      // 闅愯棌鍏朵粬椤甸潰
      lobbyContainer.style.display = 'none';
      infoContainer.style.display = 'none';
      gameControls.style.display = 'none';
      statusBox.style.display = 'none';
      moveLogPanel.style.display = 'none';
      document.getElementById('ai-game-container').style.display = 'none';
      document.getElementById('leaderboard-page').style.display = 'none';
      document.getElementById('theme-container').style.display = 'none';
      document.getElementById('snake-game-container').style.display = 'none';

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 鏄剧ず鎴愬氨椤甸潰
      const achievementsContainer = document.getElementById('achievements-container');
      achievementsContainer.style.opacity = '0';
      achievementsContainer.style.transform = 'translateY(20px)';
      achievementsContainer.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        achievementsContainer.style.opacity = '1';
        achievementsContainer.style.transform = 'translateY(0)';
      }, 10);

      // 鍔犺浇鎴愬氨
      loadAchievements();
    }

    function showAIGame() {
      // 鏇存柊瀵艰埅鎸夐挳鐘舵€?
      updateNavActiveState('ai');

      // 闅愯棌鍏朵粬椤甸潰
      lobbyContainer.style.display = 'none';
      infoContainer.style.display = 'none';
      gameControls.style.display = 'none';
      statusBox.style.display = 'none';
      moveLogPanel.style.display = 'none';
      document.getElementById('achievements-container').style.display = 'none';
      document.getElementById('leaderboard-page').style.display = 'none';
      document.getElementById('theme-container').style.display = 'none';
      document.getElementById('snake-game-container').style.display = 'none';

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 鏄剧ずAI瀵规垬椤甸潰
      const aiGameContainer = document.getElementById('ai-game-container');
      aiGameContainer.style.opacity = '0';
      aiGameContainer.style.transform = 'translateY(20px)';
      aiGameContainer.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        aiGameContainer.style.opacity = '1';
        aiGameContainer.style.transform = 'translateY(0)';
      }, 10);
    }

    // 鏄剧ず鎺掕姒滈〉闈?
    function showLeaderboard() {
      // 鏇存柊瀵艰埅鎸夐挳鐘舵€?
      updateNavActiveState('leaderboard');

      // 闅愯棌鍏朵粬椤甸潰
      lobbyContainer.style.display = 'none';
      infoContainer.style.display = 'none';
      gameControls.style.display = 'none';
      statusBox.style.display = 'none';
      moveLogPanel.style.display = 'none';
      document.getElementById('achievements-container').style.display = 'none';
      document.getElementById('ai-game-container').style.display = 'none';
      document.getElementById('theme-container').style.display = 'none';
      document.getElementById('snake-game-container').style.display = 'none';

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 鏄剧ず鎺掕姒滈〉闈?
      const leaderboardPage = document.getElementById('leaderboard-page');
      leaderboardPage.style.opacity = '0';
      leaderboardPage.style.transform = 'translateY(20px)';
      leaderboardPage.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        leaderboardPage.style.opacity = '1';
        leaderboardPage.style.transform = 'translateY(0)';
      }, 10);

      // 鍔犺浇鎺掕姒滄暟鎹?
      loadLeaderboard('all');
    }

    // 鍔犺浇鎺掕姒滄暟鎹?
    function loadLeaderboard(gameType) {
      // 鏇存柊鎸夐挳閫変腑鐘舵€?
      document.querySelectorAll('.leaderboard-controls .lobby-btn').forEach(btn => {
        btn.style.backgroundColor = '';
        btn.style.fontWeight = 'normal';
      });

      // 涓哄綋鍓嶉€変腑鐨勬寜閽坊鍔犳牱寮?
      if (gameType === 'all') {
        document.querySelector('button[onclick="loadLeaderboard(\'all\')"]').style.backgroundColor = '#3498db';
        document.querySelector('button[onclick="loadLeaderboard(\'all\')"]').style.fontWeight = 'bold';
      } else if (gameType === 'gobang') {
        document.querySelector('button[onclick="loadLeaderboard(\'gobang\')"]').style.backgroundColor = '#e74c3c';
        document.querySelector('button[onclick="loadLeaderboard(\'gobang\')"]').style.fontWeight = 'bold';
      } else if (gameType === 'go') {
        document.querySelector('button[onclick="loadLeaderboard(\'go\')"]').style.backgroundColor = '#27ae60';
        document.querySelector('button[onclick="loadLeaderboard(\'go\')"]').style.fontWeight = 'bold';
      } else if (gameType === 'chinese-chess') {
        document.querySelector('button[onclick="loadLeaderboard(\'chinese-chess\')"]').style.backgroundColor = '#f39c12';
        document.querySelector('button[onclick="loadLeaderboard(\'chinese-chess\')"]').style.fontWeight = 'bold';
      } else if (gameType === 'snake') {
        document.querySelector('button[onclick="loadLeaderboard(\'snake\')"]').style.backgroundColor = '#9b59b6';
        document.querySelector('button[onclick="loadLeaderboard(\'snake\')"]').style.fontWeight = 'bold';
      }

      // 淇濆瓨褰撳墠閫変腑鐨勬父鎴忕被鍨嬶紝渚?updateLeaderboard 浣跨敤
      currentLeaderboardGameType = gameType;

      const leaderboardList = document.getElementById('leaderboard-list');
      leaderboardList.innerHTML = '鍔犺浇涓?..';

      // 浠庢湇鍔″櫒鑾峰彇鎺掕姒滄暟鎹紙鐢?socket.on('leaderboard') 缁熶竴澶勭悊鍝嶅簲锛?
      socket.emit('get_leaderboard', { limit: 10, gameType: gameType });
    }

    // 閫夋嫨娓告垙绫诲瀷
    function selectGameType(gameType) {
      // 绉婚櫎鎵€鏈夊崱鐗囩殑閫変腑鐘舵€?
      document.querySelectorAll('.game-type-card').forEach(card => {
        card.classList.remove('selected');
      });

      // 涓哄綋鍓嶉€変腑鐨勫崱鐗囨坊鍔犻€変腑鐘舵€?
      document.querySelector(`[data-game-type="${gameType}"]`).classList.add('selected');

      // 鏇存柊闅愯棌杈撳叆妗嗙殑鍊?
      document.getElementById('ai-game-type').value = gameType;
    }

    function loadAchievements() {
      // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
      const accountData = currentAccount?.account?.account || currentAccount?.account;
      if (!currentAccount || !accountData?.id) {
        const achievementsList = document.getElementById('achievements-list');
        achievementsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">璇峰厛鐧诲綍鏌ョ湅鎴愬氨</div>';
        return;
      }

      // 浠庢湇鍔″櫒鑾峰彇鎴愬氨鍒楄〃
      socket.emit('get_achievements');
    }

    function startAIGame(difficulty) {
      // 鑾峰彇鐢ㄦ埛閫夋嫨鐨勬父鎴忕被鍨?
      const gameTypeSelect = document.getElementById('ai-game-type');
      const selectedGameType = gameTypeSelect ? gameTypeSelect.value : currentGame;

      // 鏇存柊褰撳墠娓告垙绫诲瀷
      currentGame = selectedGameType;

      // 闅愯棌AI瀵规垬椤甸潰
      document.getElementById('ai-game-container').style.display = 'none';

      // 鏄剧ず娓告垙鐩稿叧鍏冪礌
      infoContainer.style.display = 'flex';
      gameControls.style.display = 'flex';
      statusBox.style.display = 'block';

      // 鏄剧ず钀藉瓙璁板綍闈㈡澘鍜屽湪绾跨帺瀹堕潰鏉匡紙甯﹀姩鐢伙級
      const moveLogPanelEl = document.getElementById('move-log-panel');
      moveLogPanelEl.style.opacity = '0';
      moveLogPanelEl.style.transform = 'translateY(20px)';
      moveLogPanelEl.style.display = 'block';

      const onlineUsersPanelEl = document.getElementById('online-users-panel');
      onlineUsersPanelEl.style.opacity = '0';
      onlineUsersPanelEl.style.transform = 'translateY(20px)';
      onlineUsersPanelEl.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        moveLogPanelEl.style.opacity = '1';
        moveLogPanelEl.style.transform = 'translateY(0)';
        onlineUsersPanelEl.style.opacity = '1';
        onlineUsersPanelEl.style.transform = 'translateY(0)';
      }, 10);

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 鏄剧ず閫夋嫨鐨勬绉嶇殑妫嬬洏
      if (currentGame === 'gobang') {
        gobangBoard.style.display = 'grid';
      } else if (currentGame === 'go') {
        goBoard.style.display = 'grid';
      } else if (currentGame === 'chinese-chess') {
        chessBoard.style.display = 'block';
      }

      // 璁剧疆娓告垙鐘舵€?
      gameState = {
        gameType: currentGame,
        player: 1,
        difficulty: difficulty,
        me: 1,
        turn: 1,
        gameOver: false,
        moveCount: 0,
        moveLog: [],
        blackCount: 0,
        whiteCount: 0,
        gameStartTime: Date.now(),
        maxChain: 0,
        moveTimestamps: [],
        selectedPiece: null,
        validMoves: []
      };
      currentPlayer = 1;

      // 鍒濆鍖栨鐩?
      initGameBoard();

      // 鏇存柊鏄剧ず
      roleEl.textContent = '鐜╁';
      const config = gameConfigs[currentGame];
      const myColorText = config.colorNames[0];
      myColorEl.textContent = myColorText;
      myColorEl.className = `info-value ${currentGame === 'chinese-chess' ? 'value-red' : 'value-black'}`;
      gameStatusEl.textContent = '娓告垙涓?;
      gameStatusEl.className = 'info-value value-connected';

      // 鍚姩娓告垙璁℃椂鍣?
      if (gameState.gameTimer) clearInterval(gameState.gameTimer);
      gameState.gameTimer = setInterval(updateGameTime, 1000);

      // 鏇存柊鐘舵€?
      document.getElementById('status').innerHTML = `鐘舵€侊細馃幃 姝ｅ湪涓?{difficulty === 'easy' ? '绠€鍗? : difficulty === 'medium' ? '涓瓑' : '鍥伴毦'}AI瀵规垬`;

      // 閫氱煡鏈嶅姟鍣ㄥ紑濮婣I瀵规垬
      if (socket) {
        socket.emit('ai_game_start', {
          gameType: currentGame,
          difficulty: difficulty
        });
      }

      // 鏄剧ず鎮旀鍜屾彁绀烘寜閽?
      showBoardGameActionButtons();
    }

    // 鍙戦€?AI 娓告垙缁撴灉鍒版湇鍔″櫒
    function sendAIGameResult(result) {
      if (!socket || !gameState.difficulty) return;

      const duration = Date.now() - gameState.gameStartTime;

      socket.emit('ai_game_result', {
        result: result,
        gameType: currentGame,
        difficulty: gameState.difficulty,
        duration: duration
      });
    }

    // AI瀵规垬鏍稿績閫昏緫 - 鐜板湪鐢辨湇鍔″櫒澶勭悊
    function handleAIMove() {
      // 杩欎釜鍑芥暟鐜板湪鐢辨湇鍔″櫒绔鐞咥I绉诲姩
      // 鍓嶇鍙渶瑕佸湪鐜╁绉诲姩鍚庨€氱煡鏈嶅姟鍣?
    }

    // 澶勭悊AI绉诲姩缁撴灉锛堜粠鏈嶅姟鍣ㄦ帴鏀讹級
    function handleAIMoveResult(data) {
      if (!gameState.difficulty || gameState.gameOver) return;

      const { position, color, currentPlayer, board } = data;

      // 璞℃鐩存帴鍚屾鍚庣缁欑殑鏁翠釜board
      if (currentGame === 'chinese-chess' && board) {
        const isOwnEcho = color === gameState.me;

        // 缁熶竴浠庢湇鍔＄妫嬬洏鏁版嵁閲嶅缓 chessPieces 鍜?DOM锛岀‘淇濆畬鍏ㄥ悓姝?
        const newPieces = convertBackendBoardToFrontend(board);
        chessPieces.red = newPieces.red;
        chessPieces.black = newPieces.black;
        gameState.board = board;
        renderChessPieces();

        if (isOwnEcho) {
          // 鑷繁鐨勭Щ鍔ㄥ洖鏄?- 鍙渶鍒囨崲鍥炲悎
          gameState.turn = currentPlayer;
          clearChessSelection();
          requestAnimationFrame(() => {
            updateTurnDisplay();
          });
          return;
        }

        // AI 鐨勭Щ鍔?- 璁板綍鏃ュ織
        console.log('AI 绉诲姩:', position);

        // 鑾峰彇妫嬪瓙鍚嶇О鐢ㄤ簬璁板綍
        const pieceCell = board[position.toR][position.toC];
        const pieceType = pieceCell ? pieceCell.substring(2) : '';
        const pieceName = chessPieceMap[pieceType] || '';

        gameState.moveCount++;
        gameState.moveLog.push({
          color: color,
          fromR: position.fromR,
          fromC: position.fromC,
          toR: position.toR,
          toC: position.toC,
          piece: pieceName,
          isOpponent: true
        });
        gameState.moveTimestamps.push(Date.now());

        clearChessSelection();

        requestAnimationFrame(() => {
          updateTurnDisplay();
          updateLastMove(position.toR, position.toC, color);
          updateMoveCount();
          updateColorCount();
          updateMoveLog();
          updateAdvancedStats();
        });

        updateStatus(`馃 AI宸茬Щ鍔ㄥ埌 (${position.toR},${position.toC})锛屼綘鐨勫洖鍚坄);

        const winResult = checkChessWin();
        if (winResult) {
          gameState.gameOver = true;
          const isPlayerWin = winResult.winner === gameState.me;
          const winMsg = isPlayerWin ? '浣犺幏鑳滀簡锛? : '浣犺緭浜嗭紒';
          const winColor = winResult.winner === 1 ? '绾㈡柟' : '榛戞柟';
          winnerEl.textContent = winColor;
          winnerEl.className = `info-value ${winResult.winner === 1 ? 'value-red' : 'value-green'}`;
          gameStatusEl.textContent = `娓告垙缁撴潫 - ${winResult.reason}`;
          gameStatusEl.className = 'info-value value-waiting';
          showWinAlert(winMsg);
          updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫 - ${winResult.reason}`);
          updateAdvancedStats();
        }
      } else {
        // 妫€鏌ヤ綅缃槸鍚﹀凡缁忔湁妫嬪瓙锛堥槻姝㈤噸澶嶈褰曠敤鎴风殑钀藉瓙锛?
        if (currentGame === 'gobang' || currentGame === 'go') {
          if (gameState.board[position.r][position.c] !== 0) {
            console.log('浣嶇疆宸叉湁妫嬪瓙锛岃烦杩嘇I绉诲姩缁撴灉:', data);
            // 鍙洿鏂板洖鍚堬紝涓嶈褰曡惤瀛?
            gameState.turn = currentPlayer;
            return;
          }
        }

        // 鎵цAI绉诲姩锛堜娇鐢╟olor浣滀负褰撳墠绉诲姩鐨勯鑹诧級
        if (currentGame === 'gobang') {
          handleGobangAIMove(position.r, position.c, color);
        } else if (currentGame === 'go') {
          handleGoAIMove(position.r, position.c, color);
        }
      }

      // 鏇存柊娓告垙鐘舵€佷负涓嬩竴鍥炲悎
      gameState.turn = currentPlayer;
    }

    // 鐢熸垚闅忔満钀藉瓙锛堢畝鍗曢毦搴︼級
    function generateRandomMove() {
      const config = gameConfigs[currentGame];
      const emptyCells = [];

      if (currentGame === 'gobang' || currentGame === 'go') {
        for (let r = 0; r < config.size; r++) {
          for (let c = 0; c < config.size; c++) {
            if (gameState.board[r][c] === 0) {
              emptyCells.push({ r, c });
            }
          }
        }
      } else if (currentGame === 'chinese-chess') {
        // 璞℃闅忔満绉诲姩
        const pieces = document.querySelectorAll('.chess-piece');
        pieces.forEach(piece => {
          if (piece.dataset.color === (gameState.turn === 1 ? 'red' : 'black')) {
            const r = parseInt(piece.dataset.r);
            const c = parseInt(piece.dataset.c);
            const validMoves = calculateChessMoves(r, c, piece.dataset.name, piece.dataset.color);
            if (validMoves.length > 0) {
              const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
              emptyCells.push({ fromR: r, fromC: c, toR: randomMove.r, toC: randomMove.c });
            }
          }
        });
      }

      if (emptyCells.length > 0) {
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
      }
      return null;
    }

    // 鐢熸垚涓瓑闅惧害钀藉瓙
    function generateMediumMove() {
      if (currentGame === 'gobang') {
        return generateGobangMediumMove();
      } else if (currentGame === 'go') {
        return generateGoMediumMove();
      } else if (currentGame === 'chinese-chess') {
        return generateChessMediumMove();
      }
      return generateRandomMove();
    }

    // 鐢熸垚鍥伴毦闅惧害钀藉瓙
    function generateHardMove() {
      if (currentGame === 'gobang') {
        return generateGobangHardMove();
      } else if (currentGame === 'go') {
        return generateGoHardMove();
      } else if (currentGame === 'chinese-chess') {
        return generateChessHardMove();
      }
      return generateRandomMove();
    }

    // ========== 浜斿瓙妫婣I绠楁硶 ==========

    // 浜斿瓙妫嬩腑绛夐毦搴︼細鍩轰簬瑙勫垯鐨凙I
    function generateGobangMediumMove() {
      const aiPlayer = gameState.turn;
      const humanPlayer = 3 - aiPlayer;

      // 1. 妫€鏌ユ槸鍚﹀彲浠ヨ耽
      const winningMove = findGobangWinningMove(aiPlayer);
      if (winningMove) return winningMove;

      // 2. 妫€鏌ユ槸鍚﹂渶瑕侀槻瀹堬紙瀵规墜鍗冲皢鑾疯儨锛?
      const defensiveMove = findGobangWinningMove(humanPlayer);
      if (defensiveMove) return defensiveMove;

      // 3. 妫€鏌ユ槸鍚﹀彲浠ュ舰鎴愭椿鍥?
      const liveFourMove = findGobangPattern(aiPlayer, 'liveFour');
      if (liveFourMove) return liveFourMove;

      // 4. 闃插畧瀵规墜鐨勬椿鍥?
      const blockLiveFour = findGobangPattern(humanPlayer, 'liveFour');
      if (blockLiveFour) return blockLiveFour;

      // 5. 妫€鏌ユ槸鍚﹀彲浠ュ舰鎴愭椿涓?
      const liveThreeMove = findGobangPattern(aiPlayer, 'liveThree');
      if (liveThreeMove) return liveThreeMove;

      // 6. 闃插畧瀵规墜鐨勬椿涓?
      const blockLiveThree = findGobangPattern(humanPlayer, 'liveThree');
      if (blockLiveThree) return blockLiveThree;

      // 7. 妫€鏌ユ槸鍚﹀彲浠ュ舰鎴愮湢涓?
      const sleepThreeMove = findGobangPattern(aiPlayer, 'sleepThree');
      if (sleepThreeMove) return sleepThreeMove;

      // 8. 妫€鏌ユ槸鍚﹀彲浠ュ舰鎴愭椿浜?
      const liveTwoMove = findGobangPattern(aiPlayer, 'liveTwo');
      if (liveTwoMove) return liveTwoMove;

      // 9. 鍦ㄤ腑蹇冮檮杩戣惤瀛?
      const centerMove = findGobangCenterMove();
      if (centerMove) return centerMove;

      // 10. 闅忔満钀藉瓙
      return generateRandomMove();
    }

    // 浜斿瓙妫嬪洶闅鹃毦搴︼細浣跨敤Minimax绠楁硶
    function generateGobangHardMove() {
      const aiPlayer = gameState.turn;

      // 棣栧厛妫€鏌ュ繀鑳滃拰蹇呴槻
      const winningMove = findGobangWinningMove(aiPlayer);
      if (winningMove) return winningMove;

      const defensiveMove = findGobangWinningMove(3 - aiPlayer);
      if (defensiveMove) return defensiveMove;

      // 浣跨敤Minimax绠楁硶
      const bestMove = gobangMinimax(3, aiPlayer, -Infinity, Infinity, true);
      return bestMove.move || generateRandomMove();
    }

    // Minimax绠楁硶
    function gobangMinimax(depth, player, alpha, beta, isMaximizing) {
      if (depth === 0) {
        return { score: evaluateGobangBoard(player) };
      }

      const emptyCells = getGobangEmptyCells();
      if (emptyCells.length === 0) {
        return { score: 0 };
      }

      // 鍙€冭檻鏈夋瀛愰檮杩戠殑绌轰綅
      const candidateCells = getCandidateCells(emptyCells);

      if (isMaximizing) {
        let bestScore = -Infinity;
        let bestMove = null;

        for (const cell of candidateCells) {
          gameState.board[cell.r][cell.c] = player;

          if (checkGobangWin(cell.r, cell.c, player)) {
            gameState.board[cell.r][cell.c] = 0;
            return { score: 100000, move: cell };
          }

          const result = gobangMinimax(depth - 1, player, alpha, beta, false);
          gameState.board[cell.r][cell.c] = 0;

          if (result.score > bestScore) {
            bestScore = result.score;
            bestMove = cell;
          }

          alpha = Math.max(alpha, bestScore);
          if (beta <= alpha) break;
        }

        return { score: bestScore, move: bestMove };
      } else {
        let bestScore = Infinity;
        let bestMove = null;
        const opponent = 3 - player;

        for (const cell of candidateCells) {
          gameState.board[cell.r][cell.c] = opponent;

          if (checkGobangWin(cell.r, cell.c, opponent)) {
            gameState.board[cell.r][cell.c] = 0;
            return { score: -100000, move: cell };
          }

          const result = gobangMinimax(depth - 1, player, alpha, beta, true);
          gameState.board[cell.r][cell.c] = 0;

          if (result.score < bestScore) {
            bestScore = result.score;
            bestMove = cell;
          }

          beta = Math.min(beta, bestScore);
          if (beta <= alpha) break;
        }

        return { score: bestScore, move: bestMove };
      }
    }

    // 璇勪及妫嬬洏鍒嗘暟
    function evaluateGobangBoard(player) {
      let score = 0;
      const opponent = 3 - player;

      // 璇勪及鎵€鏈夋柟鍚?
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (gameState.board[r][c] === player) {
            score += evaluateGobangPosition(r, c, player);
          } else if (gameState.board[r][c] === opponent) {
            score -= evaluateGobangPosition(r, c, opponent);
          }
        }
      }

      return score;
    }

    // 璇勪及浣嶇疆鍒嗘暟
    function evaluateGobangPosition(r, c, player) {
      let score = 0;
      const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

      for (const [dr, dc] of directions) {
        const line = getGobangLine(r, c, dr, dc, player);
        score += evaluateGobangLine(line, player);
      }

      // 涓績浣嶇疆鍔犲垎
      const centerDistance = Math.abs(r - 7) + Math.abs(c - 7);
      score += Math.max(0, 7 - centerDistance);

      return score;
    }

    // 鑾峰彇涓€鏉＄嚎
    function getGobangLine(r, c, dr, dc, player) {
      const line = [];

      for (let i = -4; i <= 4; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;

        if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15) {
          line.push({ r: nr, c: nc, value: gameState.board[nr][nc] });
        }
      }

      return line;
    }

    // 璇勪及涓€鏉＄嚎鐨勫垎鏁?
    function evaluateGobangLine(line, player) {
      const opponent = 3 - player;
      let score = 0;
      let count = 0;
      let empty = 0;
      let blocked = 0;

      for (const cell of line) {
        if (cell.value === player) {
          count++;
        } else if (cell.value === 0) {
          empty++;
        } else {
          blocked++;
        }
      }

      if (blocked === 0) {
        if (count === 5) score = 100000;
        else if (count === 4) score = 10000;
        else if (count === 3) score = 1000;
        else if (count === 2) score = 100;
        else if (count === 1) score = 10;
      } else if (blocked === 1) {
        if (count === 4) score = 1000;
        else if (count === 3) score = 100;
        else if (count === 2) score = 10;
      }

      return score;
    }

    // 鑾峰彇绌轰綅
    function getGobangEmptyCells() {
      const cells = [];
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (gameState.board[r][c] === 0) {
            cells.push({ r, c });
          }
        }
      }
      return cells;
    }

    // 鑾峰彇鍊欓€変綅缃紙鏈夋瀛愰檮杩戠殑绌轰綅锛?
    function getCandidateCells(emptyCells) {
      const candidates = [];
      const checked = new Set();

      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (gameState.board[r][c] !== 0) {
            // 妫€鏌ュ懆鍥寸殑绌轰綅
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                const key = `${nr},${nc}`;

                if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 &&
                  gameState.board[nr][nc] === 0 && !checked.has(key)) {
                  candidates.push({ r: nr, c: nc });
                  checked.add(key);
                }
              }
            }
          }
        }
      }

      return candidates.length > 0 ? candidates : emptyCells.slice(0, 20);
    }

    // 鏌ユ壘鑾疯儨浣嶇疆
    function findGobangWinningMove(player) {
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (gameState.board[r][c] === 0) {
            gameState.board[r][c] = player;
            if (checkGobangWin(r, c, player)) {
              gameState.board[r][c] = 0;
              return { r, c };
            }
            gameState.board[r][c] = 0;
          }
        }
      }
      return null;
    }

    // 鏌ユ壘鐗瑰畾妫嬪瀷
    function findGobangPattern(player, pattern) {
      const patterns = {
        liveFour: [[0, player, player, player, player, 0]],
        liveThree: [[0, player, player, player, 0], [0, player, 0, player, player, 0], [0, player, player, 0, player, 0]],
        sleepThree: [[player, player, player, 0], [0, player, player, player], [player, 0, player, player], [player, player, 0, player]],
        liveTwo: [[0, player, player, 0], [0, player, 0, player, 0]]
      };

      const targetPatterns = patterns[pattern] || [];
      const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          for (const [dr, dc] of directions) {
            for (const targetPattern of targetPatterns) {
              const result = matchGobangPattern(r, c, dr, dc, targetPattern, player);
              if (result) return result;
            }
          }
        }
      }

      return null;
    }

    // 鍖归厤妫嬪瀷
    function matchGobangPattern(startR, startC, dr, dc, pattern, player) {
      const opponent = 3 - player;

      for (let offset = -5; offset <= 5; offset++) {
        let match = true;
        let emptyPos = null;

        for (let i = 0; i < pattern.length; i++) {
          const r = startR + dr * (offset + i);
          const c = startC + dc * (offset + i);

          if (r < 0 || r >= 15 || c < 0 || c >= 15) {
            match = false;
            break;
          }

          const expected = pattern[i];
          const actual = gameState.board[r][c];

          if (expected === player && actual !== player) {
            match = false;
            break;
          }

          if (expected === 0 && actual !== 0) {
            match = false;
            break;
          }

          if (expected === 0) {
            emptyPos = { r, c };
          }
        }

        if (match && emptyPos) {
          return emptyPos;
        }
      }

      return null;
    }

    // 鍦ㄤ腑蹇冮檮杩戞壘钀藉瓙浣嶇疆
    function findGobangCenterMove() {
      const centerR = 7;
      const centerC = 7;

      for (let distance = 0; distance <= 7; distance++) {
        for (let dr = -distance; dr <= distance; dr++) {
          for (let dc = -distance; dc <= distance; dc++) {
            const r = centerR + dr;
            const c = centerC + dc;

            if (r >= 0 && r < 15 && c >= 0 && c < 15 && gameState.board[r][c] === 0) {
              return { r, c };
            }
          }
        }
      }

      return null;
    }

    // ========== 鍥存AI绠楁硶 ==========

    function generateGoMediumMove() {
      // 鍥存涓瓑闅惧害锛氫紭鍏堝崰鎹鍜岃竟
      const corners = [[3, 3], [3, 15], [15, 3], [15, 15]];
      const edges = [];

      for (let i = 3; i <= 15; i += 3) {
        edges.push([3, i], [15, i], [i, 3], [i, 15]);
      }

      // 浼樺厛瑙掕惤
      for (const [r, c] of corners) {
        if (gameState.board[r] && gameState.board[r][c] === 0) {
          return { r, c };
        }
      }

      // 鍏舵杈?
      for (const [r, c] of edges) {
        if (gameState.board[r] && gameState.board[r][c] === 0) {
          return { r, c };
        }
      }

      return generateRandomMove();
    }

    function generateGoHardMove() {
      // 鍥存鍥伴毦闅惧害锛氳€冭檻鏇村绛栫暐
      // 绠€鍖栧疄鐜帮細浼樺厛鍗犳嵁鏈夊埄浣嶇疆
      const priorityPositions = [
        [3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15],
        [3, 6], [3, 12], [6, 3], [6, 9], [6, 15], [9, 6], [9, 12], [12, 3], [12, 9], [12, 15], [15, 6], [15, 12]
      ];

      for (const [r, c] of priorityPositions) {
        if (gameState.board[r] && gameState.board[r][c] === 0) {
          return { r, c };
        }
      }

      return generateRandomMove();
    }

    // ========== 璞℃AI绠楁硶 ==========

    function generateChessMediumMove() {
      const pieces = document.querySelectorAll('.chess-piece');
      const aiColor = gameState.turn === 1 ? 'red' : 'black';
      const moves = [];

      pieces.forEach(piece => {
        if (piece.dataset.color === aiColor) {
          const r = parseInt(piece.dataset.r);
          const c = parseInt(piece.dataset.c);
          const validMoves = calculateChessMoves(r, c, piece.dataset.name, parseInt(piece.dataset.color));

          validMoves.forEach(move => {
            const score = evaluateChessMove(r, c, move.r, move.c, piece.dataset.name);
            moves.push({ fromR: r, fromC: c, toR: move.r, toC: move.c, score });
          });
        }
      });

      if (moves.length === 0) return null;

      // 閫夋嫨寰楀垎鏈€楂樼殑绉诲姩
      moves.sort((a, b) => b.score - a.score);
      return moves[0];
    }

    function generateChessHardMove() {
      // 璞℃鍥伴毦闅惧害锛氭洿娣卞叆鐨勮瘎浼?
      return generateChessMediumMove();
    }

    // 璇勪及璞℃绉诲姩鍒嗘暟
    function evaluateChessMove(fromR, fromC, toR, toC, pieceName) {
      let score = 0;

      // 妫€鏌ユ槸鍚﹀彲浠ュ悆瀛?
      const targetPiece = getChessPieceAt(toR, toC);
      if (targetPiece) {
        const pieceValues = {
          '灏?: 10000, '甯?: 10000,
          '杞?: 900, '棣?: 400, '璞?: 200, '澹?: 200, '鐐?: 450, '鍏?: 100, '鍗?: 100
        };
        score += pieceValues[targetPiece.dataset.name] || 100;
      }

      // 浣嶇疆鍒嗘暟锛氭帶鍒朵腑蹇?
      const centerDistance = Math.abs(toR - 4.5) + Math.abs(toC - 4.5);
      score += Math.max(0, 5 - centerDistance);

      // 杩囨渤鍔犲垎锛堝叺鍗掞級
      if ((pieceName === '鍏? && toR >= 5) || (pieceName === '鍗? && toR <= 4)) {
        score += 50;
      }

      return score;
    }

    // 澶勭悊浜斿瓙妫婣I钀藉瓙
    function handleGobangAIMove(r, c, color) {
      gameState.board[r][c] = color;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: color,
        r: r,
        c: c,
        isOpponent: true
      });
      gameState.moveTimestamps.push(Date.now());

      if (color === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, color);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃 AI宸茶惤瀛?(${r},${c})锛屼綘鐨勫洖鍚坄);

      if (checkGobangWin(r, c, color)) {
        gameState.gameOver = true;
        const winMsg = color === 1 ? '榛戞鑾疯儨锛? : '鐧芥鑾疯儨锛?;
        const winColor = color === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${color === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStateEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();

        // 鍙戦€?AI 娓告垙缁撴灉
        sendAIGameResult('loss');
      }
      // 娉ㄦ剰锛氬洖鍚堝垏鎹㈠凡缁忓湪 handleAIMoveResult 涓鐞嗭紝杩欓噷涓嶉渶瑕佸啀鍒囨崲
    }

    // 澶勭悊鍥存AI钀藉瓙
    function handleGoAIMove(r, c, color) {
      gameState.board[r][c] = color;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: color,
        r: r,
        c: c,
        isOpponent: true
      });
      gameState.moveTimestamps.push(Date.now());

      if (color === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, color);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃 AI宸茶惤瀛?(${r},${c})锛屼綘鐨勫洖鍚坄);
      // 娉ㄦ剰锛氬洖鍚堝垏鎹㈠凡缁忓湪 handleAIMoveResult 涓鐞嗭紝杩欓噷涓嶉渶瑕佸啀鍒囨崲
    }

    // 澶勭悊璞℃AI钀藉瓙
    function handleChessAIMove(fromR, fromC, toR, toC, color) {
      const piece = getChessPieceAt(fromR, fromC);
      if (!piece) return;

      // 1. 鍏堟鏌ユ槸鍚︽湁瀵规柟妫嬪瓙鍦ㄧ洰鏍囦綅缃紙鍚冨瓙锛?
      const capturedPiece = getChessPieceAt(toR, toC);
      if (capturedPiece) {
        // 浠?chessPieces 鏁版嵁涓Щ闄よ鍚冪殑妫嬪瓙
        const capturedColor = capturedPiece.dataset.color;
        if (capturedColor === 'red') {
          chessPieces.red = chessPieces.red.filter(p => !(p.r === toR && p.c === toC));
        } else {
          chessPieces.black = chessPieces.black.filter(p => !(p.r === toR && p.c === toC));
        }
        // 浠?DOM 涓Щ闄?
        capturedPiece.remove();
      }

      // 2. 鏇存柊 chessPieces 鏁版嵁涓殑妫嬪瓙浣嶇疆
      const pieceColor = piece.dataset.color;
      const pieceName = piece.dataset.name;
      if (pieceColor === 'red') {
        const pieceIndex = chessPieces.red.findIndex(p => p.r === fromR && p.c === fromC);
        if (pieceIndex !== -1) {
          chessPieces.red[pieceIndex].r = toR;
          chessPieces.red[pieceIndex].c = toC;
        }
      } else {
        const pieceIndex = chessPieces.black.findIndex(p => p.r === fromR && p.c === fromC);
        if (pieceIndex !== -1) {
          chessPieces.black[pieceIndex].r = toR;
          chessPieces.black[pieceIndex].c = toC;
        }
      }

      // 3. 鏇存柊 DOM 涓殑妫嬪瓙浣嶇疆
      piece.dataset.r = toR;
      piece.dataset.c = toC;
      piece.style.top = `${toR * 40 + 20}px`;
      piece.style.left = `${toC * 40 + 20}px`;
      piece.style.transform = 'translate(-50%, -50%)';

      // 4. 鍚屾 gameState.board
      gameState.board = convertFrontendPiecesToBackend();

      // 鏇存柊娓告垙鐘舵€?
      gameState.moveCount++;
      gameState.moveLog.push({
        color: color,
        piece: pieceName,
        fromR: fromR,
        fromC: fromC,
        toR: toR,
        toC: toC,
        isOpponent: true
      });
      gameState.moveTimestamps.push(Date.now());

      clearChessSelection();

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(toR, toC, gameState.turn);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
      });

      updateStatus(`馃 AI宸茬Щ鍔?${pieceName} 鍒?(${toR},${toC})锛屼綘鐨勫洖鍚坄);

      if (checkChessWin()) {
        gameState.gameOver = true;
        const winMsg = gameState.turn === 1 ? '绾㈡柟鑾疯儨锛? : '榛戞柟鑾疯儨锛?;
        const winColor = gameState.turn === 1 ? '绾㈡柟' : '榛戞柟';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${gameState.turn === 1 ? 'value-red' : 'value-green'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();
      }
      // 娉ㄦ剰锛氬洖鍚堝垏鎹㈠凡缁忓湪 handleAIMoveResult 涓鐞嗭紝杩欓噷涓嶉渶瑕佸啀鍒囨崲
    }

    function playAgain() {
      // 妫€鏌ユ槸鍚︽槸AI瀵规垬
      if (gameState.difficulty) {
        // AI瀵规垬锛岀洿鎺ラ噸鏂板紑濮?
        restartAIGame();
      } else {
        // PVP瀵规垬锛屽彂閫侀噸缃姹?
        socket.emit('reset', {
          message: '瀵规柟璇锋眰鍐嶆潵涓€灞€'
        });
        updateStatus('鈴?绛夊緟瀵规柟鍚屾剰鍐嶆潵涓€灞€...');
      }
    }

    // AI瀵规垬鍐嶆潵涓€鎶?
    function restartAIGame() {
      // 閲嶇疆娓告垙鐘舵€?- 瀹屽叏閲嶇疆涓哄垵濮嬬姸鎬?
      gameState.gameType = currentGame;
      gameState.player = 1;
      gameState.difficulty = gameState.difficulty;
      gameState.me = 1;
      gameState.turn = 1;
      gameState.gameOver = false;
      gameState.moveCount = 0;
      gameState.moveLog = [];
      gameState.blackCount = 0;
      gameState.whiteCount = 0;
      gameState.gameStartTime = Date.now();
      gameState.maxChain = 0;
      gameState.moveTimestamps = [];
      gameState.selectedPiece = null;
      gameState.validMoves = [];
      gameState.lastMove = null;
      currentPlayer = 1;

      // 閲嶇疆妫嬬洏鏁扮粍鍜孶I
      initGameBoard();

      // 閲嶆柊娓叉煋妫嬬洏
      if (currentGame === 'gobang' || currentGame === 'go') {
        renderBoard();
      } else if (currentGame === 'chinese-chess') {
        renderChessPieces();
      }

      // 閲嶇疆UI
      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
      }

      winnerEl.textContent = '-';
      winnerEl.className = 'info-value';
      gameStatusEl.textContent = '娓告垙涓?;
      gameStatusEl.className = 'info-value value-connected';

      // 閲嶇疆鐜╁棰滆壊鏄剧ず
      const config = gameConfigs[currentGame];
      const myColorText = config.colorNames[0];
      myColorEl.textContent = myColorText;
      myColorEl.className = `info-value ${currentGame === 'chinese-chess' ? 'value-red' : 'value-black'}`;

      // 閲嶆柊寮€濮嬭鏃?
      gameState.gameStartTime = Date.now();
      if (gameState.gameTimer) clearInterval(gameState.gameTimer);
      gameState.gameTimer = setInterval(updateGameTime, 1000);

      // 鏇存柊鏄剧ず
      updateTurnDisplay();
      updateMoveCount();
      updateColorCount();
      updateMoveLog();
      updateAdvancedStats();

      // 鏇存柊鐘舵€?
      const difficultyText = gameState.difficulty === 'easy' ? '绠€鍗? : gameState.difficulty === 'medium' ? '涓瓑' : '鍥伴毦';
      updateStatus(`馃幃 姝ｅ湪涓?{difficultyText}AI瀵规垬锛屼綘鍏堣惤瀛愶紒`);

      // 閫氱煡鏈嶅姟鍣ㄩ噸鏂板紑濮婣I瀵规垬
      if (socket) {
        socket.emit('ai_game_start', {
          gameType: currentGame,
          difficulty: gameState.difficulty
        });
      }
    }

    // 鏄剧ず娓告垙缁撴潫缁撴灉锛堝洿妫嬬偣鐩級
    function showGameResult() {
      if (currentGame === 'go') {
        const score = countGoScore();
        const winner = score.black > score.white ? '榛戞' : '鐧芥';
        const diff = Math.abs(score.black - score.white).toFixed(1);

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'game-result-modal';
        modal.innerHTML = `
          <div class="modal" style="max-width: 500px;">
            <div class="modal-title">
              <span>馃弫 娓告垙缁撴潫 - 鏁板瓙缁撴灉</span>
              <button class="modal-close" onclick="closeGameResultModal()">&times;</button>
            </div>
            <div class="modal-content" style="text-align: center; padding: 20px;">
              <h2 style="color: ${score.black > score.white ? '#000' : '#666'}; margin-bottom: 20px;">
                ${winner}鑾疯儨锛?
              </h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div style="background: #000; color: white; padding: 15px; border-radius: 8px;">
                  <div style="font-size: 24px; font-weight: bold;">榛戞</div>
                  <div style="font-size: 36px; font-weight: bold; margin-top: 10px;">${score.black.toFixed(1)}</div>
                  <div style="font-size: 14px; opacity: 0.8;">瀛愭暟锛?{gameState.blackCount}</div>
                  <div style="font-size: 14px; opacity: 0.8;">棰嗗湴锛?{(score.black - gameState.blackCount).toFixed(1)}</div>
                </div>
                <div style="background: #fff; color: #000; padding: 15px; border-radius: 8px; border: 2px solid #ccc;">
                  <div style="font-size: 24px; font-weight: bold;">鐧芥</div>
                  <div style="font-size: 36px; font-weight: bold; margin-top: 10px;">${score.white.toFixed(1)}</div>
                  <div style="font-size: 14px; opacity: 0.8;">瀛愭暟锛?{gameState.whiteCount}</div>
                  <div style="font-size: 14px; opacity: 0.8;">棰嗗湴锛?{(score.white - gameState.whiteCount).toFixed(1)}</div>
                  <div style="font-size: 12px; margin-top: 5px; color: #666;">璐寸洰锛?.5</div>
                </div>
              </div>
              <div style="font-size: 18px; font-weight: bold; color: #2c3e50;">
                鑳滆礋宸細${diff}瀛?
              </div>
              <button onclick="closeGameResultModal()" style="margin-top: 20px; padding: 10px 30px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px;">
                纭畾
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'flex';
      }
    }

    // 鍏抽棴娓告垙缁撴灉妯℃€佹
    function closeGameResultModal() {
      const modal = document.getElementById('game-result-modal');
      if (modal) {
        modal.remove();
      }
    }

    function resetGame(sendToServer) {
      const playAgainBtn = document.getElementById('play-again-btn');
      if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
      }

      if (sendToServer) {
        // 鍙戦€侀噸缃姹傜粰鏈嶅姟鍣紝绛夊緟瀵规柟纭
        socket.emit('reset');
        // 涓嶇珛鍗抽噸缃湰鍦版父鎴忥紝绛夊緟鏈嶅姟鍣ㄧ‘璁?
        return;
      }

      // 鍙湁鏀跺埌鏈嶅姟鍣ㄧ‘璁ゆ垨鏈湴閲嶇疆鏃舵墠鎵ц閲嶇疆
      initGameBoard();
      gameState.turn = 1;
      gameState.gameOver = false;
      gameState.moveCount = 0;
      gameState.moveLog = [];
      gameState.blackCount = 0;
      gameState.whiteCount = 0;
      gameState.gameStartTime = Date.now();
      gameState.maxChain = 0;
      gameState.moveTimestamps = [];
      gameState.selectedPiece = null;
      gameState.validMoves = [];

      winnerEl.textContent = '--';
      winnerEl.className = 'info-value';
      gameStatusEl.textContent = '娓告垙涓?;
      gameStatusEl.className = 'info-value value-connected';

      updateTurnDisplay();
      updateMoveCount();
      updateColorCount();
      updateMoveLog();
      updateAdvancedStats();
      renderBoard();

      if (currentGame === 'gobang') {
        updateStatus('馃幃 娓告垙宸查噸缃紝' + (gameState.me === 1 ? '浣犲厛钀藉瓙锛? : '绛夊緟瀵规柟钀藉瓙锛?));
      } else if (currentGame === 'chinese-chess') {
        updateStatus('馃幃 娓告垙宸查噸缃紝绾㈡柟鍏堣锛?);
      }
    }

    // 鑷畾涔夌‘璁ゆā鎬佹浜嬩欢澶勭悊
    document.addEventListener('DOMContentLoaded', () => {
      const confirmModal = document.getElementById('custom-confirm-modal');
      const confirmYesBtn = document.getElementById('confirm-yes');
      const confirmNoBtn = document.getElementById('confirm-no');

      // 鍚屾剰鎸夐挳
      confirmYesBtn.addEventListener('click', () => {
        confirmModal.style.display = 'none';

        if (currentResetRequest) {
          const playAgainBtn = document.getElementById('play-again-btn');
          if (playAgainBtn) {
            playAgainBtn.style.display = 'none';
          }
          socket.emit('reset_confirm');
          resetGame(false);
        }

        currentResetRequest = null;
      });

      // 鎷掔粷鎸夐挳
      confirmNoBtn.addEventListener('click', () => {
        confirmModal.style.display = 'none';

        // 閫氱煡鏈嶅姟鍣ㄦ嫆缁濋噸缃姹?
        if (currentResetRequest && socket) {
          socket.emit('reset_reject', {
            requestId: currentResetRequest.requestId
          });
        }

        currentResetRequest = null;
      });

      // 鐐瑰嚮妯℃€佹鑳屾櫙鍏抽棴
      confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
          confirmModal.style.display = 'none';
          currentResetRequest = null;
        }
      });
    });

    // ========== 妫嬬洏鐐瑰嚮浜嬩欢 ==========
    function handleGobangClick(r, c) {
      if (gameState.gameOver || gameState.turn !== gameState.me) return;
      if (gameState.board[r][c] !== 0) return;

      gameState.board[r][c] = gameState.me;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: gameState.me,
        r: r,
        c: c,
        isOpponent: false
      });
      gameState.moveTimestamps.push(Date.now());

      if (gameState.me === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      const chain = calculateGobangChain(r, c, gameState.me);
      if (chain > gameState.maxChain) {
        gameState.maxChain = chain;
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, gameState.me);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃搶 浣犲凡钀藉瓙(${r}, ${c})锛岀瓑寰呭鏂瑰洖鍚坄);

      // 妫€鏌ユ槸鍚︽槸AI瀵规垬
      if (gameState.difficulty) {
        // AI瀵规垬锛屽彂閫佺Щ鍔ㄧ粰鏈嶅姟鍣?
        if (socket) {
          socket.emit('ai_move', {
            position: { r, c }
          });
        }
      } else {
        // PVP瀵规垬
        socket.emit('move', {
          game: currentGame,
          r: r,
          c: c,
          color: gameState.me
        });
      }

      if (checkGobangWin(r, c, gameState.me)) {
        gameState.gameOver = true;
        const winMsg = '浣犺幏鑳滀簡锛?;
        const winColor = gameState.me === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${gameState.me === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();

        if (gameState.difficulty) {
          // AI瀵规垬
          sendAIGameResult('win');
        } else {
          // PVP瀵规垬
          socket.emit('game_result', {
            result: 'win',
            reason: '浜斿瓙杩炵彔'
          });
        }
      } else {
        gameState.turn = 3 - gameState.me;
        updateTurnDisplay();
      }
    }

    function handleGoClick(r, c) {
      if (gameState.gameOver || gameState.turn !== gameState.me) return;
      if (gameState.board[r][c] !== 0) return;

      gameState.board[r][c] = gameState.me;
      gameState.moveCount++;
      gameState.moveLog.push({
        color: gameState.me,
        r: r,
        c: c,
        isOpponent: false
      });
      gameState.moveTimestamps.push(Date.now());

      if (gameState.me === 1) {
        gameState.blackCount++;
      } else {
        gameState.whiteCount++;
      }

      requestAnimationFrame(() => {
        updateTurnDisplay();
        updateLastMove(r, c, gameState.me);
        updateMoveCount();
        updateColorCount();
        updateMoveLog();
        updateAdvancedStats();
        renderBoard();
      });

      updateStatus(`馃搶 浣犲凡钀藉瓙(${r}, ${c})锛岀瓑寰呭鏂瑰洖鍚坄);

      // 妫€鏌ユ槸鍚︽槸AI瀵规垬
      if (gameState.difficulty) {
        // AI瀵规垬锛屽彂閫佺Щ鍔ㄧ粰鏈嶅姟鍣?
        if (socket) {
          socket.emit('ai_move', {
            position: { r, c }
          });
        }
      } else {
        // PVP瀵规垬
        socket.emit('move', {
          game: currentGame,
          r: r,
          c: c,
          color: gameState.me
        });
      }

      if (checkGoWin()) {
        gameState.gameOver = true;
        const winMsg = gameState.me === 1 ? '榛戞鑾疯儨锛? : '鐧芥鑾疯儨锛?;
        const winColor = gameState.me === 1 ? '榛戞' : '鐧芥';
        winnerEl.textContent = winColor;
        winnerEl.className = `info-value ${gameState.me === 1 ? 'value-black' : 'value-white'}`;
        gameStatusEl.textContent = '娓告垙缁撴潫';
        gameStatusEl.className = 'info-value value-waiting';
        showWinAlert(winMsg);
        updateStatus(`馃弳 ${winMsg} 娓告垙缁撴潫`);
        updateAdvancedStats();

        if (gameState.difficulty) {
          // AI瀵规垬
          sendAIGameResult('win');
        } else {
          // PVP瀵规垬
          socket.emit('game_result', {
            result: 'win',
            reason: '妫嬬洏濉弧'
          });
        }
      } else {
        gameState.turn = 3 - gameState.me;
        updateTurnDisplay();
      }
    }

    // ========== 浜斿瓙妫嬭儨璐熷垽瀹?==========
    function calculateGobangChain(r, c, color) {
      const config = gameConfigs.gobang;
      let maxChain = 0;

      const directions = [
        [0, 1], [1, 0], [1, 1], [1, -1]
      ];

      for (const [dr, dc] of directions) {
        let count = 1;

        for (let i = 1; i < 5; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr >= 0 && nr < config.size && nc >= 0 && nc < config.size &&
            gameState.board[nr][nc] === color) {
            count++;
          } else {
            break;
          }
        }

        for (let i = 1; i < 5; i++) {
          const nr = r - dr * i;
          const nc = c - dc * i;
          if (nr >= 0 && nr < config.size && nc >= 0 && nc < config.size &&
            gameState.board[nr][nc] === color) {
            count++;
          } else {
            break;
          }
        }

        if (count > maxChain) {
          maxChain = count;
        }
      }

      return maxChain;
    }

    function checkGobangWin(r, c, color) {
      return calculateGobangChain(r, c, color) >= 5;
    }

    // ========== 璐﹀彿绯荤粺鍑芥暟 ==========

    function updateAccountBar() {
      const accountBar = document.getElementById('account-bar');
      if (currentAccount) {
        // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
        let accountType, nickname, username, level, exp, starCoins;
        let undoCount = 0, hintCount = 0;
        if (currentAccount.account.account) {
          // 璐﹀彿鐧诲綍鐨勬暟鎹粨鏋?
          accountType = currentAccount.account.account.type;
          nickname = currentAccount.account.account.nickname;
          username = currentAccount.account.account.username;
          level = currentAccount.account.account.profile?.level || 1;
          exp = currentAccount.account.account.profile?.exp || 0;
          starCoins = currentAccount.account.currency?.starCoins || 0;
          undoCount = currentAccount.account.inventory?.undoCount || 0;
          hintCount = currentAccount.account.inventory?.hintCount || 0;
          // 鍔犱笂閬撳叿鍗″彲鍏戞崲鐨勬鏁帮紙姣忓紶鎮旀鍗?3娆★紝姣忓紶鎻愮ず鍗?5娆★級
          const items = currentAccount.account.inventory?.items || {};
          undoCount += (items.item_undo || 0) * 3;
          hintCount += (items.item_hint || 0) * 5;
        } else {
          // 娓稿鐧诲綍鐨勬暟鎹粨鏋?
          accountType = currentAccount.account.type;
          nickname = currentAccount.account.nickname;
          username = currentAccount.account.username;
          level = currentAccount.account.profile?.level || 1;
          exp = currentAccount.account.profile?.exp || 0;
          starCoins = currentAccount.currency?.starCoins || 0;
          undoCount = currentAccount.account.inventory?.undoCount || 0;
          hintCount = currentAccount.account.inventory?.hintCount || 0;
          // 鍔犱笂閬撳叿鍗″彲鍏戞崲鐨勬鏁?
          const items = currentAccount.account.inventory?.items || {};
          undoCount += (items.item_undo || 0) * 3;
          hintCount += (items.item_hint || 0) * 5;
        }

        // 鏍规嵁鐢ㄦ埛绫诲瀷鏄剧ず涓嶅悓鐨勯€€鍑烘寜閽?
        const isGuest = accountType === 'guest' || currentAccount.loginType === 'guest';
        const logoutText = isGuest ? '閫€鍑烘父瀹? : '閫€鍑虹櫥褰?;
        const logoutFunction = isGuest ? 'guestLogout()' : 'logout()';

        // 娓稿鐢ㄦ埛涔熸樉绀鸿祫鏂欐寜閽紙鍙煡鐪嬩釜浜轰俊鎭拰杞锛?
        const profileButton = '<button class="account-btn btn-info" onclick="window.location.href=\'/profile.html\'">馃懁 璧勬枡</button>';
        const historyButton = '<button class="account-btn" onclick="showGameHistoryModal()" style="background: #9b59b6;">馃摐 鍘嗗彶</button>';

        accountBar.innerHTML = `
          <div class="account-info">
            <div class="account-user-section">
              <span class="account-avatar">馃懁</span>
              <div class="account-user-details">
                <span class="account-nickname">${nickname || username}</span>
                <div class="account-stats">
                  <span class="account-level">Lv.${level}</span>
                  <span class="account-exp">${exp} EXP</span>
                  <span class="account-starcoins">馃拵 ${starCoins}</span>
                  <span class="account-items" style="font-size:11px;color:#718096;">
                    鈴?{undoCount} 馃挕${hintCount}
                  </span>
                </div>
              </div>
            </div>
            <div class="account-buttons">
              ${profileButton}
              ${historyButton}
              <button class="account-btn" onclick="${logoutFunction}">${logoutText}</button>
            </div>
          </div>
        `;
      } else {
        accountBar.innerHTML = `
          <button class="account-btn btn-primary" onclick="showLoginModal()">鐧诲綍</button>
          <button class="account-btn btn-success" onclick="showRegisterModal()">娉ㄥ唽</button>
        `;
      }
    }

    function showExpAnimation(expGained) {
      const expDiv = document.createElement('div');
      expDiv.className = 'exp-animation';
      expDiv.textContent = `+${expGained} EXP`;
      expDiv.style.position = 'fixed';
      expDiv.style.top = '50%';
      expDiv.style.left = '50%';
      expDiv.style.transform = 'translate(-50%, -50%)';
      expDiv.style.fontSize = '32px';
      expDiv.style.fontWeight = 'bold';
      expDiv.style.color = '#4299e1';
      expDiv.style.textShadow = '0 0 20px rgba(66, 153, 225, 0.5)';
      expDiv.style.pointerEvents = 'none';
      expDiv.style.zIndex = '9999';
      expDiv.style.animation = 'expFloat 2s ease-out forwards';
      document.body.appendChild(expDiv);

      setTimeout(() => {
        expDiv.remove();
      }, 2000);
    }

    function showLevelUpAnimation(oldLevel, newLevel) {
      const levelDiv = document.createElement('div');
      levelDiv.className = 'levelup-animation';
      levelDiv.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 10px;">馃帀</div>
        <div style="font-size: 36px; font-weight: bold; color: #f6ad55;">鍗囩骇鍟︼紒</div>
        <div style="font-size: 24px; margin-top: 10px;">Lv.${oldLevel} 鈫?Lv.${newLevel}</div>
      `;
      levelDiv.style.position = 'fixed';
      levelDiv.style.top = '50%';
      levelDiv.style.left = '50%';
      levelDiv.style.transform = 'translate(-50%, -50%)';
      levelDiv.style.background = 'white';
      levelDiv.style.padding = '40px';
      levelDiv.style.borderRadius = '20px';
      levelDiv.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.3)';
      levelDiv.style.textAlign = 'center';
      levelDiv.style.zIndex = '9999';
      levelDiv.style.animation = 'levelupPop 0.5s ease-out';
      document.body.appendChild(levelDiv);

      setTimeout(() => {
        levelDiv.style.animation = 'levelupFade 0.5s ease-out forwards';
        setTimeout(() => {
          levelDiv.remove();
        }, 500);
      }, 3000);
    }

    // 鏄剧ず鏂紑杩炴帴鎻愮ず妗?
    function showDisconnectWarning() {
      const warning = document.getElementById('disconnect-warning');
      if (warning) {
        warning.style.display = 'block';
      }
    }

    // 闅愯棌鏂紑杩炴帴鎻愮ず妗?
    function hideDisconnectWarning() {
      const warning = document.getElementById('disconnect-warning');
      if (warning) {
        warning.style.display = 'none';
      }
    }

    // 閲嶈繛鏈嶅姟鍣?
    function reconnectServer() {
      const warning = document.getElementById('disconnect-warning');
      if (warning) {
        warning.style.display = 'none';
      }

      // 濡傛灉socket宸茬粡瀛樺湪锛屽厛鏂紑
      if (socket && socket.connected) {
        socket.disconnect();
      }

      // 閲嶆柊杩炴帴
      socket.connect();
      updateStatus('姝ｅ湪閲嶆柊杩炴帴...');
    }

    function showLoginModal() {
      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal">
          <div class="account-modal-title">馃攽 鐢ㄦ埛鐧诲綍</div>
          <div class="account-form-group">
            <label class="account-form-label">鐢ㄦ埛鍚?/label>
            <input type="text" class="account-form-input" id="login-username" placeholder="璇疯緭鍏ョ敤鎴峰悕">
          </div>
          <div class="account-form-group">
            <label class="account-form-label">瀵嗙爜</label>
            <input type="password" class="account-form-input" id="login-password" placeholder="璇疯緭鍏ュ瘑鐮?>
          </div>
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();showAutoLoginModal();">鍙栨秷</button>
            <button class="account-btn btn-primary" onclick="doLogin()">鐧诲綍</button>
          </div>
          <div class="account-switch-text">
            杩樻病鏈夎处鍙凤紵<span class="account-switch-link" onclick="closeAccountModal();showRegisterModal();">绔嬪嵆娉ㄥ唽</span>
          </div>
          <div class="account-switch-text" style="margin-top: 8px;">
            蹇樿瀵嗙爜锛?span class="account-switch-link" onclick="closeAccountModal();showResetPasswordModal();">鎵惧洖瀵嗙爜</span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    function showRegisterModal() {
      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal">
          <div class="account-modal-title">馃摑 鐢ㄦ埛娉ㄥ唽</div>
          <div class="account-form-group">
            <label class="account-form-label">鐢ㄦ埛鍚?/label>
            <input type="text" class="account-form-input" id="register-username" placeholder="3-20浣嶅瓧姣?鏁板瓧/涓嬪垝绾?>
          </div>
          <div class="account-form-group">
            <label class="account-form-label">瀵嗙爜</label>
            <input type="password" class="account-form-input" id="register-password" placeholder="鑷冲皯6浣嶅瘑鐮?>
          </div>
          <div class="account-form-group">
            <label class="account-form-label">纭瀵嗙爜</label>
            <input type="password" class="account-form-input" id="register-password2" placeholder="鍐嶆杈撳叆瀵嗙爜">
          </div>
          <div class="account-form-group">
            <label class="account-form-label">鏄电О锛堝彲閫夛級</label>
            <input type="text" class="account-form-input" id="register-nickname" placeholder="鏄剧ず鐨勬樀绉?>
          </div>
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();showAutoLoginModal();">鍙栨秷</button>
            <button class="account-btn btn-success" onclick="doRegister()">娉ㄥ唽</button>
          </div>
          <div class="account-switch-text">
            宸叉湁璐﹀彿锛?span class="account-switch-link" onclick="closeAccountModal();showLoginModal();">绔嬪嵆鐧诲綍</span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    function showResetPasswordModal() {
      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal">
          <div class="account-modal-title">馃攧 鎵惧洖瀵嗙爜</div>
          <div class="account-form-group">
            <label class="account-form-label">鐢ㄦ埛鍚?/label>
            <input type="text" class="account-form-input" id="reset-username" placeholder="璇疯緭鍏ョ敤鎴峰悕">
          </div>
          <div class="account-form-group">
            <label class="account-form-label">鏂板瘑鐮?/label>
            <input type="password" class="account-form-input" id="reset-password" placeholder="鑷冲皯6浣嶆柊瀵嗙爜">
          </div>
          <div class="account-form-group">
            <label class="account-form-label">纭鏂板瘑鐮?/label>
            <input type="password" class="account-form-input" id="reset-password2" placeholder="鍐嶆杈撳叆鏂板瘑鐮?>
          </div>
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();showAutoLoginModal();">鍙栨秷</button>
            <button class="account-btn btn-primary" onclick="doResetPassword()">閲嶇疆瀵嗙爜</button>
          </div>
          <div class="account-switch-text">
            鎯宠捣瀵嗙爜浜嗭紵<span class="account-switch-link" onclick="closeAccountModal();showLoginModal();">绔嬪嵆鐧诲綍</span>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    function closeAccountModal() {
      const modal = document.getElementById('account-modal');
      if (modal) {
        modal.remove();
      }
    }

    function doLogin() {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;

      // 浣跨敤澧炲己鐨勯獙璇?
      const validation = validateLoginForm(username, password);
      if (!validation.valid) {
        showToast(validation.message, 'error');
        return;
      }

      // 鏄剧ず鍔犺浇鐘舵€?
      const loginBtn = document.querySelector('#account-modal .btn-primary');
      const originalText = loginBtn.textContent;
      loginBtn.textContent = '鐧诲綍涓?..';
      loginBtn.disabled = true;

      socket.emit('account_login', { username, password });

      // 3绉掑悗鎭㈠鎸夐挳鐘舵€侊紙濡傛灉鏈嶅姟鍣ㄦ病鏈夊搷搴旓級
      setTimeout(() => {
        if (loginBtn.textContent === '鐧诲綍涓?..') {
          loginBtn.textContent = originalText;
          loginBtn.disabled = false;
        }
      }, 3000);
    }

    function doResetPassword() {
      const username = document.getElementById('reset-username').value.trim();
      const password = document.getElementById('reset-password').value;
      const password2 = document.getElementById('reset-password2').value;

      // 楠岃瘉琛ㄥ崟
      if (!username) {
        showToast('璇疯緭鍏ョ敤鎴峰悕', 'error');
        return;
      }
      if (password.length < 6) {
        showToast('瀵嗙爜鑷冲皯6浣?, 'error');
        return;
      }
      if (password !== password2) {
        showToast('涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷?, 'error');
        return;
      }

      // 鏄剧ず鍔犺浇鐘舵€?
      const resetBtn = document.querySelector('#account-modal .btn-primary');
      const originalText = resetBtn.textContent;
      resetBtn.textContent = '閲嶇疆涓?..';
      resetBtn.disabled = true;

      socket.emit('account_reset_password', { username, password });

      // 3绉掑悗鎭㈠鎸夐挳鐘舵€侊紙濡傛灉鏈嶅姟鍣ㄦ病鏈夊搷搴旓級
      setTimeout(() => {
        if (resetBtn.textContent === '閲嶇疆涓?..') {
          resetBtn.textContent = originalText;
          resetBtn.disabled = false;
        }
      }, 3000);
    }

    function doRegister() {
      const username = document.getElementById('register-username').value.trim();
      const password = document.getElementById('register-password').value;
      const password2 = document.getElementById('register-password2').value;
      const nickname = document.getElementById('register-nickname').value.trim();

      // 浣跨敤澧炲己鐨勯獙璇?
      const validation = validateRegisterForm(username, password, password2, nickname);
      if (!validation.valid) {
        showToast(validation.message, 'error');
        return;
      }

      // 淇濆瓨娉ㄥ唽淇℃伅鐢ㄤ簬鑷姩鐧诲綍锛堢敤鎴峰悕杞皬鍐欙級
      pendingRegisterInfo = { username: username.toLowerCase(), password };

      // 鏄剧ず鍔犺浇鐘舵€?
      const registerBtn = document.querySelector('#account-modal .btn-success');
      const originalText = registerBtn.textContent;
      registerBtn.textContent = '娉ㄥ唽涓?..';
      registerBtn.disabled = true;

      socket.emit('account_register', { username, password, nickname: nickname || null });

      // 3绉掑悗鎭㈠鎸夐挳鐘舵€侊紙濡傛灉鏈嶅姟鍣ㄦ病鏈夊搷搴旓級
      setTimeout(() => {
        if (registerBtn.textContent === '娉ㄥ唽涓?..') {
          registerBtn.textContent = originalText;
          registerBtn.disabled = false;
        }
      }, 3000);
    }

    function logout() {
      if (confirm('纭畾瑕侀€€鍑虹櫥褰曞悧锛?)) {
        currentAccount = null;
        clearAccount();
        updateAccountBar();

        // 鏄剧ず鑷姩鐧诲綍绐楀彛
        setTimeout(() => {
          showAutoLoginModal();
        }, 500);
      }
    }

    // 娓稿閫€鍑?
    function guestLogout() {
      if (confirm('纭畾瑕侀€€鍑烘父瀹㈡ā寮忓悧锛?)) {
        currentAccount = null;
        clearAccount();
        updateAccountBar();

        // 鏄剧ず鑷姩鐧诲綍绐楀彛
        setTimeout(() => {
          showAutoLoginModal();
        }, 500);
      }
    }

    function showProfileModal() {
      // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
      const accountData = currentAccount.account.account || currentAccount.account;
      const statsData = currentAccount.stats || {};

      console.log('showProfileModal - currentAccount:', currentAccount);
      console.log('showProfileModal - statsData:', statsData);
      console.log('showProfileModal - statsData.totalWins:', statsData?.totalWins);

      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal" style="max-width: 500px;">
          <div class="account-modal-title">馃懁 鐢ㄦ埛璧勬枡</div>
          
          <div class="account-form-group">
            <label class="account-form-label">鐢ㄦ埛鍚?/label>
            <input type="text" class="account-form-input" value="${accountData?.username}" disabled style="background: #f7fafc; cursor: not-allowed;">
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">鏄电О</label>
            <input type="text" class="account-form-input" id="profile-nickname" value="${accountData?.nickname || ''}" placeholder="璇疯緭鍏ユ樀绉?>
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">涓汉绠€浠?/label>
            <textarea class="account-form-input" id="profile-bio" rows="3" placeholder="浠嬬粛涓€涓嬭嚜宸?..">${accountData?.profile?.bio || ''}</textarea>
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">绛夌骇</label>
            <input type="text" class="account-form-input" value="Lv.${accountData?.profile?.level || 1}" disabled style="background: #f7fafc; cursor: not-allowed;">
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">缁忛獙鍊?/label>
            <div style="background: #f7fafc; padding: 12px; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
                <span>${accountData?.profile?.exp || 0} EXP</span>
                <span>缁忛獙: ${accountData?.profile?.exp || 0}</span>
              </div>
            </div>
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">鎬绘父鎴忕粺璁?/label>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
              <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                <div style="font-size: 20px; font-weight: bold; color: #38a169;">${statsData?.totalWins || 0}</div>
                <div style="font-size: 12px; color: #718096;">鑳?/div>
              </div>
              <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                <div style="font-size: 20px; font-weight: bold; color: #e53e3e;">${statsData?.totalLosses || 0}</div>
                <div style="font-size: 12px; color: #718096;">璐?/div>
              </div>
              <div style="background: #f7fafc; padding: 10px; border-radius: 8px; text-align: center;">
                <div style="font-size: 20px; font-weight: bold; color: #4299e1;">${statsData?.totalDraws || 0}</div>
                <div style="font-size: 12px; color: #718096;">骞?/div>
              </div>
            </div>
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">瀵规垬绫诲瀷缁熻</label>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
              <div style="background: #ebf8ff; padding: 12px; border-radius: 8px; border: 1px solid #90cdf4;">
                <div style="font-size: 14px; font-weight: bold; color: #2b6cb0; margin-bottom: 8px;">馃懃 鐪熶汉瀵规垬</div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                  <span>鑳? <span style="color: #38a169; font-weight: bold;">${statsData?.humanWins || 0}</span></span>
                  <span>璐? <span style="color: #e53e3e; font-weight: bold;">${statsData?.humanLosses || 0}</span></span>
                  <span>骞? <span style="color: #4299e1; font-weight: bold;">${statsData?.humanDraws || 0}</span></span>
                </div>
              </div>
              <div style="background: #faf5ff; padding: 12px; border-radius: 8px; border: 1px solid #d6bcfa;">
                <div style="font-size: 14px; font-weight: bold; color: #6b46c1; margin-bottom: 8px;">馃 AI瀵规垬</div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                  <span>鑳? <span style="color: #38a169; font-weight: bold;">${statsData?.aiWins || 0}</span></span>
                  <span>璐? <span style="color: #e53e3e; font-weight: bold;">${statsData?.aiLosses || 0}</span></span>
                  <span>骞? <span style="color: #4299e1; font-weight: bold;">${statsData?.aiDraws || 0}</span></span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();">杩斿洖</button>
            <button class="account-btn" onclick="showGameHistoryModal()">娓告垙鍘嗗彶</button>
            <button class="account-btn" onclick="showChangePasswordModal()">淇敼瀵嗙爜</button>
            <button class="account-btn btn-primary" onclick="doUpdateProfile()">淇濆瓨璧勬枡</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    function showChangePasswordModal() {
      closeAccountModal();
      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal">
          <div class="account-modal-title">馃攼 淇敼瀵嗙爜</div>
          
          <div class="account-form-group">
            <label class="account-form-label">鍘熷瘑鐮?/label>
            <input type="password" class="account-form-input" id="old-password" placeholder="璇疯緭鍏ュ師瀵嗙爜">
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">鏂板瘑鐮?/label>
            <input type="password" class="account-form-input" id="new-password" placeholder="璇疯緭鍏ユ柊瀵嗙爜锛堣嚦灏?浣嶏級">
          </div>
          
          <div class="account-form-group">
            <label class="account-form-label">纭鏂板瘑鐮?/label>
            <input type="password" class="account-form-input" id="new-password2" placeholder="璇峰啀娆¤緭鍏ユ柊瀵嗙爜">
          </div>
          
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();showProfileModal();">杩斿洖</button>
            <button class="account-btn btn-primary" onclick="doChangePassword()">纭淇敼</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    function showGameHistoryModal() {
      closeAccountModal();
      const modal = document.createElement('div');
      modal.className = 'account-modal-overlay';
      modal.id = 'account-modal';
      modal.innerHTML = `
        <div class="account-modal" style="max-width: 600px;">
          <div class="account-modal-title">馃摐 娓告垙鍘嗗彶璁板綍</div>
          
          <div class="game-history-list" id="game-history-list" style="max-height: 400px; overflow-y: auto;">
            <div style="color: #718096; text-align: center; padding: 20px;">鍔犺浇涓?..</div>
          </div>
          
          <div class="account-modal-footer">
            <button class="account-btn" onclick="closeAccountModal();">鍏抽棴</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      socket.emit('get_game_history', { limit: 20 });
    }

    function updateGameHistory(history) {
      const list = document.getElementById('game-history-list');
      if (!list) return;

      if (!history || history.length === 0) {
        list.innerHTML = '<div style="color: #718096; text-align: center; padding: 20px;">鏆傛棤娓告垙璁板綍</div>';
        return;
      }

      const gameTypeNames = {
        'gobang': '浜斿瓙妫?,
        'go': '鍥存',
        'chinese-chess': '涓浗璞℃',
        'snake': '璐悆铔?
      };

      const resultNames = {
        'win': '鉁?鑳滃埄',
        'loss': '鉁?澶辫触',
        'draw': '骞冲眬',
        'end': '缁撴潫'
      };

      const resultColors = {
        'win': '#38a169',
        'loss': '#e53e3e',
        'draw': '#4299e1',
        'end': '#718096'
      };

      list.innerHTML = history.map(game => {
        const date = new Date(game.date);
        const duration = Math.round(game.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        return `
          <div style="background: #f7fafc; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-weight: bold;">${gameTypeNames[game.gameType] || game.gameType}</div>
              <div style="font-weight: bold; color: ${resultColors[game.result]};">${resultNames[game.result]}</div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #718096;">
              <span>瀵规墜: ${game.opponent || '鏈煡'}</span>
              <span>${game.moves} 姝?/span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #718096; margin-top: 4px;">
              <span>${date.toLocaleString('zh-CN')}</span>
              <span>${minutes}鍒?{seconds}绉?/span>
            </div>
            <div style="margin-top: 8px; text-align: right;">
              <button onclick="startReplay('${game.gameId}')" style="padding: 6px 12px; font-size: 12px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">馃幀 鍥炴斁</button>
            </div>
          </div>
        `;
      }).join('');
    }

    function doUpdateProfile() {
      if (!currentAccount) {
        alert('璇峰厛鐧诲綍');
        return;
      }

      // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
      const accountData = currentAccount.account.account || currentAccount.account;

      const nickname = document.getElementById('profile-nickname').value.trim();
      const bio = document.getElementById('profile-bio').value.trim();

      const updates = {
        id: accountData?.id,
        nickname: nickname || null,
        profile: {
          ...accountData?.profile,
          bio: bio
        }
      };

      socket.emit('account_update_profile', updates);
    }

    function doChangePassword() {
      if (!currentAccount) {
        alert('璇峰厛鐧诲綍');
        return;
      }

      // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
      const accountData = currentAccount.account.account || currentAccount.account;

      const oldPassword = document.getElementById('old-password').value;
      const newPassword = document.getElementById('new-password').value;
      const newPassword2 = document.getElementById('new-password2').value;

      if (!oldPassword || !newPassword || !newPassword2) {
        alert('璇峰～鍐欏畬鏁翠俊鎭?);
        return;
      }

      if (newPassword !== newPassword2) {
        alert('涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷?);
        return;
      }

      if (newPassword.length < 6) {
        alert('鏂板瘑鐮佽嚦灏戦渶瑕?浣?);
        return;
      }

      socket.emit('account_change_password', {
        id: accountData?.id,
        oldPassword: oldPassword,
        newPassword: newPassword
      });
    }

    let currentChallenge = null; // 瀛樺偍褰撳墠鏀跺埌鐨勬寫鎴樹俊鎭?

    // 鏄剧ず鎸戞垬璇锋眰妯℃€佹
    function showChallengeModal(fromNickname, gameType) {
      const gameTypeName = gameConfigs[gameType] ? gameConfigs[gameType].emoji + ' ' + (gameType === 'gobang' ? '浜斿瓙妫? : gameType === 'go' ? '鍥存' : '璞℃') : gameType;
      challengeMessage.innerHTML = `鐜╁ <strong>${fromNickname}</strong> 閭€璇锋偍杩涜涓€鍦?<strong>${gameTypeName}</strong> 瀵规垬锛乣;
      challengeModal.style.display = 'flex';
    }

    // 闅愯棌鎸戞垬璇锋眰妯℃€佹
    function hideChallengeModal() {
      challengeModal.style.display = 'none';
      currentChallenge = null;
    }

    // 鎸戞垬璇锋眰妯℃€佹浜嬩欢澶勭悊
    document.addEventListener('DOMContentLoaded', () => {
      // 鍒濆鍖栨寫鎴樼浉鍏矰OM
      challengeModal = document.getElementById('challenge-modal');
      challengeTitle = document.getElementById('challenge-title');
      challengeMessage = document.getElementById('challenge-message');
      challengeAcceptBtn = document.getElementById('challenge-accept');
      challengeRejectBtn = document.getElementById('challenge-reject');

      if (challengeAcceptBtn && challengeRejectBtn && challengeModal) {
        challengeAcceptBtn.addEventListener('click', () => {
          if (currentChallenge) {
            socket.emit('challenge_response', {
              from: currentChallenge.from,
              accept: true
            });
            hideChallengeModal();
          }
        });

        challengeRejectBtn.addEventListener('click', () => {
          if (currentChallenge) {
            socket.emit('challenge_response', {
              from: currentChallenge.from,
              accept: false
            });
            hideChallengeModal();
          }
        });

        challengeModal.addEventListener('click', (e) => {
          if (e.target === challengeModal) {
            // 鐐瑰嚮鑳屾櫙榛樿鎷掔粷
            if (currentChallenge) {
              socket.emit('challenge_response', {
                from: currentChallenge.from,
                accept: false
              });
            }
            hideChallengeModal();
          }
        });
      }
    });

    // ========== 娓告垙鍥炴斁绯荤粺锛堝鎵樺埌 replay-module.js锛?==========
    let replayState = {
      replay: null,
      currentMoveIndex: 0,
      isPlaying: false,
      playInterval: null,
      speed: 1000
    };

    function startReplay(gameId) {
      closeAccountModal();
      socket.emit('get_game_replay', { gameId });
    }

    // 妫€鏌ユ槸鍚︽湁寰呮挱鏀剧殑鍥炴斁锛堜粠娓告垙鍘嗗彶椤甸潰璺宠浆杩囨潵鐨勶級
    function checkReplayOnLoad() {
      const replayGameId = localStorage.getItem('replayGameId');
      if (replayGameId) {
        localStorage.removeItem('replayGameId');
        startReplay(replayGameId);
      }
    }

    socket.on('game_replay', (data) => {
      if (data && data.replay) {
        ReplayModule.showReplay(data.replay);
      }
    });

    // ========== 涓婚绯荤粺 ==========

    // 鏈湴榛樿涓婚锛堝缁堜繚鐣欙級
    const defaultThemes = {
      'default': {
        name: '榛樿',
        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
        primaryColor: '#007bff',
        secondaryColor: '#6c757d',
        accentColor: '#27ae60',
        boardBackground: {
          gobang: '#bb9a7b',
          go: '#d4a76a',
          'chinese-chess': '#f0d9b5'
        },
        pieceColor: {
          gobangBlack: '#000',
          gobangWhite: '#fff',
          goBlack: '#000',
          goWhite: '#fff',
          chessRed: '#c0392b',
          chessBlack: '#2c3e50'
        },
        uiColors: {
          containerBg: '#ffffff',
          titleColor: '#2c3e50',
          statusColor: '#4a5568',
          statusBg: '#f7fafc',
          usersBg: '#f8f9fa',
          usersTitleColor: '#2d3748',
          userItemBg: '#e3f2fd',
          userItemColor: '#2d3748',
          leaderboardBg: '#f8f9fa',
          leaderboardTitleColor: '#2d3748',
          leaderboardItemBg: '#ffffff',
          rankColor: '#4a5568',
          nameColor: '#2d3748',
          levelColor: '#718096',
          winsColor: '#38a169',
          winrateColor: '#4299e1'
        }
      }
    };

    // 鍚堝苟鍚庣殑涓婚瀵硅薄锛堟湰鍦?+ 鏈嶅姟鍣級
    let themes = { ...defaultThemes };

    // 浠庢湇鍔″櫒鑾峰彇涓婚
    async function fetchThemesFromServer() {
      try {
        const response = await fetch('/api/themes');
        const result = await response.json();

        if (result.success && result.data) {
          themes = { ...defaultThemes, ...result.data };
          console.log('浠庢湇鍔″櫒鍔犺浇涓婚', { count: Object.keys(result.data).length });
        }
      } catch (err) {
        console.warn('浠庢湇鍔″櫒鑾峰彇涓婚澶辫触', { error: err.message });
      }
    }

    let currentTheme = localStorage.getItem('selectedTheme') || 'default';

    function showThemeModal() {
      // 鏇存柊瀵艰埅鎸夐挳鐘舵€?
      updateNavActiveState('theme');

      // 闅愯棌鍏朵粬椤甸潰
      lobbyContainer.style.display = 'none';
      infoContainer.style.display = 'none';
      gameControls.style.display = 'none';
      statusBox.style.display = 'none';
      moveLogPanel.style.display = 'none';
      document.getElementById('achievements-container').style.display = 'none';
      document.getElementById('ai-game-container').style.display = 'none';
      document.getElementById('leaderboard-page').style.display = 'none';

      // 闅愯棌鎵€鏈夋鐩?
      document.querySelectorAll('.gobang-board, .go-board, .chess-board').forEach(board => {
        board.style.display = 'none';
      });

      // 鏄剧ず涓婚椤甸潰
      const themeContainer = document.getElementById('theme-container');
      themeContainer.style.opacity = '0';
      themeContainer.style.transform = 'translateY(20px)';
      themeContainer.style.display = 'block';

      // 娣诲姞鍔ㄧ敾鏁堟灉
      setTimeout(() => {
        themeContainer.style.opacity = '1';
        themeContainer.style.transform = 'translateY(0)';
      }, 10);

      // 鍔犺浇涓婚鍒楄〃
      const themeListEl = document.getElementById('theme-list-container');
      themeListEl.innerHTML = ''; // 娓呯┖鐜版湁鍒楄〃

      for (const themeKey in themes) {
        const theme = themes[themeKey];
        const themeItem = document.createElement('div');
        themeItem.className = 'theme-item';
        themeItem.style.background = theme.background;
        themeItem.style.border = `3px solid ${currentTheme === themeKey ? theme.primaryColor : 'transparent'}`;
        themeItem.style.borderRadius = '8px';
        themeItem.style.padding = '15px';
        themeItem.style.cursor = 'pointer';
        themeItem.style.transition = 'all 0.2s';
        themeItem.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        themeItem.dataset.theme = themeKey;
        themeItem.onclick = () => applyTheme(themeKey);

        const textColor = themeKey === 'default' ? '#2d3748' : 'white';
        const description = theme.description || '鐐瑰嚮鍒囨崲鍒版涓婚';

        themeItem.innerHTML = `
          <div style="font-weight: bold; color: ${textColor}; margin-bottom: 10px; font-size: 16px;">${theme.name}</div>
          <div style="width: 100%; height: 80px; background: ${theme.primaryColor}; border-radius: 4px; margin-bottom: 10px;"></div>
          <div style="font-size: 12px; color: ${textColor}; opacity: 0.8; margin-bottom: 8px;">${description}</div>
          <div style="font-size: 12px; color: ${textColor}; opacity: 0.9;">${currentTheme === themeKey ? '鉁?褰撳墠涓婚' : '鐐瑰嚮鍒囨崲'}</div>
        `;
        themeListEl.appendChild(themeItem);
      }
    }

    window.showThemeModal = showThemeModal;

    function applyTheme(themeKey) {
      currentTheme = themeKey;
      const theme = themes[themeKey];

      // 绉婚櫎涔嬪墠鐨勭壒鏁堝厓绱犲拰闈㈡澘
      document.querySelectorAll('.theme-effect, .theme-panel').forEach(el => el.remove());
      document.body.style.background = theme.background;

      if (themeBg) {
        themeBg.classList.remove('visible');
        themeBg.style.backgroundImage = '';
        themeBg.style.transform = 'translateY(0px)';
      }

      // 閲嶇疆妫嬬洏绫诲悕
      gobangBoard.className = 'gobang-board';

      // 閲嶇疆妫嬬洏鏍峰紡
      gobangBoard.style.border = '';
      gobangBoard.style.boxShadow = '';
      gobangBoard.style.animation = '';
      gobangBoard.style.backgroundImage = '';

      // 閲嶇疆鎵€鏈夋瀛愭牱寮?
      document.querySelectorAll('.gobang-black, .gobang-white, .go-black, .go-white, .chess-red, .chess-black').forEach(piece => {
        piece.style.background = '';
        piece.style.boxShadow = '';
        piece.style.filter = '';
      });

      // 閲嶇疆鎵€鏈夋牸瀛愭牱寮?
      document.querySelectorAll('.gobang-cell, .go-cell, .chess-intersection').forEach(cell => {
        cell.style.background = '';
        cell.style.boxShadow = '';
      });

      // 閲嶇疆鎵€鏈夋寜閽牱寮?
      document.querySelectorAll('.nav-btn, .match-btn, .cancel-btn, .lobby-btn').forEach(btn => {
        btn.style.background = '';
        btn.style.boxShadow = '';
        btn.style.border = '';
      });

      // 閲嶇疆鎵€鏈夋枃瀛楁牱寮?
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        el.style.color = '';
        el.style.textShadow = '';
      });

      // 绉婚櫎涓婚鍔ㄧ敾鏍峰紡
      const themeAnimations = document.getElementById('theme-animations');
      if (themeAnimations) {
        themeAnimations.remove();
      }

      // 搴旂敤鍏ㄥ眬鏁堟灉
      if (theme.effects && theme.effects.global) {
        const globalEffects = theme.effects.global;

        // 搴旂敤鏂囨湰闃村奖
        if (globalEffects.textShadow) {
          document.querySelectorAll('h1, h2, h3, .nav-btn, .lobby-btn').forEach(el => {
            el.style.textShadow = globalEffects.textShadow;
          });
        } else {
          document.querySelectorAll('h1, h2, h3, .nav-btn, .lobby-btn').forEach(el => {
            el.style.textShadow = '';
          });
        }

        // 搴旂敤鎸夐挳鏁堟灉
        if (globalEffects.buttonShadow || globalEffects.buttonBorder) {
          document.querySelectorAll('.nav-btn, .match-btn, .cancel-btn, .lobby-btn').forEach(btn => {
            btn.style.boxShadow = globalEffects.buttonShadow || '';
            btn.style.border = globalEffects.buttonBorder || '';
          });
        } else {
          document.querySelectorAll('.nav-btn, .match-btn, .cancel-btn, .lobby-btn').forEach(btn => {
            btn.style.boxShadow = '';
            btn.style.border = '';
          });
        }
      } else {
        // 閲嶇疆鍏ㄥ眬鏁堟灉
        document.querySelectorAll('h1, h2, h3, .nav-btn, .lobby-btn').forEach(el => {
          el.style.textShadow = '';
        });
        document.querySelectorAll('.nav-btn, .match-btn, .cancel-btn, .lobby-btn').forEach(btn => {
          btn.style.boxShadow = '';
          btn.style.border = '';
        });
      }

      // 搴旂敤妫嬬洏鏁堟灉
      if (theme.effects && theme.effects.board) {
        const boardEffects = theme.effects.board;

        // 娣诲姞妫嬬洏绫诲悕
        if (boardEffects.className) {
          gobangBoard.classList.add(boardEffects.className);
        }

        // 搴旂敤妫嬬洏鏍峰紡
        if (boardEffects.style) {
          const boardStyle = boardEffects.style;
          gobangBoard.style.border = boardStyle.border || '';
          gobangBoard.style.boxShadow = boardStyle.boxShadow || '';
          gobangBoard.style.animation = boardStyle.animation || '';
        }

        // 娣诲姞鍏ㄥ眬鍙戝厜鏁堟灉
        if (boardEffects.glowEffect) {
          const glowEffect = document.createElement('div');
          glowEffect.className = 'theme-effect board-glow';
          const glowStyle = boardEffects.glowStyle || {};
          const primaryColor = theme.primaryColor || '#00d4ff';
          const secondaryColor = theme.secondaryColor || '#ff00ff';

          glowEffect.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: ${glowStyle.background || `radial-gradient(circle at 20% 50%, ${primaryColor} 0%, transparent 50%), radial-gradient(circle at 80% 20%, ${secondaryColor} 0%, transparent 50%)`};
            pointer-events: none;
            z-index: 9998;
            mix-blend-mode: screen;
            opacity: ${glowStyle.opacity || 0.2};
          `;
          document.body.appendChild(glowEffect);
        }
      }

      // 搴旂敤鍔ㄧ敾
      if (theme.effects && theme.effects.animations) {
        const animations = theme.effects.animations;

        // 鍒涘缓闇撹櫣鑴夊啿鍔ㄧ敾
        if (animations.neonPulse) {
          const neonPulse = animations.neonPulse;
          const styleElement = document.createElement('style');
          styleElement.id = 'theme-animations';
          styleElement.textContent = `
            @keyframes neon-pulse {
              0% { opacity: ${neonPulse.keyframes[0].opacity}; box-shadow: ${neonPulse.keyframes[0].boxShadow}; }
              50% { opacity: ${neonPulse.keyframes[1].opacity}; box-shadow: ${neonPulse.keyframes[1].boxShadow}; }
              100% { opacity: ${neonPulse.keyframes[2].opacity}; box-shadow: ${neonPulse.keyframes[2].boxShadow}; }
            }
          `;
          document.head.appendChild(styleElement);
        }
      }

      // 搴旂敤UI鍏冪礌鏍峰紡
      if (theme.uiColors) {
        const uiColors = theme.uiColors;

        // 搴旂敤鎸夐挳鏍峰紡
        if (uiColors.buttons) {
          const buttons = uiColors.buttons;

          if (buttons.active) {
            document.querySelectorAll('.nav-btn.active').forEach(btn => {
              btn.style.background = buttons.active.background || '';
              btn.style.boxShadow = buttons.active.boxShadow || '';
              btn.style.border = buttons.active.border || '';
            });
          }

          if (buttons.match) {
            document.querySelectorAll('.match-btn').forEach(btn => {
              btn.style.background = buttons.match.background || '';
              btn.style.boxShadow = buttons.match.boxShadow || '';
              btn.style.border = buttons.match.border || '';
            });
          }

          if (buttons.cancel) {
            document.querySelectorAll('.cancel-btn').forEach(btn => {
              btn.style.background = buttons.cancel.background || '';
              btn.style.boxShadow = buttons.cancel.boxShadow || '';
              btn.style.border = buttons.cancel.border || '';
            });
          }

          if (buttons.lobby) {
            document.querySelectorAll('.lobby-btn').forEach(btn => {
              btn.style.boxShadow = buttons.lobby.boxShadow || '';
            });
          }
        }

        // 搴旂敤鏂囧瓧鏍峰紡
        if (uiColors.text) {
          const text = uiColors.text;

          if (text.h1) {
            document.querySelectorAll('h1').forEach(h1 => {
              h1.style.color = text.h1.color || '';
              h1.style.textShadow = text.h1.textShadow || '';
            });
          }

          if (text.h2) {
            document.querySelectorAll('h2').forEach(h2 => {
              h2.style.color = text.h2.color || '';
              h2.style.textShadow = text.h2.textShadow || '';
            });
          }

          if (text.h3) {
            document.querySelectorAll('h3').forEach(h3 => {
              h3.style.color = text.h3.color || '';
              h3.style.textShadow = text.h3.textShadow || '';
            });
          }
        }
      }

      // 璁剧疆鑳屾櫙鍥剧墖
      if (themeBg && theme.images && theme.images.background) {
        themeBg.style.backgroundImage = `url('${theme.images.background}')`;
        themeBg.classList.add('visible');
      }

      // 鍒涘缓涓婚闈㈡澘
      if (theme.panels && Array.isArray(theme.panels)) {
        theme.panels.forEach(panelConfig => {
          if (panelConfig.enabled) {
            createThemePanel(panelConfig);
          }
        });
      }

      // 鍒涘缓涓婚闈㈡澘鐨勮緟鍔╁嚱鏁?
      function createThemePanel(panelConfig) {
        const panel = document.createElement('div');
        panel.id = `${panelConfig.id}-panel`;
        panel.className = 'theme-panel';

        // 璁剧疆闈㈡澘鏍峰紡
        const position = panelConfig.position || { right: '40px', bottom: '80px', width: '220px' };
        const style = panelConfig.style || {};

        panel.style.cssText = `
          position: fixed;
          right: ${position.right};
          bottom: ${position.bottom};
          width: ${position.width};
          padding: 14px 14px 12px 14px;
          border-radius: 18px;
          background: ${style.background || 'rgba(255, 255, 255, 0.95)'};
          box-shadow: ${style.boxShadow || '0 0 18px rgba(0, 0, 0, 0.2)'};
          border: ${style.border || '1px solid rgba(0, 0, 0, 0.1)'};
          z-index: 9000;
          backdrop-filter: ${style.backdropFilter || 'blur(10px)'};
          display: block;
        `;

        // 鏍规嵁闈㈡澘绫诲瀷鍒涘缓鍐呭
        let panelContent = '';
        if (panelConfig.type === 'character' && panelConfig.image) {
          const avatarStyle = style.avatarBorder ? `border: ${style.avatarBorder}; box-shadow: ${style.avatarShadow};` : '';
          const nameStyle = style.nameColor ? `color: ${style.nameColor};` : '';
          const nameTextShadow = style.nameTextShadow ? `text-shadow: ${style.nameTextShadow};` : '';
          const descStyle = style.descColor ? `color: ${style.descColor};` : '';

          panelContent = `
            <div class="panel-avatar" style="${avatarStyle}">
              <img src="${panelConfig.image}" alt="${panelConfig.title}" class="panel-img">
            </div>
            <div class="panel-info">
              <div class="panel-name" style="${nameStyle} ${nameTextShadow}">${panelConfig.title || ''}</div>
              <div class="panel-desc" style="${descStyle}">${panelConfig.description || ''}</div>
            </div>
          `;
        } else if (panelConfig.type === 'info') {
          const nameStyle = style.nameColor ? `color: ${style.nameColor};` : '';
          const nameTextShadow = style.nameTextShadow ? `text-shadow: ${style.nameTextShadow};` : '';
          const descStyle = style.descColor ? `color: ${style.descColor};` : '';

          panelContent = `
            <div class="panel-info">
              <div class="panel-name" style="${nameStyle} ${nameTextShadow}">${panelConfig.title || ''}</div>
              <div class="panel-desc" style="${descStyle}">${panelConfig.description || ''}</div>
            </div>
          `;
        }

        panel.innerHTML = panelContent;
        document.body.appendChild(panel);
      }

      // 鏇存柊鎸夐挳棰滆壊绛?
      document.querySelectorAll('.nav-btn.active').forEach(btn => {
        btn.style.background = theme.primaryColor;
      });
      document.querySelectorAll('.match-btn').forEach(btn => {
        btn.style.background = theme.accentColor;
      });
      document.querySelectorAll('.cancel-btn').forEach(btn => {
        btn.style.background = theme.secondaryColor;
      });
      document.querySelectorAll('.lobby-btn').forEach(btn => {
        btn.style.boxShadow = `0 3px 6px ${theme.primaryColor}33`;
      });

      // 鏇存柊澶у巺UI鍏冪礌鏍峰紡
      if (lobbyContainer) {
        lobbyContainer.style.background = theme.uiColors.containerBg;
      }
      if (lobbyTitle) {
        lobbyTitle.style.color = theme.uiColors.titleColor;
      }
      if (lobbyStatus) {
        lobbyStatus.style.color = theme.uiColors.statusColor;
        lobbyStatus.style.background = theme.uiColors.statusBg;
      }
      if (onlineUsersElement) {
        onlineUsersElement.style.background = theme.uiColors.usersBg;
      }
      if (onlineUsersTitle) {
        onlineUsersTitle.style.color = theme.uiColors.usersTitleColor;
      }
      if (userList) {
        const userItems = userList.querySelectorAll('.user-item');
        userItems.forEach(item => {
          item.style.background = theme.uiColors.userItemBg;
          item.style.color = theme.uiColors.userItemColor;
        });
      }

      // 鏇存柊鎺掕姒淯I鍏冪礌鏍峰紡
      if (leaderboardContainer) {
        leaderboardContainer.style.background = theme.uiColors.leaderboardBg;
      }
      if (leaderboardTitle) {
        leaderboardTitle.style.color = theme.uiColors.leaderboardTitleColor;
      }
      if (leaderboardList) {
        const leaderboardItems = leaderboardList.querySelectorAll('.leaderboard-item');
        leaderboardItems.forEach(item => {
          item.style.background = theme.uiColors.leaderboardItemBg;
          const rankEl = item.querySelector('.leaderboard-rank');
          if (rankEl) {
            rankEl.style.color = theme.uiColors.rankColor;
          }
          const nameEl = item.querySelector('.leaderboard-name');
          if (nameEl) {
            nameEl.style.color = theme.uiColors.nameColor;
          }
          const levelEl = item.querySelector('.leaderboard-level');
          if (levelEl) {
            levelEl.style.color = theme.uiColors.levelColor;
          }
          const winsEl = item.querySelector('.leaderboard-wins');
          if (winsEl) {
            winsEl.style.color = theme.uiColors.winsColor;
          }
          const winrateEl = item.querySelector('.leaderboard-winrate');
          if (winrateEl) {
            winrateEl.style.color = theme.uiColors.winrateColor;
          }
        });
      }

      // 鏇存柊妫嬬洏棰滆壊
      gobangBoard.style.background = theme.boardBackground.gobang;
      goBoard.style.background = theme.boardBackground.go;
      chessBoard.style.background = theme.boardBackground['chinese-chess'];

      // 鏇存柊妫嬪瓙棰滆壊鍜屾晥鏋?
      const pieceEffects = theme.effects?.pieces;
      // 浜斿瓙妫嬮粦鐧藉瓙
      document.querySelectorAll('.gobang-black').forEach(piece => {
        piece.style.background = theme.pieceColor.gobangBlack;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadow || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });
      document.querySelectorAll('.gobang-white').forEach(piece => {
        piece.style.background = theme.pieceColor.gobangWhite;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadowWhite || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });
      // 鍥存榛戠櫧瀛?
      document.querySelectorAll('.go-black').forEach(piece => {
        piece.style.background = theme.pieceColor.goBlack;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadow || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });
      document.querySelectorAll('.go-white').forEach(piece => {
        piece.style.background = theme.pieceColor.goWhite;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadowWhite || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });
      // 璞℃绾㈤粦瀛?
      document.querySelectorAll('.chess-red').forEach(piece => {
        piece.style.background = theme.pieceColor.chessRed;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadow || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });
      document.querySelectorAll('.chess-black').forEach(piece => {
        piece.style.background = theme.pieceColor.chessBlack;
        if (pieceEffects) {
          piece.style.boxShadow = pieceEffects.shadowWhite || '';
          piece.style.filter = pieceEffects.filter || '';
        } else {
          piece.style.boxShadow = '';
          piece.style.filter = '';
        }
      });

      // 鏇存柊妫嬬洏鏍煎瓙鎮仠鏁堟灉
      const cellEffects = theme.effects?.cells;
      if (cellEffects) {
        document.querySelectorAll('.gobang-cell').forEach(cell => {
          cell.style.background = cellEffects.background || 'transparent';
          cell.style.boxShadow = cellEffects.boxShadow || 'none';
        });
        document.querySelectorAll('.go-cell').forEach(cell => {
          cell.style.background = cellEffects.background || 'transparent';
          cell.style.boxShadow = cellEffects.boxShadow || 'none';
        });
        document.querySelectorAll('.chess-intersection').forEach(cell => {
          cell.style.background = cellEffects.background || 'transparent';
          cell.style.boxShadow = cellEffects.boxShadow || 'none';
        });

        // 搴旂敤鏈€鍚庝竴姝ユ晥鏋?
        if (cellEffects.lastMove) {
          const lastMoveEffects = cellEffects.lastMove;
          document.querySelectorAll('.gobang-cell.last-move').forEach(cell => {
            cell.style.background = lastMoveEffects.background || '';
            cell.style.boxShadow = lastMoveEffects.boxShadow || '';
          });
          document.querySelectorAll('.go-cell.last-move').forEach(cell => {
            cell.style.background = lastMoveEffects.background || '';
            cell.style.boxShadow = lastMoveEffects.boxShadow || '';
          });
          document.querySelectorAll('.chess-intersection.last-move').forEach(cell => {
            cell.style.background = lastMoveEffects.background || '';
            cell.style.boxShadow = lastMoveEffects.boxShadow || '';
          });
        }
      } else {
        document.querySelectorAll('.gobang-cell').forEach(cell => {
          cell.style.background = 'transparent';
          cell.style.boxShadow = 'none';
        });
        document.querySelectorAll('.go-cell').forEach(cell => {
          cell.style.background = 'transparent';
          cell.style.boxShadow = 'none';
        });
        document.querySelectorAll('.chess-intersection').forEach(cell => {
          cell.style.background = 'transparent';
          cell.style.boxShadow = 'none';
        });
      }

      // 淇濆瓨涓婚閫夋嫨鍒?localStorage
      localStorage.setItem('selectedTheme', themeKey);

      // 濡傛灉涓婚椤甸潰姝ｅ湪鏄剧ず锛屽埛鏂颁富棰樺垪琛ㄤ互鏇存柊閫変腑鐘舵€?
      const themeContainer = document.getElementById('theme-container');
      if (themeContainer && themeContainer.style.display === 'block') {
        showThemeModal();
      }
    }

    window.applyTheme = applyTheme;

    // 鍒濆鍖栨椂鍔犺浇榛樿涓婚
    document.addEventListener('DOMContentLoaded', () => {
      applyTheme(currentTheme);

      if (themeBg) {
        let lastScrollY = 0;
        let ticking = false;

        const updateThemeBg = () => {
          const y = lastScrollY || window.scrollY || window.pageYOffset || 0;
          const offset = Math.min(y * 0.12, 60);
          themeBg.style.transform = `translateY(${offset * -1}px)`;
          ticking = false;
        };

        window.addEventListener('scroll', () => {
          lastScrollY = window.scrollY || window.pageYOffset || 0;
          if (!ticking) {
            window.requestAnimationFrame(updateThemeBg);
            ticking = true;
          }
        });
      }
    });

    // ========== 鑷姩鐧诲綍鍔熻兘 ==========

    let selectedLoginOption = null;

    // 鏄剧ず鑷姩鐧诲綍妯℃€佺獥鍙?
    function showAutoLoginModal() {
      const modal = document.getElementById('auto-login-modal');
      if (modal) {
        modal.style.display = 'flex';
        selectedLoginOption = null;
        resetLoginOptions();
      }
    }

    // 鍏抽棴鑷姩鐧诲綍妯℃€佺獥鍙?
    function closeAutoLoginModal() {
      const modal = document.getElementById('auto-login-modal');
      if (modal) {
        modal.style.display = 'none';
      }
    }

    // 閫夋嫨鐧诲綍閫夐」
    function selectLoginOption(option) {
      selectedLoginOption = option;

      // 閲嶇疆鎵€鏈夐€夐」鏍峰紡
      resetLoginOptions();

      // 璁剧疆閫変腑閫夐」鏍峰紡
      const selectedElement = document.querySelector(`.login-option:nth-child(${option === 'guest' ? 1 : 2})`);
      if (selectedElement) {
        selectedElement.classList.add('active');
      }

      // 鏄剧ず/闅愯棌璐﹀彿鐧诲綍琛ㄥ崟
      const accountForm = document.getElementById('account-login-form');
      if (accountForm) {
        accountForm.style.display = option === 'account' ? 'block' : 'none';
      }
    }

    // 閲嶇疆鐧诲綍閫夐」鏍峰紡
    function resetLoginOptions() {
      const options = document.querySelectorAll('.login-option');
      options.forEach(option => {
        option.classList.remove('active');
      });
    }

    // 纭鐧诲綍
    function confirmLogin() {
      if (!selectedLoginOption) {
        showToast('璇峰厛閫夋嫨鐧诲綍鏂瑰紡锛堢偣鍑绘父瀹㈢櫥褰曟垨璐﹀彿瀵嗙爜鐧诲綍閫夐」锛?, 'warning');
        return;
      }

      if (selectedLoginOption === 'guest') {
        // 娓稿鐧诲綍
        guestLogin();
      } else if (selectedLoginOption === 'account') {
        // 璐﹀彿瀵嗙爜鐧诲綍
        const username = document.getElementById('auto-login-username').value.trim();
        const password = document.getElementById('auto-login-password').value;

        if (!username || !password) {
          showToast('璇疯緭鍏ョ敤鎴峰悕鍜屽瘑鐮?, 'warning');
          return;
        }

        accountLogin(username, password);
      }
    }

    // 娓稿鐧诲綍
    function guestLogin() {
      if (currentAccount) {
        // 宸茬粡鐧诲綍锛屾樉绀烘彁绀?
        showToast('鎮ㄥ凡缁忕櫥褰曚簡璐﹀彿', 'info');
        return;
      }

      if (socket && socket.connected) {
        socket.emit('guest_login');
        showToast('姝ｅ湪鍒涘缓娓稿璐﹀彿...', 'info');
      }
    }

    // 璐﹀彿瀵嗙爜鐧诲綍
    function accountLogin(username, password) {
      if (socket && socket.connected) {
        socket.emit('account_login', { username, password });
        showToast('姝ｅ湪鐧诲綍...', 'info');
      }
    }

    // 妫€鏌ョ櫥褰曠姸鎬佸苟鏄剧ず妯℃€佺獥鍙?
    async function checkLoginStatus() {
      const isLoggedIn = await loadSavedAccount();

      if (isLoggedIn) {
        // 鍔犺浇宸蹭繚瀛樼殑鏉冮檺
        if (currentAccount.permissions) {
          loadPermissions(currentAccount.permissions);
        }
        return true;
      }

      // 濡傛灉娌℃湁鐧诲綍锛屾樉绀鸿嚜鍔ㄧ櫥褰曟ā鎬佺獥鍙?
      setTimeout(() => {
        showAutoLoginModal();
      }, 1000);

      return false;
    }

    // 鏍规嵁鏉冮檺鍔犺浇鍔熻兘妯″潡
    function loadPermissions(permissions) {
      console.log('鍔犺浇鏉冮檺:', permissions);

      // 娓告垙鍔熻兘鎺у埗
      const gameButtons = document.querySelectorAll('.match-btn, .lobby-btn');
      if (permissions.canPlayGames) {
        gameButtons.forEach(btn => {
          btn.style.display = 'block';
        });
      } else {
        gameButtons.forEach(btn => {
          btn.style.display = 'none';
        });
      }

      // 鑱婂ぉ鍔熻兘鎺у埗
      const chatElements = document.querySelectorAll('.chat-input, .chat-send-btn');
      if (permissions.canChat) {
        chatElements.forEach(el => {
          el.style.display = 'block';
        });
      } else {
        chatElements.forEach(el => {
          el.style.display = 'none';
        });
      }

      // 鎺掕姒滃姛鑳芥帶鍒?
      const leaderboardElements = document.querySelectorAll('#leaderboard-container');
      if (permissions.canViewLeaderboard) {
        leaderboardElements.forEach(el => {
          el.style.display = 'block';
        });
      } else {
        leaderboardElements.forEach(el => {
          el.style.display = 'none';
        });
      }

      // 涓汉璧勬枡鍔熻兘鎺у埗
      const profileButtons = document.querySelectorAll('.account-btn[onclick*="showProfileModal"]');
      if (permissions.canEditProfile) {
        profileButtons.forEach(btn => {
          btn.style.display = 'inline-block';
        });
      } else {
        profileButtons.forEach(btn => {
          btn.style.display = 'none';
        });
      }

      // 鎴块棿鍒涘缓鍔熻兘鎺у埗
      const roomButtons = document.querySelectorAll('.btn[onclick*="createRoom"]');
      if (permissions.canCreateRooms) {
        roomButtons.forEach(btn => {
          btn.style.display = 'inline-block';
        });
      } else {
        roomButtons.forEach(btn => {
          btn.style.display = 'none';
        });
      }

      // 濂藉弸閭€璇峰姛鑳芥帶鍒?
      const inviteButtons = document.querySelectorAll('.btn[onclick*="inviteFriend"]');
      if (permissions.canInviteFriends) {
        inviteButtons.forEach(btn => {
          btn.style.display = 'inline-block';
        });
      } else {
        inviteButtons.forEach(btn => {
          btn.style.display = 'none';
        });
      }

      // 鏄剧ず鏉冮檺鎻愮ず
      // 澶勭悊涓嶅悓鐨勬暟鎹粨鏋?
      const accountData = currentAccount.account.account || currentAccount.account;
      if (currentAccount.loginType === 'guest' || accountData?.type === 'guest') {
        showToast('鎮ㄥ綋鍓嶄互娓稿韬唤鐧诲綍锛岄儴鍒嗗姛鑳藉彈闄?, 'info', 5000);
      }
    }

    // ========== 璐﹀彿鏍忔诞鍔ㄦ晥鏋?==========
    const accountBar = document.getElementById('account-bar');
    let scrollTimeout;

    function handleScroll() {
      if (window.scrollY > 30) {
        accountBar.classList.add('collapsed');
      } else {
        accountBar.classList.remove('collapsed');
      }
    }

    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(handleScroll, 50);
    });

    // ========== 椤甸潰娓呯悊 ==========
    window.onunload = () => {
      if (gameState.gameTimer) clearInterval(gameState.gameTimer);
      socket.emit('user_status', {
        status: 'offline',
        game: currentGame
      });
    };

    // init鍑芥暟鐜板湪鐢眘etupSocketListeners鍦╯ocket杩炴帴鎴愬姛鍚庤嚜鍔ㄨ皟鐢?
  </script>
