// gestures.js
// Interprets raw hand landmarks into the gesture primitives the spec defines:
//   - hand cursor (handled upstream in handTracking.js, consumed here)
//   - pinch (grab / hold-to-drag / release)                 [TODO: later AC]
//   - thumbs up (built-in MediaPipe gesture)                [TODO: later AC]
//   - thumbs left / thumbs right (custom, must be held briefly)  [AC#4 -- done]
//
// Pure interpretation: no drawing, no station logic. Takes a HandFrame, returns
// a snapshot of the current gesture state. The game loop decides what to do
// with that per the gesture-mapping table.

import { CONFIG, GESTURES, LANDMARK, MP_GESTURE } from "./config.js";

/**
 * @typedef {Object} GestureState
 * @property {string} active            One of GESTURES.* (the dominant gesture).
 * @property {boolean} pinching         True while thumb+index are held together.
 * @property {boolean} pinchStarted     True only on the frame pinch begins (grab).
 * @property {boolean} pinchReleased    True only on the frame pinch ends (drop).
 * @property {{x:number,y:number}|null} pinchPoint  Pinch location in canvas px.
 * @property {boolean} thumbsUp         Built-in thumbs up this frame.
 * @property {boolean} thumbsLeftHeld   Thumbs-left held past the hold threshold.
 * @property {boolean} thumbsRightHeld  Thumbs-right held past the hold threshold.
 */

export class GestureDetector {
  constructor() {
    // Internal state for edge detection + hold timers.
    this._wasPinching = false;
    this._thumbLeftSince = null;   // timestamp (ms) thumbs-left started, else null
    this._thumbRightSince = null;  // timestamp (ms) thumbs-right started, else null
    this._switchCooldownUntil = 0; // ignore further switches until this time (ms)
  }

  /**
   * @param {import("./handTracking.js").HandFrame} frame
   * @param {string} [builtInGesture]  Optional label from MediaPipe GestureRecognizer.
   *   If omitted, falls back to frame.builtInGesture.
   * @returns {GestureState}
   */
  update(frame, builtInGesture) {
    const state = this._empty();
    if (!frame || !frame.landmarks) {
      // No hand: reset hold timers so a reappearing hand doesn't insta-trigger.
      this._thumbLeftSince = null;
      this._thumbRightSince = null;
      this._wasPinching = false;
      return state;
    }

    // --- Pinch (AC#1 depends on this; AC#6,7,8,9,11,12 reuse it) -------------
    // TODO(pinch): compute normalized distance between THUMB_TIP and INDEX_TIP.
    // Use CONFIG.PINCH_CLOSE_THRESHOLD / PINCH_OPEN_THRESHOLD with hysteresis.
    const pinching = this._detectPinch(frame.landmarks); // TODO: implement
    state.pinching = pinching;
    state.pinchStarted = pinching && !this._wasPinching;
    state.pinchReleased = !pinching && this._wasPinching;
    state.pinchPoint = pinching ? frame.cursor : null;
    this._wasPinching = pinching;

    // --- Thumbs up (AC#2 take order, AC#13 serve) ---------------------------
    // Built-in label flows through now that handTracking uses GestureRecognizer,
    // but station handling of it is a later AC. Kept as a passthrough signal.
    const label = builtInGesture != null ? builtInGesture : frame.builtInGesture;
    state.thumbsUp = label === MP_GESTURE.THUMB_UP;

    // --- Thumbs left / right with hold (AC#4 switch, AC#5 ignore quick) -----
    const dir = this._detectThumbDirection(frame); // "left" | "right" | null
    state.thumbsLeftHeld = this._evaluateHold("left", dir, frame.timestamp);
    state.thumbsRightHeld = this._evaluateHold("right", dir, frame.timestamp);

    // Resolve a single dominant gesture for convenience.
    state.active = this._dominant(state);
    return state;
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * Pinch = thumb tip and index tip close together (AC#8; reused by sauce,
   * cheese, trash, glove, slicer later). Scale-invariant: the thumb-index
   * distance is measured as a ratio of hand width, then compared against the
   * close/open thresholds with hysteresis so the pinch doesn't flicker at the
   * boundary. Uses this._wasPinching to apply the correct threshold.
   * @param {Array<{x:number,y:number}>} landmarks
   * @returns {boolean}
   */
  _detectPinch(landmarks) {
    const thumbTip = landmarks[LANDMARK.THUMB_TIP];
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    // Hand width proxy (same basis as the thumb checks) keeps this comparable
    // regardless of how close the hand is to the camera.
    const handWidth = this._dist(
      landmarks[LANDMARK.INDEX_MCP],
      landmarks[LANDMARK.PINKY_MCP]
    );
    if (handWidth <= 0) return this._wasPinching; // degenerate frame: hold state

    const ratio = this._dist(thumbTip, indexTip) / handWidth;

    // Hysteresis: once pinching, require separating past the (larger) OPEN
    // threshold to release; when not pinching, require closing past the
    // (smaller) CLOSE threshold to grab.
    if (this._wasPinching) {
      return ratio < CONFIG.PINCH_OPEN_THRESHOLD;
    }
    return ratio < CONFIG.PINCH_CLOSE_THRESHOLD;
  }

  /**
   * Custom thumbs left/right detection (NOT built into MediaPipe).
   * Spec: thumb extended, other fingers curled, thumb tip left/right of wrist.
   * Direction is reported from the PLAYER'S point of view, not the mirrored
   * camera image.
   * @param {import("./handTracking.js").HandFrame} frame
   * @returns {"left"|"right"|null}
   */
  _detectThumbDirection(frame) {
    const lm = frame.landmarks;
    if (!lm) return null;

    // Require the classic "thumbs sideways" pose: four fingers curled + thumb
    // out. This keeps the pinch/point poses from being read as a direction.
    if (!this._fourFingersCurled(lm)) return null;
    if (!this._thumbExtended(lm)) return null;

    const wrist = lm[LANDMARK.WRIST];
    const thumbTip = lm[LANDMARK.THUMB_TIP];

    // Horizontal offset of the thumb tip relative to the wrist, in the raw
    // (mirrored) camera coordinate frame where x grows to the right of the
    // image. Deadband avoids committing when the thumb points mostly up/down.
    const dx = thumbTip.x - wrist.x;
    if (Math.abs(dx) < CONFIG.THUMB_SIDE_DEADBAND_X) return null;

    // In the raw image, dx > 0 means the thumb is on the image's right side.
    const sideInImage = dx > 0 ? "right" : "left";

    // Mirror correction: the feed is flipped for the player, so the image's
    // right side is the player's left. Flip to report the player's POV (AC#4).
    if (CONFIG.MIRROR_CAMERA) {
      return sideInImage === "right" ? "left" : "right";
    }
    return sideInImage;
  }

  /**
   * True when index/middle/ring/pinky are curled. Scale-invariant: a finger is
   * curled when its tip sits closer to the wrist than its PIP joint does,
   * within a small margin (CONFIG.FINGER_CURL_TIP_PIP_RATIO).
   * @param {Array<{x:number,y:number}>} lm
   * @returns {boolean}
   */
  _fourFingersCurled(lm) {
    const wrist = lm[LANDMARK.WRIST];
    const fingers = [
      { tip: LANDMARK.INDEX_TIP, pip: LANDMARK.INDEX_PIP },
      { tip: LANDMARK.MIDDLE_TIP, pip: LANDMARK.MIDDLE_PIP },
      { tip: LANDMARK.RING_TIP, pip: LANDMARK.RING_PIP },
      { tip: LANDMARK.PINKY_TIP, pip: LANDMARK.PINKY_PIP },
    ];
    for (const f of fingers) {
      const tipToWrist = this._dist(lm[f.tip], wrist);
      const pipToWrist = this._dist(lm[f.pip], wrist);
      // Curled when the tip folded in toward the palm (tip no farther than the
      // PIP, plus a small tolerance so a slightly loose fist still counts).
      if (tipToWrist > pipToWrist * CONFIG.FINGER_CURL_TIP_PIP_RATIO) {
        return false;
      }
    }
    return true;
  }

  /**
   * True when the thumb is stuck out (not tucked against the palm). Measured as
   * thumb-tip-to-wrist distance relative to hand width (index-knuckle span),
   * which keeps it scale-invariant.
   * @param {Array<{x:number,y:number}>} lm
   * @returns {boolean}
   */
  _thumbExtended(lm) {
    const wrist = lm[LANDMARK.WRIST];
    const thumbTip = lm[LANDMARK.THUMB_TIP];
    // Hand width proxy: distance between the index and pinky knuckles (MCPs).
    const handWidth = this._dist(lm[LANDMARK.INDEX_MCP], lm[LANDMARK.PINKY_MCP]);
    if (handWidth <= 0) return false;
    const thumbReach = this._dist(thumbTip, wrist);
    return thumbReach / handWidth >= CONFIG.THUMB_EXTENDED_MIN_RATIO;
  }

  /** Euclidean distance in normalized landmark space. */
  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Turn a sustained direction into a one-shot "held long enough" signal.
   * AC#4: only fires after CONFIG.STATION_SWITCH_HOLD_SECONDS.
   * AC#5: a quick flick (released before the threshold) must NOT fire.
   * @param {"left"|"right"} side
   * @param {"left"|"right"|null} currentDir
   * @param {number} now  frame timestamp (ms)
   * @returns {boolean}  true exactly once when the hold completes
   */
  _evaluateHold(side, currentDir, now) {
    const key = side === "left" ? "_thumbLeftSince" : "_thumbRightSince";

    // Direction not currently held (or switched sides) -> reset this timer.
    if (currentDir !== side) {
      this[key] = null;
      return false;
    }

    // Start the timer on the first frame the direction appears.
    if (this[key] == null) {
      this[key] = now;
      return false;
    }

    // Still cooling down from a previous switch -- don't fire again yet. This
    // stops one long hold from skipping across multiple stations.
    if (now < this._switchCooldownUntil) {
      return false;
    }

    const heldMs = now - this[key];
    const thresholdMs = CONFIG.STATION_SWITCH_HOLD_SECONDS * 1000;
    if (heldMs >= thresholdMs) {
      // Fire once: reset the timer and start a cooldown. Re-holding is needed
      // for the next step.
      this[key] = null;
      this._switchCooldownUntil = now + CONFIG.STATION_SWITCH_COOLDOWN_SECONDS * 1000;
      return true;
    }
    return false;
  }

  /** @returns {string} the single most relevant gesture for the game loop. */
  _dominant(state) {
    if (state.thumbsUp) return GESTURES.THUMBS_UP;
    if (state.thumbsLeftHeld) return GESTURES.THUMBS_LEFT;
    if (state.thumbsRightHeld) return GESTURES.THUMBS_RIGHT;
    if (state.pinching) return GESTURES.PINCH;
    return GESTURES.NONE;
  }

  /** @returns {GestureState} */
  _empty() {
    return {
      active: GESTURES.NONE,
      pinching: false,
      pinchStarted: false,
      pinchReleased: false,
      pinchPoint: null,
      thumbsUp: false,
      thumbsLeftHeld: false,
      thumbsRightHeld: false,
    };
  }
}

/**
 * PinchDragTracker
 * Reusable "pinch to pick up, hold to drag, release to drop" helper built on
 * top of the pinch edges in GestureState. It is interaction-agnostic: it only
 * knows "is something being carried and where is it". Callers decide WHAT gets
 * picked up (via the onGrab hit-test) and WHAT happens on release (onDrop).
 *
 * The Topping station uses it for AC#8 (place toppings); sauce, cheese, trash,
 * glove, and slicer can reuse the exact same flow later.
 *
 * Usage per frame:
 *   tracker.update(gesture, {
 *     onGrab: (point) => payloadOrNull,  // return what to carry, or null
 *     onDrop: (payload, point) => {},    // commit the drop (place/remove/etc.)
 *   });
 *   if (tracker.carrying) drawGhostAt(tracker.point, tracker.payload);
 */
export class PinchDragTracker {
  constructor() {
    /** @type {*} payload currently being carried, or null when idle. */
    this.payload = null;
    /** @type {{x:number,y:number}|null} current carry position (cursor). */
    this.point = null;
  }

  /** @returns {boolean} true while something is held. */
  get carrying() {
    return this.payload != null;
  }

  /**
   * Advance the pick-up/carry/drop state machine for this frame.
   * @param {GestureState} gesture
   * @param {{
   *   onGrab: (point: {x:number,y:number}) => *,
   *   onDrop: (payload: *, point: {x:number,y:number}|null) => void,
   * }} handlers
   */
  update(gesture, handlers) {
    // Pick up: on the frame the pinch begins, ask the caller what (if anything)
    // is under the pinch point. A null result means "nothing here", stay idle.
    if (gesture.pinchStarted && !this.carrying) {
      const point = gesture.pinchPoint;
      const payload = handlers.onGrab(point);
      if (payload != null) {
        this.payload = payload;
        this.point = point;
      }
      return;
    }

    // Carry: while the pinch is held, the carried item follows the cursor.
    if (this.carrying && gesture.pinching) {
      if (gesture.pinchPoint) this.point = gesture.pinchPoint;
      return;
    }

    // Drop: on release (or if tracking was lost), hand the payload back to the
    // caller to commit. Then clear so the next grab starts fresh.
    if (this.carrying && (gesture.pinchReleased || !gesture.pinching)) {
      handlers.onDrop(this.payload, this.point);
      this.payload = null;
      this.point = null;
    }
  }

  /** Force-clear any carried item (e.g. when leaving a station). */
  reset() {
    this.payload = null;
    this.point = null;
  }
}
