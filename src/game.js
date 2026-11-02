// game.js
// Main entry + game loop. Wires everything together:
//   handTracking (camera + landmarks)  ->  gestures (interpret)  ->
//   stations (apply rules + draw), with a small state machine for which
//   station is active and gesture routing rules from the spec.
//
// This is the only module that imports all the others; the rest stay decoupled.

import { CONFIG, GESTURES, STATIONS, STATION_ORDER } from "./config.js";
import { HandTracker } from "./handTracking.js";
import { GestureDetector } from "./gestures.js";
import { createStations, createEmptyPizza } from "./stations.js";

// Human-readable station names for the HUD (AC#4 shows the current station).
const STATION_LABELS = {
  [STATIONS.ORDER]: "Order",
  [STATIONS.TOPPING]: "Topping",
  [STATIONS.BAKE]: "Bake",
  [STATIONS.CUT]: "Cut",
  [STATIONS.SERVE]: "Serve",
};

class Game {
  constructor() {
    this.video = document.getElementById("camera");
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d");
    this.statusEl = document.getElementById("status");
    this.stationLabel = document.getElementById("station-label");

    this.tracker = new HandTracker(this.video);
    this.gestures = new GestureDetector();
    this.stations = createStations();

    // --- shared game state --------------------------------------------------
    this.currentStation = STATIONS.ORDER; // start at the Order station
    this.order = null;                     // set when the order is taken (AC#2)
    this.pizza = createEmptyPizza();       // the single in-progress pizza

    this._lastFrameMs = 0;
    this._running = false;
  }

  async start() {
    // AC#1: bring up the camera + recognizer, then run the loop.
    this.statusEl.textContent = "status: requesting camera…";
    try {
      await this.tracker.init();
    } catch (err) {
      // Permission denied, no camera, or model load failure -- surface it.
      this.statusEl.textContent = `status: camera error — ${err.message}`;
      throw err;
    }

    this._enterStation(this.currentStation);
    this._running = true;
    this.statusEl.textContent =
      "status: running — hold a thumbs left/right to change station";
    requestAnimationFrame((t) => this._loop(t));
  }

  _loop(nowMs) {
    if (!this._running) return;
    const dt = this._lastFrameMs ? (nowMs - this._lastFrameMs) / 1000 : 0;
    this._lastFrameMs = nowMs;

    // 1) Hand tracking -> frame with landmarks + cursor (AC#1) + built-in label.
    const frame = this.tracker.detect(nowMs);

    // 2) Interpret gestures from the frame. The built-in gesture label now
    //    rides along on the frame (GestureRecognizer); gestures.js reads it.
    const gesture = this.gestures.update(frame, frame.builtInGesture);

    // 3) Station switching (AC#4/#5), gated by the hold logic in gestures.js.
    this._handleStationSwitch(gesture);

    // 4) Route gestures to the active station, honoring the thumbs-up rule.
    const station = this.stations[this.currentStation];
    const gameCtx = {
      order: this.order,
      pizza: this.pizza,
      ctx: this.ctx,
      cursor: frame.cursor,
      gesture: this._routeGesture(gesture),
      dt,
    };

    // 5) Update + render.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    station.update(gameCtx);
    station.render(gameCtx);
    this._renderCursor(frame.cursor); // AC#1: always show where the hand is.

    requestAnimationFrame((t) => this._loop(t));
  }

  /**
   * AC#3: thumbs up only counts at Order and Serve. Strip it everywhere else so
   * stations never see a thumbs-up they should ignore.
   */
  _routeGesture(gesture) {
    const thumbsUpAllowed =
      this.currentStation === STATIONS.ORDER ||
      this.currentStation === STATIONS.SERVE;
    if (!thumbsUpAllowed && gesture.thumbsUp) {
      return { ...gesture, thumbsUp: false, active: GESTURES.NONE };
    }
    return gesture;
  }

  /**
   * AC#4: held thumbs right -> next station, thumbs left -> previous.
   * AC#5: quick flicks don't fire (the gesture layer only reports *held*).
   * Direction is already corrected to the player's POV in gestures.js.
   */
  _handleStationSwitch(gesture) {
    if (gesture.thumbsRightHeld) this._goToStation(+1);
    else if (gesture.thumbsLeftHeld) this._goToStation(-1);
  }

  _goToStation(delta) {
    const i = STATION_ORDER.indexOf(this.currentStation);
    const next = i + delta;
    if (next < 0 || next >= STATION_ORDER.length) return; // clamp at the ends
    const target = STATION_ORDER[next];
    this.stations[this.currentStation].onExit(this._bareCtx());
    this.currentStation = target;
    this._enterStation(target);
  }

  _enterStation(id) {
    // AC#4: reflect the current station in the HUD, with position (e.g. 2/5).
    const index = STATION_ORDER.indexOf(id) + 1;
    const name = STATION_LABELS[id] || id;
    this.stationLabel.textContent =
      `station: ${name} (${index}/${STATION_ORDER.length})`;
    this.stations[id].onEnter(this._bareCtx());
  }

  /** Minimal context for enter/exit hooks (no per-frame gesture/cursor). */
  _bareCtx() {
    return {
      order: this.order,
      pizza: this.pizza,
      ctx: this.ctx,
      cursor: null,
      gesture: this.gestures._empty(),
      dt: 0,
    };
  }

  _renderCursor(cursor) {
    if (!cursor) return;
    // AC#1: draw the hand cursor at the index fingertip. A ring + center dot
    // reads clearly over the dimmed camera feed.
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(224,164,88,0.95)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(224,164,88,0.95)";
    ctx.fill();
    ctx.restore();
  }
}

// Gate startup behind an explicit click so the browser reliably grants camera
// + autoplay permission (AC#1). The button lives in index.html.
window.addEventListener("DOMContentLoaded", () => {
  const game = new Game();
  const startBtn = document.getElementById("start");
  const statusEl = document.getElementById("status");

  const boot = () => {
    if (startBtn) startBtn.disabled = true;
    game.start().catch((err) => {
      if (startBtn) startBtn.disabled = false;
      if (statusEl) statusEl.textContent = `status: error — ${err.message}`;
      // eslint-disable-next-line no-console
      console.error(err);
    });
  };

  if (startBtn) {
    startBtn.addEventListener("click", boot, { once: false });
  } else {
    // No button in the DOM -- fall back to auto-start.
    boot();
  }
  void CONFIG;
});
