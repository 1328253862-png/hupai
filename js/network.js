/* global window, Peer */
(function () {
  "use strict";

  const Hushu = (window.Hushu = window.Hushu || {});
  const Config = window.HushuConfig;

  class Network {
    constructor(handlers) {
      this.handlers = handlers || {};
      this.peer = null;
      this.isHost = false;
      this.roomCode = null;
      this.hostConnection = null;
      this.connections = new Map();
      this.closedPeers = new Set();
      this.destroyed = false;
      this.joinTimeout = null;
    }

    assertPeerAvailable() {
      if (typeof Peer !== "function") {
        throw new Error("PeerJS 加载失败，请检查网络后刷新页面。");
      }
    }

    emit(name, ...args) {
      const handler = this.handlers[name];
      if (typeof handler === "function") {
        handler(...args);
      }
    }

    async createHost() {
      this.assertPeerAvailable();
      let lastError = null;

      // 公共 PeerJS 的 ID 是全局命名空间，房间号冲突时换一个房间号重试。
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const roomCode = Hushu.createRoomCode();
        try {
          const hostInfo = await this.openHostPeer(roomCode);
          this.isHost = true;
          this.roomCode = roomCode;
          return hostInfo;
        } catch (error) {
          lastError = error;
          if (error && error.type !== "unavailable-id") {
            break;
          }
        }
      }

      const message =
        lastError && lastError.type === "unavailable-id"
          ? "连续遇到房间号冲突，请稍后再试。"
          : lastError && lastError.message
            ? lastError.message
            : "无法连接 PeerJS 信令服务。";
      throw new Error(message);
    }

    openHostPeer(roomCode) {
      return new Promise((resolve, reject) => {
        const peerId = `${Config.roomPeerPrefix}${roomCode}`;
        const peer = new Peer(peerId, Config.peerOptions);
        let settled = false;

        const clearPending = () => {
          if (!settled) {
            settled = true;
            peer.destroy();
          }
        };

        peer.on("open", () => {
          if (settled) {
            return;
          }
          settled = true;
          this.peer = peer;
          this.attachHostPeerEvents(peer);
          resolve({ code: roomCode, peerId });
        });

        peer.on("error", (error) => {
          if (!settled) {
            settled = true;
            peer.destroy();
            reject(error);
            return;
          }
          this.emit("hostError", error);
        });

        peer.on("disconnected", () => {
          if (this.destroyed || this.peer !== peer) {
            return;
          }
          this.emit("signalState", "disconnected");
          window.setTimeout(() => {
            if (!this.destroyed && this.peer === peer && !peer.destroyed && peer.disconnected) {
              try {
                peer.reconnect();
              } catch (error) {
                // WebRTC 数据通道可能仍保持工作，不因为信令重连失败立即踢掉玩家。
              }
            }
          }, 1500);
        });

        peer.on("close", () => {
          if (!settled) {
            clearPending();
            reject(new Error("PeerJS 连接已关闭。"));
          }
        });
      });
    }

    attachHostPeerEvents(peer) {
      peer.on("open", () => this.emit("signalState", "online"));
      peer.on("connection", (connection) => {
        if (this.destroyed) {
          connection.close();
          return;
        }

        const record = {
          conn: connection,
          memberId: null
        };
        this.connections.set(connection.peer, record);

        connection.on("open", () => {
          this.closedPeers.delete(connection.peer);
          this.emit("connectionOpened", connection);
        });
        connection.on("data", (message) => {
          this.emit("hostMessage", message, connection);
        });
        connection.on("close", () => {
          this.handleConnectionClose(connection);
        });
        connection.on("error", (error) => {
          this.emit("connectionError", error, connection);
        });
      });

      peer.on("error", (error) => {
        this.emit("hostError", error);
      });
    }

    bindMemberConnection(conn, memberId) {
      for (const record of this.connections.values()) {
        if (record.memberId === memberId && record.conn !== conn) {
          record.memberId = null;
        }
      }
      const record = this.connections.get(conn.peer);
      if (record) {
        record.memberId = memberId;
        record.conn = conn;
      } else {
        this.connections.set(conn.peer, { conn, memberId });
      }
      this.closedPeers.delete(conn.peer);
    }

    getMemberRecord(memberId) {
      let fallback = null;
      for (const record of this.connections.values()) {
        if (record.memberId === memberId) {
          fallback = record;
          if (record.conn && record.conn.open) {
            return record;
          }
        }
      }
      return fallback;
    }

    sendToMember(memberId, message) {
      const record = this.getMemberRecord(memberId);
      if (record && record.conn && record.conn.open) {
        try {
          record.conn.send(message);
          return true;
        } catch (error) {
          return false;
        }
      }
      return false;
    }

    sendToConnection(connection, message) {
      if (connection && connection.open) {
        try {
          connection.send(message);
          return true;
        } catch (error) {
          return false;
        }
      }
      return false;
    }

    async connectToHost(roomCode) {
      this.assertPeerAvailable();
      const normalizedCode = String(roomCode || "").trim();
      if (!/^\d{6}$/.test(normalizedCode)) {
        throw new Error("房间号必须是 6 位数字。");
      }

      const clientPeerId = `${Config.clientPeerPrefix}${Hushu.randomId(18)}`;
      await new Promise((resolve, reject) => {
        const peer = new Peer(clientPeerId, Config.peerOptions);
        this.peer = peer;
        let opened = false;
        let failed = false;

        const failOnce = (message) => {
          if (failed) {
            return;
          }
          failed = true;
          reject(new Error(message));
        };

        peer.on("open", () => {
          opened = true;
          this.roomCode = normalizedCode;
          resolve();
        });

        peer.on("error", (error) => {
          if (!opened) {
            failOnce(error && error.message ? error.message : "无法连接 PeerJS 信令服务。");
            return;
          }
          if (error && error.type === "peer-unavailable") {
            this.emit("clientFatal", "找不到这个房间，或房主已经离开。");
          } else if (error && error.type === "network") {
            this.emit("signalState", "offline");
          } else {
            this.emit("clientError", error);
          }
        });

        peer.on("disconnected", () => {
          this.emit("signalState", "disconnected");
          window.setTimeout(() => {
            if (!this.destroyed && this.peer === peer && !peer.destroyed && peer.disconnected) {
              try {
                peer.reconnect();
              } catch (error) {
                // 已建立的 DataChannel 可能不受信令短暂中断影响。
              }
            }
          }, 1500);
        });

        peer.on("close", () => {
          if (!opened) {
            failOnce("PeerJS 连接已关闭。");
          }
        });
      });

      const hostPeerId = `${Config.roomPeerPrefix}${normalizedCode}`;
      this.hostConnection = this.peer.connect(hostPeerId, { reliable: true });
      this.attachClientConnection(this.hostConnection);

      await new Promise((resolve, reject) => {
        const connection = this.hostConnection;
        let settled = false;

        this.joinTimeout = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            connection.close();
            reject(new Error("连接房主超时。请确认房间号，或换一个网络再试。"));
          }
        }, Config.joinTimeoutMs);

        connection.on("open", () => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(this.joinTimeout);
          this.joinTimeout = null;
          resolve(connection);
        });
        connection.on("error", () => {
          if (!settled) {
            settled = true;
            window.clearTimeout(this.joinTimeout);
            this.joinTimeout = null;
            reject(new Error("无法建立到房主的 WebRTC 数据通道。"));
          }
        });
        connection.on("close", () => {
          if (!settled) {
            settled = true;
            window.clearTimeout(this.joinTimeout);
            this.joinTimeout = null;
            reject(new Error("房主拒绝了连接或已经离开。"));
          }
        });
      });

      return this.hostConnection;
    }

    attachClientConnection(connection) {
      connection.on("open", () => {
        this.emit("clientConnected", connection);
      });
      connection.on("data", (message) => {
        this.emit("clientMessage", message, connection);
      });
      connection.on("close", () => {
        if (this.destroyed) {
          return;
        }
        this.emit("clientDisconnected");
      });
      connection.on("error", (error) => {
        this.emit("clientError", error);
      });
    }

    sendToHost(message) {
      return this.sendToConnection(this.hostConnection, message);
    }

    handleConnectionClose(connection) {
      if (this.closedPeers.has(connection.peer)) {
        return;
      }
      this.closedPeers.add(connection.peer);
      const record = this.connections.get(connection.peer);
      this.emit("connectionClosed", connection, record ? record.memberId : null);
      this.connections.delete(connection.peer);
    }

    closeConnection(connection) {
      if (!connection) {
        return;
      }
      try {
        connection.close();
      } catch (error) {
        // 已经关闭的连接无需再次处理。
      }
    }

    destroy() {
      this.destroyed = true;
      window.clearTimeout(this.joinTimeout);
      this.joinTimeout = null;

      if (this.hostConnection) {
        this.closeConnection(this.hostConnection);
        this.hostConnection = null;
      }
      this.connections.forEach((record) => {
        this.closeConnection(record.conn);
      });
      this.connections.clear();

      if (this.peer) {
        try {
          this.peer.destroy();
        } catch (error) {
          // PeerJS 已关闭时忽略。
        }
      }
      this.peer = null;
    }
  }

  Hushu.Network = Network;
})();
