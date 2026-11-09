// VOLTLANE (Playgama build) — the same game as games/voltlane, with the Playgama Bridge SDK in place of the YouTube Playables SDK.
// VOLTLANE — a 60-second neon score attack. Steer through gates, chain cores for a multiplier, graze walls to charge DASH.
// Everything (art, sound, music) is generated in code; no asset files, no network, no eval.
// Fair play: fixed 720x1280 playfield, fixed-timestep simulation, and a track that depends only on the seed and the
// distance travelled (never on the frame rate, the screen shape, or visual-effect randomness).
'use strict';

const W = 720, H = 1280;          // the playfield, scaled to fit any screen
const SHIP_Y = 1030, SHIP_R = 15;
const DT = 1 / 120;               // simulation step
const ROUND = 60;                 // seconds
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const vr = Math.random;           // visual randomness ONLY; gameplay uses the seeded rng below
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const C = { bg: '#06021a', mag: '#ff2e93', cyan: '#37f7ff', lime: '#a6ff3d', gold: '#ffd23d', vio: '#8a5bff', white: '#ffffff' };

// ---------------------------------------------------------------- Playgama Bridge
// Playgama requires its Bridge SDK in every game. It ships next to index.html (playgama-bridge.js), so nothing is downloaded at
// runtime. Everything platform-specific lives in `pg`; the game never touches `bridge` anywhere else. Bridge must finish
// initialising before the game starts (see boot() at the bottom), and no SDK call is made before that.
const B = (typeof bridge !== 'undefined') ? bridge : null;
const KEY = 'voltlane_v1';
const pg = {
  ready: false,
  interstitialOk() { try { return !!B && this.ready && !!B.advertisement.isInterstitialSupported; } catch { return false; } },
  rewardedOk() { try { return !!B && this.ready && !!B.advertisement.isRewardedSupported; } catch { return false; } },
  // progress goes through Bridge storage only (never localStorage): one read at startup, one write per meaningful change
  async load() { try { const d = await B.storage.get([KEY]); return d && d[0] ? JSON.parse(d[0]) : null; } catch { return null; } },
  save(obj) { try { B.storage.set([KEY], [JSON.stringify(obj)]).catch(() => {}); } catch { /* no storage here */ } },
  score(n) { try { if (B.leaderboards.type !== 'not_available') B.leaderboards.setScore('main', Math.floor(n)).catch(() => {}); } catch { /* no leaderboard here */ } },
  message(m) { try { B.platform.sendMessage(m)?.catch?.(() => {}); } catch { /* ignore */ } },
  // Bridge decides whether an ad is really shown (no counters or timers of ours). We call it at a natural pause and wait for it
  // to finish; if no ad starts within 2 s, or it never answers, we carry on so the buttons are never left dead.
  interstitial() {
    return new Promise((resolve) => {
      if (!this.interstitialOk()) return resolve();
      let opened = false, done = false;
      const t1 = setTimeout(() => { if (!opened) fin(); }, 2000);
      const t2 = setTimeout(() => fin(), 60000);
      const fin = () => { if (done) return; done = true; clearTimeout(t1); clearTimeout(t2); resolve(); };
      const on = (st) => { if (st === 'loading' || st === 'opened') opened = true; if (st === 'closed' || st === 'failed') fin(); };
      try { B.advertisement.on(B.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, on); B.advertisement.showInterstitial('game_over'); } catch { fin(); }
    });
  },
  // resolves true ONLY when Bridge reports the 'rewarded' state (closing the ad early gives nothing)
  rewarded() {
    return new Promise((resolve) => {
      if (!this.rewardedOk()) return resolve(false);
      let opened = false, got = false, done = false;
      const t1 = setTimeout(() => { if (!opened) fin(); }, 5000);
      const t2 = setTimeout(() => fin(), 120000);
      const fin = () => { if (done) return; done = true; clearTimeout(t1); clearTimeout(t2); resolve(got); };
      const on = (st) => { if (st === 'loading' || st === 'opened') opened = true; if (st === 'rewarded') got = true; if (st === 'closed' || st === 'failed') fin(); };
      try { B.advertisement.on(B.EVENT_NAME.REWARDED_STATE_CHANGED, on); B.advertisement.showRewarded('revive'); } catch { fin(); }
    });
  },
};

// ---------------------------------------------------------------- save (tiny: about 120 bytes)
// A save is held back (dirty) until the startup read has finished, then flushed.
const save = { best: 0, plays: 0, ship: 0, paint: [], art: 0, d: { day: 0, best: 0 } }; // art = high scores set so far (each one reveals a backdrop)
let loaded = false, dirty = false;
const persist = () => {
  if (!loaded) { dirty = true; return; }
  pg.save(save);
};
// the platform's audio switch (hostAudio) and the in-game mute button (userMute) both control sound; boot() reads the real value after Bridge is initialised
let hostAudio = true;
let LANG = 'en';

// ---------------------------------------------------------------- ranks and the daily rival bots
const TIERS = [['BRONZE', 0, '#d99a5b'], ['SILVER', 8000, '#cfd8e3'], ['GOLD', 20000, C.gold], ['PLATINUM', 40000, '#7df3e1'], ['DIAMOND', 65000, '#6ab7ff'], ['APEX', 95000, C.mag]];
const tierOf = (s) => { let t = TIERS[0]; for (const x of TIERS) if (s >= x[1]) t = x; return t; };
const tierIdx = (s) => TIERS.indexOf(tierOf(s));
// Sixteen jets, unlocked by best score (never bought), three free paint jobs each. Hitbox, speed and steering are identical for every jet;
// they differ in looks, trail, dash aura and weapon (gun, rockets or saber, tuned to be worth about the same; see WEAPONS).
// Sprites are the LEFT half of the jet (mirrored at build time). H M S = hull light/mid/shade, A B = paint bright/dark, C G = canopy dark/glint, E = engine.
// paints: [name, hull light, hull mid, hull shade, paint bright, paint dark, canopy dark, canopy glint]
const HULLS = { pale: ['#f2f0ea', '#bfbdc7', '#7a778f'], dark: ['#7f859c', '#50566e', '#333850'], warm: ['#fbeed2', '#d8b990', '#9b7a58'], cool: ['#e3f0ff', '#a2bbdb', '#647fa8'], olive: ['#c8d59a', '#859a5e', '#526842'], bright: ['#ffffff', '#d4dae6', '#8e98ad'] };
const PT = (n, h, a, b) => [n, ...HULLS[h], a, b, '#161a30', '#a4ecff'];
const SHIPS = [
  { n: 'STRIKER', need: 0, w: 'gun', trail: 'dots', jets: [[3, 25]],
    art: ['.........H', '.........H', '........HM', '........HM', '........HC', '........HG', '.......HMC', '.......HMC', '.......HMM', '......AHMM', '.....AAHMM', '....AAHHMM', '...AAHHMMM', '..AAHHMMMS', '.AAHHMMMSS', 'AABHMMSSSS', 'ABBHMSSSSS', 'BB.HMSSBBS', '...HMSBAAS', '.....SBAAS', '.....SSBBS', '....ASSESS', '...AASEEES', '...BB.EEES', '......EEE.'],
    paints: [['FACTORY', '#f4f1ea', '#c3c0c9', '#7e7a92', '#ff9a3d', '#b4531c', '#1d2f55', '#7fd8ff'], ['GUNMETAL', '#a9b2c4', '#6d7890', '#454d66', '#ff4b4b', '#a31f35', '#2a1020', '#ffb0a0'], ['JUNGLE', '#c8d59a', '#859a5e', '#526842', '#ffd23d', '#a97a18', '#1c2a1e', '#d6f58a']] },
  { n: 'WRAITH', need: 8000, w: 'saber', trail: 'ribbon', jets: [[1, 27]],
    art: ['.........H', '.........H', '.........H', '.........M', '........HM', '........HC', '........HG', '........HC', '........MC', '........HM', '.......AHM', '.......AHM', '......ABHM', '......ABHM', '.....AB.HS', '.....AB.HS', '....AB..HS', '....AB..MS', '...AB...MS', '...AB...MS', '..AB...ESS', '..AB...EES', '.AB....EEE', '.B......EE', '........EE'],
    paints: [['PHANTOM', '#e6ebf2', '#a8b2c2', '#6a7488', '#cfd8e3', '#7f8ba0', '#16182c', '#a0e8ff'], ['BLACKOUT', '#6c7186', '#474b60', '#2e3145', '#ff2e6e', '#94123f', '#0d0d18', '#ff9abc'], ['SEAFOAM', '#dff5ec', '#9bcdbc', '#5f9085', '#58e0c0', '#23806f', '#123038', '#c0fff0']] },
  { n: 'SOLAR', need: 20000, w: 'rocket', trail: 'sparks', jets: [[2, 23], [7, 19]],
    art: ['..........', '..........', '..........', '.........H', '........HM', '.......HMC', '.......HMG', '......HMMC', '.....AHMMM', '...AAAHMMM', '.AAAABHMMM', 'AAABBHHMMS', 'ABBHHHMMMS', 'BBHHMMMMSS', '.BHMMMSSSS', '..HMMSSSSS', '..BMS.ESSS', '.....EEESS', '.....EEESE', '......E.EE', '........EE', '........EE', '..........', '..........', '..........'],
    paints: [['SUNRISE', '#fff4d6', '#e0c79a', '#a1825f', '#ffd23d', '#c2811b', '#4a2a10', '#ffe9a0'], ['ECLIPSE', '#8b7f9e', '#5c5274', '#3b3452', '#ffb13d', '#b4531c', '#17101f', '#ffd9a0'], ['CORAL', '#fde5dc', '#e0a9a2', '#a87079', '#ff7a6b', '#b23c4a', '#2c1b33', '#ffc9bd']] },
  { n: 'GLACIER', need: 40000, w: 'gun', trail: 'snow', jets: [[4, 25]],
    art: ['.........H', '........HH', '........HM', '.......HMC', '.......HMG', '......AHMC', '.....AAHMC', '....AAHHMM', '.....BHHMM', '......HHMM', '......HMMM', '.....HHMMM', '....AHHMMS', '...AAHMMMS', '..AABHMMSS', '.AAB.HMMSS', '.BB..HMSSS', '.....HMSSS', '.....SSSSS', '.....SBBSS', '....ASAASS', '....ABESSS', '.....EEESS', '.....EEE.S', '......E...'],
    paints: [['FROST', '#f0fffb', '#b4dcd8', '#6f9ea6', '#7df3e1', '#2f9c98', '#16304a', '#c8f7ff'], ['DEEP ICE', '#b0c8ec', '#6e8dc0', '#44608f', '#3df0ff', '#1c7fa8', '#0e1a3a', '#a8f4ff'], ['AMETHYST', '#ece2ff', '#b6a2dc', '#7c689f', '#c49bff', '#6c3fc2', '#1f1438', '#e6d0ff']] },
  { n: 'VORTEX', need: 65000, w: 'rocket', trail: 'twin', jets: [[5, 25]],
    art: ['....H.....', '....HH....', '...HMH....', '...HMM....', '...HCM....', '...HGM....', '...HCM....', '..AHMM...M', '.AAHMM..HM', '.ABHMM..HC', 'AB.HMMH.HG', 'AB.HMMMHMC', 'AB.HMMMMMM', 'AB.HMMSMMM', 'A..HMMSSMM', '...HMSSSMS', '...HMSBBSS', '...HMSBASS', '...SSSBBSS', '...SSS.SSS', '...EEE..SS', '...EEE...E', '...EEE...E', '....E.....', '..........'],
    paints: [['COBALT', '#e6f1ff', '#a4bfe2', '#6583ad', '#6ab7ff', '#2a68b5', '#10203f', '#b0e4ff'], ['MIDNIGHT', '#8089ad', '#535c80', '#343b5a', '#a6ff3d', '#5c9a1b', '#0c1020', '#dcffa0'], ['CRIMSON', '#ffe2df', '#d99a9e', '#9e5d68', '#ff4757', '#a11c33', '#2a0f1c', '#ffb8b0']] },
  { n: 'APEX', need: 95000, w: 'saber', trail: 'rainbow', jets: [[3, 24], [6, 21]],
    art: ['.........H', '.........H', '........HM', '........HC', '.AB.....HG', '.AAB...HMC', '..AAB..HMC', '..AAAB.HMM', '...AAABHMM', '...AABHHMM', '....BHHMMM', '....HHMMMS', '...AHHMMMS', '..AAHMMMSS', '.AABHMMSSS', 'AABHHMSSSS', 'ABB.HMSBBS', 'B...HMSBAS', '....HMSSSS', '.....SESSS', '.....EEESS', '....AEEEBS', '...AB.EEBA', '...B...E.B', '..........'],
    paints: [['NEON', '#fff0f8', '#d8a9c8', '#9a6a95', '#ff2e93', '#a01364', '#1c0e3a', '#9fe9ff'], ['VOID', '#6d6685', '#463f5c', '#2c2740', '#a56bff', '#5b2fc0', '#0b0716', '#e0b8ff'], ['CHROME', '#ffffff', '#c7cfdb', '#8791a3', '#37f7ff', '#1b8fa8', '#15233f', '#d8fbff']] },
  { n: 'HORNET', need: 2000, w: 'gun', trail: 'dots', jets: [[4, 20]],
    art: ['.........H', '........HM', '........HC', '.......HMG', '.......HMC', '..A....HMM', '.AA...HHMM', '.AB..AHMMM', '.AB.AAHMMM', '.ABAABHMMS', '.AAABHMMMS', '..ABHHMMSS', '...BHMMMSS', '....HMMSSS', '....HMSBBS', '....HMSAAS', '....SSSBBS', '....ESSSSS', '...EEE.SSS', '...EEE..SS', '....E...EE', '.........E'],
    paints: [PT('WASP', 'pale', '#ffd23d', '#a97a18'), PT('RUST', 'dark', '#ff8a3d', '#a0491c'), PT('MINT', 'pale', '#6fffb0', '#22905f')] },
  { n: 'COMET', need: 4000, w: 'rocket', trail: 'ribbon', jets: [[2, 24]],
    art: ['.........H', '.........H', '........HH', '........HM', '.......HMC', '.......HMG', '.......HMC', '......HHMM', '......HMMM', '.....HHMMM', '.....HMMMS', '....HHMMMS', '....HMMMSS', '...AHMMSSS', '..AAHMSSSS', '.AABHSSBBS', '.ABB.SBAAS', 'AB...SBAAS', 'B....SSBBS', '.....SSSSS', '.....SSESE', '......EEEE', '.......EEE', '........EE'],
    paints: [PT('TRAILBLAZE', 'pale', '#6ab7ff', '#2a68b5'), PT('CINDER', 'dark', '#ff6a3d', '#a02f1c'), PT('LILAC', 'pale', '#d9a0ff', '#7a45c2')] },
  { n: 'RAZOR', need: 6000, w: 'saber', trail: 'ribbon', jets: [[2, 25]],
    art: ['.........H', '.........H', '.........H', '........HM', '........HM', '.......HMC', '.......HMG', '......HMMC', '.....AHMMM', '....AAHMMM', '...AABHMMM', '..AAB.HMMS', '.AAB..HMMS', '..AB..HMSS', '...B..HMSS', '......HMSS', '.....AHSSS', '....AABSSS', '...AAB.SSS', '..AAB..SSS', '...B...ESS', '......EEES', '......EEEE', '.......EEE', '.........E'],
    paints: [PT('STEEL', 'pale', '#ff4b4b', '#a31f35'), PT('NIGHTSHADE', 'dark', '#b46bff', '#5b2fc0'), PT('LIME EDGE', 'dark', '#a6ff3d', '#5c9a1b')] },
  { n: 'PHOENIX', need: 12000, w: 'gun', trail: 'sparks', jets: [[2, 24]],
    art: ['.........H', '........HM', '........HC', '.......HMG', '.......HMC', 'A......HMM', 'AA....HHMM', 'BAA...HMMM', '.BAA.HHMMM', 'A.BAAHMMMS', 'AA.BAHMMMS', 'BAA.BHMMSS', '.BAABHMMSS', 'A.BAHHMSSS', 'AA.BHHMSSS', 'BAA.BHSSSS', '.BA..HSBBS', '..B..HSAAS', '.....SSBBS', '......SSSS', '......SSES', '......EEEE', '.......EEE', '........E.'],
    paints: [PT('FLAME', 'warm', '#ff6a2e', '#b03314'), PT('ASHES', 'dark', '#ffb13d', '#a8651a'), PT('ROSE GOLD', 'warm', '#ff9ec0', '#b4557c')] },
  { n: 'NOMAD', need: 16000, w: 'rocket', trail: 'snow', jets: [[3, 22], [7, 22]],
    art: ['........HH', '.......HMM', '.......HMC', '.......HMG', '.......HMC', '.......HMM', '...AAAAHMM', '..AHHHHHMM', '..AHMMMHMM', '..AHMMMHMS', '..AHMMMHMS', '..AHMSSHSS', '..AHMSSHSS', '..AHMSSHSS', '..ABBBBHSS', '..ABAABHSS', '..ABBBBSSS', '..AHMSSSSS', '..SSSSSSSS', '...EE..EES', '..EEE..EEE', '..EEE..EEE', '...E....E.'],
    paints: [PT('SAND', 'warm', '#e0a85a', '#94632a'), PT('ARMY', 'olive', '#b5c26a', '#677535'), PT('SLATE', 'dark', '#7fb4d6', '#3e6d8f')] },
  { n: 'TITAN', need: 26000, w: 'saber', trail: 'twin', jets: [[3, 23], [7, 21]],
    art: ['........HH', '.......HMM', '......HMMC', '......HMMG', '......HMMC', '.....AHMMM', '....AAHHMM', '...AAHHMMM', '..AAHHMMMM', '.AABHHMMMM', 'AABHHMMMMS', 'ABHHMMMMMS', 'AHHMMMSSSS', 'BHMMMSSSSS', 'BHMMSSBBSS', 'BHMSSBAABS', '.HMSSBAABS', '.BSSSSBBSS', '..SSSSSSSS', '..SSSSSSSS', '..EEE..SSS', '..EEE..EEE', '...E...EEE', '........E.'],
    paints: [PT('BASTION', 'pale', '#ffb13d', '#a8651a'), PT('OBSIDIAN', 'dark', '#ff3d6a', '#94123f'), PT('GLACIAL', 'cool', '#7df3e1', '#2f9c98')] },
  { n: 'SPECTER', need: 33000, w: 'gun', trail: 'ribbon', jets: [[4, 15]],
    art: ['..........', '..........', '.........H', '........HM', '.......HMC', '......HMMG', '.....AHMMC', 'A...AAHMMM', 'AA.AABHMMS', 'BAAAB.HMMS', '.BAA.HHMMS', '..B..HMMSS', 'A...HHMSSS', 'AA.HHMSS.S', 'BAHHMSSE..', '.BHMSSEEE.', '..BSS.EEE.', '.......E..'],
    paints: [PT('MIST', 'cool', '#cfd8e3', '#7f8ba0'), PT('SHADE', 'dark', '#37f7ff', '#1b8fa8'), PT('ORCHID', 'pale', '#ff7ae0', '#a53a93')] },
  { n: 'TEMPEST', need: 50000, w: 'rocket', trail: 'sparks', jets: [[2, 24]],
    art: ['A........H', 'AB.......H', 'BAB.....HM', '.BAB....HC', '..BAB..HMG', '...BAB.HMC', '....BABHMM', '.....BHHMM', '......HMMM', '......HMMM', '.....BHMMS', '....BABHMS', '...BAB.HMS', '..BAB..HSS', '.BAB...HSS', 'BAB...HMSS', 'AB....HSSS', 'A.....SSBB', '......SBAA', '......SSBB', '......SSSS', '......EESE', '......EEEE', '.......EEE', '........E.'],
    paints: [PT('THUNDER', 'cool', '#ffe23d', '#b0851a'), PT('MONSOON', 'dark', '#5ee0ff', '#1d7fa8'), PT('STORM ROSE', 'pale', '#ff5f9e', '#a0245e')] },
  { n: 'ORION', need: 80000, w: 'saber', trail: 'snow', jets: [[3, 24]],
    art: ['.........H', '.........H', '........HM', '........HC', '........HG', '........HC', '.......HMM', '.......HMM', '....AA.HMM', 'AAAAABHHMM', 'ABBBBHHMMM', 'AAAAABHHMM', '....AA.HMM', '.......HMS', '......HHMS', '......HMMS', '.....AHMSS', '....AAHMSS', '...AAB.HSS', '..AAB..SSS', '...B..SSBS', '.....ESSAS', '....EEESSS', '....EEE.ES', '.....E...E'],
    paints: [PT('STARLIGHT', 'cool', '#9fc4ff', '#4a6fc0'), PT('EVENT', 'dark', '#ffd23d', '#a97a18'), PT('NEBULA', 'pale', '#ff6ae0', '#8a2fc2')] },
  { n: 'HALO', need: 110000, w: 'gun', trail: 'rainbow', jets: [[2, 24]],
    art: ['.........H', '.....AAAHM', '....AB.HMC', '...AB..HMG', '..AB...HMC', '.AB....HMM', '.AB...HHMM', 'AB....HMMM', 'AB...HHMMM', 'AB..HHMMMS', 'AB.HHMMMMS', 'ABHHMMMSSS', 'ABHMMSSSSS', 'AB.HMSSSSS', 'AB..HSSSBS', '.AB.HSSBAS', '.AB..SSSBS', '..AB.SSSSS', '...AB.SSSS', '....AB.SSS', '.....AAESE', '......EEEE', '.......EEE', '........E.'],
    paints: [PT('SERAPH', 'bright', '#ffe9a0', '#c29a3d'), PT('ABYSS', 'dark', '#7a7dff', '#3a3cc2'), PT('PRISM', 'bright', '#37f7ff', '#ff2e93')] },
];
const ORDER = SHIPS.map((_, i) => i).sort((a, b) => SHIPS[a].need - SHIPS[b].need); // the hangar walks through them cheapest first
const paintOf = (i) => (Array.isArray(save.paint) ? clamp(save.paint[i] | 0, 0, 2) : 0);
const shipCol = (i, p) => SHIPS[i].paints[p][4]; // the paint's bright colour also tints the trail
const shipUnlocked = (i) => save.best >= SHIPS[i].need;
const curShip = () => (shipUnlocked(save.ship | 0) ? save.ship | 0 : 0);
// a flawless run scores about 120k, so the ladder tops out below that
const RIVALS = [['ARC-7', 8000], ['KILO', 20000], ['VANTA', 40000], ['ZENITH', 65000]];
const today = () => Math.floor(Date.now() / 86400000);
// rival bots (not real players): their targets change every day, so there is always someone to chase
function rivalsFor(day) { const r = mulberry32(day * 31 + 7); return RIVALS.map(([n, s]) => ({ n, s: Math.round(s * (0.85 + 0.3 * r()) / 10) * 10 })); }
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// ---------------------------------------------------------------- canvas: fit the playfield, centred
const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');
let bs = 1; // backing-store pixels per logical pixel
function resize() {
  if (!innerWidth || !innerHeight) return; // host iframe still laying out
  const fit = Math.min(innerWidth / W, innerHeight / H);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cvs.style.width = W * fit + 'px';
  cvs.style.height = H * fit + 'px';
  cvs.width = Math.round(W * fit * dpr);
  cvs.height = Math.round(H * fit * dpr);
  bs = cvs.width / W;
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- sound + music (recorded CC0 files in audio/, see audio/CREDITS.txt)
let userMute = false; // the in-game mute button; the platform's audio switch (hostAudio) still wins
const audioOn = () => hostAudio && !userMute;
const SFX_VOL = { core: 0.55, graze: 0.35, hit: 0.9, dash: 0.6, ready: 0.6, shield: 0.7, best: 0.7, deny: 0.5, click: 0.6 };
const sfx = {
  ctx: null, out: null, bufs: {},
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !hostPaused) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = audioOn() ? 0.8 : 0;
    this.out.connect(this.ctx.destination);
    for (const n of [...Object.keys(SFX_VOL), 'music']) this.load(n);
  },
  load(n) {
    fetch('audio/' + n + '.mp3').then((r) => r.arrayBuffer())
      .then((ab) => new Promise((ok, no) => this.ctx.decodeAudioData(ab, ok, no)))
      .then((b) => { this.bufs[n] = b; }).catch(() => {});
  },
  refresh() { if (this.out) this.out.gain.setValueAtTime(audioOn() ? 0.8 : 0, this.ctx.currentTime); },
  setHost(on) { hostAudio = on; this.refresh(); },
  setMute(m) { userMute = m; save.mute = m; persist(); this.refresh(); },
  play(n, rate = 1, vol = SFX_VOL[n]) {
    const b = this.bufs[n];
    if (!this.ctx || !b || !audioOn()) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = b; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(this.out); s.start();
  },
  core(combo) { this.play('core', 1 + Math.min(combo, 24) * 0.03); },
  graze() { this.play('graze'); },
  hit() { this.play('hit'); },
  dash() { this.play('dash'); },
  ready() { this.play('ready'); },
  shield() { this.play('shield'); },
  best() { this.play('best'); },
  deny() { this.play('deny'); },
  click() { this.play('click'); },
};
// the music loops while a run is being played; it stops in every other state, so pausing and the results screen are quiet
const music = {
  src: null,
  reset() { this.stop(); },
  stop() { if (this.src) { try { this.src.stop(); } catch { /* already stopped */ } this.src = null; } },
  update() {
    const a = sfx.ctx, b = sfx.bufs.music;
    if (this.src || !a || !b || a.state !== 'running') return;
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = b; s.loop = true; g.gain.value = 0.4;
    s.connect(g).connect(sfx.out); s.start();
    this.src = s;
  },
};

// ---------------------------------------------------------------- the run (pure simulation: seed + inputs -> score)
const speedAt = (d) => 560 + 700 * clamp(d / 52000, 0, 1);
const diffAt = (d) => clamp(d / 45000, 0, 1);
const multOf = (c) => Math.min(8, 1 + Math.floor(c / 6));
const SLOTS = [100, 235, 360, 485, 620];

function newRun(mode, seed) {
  return {
    mode, seed, ship: curShip(), paint: paintOf(curShip()), rng: mulberry32(seed), t: 0, dist: 0, pts: 0, dpts: 0, combo: 0, maxCombo: 0, hp: 3, meter: 0, dashT: 0, inv: 0,
    x: W / 2, tx: W / 2, vx: 0, objs: [], items: [], nextGen: 900, lastGap: W / 2, patIdx: 0,
    grazes: 0, cores: 0, hits: 0, over: null, revived: false, step: 0,
    ammo: 100, wcd: 0, swing: 0, shots: [], broken: 0,
    art0: 0, artHit: false, artFade: 0, artDone: false, // backdrop (visual only): the one this run started on, and the fade to the next on a new high score
    // effects (visual only)
    fx: { parts: [], pops: [], blasts: [], shake: 0, flash: 0, flashCol: C.mag, trail: [] },
  };
}
const scoreOf = (r) => Math.floor(r.pts + r.dpts);

// ---- the track: patterns placed in WORLD distance, generated ahead of the ship
function gapWall(r, wy, cx, gapW, h = 44) { r.objs.push({ k: 'wall', wy, h, gl: cx - gapW / 2, gr: cx + gapW / 2, gz: [false, false], hp: [WALL_HP, WALL_HP], dead: [false, false] }); }
function genPattern(r) {
  const rng = r.rng, y = r.nextGen, d = diffAt(y), v = speedAt(y);
  let kind;
  if (r.patIdx < 3) kind = 'gap';
  else if (r.patIdx % 12 === 9) kind = 'gap';
  else { const x = rng(); kind = x < 0.40 ? 'gap' : x < 0.60 ? 'posts' : x < 0.80 ? 'slalom' : 'double'; }
  const spacing = v * lerp(0.62, 0.5, d);
  let len = 0;
  if (kind === 'gap') {
    const gapW = r.patIdx < 3 ? 400 : lerp(340, 190, d), shift = lerp(240, 430, d);
    const cx = clamp(r.lastGap + (rng() * 2 - 1) * shift, gapW / 2 + 30, W - gapW / 2 - 30);
    gapWall(r, y, cx, gapW);
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: cx, wy: y - 60 - 62 * i, got: false });
    if (r.patIdx % 12 === 9) r.items.push({ k: 'shield', x: cx, wy: y - 330, got: false });
    r.lastGap = cx; len = 44;
  } else if (kind === 'posts') {
    const pick = () => { const idx = [0, 1, 2, 3, 4]; for (let i = 4; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return { occ: idx.slice(0, 3), free: idx.slice(3) }; };
    const a = pick();
    let b = pick();
    for (let tries = 0; tries < 8; tries++) { if (a.free.some((f) => b.free.some((g) => Math.abs(SLOTS[f] - SLOTS[g]) <= 270))) break; b = pick(); }
    for (const s of a.occ) r.objs.push({ k: 'post', x: SLOTS[s], wy: y, r: 34, gz: [false], hp: [POST_HP], dead: [false] });
    for (const s of b.occ) r.objs.push({ k: 'post', x: SLOTS[s], wy: y + 170, r: 34, gz: [false], hp: [POST_HP], dead: [false] });
    const fa = SLOTS[a.free[0]], fb = SLOTS[b.free.find((g) => Math.abs(SLOTS[g] - fa) <= 270) ?? b.free[0]];
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: lerp(fa, fb, i / 3), wy: y + 40 + 40 * i, got: false });
    r.lastGap = fb; len = 238;
  } else if (kind === 'slalom') {
    const gapW = lerp(320, 230, d), A = lerp(150, 215, d), ph = rng() * TAU, c = [];
    for (let i = 0; i < 5; i++) { c.push(clamp(W / 2 + A * Math.sin(ph + i * 1.15), gapW / 2 + 30, W - gapW / 2 - 30)); gapWall(r, y + i * 200, c[i], gapW, 36); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) r.items.push({ k: 'core', x: lerp(c[i], c[i + 1], (j + 0.5) / 2), wy: y + i * 200 + 36 + 55 + j * 55, got: false });
    r.lastGap = c[4]; len = 4 * 200 + 36;
  } else { // double: two gaps on opposite sides, with a line of cores between
    const gapW = lerp(300, 200, d), left = rng() < 0.5;
    const c1 = left ? 180 + rng() * 120 : 420 + rng() * 120, c2 = left ? 420 + rng() * 120 : 180 + rng() * 120;
    gapWall(r, y, c1, gapW); gapWall(r, y + 330, c2, gapW);
    for (let i = 0; i < 4; i++) r.items.push({ k: 'core', x: lerp(c1, c2, (i + 0.5) / 4), wy: y + 44 + 55 + 55 * i, got: false });
    r.lastGap = c2; len = 330 + 44;
  }
  r.patIdx++;
  r.nextGen = y + len + spacing;
}

const sy = (r, wy) => SHIP_Y - (wy - r.dist); // world distance -> screen y
function pop(r, x, y, txt, col, size = 30) { r.fx.pops.push({ x, y, txt, col, size, age: 0 }); }
function burst(r, x, y, n, col, speed, size = 5, life = 0.6) {
  const P = r.fx.parts;
  for (let i = 0; i < n && P.length < 500; i++) { const a = vr() * TAU, s = speed * (0.3 + vr() * 0.7); P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, col, size }); }
}
function hurt(r) {
  if (r.inv > 0 || r.dashT > 0) return;
  r.hp--; r.hits++; r.combo = 0; r.inv = 1.3;
  r.fx.shake = 1; r.fx.flash = 0.5; r.fx.flashCol = C.mag;
  burst(r, r.x, SHIP_Y, 30, C.mag, 520, 6, 0.7);
  sfx.hit();
  if (r.hp <= 0) { r.hp = 0; r.over = 'dead'; r.fx.shake = 1.4; burst(r, r.x, SHIP_Y, 60, C.white, 700, 7, 1); }
}
function graze(r, x, y) {
  const m = multOf(r.combo);
  r.pts += 25 * m; r.grazes++;
  if (r.dashT <= 0) r.meter = Math.min(100, r.meter + 22);
  pop(r, x, y, '+' + 25 * m, C.cyan, 26);
  burst(r, x, y, 6, C.cyan, 260, 3, 0.35);
  sfx.graze();
  if (r.meter >= 100 && !r.ready) { r.ready = true; sfx.ready(); pop(r, r.x, SHIP_Y - 70, 'DASH READY', C.lime, 30); }
}
function dist2rect(px, py, x0, y0, x1, y1) { const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1); return Math.hypot(dx, dy); }

// ---- weapons: they fire by themselves at whatever is in the ship's path. Energy is the limit: it refills slowly, and each core adds some.
// All of this is simulation (same inputs give the same run), so a Daily Run is still the same contest for everyone.
const WALL_HP = 3, POST_HP = 1;
const WEAPONS = {
  gun: { label: 'GUN', cost: 8, cd: 0.13, range: 560 },
  rocket: { label: 'ROCKETS', cost: 40, cd: 0.6, range: 640 },
  saber: { label: 'SABER', cost: 26, cd: 0.4, range: 175 },
};
const ENERGY_PER_SEC = 8, ENERGY_PER_CORE = 5, SABER_REACH = 170, BLAST_R = 130;
function smash(r, o, s, dmg, hx, hy) {
  if (o.dead[s]) return;
  const col = o.k === 'wall' ? C.mag : C.vio;
  o.hp[s] -= dmg;
  if (o.hp[s] > 0) { burst(r, hx, hy, 4, col, 220, 3, 0.25); return; }
  o.dead[s] = true; r.broken++;
  const g = (o.k === 'wall' ? 60 : 40) * multOf(r.combo);
  r.pts += g; pop(r, hx, hy, '+' + g, C.gold, 26);
  if (o.k === 'wall') { const x0 = s ? o.gr : 0, x1 = s ? W : o.gl; for (let i = 0; i < 5; i++) burst(r, lerp(x0, x1, (i + 0.5) / 5), hy, 8, col, 420, 5, 0.5); }
  else burst(r, o.x, hy, 26, col, 420, 5, 0.5);
}
// the nearest solid thing in the ship's path within range, or null
function inPath(r, range) {
  let best = null, bd = 1e9;
  for (const o of r.objs) {
    const d = SHIP_Y - sy(r, o.wy);
    if (d < -10 || d > range || d >= bd) continue;
    if (o.k === 'wall') { const s = r.x < o.gl + SHIP_R ? 0 : r.x > o.gr - SHIP_R ? 1 : -1; if (s >= 0 && !o.dead[s]) { best = o; bd = d; } }
    else if (!o.dead[0] && Math.abs(r.x - o.x) < o.r + SHIP_R + 6) { best = o; bd = d; }
  }
  return best;
}
// what a projectile at world position (x, wy) has run into: [object, side] or null
function hitAt(r, x, wy) {
  for (const o of r.objs) {
    if (o.k === 'wall') { if (wy < o.wy || wy > o.wy + o.h + 30) continue; const s = x < o.gl ? 0 : x > o.gr ? 1 : -1; if (s >= 0 && !o.dead[s]) return [o, s]; }
    else if (!o.dead[0] && Math.hypot(x - o.x, wy - o.wy) < o.r) return [o, 0];
  }
  return null;
}
function explode(r, x, wy) {
  const y = sy(r, wy);
  r.fx.blasts.push({ x, y, age: 0 });
  for (const o of r.objs) {
    if (o.k === 'wall') { const s = x < o.gl ? 0 : x > o.gr ? 1 : -1; if (s >= 0 && Math.abs(o.wy - wy) < BLAST_R) smash(r, o, s, 99, x, sy(r, o.wy)); } // only the side it hit
    else if (Math.hypot(x - o.x, wy - o.wy) < BLAST_R) smash(r, o, 0, 99, o.x, sy(r, o.wy));
  }
  sfx.play('hit', 0.7, 0.55);
}
function stepWeapon(r, v) {
  const key = SHIPS[r.ship | 0].w, W_ = WEAPONS[key];
  r.ammo = Math.min(100, r.ammo + ENERGY_PER_SEC * DT);
  r.wcd = Math.max(0, r.wcd - DT);
  r.swing = Math.max(0, r.swing - DT);
  if (r.dashT <= 0 && r.wcd <= 0 && r.ammo >= W_.cost) {
    const tgt = inPath(r, W_.range);
    if (tgt) {
      r.ammo -= W_.cost; r.wcd = W_.cd;
      if (key === 'gun') { r.shots.push({ k: 'b', x: r.x, wy: r.dist + 40, side: r.step % 2 ? 1 : -1 }); sfx.play('graze', 1.7, 0.12); }
      else if (key === 'rocket') { r.shots.push({ k: 'r', x: r.x, wy: r.dist + 30, tx: tgt.k === 'post' ? tgt.x : r.x, v: 500 }); sfx.play('dash', 1.5, 0.3); }
      else {
        r.swing = 0.24; sfx.play('dash', 2, 0.4);
        for (const o of r.objs) {
          const d = SHIP_Y - sy(r, o.wy);
          if (d < -30 || d > SABER_REACH + 40) continue;
          if (o.k === 'post') { if (Math.hypot(r.x - o.x, d) < SABER_REACH + o.r) smash(r, o, 0, 99, o.x, sy(r, o.wy)); }
          else { if (r.x - o.gl < SABER_REACH) smash(r, o, 0, 99, clamp(r.x - 60, 0, o.gl), sy(r, o.wy)); if (o.gr - r.x < SABER_REACH) smash(r, o, 1, 99, clamp(r.x + 60, o.gr, W), sy(r, o.wy)); }
        }
      }
    }
  }
  for (const b of r.shots) {
    if (b.k === 'b') b.wy += (v + 2400) * DT;
    else { b.v = Math.min(2600, b.v + 5200 * DT); b.wy += (v + b.v) * DT; b.x += (b.tx - b.x) * Math.min(1, 8 * DT); }
    const hit = hitAt(r, b.x, b.wy);
    if (hit) {
      b.done = true;
      if (b.k === 'b') smash(r, hit[0], hit[1], 1, b.x, sy(r, b.wy));
      else explode(r, b.x, b.wy);
    } else if (b.wy - r.dist > SHIP_Y + 60) b.done = true;
  }
  r.shots = r.shots.filter((b) => !b.done);
}

/** one fixed simulation step. inp = { key: -1..1, dash: boolean } */
function step(r, inp) {
  if (r.over) { stepFx(r, 0, false); return; }
  r.t += DT; r.step++;
  const dashing = r.dashT > 0;
  const v = speedAt(r.dist) * (dashing ? 1.8 : 1);
  r.dist += v * DT;
  r.dpts += v * DT / 16;
  if (inp.dash && r.meter >= 100 && r.dashT <= 0) { r.dashT = 0.85; r.meter = 0; r.ready = false; r.fx.flash = 0.35; r.fx.flashCol = C.cyan; sfx.dash(); }
  if (r.dashT > 0) r.dashT = Math.max(0, r.dashT - DT);
  r.inv = Math.max(0, r.inv - DT);
  // steering: the target follows touch / mouse drag / keys; the ship chases it at a capped speed
  r.tx = clamp(r.tx + inp.key * 1800 * DT, 24, W - 24);
  const dx = clamp(r.tx - r.x, -2200 * DT, 2200 * DT);
  r.x += dx; r.vx = dx / DT;
  // generate ahead
  while (r.nextGen - r.dist < SHIP_Y + 260) genPattern(r);
  stepWeapon(r, v);
  const dashNow = r.dashT > 0, m = multOf(r.combo);
  // walls and posts
  for (const o of r.objs) {
    const y1 = sy(r, o.wy);
    if (o.k === 'wall') {
      const top = y1 - o.h, bot = y1;
      if (bot < SHIP_Y - 80 || top > SHIP_Y + 80) continue;
      const dl = dist2rect(r.x, SHIP_Y, 0, top, o.gl, bot), dr = dist2rect(r.x, SHIP_Y, o.gr, top, W, bot);
      for (let s = 0; s < 2; s++) {
        if (o.dead[s]) continue;
        const d = s ? dr : dl;
        if (d < SHIP_R && !dashNow) hurt(r);
        else if (d < SHIP_R + 26 && !o.gz[s]) { o.gz[s] = true; graze(r, r.x + (s ? 30 : -30), SHIP_Y - 30); }
      }
    } else if (o.k === 'post') {
      if (o.dead[0] || y1 < SHIP_Y - 100 || y1 > SHIP_Y + 100) continue;
      const d = Math.hypot(r.x - o.x, SHIP_Y - y1) - o.r;
      if (d < SHIP_R && !dashNow) hurt(r);
      else if (d < SHIP_R + 26 && !o.gz[0]) { o.gz[0] = true; graze(r, o.x, y1 - 40); }
    }
  }
  // cores and pickups (dash pulls them in)
  for (const it of r.items) {
    if (it.got) continue;
    const y = sy(r, it.wy);
    if (y < SHIP_Y - 190 || y > SHIP_Y + 60) continue;
    const reach = dashNow ? 150 : it.k === 'shield' ? 40 : 34;
    if (Math.hypot(r.x - it.x, SHIP_Y - y) < reach) {
      it.got = true;
      if (it.k === 'core') {
        r.ammo = Math.min(100, r.ammo + ENERGY_PER_CORE);
        r.combo++; r.cores++; r.maxCombo = Math.max(r.maxCombo, r.combo);
        const gain = 50 * multOf(r.combo) * (dashNow ? 2 : 1);
        r.pts += gain; if (!dashNow) r.meter = Math.min(100, r.meter + 3);
        if (multOf(r.combo) > m) { pop(r, r.x, SHIP_Y - 90, 'x' + multOf(r.combo), C.gold, 44); r.fx.flash = 0.18; r.fx.flashCol = C.gold; }
        else if (r.combo % 3 === 0) pop(r, it.x, y - 30, '+' + gain, C.cyan, 24);
        burst(r, it.x, y, 5, C.cyan, 220, 3, 0.35);
        sfx.core(r.combo);
      } else {
        if (r.hp < 3) { r.hp++; pop(r, r.x, SHIP_Y - 90, '+1 SHIELD', C.lime, 32); } else { r.pts += 300; pop(r, r.x, SHIP_Y - 90, '+300', C.lime, 32); }
        burst(r, it.x, y, 20, C.lime, 380, 4, 0.6); sfx.shield();
      }
    }
  }
  // cull what is behind the ship
  if (r.step % 60 === 0) {
    r.objs = r.objs.filter((o) => sy(r, o.wy) < H + 120);
    r.items = r.items.filter((it) => !it.got && sy(r, it.wy) < H + 80);
  }
  stepFx(r, v, true);
  if (r.t >= ROUND) r.over = 'time';
}
// visual effects (never feed back into the simulation); they keep playing for a moment after the run ends
function stepFx(r, v, emit) {
  const F = r.fx;
  F.shake = Math.max(0, F.shake - DT * 2.6); F.flash = Math.max(0, F.flash - DT * 1.6);
  if (emit && r.step % 2 === 0 && F.trail.length < 40) F.trail.push({ x: r.x, y: SHIP_Y + 16, life: 0.32 });
  if (emit && r.step % 3 === 0) {
    const k = SHIPS[r.ship | 0].trail;
    if (k === 'sparks') F.parts.length < 500 && F.parts.push({ x: r.x + (vr() - 0.5) * 12, y: SHIP_Y + 18, vx: (vr() - 0.5) * 120, vy: 160 + vr() * 160, life: 0.45, max: 0.45, col: vr() < 0.5 ? C.gold : '#ff8a3d', size: 4 });
    else if (k === 'snow') F.parts.length < 500 && F.parts.push({ x: r.x + (vr() - 0.5) * 30, y: SHIP_Y + 14, vx: (vr() - 0.5) * 60, vy: 90 + vr() * 90, life: 0.7, max: 0.7, col: '#e8fffb', size: 3 });
  }
  for (const t of F.trail) { t.life -= DT * 2; t.y += v * DT * 2; }
  F.trail = F.trail.filter((t) => t.life > 0);
  for (const p of F.parts) { p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.985; p.vy *= 0.985; p.life -= DT; }
  F.parts = F.parts.filter((p) => p.life > 0);
  for (const p of F.pops) { p.age += DT; p.y -= 60 * DT; }
  for (const b of F.blasts) b.age += DT;
  F.blasts = F.blasts.filter((b) => b.age < 0.35);
  F.pops = F.pops.filter((p) => p.age < 0.8);
}

// headless harness for tests (no rendering): same seed + same policy -> same score
function runHeadless(seed, policy, maxSteps = ROUND / DT + 5) {
  const r = newRun('free', seed);
  for (let i = 0; i < maxSteps && !r.over; i++) { const inp = { key: 0, dash: false }; policy(r, inp); step(r, inp); }
  return { score: scoreOf(r), over: r.over, t: r.t, cores: r.cores, grazes: r.grazes, hits: r.hits, maxCombo: r.maxCombo, broken: r.broken };
}

// ---------------------------------------------------------------- game flow
let state = 'menu';               // menu | play | over | paused
let run = null, last = null;      // last = the finished run's summary for the results screen
let gamesOver = 0, adBusy = false, hostPaused = false, looping = false;
let time = 0;                     // wall-ish clock for menu animation (advances in frame)
let keys = { l: false, r: false };
let steerId = null, steerX0 = 0, steerTx0 = 0, dashQueued = false;
let newBest = false, bestBefore = 0;

function startRun(mode) {
  const day = today();
  const seed = mode === 'daily' ? day * 7919 + 12345 : (Math.random() * 2147483647) | 0;
  run = newRun(mode, seed);
  run.art0 = save.art | 0;
  sceneCanvas(sceneOf(run.art0)); sceneCanvas(sceneOf(run.art0 + 1)); // built now, so the fade mid-run never hitches
  run.rivals = rivalsFor(day);
  steerId = null; dashQueued = false; newBest = false; bestBefore = save.best;
  music.reset();
  pg.message('level_started');
  state = 'play';
}
function finishRun() {
  const r = run, sc = scoreOf(r);
  save.plays++;
  newBest = sc > save.best;
  if (newBest) {
    save.best = sc; sfx.best();
    // one backdrop per run, even if a revive makes this screen come up twice
    if (!r.artDone) { r.artDone = true; r.artHit = true; save.art = (save.art | 0) + 1; }
  }
  // beating a jet's score unlocks and equips it (the best one, if a run clears several)
  save.tip = 2; // the how-to-play line has been seen
  let unlock = -1;
  if (newBest) for (const i of ORDER) if (bestBefore < SHIPS[i].need && sc >= SHIPS[i].need) unlock = i;
  if (unlock >= 0) { save.ship = unlock; view = unlock; }
  const day = today();
  if (r.mode === 'daily') {
    if (save.d.day !== day) save.d = { day, best: 0 };
    if (sc > save.d.best) save.d.best = sc;
  }
  persist();
  if (newBest) pg.score(sc); // only a new best is sent, so the leaderboard value always equals the saved best
  pg.message(r.over === 'time' ? 'level_completed' : 'level_failed');
  const rivals = r.rivals.map((x) => ({ ...x, you: false }));
  rivals.push({ n: 'YOU', s: sc, you: true });
  rivals.sort((a, b) => b.s - a.s);
  last = { score: sc, over: r.over, t: r.t, mode: r.mode, rank: rivals.findIndex((x) => x.you) + 1, rivals, cores: r.cores, grazes: r.grazes, maxCombo: r.maxCombo, hits: r.hits, unlock, art: r.artDone && r.art0 < SCENES.length ? r.art0 : -1, canRevive: r.over === 'dead' && !r.revived && r.t < ROUND - 8, tier: tierOf(sc) };
  state = 'over';
}
// leaving the results screen is the natural pause: ask Bridge for an ad break BEFORE the next screen starts (Bridge decides if one is shown)
function leaveRun() {
  gamesOver++;
  adBusy = true;
  return pg.interstitial().finally(() => { adBusy = false; });
}
async function revive() {
  if (adBusy || !last || !last.canRevive) return;
  adBusy = true;
  const ok = await pg.rewarded();
  adBusy = false;
  if (!ok) return;
  const r = run;
  r.revived = true; r.over = null; r.endT = 0; r.hp = 2; r.inv = 2.2; r.combo = 0;
  // clear the next stretch so the revive is not an instant death
  r.objs = r.objs.filter((o) => sy(r, o.wy) < SHIP_Y - 520 || sy(r, o.wy) > SHIP_Y + 100);
  save.plays--; // finishRun counts it again
  state = 'play';
}

// ---------------------------------------------------------------- drawing helpers
function text(s, x, y, size, color = '#fff', align = 'center', weight = 900) {
  ctx.font = `${weight} ${size}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(s, x + 3, y + 4);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
let buttons = [];
function button(id, label, x, y, w, h, opts = {}) {
  buttons.push({ id, x, y, w, h });
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  if (opts.ghost) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();
  } else {
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, opts.c1 || '#ff5fb0'); g.addColorStop(1, opts.c2 || '#c4136b');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
  text(label, x, y + 2, opts.size || 40, '#fff');
  if (opts.sub) text(opts.sub, x, y + h / 2 + 24, 22, '#9fb4ff', 'center', 700);
}

// ---------------------------------------------------------------- pixel-art backdrops
// Every new high score reveals the next scene (it fades in behind the run the moment the old best is passed). Scenes are built
// once from code at 180x320 and drawn as a still image, on dark palettes only, so they never compete with the walls and cores.
const ART_W = 180, ART_H = 320;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hash1 = (n, seed) => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise1(x, seed) { const i = Math.floor(x), f = x - i; return lerp(hash1(i, seed), hash1(i + 1, seed), f * f * (3 - 2 * f)); }
const fbm = (x, seed) => noise1(x, seed) * 0.6 + noise1(x * 2.1, seed + 1) * 0.28 + noise1(x * 4.3, seed + 2) * 0.12;
function paper(top) {
  const b = new Uint8Array(ART_W * ART_H);
  const set = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < ART_W && y < ART_H) b[y * ART_W + x] = c; };
  // v is a continuous shade on the palette; the fraction becomes an ordered dither, the classic pixel-art gradient
  const dith = (x, y, v) => { const i = Math.floor(v); set(x, y, clamp(i + (v - i > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0), 0, top)); };
  return {
    b, set, dith,
    sky(stops) { for (let y = 0; y < ART_H; y++) { let i = 0; while (i < stops.length - 2 && y > stops[i + 1][0]) i++; const [y0, v0] = stops[i], [y1, v1] = stops[i + 1]; const v = lerp(v0, v1, clamp((y - y0) / (y1 - y0), 0, 1)); for (let x = 0; x < ART_W; x++) dith(x, y, v); } },
    stars(rng, n, y0, y1, cols) { for (let i = 0; i < n; i++) set(rng() * ART_W, y0 + rng() * (y1 - y0), cols[Math.floor(rng() * cols.length)]); },
    ridge(base, amp, freq, seed, col, rim) { for (let x = 0; x < ART_W; x++) { const h = Math.floor(base - amp * fbm(x * freq, seed)); for (let y = h; y < ART_H; y++) set(x, y, col); if (rim !== undefined) set(x, h, rim); } },
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); },
    disc(cx, cy, r, f) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r; if (nx * nx + ny * ny <= 1) f(x, y, nx, ny); } },
  };
}
const SCENES = [
  { n: 'MOONRISE', pal: ['#090320', '#100729', '#180c38', '#221447', '#2e1e58', '#46396f', '#5e5184'], draw(p, r) {
    p.sky([[0, 0.4], [150, 2.1], [250, 3.8]]);
    p.stars(r, 90, 0, 200, [3, 4, 5]);
    p.disc(122, 126, 38, (x, y, nx, ny) => { const lit = Math.hypot(x - 108, y - 116) > 35; p.dith(x, y, lit ? 5.1 + 0.9 * (-nx - ny) * 0.5 + 0.5 * fbm(x * 0.3 + y * 0.2, 4) : 2.6); });
    p.ridge(252, 72, 0.028, 11, 2, 3); p.ridge(286, 56, 0.05, 23, 1, 2); p.ridge(320, 40, 0.08, 37, 0);
  } },
  { n: 'NIGHT CITY', pal: ['#07041a', '#0e0824', '#170d33', '#231343', '#331a52', '#4c2a55', '#6a4852'], draw(p, r) {
    p.sky([[0, 0.3], [140, 2], [230, 3.6]]);
    p.stars(r, 40, 0, 120, [3, 4]);
    p.disc(62, 142, 30, (x, y, nx, ny) => p.dith(x, y, 4.6 - ny * 0.7));
    const city = (base, wMin, wMax, hAmp, col, lit, odds) => { for (let x = -4; x < ART_W;) { const w = wMin + Math.floor(r() * (wMax - wMin)), top = base - Math.floor(r() * hAmp); p.rect(x, top, w, ART_H - top, col); if (r() < 0.3) p.rect(x + (w >> 1), top - 8, 1, 8, col); for (let wy = top + 3; wy < ART_H - 2; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (r() < odds) p.set(wx, wy, lit); x += w + (r() < 0.3 ? 2 : 0); } };
    city(205, 12, 24, 62, 2, 3, 0.45); city(255, 16, 30, 62, 1, 5, 0.22);
    p.rect(0, 306, ART_W, 14, 0);
  } },
  { n: 'RINGWORLD', pal: ['#060318', '#0c0725', '#141034', '#1e1b48', '#2b2a5e', '#3d3f74', '#58598a'], draw(p, r) {
    p.sky([[0, 0.1], [320, 1.2]]);
    p.stars(r, 150, 0, 320, [2, 3, 4, 5]);
    const cx = 92, cy = 150, rot = -0.36, ring = (front) => { for (let y = 40; y < 270; y++) for (let x = 0; x < ART_W; x++) { const dx = x - cx, dy = y - cy, u = dx * Math.cos(rot) - dy * Math.sin(rot), w = (dx * Math.sin(rot) + dy * Math.cos(rot)) / 0.26, d = Math.hypot(u, w); if (d > 66 && d < 104 && (w > 0) === front) { const band = fbm(d * 0.28, 8); if (band > 0.36) p.dith(x, y, 2 + band * 3.4); } } };
    ring(false);
    p.disc(cx, cy, 54, (x, y, nx, ny) => { const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), l = clamp(nx * 0.55 + ny * -0.42 + nz * 0.72, 0, 1), b = Math.sin((ny + nx * 0.36) * 11 + 3 * fbm(x * 0.05 + y * 0.09, 5)); p.dith(x, y, 0.8 + l * (3.6 + b * 0.8)); });
    ring(true);
  } },
  { n: 'DUSK DUNES', pal: ['#0c0519', '#160824', '#230c2e', '#351236', '#4a1b39', '#62293a', '#7a3b3d'], draw(p, r) {
    p.sky([[0, 0.4], [120, 2], [230, 4.4]]);
    p.stars(r, 34, 0, 110, [3, 4]);
    p.disc(90, 178, 50, (x, y, nx, ny) => { if (ny > 0.1 && Math.floor(y * 0.5 + ny * 3) % 3 === 0) return; p.dith(x, y, 4.9 - (ny + 1) * 0.7); });
    const dune = (base, amp, f, ph, top) => { for (let x = 0; x < ART_W; x++) { const h = base + amp * Math.sin(x * f + ph) + amp * 0.4 * Math.sin(x * f * 2.3 + ph * 2); for (let y = Math.floor(h); y < ART_H; y++) p.dith(x, y, top - clamp((y - h) / 44, 0, 1) * top + clamp(Math.cos(x * f + ph) * 0.8, 0, 0.8)); } };
    dune(226, 12, 0.031, 1.0, 3.2); dune(260, 15, 0.024, 3.4, 2.3); dune(296, 14, 0.04, 5.2, 1.4);
  } },
  { n: 'BLACK TIDE', pal: ['#040514', '#080b20', '#0d132e', '#141d3f', '#1e2c52', '#30436b', '#4f6587'], draw(p, r) {
    p.sky([[0, 0.2], [176, 3]]);
    p.stars(r, 110, 0, 165, [3, 4, 5]);
    p.disc(90, 100, 24, (x, y, nx, ny) => p.dith(x, y, 5.4 + (-ny - nx) * 0.3 - 1.3 * Math.max(0, fbm(x * 0.34, 3) * fbm(y * 0.34, 9) - 0.2)));
    p.ridge(177, 12, 0.07, 44, 1); // the far shore; the sea below paints over the rest
    for (let y = 176; y < ART_H; y++) { const d = (y - 176) / 144, wob = (noise1(y * 0.55, 6) - 0.5) * 26 * d, half = 7 + d * 22; for (let x = 0; x < ART_W; x++) { const near = Math.abs(x - 90 - wob) < half * (0.4 + 0.6 * noise1(x * 0.3 + y, 2)); p.dith(x, y, (near && y % 2 ? 4.2 - d * 1.2 : 2.5 - d * 2.1) + 0.4 * (noise1(x * 0.12 + y * 1.7, 4) - 0.5)); } }
    for (let i = 0; i < 90; i++) { const y = 180 + r() * 140, x = r() * ART_W; p.rect(x, y, 3 + r() * 10, 1, 3); }
  } },
  { n: 'AURORA', pal: ['#030c17', '#071421', '#0a1f2c', '#0e2d38', '#124240', '#1b5a4c', '#2c7560'], draw(p, r) {
    p.sky([[0, 0.3], [260, 1.8]]);
    p.stars(r, 100, 0, 220, [3, 4]);
    for (let x = 0; x < ART_W; x++) { const y0 = 92 + 44 * fbm(x * 0.022, 7), a = Math.pow(fbm(x * 0.13, 12), 1.5) * 5.2 + Math.pow(noise1(x * 0.5, 2), 3) * 1.3; for (let y = Math.floor(y0 - 30); y < y0 + 112; y++) { const f = y < y0 ? (y - y0 + 30) / 30 : Math.pow(1 - (y - y0) / 112, 1.6); p.dith(x, y, Math.max(p.b[y * ART_W + x], 1 + a * f)); } }
    p.ridge(262, 22, 0.04, 31, 1);
    for (let i = 0; i < 70; i++) { const x = r() * ART_W, b = 262 + r() * 54, h = 26 + r() * 26; for (let j = 0; j < h; j++) p.rect(x - (j >> 2) - ((j % 5) * 0.3), b - h + j, ((j >> 2) * 2) + 1, 1, 0); p.rect(x, b, 1, 4, 0); }
  } },
  { n: 'DEAD ORBIT', pal: ['#05040f', '#0a0a1c', '#10122b', '#191c3d', '#242d50', '#374566', '#54657f'], draw(p, r) {
    p.sky([[0, 0.1], [320, 0.9]]);
    p.stars(r, 170, 0, 320, [2, 3, 4, 5]);
    p.disc(16, 440, 228, (x, y, nx, ny) => { const edge = 1 - Math.hypot(nx, ny), land = fbm(x * 0.07 + y * 0.03, 16) > 0.5 ? 0.8 : 0; p.dith(x, y, clamp((1.2 + land) * (1 - edge * 3.4) + (edge < 0.012 ? 4.1 : 1), 0, 6)); });
    const s = 108, t = 128;
    p.rect(s - 3, t - 44, 6, 96, 4); p.rect(s - 3, t - 44, 2, 96, 5); p.rect(s - 8, t - 24, 16, 30, 3); p.rect(s - 8, t - 24, 4, 30, 5); p.rect(s - 6, t - 54, 12, 12, 3); p.rect(s - 6, t - 54, 3, 12, 5); p.rect(s - 5, t + 50, 10, 8, 3);
    const panel = (x, y, w, h) => { p.rect(x, y, w, h, 3); for (let i = 0; i < w; i += 6) p.rect(x + i, y, 1, h, 2); for (let j = 0; j < h; j += 5) p.rect(x, y + j, w, 1, 2); p.rect(x, y, w, 1, 5); };
    p.rect(s - 42, t - 11, 84, 2, 4); panel(s - 66, t - 25, 26, 30); panel(s + 40, t - 25, 26, 30); p.rect(s - 62, t - 6, 12, 11, 0); panel(s - 28, t + 22, 18, 20); p.rect(s - 10, t + 31, 7, 2, 4); p.set(s + 22, t + 9, 6); p.set(s - 3, t - 57, 6);
  } },
  { n: 'EMBER PEAK', pal: ['#0b0408', '#17070e', '#240a13', '#361018', '#4a161b', '#68241c', '#86371f'], draw(p, r) {
    p.sky([[0, 0.4], [150, 1.8], [240, 3.5]]);
    for (let y = 40; y < 180; y++) for (let x = 0; x < ART_W; x++) { const c = fbm(x * 0.05 + y * 0.02, 21) * fbm(y * 0.09 + x * 0.01, 3); if (c > 0.3) p.dith(x, y, 1 + (c - 0.3) * 8); }
    for (let i = 0; i < 70; i++) p.set(40 + r() * 100, 30 + r() * 120, 5 + (r() < 0.2 ? 1 : 0));
    const peakY = 134, ax = 92;
    for (let y = peakY; y < ART_H; y++) { const d = y - peakY, half = 11 + d * 0.62 + 7 * fbm(y * 0.13, 2), lo = ax - half, hi = ax + half + 3 * fbm(y * 0.2, 9); for (let x = Math.floor(lo); x <= hi; x++) p.dith(x, y, 0.6 + (x < ax ? 1 : 0.4) * (1 - d / 240) * 1.3); }
    p.disc(ax, peakY, 15, (x, y) => { if (y < peakY + 3) p.dith(x, y, 3.2 + (y - peakY + 9) * 0.25); });
    for (let y = peakY + 2; y < 262; y++) { const d = y - peakY, cx = ax + Math.sin(y * 0.1) * 9 + (noise1(y * 0.09, 14) - 0.5) * 24 * (d / 120), w = 1.2 + d * 0.022; for (let x = Math.floor(cx - w - 3); x <= cx + w + 3; x++) { const e = Math.abs(x + 0.5 - cx); p.dith(x, y, e < w ? 6.1 - d * 0.009 : Math.max(p.b[y * ART_W + x], 4 - (e - w) * 0.9)); } }
    p.ridge(278, 26, 0.06, 27, 1, 2); p.ridge(314, 26, 0.09, 8, 0);
  } },
];
const sceneOf = (a) => (a <= 0 ? -1 : (a - 1) % SCENES.length); // 0 high scores: the plain grid. After the last scene they loop.
const sceneCache = [];
function sceneCanvas(i) {
  if (i < 0) return null;
  if (sceneCache[i]) return sceneCache[i];
  const sc = SCENES[i], p = paper(sc.pal.length - 1);
  sc.draw(p, mulberry32(1000 + i));
  const c = document.createElement('canvas'); c.width = ART_W; c.height = ART_H;
  const g = c.getContext('2d'), im = g.createImageData(ART_W, ART_H), rgb = sc.pal.map((h) => [1, 3, 5].map((n) => parseInt(h.substr(n, 2), 16)));
  for (let n = 0; n < p.b.length; n++) { const q = rgb[p.b[n]]; im.data[n * 4] = q[0]; im.data[n * 4 + 1] = q[1]; im.data[n * 4 + 2] = q[2]; im.data[n * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  return (sceneCache[i] = c);
}
function drawBackground(dist, speed, dash, sceneA = -1, sceneB = -1, fade = 0) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0326'); g.addColorStop(1, '#1a0636');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  const a = sceneCanvas(sceneA), b = fade > 0 ? sceneCanvas(sceneB) : null;
  if (a) ctx.drawImage(a, 0, 0, W, H);
  if (b) { ctx.globalAlpha = fade; ctx.drawImage(b, 0, 0, W, H); ctx.globalAlpha = 1; }
  // perspective-less neon grid: lanes + scrolling cross lines
  ctx.strokeStyle = 'rgba(138,91,255,0.16)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 90) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  const off = dist % 90;
  for (let y = off; y < H; y += 90) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // far stars scroll slower
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const s of STARS) { const y = (s.y + dist * s.z) % H; ctx.fillRect(s.x, y, s.s, s.s * (1 + speed / 700)); }
  if (dash) { ctx.strokeStyle = 'rgba(55,247,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); for (let i = 0; i < 26; i++) { const x = (i * 83.3) % W, y = ((i * 211 + dist * 2.2) % H); ctx.moveTo(x, y); ctx.lineTo(x, y + 90); } ctx.stroke(); }
}
const STARS = (() => { const r = mulberry32(99); return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, z: 0.1 + r() * 0.25, s: 1 + r() * 2 })); })();

function neonRect(x0, y0, x1, y1, col) {
  if (x1 <= x0) return;
  ctx.fillStyle = '#16072e'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = 12; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1; ctx.lineWidth = 3.5; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}
function drawWorld(r) {
  for (const o of r.objs) {
    const y = sy(r, o.wy);
    if (y < -120 || y > H + 120) continue;
    if (o.k === 'wall') { if (!o.dead[0]) neonRect(-6, y - o.h, o.gl, y, C.mag); if (!o.dead[1]) neonRect(o.gr, y - o.h, W + 6, y, C.mag); }
    else if (!o.dead[0]) {
      ctx.beginPath(); ctx.arc(o.x, y, o.r, 0, TAU); ctx.fillStyle = '#16072e'; ctx.fill();
      ctx.strokeStyle = C.vio; ctx.globalAlpha = 0.3; ctx.lineWidth = 14; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.arc(o.x, y, 9, 0, TAU); ctx.fillStyle = C.vio; ctx.fill();
    }
  }
  const pulse = 1 + 0.12 * Math.sin(time * 9);
  for (const it of r.items) {
    if (it.got) continue;
    const y = sy(r, it.wy);
    if (y < -40 || y > H + 40) continue;
    if (it.k === 'core') {
      const s = 13 * pulse;
      ctx.beginPath(); ctx.moveTo(it.x, y - s); ctx.lineTo(it.x + s * 0.75, y); ctx.lineTo(it.x, y + s); ctx.lineTo(it.x - s * 0.75, y); ctx.closePath();
      ctx.fillStyle = C.cyan; ctx.globalAlpha = 0.25; ctx.lineWidth = 10; ctx.strokeStyle = C.cyan; ctx.stroke(); ctx.globalAlpha = 1; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(it.x, y, 22 * pulse, 0, TAU); ctx.strokeStyle = C.lime; ctx.lineWidth = 5; ctx.stroke();
      text('+', it.x, y + 1, 30, C.lime);
    }
  }
}
// the pixel sprites are built once per look and kept. mode: 0 paint, 1 dash (cyan), 2 locked (dark). bank -1/0/1 shades the wing that dips.
const SHIP_PX = 2, spriteCache = {};
const DASH_PAL = ['', '#f2ffff', '#9df6ff', '#37c8dd', '#ffffff', '#37f7ff', '#0d5a70', '#ffffff'], LOCK_PAL = ['', '#39405c', '#2b3049', '#20243a', '#39405c', '#20243a', '#14172a', '#39405c'];
function shipSprite(style, paint, mode, bank) {
  const key = `${style}.${paint}.${mode}.${bank}`;
  if (spriteCache[key]) return spriteCache[key];
  const S = SHIPS[style], pal = mode === 1 ? DASH_PAL : mode === 2 ? LOCK_PAL : S.paints[paint], engine = mode === 2 ? '#14172a' : '#2a2c3e';
  const half = S.art[0].length, c = document.createElement('canvas'); c.width = half * 2 + 2; c.height = S.art.length + 2;
  const g = c.getContext('2d'), ramp = 'SMH', cells = [];
  S.art.forEach((row, y) => { for (let i = 0; i < half; i++) { const ch = row[i]; if (ch !== '.') { cells.push([i, y, ch, -1]); cells.push([half * 2 - 1 - i, y, ch, 1]); } } });
  const filled = new Set(cells.map(([x, y]) => x + ',' + y));
  // a one-pixel rim in the paint colour, so even a dark jet stands out against every backdrop
  g.fillStyle = mode === 2 ? '#20243a' : mode === 1 ? '#37f7ff' : pal[5];
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!filled.has((x + dx) + ',' + (y + dy))) g.fillRect(x + dx + 1, y + dy + 1, 1, 1);
  for (const [x, y, ch, side] of cells) {
    let idx = 'HMSABCG'.indexOf(ch) + 1, col;
    if (ch === 'E') col = engine;
    else {
      if (bank && idx >= 1 && idx <= 3) { const n = clamp(ramp.indexOf(ch) + (side === bank ? -1 : 1), 0, 2); idx = 'HMS'.indexOf(ramp[n]) + 1; }
      col = pal[idx];
    }
    g.fillStyle = col; g.fillRect(x + 1, y + 1, 1, 1);
  }
  return (spriteCache[key] = c);
}
function drawShip(x, y, vx, alpha, style, paint, inv, dash, scale = 1, locked = false) {
  const S = SHIPS[style], col = shipCol(style, paint), blink = inv > 0 && Math.floor(inv * 14) % 2 ? 0.35 : 1;
  const lean = clamp(vx / 2600, -0.45, 0.45), bank = lean < -0.1 ? -1 : lean > 0.1 ? 1 : 0;
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  if (dash) { // each flight style has its own dash aura
    ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = style === 5 ? C.mag : C.cyan; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.stroke();
    if (style >= 4) { ctx.globalAlpha = alpha * 0.4; ctx.beginPath(); ctx.arc(0, 0, 50 + 4 * Math.sin(time * 20), 0, TAU); ctx.stroke(); }
  }
  if (!locked) { // a soft halo, so the jet is always the brightest thing on the screen
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 46); halo.addColorStop(0, col); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * blink * 0.26; ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.fill();
  }
  ctx.scale(1 - Math.abs(lean) * 0.4, 1); // banking narrows the jet; pixel art stays crisp without rotating
  const im = shipSprite(style, paint, locked ? 2 : dash ? 1 : 0, bank), w = im.width * SHIP_PX, h = im.height * SHIP_PX, top = -h / 2;
  ctx.globalAlpha = alpha * blink;
  if (!locked) { // flickering pixel exhaust from each engine
    for (let i = 0; i < S.jets.length; i++) for (const side of [-1, 1]) {
      const [jx, jy] = S.jets[i], len = 3 + ((Math.floor(time * 24) + i + (side > 0 ? 1 : 0)) % 3), fx = side * jx * SHIP_PX - SHIP_PX, fy = top + (jy + 1) * SHIP_PX;
      ctx.fillStyle = dash ? C.cyan : col; ctx.fillRect(fx - SHIP_PX, fy, SHIP_PX * 4, len * SHIP_PX);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(fx, fy, SHIP_PX * 2, (len - 1) * SHIP_PX);
    }
  }
  if (!locked) { // what the jet carries, so the weapon can be read at a glance
    const px = SHIP_PX, kind = S.w;
    if (kind === 'gun') for (const side of [-1, 1]) { ctx.fillStyle = '#2a2c3e'; ctx.fillRect(side * 6 * px - px, top + 4 * px, px * 2, 10 * px); ctx.fillStyle = col; ctx.fillRect(side * 6 * px - px, top + 3 * px, px * 2, px * 2); }
    else if (kind === 'rocket') for (const side of [-1, 1]) { ctx.fillStyle = '#e8e8f0'; ctx.fillRect(side * 7 * px - px * 1.5, top + 11 * px, px * 3, px * 8); ctx.fillStyle = col; ctx.fillRect(side * 7 * px - px * 1.5, top + 9 * px, px * 3, px * 3); }
    else { ctx.globalAlpha = alpha * blink * 0.35; ctx.fillStyle = col; ctx.fillRect(-px * 2.5, top - 18 * px, px * 5, 20 * px); ctx.globalAlpha = alpha * blink; ctx.fillRect(-px * 1.5, top - 18 * px, px * 3, 20 * px); ctx.fillStyle = '#fff'; ctx.fillRect(-px * 0.5, top - 17 * px, px, 19 * px); }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, -w / 2, top, w, h);
  ctx.restore();
}
function drawWeaponFx(r) {
  const col = shipCol(r.ship | 0, r.paint | 0);
  if (!r.over) for (const b of r.shots) {
    const y = sy(r, b.wy);
    if (b.k === 'b') { const x = b.x + b.side * 12; ctx.fillStyle = col; ctx.fillRect(x - 4, y - 14, 8, 28); ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 12, 4, 24); }
    else { ctx.fillStyle = '#ffb13d'; ctx.fillRect(b.x - 4, y + 16, 8, 20 + (Math.floor(time * 30) % 2) * 8); ctx.fillStyle = '#e8e8f0'; ctx.fillRect(b.x - 6, y - 14, 12, 30); ctx.fillStyle = col; ctx.fillRect(b.x - 6, y - 22, 12, 10); }
  }
  for (const b of r.fx.blasts) {
    const k = b.age / 0.35;
    ctx.globalAlpha = 0.8 * (1 - k); ctx.strokeStyle = '#ffb13d'; ctx.lineWidth = 16 * (1 - k) + 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 40 + BLAST_R * k, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (r.swing > 0 && !r.over) { // the blade sweeps across the front of the jet
    const k = 1 - r.swing / 0.24, a0 = -Math.PI * 0.95, a1 = -Math.PI * 0.05, head = lerp(a0, a1, k), tail = Math.max(a0, head - 1.5);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(r.x, SHIP_Y, SABER_REACH - 20, tail, head); ctx.globalAlpha = 0.45; ctx.strokeStyle = col; ctx.lineWidth = 26; ctx.stroke();
    ctx.beginPath(); ctx.arc(r.x, SHIP_Y, SABER_REACH - 20, tail, head); ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.stroke();
  }
}
// the ship's wake: P = [{x, y, life}] oldest first. dots / snow / sparks are particle trails, the rest are ribbons.
function drawTrail(P, kind, col, dash) {
  if (!P.length) return;
  const c1 = dash ? C.cyan : col;
  ctx.lineCap = 'round';
  if (kind === 'dots' || kind === 'snow' || kind === 'sparks') {
    for (const t of P) { ctx.globalAlpha = clamp(t.life * 2, 0, 1) * (kind === 'dots' ? 0.6 : 0.3); ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(t.x, t.y, (kind === 'dots' ? 6 : 4) * t.life * 3, 0, TAU); ctx.fill(); }
  } else {
    for (const o of kind === 'twin' ? [-9, 9] : [0]) {
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i];
        ctx.globalAlpha = clamp(b.life * 2.4, 0, 1) * 0.85;
        ctx.strokeStyle = kind === 'rainbow' ? `hsl(${(i * 14 + time * 240) % 360},100%,62%)` : c1;
        ctx.lineWidth = Math.max(2, 33 * b.life) * (kind === 'twin' ? 0.55 : 1);
        ctx.beginPath(); ctx.moveTo(a.x + o, a.y); ctx.lineTo(b.x + o, b.y); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}
function drawFx(r) {
  const F = r.fx, S = SHIPS[r.ship | 0];
  drawTrail(F.trail, S.trail, shipCol(r.ship | 0, r.paint | 0), r.dashT > 0);
  for (const p of F.parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  for (const p of F.pops) { ctx.globalAlpha = 1 - p.age / 0.8; text(p.txt, p.x, p.y, p.size, p.col); }
  ctx.globalAlpha = 1;
}
function nextRival(r) {
  const sc = scoreOf(r), list = r.rivals.slice().sort((a, b) => a.s - b.s);
  return list.find((x) => x.s > sc) || null;
}
function drawHud(r) {
  const sc = scoreOf(r), m = multOf(r.combo);
  const sh = ctx.createLinearGradient(0, 0, 0, 270); sh.addColorStop(0, 'rgba(6,2,26,0.88)'); sh.addColorStop(0.75, 'rgba(6,2,26,0.7)'); sh.addColorStop(1, 'rgba(6,2,26,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, 270);
  text(fmt(sc), W / 2, 104, 84, '#fff');
  const nr = nextRival(r);
  if (nr) text(`${nr.n} (BOT)  ${fmt(nr.s)}`, W / 2, 166, 24, '#9fb4ff', 'center', 700);
  else text('YOU LEAD THE BOTS', W / 2, 166, 24, C.lime, 'center', 700);
  // time bar
  const f = clamp(r.t / ROUND, 0, 1), bx = 100, bw = 520;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, 198, bw, 10);
  ctx.fillStyle = f > 0.8 ? C.mag : C.cyan; ctx.fillRect(bx, 198, bw * f, 10);
  text(String(Math.max(0, Math.ceil(ROUND - r.t))), W / 2, 238, 30, '#fff');
  // combo
  text('x' + m, 652, 104, 56, m >= 4 ? C.gold : '#fff', 'center');
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(612, 142, 80, 8);
  ctx.fillStyle = C.gold; ctx.fillRect(612, 142, 80 * (m >= 8 ? 1 : (r.combo % 6) / 6), 8);
  // shields
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(64 + i * 44, 1204, 15, 0, TAU);
    ctx.fillStyle = i < r.hp ? C.lime : 'rgba(255,255,255,0.12)'; ctx.fill();
  }
  // weapon energy, beside the shields
  const Wp = WEAPONS[SHIPS[r.ship | 0].w], armed = r.ammo >= Wp.cost, wcol = shipCol(r.ship | 0, r.paint | 0);
  text(Wp.label, 190, 1190, 18, armed ? wcol : 'rgba(255,255,255,0.45)', 'left', 800);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(190, 1206, 150, 12);
  ctx.fillStyle = armed ? wcol : 'rgba(255,255,255,0.35)'; ctx.fillRect(190, 1206, 150 * (r.ammo / 100), 12);
  // dash meter + button
  const ready = r.meter >= 100;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(40, 1244, 300, 14);
  ctx.fillStyle = ready ? C.lime : C.cyan; ctx.fillRect(40, 1244, 300 * (r.meter / 100), 14);
  ctx.beginPath(); ctx.arc(DASHB.x, DASHB.y, DASHB.r, 0, TAU);
  ctx.fillStyle = ready ? 'rgba(166,255,61,0.28)' : 'rgba(255,255,255,0.06)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = ready ? C.lime : 'rgba(255,255,255,0.3)'; ctx.stroke();
  text('DASH', DASHB.x, DASHB.y + 2, 28, ready ? C.lime : 'rgba(255,255,255,0.6)');
  button('pause', 'II', 56, 104, 72, 64, { ghost: true, size: 28 });
}
const DASHB = { x: 604, y: 1150, r: 82 };

// the logo: extruded 3D letters that swell toward the middle of the word. Built once, then just drawn.
let titleArt = null;
function buildTitle() {
  const sc = 2, TW = 720, TH = 300, c = document.createElement('canvas'); c.width = TW * sc; c.height = TH * sc;
  const g = c.getContext('2d'); g.scale(sc, sc);
  const word = 'VOLTLANE', n = word.length, font = (px) => `900 ${px}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let sizes = [...word].map((_, i) => { const u = (i - (n - 1) / 2) / ((n - 1) / 2); return 0.84 + 0.46 * (1 - u * u); });
  const widthAt = (k) => sizes.reduce((sum, s, i) => { g.font = font(s * k); return sum + g.measureText(word[i]).width; }, 0);
  const k = 100 * 650 / widthAt(100); // whatever font the device has, the word fills the same width
  sizes = sizes.map((s) => s * k);
  let x = TW / 2 - widthAt(1) / 2;
  const letters = sizes.map((px, i) => { g.font = font(px); const w = g.measureText(word[i]).width, L = { ch: word[i], px, x: x + w / 2, i }; x += w; return L; });
  const vx = TW / 2, vy = 245, cy = 135, depth = 22;
  // outer letters first, so the middle sits in front of them
  letters.sort((a, b) => Math.abs(b.i - (n - 1) / 2) - Math.abs(a.i - (n - 1) / 2));
  for (const L of letters) {
    g.font = font(L.px);
    for (let d = depth; d >= 1; d--) { // the side walls, receding to a point below the middle
      const t = d / depth, lx = L.x + (vx - L.x) * t * 0.14, ly = cy + (vy - cy) * t * 0.5;
      g.fillStyle = `rgb(${Math.round(lerp(150, 30, t))},${Math.round(lerp(26, 10, t))},${Math.round(lerp(150, 70, t))})`;
      g.fillText(L.ch, lx, ly);
    }
    const top = cy - L.px * 0.42, bot = cy + L.px * 0.42, f = g.createLinearGradient(0, top, 0, bot), lane = L.i >= 4;
    f.addColorStop(0, '#ffffff'); f.addColorStop(0.55, lane ? '#7df6ff' : '#f2f4ff'); f.addColorStop(1, lane ? '#ff4fa8' : '#58d8ff');
    g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = 'rgba(40,8,70,0.9)'; g.strokeText(L.ch, L.x, cy);
    g.fillStyle = f; g.fillText(L.ch, L.x, cy);
  }
  return c;
}
function drawTitle(y) {
  if (!titleArt) titleArt = buildTitle();
  const z = 1 + Math.sin(time * 1.6) * 0.012;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(titleArt, W / 2 - 360 * z, y - 135 * z, 720 * z, 300 * z);
}

// the jet the menu is showing
let view = 0;
function viewShip(d) {
  view = ORDER[(ORDER.indexOf(view) + d + SHIPS.length) % SHIPS.length];
  if (shipUnlocked(view)) { save.ship = view; persist(); }
}
function chevron(id, x, y, dir) {
  buttons.push({ id, x, y, w: 120, h: 220 });
  ctx.beginPath(); ctx.moveTo(x - dir * 13, y - 34); ctx.lineTo(x + dir * 13, y); ctx.lineTo(x - dir * 13, y + 34);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
// the jet floats on its own in the middle of the screen; only what you can act on is drawn around it
function drawHangar() {
  const S = SHIPS[view], ok = shipUnlocked(view), pt = paintOf(view), col = shipCol(view, pt), cx = W / 2, cy = 590 + Math.sin(time * 2.2) * 7;
  drawShip(cx, cy, Math.sin(time * 1.6) * 300, 1, view, pt, 0, false, 3.5, !ok);
  chevron('prev', 70, 590, -1);
  chevron('next', W - 70, 590, 1);
  text(S.n, cx, 765, 46, ok ? col : '#7d86a8');
  text(ok ? `${WEAPONS[S.w].label}   -   ${S.paints[pt][0]}` : `${WEAPONS[S.w].label}   -   SCORE ${fmt(S.need)} TO UNLOCK`, cx, 809, 20, ok ? '#9fb4ff' : '#ff8ab4', 'center', 700);
  text(`${ORDER.indexOf(view) + 1} / ${SHIPS.length}`, cx, 440, 20, 'rgba(159,180,255,0.7)', 'center', 700);
  if (ok) for (let i = 0; i < 3; i++) { // three paint jobs for this jet, free once the jet is unlocked
    const sx = cx + (i - 1) * 92, sy2 = 878;
    buttons.push({ id: 'paint' + i, x: sx, y: sy2, w: 88, h: 76 });
    ctx.beginPath(); ctx.arc(sx, sy2, 21, 0, TAU); ctx.fillStyle = S.paints[i][2]; ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy2, 21, -Math.PI * 0.75, Math.PI * 0.25); ctx.fillStyle = S.paints[i][4]; ctx.fill();
    if (i === pt) { ctx.beginPath(); ctx.arc(sx, sy2, 29, 0, TAU); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
  }
}
function drawMenu() {
  // keep the backdrop, but quietly
  const dim = ctx.createLinearGradient(0, 0, 0, H); dim.addColorStop(0, 'rgba(4,2,16,0.72)'); dim.addColorStop(0.5, 'rgba(4,2,16,0.5)'); dim.addColorStop(1, 'rgba(4,2,16,0.8)');
  ctx.fillStyle = dim; ctx.fillRect(0, 0, W, H);
  drawTitle(205);
  text('60-SECOND SCORE ATTACK', W / 2, 372, 22, '#9fb4ff', 'center', 700);
  if (location.hash === '#art') return; // store-art render: title only, no buttons
  const day = today(), tier = tierOf(save.best);
  const db = save.d.day === day ? save.d.best : 0;
  text(tier[0], 40, 54, 26, tier[2], 'left');
  text(`BEST ${fmt(save.best)}`, 40, 88, 22, '#fff', 'left', 800);
  drawHangar();
  const secs = Math.floor(86400 - (Date.now() / 1000) % 86400), hh = String(Math.floor(secs / 3600)).padStart(2, '0'), mm = String(Math.floor(secs / 60) % 60).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  button('daily', 'DAILY RUN', W / 2, 1020, 520, 112, { size: 50 });
  text(`${db ? `TODAY ${fmt(db)}   -   ` : ''}NEW TRACK IN ${hh}:${mm}:${ss}`, W / 2, 1097, 20, '#9fb4ff', 'center', 700);
  button('free', 'FREE RUN', W / 2, 1180, 300, 76, { ghost: true, size: 30 });
}
function drawOver() {
  const L = last;
  ctx.fillStyle = 'rgba(4,2,16,0.8)'; ctx.fillRect(0, 0, W, H);
  text(L.over === 'time' ? "TIME'S UP" : 'WRECKED', W / 2, 150, 66, L.over === 'time' ? C.cyan : C.mag);
  text(fmt(L.score), W / 2, 290, 150, '#fff');
  text(newBest ? 'NEW BEST!' : `BEST ${fmt(save.best)}`, W / 2, 390, 36, newBest ? C.lime : '#9fb4ff');
  text(L.tier[0], W / 2, 438, 32, L.tier[2]);
  text(`CORES ${L.cores}   GRAZES ${L.grazes}   MAX COMBO ${L.maxCombo}`, W / 2, 490, 22, 'rgba(255,255,255,0.75)', 'center', 700);
  // the ladder vs the daily rival bots
  text(`RANK ${L.rank} OF ${L.rivals.length}`, W / 2, 548, 30, C.gold);
  L.rivals.forEach((x, i) => {
    const y = 600 + i * 46;
    if (x.you) { ctx.fillStyle = 'rgba(55,247,255,0.16)'; ctx.fillRect(150, y - 21, 420, 42); }
    text(`${i + 1}  ${x.n}${x.you ? '' : ' (BOT)'}`, 170, y, 26, x.you ? C.cyan : '#cfd6ff', 'left', 800);
    text(fmt(x.s), 550, y, 26, x.you ? C.cyan : '#cfd6ff', 'right', 800);
  });
  if (L.unlock >= 0) { // a new rank: its flight style is unlocked and equipped
    drawShip(W / 2 - 175, 832, 0, 1, L.unlock, paintOf(L.unlock), 0, false, 1);
    text(`NEW JET  ${SHIPS[L.unlock].n}`, W / 2 - 135, 832, 30, shipCol(L.unlock, paintOf(L.unlock)), 'left');
  }
  if (L.art >= 0) text(`NEW BACKGROUND  ${SCENES[L.art].n}`, W / 2, L.unlock >= 0 ? 866 : 838, L.unlock >= 0 ? 20 : 28, '#b9a6ff', 'center', 800);
  if (pg.rewardedOk() && L.canRevive) { // hidden when the platform has no rewarded ads
    button('revive', '▶ REVIVE', W / 2, 920, 420, 100, { size: 40, c1: '#7dff9a', c2: '#18a85a' });
    text('watch an ad to keep going', W / 2, 988, 22, '#9fb4ff', 'center', 700);
    button('retry', 'RETRY', W / 2, 1090, 320, 90, { size: 42 });
    button('menu', 'MENU', W / 2, 1195, 240, 70, { ghost: true, size: 30 });
  } else {
    button('retry', 'RETRY', W / 2, 960, 360, 110, { size: 52 });
    button('menu', 'MENU', W / 2, 1090, 260, 80, { ghost: true, size: 34 });
  }
}
function drawPaused() {
  ctx.fillStyle = 'rgba(4,2,16,0.75)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, 480, 90, '#fff');
  button('resume', 'RESUME', W / 2, 700, 360, 110, { size: 52 });
  button('menu', 'MENU', W / 2, 840, 260, 84, { ghost: true, size: 34 });
}

// mute button, top left beside the pause button, on every screen: a speaker that is crossed out while muted
function drawMute() {
  if (location.hash === '#art') return;
  const x = state === 'menu' ? W - 60 : 142, y = state === 'menu' ? 70 : 104, off = !audioOn();
  button('mute', '', x, y, 72, 64, { ghost: true });
  ctx.save();
  ctx.fillStyle = off ? 'rgba(255,255,255,0.55)' : '#fff'; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 20, y - 8); ctx.lineTo(x - 11, y - 8); ctx.lineTo(x - 1, y - 18); ctx.lineTo(x - 1, y + 18); ctx.lineTo(x - 11, y + 8); ctx.lineTo(x - 20, y + 8); ctx.closePath(); ctx.fill();
  if (off) { ctx.beginPath(); ctx.moveTo(x + 8, y - 10); ctx.lineTo(x + 22, y + 10); ctx.moveTo(x + 22, y - 10); ctx.lineTo(x + 8, y + 10); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(x + 2, y, 12, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 2, y, 22, -0.9, 0.9); ctx.stroke(); }
  ctx.restore();
}

// ---------------------------------------------------------------- loop
function draw() {
  ctx.setTransform(bs, 0, 0, bs, 0, 0);
  buttons = [];
  const r = run;
  const sh = r && state !== 'menu' ? r.fx.shake : 0;
  ctx.save();
  if (sh > 0) ctx.translate((vr() - 0.5) * 26 * sh, (vr() - 0.5) * 26 * sh);
  if (r && state !== 'menu') {
    drawBackground(r.dist, speedAt(r.dist), r.dashT > 0, sceneOf(r.art0), sceneOf(r.art0 + 1), r.artFade);
    drawWorld(r);
    drawFx(r);
    drawWeaponFx(r);
    if (r.over !== 'dead' && state !== 'over') drawShip(r.x, SHIP_Y, r.vx, 1, r.ship, r.paint, r.inv, r.dashT > 0);
    if (r.fx.flash > 0) { ctx.globalAlpha = r.fx.flash * 0.5; ctx.fillStyle = r.fx.flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  } else {
    drawBackground(time * 50, 200, false, sceneOf(save.art | 0));
  }
  ctx.restore();
  if (state === 'play') drawHud(r);
  else if (state === 'menu') drawMenu();
  else if (state === 'over') drawOver();
  else if (state === 'paused') drawPaused();
  drawMute();
  if (state === 'play' && r.t < 1.2) text('GO!', W / 2, 600, 120, C.gold);
  if (state === 'play' && r.t < 4 && save.tip !== 2) { text('DRAG TO STEER   -   TAP DASH WHEN READY', W / 2, 700, 22, 'rgba(159,180,255,0.9)', 'center', 700); text('YOUR WEAPON FIRES AT WHATEVER IS IN YOUR WAY', W / 2, 736, 22, 'rgba(159,180,255,0.9)', 'center', 700); }
}

let acc = 0, firstFrame = true;
function frame(now) {
  if (hostPaused) { looping = false; return; }
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now; time += dt;
  if (run && run.artHit) run.artFade = Math.min(1, run.artFade + dt / 2.5);
  if (state === 'play') {
    acc += dt;
    let n = 0;
    const key = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    while (acc >= DT && n < 12) {
      step(run, { key, dash: dashQueued });
      dashQueued = false; acc -= DT; n++;
    }
    if (n >= 12) acc = 0;
    // passing the old best fades the next backdrop in behind the run (a first-ever run has no old best to pass)
    if (!run.over && !run.artHit && bestBefore > 0 && scoreOf(run) > bestBefore) { run.artHit = true; pop(run, W / 2, 320, 'NEW HIGH SCORE', C.lime, 34); }
    music.update(run.combo);
    // the run is over: let the explosion / finish play for a moment, then show the results
    if (run.over) { run.endT = (run.endT || 0) + dt; if (run.endT > (run.over === 'dead' ? 0.9 : 0.4)) finishRun(); }
  } else acc = 0;
  if (state !== 'play') music.stop();
  draw();
  if (firstFrame) {
    firstFrame = false;
    // nothing to download: the menu is playable as soon as it is drawn
    pg.message('game_ready'); // the menu is drawn and the player can interact
  }
  requestAnimationFrame(frame);
}
let lastNow = performance.now();
function startLoop() {
  if (looping) return;
  looping = true;
  lastNow = performance.now();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input (per pointer: one finger steers, another can DASH)
const toLogical = (e) => { const b = cvs.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
async function onButton(id) {
  sfx.unlock();
  if (id === 'mute') { sfx.setMute(!userMute); sfx.click(); return; }
  sfx.click();
  if (adBusy) return;
  if (id === 'revive') { revive(); return; }
  if (state === 'over' && (id === 'retry' || id === 'menu')) await leaveRun();
  if (id === 'daily') startRun('daily');
  else if (id === 'free') startRun('free');
  else if (id === 'retry') startRun(last ? last.mode : 'free');
  else if (id === 'menu') { state = 'menu'; run = null; view = curShip(); }
  else if (id === 'prev') viewShip(-1);
  else if (id === 'next') viewShip(1);
  else if (id.startsWith('paint')) { if (!Array.isArray(save.paint)) save.paint = []; save.paint[view] = +id.slice(5); save.ship = view; persist(); }
  else if (id === 'pause') state = 'paused';
  else if (id === 'resume') state = 'play';
}
cvs.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  const [x, y] = toLogical(e);
  if (state === 'play' && Math.hypot(x - DASHB.x, y - DASHB.y) < DASHB.r + 24) {
    if (run.meter >= 100) dashQueued = true; else sfx.deny();
    return;
  }
  for (const b of buttons) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2) { onButton(b.id); return; }
  if (state === 'play' && steerId === null) { steerId = e.pointerId; steerX0 = x; steerTx0 = run.tx; cvs.setPointerCapture?.(e.pointerId); }
});
cvs.addEventListener('pointermove', (e) => {
  if (state !== 'play' || e.pointerId !== steerId) return;
  const [x] = toLogical(e);
  run.tx = clamp(steerTx0 + (x - steerX0) * 1.3, 24, W - 24);
});
const endPointer = (e) => { if (e.pointerId === steerId) steerId = null; };
cvs.addEventListener('pointerup', endPointer);
cvs.addEventListener('pointercancel', endPointer);
addEventListener('keydown', (e) => {
  if (state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { sfx.unlock(); sfx.click(); viewShip(e.code === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.l = true; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.r = true; e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault(); sfx.unlock();
    if (state === 'play') { if (run.meter >= 100) dashQueued = true; else sfx.deny(); }
    else if (state === 'menu') onButton('daily');
    else if (state === 'over') onButton('retry');
    else if (state === 'paused') state = 'play';
  }
  if (e.code === 'KeyP') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; }
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.l = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.r = false;
});

// ---------------------------------------------------------------- platform lifecycle
// Pause and audio come from Bridge events only (no Page Visibility API, no blur/focus). Paused = nothing runs: the loop
// (simulation AND drawing) stops and audio is suspended; un-pausing restarts the loop with a fresh clock. Bridge also pauses
// and mutes the game while an ad is open.
function bindPlatform() {
  B.platform.on(B.EVENT_NAME.AUDIO_STATE_CHANGED, (on) => { sfx.setHost(!!on); });
  B.platform.on(B.EVENT_NAME.PAUSE_STATE_CHANGED, (paused) => {
    if (paused) {
      hostPaused = true;
      if (state === 'play') state = 'paused'; // come back to the pause screen, not mid-run
      persist();
      if (sfx.ctx) sfx.ctx.suspend();
    } else {
      hostPaused = false;
      if (sfx.ctx) sfx.ctx.resume();
      startLoop();
    }
  });
}

// Bridge first (it must finish initialising before the game starts), then read the save once, then run.
async function boot() {
  if (B) { try { await B.initialize(); pg.ready = true; } catch { pg.ready = false; } }
  if (pg.ready) {
    try { hostAudio = !!B.platform.isAudioEnabled; } catch { /* keep sound on */ }
    try { LANG = B.platform.language || 'en'; } catch { /* default */ } // read once; the game is English-only for now
    try { bindPlatform(); } catch { /* events unavailable */ }
  }
  const cloud = pg.ready ? await pg.load() : null;
  if (cloud && typeof cloud.best === 'number' && cloud.best >= save.best) { Object.assign(save, cloud); if (!save.d) save.d = { day: 0, best: 0 }; delete save.d.ghost; } // older saves carried a ghost replay
  view = curShip();
  userMute = !!save.mute;
  loaded = true;
  if (dirty) { dirty = false; persist(); }
  startLoop();
}
boot();
window.__volt = { get state() { return state; }, get run() { return run; }, get last() { return last; }, get save() { return save; }, startRun, runHeadless, step, newRun, scoreOf, speedAt, buildTitle, WEAPONS, SCENES, sceneCanvas, shipSprite, SHIPS };
