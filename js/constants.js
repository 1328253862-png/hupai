/* global window, crypto */
(function () {
  "use strict";

  const Hushu = (window.Hushu = window.Hushu || {});

  Hushu.RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  Hushu.TARGET_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  Hushu.SORT_RANK_ORDER = {
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14,
    "2": 15,
    SJ: 16,
    BJ: 17
  };
  Hushu.SUITS = [
    { code: "S", symbol: "♠", name: "黑桃", order: 0, red: false },
    { code: "H", symbol: "♥", name: "红桃", order: 1, red: true },
    { code: "C", symbol: "♣", name: "梅花", order: 2, red: false },
    { code: "D", symbol: "♦", name: "方片", order: 3, red: true }
  ];
  Hushu.SUIT_BY_CODE = Object.fromEntries(Hushu.SUITS.map((suit) => [suit.code, suit]));
  Hushu.WILDCARD_RANKS = new Set(["2", "SJ", "BJ"]);
  Hushu.EMOJIS = ["🦊", "🐼", "🐯", "🐸", "🐵", "🐨", "🐷", "🐙", "🦄", "🐳", "🦁", "🐰"];
  Hushu.EMOJI_NAMES = {
    "🦊": "狐狸",
    "🐼": "熊猫",
    "🐯": "老虎",
    "🐸": "青蛙",
    "🐵": "猴子",
    "🐨": "考拉",
    "🐷": "小猪",
    "🐙": "章鱼",
    "🦄": "独角兽",
    "🐳": "鲸鱼",
    "🦁": "狮子",
    "🐰": "兔子"
  };

  Hushu.getCrypto = function () {
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      return window.crypto;
    }
    return null;
  };

  Hushu.randomInt = function (maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("randomInt 需要一个正整数");
    }

    const secureCrypto = Hushu.getCrypto();
    if (!secureCrypto) {
      return Math.floor(Math.random() * maxExclusive);
    }

    // 拒绝采样，避免把随机整数直接取模造成分布偏差。
    const maxUint32 = 0xffffffff;
    const limit = maxUint32 - (maxUint32 % maxExclusive);
    const buffer = new Uint32Array(1);
    do {
      secureCrypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % maxExclusive;
  };

  Hushu.randomId = function (length = 12) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let index = 0; index < length; index += 1) {
      result += alphabet[Hushu.randomInt(alphabet.length)];
    }
    return result;
  };

  Hushu.createMemberId = function () {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `member-${Date.now()}-${Hushu.randomId(16)}`;
  };

  Hushu.isValidMemberId = function (value) {
    const id = String(value || "");
    return (
      /^[a-zA-Z0-9_-]{1,80}$/.test(id) &&
      id !== "__proto__" &&
      id !== "prototype" &&
      id !== "constructor"
    );
  };

  Hushu.createRoomCode = function () {
    return String(100000 + Hushu.randomInt(900000));
  };

  Hushu.sanitizeText = function (value, maxLength) {
    const safe = String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return safe.slice(0, maxLength);
  };

  Hushu.normalizeEmoji = function (value) {
    return Hushu.EMOJIS.includes(value) ? value : Hushu.EMOJIS[0];
  };

  Hushu.escapeHtml = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  Hushu.formatTime = function (timestamp) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(timestamp));
    } catch (error) {
      return "";
    }
  };

  Hushu.getCardDisplay = function (card) {
    if (card.rank === "SJ") {
      return { rank: "小王", suit: "🃏", red: true, wild: true, joker: true };
    }
    if (card.rank === "BJ") {
      return { rank: "大王", suit: "🃏", red: false, wild: true, joker: true };
    }

    const suit = Hushu.SUIT_BY_CODE[card.suit] || Hushu.SUITS[0];
    return {
      rank: card.rank,
      suit: suit.symbol,
      red: suit.red,
      wild: card.rank === "2",
      joker: false
    };
  };

  Hushu.sortCards = function (cards) {
    return [...cards].sort((left, right) => {
      const rankDifference =
        (Hushu.SORT_RANK_ORDER[left.rank] || 99) - (Hushu.SORT_RANK_ORDER[right.rank] || 99);
      if (rankDifference !== 0) {
        return rankDifference;
      }
      const leftSuit = left.suit ? Hushu.SUIT_BY_CODE[left.suit] : { order: 9 };
      const rightSuit = right.suit ? Hushu.SUIT_BY_CODE[right.suit] : { order: 9 };
      return leftSuit.order - rightSuit.order;
    });
  };

  Hushu.readStorage = function (key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  };

  Hushu.writeStorage = function (key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // 隐私模式下 localStorage 可能不可写，资料仍可在本次页面中正常使用。
    }
  };
})();
