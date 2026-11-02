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
import {
  createStations,
  createEmptyPizza,
  formatOrderSummary,
  pickJob,
  needsBuildJob,
  shouldOpenTicket,
  advanceOven,
  findOvenJob,
} from "./stations.js";

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
    this.ticketEl = document.getElementById("ticket");
    this.ovenEl = document.getElementById("oven");
    this.ratingEl = document.getElementById("rating");

    this.tracker = new HandTracker(this.video);
    this.gestures = new GestureDetector();
    this.stations = createStations();

    // --- shared game state --------------------------------------------------
    // One job is one ticket plus its pizza. A second job is added once a
    // started pizza is in the oven, so the next order can begin while it bakes.
    this.currentStation = STATIONS.ORDER; // start at the Order station
    this.jobs = [createJob()];
    this._focus = this.jobs[0]; // the job the current station visit is showing

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

    // 3) The oven keeps baking on every station, including this one. A served
    //    pizza is skipped so the clock stops when the rating is given.
    for (const job of this.jobs) {
      if (!job.rating) advanceOven(job.pizza, dt);
    }

    // 4) Station switching (AC#4/#5), gated by the hold logic in gestures.js.
    this._handleStationSwitch(gesture);

    // 5) Route gestures to the pizza this visit is showing. Focus is chosen
    //    when the station is entered and stays put, so pulling a pizza out or
    //    serving it does not swap the screen to a different job mid-visit.
    const station = this.stations[this.currentStation];
    const focus = this._focus;
    const gameCtx = this._jobCtx(focus, {
      cursor: frame.cursor,
      gesture: this._routeGesture(gesture),
      dt,
    });

    // 6) Update + render.
    // AC#2: the station assigns gameCtx.order (it starts null, so unlike the
    // pizza it cannot be mutated in place). Copy it back onto this job.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    station.update(gameCtx);
    if (gameCtx.order !== focus.order) focus.order = gameCtx.order;
    // AC#13: ServeStation assigns ctx.rating the same way.
    if (gameCtx.rating !== focus.rating) focus.rating = gameCtx.rating;
    this._syncHud();
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
    this.stations[this.currentStation].onExit(this._jobCtx(this._focus, {}));
    this.currentStation = target;
    this._enterStation(target);
  }

  _enterStation(id) {
    // AC#4: reflect the current station in the HUD, with position (e.g. 2/5).
    const index = STATION_ORDER.indexOf(id) + 1;
    const name = STATION_LABELS[id] || id;
    this.stationLabel.textContent =
      `station: ${name} (${index}/${STATION_ORDER.length})`;
    // A fresh ticket before we pick a focus: the next order, or a reset after
    // the last pizza was served. Not when walking to Topping.
    if (shouldOpenTicket(this.jobs, id)) this.jobs.push(createJob());
    this._focus = pickJob(this.jobs, id);
    // Bake's onEnter is what puts the pizza in the oven. Do that first, then
    // open the next ticket, so this visit stays on the pizza that just went in.
    this.stations[id].onEnter(this._jobCtx(this._focus, {}));
    if (id === STATIONS.BAKE && needsBuildJob(this.jobs)) this.jobs.push(createJob());
    this._syncHud();
  }

  /**
   * Context for one job. alsoBaking is true when a different pizza is in the
   * oven, so the Order station can say the next ticket is the one to take.
   */
  _jobCtx(job, extras) {
    const oven = findOvenJob(this.jobs);
    return {
      order: job.order,
      rating: job.rating,
      pizza: job.pizza,
      alsoBaking: !!(oven && oven !== job),
      ctx: this.ctx,
      cursor: extras.cursor ?? null,
      gesture: extras.gesture ?? this.gestures._empty(),
      dt: extras.dt ?? 0,
    };
  }

  /** Ticket, oven clock, and rating, from whichever jobs currently own them. */
  _syncHud() {
    const focus = this._focus;
    const oven = findOvenJob(this.jobs);
    const ticketOrder = (focus && focus.order) || null;
    this._showTicket(ticketOrder);
    this._showOven(oven, ticketOrder);
    this._showRating(focus);
  }

  /**
   * AC#2: the HUD ticket stays up after the player leaves the Order station,
   * same place the station name is shown. It follows the pizza this visit is
   * showing. The canvas ticket is drawn by OrderStation.
   */
  _showTicket(order) {
    if (!this.ticketEl) return;
    if (!order) {
      this.ticketEl.hidden = true;
      this.ticketEl.textContent = "";
      return;
    }
    this.ticketEl.hidden = false;
    this.ticketEl.textContent = formatOrderSummary(order);
  }

  /**
   * Bake time you can read from any station. When the ticket on screen is a
   * different order, the baking order is written out here too.
   */
  _showOven(oven, ticketOrder) {
    if (!this.ovenEl) return;
    if (!oven) {
      this.ovenEl.hidden = true;
      this.ovenEl.textContent = "";
      return;
    }
    const elapsed = oven.pizza.bakeElapsed.toFixed(1);
    const target = oven.order ? oven.order.bakeSeconds : null;
    let text = target != null ? `baking ${elapsed} / ${target}s` : `baking ${elapsed}s`;
    if (oven.order && oven.order !== ticketOrder) {
      text += ` — ${formatOrderSummary(oven.order)}`;
    }
    this.ovenEl.hidden = false;
    this.ovenEl.textContent = text;
  }

  /**
   * AC#13: HUD copy of the star rating. The pizza on screen wins. On Serve,
   * an unrated pizza hides the previous score so it does not look already served.
   */
  _showRating(focus) {
    if (!this.ratingEl) return;
    let rating = focus && focus.rating;
    if (!rating && this.currentStation !== STATIONS.SERVE) {
      for (let i = this.jobs.length - 1; i >= 0; i--) {
        if (this.jobs[i].rating) {
          rating = this.jobs[i].rating;
          break;
        }
      }
    }
    if (!rating) {
      this.ratingEl.hidden = true;
      this.ratingEl.textContent = "";
      return;
    }
    this.ratingEl.hidden = false;
    this.ratingEl.textContent = rating.summary;
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

function createJob() {
  return { order: null, pizza: createEmptyPizza(), rating: null };
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
