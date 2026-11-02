// stations.js
// The five stations and their per-station logic. Each station:
//   - reacts to gesture state (from gestures.js) + the cursor,
//   - mutates the shared order/pizza state,
//   - draws itself onto the canvas.
//
// Stations do NOT talk to the camera or MediaPipe directly. The game loop feeds
// them a cursor + GestureState each frame and calls update()/render().
//
// Common base class defines the interface; one subclass per station maps 1:1
// to the spec's gesture-mapping table and acceptance criteria.

import { STATIONS } from "./config.js";
import { PinchDragTracker } from "./gestures.js";

// ---------------------------------------------------------------------------
// Topping station layout (shared by update + render so hit-tests match the art)
// ---------------------------------------------------------------------------
// Dough / pizza target the toppings land on.
const DOUGH = { cx: 640, cy: 380, r: 170 };

// Bins along the top. `type` is what a pinch picks up. Sauce and cheese are
// drawn but NOT pickable yet (those are AC#6 / AC#7 -- not implemented here);
// only the two topping bins are active for AC#8.
const TOPPING_BINS = [
  { type: "pepperoni", x: 860, y: 120, w: 120, h: 90, color: "#b03a2e", pickable: true },
  { type: "pepper", x: 1040, y: 120, w: 120, h: 90, color: "#2e7d32", pickable: true },
];
const SAUCE_BIN = { x: 120, y: 120, w: 120, h: 90, color: "#c0392b" };
const CHEESE_BIN = { x: 300, y: 120, w: 120, h: 90, color: "#f4d35e" };
const TRASH = { x: 1080, y: 560, w: 110, h: 120, color: "#555b61" };

// Visual radius of a placed/carried topping blob.
const TOPPING_RADIUS = 16;

/** @returns {boolean} is point (px) inside this rectangle region? */
function pointInRect(p, r) {
  return p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** @returns {boolean} is point (px) inside the dough circle? */
function pointInCircle(p, c) {
  if (!p) return false;
  const dx = p.x - c.cx;
  const dy = p.y - c.cy;
  return dx * dx + dy * dy <= c.r * c.r;
}

/** Fill color for a placed topping blob of the given type. */
function toppingColor(type) {
  const bin = TOPPING_BINS.find((b) => b.type === type);
  return bin ? bin.color : "#8b5a2b";
}

/**
 * @typedef {Object} Order
 * @property {Array<{type:string, x:number, y:number}>} requestedToppings
 * @property {number} bakeSeconds   Target bake time from the ticket.
 * @property {number} slices        Requested number of slices.
 */

/**
 * @typedef {Object} Pizza  Mutable in-progress pizza shared across stations.
 * @property {Array<{x:number,y:number}>} sauce       Sauce stroke points.
 * @property {boolean} cheese                          Whether cheese is added.
 * @property {Array<{type:string,x:number,y:number}>} toppings  Placed toppings.
 * @property {number} bakeElapsed                      Seconds in the oven.
 * @property {boolean} inOven
 * @property {boolean} removedFromOven
 * @property {Array<{x1:number,y1:number,x2:number,y2:number}>} cuts  Cut lines.
 */

/**
 * @typedef {Object} GameContext  Shared state passed to every station.
 * @property {Order|null} order
 * @property {Pizza} pizza
 * @property {CanvasRenderingContext2D} ctx
 * @property {{x:number,y:number}|null} cursor
 * @property {import("./gestures.js").GestureState} gesture
 * @property {number} dt  Seconds since last frame.
 */

// ---------------------------------------------------------------------------
// Base station
// ---------------------------------------------------------------------------
export class Station {
  /** @param {string} id One of STATIONS.* */
  constructor(id) {
    this.id = id;
  }

  /** Called once when the player arrives at this station. */
  onEnter(/* ctx: GameContext */) {}

  /** Called once when leaving this station. */
  onExit(/* ctx: GameContext */) {}

  /** Per-frame logic: read ctx.gesture + ctx.cursor, mutate ctx.pizza/order. */
  update(/* ctx: GameContext */) {}

  /** Per-frame draw onto ctx.ctx. */
  render(/* ctx: GameContext */) {}
}

// ---------------------------------------------------------------------------
// Tiny drawing helpers (placeholder art only -- basic shapes + text labels).
// Shared by the render() methods below. No images, no animation.
// ---------------------------------------------------------------------------
function labelBox(ctx, x, y, w, h, fill, label) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  caption(ctx, label, x + w / 2, y + h / 2);
}

function caption(ctx, text, cx, cy) {
  ctx.fillStyle = "#1b1f24";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}

function title(ctx, text) {
  ctx.fillStyle = "rgba(232,238,242,0.9)";
  ctx.font = "20px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, 24, 20);
}

function circle(ctx, cx, cy, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// A simple stick-ish customer: head circle + rounded body rectangle.
function customer(ctx, cx, topY, label) {
  circle(ctx, cx, topY + 28, 28, "#f2c89a", "rgba(0,0,0,0.3)"); // head
  ctx.fillStyle = "#6aa6c8";
  ctx.fillRect(cx - 32, topY + 56, 64, 90); // body
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 32, topY + 56, 64, 90);
  if (label) caption(ctx, label, cx, topY + 164);
}

// ---------------------------------------------------------------------------
// 1. Order station
// ---------------------------------------------------------------------------
export class OrderStation extends Station {
  constructor() {
    super(STATIONS.ORDER);
  }

  update(ctx) {
    // TODO(AC#2): on thumbs up, take the customer's order -> build ctx.order
    //   (toppings, bake time, slices) and reveal the ticket (#ticket panel).
    // TODO(AC#3): thumbs up ONLY counts here and at Serve — enforced by the game
    //   loop routing, but keep this handler scoped to the Order station.
    void ctx;
  }

  render(ctx) {
    // PLACEHOLDER GRAPHICS ONLY -- shows intended layout, no interaction/logic.
    const g = ctx.ctx;
    title(g, "Order station — thumbs up to take the order (AC#2)");

    // Customer on the left.
    customer(g, 260, 180, "customer");

    // Order ticket area on the right.
    const tx = 620;
    const ty = 160;
    labelBox(g, tx, ty, 420, 360, "#fdf6e3", "");
    g.fillStyle = "#1b1f24";
    g.font = "18px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("ORDER TICKET", tx + 20, ty + 20);
    g.font = "15px system-ui, sans-serif";
    g.fillText("• toppings: —", tx + 20, ty + 70);
    g.fillText("• bake time: —", tx + 20, ty + 110);
    g.fillText("• slices: —", tx + 20, ty + 150);
  }
}

// ---------------------------------------------------------------------------
// 2. Topping station
// ---------------------------------------------------------------------------
export class ToppingStation extends Station {
  constructor() {
    super(STATIONS.TOPPING);
    // Reusable pinch-to-pick-up / release-to-drop helper (shared across the
    // topping interactions later; AC#8 uses it for placing toppings).
    this._drag = new PinchDragTracker();
  }

  onExit(ctx) {
    // Don't carry a half-grabbed topping out of the station; drop it silently.
    this._drag.reset();
    void ctx;
  }

  update(ctx) {
    // AC#8: pinch over a topping bin picks up that topping; the held topping
    //   follows the cursor; releasing over the dough places it at the cursor
    //   position; releasing off the pizza drops it (it disappears).
    //
    // TODO(AC#6): sauce drag  TODO(AC#7): cheese  TODO(AC#9): trash -- later.
    const pizza = ctx.pizza;
    this._drag.update(ctx.gesture, {
      // Grab: only the two topping bins are pickable (sauce/cheese are later ACs).
      onGrab: (point) => {
        const bin = TOPPING_BINS.find((b) => b.pickable && pointInRect(point, b));
        return bin ? { type: bin.type } : null;
      },
      // Drop: over the dough -> place at the cursor; anywhere else -> discard.
      onDrop: (payload, point) => {
        if (pointInCircle(point, DOUGH)) {
          pizza.toppings.push({ type: payload.type, x: point.x, y: point.y });
        }
        // else: released off the pizza -> the topping just disappears (no-op).
      },
    });
  }

  render(ctx) {
    // Placeholder art for the layout; the toppings/carried blob below ARE the
    // live AC#8 state (placed toppings + the item currently being dragged).
    const g = ctx.ctx;
    title(g, "Topping station — pinch a topping bin, drop on the dough (AC#8)");

    // Dough circle in the center.
    circle(g, DOUGH.cx, DOUGH.cy, DOUGH.r, "#e8c98a", "#b48a4a");
    caption(g, "dough", DOUGH.cx, DOUGH.cy);

    // Labeled bins along the top: sauce, cheese (placeholders, not pickable yet)
    // and the two active topping bins.
    labelBox(g, SAUCE_BIN.x, SAUCE_BIN.y, SAUCE_BIN.w, SAUCE_BIN.h, SAUCE_BIN.color, "sauce");
    labelBox(g, CHEESE_BIN.x, CHEESE_BIN.y, CHEESE_BIN.w, CHEESE_BIN.h, CHEESE_BIN.color, "cheese");
    for (const bin of TOPPING_BINS) {
      labelBox(g, bin.x, bin.y, bin.w, bin.h, bin.color, bin.type);
    }

    // Trash can in a bottom corner (placeholder; AC#9 later).
    labelBox(g, TRASH.x, TRASH.y, TRASH.w, TRASH.h, TRASH.color, "trash");

    // Placed toppings that live on the pizza (AC#8 result, persists).
    for (const t of ctx.pizza.toppings) {
      circle(g, t.x, t.y, TOPPING_RADIUS, toppingColor(t.type), "rgba(0,0,0,0.35)");
    }

    // The topping currently being carried follows the cursor as a ghost.
    if (this._drag.carrying && this._drag.point) {
      g.save();
      g.globalAlpha = 0.75;
      circle(
        g,
        this._drag.point.x,
        this._drag.point.y,
        TOPPING_RADIUS,
        toppingColor(this._drag.payload.type),
        "rgba(0,0,0,0.5)"
      );
      g.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Bake station
// ---------------------------------------------------------------------------
export class BakeStation extends Station {
  constructor() {
    super(STATIONS.BAKE);
  }

  onEnter(ctx) {
    // TODO(AC#10): arriving here puts the pizza in the oven automatically.
    void ctx;
  }

  update(ctx) {
    // TODO(AC#10): advance ctx.pizza.bakeElapsed by ctx.dt while in the oven.
    // TODO(AC#11): pinch the glove, drag it to the pizza, release -> take it out.
    //   Track bakeElapsed vs order.bakeSeconds for the rating later (AC#13).
    void ctx;
  }

  render(ctx) {
    // PLACEHOLDER GRAPHICS ONLY -- shows intended layout, no interaction/logic.
    const g = ctx.ctx;
    title(g, "Bake station — pizza bakes automatically; glove to remove (AC#10-11)");

    // Oven: outer body with a darker opening.
    labelBox(g, 420, 200, 440, 360, "#7f8c8d", "");
    g.fillStyle = "#2c2f33";
    g.fillRect(460, 260, 360, 240); // oven opening
    caption(g, "oven", 640, 230);
    caption(g, "(pizza inside)", 640, 380);

    // Oven glove off to the side.
    labelBox(g, 980, 300, 120, 140, "#d35400", "glove");
  }
}

// ---------------------------------------------------------------------------
// 4. Cut station
// ---------------------------------------------------------------------------
export class CutStation extends Station {
  constructor() {
    super(STATIONS.CUT);
    this._dragStart = null; // pinch-down point for the current cut
  }

  update(ctx) {
    // TODO(AC#12): pinch the slicer, drag across the pizza -> one cut per drag.
    //   Record a line from pinchStarted point to pinchReleased point in
    //   ctx.pizza.cuts. Compare count to order.slices for the rating (AC#13).
    void ctx;
  }

  render(ctx) {
    // PLACEHOLDER GRAPHICS ONLY -- shows intended layout, no interaction/logic.
    const g = ctx.ctx;
    title(g, "Cut station — pinch the slicer, drag across the pizza (AC#12)");

    // The baked pizza in the center.
    circle(g, 620, 380, 180, "#e0a458", "#9c6b2a");
    circle(g, 620, 380, 180, null, "#c0392b"); // crust ring hint
    caption(g, "pizza", 620, 380);

    // The slicer (wheel + handle) parked to the side.
    labelBox(g, 1000, 300, 150, 60, "#bdc3c7", "slicer");
    circle(g, 1000, 330, 26, "#7f8c8d", "#2c3e50"); // cutter wheel
  }
}

// ---------------------------------------------------------------------------
// 5. Serve station
// ---------------------------------------------------------------------------
export class ServeStation extends Station {
  constructor() {
    super(STATIONS.SERVE);
  }

  update(ctx) {
    // TODO(AC#13): on thumbs up, serve the pizza and compute the customer
    //   rating by comparing the finished pizza to ctx.order (toppings placed,
    //   bake time accuracy, slice count) — the "zen, accurate" evaluation.
    // TODO(AC#3): thumbs up only counts here and at Order.
    void ctx;
  }

  render(ctx) {
    // PLACEHOLDER GRAPHICS ONLY -- shows intended layout, no interaction/logic.
    const g = ctx.ctx;
    title(g, "Serve station — thumbs up to serve; customer rates it (AC#13)");

    // Customer on the left.
    customer(g, 260, 180, "customer");

    // Rating area on the right: a row of placeholder star outlines.
    const rx = 620;
    const ry = 200;
    labelBox(g, rx, ry, 420, 200, "#fdf6e3", "");
    g.fillStyle = "#1b1f24";
    g.font = "18px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("RATING", rx + 20, ry + 20);
    for (let i = 0; i < 5; i++) {
      circle(g, rx + 60 + i * 72, ry + 120, 24, "#eee", "#caa24a");
      caption(g, "★", rx + 60 + i * 72, ry + 120);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory: build the station instances keyed by id for the game loop.
// ---------------------------------------------------------------------------
export function createStations() {
  return {
    [STATIONS.ORDER]: new OrderStation(),
    [STATIONS.TOPPING]: new ToppingStation(),
    [STATIONS.BAKE]: new BakeStation(),
    [STATIONS.CUT]: new CutStation(),
    [STATIONS.SERVE]: new ServeStation(),
  };
}

/** @returns {Pizza} a fresh, empty pizza for a new order. */
export function createEmptyPizza() {
  return {
    sauce: [],
    cheese: false,
    toppings: [],
    bakeElapsed: 0,
    inOven: false,
    removedFromOven: false,
    cuts: [],
  };
}
