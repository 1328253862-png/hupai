/* global window */
(function () {
  "use strict";

  const Hushu = (window.Hushu = window.Hushu || {});
  const Core = (Hushu.Core = {});

  function ok(room, extra) {
    return Object.assign({ ok: true, room }, extra || {});
  }

  function fail(message) {
    return { ok: false, error: message };
  }

  function setEvent(room, type, data) {
    room.event = Object.assign(
      {
        id: Hushu.randomId(14),
        type,
        ts: Date.now()
      },
      data || {}
    );
    return room.event;
  }

  Core.createRoom = function (code, hostProfile, maxSeats) {
    const safeSeats = Math.max(2, Math.min(6, Number(maxSeats) || 4));
    return {
      code,
      maxSeats: safeSeats,
      hostId: hostProfile.id,
      status: "lobby",
      seats: Array(safeSeats).fill(null),
      members: {
        [hostProfile.id]: {
          id: hostProfile.id,
          name: hostProfile.name,
          avatar: hostProfile.avatar,
          connected: true,
          lastSeen: Date.now()
        }
      },
      settings: {
        deckCount: safeSeats > 4 ? 2 : 1,
        reportThree: true
      },
      game: null,
      result: null,
      event: null,
      chat: [],
      createdAt: Date.now()
    };
  };

  Core.isHost = function (room, memberId) {
    return Boolean(room && room.hostId === memberId);
  };

  Core.getMember = function (room, memberId) {
    return room && room.members ? room.members[memberId] || null : null;
  };

  Core.memberCount = function (room) {
    return room ? Object.keys(room.members).length : 0;
  };

  Core.seatedCount = function (room) {
    return room ? room.seats.filter(Boolean).length : 0;
  };

  Core.allSeatsFull = function (room) {
    return Boolean(room && room.seats.every(Boolean));
  };

  Core.addMember = function (room, profile) {
    if (!Hushu.isValidMemberId(profile.id)) {
      return fail("玩家 ID 格式不正确。");
    }
    if (room.status !== "lobby") {
      return fail("游戏已经开局，当前房间不能加入。");
    }
    if (Core.memberCount(room) >= room.maxSeats) {
      return fail("房间已经满员。");
    }
    if (room.members[profile.id]) {
      return ok(room, { member: room.members[profile.id], rejoined: true });
    }

    room.members[profile.id] = {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      connected: true,
      lastSeen: Date.now()
    };
    return ok(room, { member: room.members[profile.id], joined: true });
  };

  Core.restoreMemberConnection = function (room, memberId, profile) {
    if (!Hushu.isValidMemberId(memberId)) {
      return fail("玩家 ID 格式不正确。");
    }
    const member = Core.getMember(room, memberId);
    if (!member) {
      return fail("房间中没有这个玩家。");
    }
    member.connected = true;
    member.lastSeen = Date.now();
    if (profile) {
      if (profile.name) {
        member.name = Hushu.sanitizeText(profile.name, 10) || member.name;
      }
      if (profile.avatar) {
        member.avatar = Hushu.normalizeEmoji(profile.avatar);
      }
    }
    return ok(room, { member, rejoined: true });
  };

  Core.updateProfile = function (room, memberId, profile) {
    const member = Core.getMember(room, memberId);
    if (!member) {
      return fail("玩家不在房间中。");
    }

    const name = Hushu.sanitizeText(profile.name, 10);
    if (!name) {
      return fail("昵称不能为空。");
    }
    member.name = name;
    member.avatar = Hushu.normalizeEmoji(profile.avatar);
    return ok(room);
  };

  Core.markConnected = function (room, memberId, connected) {
    const member = Core.getMember(room, memberId);
    if (!member) {
      return fail("玩家不在房间中。");
    }
    member.connected = Boolean(connected);
    member.lastSeen = Date.now();
    return ok(room);
  };

  Core.removeMember = function (room, memberId) {
    const member = Core.getMember(room, memberId);
    if (!member) {
      return ok(room);
    }
    room.seats = room.seats.map((id) => (id === memberId ? null : id));
    delete room.members[memberId];

    if (room.game) {
      delete room.game.hands[memberId];
      // 正常运行中不会移除玩家；这里的清理仅用于异常调用时避免留下孤立数据。
      const removedIds = new Set(
        room.game.tableGroups
          .filter((group) => group.playerId === memberId)
          .flatMap((group) => group.cards.map((card) => card.id))
      );
      room.game.tableGroups = room.game.tableGroups.filter((group) => group.playerId !== memberId);
      room.game.table = room.game.table.filter((card) => !removedIds.has(card.id));
    }
    return ok(room);
  };

  Core.claimSeat = function (room, memberId, seatIndex) {
    if (room.status !== "lobby") {
      return fail("游戏进行中不能换座位。");
    }
    const member = Core.getMember(room, memberId);
    if (!member) {
      return fail("玩家不在房间中。");
    }
    const index = Number(seatIndex);
    if (!Number.isInteger(index) || index < 0 || index >= room.seats.length) {
      return fail("座位不存在。");
    }
    if (room.seats[index] && room.seats[index] !== memberId) {
      return fail("这个座位已经有人了。");
    }

    room.seats = room.seats.map((id) => (id === memberId ? null : id));
    room.seats[index] = memberId;
    return ok(room);
  };

  Core.leaveSeat = function (room, memberId) {
    if (room.status !== "lobby") {
      return fail("游戏进行中不能离开座位。");
    }
    if (!Core.getMember(room, memberId)) {
      return fail("玩家不在房间中。");
    }
    room.seats = room.seats.map((id) => (id === memberId ? null : id));
    return ok(room);
  };

  Core.changeMaxSeats = function (room, actorId, maxSeats) {
    if (!Core.isHost(room, actorId)) {
      return fail("只有房主可以修改座位数。");
    }
    if (room.status !== "lobby") {
      return fail("请先结束当前牌局再修改座位。");
    }

    const nextMax = Number(maxSeats);
    if (!Number.isInteger(nextMax) || nextMax < 2 || nextMax > 6) {
      return fail("座位数必须是 2–6 人。");
    }
    if (nextMax < Core.seatedCount(room) || nextMax < Core.memberCount(room)) {
      return fail("新座位数不能少于当前房间人数。");
    }

    const seatedIds = room.seats.filter(Boolean);
    room.maxSeats = nextMax;
    room.seats = Array(nextMax).fill(null);
    seatedIds.forEach((memberId, index) => {
      if (index < nextMax) {
        room.seats[index] = memberId;
      }
    });

    room.settings.deckCount = nextMax > 4 ? 2 : room.settings.deckCount;
    return ok(room);
  };

  Core.updateSettings = function (room, actorId, changes) {
    if (!Core.isHost(room, actorId)) {
      return fail("只有房主可以修改房间设置。");
    }
    if (room.status !== "lobby") {
      return fail("游戏开始后不能修改房间设置。");
    }

    if (typeof changes.reportThree === "boolean") {
      room.settings.reportThree = changes.reportThree;
    }

    if (changes.deckCount != null) {
      if (room.maxSeats > 4) {
        room.settings.deckCount = 2;
      } else if (Number(changes.deckCount) === 1 || Number(changes.deckCount) === 2) {
        room.settings.deckCount = Number(changes.deckCount);
      }
    }
    return ok(room);
  };

  Core.nextPlayerId = function (room, playerId, steps) {
    const total = room.maxSeats;
    const currentIndex = room.seats.indexOf(playerId);
    if (currentIndex < 0) {
      throw new Error("找不到当前玩家座位");
    }

    const distance = steps == null ? 1 : steps;
    for (let offset = 1; offset <= total; offset += 1) {
      const index = (currentIndex + offset * distance + total * 10) % total;
      const candidate = room.seats[index];
      if (candidate && room.members[candidate]) {
        return candidate;
      }
    }
    return playerId;
  };

  Core.createDeck = function (deckCount) {
    const cards = [];
    for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
      Hushu.SUITS.forEach((suit) => {
        Hushu.RANKS.forEach((rank) => {
          cards.push({
            id: `d${deckIndex + 1}-${suit.code}-${rank}`,
            deck: deckIndex + 1,
            suit: suit.code,
            rank
          });
        });
      });
      cards.push({
        id: `d${deckIndex + 1}-SJ`,
        deck: deckIndex + 1,
        suit: null,
        rank: "SJ"
      });
      cards.push({
        id: `d${deckIndex + 1}-BJ`,
        deck: deckIndex + 1,
        suit: null,
        rank: "BJ"
      });
    }
    return cards;
  };

  Core.shuffle = function (input) {
    const array = [...input];
    for (let index = array.length - 1; index > 0; index -= 1) {
      const swapIndex = Hushu.randomInt(index + 1);
      [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
    }
    return array;
  };

  Core.startGame = function (room, actorId) {
    if (!Core.isHost(room, actorId)) {
      return fail("只有房主可以开始游戏。");
    }
    if (room.status !== "lobby") {
      return fail("游戏已经开始。");
    }
    if (!Core.allSeatsFull(room)) {
      return fail("全部座位坐满后才能开始。");
    }

    const deckCount = room.maxSeats > 4 ? 2 : room.settings.deckCount;
    room.settings.deckCount = deckCount;
    const deck = Core.shuffle(Core.createDeck(deckCount));
    const hands = {};
    room.seats.forEach((memberId) => {
      hands[memberId] = [];
    });
    deck.forEach((card, index) => {
      const memberId = room.seats[index % room.maxSeats];
      hands[memberId].push(card);
    });

    const firstSeatIndex = Hushu.randomInt(room.seats.length);
    room.status = "playing";
    room.result = null;
    room.game = {
      hands,
      turn: room.seats[firstSeatIndex],
      target: null,
      lastPlayer: null,
      lastPlay: null,
      pendingWinner: null,
      phase: "round",
      table: [],
      tableGroups: [],
      roundNumber: 1,
      startedAt: Date.now(),
      sequence: 0
    };
    setEvent(room, "start", { firstPlayerId: room.game.turn });
    return ok(room);
  };

  Core.getPlayLimit = function (room) {
    return room && room.settings.deckCount === 2 ? 8 : 4;
  };

  Core.getChallengeCount = function (count) {
    return Number(count) <= 4 ? 1 : 2;
  };

  Core.isCardValidAgainstTarget = function (card, target) {
    return card.rank === target || Hushu.WILDCARD_RANKS.has(card.rank);
  };

  Core.playCards = function (room, actorId, payload) {
    if (room.status !== "playing" || !room.game) {
      return fail("当前没有进行中的牌局。");
    }
    const game = room.game;
    if (game.turn !== actorId) {
      return fail("还没轮到你。");
    }
    if (game.phase === "pending") {
      return fail("最后一手只能先选择掀牌或放弃质疑。");
    }
    if (!Core.getMember(room, actorId)) {
      return fail("玩家不在牌局中。");
    }

    const cardIds = Array.isArray(payload.cardIds) ? [...new Set(payload.cardIds.map(String))] : [];
    const limit = Core.getPlayLimit(room);
    if (cardIds.length < 1) {
      return fail("请至少选择一张牌。");
    }
    if (cardIds.length > limit) {
      return fail(`本局单次最多出 ${limit} 张牌。`);
    }

    const hand = game.hands[actorId] || [];
    const selected = hand.filter((card) => cardIds.includes(card.id));
    if (selected.length !== cardIds.length) {
      return fail("选择的牌不在你的手牌中。");
    }

    let target = game.target;
    if (!target) {
      target = String(payload.target || "");
      if (!Hushu.TARGET_RANKS.includes(target)) {
        return fail("新回合必须选择合法目标点数，王不能作为目标。");
      }
    } else if (payload.target && String(payload.target) !== target) {
      return fail(`本轮目标已锁定为 ${target}。`);
    }

    const selectedIds = new Set(cardIds);
    game.hands[actorId] = hand.filter((card) => !selectedIds.has(card.id));
    game.target = target;
    game.lastPlayer = actorId;
    game.lastPlay = {
      playerId: actorId,
      cards: selected.map((card) => ({ ...card })),
      declaredTarget: target,
      count: selected.length
    };
    game.tableGroups.push({
      playerId: actorId,
      cards: selected.map((card) => ({ ...card }))
    });
    game.table.push(...selected.map((card) => ({ ...card })));
    game.sequence += 1;

    const remainingCount = game.hands[actorId].length;
    const reportThree = room.settings.reportThree && remainingCount === 3;
    setEvent(room, "play", {
      playerId: actorId,
      count: selected.length,
      target,
      remainingCount,
      reportThree
    });

    if (remainingCount === 0) {
      game.pendingWinner = actorId;
      game.phase = "pending";
      game.turn = Core.nextPlayerId(room, actorId);
      room.event.pendingWinner = actorId;
    } else {
      game.turn = Core.nextPlayerId(room, actorId);
    }
    return ok(room);
  };

  Core.passTurn = function (room, actorId) {
    if (room.status !== "playing" || !room.game) {
      return fail("当前没有进行中的牌局。");
    }
    const game = room.game;
    if (game.turn !== actorId) {
      return fail("还没轮到你。");
    }

    if (game.phase === "pending") {
      const winnerId = game.pendingWinner;
      const winner = Core.getMember(room, winnerId);
      room.result = {
        winnerId,
        winnerName: winner ? winner.name : "未知玩家",
        reason: "最后一手无人质疑",
        endedAt: Date.now()
      };
      game.phase = "finished";
      room.status = "finished";
      setEvent(room, "win", {
        winnerId,
        reason: "最后一手无人质疑，直接获胜"
      });
      return ok(room);
    }

    if (!game.lastPlay || !game.lastPlayer) {
      return fail("新一轮由你出牌，不能一上来就过牌。");
    }

    const oldLastPlayer = game.lastPlayer;
    const nextPlayer = Core.nextPlayerId(room, actorId);
    if (nextPlayer === oldLastPlayer) {
      game.table = [];
      game.tableGroups = [];
      game.target = null;
      game.lastPlay = null;
      game.lastPlayer = null;
      game.turn = oldLastPlayer;
      game.roundNumber += 1;
      setEvent(room, "discard", {
        leaderId: oldLastPlayer,
        passedBy: actorId
      });
    } else {
      game.turn = nextPlayer;
      setEvent(room, "pass", {
        playerId: actorId,
        nextPlayerId: nextPlayer
      });
    }
    return ok(room);
  };

  function giveCardsToPlayer(game, memberId, cards) {
    if (!game.hands[memberId]) {
      game.hands[memberId] = [];
    }
    game.hands[memberId].push(...cards.map((card) => ({ ...card })));
  }

  Core.challenge = function (room, actorId, payload) {
    if (room.status !== "playing" || !room.game) {
      return fail("当前没有进行中的牌局。");
    }
    const game = room.game;
    if (game.turn !== actorId) {
      return fail("还没轮到你。");
    }
    if (!game.lastPlay || !game.lastPlayer) {
      return fail("本轮还没有可质疑的出牌。");
    }
    if (actorId === game.lastPlayer) {
      return fail("不能质疑自己的出牌。");
    }

    const requiredCount = Core.getChallengeCount(game.lastPlay.count);
    const cardIds = Array.isArray(payload.cardIds) ? [...new Set(payload.cardIds.map(String))] : [];
    if (cardIds.length !== requiredCount) {
      return fail(`本次必须手动选择 ${requiredCount} 张牌。`);
    }

    const eligibleCards = game.lastPlay.cards;
    const eligibleIds = new Set(eligibleCards.map((card) => card.id));
    if (cardIds.some((id) => !eligibleIds.has(id))) {
      return fail("只能从上一手实际打出的牌中选择。");
    }

    const selectedCards = eligibleCards.filter((card) => cardIds.includes(card.id));
    const target = game.lastPlay.declaredTarget;
    const challengeSucceeded = selectedCards.some((card) => {
      return !Core.isCardValidAgainstTarget(card, target);
    });

    const lastPlayerId = game.lastPlayer;
    const pendingWinnerId = game.phase === "pending" ? game.pendingWinner : null;
    const pile = game.table.map((card) => ({ ...card }));
    const recipientId = challengeSucceeded ? lastPlayerId : actorId;
    giveCardsToPlayer(game, recipientId, pile);

    game.table = [];
    game.tableGroups = [];
    game.target = null;
    game.lastPlay = null;
    game.lastPlayer = null;
    game.pendingWinner = null;
    game.roundNumber += 1;

    let nextLeaderId = null;
    let winnerId = null;

    if (challengeSucceeded) {
      nextLeaderId = actorId;
      game.turn = actorId;
      game.phase = "round";
    } else if (pendingWinnerId) {
      winnerId = pendingWinnerId;
      game.turn = pendingWinnerId;
      game.phase = "finished";
      room.status = "finished";
      const winner = Core.getMember(room, winnerId);
      room.result = {
        winnerId,
        winnerName: winner ? winner.name : "未知玩家",
        reason: "最后一手质疑失败",
        endedAt: Date.now()
      };
    } else {
      nextLeaderId = Core.nextPlayerId(room, actorId);
      game.turn = nextLeaderId;
      game.phase = "round";
    }

    setEvent(room, "challenge", {
      challengerId: actorId,
      lastPlayerId,
      recipientId,
      success: challengeSucceeded,
      selectedCount: requiredCount,
      revealedCards: selectedCards.map((card) => ({ ...card })),
      target,
      nextLeaderId,
      winnerId
    });
    return ok(room);
  };

  Core.addChat = function (room, memberId, text) {
    const member = Core.getMember(room, memberId);
    if (!member) {
      return fail("玩家不在房间中。");
    }
    const message = Hushu.sanitizeText(text, 80);
    if (!message) {
      return fail("消息不能为空。");
    }
    room.chat.push({
      id: Hushu.randomId(10),
      memberId,
      name: member.name,
      avatar: member.avatar,
      text: message,
      ts: Date.now()
    });
    if (room.chat.length > 80) {
      room.chat.splice(0, room.chat.length - 80);
    }
    return ok(room);
  };

  Core.returnToLobby = function (room, actorId) {
    if (!Core.isHost(room, actorId)) {
      return fail("只有房主可以返回房间。");
    }
    if (room.status !== "finished") {
      return fail("当前牌局还没有结束。");
    }

    Object.values(room.members).forEach((member) => {
      if (!member.connected) {
        room.seats = room.seats.map((id) => (id === member.id ? null : id));
        delete room.members[member.id];
      }
    });

    room.status = "lobby";
    room.game = null;
    room.result = null;
    room.settings.deckCount = room.maxSeats > 4 ? 2 : room.settings.deckCount;
    setEvent(room, "returned", {});
    return ok(room);
  };

  Core.finishForDisconnect = function (room, memberId, reason) {
    if (room.status !== "playing" || !room.game) {
      return fail("当前没有正在进行的牌局。");
    }
    const member = Core.getMember(room, memberId);
    room.result = {
      winnerId: null,
      winnerName: null,
      reason: reason || `${member ? member.name : "一名玩家"}掉线，本局结束`,
      endedAt: Date.now()
    };
    room.game.phase = "finished";
    room.status = "finished";
    setEvent(room, "disconnect-end", {
      memberId,
      memberName: member ? member.name : "一名玩家",
      reason: room.result.reason
    });
    return ok(room);
  };

  Core.makeView = function (room, memberId) {
    const publicMembers = {};
    Object.values(room.members).forEach((member) => {
      publicMembers[member.id] = {
        id: member.id,
        name: member.name,
        avatar: member.avatar,
        connected: Boolean(member.connected)
      };
    });

    let gameView = null;
    if (room.game) {
      const handCounts = {};
      Object.keys(room.game.hands).forEach((playerId) => {
        handCounts[playerId] = room.game.hands[playerId].length;
      });
      gameView = {
        startedAt: room.game.startedAt,
        hand: (room.game.hands[memberId] || []).map((card) => ({ ...card })),
        handCounts,
        turn: room.game.turn,
        target: room.game.target,
        lastPlayer: room.game.lastPlayer,
        phase: room.game.phase,
        pendingWinner: room.game.pendingWinner,
        roundNumber: room.game.roundNumber,
        table: room.game.table.map((card) => ({ id: card.id })),
        tableGroups: room.game.tableGroups.map((group) => ({
          playerId: group.playerId,
          cardIds: group.cards.map((card) => card.id)
        })),
        lastPlay: room.game.lastPlay
          ? {
              playerId: room.game.lastPlay.playerId,
              count: room.game.lastPlay.count,
              cardIds: room.game.lastPlay.cards.map((card) => card.id)
            }
          : null
      };
    }

    return {
      code: room.code,
      maxSeats: room.maxSeats,
      hostId: room.hostId,
      status: room.status,
      seats: [...room.seats],
      members: publicMembers,
      settings: { ...room.settings },
      game: gameView,
      result: room.result ? { ...room.result } : null,
      event: room.event ? JSON.parse(JSON.stringify(room.event)) : null,
      chat: room.chat.map((message) => ({ ...message })),
      me: publicMembers[memberId] || null,
      meSeat: room.seats.indexOf(memberId),
      playLimit: Core.getPlayLimit(room),
      challengeCount:
        gameView && gameView.lastPlay ? Core.getChallengeCount(gameView.lastPlay.count) : 0,
      serverTime: Date.now()
    };
  };

  Core.reconnectGraceMs = window.HushuConfig.reconnectGraceMs;
})();
