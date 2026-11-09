// The website's stand-in for the Playgama Bridge, so game.js stays byte-for-byte the same as the Playgama build.
// Progress is kept in this browser; there are no ads, leaderboards or network calls here.
window.bridge = {
  EVENT_NAME: { AUDIO_STATE_CHANGED: 'audio', PAUSE_STATE_CHANGED: 'pause', INTERSTITIAL_STATE_CHANGED: 'interstitial', REWARDED_STATE_CHANGED: 'rewarded' },
  initialize: async () => {},
  platform: { id: 'zibno', isAudioEnabled: true, language: 'en', sendMessage: async () => {}, on() {} },
  storage: {
    get: async (keys) => keys.map((k) => localStorage.getItem(k)),
    set: async (keys, values) => keys.forEach((k, i) => localStorage.setItem(k, values[i])),
  },
  advertisement: { isInterstitialSupported: false, isRewardedSupported: false, on() {}, showInterstitial() {}, showRewarded() {} },
  leaderboards: { type: 'not_available' },
};
