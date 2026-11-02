// handTracking.js
// Wraps MediaPipe hand tracking. Responsible ONLY for:
//   - getting the camera stream,
//   - running the recognizer each frame,
//   - exposing raw landmarks + a screen-space cursor (index fingertip),
//   - exposing the built-in gesture label (e.g. "Thumb_Up").
//
// It does NOT interpret custom gestures (that's gestures.js) and does NOT know
// about stations or game rules (that's stations.js / game.js).

import { CONFIG, LANDMARK } from "./config.js";

// AC#4 step 1: use GestureRecognizer instead of HandLandmarker. It still gives
// us the 21 hand landmarks (so the AC#1 cursor behavior is unchanged) AND adds
// MediaPipe's built-in gesture classification, which we need for thumbs up
// later (AC#2/#13). Custom thumbs left/right is still done in gestures.js.
import {
  GestureRecognizer,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Pinned asset locations for the WASM runtime + the gesture recognizer model.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const GESTURE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

/**
 * @typedef {Object} HandFrame
 * @property {Array<{x:number,y:number,z:number}>|null} landmarks
 *   21 normalized landmarks (0..1) for the primary hand, or null if no hand.
 * @property {"Left"|"Right"|null} handedness  Raw MediaPipe handedness label.
 * @property {{x:number,y:number}|null} cursor  Index fingertip in canvas pixels.
 * @property {string|null} builtInGesture  MediaPipe gesture categoryName, e.g.
 *   "Thumb_Up" / "None", or null when no hand is present.
 * @property {number} timestamp  performance.now() when the frame was produced.
 */

export class HandTracker {
  constructor(videoEl, { width = CONFIG.VIEW_WIDTH, height = CONFIG.VIEW_HEIGHT } = {}) {
    this.video = videoEl;
    this.width = width;
    this.height = height;

    /** @type {HandFrame} */
    this.latest = {
      landmarks: null,
      handedness: null,
      cursor: null,
      builtInGesture: null,
      timestamp: 0,
    };

    this._recognizer = null;  // MediaPipe GestureRecognizer instance (set in init).
    this._stream = null;      // MediaStream, kept so we can stop tracks on dispose.
    this._lastVideoTime = -1; // guards against re-running detection on same frame.
    this._running = false;
  }

  /**
   * Request camera access and load the MediaPipe model.
   * @returns {Promise<void>}
   */
  async init() {
    // AC#1: get the camera stream and attach it to the <video> element.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not available in this browser");
    }
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: this.width },
        height: { ideal: this.height },
        facingMode: "user",
      },
      audio: false,
    });
    this.video.srcObject = this._stream;
    await this.video.play();

    // AC#4: load the WASM runtime and create the GestureRecognizer in VIDEO
    // mode. numHands: 1 -- the spec handles one order at a time (multi-hand is
    // a stretch goal). This replaces HandLandmarker but returns landmarks too.
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this._recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });

    this._running = true;
  }

  /**
   * Run detection for the current video frame and update this.latest.
   * Called once per animation frame by the game loop.
   * @param {number} nowMs  performance.now() timestamp for this frame.
   * @returns {HandFrame}
   */
  detect(nowMs) {
    // Not ready yet, or the video has no decoded frame -- return the last result.
    if (!this._recognizer || this.video.readyState < 2) {
      return this.latest;
    }
    // Skip if the video hasn't advanced since last detection (avoids throwing).
    if (this.video.currentTime === this._lastVideoTime) {
      return this.latest;
    }
    this._lastVideoTime = this.video.currentTime;

    const result = this._recognizer.recognizeForVideo(this.video, nowMs);
    const hands = (result && result.landmarks) || [];

    if (hands.length === 0) {
      // No hand this frame -- clear so the cursor hides until the hand returns.
      this.latest = {
        landmarks: null,
        handedness: null,
        cursor: null,
        builtInGesture: null,
        timestamp: nowMs,
      };
      return this.latest;
    }

    // AC#1 (unchanged): primary (first) hand. Store normalized landmarks and
    // project the index fingertip to canvas pixels so the cursor follows the
    // player's hand.
    const landmarks = hands[0];
    const handedness =
      (result.handednesses &&
        result.handednesses[0] &&
        result.handednesses[0][0] &&
        result.handednesses[0][0].categoryName) ||
      null;
    const cursor = this._toScreen(landmarks[LANDMARK.INDEX_TIP]);

    // AC#4: the built-in gesture label for the primary hand (e.g. "Thumb_Up").
    const builtInGesture =
      (result.gestures &&
        result.gestures[0] &&
        result.gestures[0][0] &&
        result.gestures[0][0].categoryName) ||
      null;

    this.latest = { landmarks, handedness, cursor, builtInGesture, timestamp: nowMs };
    return this.latest;
  }

  /**
   * Convert a normalized landmark (0..1) into canvas pixel coordinates.
   * Handles the mirrored camera so the cursor matches the player's hand.
   * @param {{x:number,y:number}} pt
   * @returns {{x:number,y:number}}
   */
  _toScreen(pt) {
    // AC#1 (mirror rule): the camera feed is mirrored for the player, so flip x
    // to make the cursor track the player's real hand, not the mirror image.
    const x = CONFIG.MIRROR_CAMERA ? 1 - pt.x : pt.x;
    return { x: x * this.width, y: pt.y * this.height };
  }

  /** Stop the camera stream and free the model. */
  dispose() {
    this._running = false;
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
      this._stream = null;
    }
    if (this._recognizer) {
      this._recognizer.close();
      this._recognizer = null;
    }
  }
}
