/* global window */
(function () {
  "use strict";

  // 调整这里的信令和 ICE 配置即可替换公共 PeerJS 服务。
  // 当前版本使用公共 PeerJS Cloud 做信令，WebRTC 数据尽量在玩家之间直连。
  window.HushuConfig = Object.freeze({
    roomPeerPrefix: "hushu-local-v1-",
    clientPeerPrefix: "hushu-client-v1-",
    reconnectGraceMs: 10000,
    heartbeatMs: 4000,
    heartbeatTimeoutMs: 12000,
    joinTimeoutMs: 16000,
    chatLimit: 80,
    peerOptions: {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" }
        ]
      }
    }
  });
})();
