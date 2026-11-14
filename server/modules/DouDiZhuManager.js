/**
 * 斗地主（3 人联机 + AI 补位）
 *
 * 设计：独立于 GameManager 的 1v1 对局体系，自带匹配队列与房间状态，
 * 通过 socket 事件 `ddz_*` 与客户端交互，避免影响现有棋类/贪吃蛇对局。
 *
 * 规则（首版）：
 * - 54 张牌，每人 17 张，底牌 3 张
 * - 叫地主：按随机起始座位依次「叫/不叫」，第一个叫的人当地主并拿底牌；
 *   三家都不叫时默认第一家当地主，保证对局能开始
 * - 牌型：单张、对子、三张、三带一、三带二、顺子(≥5)、连对(≥3)、
 *   飞机(纯三顺，≥2)、炸弹、王炸（暂不支持四带二、飞机带翅膀）
 * - 先出完手牌的一方获胜；地主赢或两个农民任意一人出完则农民赢
 * - 真人不足 3 人时，等待一段时间后由 AI 补位；玩家掉线/离开由 AI 托管
 */
const AI_FILL_DELAY = 6000; // 匹配等待 6 秒后 AI 补位
const AI_ACT_DELAY = 900;   // AI 叫牌/出牌思考时间
const ROOM_KEEP_MS = 30000; // 结算后房间保留时间

const RANK_LABEL = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

const SUITS = [
  { id: 'S', symbol: '♠', color: 'black' },
  { id: 'H', symbol: '♥', color: 'red' },
  { id: 'C', symbol: '♣', color: 'black' },
  { id: 'D', symbol: '♦', color: 'red' },
];

const AI_NAMES = ['小智', '小美', '小刚'];

function createDeck() {
  const cards = [];
  for (let rank = 3; rank <= 15; rank += 1) {
    for (const suit of SUITS) {
      cards.push({
        id: `${suit.id}${rank}`,
        rank,
        label: RANK_LABEL[rank],
        suit: suit.symbol,
        color: suit.color,
        joker: false,
      });
    }
  }
  cards.push({ id: 'JOKER_S', rank: 16, label: '小王', suit: '🃏', color: 'black', joker: true });
  cards.push({ id: 'JOKER_B', rank: 17, label: '大王', suit: '🃏', color: 'red', joker: true });
  return cards;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function sortDesc(cards) {
  return cards.slice().sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

/**
 * 识别牌型
 * @param {Array<{rank:number}>} cards
 * @returns {{type:string,len:number,rank:number}|null}
 */
function classify(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const n = ranks.length;
  const maxRank = ranks[n - 1];

  const counts = new Map();
  ranks.forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const distinct = entries.length;

  if (n === 2 && ranks[0] === 16 && ranks[1] === 17) return { type: 'rocket', len: 2, rank: 100 };
  if (n === 4 && distinct === 1) return { type: 'bomb', len: 4, rank: ranks[0] };
  if (n === 1) return { type: 'single', len: 1, rank: ranks[0] };
  if (n === 2 && distinct === 1) return { type: 'pair', len: 2, rank: ranks[0] };
  if (n === 3 && distinct === 1) return { type: 'triple', len: 3, rank: ranks[0] };

  if (n === 4 && distinct === 2) {
    const triple = entries.find((e) => e[1] === 3);
    if (triple) return { type: 'triple1', len: 4, rank: triple[0] };
  }
  if (n === 5 && distinct === 2) {
    const triple = entries.find((e) => e[1] === 3);
    const pair = entries.find((e) => e[1] === 2);
    if (triple && pair) return { type: 'triple2', len: 5, rank: triple[0] };
  }

  const consecutive = (len) => {
    for (let i = 1; i < entries.length; i += 1) {
      if (entries[i][0] !== entries[i - 1][0] + 1) return false;
    }
    return entries.length === len;
  };

  if (n >= 5 && distinct === n && maxRank <= 14 && consecutive(n)) {
    return { type: 'straight', len: n, rank: maxRank };
  }
  if (n >= 6 && n % 2 === 0 && distinct === n / 2 && maxRank <= 14
    && entries.every((e) => e[1] === 2) && consecutive(distinct)) {
    return { type: 'pairs', len: n, rank: maxRank };
  }
  if (n >= 6 && n % 3 === 0 && distinct === n / 3 && maxRank <= 14
    && entries.every((e) => e[1] === 3) && consecutive(distinct)) {
    return { type: 'plane', len: n, rank: maxRank };
  }

  return null;
}

/** a 能否压过 b（b 为空表示自由出牌） */
function beats(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.type === 'rocket') return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (b.type === 'bomb' && a.type !== 'bomb') return false;
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.rank > b.rank;
}

function nextSeat(seat) {
  return (seat + 1) % 3;
}

/** 枚举所有可出的牌型组合 */
function generatePlays(hand) {
  const byRank = new Map();
  hand.forEach((c) => {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  });
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const plays = [];
  const seen = new Set();
  const push = (cards) => {
    const key = cards.map((c) => c.id).sort().join(',');
    if (seen.has(key)) return;
    const combo = classify(cards);
    if (!combo) return;
    seen.add(key);
    plays.push({ cards, combo });
  };

  for (const rank of ranks) {
    const list = byRank.get(rank);
    push([list[0]]);
    if (list.length >= 2) push(list.slice(0, 2));
    if (list.length >= 3) push(list.slice(0, 3));
    if (list.length >= 4) push(list.slice(0, 4));
  }

  if (byRank.has(16) && byRank.has(17)) push([byRank.get(16)[0], byRank.get(17)[0]]);

  // 三带一 / 三带二
  for (const rank of ranks) {
    const triple = byRank.get(rank);
    if (!triple || triple.length < 3) continue;
    for (const other of ranks) {
      if (other === rank) continue;
      const list = byRank.get(other);
      push([...triple.slice(0, 3), list[0]]);
      if (list.length >= 2) push([...triple.slice(0, 3), ...list.slice(0, 2)]);
    }
  }

  // 顺子（3~A，长度 ≥5）
  for (let start = 3; start <= 10; start += 1) {
    for (let len = 5; start + len - 1 <= 14; len += 1) {
      const cards = [];
      for (let r = start; r < start + len; r += 1) {
        const list = byRank.get(r);
        if (!list) { cards.length = 0; break; }
        cards.push(list[0]);
      }
      if (cards.length === len) push(cards);
    }
  }

  // 连对（长度 ≥3 对）
  for (let start = 3; start <= 12; start += 1) {
    for (let len = 3; start + len - 1 <= 14; len += 1) {
      const cards = [];
      for (let r = start; r < start + len; r += 1) {
        const list = byRank.get(r);
        if (!list || list.length < 2) { cards.length = 0; break; }
        cards.push(list[0], list[1]);
      }
      if (cards.length === len * 2) push(cards);
    }
  }

  // 飞机（纯三顺，长度 ≥2）
  for (let start = 3; start <= 13; start += 1) {
    for (let len = 2; start + len - 1 <= 14; len += 1) {
      const cards = [];
      for (let r = start; r < start + len; r += 1) {
        const list = byRank.get(r);
        if (!list || list.length < 3) { cards.length = 0; break; }
        cards.push(list[0], list[1], list[2]);
      }
      if (cards.length === len * 3) push(cards);
    }
  }

  return plays;
}

function aiBidScore(hand) {
  let score = 0;
  const counts = new Map();
  hand.forEach((c) => counts.set(c.rank, (counts.get(c.rank) || 0) + 1));
  if (counts.has(17)) score += 4;
  if (counts.has(16)) score += 3;
  score += (counts.get(15) || 0) * 1.5;
  score += (counts.get(14) || 0) * 0.6;
  for (const [, count] of counts) {
    if (count === 4) score += 3;
  }
  return score;
}

/**
 * AI 出牌决策
 * @returns {Array<Object>|null} 要出的牌，null 表示不出
 */
function aiChoosePlay(room, seat) {
  const hand = room.hands[seat];
  const plays = generatePlays(hand);
  const last = room.lastPlay;

  const finish = plays.find((p) => p.cards.length === hand.length
    && (!last || beats(p.combo, last.combo)));
  if (finish) return finish.cards;

  if (!last) {
    const normal = plays.filter((p) => p.combo.type !== 'bomb' && p.combo.type !== 'rocket');
    normal.sort((a, b) => b.cards.length - a.cards.length || a.combo.rank - b.combo.rank);
    const pick = normal[0] || plays.sort((a, b) => a.combo.rank - b.combo.rank)[0];
    return pick ? pick.cards : [hand[0]];
  }

  const iAmFarmer = seat !== room.landlordSeat;
  const lastIsFarmer = last.seat !== room.landlordSeat;
  // 农民不压自己的队友
  if (iAmFarmer && lastIsFarmer) return null;

  const beaters = plays.filter((p) => beats(p.combo, last.combo));
  if (!beaters.length) return null;

  const normals = beaters
    .filter((p) => p.combo.type !== 'bomb' && p.combo.type !== 'rocket')
    .sort((a, b) => a.combo.rank - b.combo.rank || a.cards.length - b.cards.length);
  if (normals.length) return normals[0].cards;

  // 只剩炸弹/王炸：地主快出完或对手出的是炸弹时才用
  const landlordLow = room.hands[room.landlordSeat].length <= 2;
  if (landlordLow || last.combo.type === 'bomb') {
    return beaters.sort((a, b) => a.combo.rank - b.combo.rank)[0].cards;
  }
  return null;
}

class DouDiZhuManager {
  constructor({ userManager, logger } = {}) {
    this.userManager = userManager;
    this.logger = logger || console;
    this.queue = [];
    this.rooms = new Map();
    this.accountRoom = new Map();
    this.socketAccount = new Map();
    this.roomSeq = 0;

    this.timer = setInterval(() => this.tick(), 1000);
    if (this.timer.unref) this.timer.unref();
  }

  /** 在 socket 连接时挂载斗地主事件 */
  attachSocket(socket) {
    socket.on('ddz_match_request', () => this.handleMatchRequest(socket));
    socket.on('ddz_cancel_match', () => this.handleCancelMatch(socket));
    socket.on('ddz_state_request', () => this.handleStateRequest(socket));
    socket.on('ddz_bid', (data) => this.handleBid(socket, data));
    socket.on('ddz_play', (data) => this.handlePlay(socket, data));
    socket.on('ddz_pass', () => this.handlePass(socket));
    socket.on('ddz_leave', () => this.handleLeave(socket));
    socket.on('disconnect', () => this.handleSocketClose(socket));
  }

  resolveAccount(socket) {
    const session = this.userManager.getUserBySocketId(socket.id);
    if (session && session.accountId) {
      this.socketAccount.set(socket.id, session.accountId);
      return { accountId: session.accountId, nickname: session.nickname || '玩家' };
    }
    return null;
  }

  getSocket(accountId) {
    if (!accountId || !this.userManager.getSocketByAccountId) return null;
    return this.userManager.getSocketByAccountId(accountId);
  }

  send(socket, event, payload) {
    try {
      socket.emit(event, payload);
    } catch (e) {
      // 连接已断开的场景忽略
    }
  }

  fail(socket, message) {
    this.send(socket, 'ddz_error', { message });
  }

  getRoomByAccount(accountId) {
    const roomId = this.accountRoom.get(accountId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  // ==================== 匹配 ====================

  handleMatchRequest(socket) {
    const user = this.resolveAccount(socket);
    if (!user) {
      this.fail(socket, '请先登录');
      return;
    }

    const existing = this.getRoomByAccount(user.accountId);
    if (existing) {
      // 已结算的房间不再恢复，直接清掉重新匹配
      if (existing.phase !== 'ended') {
        this.sendState(existing);
        return;
      }
      this.removeRoom(existing);
    }

    const queued = this.queue.find((q) => q.accountId === user.accountId);
    if (queued) {
      queued.socketId = socket.id;
      this.send(socket, 'ddz_queued', this.queueInfo(user.accountId));
      return;
    }

    this.queue.push({
      accountId: user.accountId,
      nickname: user.nickname,
      socketId: socket.id,
      joinedAt: Date.now(),
    });
    this.send(socket, 'ddz_queued', this.queueInfo(user.accountId));
    this.broadcastQueue();
    this.tryStartRoom();
  }

  queueInfo(accountId) {
    const index = this.queue.findIndex((q) => q.accountId === accountId);
    return {
      position: index >= 0 ? index + 1 : 0,
      aiInMs: Math.max(0, AI_FILL_DELAY - (Date.now() - (this.queue[index]?.joinedAt || Date.now()))),
    };
  }

  broadcastQueue() {
    this.queue.forEach((q) => {
      const socket = this.getSocket(q.accountId);
      if (socket) this.send(socket, 'ddz_queued', this.queueInfo(q.accountId));
    });
  }

  handleCancelMatch(socket) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.accountId !== user.accountId);
    if (this.queue.length !== before) {
      this.broadcastQueue();
    }
    this.send(socket, 'ddz_cancelled', {});
  }

  tick() {
    if (!this.queue.length) return;
    const oldest = this.queue[0];
    if (Date.now() - oldest.joinedAt >= AI_FILL_DELAY) {
      const humans = this.queue.splice(0, Math.min(3, this.queue.length));
      const room = this.createRoom(humans);
      this.broadcastQueue();
      this.startRoom(room);
      return;
    }
    this.tryStartRoom();
  }

  tryStartRoom() {
    while (this.queue.length >= 3) {
      const humans = this.queue.splice(0, 3);
      const room = this.createRoom(humans);
      this.broadcastQueue();
      this.startRoom(room);
    }
  }

  createRoom(humans) {
    this.roomSeq += 1;
    const roomId = `ddz_${Date.now().toString(36)}_${this.roomSeq}`;
    const seats = humans.map((h, index) => ({
      accountId: h.accountId,
      nickname: h.nickname || `玩家${index + 1}`,
      isAI: false,
      seat: index,
    }));
    while (seats.length < 3) {
      const index = seats.length;
      seats.push({
        accountId: null,
        nickname: `AI ${AI_NAMES[index % AI_NAMES.length]}`,
        isAI: true,
        seat: index,
      });
    }

    const deck = shuffle(createDeck());
    const hands = [[], [], []];
    for (let i = 0; i < 51; i += 1) hands[i % 3].push(deck[i]);
    const bottom = deck.slice(51, 54);

    const room = {
      id: roomId,
      seats,
      hands: hands.map(sortDesc),
      bottom: sortDesc(bottom),
      phase: 'bid', // bid | play | ended
      landlordSeat: -1,
      currentSeat: Math.floor(Math.random() * 3),
      bids: [],
      lastPlay: null,
      passCount: 0,
      turnToken: 0,
      winnerSeat: -1,
      landlordWin: false,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    seats.forEach((s) => {
      if (s.accountId) this.accountRoom.set(s.accountId, roomId);
    });
    return room;
  }

  startRoom(room) {
    room.seats.forEach((seat, index) => {
      if (seat.isAI) return;
      const socket = this.getSocket(seat.accountId);
      if (socket) {
        this.send(socket, 'ddz_match_success', { roomId: room.id, seat: index });
      }
    });
    this.emitState(room);
    this.scheduleAI(room);
    this.logger.info?.('斗地主房间创建', {
      roomId: room.id,
      seats: room.seats.map((s) => (s.isAI ? 'AI' : s.nickname)),
    });
  }

  // ==================== 状态同步 ====================

  handleStateRequest(socket) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    const room = this.getRoomByAccount(user.accountId);
    if (room) {
      const seat = room.seats.findIndex((s) => s.accountId === user.accountId);
      // 掉线后座位已被 AI 托管：按「无房间」处理，引导客户端重新匹配
      if (seat >= 0) this.sendSocketState(socket, room, seat);
      else this.send(socket, 'ddz_no_room', {});
    } else {
      this.send(socket, 'ddz_no_room', {});
    }
  }

  personalState(room, seat) {
    const players = room.seats.map((s, index) => ({
      seat: index,
      name: s.nickname,
      isAI: s.isAI,
      cards: room.hands[index].length,
      landlord: index === room.landlordSeat,
    }));
    return {
      roomId: room.id,
      seat,
      phase: room.phase,
      currentSeat: room.currentSeat,
      landlordSeat: room.landlordSeat,
      hand: sortDesc(room.hands[seat]),
      bottom: room.landlordSeat >= 0 ? room.bottom : null,
      players,
      bids: room.bids.slice(),
      lastPlay: room.lastPlay
        ? {
          seat: room.lastPlay.seat,
          playerName: room.seats[room.lastPlay.seat].nickname,
          cards: room.lastPlay.cards,
          type: room.lastPlay.combo.type,
        }
        : null,
      yourTurn: room.phase !== 'ended' && room.currentSeat === seat,
      canPass: room.phase === 'play' && !!room.lastPlay && room.lastPlay.seat !== seat,
      winnerSeat: room.winnerSeat,
      landlordWin: room.landlordWin,
    };
  }

  sendSocketState(socket, room, seat) {
    this.send(socket, 'ddz_state', this.personalState(room, seat));
  }

  emitState(room) {
    room.seats.forEach((s, index) => {
      if (s.isAI) return;
      const socket = this.getSocket(s.accountId);
      if (socket) this.sendSocketState(socket, room, index);
    });
  }

  // ==================== 叫地主 ====================

  handleBid(socket, data) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    const room = this.getRoomByAccount(user.accountId);
    if (!room) return this.fail(socket, '当前不在对局中');
    const seat = room.seats.findIndex((s) => s.accountId === user.accountId);
    if (room.phase !== 'bid') return this.fail(socket, '现在不能叫地主');
    if (room.currentSeat !== seat) return this.fail(socket, '还没轮到你');

    this.applyBid(room, seat, !!data?.call);
    this.emitState(room);
    this.scheduleAI(room);
  }

  applyBid(room, seat, call) {
    room.bids.push({ seat, call });
    room.lastActionAt = Date.now();

    if (call) {
      this.assignLandlord(room, seat);
      return;
    }
    if (room.bids.length >= 3) {
      this.assignLandlord(room, room.bids[0].seat);
      return;
    }
    room.currentSeat = nextSeat(seat);
    room.turnToken += 1;
  }

  assignLandlord(room, seat) {
    room.landlordSeat = seat;
    room.hands[seat] = sortDesc([...room.hands[seat], ...room.bottom]);
    room.phase = 'play';
    room.currentSeat = seat;
    room.lastPlay = null;
    room.passCount = 0;
    room.turnToken += 1;
    room.lastActionAt = Date.now();
  }

  // ==================== 出牌 ====================

  handlePlay(socket, data) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    const room = this.getRoomByAccount(user.accountId);
    if (!room) return this.fail(socket, '当前不在对局中');
    const seat = room.seats.findIndex((s) => s.accountId === user.accountId);
    if (room.phase !== 'play') return this.fail(socket, '现在不能出牌');
    if (room.currentSeat !== seat) return this.fail(socket, '还没轮到你');

    const ids = Array.isArray(data?.cards) ? data.cards : [];
    if (!ids.length) return this.fail(socket, '请选择要出的牌');
    const unique = new Set(ids);
    if (unique.size !== ids.length) return this.fail(socket, '选牌重复');

    const hand = room.hands[seat];
    const cards = ids.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) return this.fail(socket, '手牌中没有这些牌');

    const combo = classify(cards);
    if (!combo) return this.fail(socket, '牌型不合法（暂不支持四带二/飞机带翅膀）');
    if (room.lastPlay && !beats(combo, room.lastPlay.combo)) {
      return this.fail(socket, '管不上上家的牌');
    }

    this.applyPlay(room, seat, cards, combo);
    this.emitState(room);
    this.scheduleAI(room);
  }

  applyPlay(room, seat, cards, combo) {
    const ids = new Set(cards.map((c) => c.id));
    room.hands[seat] = room.hands[seat].filter((c) => !ids.has(c.id));
    room.lastPlay = { seat, cards: sortDesc(cards), combo };
    room.passCount = 0;
    room.lastActionAt = Date.now();

    if (room.hands[seat].length === 0) {
      this.finishRoom(room, seat);
      return;
    }
    room.currentSeat = nextSeat(seat);
    room.turnToken += 1;
  }

  handlePass(socket) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    const room = this.getRoomByAccount(user.accountId);
    if (!room) return this.fail(socket, '当前不在对局中');
    const seat = room.seats.findIndex((s) => s.accountId === user.accountId);
    if (room.phase !== 'play') return this.fail(socket, '现在不能过牌');
    if (room.currentSeat !== seat) return this.fail(socket, '还没轮到你');
    if (!room.lastPlay || room.lastPlay.seat === seat) {
      return this.fail(socket, '你是本轮先手，必须出牌');
    }

    this.applyPass(room, seat);
    this.emitState(room);
    this.scheduleAI(room);
  }

  applyPass(room, seat) {
    room.passCount += 1;
    if (room.passCount >= 2) {
      room.lastPlay = null;
      room.passCount = 0;
    }
    room.currentSeat = nextSeat(seat);
    room.turnToken += 1;
    room.lastActionAt = Date.now();
  }

  // ==================== AI ====================

  scheduleAI(room) {
    if (!room || room.phase === 'ended') return;
    const seat = room.seats[room.currentSeat];
    if (!seat || !seat.isAI) return;
    const token = room.turnToken;
    setTimeout(() => {
      if (room.phase === 'ended' || room.turnToken !== token) return;
      this.aiAct(room);
    }, AI_ACT_DELAY);
  }

  aiAct(room) {
    const seat = room.currentSeat;
    if (room.phase === 'bid') {
      const hand = room.hands[seat];
      let call = aiBidScore(hand) >= 5;
      // 前两家都不叫时，最后一家必须叫，避免无限流局
      if (!call && room.bids.length === 2 && !room.bids.some((b) => b.call)) call = true;
      this.applyBid(room, seat, call);
    } else if (room.phase === 'play') {
      const cards = aiChoosePlay(room, seat);
      if (cards) {
        const combo = classify(cards);
        this.applyPlay(room, seat, cards, combo);
      } else {
        this.applyPass(room, seat);
      }
    }
    this.emitState(room);
    this.scheduleAI(room);
  }

  // ==================== 结算 / 房间清理 ====================

  finishRoom(room, winnerSeat) {
    room.phase = 'ended';
    room.winnerSeat = winnerSeat;
    room.landlordWin = winnerSeat === room.landlordSeat;
    room.lastActionAt = Date.now();
    room.turnToken += 1;

    const payload = {
      roomId: room.id,
      winnerSeat,
      winnerName: room.seats[winnerSeat].nickname,
      landlordSeat: room.landlordSeat,
      landlordWin: room.landlordWin,
      hands: room.hands,
    };
    room.seats.forEach((s, index) => {
      if (s.isAI) return;
      const socket = this.getSocket(s.accountId);
      if (socket) this.send(socket, 'ddz_game_over', { ...payload, seat: index });
    });
    this.logger.info?.('斗地主对局结束', {
      roomId: room.id,
      winnerSeat,
      landlordWin: room.landlordWin,
    });

    const timer = setTimeout(() => this.removeRoom(room), ROOM_KEEP_MS);
    if (timer.unref) timer.unref();
  }

  removeRoom(room) {
    if (!this.rooms.has(room.id)) return;
    this.rooms.delete(room.id);
    room.seats.forEach((s) => {
      if (s.accountId && this.accountRoom.get(s.accountId) === room.id) {
        this.accountRoom.delete(s.accountId);
      }
    });
  }

  // ==================== 离开 / 断线 ====================

  handleLeave(socket) {
    const user = this.resolveAccount(socket);
    if (!user) return;
    this.queue = this.queue.filter((q) => q.accountId !== user.accountId);
    const room = this.getRoomByAccount(user.accountId);
    if (!room) {
      this.send(socket, 'ddz_left', {});
      return;
    }
    if (room.phase === 'ended') {
      // 已结束的房间直接清理解绑，避免「再来一局」时又恢复旧结算
      this.removeRoom(room);
    } else {
      this.replaceWithAI(room, user.accountId);
    }
    this.send(socket, 'ddz_left', {});
  }

  handleSocketClose(socket) {
    const accountId = this.socketAccount.get(socket.id);
    this.socketAccount.delete(socket.id);
    if (!accountId) return;
    this.queue = this.queue.filter((q) => q.accountId !== accountId);

    const room = this.getRoomByAccount(accountId);
    if (room && room.phase !== 'ended') {
      this.replaceWithAI(room, accountId);
    }
  }

  /** 玩家离开后由 AI 接管，保证另外两家能继续打完 */
  replaceWithAI(room, accountId) {
    const seat = room.seats.findIndex((s) => s.accountId === accountId);
    if (seat < 0) return;
    if (this.accountRoom.get(accountId) === room.id) {
      this.accountRoom.delete(accountId);
    }
    room.seats[seat] = {
      accountId: null,
      nickname: `${room.seats[seat].nickname}（托管）`,
      isAI: true,
      seat,
    };
    // 如果正好轮到该玩家，立刻交给 AI 行动
    if (room.currentSeat === seat && room.phase !== 'ended') {
      room.turnToken += 1;
      this.scheduleAI(room);
    }
    this.emitState(room);
  }
}

module.exports = {
  DouDiZhuManager,
  createDeck,
  classify,
  beats,
  generatePlays,
  aiChoosePlay,
  aiBidScore,
};
