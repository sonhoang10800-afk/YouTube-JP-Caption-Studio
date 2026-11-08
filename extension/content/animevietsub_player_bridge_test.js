/**
 * Test for animevietsub_player_bridge.js logic
 * Run with: node extension/content/animevietsub_player_bridge_test.js
 */
const assert = require("assert");

function testPlayerBridgeMessageHandling() {
  const sentMessages = [];
  const topMock = {
    postMessage: (data, targetOrigin) => {
      sentMessages.push({ data, targetOrigin });
    }
  };

  const fakeVideo = {
    currentTime: 10.5,
    duration: 1420.0,
    paused: false,
    playCalled: false,
    pauseCalled: false,
    play() { this.playCalled = true; return Promise.resolve(); },
    pause() { this.pauseCalled = true; }
  };

  const { attachPlayerBridge } = require("./animevietsub_player_bridge.js");

  const bridge = attachPlayerBridge({
    video: fakeVideo,
    topWindow: topMock
  });

  // Ready message sent on attach
  assert.strictEqual(sentMessages.length, 1);
  assert.strictEqual(sentMessages[0].data.type, "AVS_PLAYER_READY");

  // Test timeupdate broadcast
  bridge.broadcastTimeupdate();
  assert.strictEqual(sentMessages.length, 2);
  assert.strictEqual(sentMessages[1].data.type, "AVS_PLAYER_TIMEUPDATE");
  assert.strictEqual(sentMessages[1].data.currentTime, 10.5);

  // Test seek command handling
  bridge.handleIncomingMessage({ data: { type: "AVS_PLAYER_SEEK", time: 83.5 } });
  assert.strictEqual(fakeVideo.currentTime, 83.5, "video.currentTime should update on seek message");

  // Test play/pause command handling
  bridge.handleIncomingMessage({ data: { type: "AVS_PLAYER_PAUSE" } });
  assert.strictEqual(fakeVideo.pauseCalled, true);

  bridge.handleIncomingMessage({ data: { type: "AVS_PLAYER_PLAY" } });
  assert.strictEqual(fakeVideo.playCalled, true);

  console.log("PASS: animevietsub_player_bridge_test.js");
}

testPlayerBridgeMessageHandling();
