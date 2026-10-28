/* global window, document, Peer */
(function () {
  "use strict";

  const Hushu = window.Hushu;
  const Core = Hushu.Core;
  const Config = window.HushuConfig;
  const $ = (id) => document.getElementById(id);

  const App = {
    network: null,
    isHost: false,
    room: null,
    view: null,
    myId: null,
    profile: null,
    selectedCardIds: new Set(),
    challengeMode: false,
    challengeSelected: new Set(),
    handOrder: [],
    handStacks: [],
    handLayoutStartedAt: null,
    dragHoldTimer: null,
    seenEventId: null,
    seenResultEventId: null,
    memberConnections: new Map(),
    connMembers: new Map(),
    disconnectTimers: new Map(),
    hostHeartbeatTimer: null,
    clientHeartbeatTimer: null,
    clientDisconnectTimer: null,
    profileUpdateTimer: null,
    joinAcceptTimer: null,
    dialogOnClose: null,
    dragState: null,
    activeScreen: null,
    leaving: false,
    joining: false,
    creating: false
  };

  window.HushuApp = App;

  function loadProfile() {
    const saved = Hushu.readStorage("hushu-profile-v1", {});
    return {
      id: Hushu.isValidMemberId(saved.memberId) ? saved.memberId : Hushu.createMemberId(),
      name: Hushu.sanitizeText(saved.name, 10) || `玩家${String(Hushu.randomInt(90) + 10)}`,
      avatar: Hushu.normalizeEmoji(saved.avatar)
    };
  }

  function saveProfile() {
    Hushu.writeStorage("hushu-profile-v1", {
      memberId: App.profile.id,
      name: App.profile.name,
      avatar: App.profile.avatar
    });
  }

  function setNetworkPill(text, state) {
    const pill = $("network-pill");
    pill.textContent = text;
    pill.dataset.state = state || "idle";
  }

  function showToast(message, type, duration) {
    const node = document.createElement("div");
    node.className = `toast ${type || ""}`;
    node.textContent = message;
    $("toast-region").appendChild(node);
    window.setTimeout(() => {
      node.remove();
    }, duration || 2600);
  }

  function openDialog(options) {
    const dialog = $("app-dialog");
    $("dialog-eyebrow").textContent = options.eyebrow || "唬牌";
    $("dialog-title").textContent = options.title || "提示";
    $("dialog-body").innerHTML = options.body || "";
    $("dialog-actions").replaceChildren();

    (options.actions || [{ label: "知道了", className: "primary-button" }]).forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className || "primary-button";
      button.textContent = action.label;
      button.disabled = Boolean(action.disabled);
      button.addEventListener("click", () => {
        let shouldClose = true;
        if (typeof action.onClick === "function") {
          shouldClose = action.onClick() !== false;
        }
        if (shouldClose && dialog.open) {
          dialog.close();
        }
      });
      $("dialog-actions").appendChild(button);
    });

    App.dialogOnClose = typeof options.onClose === "function" ? options.onClose : null;
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function closeDialog() {
    const dialog = $("app-dialog");
    if (dialog.open) {
      dialog.close();
    }
  }

  function showRulesDialog() {
    openDialog({
      eyebrow: "先看一眼",
      title: "唬牌规则",
      body: `
        <div class="rules-grid">
          <p>每人拿到随机洗好的牌。首位玩家选择目标点数并倒扣出牌，之后每个人只能跟同一目标，也可以过牌或掀牌。</p>
          <p><strong>万能牌：</strong>2、小王、大王可以代替 A–K 的任意点数。新一轮目标可以选择 A、2、3–10、J、Q、K；王不能作为目标。</p>
          <p><strong>出牌上限：</strong>一副牌单次最多 4 张，两副牌最多 8 张。5–6 人强制使用两副牌。</p>
          <div class="rule-callout">掀牌时只能从“上一名实际出牌玩家最后一次打出的牌”中手动选择。上一手不超过 4 张时选 1 张，超过 4 张时选 2 张。禁止随机抽牌。</div>
          <p><strong>掀牌成功：</strong>选中牌里只要有一张既不是目标点数、也不是万能牌，上一名出牌玩家就收走本轮桌上全部牌，由质疑者开启新一轮。</p>
          <p><strong>掀牌失败：</strong>质疑者收走本轮桌上全部牌，由顺时针下一位玩家开启新一轮。</p>
          <p><strong>一圈过牌：</strong>其他玩家都过牌并再次轮到上一名出牌玩家时，本轮桌面牌永久弃置，由他开启新一轮。</p>
          <p><strong>最后一手：</strong>玩家打出最后一张牌后不立即获胜。顺时针下一位玩家必须选择掀牌或过牌：过牌则最后一手获胜；质疑失败仍由最后一手玩家获胜；质疑成功则最后一手玩家收牌，质疑者开启新一轮。</p>
          <p><strong>剩三张：</strong>房主可开启公开播报。玩家手牌恰好剩 3 张时，全桌会看到提醒。</p>
          <p><strong>掉线：</strong>游戏中有玩家超过 10 秒未恢复连接，本局立即结束。房主离开则房间结束。</p>
          <p>发牌后手牌会自动按点数组好，同点牌向上叠放并露出每张点数和花色。一副牌时同一牌摞最多 4 张，两副牌时最多 8 张。等待别人操作时可以拖动整摞调整位置，也可以点“一键理牌”。轮到自己出牌时会暂时锁定手牌整理：单击选中一张，在第一张牌上按住并拖动，可以连续选中扫过的牌。手牌排列只保存在你自己的浏览器。</p>
        </div>
      `
    });
  }

  function showProfileDialog() {
    const avatarOptions = Hushu.EMOJIS.map((emoji) => {
      const selected = emoji === App.profile.avatar ? " selected" : "";
      return `<option value="${emoji}"${selected}>${emoji}  ${Hushu.EMOJI_NAMES[emoji]}</option>`;
    }).join("");
    openDialog({
      eyebrow: "全房间实时同步",
      title: "修改昵称与头像",
      body: `
        <label class="field-label" for="profile-dialog-name">昵称</label>
        <input id="profile-dialog-name" class="text-input" type="text" maxlength="10" value="${Hushu.escapeHtml(App.profile.name)}">
        <label class="field-label" for="profile-dialog-avatar">Emoji 头像</label>
        <select id="profile-dialog-avatar" class="text-input avatar-select">${avatarOptions}</select>
        <p class="field-hint">保存后会立即同步给房间里的所有玩家。</p>
      `,
      actions: [
        {
          label: "保存资料",
          className: "primary-button",
          onClick: () => {
            const name = Hushu.sanitizeText($("profile-dialog-name").value, 10);
            if (!name) {
              showToast("昵称不能为空。", "error");
              return false;
            }
            App.profile.name = name;
            App.profile.avatar = Hushu.normalizeEmoji($("profile-dialog-avatar").value);
            saveProfile();
            syncProfileControls();
            sendProfileUpdate();
            showToast("资料已更新。", "important", 1800);
            return true;
          }
        },
        { label: "取消", className: "secondary-button" }
      ]
    });
  }

  function fillStaticOptions() {
    ["lobby-avatar", "room-avatar"].forEach((id) => {
      const select = $(id);
      select.replaceChildren();
      Hushu.EMOJIS.forEach((emoji) => {
        const option = document.createElement("option");
        option.value = emoji;
        option.textContent = `${emoji}  ${Hushu.EMOJI_NAMES[emoji]}`;
        select.appendChild(option);
      });
    });

    const targetSelect = $("target-rank");
    Hushu.TARGET_RANKS.forEach((rank) => {
      const option = document.createElement("option");
      option.value = rank;
      option.textContent = rank === "10" ? "10 点" : `${rank} 点`;
      targetSelect.appendChild(option);
    });
  }

  function syncProfileControls() {
    if (document.activeElement !== $("lobby-name")) {
      $("lobby-name").value = App.profile.name;
    }
    if (document.activeElement !== $("room-name")) {
      $("room-name").value = App.profile.name;
    }
    $("lobby-avatar").value = App.profile.avatar;
    $("room-avatar").value = App.profile.avatar;
    $("profile-preview").textContent = App.profile.avatar;
    $("room-profile-preview").textContent = App.profile.avatar;
  }

  function updateProfileFromInput(source) {
    const rawName = source === "room" ? $("room-name").value : $("lobby-name").value;
    const name = Hushu.sanitizeText(rawName, 10);
    if (!name) {
      return;
    }
    App.profile.name = name;
    saveProfile();
    if (document.activeElement !== $("lobby-name")) {
      $("lobby-name").value = name;
    }
    if (document.activeElement !== $("room-name")) {
      $("room-name").value = name;
    }
    queueProfileSync();
  }

  function updateAvatar(value) {
    App.profile.avatar = Hushu.normalizeEmoji(value);
    saveProfile();
    syncProfileControls();
    sendProfileUpdate();
  }

  function queueProfileSync() {
    window.clearTimeout(App.profileUpdateTimer);
    App.profileUpdateTimer = window.setTimeout(sendProfileUpdate, 260);
  }

  function sendProfileUpdate() {
    if (!App.view || !App.myId || !App.profile.name) {
      return;
    }
    if (App.isHost) {
      const result = Core.updateProfile(App.room, App.myId, App.profile);
      if (result.ok) {
        afterHostMutation();
      }
      return;
    }
    if (App.network) {
      App.network.sendToHost({ type: "profile", profile: { ...App.profile } });
    }
  }

  function setButtonLoading(button, loading, loadingText) {
    if (loading) {
      button.dataset.originalText = button.innerHTML;
      button.textContent = loadingText;
      button.disabled = true;
      button.classList.add("btn-loading");
    } else {
      if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
        delete button.dataset.originalText;
      }
      button.disabled = false;
      button.classList.remove("btn-loading");
    }
  }

  async function createRoom() {
    if (App.creating || App.view) {
      return;
    }
    App.creating = true;
    updateProfileFromInput("lobby");
    saveProfile();
    setButtonLoading($("create-room-button"), true, "正在创建…");
    setNetworkPill("连接信令中", "connecting");

    const maxSeats = Number($("create-max-seats").value);
    try {
      const network = new Hushu.Network({
        hostMessage: handleHostMessage,
        connectionOpened: () => setNetworkPill("房间在线", "online"),
        connectionClosed: handleHostConnectionClosed,
        signalState: (state) => {
          if (state === "online") {
            setNetworkPill("房间在线", "online");
          } else if (state === "disconnected") {
            setNetworkPill("信令重连中", "connecting");
          } else {
            setNetworkPill("信令离线", "error");
          }
        },
        hostError: (error) => {
          setNetworkPill("联机异常", "error");
          showToast(error && error.message ? error.message : "房主连接出现异常。", "error", 4200);
        }
      });
      App.network = network;
      const hostInfo = await network.createHost();
      App.isHost = true;
      App.myId = App.profile.id;
      App.room = Core.createRoom(hostInfo.code, App.profile, maxSeats);
      App.view = Core.makeView(App.room, App.myId);
      App.memberConnections.clear();
      App.connMembers.clear();
      startHostHeartbeat();
      setNetworkPill("房间在线", "online");
      render();
      showToast("房间已创建，把房间号发给朋友吧。", "important", 3200);
    } catch (error) {
      if (App.network) {
        App.network.destroy();
        App.network = null;
      }
      setNetworkPill("创建失败", "error");
      showToast(error.message || "创建房间失败。", "error", 5200);
    } finally {
      App.creating = false;
      setButtonLoading($("create-room-button"), false);
    }
  }

  async function joinRoom() {
    if (App.joining || App.view) {
      return;
    }
    const code = Hushu.sanitizeText($("join-code").value, 6);
    if (!/^\d{6}$/.test(code)) {
      showToast("请输入 6 位数字房间号。", "error");
      return;
    }

    updateProfileFromInput("lobby");
    saveProfile();
    App.joining = true;
    setButtonLoading($("join-room-button"), true, "正在连接…");
    setNetworkPill("连接房主中", "connecting");

    try {
      const network = createClientNetwork();
      App.network = network;
      await network.connectToHost(code);
      network.sendToHost({
        type: "join-request",
        profile: { ...App.profile }
      });
      window.clearTimeout(App.joinAcceptTimer);
      App.joinAcceptTimer = window.setTimeout(() => {
        if (App.joining && !App.view) {
          App.joining = false;
          setButtonLoading($("join-room-button"), false);
          setNetworkPill("加入超时", "error");
          showToast("房主没有响应入座请求，请确认房间号和房主页面状态。", "error", 4800);
          if (App.network) {
            App.network.destroy();
            App.network = null;
          }
        }
      }, 9000);
    } catch (error) {
      if (App.network) {
        App.network.destroy();
      }
      App.network = null;
      App.joining = false;
      setButtonLoading($("join-room-button"), false);
      setNetworkPill("连接失败", "error");
      showToast(error.message || "加入房间失败。", "error", 5200);
    }
  }

  function createClientNetwork() {
    return new Hushu.Network({
      clientMessage: handleClientMessage,
      clientFatal: handleClientFatal,
      clientDisconnected: handleClientConnectionLost,
      clientError: (error) => {
        if (error && error.type === "network") {
          setNetworkPill("网络异常", "error");
        }
      },
      signalState: (state) => {
        if (state === "online") {
          setNetworkPill("消息直连", "online");
        } else if (state === "disconnected") {
          setNetworkPill("信令重连中", "connecting");
        }
      }
    });
  }

  function handleClientMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "join-accepted") {
      window.clearTimeout(App.joinAcceptTimer);
      App.joinAcceptTimer = null;
      App.myId = message.memberId || App.profile.id;
      startClientHeartbeat();
      return;
    }
    if (message.type === "join-rejected") {
      window.clearTimeout(App.joinAcceptTimer);
      App.joinAcceptTimer = null;
      App.joining = false;
      setButtonLoading($("join-room-button"), false);
      setNetworkPill("加入失败", "error");
      showToast(message.message || "无法加入房间。", "error", 4400);
      if (App.network) {
        App.network.destroy();
        App.network = null;
      }
      return;
    }
    if (message.type === "action-error") {
      showToast(message.message || "操作未通过房主校验。", "error", 3200);
      return;
    }
    if (message.type === "pong") {
      return;
    }
    if (message.type === "room-closed") {
      handleClientFatal(message.message || "房主已经关闭房间。");
      return;
    }
    if (message.type === "state" && message.view) {
      window.clearTimeout(App.joinAcceptTimer);
      App.joinAcceptTimer = null;
      App.joining = false;
      setButtonLoading($("join-room-button"), false);
      App.view = message.view;
      App.myId = App.view.me ? App.view.me.id : App.myId;
      setNetworkPill("消息直连", "online");
      applyIncomingView();
      return;
    }
  }

  function handleClientFatal(message) {
    if (App.leaving) {
      return;
    }
    setNetworkPill("连接断开", "error");
    showToast(message, "error", 5000);
    if (!App.view) {
      if (App.network) {
        App.network.destroy();
      }
      App.network = null;
      App.joining = false;
      setButtonLoading($("join-room-button"), false);
      return;
    }
    openDialog({
      eyebrow: "联机中断",
      title: "连接已断开",
      body: `<p>${Hushu.escapeHtml(message)}</p><p>房主网页关闭后无法从其他浏览器恢复本局。</p>`,
      actions: [
        {
          label: "返回大厅",
          className: "primary-button",
          onClick: () => teardownToLobby()
        }
      ]
    });
  }

  function handleClientConnectionLost() {
    if (App.leaving) {
      return;
    }
    setNetworkPill("连接中断", "error");
    const banner = $("network-banner");
    banner.hidden = false;
    banner.textContent = "与房主的连接中断，房主将在 10 秒后结束牌局。";
    window.clearTimeout(App.clientDisconnectTimer);
    App.clientDisconnectTimer = window.setTimeout(() => {
      if (!App.leaving && App.view && App.view.status === "playing") {
        handleClientFatal("没有恢复与房主的连接，本局已经结束。");
      }
    }, Config.reconnectGraceMs + 1500);
  }

  function handleHostMessage(message, connection) {
    if (!message || typeof message !== "object" || !App.isHost || !App.room) {
      return;
    }

    if (message.type === "ping") {
      const memberId = App.connMembers.get(connection.peer);
      const member = Core.getMember(App.room, memberId);
      if (member) {
        member.lastSeen = Date.now();
      }
      App.network.sendToConnection(connection, { type: "pong", ts: Date.now() });
      return;
    }

    if (message.type === "join-request") {
      handleJoinRequest(message, connection);
      return;
    }

    const memberId = App.connMembers.get(connection.peer);
    const member = Core.getMember(App.room, memberId);
    if (!member) {
      App.network.sendToConnection(connection, {
        type: "action-error",
        message: "你还没有加入这个房间。"
      });
      return;
    }
    member.lastSeen = Date.now();

    let result;
    switch (message.type) {
      case "claim-seat":
        result = Core.claimSeat(App.room, memberId, message.seatIndex);
        break;
      case "profile":
        result = Core.updateProfile(App.room, memberId, message.profile || {});
        break;
      case "play":
        result = Core.playCards(App.room, memberId, message.payload || {});
        break;
      case "challenge":
        result = Core.challenge(App.room, memberId, message.payload || {});
        break;
      case "pass":
        result = Core.passTurn(App.room, memberId);
        break;
      case "chat":
        result = Core.addChat(App.room, memberId, message.text);
        break;
      case "leave":
        handleRemoteLeave(memberId, connection);
        return;
      default:
        result = { ok: false, error: "未知操作。" };
    }

    if (!result || !result.ok) {
      App.network.sendToConnection(connection, {
        type: "action-error",
        message: result && result.error ? result.error : "操作失败。"
      });
      return;
    }
    afterHostMutation();
  }

  function handleJoinRequest(message, connection) {
    const profile = message.profile || {};
    const memberId = Hushu.sanitizeText(profile.id, 80);
    const name = Hushu.sanitizeText(profile.name, 10);

    if (!Hushu.isValidMemberId(memberId) || !name) {
      App.network.sendToConnection(connection, {
        type: "join-rejected",
        message: "玩家资料不完整。"
      });
      return;
    }
    if (memberId === App.room.hostId) {
      App.network.sendToConnection(connection, {
        type: "join-rejected",
        message: "不能使用房主身份加入。"
      });
      return;
    }

    const existing = Core.getMember(App.room, memberId);
    if (!existing && App.room.status !== "lobby") {
      App.network.sendToConnection(connection, {
        type: "join-rejected",
        message: "游戏正在进行，暂不开放新玩家加入。"
      });
      return;
    }
    if (!existing && Core.memberCount(App.room) >= App.room.maxSeats) {
      App.network.sendToConnection(connection, {
        type: "join-rejected",
        message: "房间已经满员。"
      });
      return;
    }

    const previous = App.memberConnections.get(memberId);
    App.memberConnections.set(memberId, connection);
    App.connMembers.set(connection.peer, memberId);
    App.network.bindMemberConnection(connection, memberId);
    window.clearTimeout(App.disconnectTimers.get(memberId));
    App.disconnectTimers.delete(memberId);

    let result;
    if (existing) {
      result = Core.restoreMemberConnection(App.room, memberId, {
        name,
        avatar: profile.avatar
      });
    } else {
      result = Core.addMember(App.room, {
        id: memberId,
        name,
        avatar: Hushu.normalizeEmoji(profile.avatar)
      });
    }

    if (!result.ok) {
      App.memberConnections.delete(memberId);
      App.connMembers.delete(connection.peer);
      App.network.sendToConnection(connection, {
        type: "join-rejected",
        message: result.error
      });
      return;
    }

    App.network.sendToConnection(connection, {
      type: "join-accepted",
      memberId
    });

    if (previous && previous !== connection) {
      App.connMembers.delete(previous.peer);
      App.network.closeConnection(previous);
    }
    afterHostMutation();
  }

  function handleRemoteLeave(memberId, connection) {
    const current = App.memberConnections.get(memberId);
    if (current !== connection) {
      return;
    }
    App.memberConnections.delete(memberId);
    App.connMembers.delete(connection.peer);

    if (App.room.status === "playing") {
      const member = Core.getMember(App.room, memberId);
      const name = member ? member.name : "一名玩家";
      Core.finishForDisconnect(App.room, memberId, `${name}主动离开，本局结束`);
    } else if (App.room.status === "lobby") {
      Core.removeMember(App.room, memberId);
    } else {
      Core.markConnected(App.room, memberId, false);
    }
    App.network.closeConnection(connection);
    afterHostMutation();
  }

  function handleHostConnectionClosed(connection, recordMemberId) {
    const memberId = App.connMembers.get(connection.peer) || recordMemberId;
    if (!memberId) {
      return;
    }
    const current = App.memberConnections.get(memberId);
    if (current && current !== connection) {
      // 同一玩家已经在新连接上恢复，旧连接关闭不应再次判掉线。
      App.connMembers.delete(connection.peer);
      return;
    }

    App.memberConnections.delete(memberId);
    App.connMembers.delete(connection.peer);
    const member = Core.getMember(App.room, memberId);
    if (!member) {
      return;
    }

    if (App.room.status === "lobby") {
      Core.removeMember(App.room, memberId);
      afterHostMutation();
      return;
    }

    Core.markConnected(App.room, memberId, false);
    if (App.room.status === "playing") {
      window.clearTimeout(App.disconnectTimers.get(memberId));
      const timer = window.setTimeout(() => {
        App.disconnectTimers.delete(memberId);
        const currentMember = Core.getMember(App.room, memberId);
        if (
          currentMember &&
          !currentMember.connected &&
          App.room.status === "playing"
        ) {
          Core.finishForDisconnect(App.room, memberId);
          afterHostMutation();
        }
      }, Config.reconnectGraceMs);
      App.disconnectTimers.set(memberId, timer);
    }
    afterHostMutation();
  }

  function startHostHeartbeat() {
    window.clearInterval(App.hostHeartbeatTimer);
    App.hostHeartbeatTimer = window.setInterval(() => {
      if (!App.isHost || !App.room) {
        return;
      }
      const now = Date.now();
      Object.values(App.room.members).forEach((member) => {
        if (member.id === App.room.hostId || !member.connected) {
          return;
        }
        if (now - member.lastSeen <= Config.heartbeatTimeoutMs) {
          return;
        }
        const record = App.network.getMemberRecord(member.id);
        if (record && record.conn && record.conn.open) {
          App.network.closeConnection(record.conn);
        }
      });
    }, Config.heartbeatMs);
  }

  function startClientHeartbeat() {
    window.clearInterval(App.clientHeartbeatTimer);
    App.clientHeartbeatTimer = window.setInterval(() => {
      if (!App.network || App.isHost || App.leaving) {
        return;
      }
      App.network.sendToHost({ type: "ping", ts: Date.now() });
    }, Config.heartbeatMs);
  }

  function broadcastViews() {
    if (!App.isHost || !App.room || !App.network) {
      return;
    }
    Object.keys(App.room.members).forEach((memberId) => {
      if (memberId === App.myId) {
        return;
      }
      const member = App.room.members[memberId];
      if (!member || !member.connected) {
        return;
      }
      App.network.sendToMember(memberId, {
        type: "state",
        view: Core.makeView(App.room, memberId)
      });
    });
  }

  function afterHostMutation() {
    if (!App.isHost || !App.room) {
      return;
    }
    App.view = Core.makeView(App.room, App.myId);
    broadcastViews();
    render();
  }

  function applyIncomingView() {
    if (!App.view) {
      return;
    }
    const game = App.view.game;
    if (
      App.challengeMode &&
      (!game ||
        game.turn !== App.myId ||
        !game.lastPlay ||
        game.lastPlay.playerId === App.myId)
    ) {
      App.challengeMode = false;
      App.challengeSelected.clear();
    }
    if (game) {
      syncHandOrder();
    } else {
      App.handOrder = [];
      App.handStacks = [];
      App.handLayoutStartedAt = null;
      App.selectedCardIds.clear();
      App.challengeMode = false;
      App.challengeSelected.clear();
    }
    render();
  }

  function applyHostGameAction(type, payload) {
    let result;
    if (type === "play") {
      result = Core.playCards(App.room, App.myId, payload);
    } else if (type === "challenge") {
      result = Core.challenge(App.room, App.myId, payload);
    } else if (type === "pass") {
      result = Core.passTurn(App.room, App.myId);
    } else {
      result = { ok: false, error: "未知操作。" };
    }
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    App.challengeMode = false;
    App.challengeSelected.clear();
    afterHostMutation();
  }

  function sendGameAction(type, payload) {
    if (!App.view || App.view.status !== "playing") {
      return;
    }
    if (App.isHost) {
      applyHostGameAction(type, payload);
      return;
    }
    if (!App.network || !App.network.sendToHost({ type, payload })) {
      showToast("连接不可用，请等待重连或刷新房间。", "error");
    }
  }

  function submitChat(text) {
    const message = Hushu.sanitizeText(text, 80);
    if (!message || !App.view) {
      return;
    }
    if (App.isHost) {
      const result = Core.addChat(App.room, App.myId, message);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      afterHostMutation();
    } else if (App.network) {
      App.network.sendToHost({ type: "chat", text: message });
    }
  }

  function claimSeat(seatIndex) {
    if (!App.view) {
      return;
    }
    if (App.isHost) {
      const result = Core.claimSeat(App.room, App.myId, seatIndex);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      afterHostMutation();
    } else if (App.network) {
      App.network.sendToHost({ type: "claim-seat", seatIndex });
    }
  }

  function returnRoomAsHost() {
    if (!App.isHost || !App.room) {
      return;
    }
    const result = Core.returnToLobby(App.room, App.myId);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    closeDialog();
    afterHostMutation();
  }

  function leaveCurrentRoom() {
    if (!App.view || App.leaving) {
      return;
    }
    const isPlaying = App.view.status === "playing";
    const prompt = isPlaying
      ? "游戏进行中离开会立即结束本局，确定离开吗？"
      : "确定要离开房间吗？";
    if (!window.confirm(prompt)) {
      return;
    }

    App.leaving = true;
    if (App.isHost && App.network) {
      Object.values(App.view.members).forEach((member) => {
        if (member.id !== App.myId) {
          App.network.sendToMember(member.id, {
            type: "room-closed",
            message: "房主已经关闭房间。"
          });
        }
      });
    } else if (App.network) {
      App.network.sendToHost({ type: "leave" });
    }
    window.setTimeout(() => teardownToLobby(), 80);
  }

  function teardownToLobby() {
    App.leaving = true;
    window.clearInterval(App.hostHeartbeatTimer);
    window.clearInterval(App.clientHeartbeatTimer);
    window.clearTimeout(App.clientDisconnectTimer);
    window.clearTimeout(App.joinAcceptTimer);
    window.clearTimeout(App.profileUpdateTimer);
    App.disconnectTimers.forEach((timer) => window.clearTimeout(timer));
    App.disconnectTimers.clear();
    App.memberConnections.clear();
    App.connMembers.clear();

    if (App.network) {
      App.network.destroy();
    }
    App.network = null;
    App.isHost = false;
    App.room = null;
    App.view = null;
    App.myId = null;
    App.selectedCardIds.clear();
    App.challengeSelected.clear();
    App.handOrder = [];
    App.handStacks = [];
    App.handLayoutStartedAt = null;
    App.challengeMode = false;
    App.seenEventId = null;
    App.seenResultEventId = null;
    App.dragState = null;
    window.clearTimeout(App.dragHoldTimer);
    App.dragHoldTimer = null;
    App.joining = false;
    App.creating = false;
    closeDialog();
    $("game-chat-drawer").hidden = true;
    $("network-banner").hidden = true;
    setNetworkPill("尚未联机", "idle");
    setButtonLoading($("create-room-button"), false);
    setButtonLoading($("join-room-button"), false);
    render();
    App.leaving = false;
  }

  function showScreen(name) {
    const screens = {
      lobby: $("lobby-screen"),
      room: $("room-screen"),
      game: $("game-screen")
    };
    Object.entries(screens).forEach(([key, node]) => {
      node.hidden = key !== name;
    });
    if (App.activeScreen !== name) {
      App.activeScreen = name;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (name !== "game") {
      $("game-chat-drawer").hidden = true;
    }
  }

  function render() {
    syncProfileControls();
    if (!App.view) {
      showScreen("lobby");
      return;
    }
    if (App.view.status === "lobby") {
      showScreen("room");
      renderRoom();
    } else {
      showScreen("game");
      renderGame();
    }
    processRoomEvent();
  }

  function seatPosition(index, count) {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / Math.max(1, count);
    const x = 50 + Math.cos(angle) * 40;
    const y = 50 + Math.sin(angle) * 34;
    return `--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%`;
  }

  function memberCardHtml(memberId, index, view, options) {
    const member = view.members[memberId];
    if (!member) {
      return "";
    }
    const isHost = memberId === view.hostId;
    const isMe = memberId === App.myId;
    const game = options && options.game;
    const count = game ? game.handCounts[memberId] || 0 : 0;
    const classes = [
      "seat-card",
      isMe ? "is-me" : "",
      game && game.turn === memberId ? "current-turn" : "",
      game && game.lastPlayer === memberId ? "last-player" : "",
      member.connected === false ? "disconnected" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="seat-slot" style="${seatPosition(index, view.maxSeats)}" data-seat-slot="${index}">
        <div class="${classes}">
          ${isHost ? '<span class="host-crown" title="房主">🔑</span>' : ""}
          <div class="seat-avatar-wrap">
            <div class="seat-avatar" aria-hidden="true">${Hushu.escapeHtml(member.avatar)}</div>
            <span class="avatar-bubble" data-player-bubble="${Hushu.escapeHtml(memberId)}"></span>
          </div>
          <div class="seat-info">
            <strong title="${Hushu.escapeHtml(member.name)}">${Hushu.escapeHtml(member.name)}</strong>
            <small>${game ? `${count} 张` : isHost ? "房主" : "已入座"}${member.connected === false ? " · 掉线" : ""}</small>
          </div>
        </div>
      </div>
    `;
  }

  function renderRoom() {
    const view = App.view;
    $("room-code-display").textContent = view.code;
    $("waiting-count").textContent = `${Core.seatedCount({ seats: view.seats })} / ${view.maxSeats}`;
    $("host-key-badge").hidden = !App.isHost;

    const ring = $("waiting-ring");
    ring.innerHTML = view.seats
      .map((memberId, index) => {
        if (memberId && view.members[memberId]) {
          return memberCardHtml(memberId, index, view, {});
        }
        return `
          <button
            class="seat-slot empty-seat"
            style="${seatPosition(index, view.maxSeats)}"
            type="button"
            data-seat-index="${index}"
            aria-label="第 ${index + 1} 个空位，点击入座">
            <span>＋ 点击入座</span>
            <small>第 ${index + 1} 席</small>
          </button>
        `;
      })
      .join("");

    const waitingMembers = Object.values(view.members).filter((member) => !view.seats.includes(member.id));
    $("waiting-members-count").textContent = String(waitingMembers.length);
    $("waiting-members").innerHTML = waitingMembers.length
      ? waitingMembers
          .map(
            (member) => `
              <span class="member-pill">
                <span class="member-avatar" aria-hidden="true">${Hushu.escapeHtml(member.avatar)}</span>
                ${Hushu.escapeHtml(member.name)}
              </span>
            `
          )
          .join("")
      : '<p class="empty-note">大家都在座位上了。</p>';

    const maxSeatSelect = $("room-max-seats");
    maxSeatSelect.value = String(view.maxSeats);
    maxSeatSelect.disabled = !App.isHost;

    const deckSelect = $("deck-count");
    deckSelect.value = String(view.settings.deckCount);
    deckSelect.disabled = !App.isHost || view.maxSeats > 4;
    $("deck-lock-hint").textContent =
      view.maxSeats > 4
        ? "当前超过 4 人，已强制锁定两副牌。"
        : "一副牌单次最多 4 张，两副牌最多 8 张。";

    const reportToggle = $("report-three");
    reportToggle.checked = Boolean(view.settings.reportThree);
    reportToggle.disabled = !App.isHost;

    const allFull = Core.allSeatsFull({ seats: view.seats });
    const startButton = $("start-game-button");
    startButton.disabled = !App.isHost || !allFull;
    if (!App.isHost) {
      startButton.textContent = "等待房主开始";
      $("start-help").textContent = "只有房主可以开始游戏。";
    } else if (!allFull) {
      startButton.textContent = "等待座位坐满";
      $("start-help").textContent = `还差 ${view.maxSeats - view.seats.filter(Boolean).length} 人入座。`;
    } else {
      startButton.textContent = "开始游戏";
      $("start-help").textContent = "座位已齐，点一下开始洗牌。";
    }
    renderChatLogs();
  }

  function renderGame() {
    const view = App.view;
    const game = view.game;
    if (!game) {
      renderRoom();
      return;
    }
    $("game-room-code").textContent = view.code;
    $("game-settings-label").textContent =
      `${view.settings.deckCount === 2 ? "两副牌" : "一副牌"} · 最多 ${view.playLimit} 张`;

    const returnButton = $("return-room-button");
    returnButton.hidden = !App.isHost || view.status !== "finished";

    const ring = $("game-ring");
    ring.innerHTML = view.seats
      .map((memberId, index) => memberCardHtml(memberId, index, view, { game }))
      .join("");

    const disconnectedMembers = Object.values(view.members).filter(
      (member) => member.connected === false
    );
    const banner = $("network-banner");
    if (disconnectedMembers.length && view.status === "playing") {
      banner.hidden = false;
      banner.textContent = `${disconnectedMembers.map((member) => member.name).join("、")}掉线，等待 10 秒重连；超时将结束本局。`;
    } else {
      banner.hidden = true;
    }

    const currentPlayer = view.members[game.turn];
    const pendingPlayer = game.pendingWinner ? view.members[game.pendingWinner] : null;
    const lastPlayer = game.lastPlay ? view.members[game.lastPlay.playerId] : null;
    const turnBanner = $("turn-banner");
    turnBanner.classList.toggle("my-turn", game.turn === App.myId && view.status === "playing");

    if (view.status === "finished") {
      turnBanner.textContent = "本局已结束";
      $("table-hint").textContent = "等待房主返回房间。";
    } else if (game.phase === "pending" && pendingPlayer) {
      turnBanner.textContent = `${pendingPlayer.name} 已出完最后一手；${currentPlayer ? currentPlayer.name : "下一位"} 请质疑或过牌`;
      $("table-hint").textContent = "过牌即认可最后一手，牌局立即结束。";
    } else if (game.turn === App.myId) {
      turnBanner.textContent = game.target ? "轮到你了，请跟牌或质疑" : "轮到你了，请宣告并出牌";
      $("table-hint").textContent = game.target
        ? `必须继续宣告 ${game.target}，也可以掀牌或过牌。`
        : "选择目标点数，再选 1–" + view.playLimit + " 张手牌。";
    } else {
      turnBanner.textContent = currentPlayer ? `等待 ${currentPlayer.name} 操作` : "等待玩家操作";
      $("table-hint").textContent = game.target
        ? `${lastPlayer ? lastPlayer.name : "上一位玩家"}打出的牌仍倒扣在桌面。`
        : "新的一轮即将开始。";
    }
    if (game.lastPlay) {
      $("last-play-text").textContent =
        `${lastPlayer ? lastPlayer.name : "玩家"} 打出来 ${game.lastPlay.count} 张`;
      $("target-display").textContent = game.target || "—";
    } else {
      $("last-play-text").textContent = currentPlayer
        ? `${currentPlayer.name} 准备出牌`
        : "等待玩家出牌";
      $("target-display").textContent = "—";
    }

    renderTablePile();
    syncHandOrder();
    renderMyHand();
    renderGameActions();
    renderChatLogs();
  }

  function renderTablePile() {
    const view = App.view;
    const game = view.game;
    if (!game) {
      return;
    }
    if (!game.tableGroups.length) {
      $("table-pile").innerHTML = '<p class="empty-note">桌面上还没有牌</p>';
      return;
    }

    const latestIndex = game.tableGroups.length - 1;
    const currentGroup = game.tableGroups[latestIndex];
    const previousGroups = game.tableGroups.slice(0, latestIndex);
    const previousCardCount = previousGroups.reduce(
      (total, group) => total + group.cardIds.length,
      0
    );
    const currentPlayer = view.members[currentGroup.playerId];
    const eligible =
      App.challengeMode &&
      game.lastPlay &&
      game.lastPlay.playerId === currentGroup.playerId;

    const historyHtml = previousGroups.length
      ? `
        <div class="table-history" title="本轮此前已经跟过的牌">
          <span class="history-label">前序 ${previousGroups.length} 手</span>
          <span class="history-stack" aria-hidden="true">
            <span class="history-back"></span>
            <span class="history-back"></span>
            <span class="history-back"></span>
          </span>
          <span class="history-count">${previousCardCount} 张</span>
        </div>
      `
      : "";

    $("table-pile").innerHTML = `
      ${historyHtml}
      <div class="table-group current-play-group ${eligible ? "eligible-group" : ""}">
        <span class="table-group-label">${Hushu.escapeHtml(currentPlayer ? currentPlayer.name : "玩家")} 刚打出 ${currentGroup.cardIds.length} 张</span>
        ${currentGroup.cardIds
          .map((cardId) => {
            if (eligible) {
              const selected = App.challengeSelected.has(cardId);
              return `
                <button
                  class="back-card ${selected ? "selected" : ""}"
                  type="button"
                  data-table-card="${Hushu.escapeHtml(cardId)}"
                  aria-label="选择这张倒扣牌"
                  aria-pressed="${selected}"></button>
              `;
            }
            return '<span class="back-card" aria-hidden="true"></span>';
          })
          .join("")}
      </div>
    `;
  }

  function getHandStackLimit() {
    return App.view && App.view.settings.deckCount === 2 ? 8 : 4;
  }

  function flattenHandStacks() {
    return App.handStacks.flatMap((stack) => stack.cards);
  }

  function buildDefaultHandStacks(cards) {
    const limit = getHandStackLimit();
    const sorted = Hushu.sortCards(cards);
    const stacks = [];
    sorted.forEach((card) => {
      const lastStack = stacks[stacks.length - 1];
      if (lastStack && lastStack.rank === card.rank && lastStack.cards.length < limit) {
        lastStack.cards.push(card.id);
      } else {
        stacks.push({ rank: card.rank, cards: [card.id] });
      }
    });
    return stacks;
  }

  function syncHandOrder() {
    if (!App.view || !App.view.game) {
      App.handOrder = [];
      App.handStacks = [];
      App.handLayoutStartedAt = null;
      App.selectedCardIds.clear();
      return;
    }

    const game = App.view.game;
    const incomingCards = game.hand;
    const incomingIds = incomingCards.map((card) => card.id);
    const incomingSet = new Set(incomingIds);
    const cardsById = new Map(incomingCards.map((card) => [card.id, card]));
    const limit = getHandStackLimit();

    if (App.handLayoutStartedAt !== game.startedAt) {
      App.handStacks = buildDefaultHandStacks(incomingCards);
      App.handLayoutStartedAt = game.startedAt;
      App.selectedCardIds.clear();
    } else {
      App.handStacks = App.handStacks
        .map((stack) => ({
          rank: stack.rank,
          cards: stack.cards.filter((id) => incomingSet.has(id))
        }))
        .filter((stack) => stack.cards.length);

      const existingIds = new Set(flattenHandStacks());
      incomingIds
        .filter((id) => !existingIds.has(id))
        .forEach((id) => {
          const card = cardsById.get(id);
          const matchingStack = App.handStacks.find(
            (stack) => stack.rank === card.rank && stack.cards.length < limit
          );
          if (matchingStack) {
            matchingStack.cards.push(id);
          } else {
            App.handStacks.push({ rank: card.rank, cards: [id] });
          }
        });
    }

    App.handOrder = flattenHandStacks();
    App.selectedCardIds = new Set(
      [...App.selectedCardIds].filter((id) => incomingSet.has(id))
    );
    const legalChallengeIds = new Set(game.lastPlay ? game.lastPlay.cardIds : []);
    App.challengeSelected = new Set(
      [...App.challengeSelected].filter((id) => legalChallengeIds.has(id))
    );
  }

  function createHandCardElement(card, stackIndex, cardIndex, stackLength) {
    const display = Hushu.getCardDisplay(card);
    const horizontalGap = window.innerWidth <= 600 ? 20 : 24;
    const verticalRise = window.innerWidth <= 600 ? 8 : 10;
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "hand-card",
      display.red ? "red" : "",
      display.joker ? "joker" : "",
      App.selectedCardIds.has(card.id) ? "selected" : ""
    ]
      .filter(Boolean)
      .join(" ");
    button.dataset.cardId = card.id;
    button.dataset.stackIndex = String(stackIndex);
    button.style.left = `${cardIndex * horizontalGap}px`;
    // 后面的牌向右上错开，让每张牌左上角的点数和花色都露出来。
    button.style.top = `${(stackLength - 1 - cardIndex) * verticalRise}px`;
    button.style.zIndex = String(cardIndex + 1);
    button.setAttribute(
      "aria-label",
      `${display.rank} ${display.suit}，单击${App.view && App.view.game && App.view.game.turn === App.myId ? "选择" : "整理"}`);
    button.setAttribute("aria-pressed", App.selectedCardIds.has(card.id) ? "true" : "false");
    button.innerHTML = display.joker
      ? `
        <span class="rank">${Hushu.escapeHtml(display.rank)}</span>
        <span class="suit">${display.suit}</span>
        <span class="wild-badge">万能</span>
        <span class="center-suit">${display.suit}</span>
      `
      : `
        <span class="rank">${Hushu.escapeHtml(display.rank)}</span>
        <span class="suit">${display.suit}</span>
        ${display.wild ? '<span class="wild-badge">万能</span>' : ""}
        <span class="center-suit">${display.suit}</span>
      `;
    return button;
  }

  function renderMyHand() {
    const view = App.view;
    const hand = $("my-hand");
    if (!view || !view.game) {
      hand.replaceChildren();
      return;
    }
    const cardsById = new Map(view.game.hand.map((card) => [card.id, card]));
    const previousScrollLeft = hand.scrollLeft;
    const selectingCards =
      view.status === "playing" &&
      view.game.turn === App.myId &&
      view.game.phase !== "pending" &&
      !App.challengeMode;
    hand.classList.toggle("can-arrange", canArrangeHand());
    hand.classList.toggle("can-select", selectingCards);
    if (!App.handStacks.length) {
      hand.innerHTML = '<p class="empty-hand">暂时没有手牌。</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    App.handStacks.forEach((stack, stackIndex) => {
      const stackNode = document.createElement("div");
      stackNode.className = "hand-stack";
      stackNode.dataset.stackIndex = String(stackIndex);
      stackNode.dataset.stackRank = stack.rank;
      const horizontalGap = window.innerWidth <= 600 ? 20 : 24;
      const verticalRise = window.innerWidth <= 600 ? 8 : 10;
      stackNode.style.setProperty("--stack-count", String(stack.cards.length));
      stackNode.style.setProperty(
        "--stack-offset",
        `${Math.max(0, stack.cards.length - 1) * horizontalGap}px`
      );
      stackNode.style.setProperty(
        "--stack-rise",
        `${Math.max(0, stack.cards.length - 1) * verticalRise}px`
      );

      stack.cards.forEach((cardId, cardIndex) => {
        const card = cardsById.get(cardId);
        if (card) {
          stackNode.appendChild(
            createHandCardElement(card, stackIndex, cardIndex, stack.cards.length)
          );
        }
      });
      if (stack.cards.length > 1) {
        const badge = document.createElement("span");
        badge.className = "hand-stack-count";
        badge.textContent = `×${stack.cards.length}`;
        stackNode.appendChild(badge);
      }
      fragment.appendChild(stackNode);
    });
    hand.replaceChildren(fragment);
    requestAnimationFrame(() => {
      hand.scrollLeft = previousScrollLeft;
    });
  }

  function canArrangeHand() {
    if (!App.view || !App.view.game) {
      return false;
    }
    return !(
      App.view.status === "playing" &&
      App.view.game.turn === App.myId
    );
  }

  function renderGameActions() {
    const view = App.view;
    const game = view.game;
    if (!game) {
      return;
    }
    const myTurn = view.status === "playing" && game.turn === App.myId;
    const pending = game.phase === "pending";
    const canFollow = myTurn && !pending;
    const playButton = $("play-button");
    const challengeButton = $("challenge-button");
    const passButton = $("pass-button");
    const targetPicker = $("target-picker-wrap");
    const targetSelect = $("target-rank");

    targetPicker.hidden = Boolean(game.target);
    targetSelect.disabled = !myTurn || pending;
    if (game.target) {
      targetSelect.value = "";
    } else if (!Hushu.TARGET_RANKS.includes(targetSelect.value)) {
      targetSelect.value = "";
    }

    const selectedCount = App.selectedCardIds.size;
    playButton.textContent = game.target ? "跟牌" : "出牌";
    playButton.disabled =
      !canFollow ||
      App.challengeMode ||
      selectedCount < 1 ||
      selectedCount > view.playLimit ||
      (!game.target && !Hushu.TARGET_RANKS.includes(targetSelect.value));

    challengeButton.disabled =
      !myTurn || !game.lastPlay || game.lastPlay.playerId === App.myId || App.challengeMode;
    passButton.disabled = !myTurn || !game.lastPlay;
    passButton.textContent = pending ? "放弃质疑" : "过牌";

    $("challenge-bar").hidden = !App.challengeMode;
    $("challenge-instruction").textContent =
      `请手动点选 ${view.challengeCount} 张上一手倒扣牌（已选 ${App.challengeSelected.size} 张）`;
    $("confirm-challenge-button").disabled =
      App.challengeSelected.size !== view.challengeCount;

    const canArrange = canArrangeHand();
    const sortButton = $("sort-hand-button");
    sortButton.disabled = !canArrange;
    sortButton.title = canArrange ? "按点数、花色重新整理手牌" : "轮到你出牌时暂时不能理牌";

    if (selectedCount === 0) {
      if (canArrange) {
        $("selection-summary").textContent = `共 ${App.handStacks.length} 摞 · 可拖动整理`;
      } else if (pending) {
        $("selection-summary").textContent = "最后一手已锁定";
      } else {
        $("selection-summary").textContent = "单击选牌 · 按住拖动连选";
      }
    } else {
      $("selection-summary").textContent = `已选 ${selectedCount} 张 · 张数上限 ${view.playLimit}`;
    }

    let help = "等待其他玩家操作。";
    if (view.status === "finished") {
      help = App.isHost ? "点击“返回房间”可以重新调整座位。" : "等待房主带大家返回房间。";
    } else if (App.challengeMode) {
      help = "从上一手牌中手动点选卡片，确认后才执行掀牌。";
    } else if (pending && myTurn) {
      help = "这是最后一手。掀牌检查真伪；过牌表示不质疑并结束本局。";
    } else if (myTurn && !game.target) {
      help = "单击选牌；按住第一张牌拖动，可以连续选中扫过的牌。";
    } else if (myTurn) {
      help = `跟牌自动宣告 ${game.target}；单击选牌，按住拖动可连选。`;
    } else if (game.phase === "pending") {
      help = "最后一手正在等待下一位玩家质疑或认可。";
    }
    $("action-help").textContent = help;
  }

  function renderChatLogs() {
    const view = App.view;
    if (!view) {
      return;
    }
    const logHtml = view.chat.length
      ? view.chat
          .map(
            (message) => `
              <div class="chat-line">
                <strong>${Hushu.escapeHtml(message.name)}</strong>
                <span>${Hushu.escapeHtml(message.text)}</span>
                <time>${Hushu.formatTime(message.ts)}</time>
              </div>
            `
          )
          .join("")
      : '<p class="empty-note">还没有消息，先打个招呼。</p>';
    ["room-chat-log", "game-chat-log"].forEach((id) => {
      const log = $(id);
      log.innerHTML = logHtml;
      requestAnimationFrame(() => {
        log.scrollTop = log.scrollHeight;
      });
    });
  }

  function processRoomEvent() {
    const view = App.view;
    if (!view || !view.event || !view.event.id || view.event.id === App.seenEventId) {
      return;
    }
    const event = view.event;
    App.seenEventId = event.id;

    if (event.type === "play") {
      const player = view.members[event.playerId];
      if (player) {
        showAvatarBubble(event.playerId, `${event.count} 张 ${event.target}！`);
      }
      if (event.pendingWinner) {
        showToast(`${player ? player.name : "玩家"}打出最后一手，等待下一位质疑。`, "important", 3000);
      }
      if (event.reportThree) {
        window.setTimeout(() => {
          showToast(`${player ? player.name : "玩家"} 还剩 3 张牌！`, "important", 3400);
        }, 360);
      }
      return;
    }

    if (event.type === "discard") {
      const leader = view.members[event.leaderId];
      showToast(
        `桌上牌已弃置，新一轮由${leader ? leader.name : "上一位出牌玩家"}出牌。`,
        "important",
        3900
      );
      return;
    }

    if (event.type === "challenge") {
      showChallengeDialog(event);
      return;
    }

    if (event.type === "win" || event.type === "disconnect-end") {
      showGameOverDialog(event);
      return;
    }

    if (event.type === "start") {
      const first = view.members[event.firstPlayerId];
      showToast(`牌局开始，${first ? first.name : "随机玩家"}先出牌。`, "important", 3200);
      return;
    }

    if (event.type === "returned") {
      closeDialog();
      showToast("已回到等待房间，可以调整座位后重新开局。", "important", 2800);
    }
  }

  function showAvatarBubble(playerId, text) {
    requestAnimationFrame(() => {
      const bubble = document.querySelector(`[data-player-bubble="${CSS.escape(playerId)}"]`);
      if (!bubble) {
        return;
      }
      bubble.textContent = text;
      bubble.classList.remove("show");
      void bubble.offsetWidth;
      bubble.classList.add("show");
      window.setTimeout(() => bubble.classList.remove("show"), 2600);
    });
  }

  function cardFaceHtml(card) {
    const display = Hushu.getCardDisplay(card);
    const red = display.red ? "red" : "";
    return `
      <span class="revealed-card ${display.wild ? "wild" : ""}" title="${Hushu.escapeHtml(display.rank)} ${Hushu.escapeHtml(display.suit)}">
        <span style="color:${display.red ? "#bc3d35" : "inherit"}">${Hushu.escapeHtml(display.rank)}${display.suit}</span>
      </span>
    `;
  }

  function showChallengeDialog(event) {
    const view = App.view;
    const challenger = view.members[event.challengerId];
    const lastPlayer = view.members[event.lastPlayerId];
    const recipient = view.members[event.recipientId];
    const nextLeader = event.nextLeaderId ? view.members[event.nextLeaderId] : null;
    const winner = event.winnerId ? view.members[event.winnerId] : null;
    const resultTitle = event.success ? "掀牌成功" : "掀牌失败";
    const resultIcon = event.success ? "🫣" : "✅";
    let detail;
    if (event.success) {
      detail = `${lastPlayer ? lastPlayer.name : "上一手玩家"}收走本轮全部桌上牌，${challenger ? challenger.name : "质疑者"}开启新一轮。`;
    } else if (winner) {
      detail = `${challenger ? challenger.name : "质疑者"}收走本轮全部桌上牌，但${winner.name}的最后一手成立，本局由${winner.name}获胜。`;
    } else {
      detail = `${challenger ? challenger.name : "质疑者"}收走本轮全部桌上牌，${nextLeader ? nextLeader.name : "下一位玩家"}开启新一轮。`;
    }

    openDialog({
      eyebrow: `本次手动挑选 ${event.selectedCount} 张`,
      title: resultTitle,
      body: `
        <div class="result-icon">${resultIcon}</div>
        <div class="result-reveal-row">${event.revealedCards.map(cardFaceHtml).join("")}</div>
        <p><strong>${challenger ? Hushu.escapeHtml(challenger.name) : "质疑者"}</strong>质疑
          <strong>${lastPlayer ? Hushu.escapeHtml(lastPlayer.name) : "上一手玩家"}</strong>
          宣告的 ${Hushu.escapeHtml(event.target)}。</p>
        <p class="result-detail">${Hushu.escapeHtml(detail)}</p>
        <p class="result-detail">收牌人：${recipient ? Hushu.escapeHtml(recipient.name) : "未知"}</p>
      `,
      actions: [{ label: "继续", className: "primary-button" }],
      onClose: event.winnerId
        ? () => {
            showGameOverDialog({
              id: `${event.id}-result`,
              type: "win",
              winnerId: event.winnerId,
              reason: "最后一手质疑失败"
            });
          }
        : null
    });
  }

  function showGameOverDialog(event) {
    const view = App.view;
    if (!view) {
      return;
    }
    const resultMarker = event.id || `${view.result && view.result.endedAt}`;
    if (App.seenResultEventId === resultMarker) {
      return;
    }
    App.seenResultEventId = resultMarker;

    const winner = view.result && view.result.winnerId
      ? view.members[view.result.winnerId]
      : event.winnerId
        ? view.members[event.winnerId]
        : null;
    const reason =
      (view.result && view.result.reason) ||
      event.reason ||
      (winner ? `${winner.name} 获胜` : "本局结束");
    const title = winner ? `${winner.name} 获胜！` : "本局结束";
    const icon = winner ? "🏆" : "🔌";
    const actions = App.isHost && view.status === "finished"
      ? [
          {
            label: "返回房间",
            className: "primary-button",
            onClick: returnRoomAsHost
          }
        ]
      : [{ label: "关闭", className: "secondary-button" }];

    window.setTimeout(() => {
      openDialog({
        eyebrow: "本局结果",
        title: "牌局结束",
        body: `
          <div class="result-icon">${icon}</div>
          <p class="result-title">${Hushu.escapeHtml(title)}</p>
          <p class="result-detail">${Hushu.escapeHtml(reason)}</p>
          ${
            App.isHost
              ? '<p class="result-detail">返回房间后，可以修改最大座位数，让新朋友重新入座。</p>'
              : '<p class="result-detail">等待房主带大家返回房间。</p>'
          }
        `,
        actions
      });
    }, 80);
  }

  function playSelectedCards() {
    const view = App.view;
    if (!view || !view.game) {
      return;
    }
    const selectedInHandOrder = App.handOrder.filter((id) => App.selectedCardIds.has(id));
    if (!selectedInHandOrder.length) {
      showToast("请先选择要出的牌。", "error");
      return;
    }
    const target = view.game.target || $("target-rank").value;
    if (!Hushu.TARGET_RANKS.includes(target)) {
      showToast("请先选择本轮目标点数。", "error");
      return;
    }
    sendGameAction("play", {
      cardIds: selectedInHandOrder,
      target
    });
  }

  function enterChallengeMode() {
    const view = App.view;
    if (
      !view ||
      !view.game ||
      view.status !== "playing" ||
      !view.game.lastPlay ||
      view.game.turn !== App.myId ||
      view.game.lastPlay.playerId === App.myId
    ) {
      showToast("当前不能掀牌。", "error");
      return;
    }
    App.challengeMode = true;
    App.challengeSelected.clear();
    renderGame();
    showToast(`请手动点选 ${view.challengeCount} 张上一手牌。`, "important", 2400);
  }

  function cancelChallengeMode() {
    App.challengeMode = false;
    App.challengeSelected.clear();
    renderGame();
  }

  function toggleChallengeCard(cardId) {
    const view = App.view;
    if (!App.challengeMode || !view || !view.game || !view.game.lastPlay) {
      return;
    }
    if (!view.game.lastPlay.cardIds.includes(cardId)) {
      return;
    }
    if (App.challengeSelected.has(cardId)) {
      App.challengeSelected.delete(cardId);
    } else if (App.challengeSelected.size < view.challengeCount) {
      App.challengeSelected.add(cardId);
    } else {
      showToast(`本次只需要选择 ${view.challengeCount} 张。`, "error");
    }
    renderTablePile();
    renderGameActions();
  }

  function confirmChallenge() {
    const view = App.view;
    if (!view || !view.game) {
      return;
    }
    if (App.challengeSelected.size !== view.challengeCount) {
      showToast(`请选择 ${view.challengeCount} 张牌。`, "error");
      return;
    }
    sendGameAction("challenge", { cardIds: [...App.challengeSelected] });
  }

  function toggleHandCard(cardId) {
    const view = App.view;
    if (!view || !view.game || App.challengeMode) {
      return;
    }
    if (view.status !== "playing" || view.game.turn !== App.myId || view.game.phase === "pending") {
      showToast("还没轮到你选择要出的牌。", "error");
      return;
    }
    if (App.selectedCardIds.has(cardId)) {
      App.selectedCardIds.delete(cardId);
    } else if (App.selectedCardIds.size >= view.playLimit) {
      showToast(`本局单次最多选择 ${view.playLimit} 张。`, "error");
      return;
    } else {
      App.selectedCardIds.add(cardId);
    }

    const cardNode = $("my-hand").querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
    if (cardNode) {
      const selected = App.selectedCardIds.has(cardId);
      cardNode.classList.toggle("selected", selected);
      cardNode.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    renderGameActions();
  }

  function sortHand() {
    const view = App.view;
    if (!view || !view.game) {
      return;
    }
    if (!canArrangeHand()) {
      showToast("轮到你出牌时暂时不能理牌。", "error");
      return;
    }
    App.handStacks = buildDefaultHandStacks(view.game.hand);
    App.handOrder = flattenHandStacks();
    renderMyHand();
  }

  function isCardSelectionTurn() {
    return Boolean(
      App.view &&
        App.view.game &&
        App.view.status === "playing" &&
        App.view.game.turn === App.myId &&
        App.view.game.phase !== "pending" &&
        !App.challengeMode
    );
  }

  function setCardSelectionVisual(cardId, selected) {
    const cardNode = $("my-hand").querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
    if (cardNode) {
      cardNode.classList.toggle("selected", selected);
      cardNode.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }

  function addHandCardToSelection(cardId) {
    const view = App.view;
    if (!view || App.selectedCardIds.has(cardId)) {
      return false;
    }
    if (App.selectedCardIds.size >= view.playLimit) {
      return false;
    }
    App.selectedCardIds.add(cardId);
    setCardSelectionVisual(cardId, true);
    renderGameActions();
    return true;
  }

  function selectHandCardRange(startCardId, endCardId) {
    const startIndex = App.handOrder.indexOf(startCardId);
    const endIndex = App.handOrder.indexOf(endCardId);
    if (startIndex < 0 || endIndex < 0) {
      return;
    }
    const step = startIndex <= endIndex ? 1 : -1;
    for (
      let index = startIndex;
      index !== endIndex + step;
      index += step
    ) {
      if (!addHandCardToSelection(App.handOrder[index]) && App.selectedCardIds.size >= App.view.playLimit) {
        break;
      }
    }
  }

  function findHandCardAtPoint(clientX, clientY) {
    let hit = null;
    let furthestIndex = -1;
    $("my-hand").querySelectorAll(".hand-card").forEach((card) => {
      const rect = card.getBoundingClientRect();
      const inside =
        clientX >= rect.left - 2 &&
        clientX <= rect.right + 2 &&
        clientY >= rect.top - 4 &&
        clientY <= rect.bottom + 4;
      if (inside) {
        // 叠牌时多张牌会覆盖同一个点，取手牌顺序里更靠后的那张作为终点。
        const index = App.handOrder.indexOf(card.dataset.cardId);
        if (index > furthestIndex) {
          furthestIndex = index;
          hit = card;
        }
      }
    });
    return hit;
  }

  function beginHandDrag(event) {
    if (event.button != null && event.button !== 0) {
      return;
    }
    const card = event.target.closest(".hand-card");
    if (!card) {
      return;
    }
    const selecting = isCardSelectionTurn();
    const arranging = canArrangeHand();
    if (!selecting && !arranging) {
      return;
    }

    const stack = card.closest(".hand-stack");
    App.dragState = {
      mode: selecting ? "select" : "arrange",
      cardId: card.dataset.cardId,
      stackIndex: stack ? Number(stack.dataset.stackIndex) : -1,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      held: false
    };

    window.clearTimeout(App.dragHoldTimer);
    if (selecting) {
      App.dragHoldTimer = window.setTimeout(() => {
        const drag = App.dragState;
        if (!drag || drag.pointerId !== event.pointerId || drag.moved) {
          return;
        }
        drag.held = true;
        drag.mode = "multi-select";
        addHandCardToSelection(drag.cardId);
        $("my-hand").classList.add("is-multi-selecting");
      }, 260);
    }
    event.preventDefault();
  }

  function moveHandDrag(event) {
    const drag = App.dragState;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (drag.mode === "select" && distance >= 12) {
      drag.moved = true;
      window.clearTimeout(App.dragHoldTimer);
      App.dragHoldTimer = null;
      return;
    }
    if (drag.mode === "multi-select") {
      event.preventDefault();
      const handViewport = $("my-hand");
      const handRect = handViewport.getBoundingClientRect();
      if (event.clientX > handRect.right - 28) {
        handViewport.scrollLeft += 14;
      } else if (event.clientX < handRect.left + 28) {
        handViewport.scrollLeft -= 14;
      }
      const hitCard = findHandCardAtPoint(event.clientX, event.clientY);
      if (hitCard) {
        selectHandCardRange(drag.cardId, hitCard.dataset.cardId);
      }
      return;
    }
    if (drag.mode !== "arrange" || drag.moved || distance < 7) {
      return;
    }
    drag.moved = true;
    event.preventDefault();

    const handViewport = $("my-hand");
    const handRect = handViewport.getBoundingClientRect();
    if (event.clientX > handRect.right - 28) {
      handViewport.scrollLeft += 14;
    } else if (event.clientX < handRect.left + 28) {
      handViewport.scrollLeft -= 14;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetStack = target ? target.closest(".hand-stack") : null;
    if (!targetStack) {
      return;
    }

    const sourceIndex = App.handStacks.findIndex((stack) => stack.cards.includes(drag.cardId));
    const targetIndex = Number(targetStack.dataset.stackIndex);
    if (
      sourceIndex < 0 ||
      !Number.isInteger(targetIndex) ||
      sourceIndex === targetIndex ||
      !App.handStacks[targetIndex]
    ) {
      return;
    }

    const sourceStack = App.handStacks[sourceIndex];
    const destination = App.handStacks[targetIndex];
    const rect = targetStack.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    const sameRank = sourceStack.rank === destination.rank;
    const stackLimit = getHandStackLimit();

    if (sameRank && sourceStack.cards.length + destination.cards.length <= stackLimit) {
      destination.cards.push(...sourceStack.cards);
      App.handStacks.splice(sourceIndex, 1);
    } else {
      if (sameRank && !drag.mergeWarningShown) {
        drag.mergeWarningShown = true;
        showToast(`同一叠最多 ${stackLimit} 张，已改为调整牌组位置。`, "important", 2200);
      }
      const [movingStack] = App.handStacks.splice(sourceIndex, 1);
      let destinationIndex = App.handStacks.indexOf(destination);
      if (destinationIndex < 0) {
        return;
      }
      if (insertAfter) {
        destinationIndex += 1;
      }
      App.handStacks.splice(destinationIndex, 0, movingStack);
    }
    App.handOrder = flattenHandStacks();
    renderMyHand();
    requestAnimationFrame(() => {
      const nextSourceIndex = App.handStacks.findIndex((stack) =>
        stack.cards.includes(drag.cardId)
      );
      const movedStack = $("my-hand").querySelector(
        `[data-stack-index="${nextSourceIndex}"]`
      );
      if (movedStack) {
        movedStack.classList.add("dragging");
      }
    });
  }

  function finishHandDrag(event) {
    const drag = App.dragState;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    window.clearTimeout(App.dragHoldTimer);
    App.dragHoldTimer = null;
    App.dragState = null;
    $("my-hand").classList.remove("is-multi-selecting");
    if (drag.mode === "multi-select") {
      renderMyHand();
      renderGameActions();
    } else if (drag.mode === "select" && !drag.moved) {
      toggleHandCard(drag.cardId);
    } else if (drag.mode === "arrange" && drag.moved) {
      App.handOrder = flattenHandStacks();
      renderMyHand();
    }
  }

  function cancelHandDrag() {
    if (!App.dragState) {
      return;
    }
    window.clearTimeout(App.dragHoldTimer);
    App.dragHoldTimer = null;
    const wasMultiSelect = App.dragState.mode === "multi-select";
    App.dragState = null;
    $("my-hand").classList.remove("is-multi-selecting");
    if (wasMultiSelect) {
      renderMyHand();
      renderGameActions();
    }
  }

  function copyInviteLink() {
    if (!App.view) {
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", App.view.code);
    const invite = url.toString();

    const fallbackCopy = () => {
      const input = document.createElement("textarea");
      input.value = invite;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        showToast("邀请链接已复制。", "important");
      } catch (error) {
        showToast(`房间号：${App.view.code}`, "important", 4000);
      }
      input.remove();
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(invite).then(
        () => showToast("邀请链接已复制。", "important"),
        fallbackCopy
      );
    } else {
      fallbackCopy();
    }
  }

  function hostChangeMaxSeats(value) {
    if (!App.isHost) {
      return;
    }
    const result = Core.changeMaxSeats(App.room, App.myId, Number(value));
    if (!result.ok) {
      showToast(result.error, "error");
      renderRoom();
      return;
    }
    afterHostMutation();
  }

  function hostChangeDeck(value) {
    if (!App.isHost) {
      return;
    }
    const result = Core.updateSettings(App.room, App.myId, {
      deckCount: Number(value)
    });
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    afterHostMutation();
  }

  function hostChangeReportThree(enabled) {
    if (!App.isHost) {
      return;
    }
    const result = Core.updateSettings(App.room, App.myId, {
      reportThree: enabled
    });
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    afterHostMutation();
  }

  function startHostGame() {
    if (!App.isHost) {
      return;
    }
    const result = Core.startGame(App.room, App.myId);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    App.selectedCardIds.clear();
    App.challengeSelected.clear();
    App.challengeMode = false;
    App.handStacks = [];
    App.handLayoutStartedAt = null;
    afterHostMutation();
  }

  function toggleGameChat() {
    const drawer = $("game-chat-drawer");
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) {
      $("game-chat-input").focus();
    }
  }

  function bindEvents() {
    $("create-room-button").addEventListener("click", createRoom);
    $("join-room-button").addEventListener("click", joinRoom);
    $("rules-button").addEventListener("click", showRulesDialog);
    $("game-profile-button").addEventListener("click", showProfileDialog);

    $("join-code").addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
    });
    $("join-code").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        joinRoom();
      }
    });

    $("lobby-name").addEventListener("input", () => updateProfileFromInput("lobby"));
    $("room-name").addEventListener("input", () => updateProfileFromInput("room"));
    $("lobby-avatar").addEventListener("change", (event) => updateAvatar(event.target.value));
    $("room-avatar").addEventListener("change", (event) => updateAvatar(event.target.value));

    $("waiting-ring").addEventListener("click", (event) => {
      const seat = event.target.closest("[data-seat-index]");
      if (seat) {
        claimSeat(Number(seat.dataset.seatIndex));
      }
    });

    $("room-max-seats").addEventListener("change", (event) => hostChangeMaxSeats(event.target.value));
    $("deck-count").addEventListener("change", (event) => hostChangeDeck(event.target.value));
    $("report-three").addEventListener("change", (event) => hostChangeReportThree(event.target.checked));
    $("start-game-button").addEventListener("click", startHostGame);
    $("copy-room-button").addEventListener("click", copyInviteLink);
    $("leave-room-button").addEventListener("click", leaveCurrentRoom);
    $("game-leave-button").addEventListener("click", leaveCurrentRoom);

    $("room-chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("room-chat-input");
      submitChat(input.value);
      input.value = "";
    });
    $("game-chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("game-chat-input");
      submitChat(input.value);
      input.value = "";
    });

    $("game-chat-button").addEventListener("click", toggleGameChat);
    $("close-game-chat-button").addEventListener("click", () => {
      $("game-chat-drawer").hidden = true;
    });

    $("sort-hand-button").addEventListener("click", sortHand);
    $("hand-scroll-left").addEventListener("click", () => {
      $("my-hand").scrollBy({ left: -180, behavior: "smooth" });
    });
    $("hand-scroll-right").addEventListener("click", () => {
      $("my-hand").scrollBy({ left: 180, behavior: "smooth" });
    });
    $("my-hand").addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) {
          return;
        }
        const hand = $("my-hand");
        const maxScroll = hand.scrollWidth - hand.clientWidth;
        if (maxScroll <= 1) {
          return;
        }

        let delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
        if (event.deltaMode === 1) {
          delta *= 18;
        } else if (event.deltaMode === 2) {
          delta *= hand.clientWidth;
        }

        // 鼠标在手牌区域内时占据滚轮：只横向浏览手牌，不带动页面上下滚动。
        event.preventDefault();
        hand.scrollLeft += delta;
      },
      { passive: false }
    );
    $("play-button").addEventListener("click", playSelectedCards);
    $("challenge-button").addEventListener("click", enterChallengeMode);
    $("pass-button").addEventListener("click", () => sendGameAction("pass", {}));
    $("confirm-challenge-button").addEventListener("click", confirmChallenge);
    $("cancel-challenge-button").addEventListener("click", cancelChallengeMode);
    $("target-rank").addEventListener("change", renderGameActions);
    $("return-room-button").addEventListener("click", returnRoomAsHost);

    $("table-pile").addEventListener("click", (event) => {
      const card = event.target.closest("[data-table-card]");
      if (card) {
        toggleChallengeCard(card.dataset.tableCard);
      }
    });

    $("my-hand").addEventListener("pointerdown", beginHandDrag);
    $("my-hand").addEventListener("contextmenu", (event) => event.preventDefault());
    $("my-hand").addEventListener("click", (event) => {
      const card = event.target.closest(".hand-card");
      // 键盘或辅助技术触发的 click 没有指针细节，需要单独完成选择。
      if (card && event.detail === 0) {
        toggleHandCard(card.dataset.cardId);
      }
    });
    document.addEventListener("pointermove", moveHandDrag, { passive: false });
    document.addEventListener("pointerup", finishHandDrag);
    document.addEventListener("pointercancel", cancelHandDrag);

    $("app-dialog").addEventListener("close", () => {
      const callback = App.dialogOnClose;
      App.dialogOnClose = null;
      if (typeof callback === "function") {
        callback();
      }
    });

    $("brand-button").addEventListener("click", () => {
      if (App.view) {
        showToast("正在房间中，请使用“离开房间”退出。", "important");
      } else {
        showScreen("lobby");
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!App.view) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function init() {
    App.profile = loadProfile();
    fillStaticOptions();
    syncProfileControls();
    bindEvents();
    setNetworkPill("尚未联机", "idle");

    const query = new URLSearchParams(window.location.search);
    const roomCode = Hushu.sanitizeText(query.get("room"), 6);
    if (/^\d{6}$/.test(roomCode)) {
      $("join-code").value = roomCode;
      window.setTimeout(() => showToast(`已填入房间号 ${roomCode}`, "important", 2400), 300);
    }
    render();
  }

  init();
})();
