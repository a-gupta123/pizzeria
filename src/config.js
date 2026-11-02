// config.js
// Shared constants and tunable values for the gesture-controlled pizzeria.
// Keeping these in one place so gesture/station/game modules agree on names.

// ---------------------------------------------------------------------------
// Stations (order matters: index = progression order)
// ---------------------------------------------------------------------------
export const STATIONS = Object.freeze({
  ORDER: "order",
  TOPPING: "topping",
  BAKE: "bake",
  CUT: "cut",
  SERVE: "serve",
});

// Ordered list used for "previous / next station" navigation.
// AC #4: thumbs right -> next, thumbs left -> previous.
export const STATION_ORDER = Object.freeze([
  STATIONS.ORDER,
  STATIONS.TOPPING,
  STATIONS.BAKE,
  STATIONS.CUT,
  STATIONS.SERVE,
]);

// ---------------------------------------------------------------------------
// Gesture names
// ---------------------------------------------------------------------------
export const GESTURES = Object.freeze({
  NONE: "none",
  PINCH: "pinch",
  THUMBS_UP: "thumbs_up",
  THUMBS_LEFT: "thumbs_left",
  THUMBS_RIGHT: "thumbs_right",
});

// Built-in MediaPipe GestureRecognizer category names we care about.
// The recognizer emits these exact strings in result.gestures[].categoryName.
export const MP_GESTURE = Object.freeze({
  THUMB_UP: "Thumb_Up",
  THUMB_DOWN: "Thumb_Down",
  NONE: "None",
});

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const CONFIG = Object.freeze({
  // AC#4 / AC#5: how long thumbs left/right must be held before a station
  // switch fires. 0.6s is long enough that a quick flick (AC#5) won't trigger
  // it by accident, but short enough to not feel sluggish when deliberate.
  STATION_SWITCH_HOLD_SECONDS: 0.6,

  // After a switch fires, ignore further switches for this long. Prevents one
  // sustained hold from skipping through several stations in a row -- the
  // player should re-hold for each step. Slightly longer than the hold itself.
  STATION_SWITCH_COOLDOWN_SECONDS: 0.8,

  // --- Thumbs left/right detection (AC#4) -----------------------------------
  // The four non-thumb fingers count as "curled" when the fingertip is closer
  // to the wrist than the finger's middle joint (PIP). Using a ratio of
  // tip-distance / pip-distance keeps this scale-invariant (works whether the
  // hand is near or far from the camera). < 1.0 means the tip folded inward;
  // 0.9 adds a small margin so a not-quite-straight finger still reads as
  // curled without being so loose that an open hand passes.
  FINGER_CURL_TIP_PIP_RATIO: 0.9,

  // The thumb counts as "extended" when its tip is far enough from the wrist
  // relative to the index knuckle span. Expressed as a fraction of the hand
  // width so it is scale-invariant. 0.6 reliably separates a stuck-out thumb
  // from a thumb tucked against the palm.
  THUMB_EXTENDED_MIN_RATIO: 0.6,

  // Horizontal distance (normalized 0..1) the thumb tip must sit to one side
  // of the wrist before we commit to "left" or "right". A deadband near the
  // wrist's x avoids flip-flopping when the thumb points mostly up/down.
  THUMB_SIDE_DEADBAND_X: 0.06,

  // --- Pinch detection (AC#8; reused by sauce/cheese/trash/glove/slicer) ----
  // Pinch = thumb tip and index tip close together. We measure their distance
  // as a RATIO of the hand width (index-knuckle to pinky-knuckle span) so it is
  // scale-invariant: a pinch reads the same whether the hand is near or far
  // from the camera. Two thresholds give hysteresis so the pinch doesn't
  // flicker open/closed when the fingers hover right at the boundary.
  //
  // CLOSE (0.45): below this ratio we treat the pinch as closed (grab). Chosen
  // just above a fully-touching pinch (~0.25-0.35 of hand width in practice) so
  // the grab triggers a hair before the fingers actually touch, which feels
  // responsive without false-firing from a relaxed open hand (~0.7-1.0).
  PINCH_CLOSE_THRESHOLD: 0.45,
  // OPEN (0.6): the pinch only counts as released once the fingers separate
  // past this larger ratio. The gap between 0.45 and 0.6 is the hysteresis band
  // that prevents jitter at the threshold.
  PINCH_OPEN_THRESHOLD: 0.6,

  // Camera / canvas dimensions. Hand landmarks are normalized; map to these.
  VIEW_WIDTH: 1280,
  VIEW_HEIGHT: 720,

  // AC rule: the camera image is mirrored, but left/right must be from the
  // PLAYER'S point of view. true = flip handedness/x when interpreting gestures.
  MIRROR_CAMERA: true,
});

// MediaPipe hand landmark indices, for readability in gesture code.
// https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
export const LANDMARK = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});
