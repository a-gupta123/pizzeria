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

// Bins along the top. Cheese (AC#7) and the two topping bins (AC#8) are grabbed
// and dropped. Sauce (AC#6) is painted while the pinch is dragged.
const TOPPING_BINS = [
  { type: "pepperoni", x: 860, y: 120, w: 120, h: 90, color: "#b03a2e", pickable: true },
  { type: "pepper", x: 1040, y: 120, w: 120, h: 90, color: "#2e7d32", pickable: true },
];
const SAUCE_BIN = { x: 120, y: 120, w: 120, h: 90, color: "#c0392b" };
const SAUCE_COLOR = "rgba(192, 57, 43, 0.92)";
// Trail thickness on the full-size dough. Later stations scale it with the pie.
const SAUCE_WIDTH = 18;
// Samples closer than this are the same dab. Keeps a slow drag from flooding
// the stroke without opening gaps in a normal swipe.
const SAUCE_MIN_STEP = 4;
const CHEESE_BIN = { x: 300, y: 120, w: 120, h: 90, color: "#f4d35e" };
// Inset from the crust so the rim stays visible. Same color as the bin.
const CHEESE_LAYER = "rgba(244, 211, 94, 0.9)";
const CHEESE_INSET = 0.86;
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

/** Cheese sits inside the crust. Shared by the topping station and the later pies. */
function drawCheeseLayer(g, dest) {
  circle(g, dest.cx, dest.cy, dest.r * CHEESE_INSET, CHEESE_LAYER);
}

/**
 * Index of the placed topping under the pinch, or -1. The closest blob wins
 * when two overlap, and the edge of the blob still counts.
 */
function nearestToppingIndex(point, pizza) {
  if (!point) return -1;
  let best = -1;
  let bestDist = TOPPING_RADIUS;
  for (let i = 0; i < pizza.toppings.length; i++) {
    const t = pizza.toppings[i];
    const dist = Math.hypot(t.x - point.x, t.y - point.y);
    if (dist <= bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Sauce trail in dough space, drawn into `dest` (the dough itself, or a later
 * pie). A `{gap:true}` sample starts a new stroke so leaving the dough and
 * coming back does not slash a line across the middle. Clipped to the crust.
 */
function drawSauceTrail(g, points, dest) {
  if (!points || !points.length) return;
  const scale = dest.r / DOUGH.r;
  const width = Math.max(6, SAUCE_WIDTH * scale);
  const map = (p) => ({
    x: dest.cx + (p.x - DOUGH.cx) * scale,
    y: dest.cy + (p.y - DOUGH.cy) * scale,
  });
  g.save();
  g.beginPath();
  g.arc(dest.cx, dest.cy, dest.r, 0, Math.PI * 2);
  g.clip();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = SAUCE_COLOR;
  g.fillStyle = SAUCE_COLOR;
  g.lineWidth = width;
  let run = [];
  const flush = () => {
    if (run.length === 1) {
      const m = map(run[0]);
      circle(g, m.x, m.y, width / 2, SAUCE_COLOR);
    } else if (run.length > 1) {
      g.beginPath();
      run.forEach((p, i) => {
        const m = map(p);
        if (i === 0) g.moveTo(m.x, m.y);
        else g.lineTo(m.x, m.y);
      });
      g.stroke();
    }
    run = [];
  };
  for (const p of points) {
    if (!p || p.gap) flush();
    else run.push(p);
  }
  flush();
  g.restore();
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
 * @property {Array<{x:number,y:number}|{gap:true}>} sauce  Sauce dabs. A gap starts a new stroke.
 * @property {boolean} cheese                          Whether cheese is added.
 * @property {Array<{type:string,x:number,y:number}>} toppings  Placed toppings.
 * @property {number} bakeElapsed                      Seconds in the oven.
 * @property {boolean} inOven
 * @property {boolean} removedFromOven
 * @property {Array<{x1:number,y1:number,x2:number,y2:number}>} cuts  Cut lines.
 */

/**
 * @typedef {Object} Rating  Result of serving (AC#13).
 * @property {number} stars
 * @property {string} summary
 */

/**
 * @typedef {Object} GameContext  Shared state passed to every station.
 * @property {Order|null} order
 * @property {Pizza} pizza
 * @property {CanvasRenderingContext2D} ctx
 * @property {{x:number,y:number}|null} cursor
 * @property {import("./gestures.js").GestureState} gesture
 * @property {number} dt  Seconds since last frame.
 * @property {Rating|null} [rating]  Set when the pizza is served (AC#13).
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

// caption() is dark ink for labels sitting on light bins. Anything drawn on the
// page background or the dark oven mouth has to be light or it disappears.
function lightCaption(ctx, text, cx, cy) {
  ctx.fillStyle = "rgba(232,238,242,0.92)";
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
// Order menu (AC#2)
// ---------------------------------------------------------------------------
// Positions are canvas pixels on the topping-station dough (same space as
// pizza.toppings) so a later rating can compare where the player placed each
// topping to where this ticket asked for it. Only pepperoni and pepper exist
// as bins today, so every order uses those two.
const ORDER_TICKET = { x: 620, y: 160, w: 420, h: 360 };

const ORDER_MENU = [
  {
    requestedToppings: [
      { type: "pepperoni", x: 580, y: 340 },
      { type: "pepperoni", x: 700, y: 420 },
      { type: "pepper", x: 640, y: 300 },
    ],
    bakeSeconds: 8,
    slices: 4,
  },
  {
    requestedToppings: [
      { type: "pepper", x: 560, y: 400 },
      { type: "pepper", x: 720, y: 360 },
      { type: "pepperoni", x: 640, y: 450 },
    ],
    bakeSeconds: 6,
    slices: 6,
  },
  {
    requestedToppings: [
      { type: "pepperoni", x: 600, y: 320 },
      { type: "pepperoni", x: 680, y: 320 },
      { type: "pepperoni", x: 640, y: 440 },
      { type: "pepper", x: 640, y: 380 },
    ],
    bakeSeconds: 10,
    slices: 8,
  },
];

/** Plain-language spot on the dough, derived from the stored x/y. */
function placementWord(topping) {
  const dx = topping.x - DOUGH.cx;
  const dy = topping.y - DOUGH.cy;
  const horiz = dx < -30 ? "left" : dx > 30 ? "right" : "";
  const vert = dy < -30 ? "upper" : dy > 30 ? "lower" : "";
  if (!horiz && !vert) return "center";
  return `${vert} ${horiz}`.trim();
}

/** One-line ticket used by the HUD. Includes where, bake time, and slices. */
export function formatOrderSummary(order) {
  const toppings = order.requestedToppings
    .map((t) => `${t.type} (${placementWord(t)})`)
    .join(", ");
  return `${toppings} · bake ${order.bakeSeconds}s · ${order.slices} slices`;
}

function createCustomerOrder() {
  const template = ORDER_MENU[Math.floor(Math.random() * ORDER_MENU.length)];
  return {
    requestedToppings: template.requestedToppings.map((t) => ({ ...t })),
    bakeSeconds: template.bakeSeconds,
    slices: template.slices,
  };
}

// ---------------------------------------------------------------------------
// 1. Order station
// ---------------------------------------------------------------------------
export class OrderStation extends Station {
  constructor() {
    super(STATIONS.ORDER);
  }

  update(ctx) {
    // AC#2: the first thumbs up takes the order. A held thumbs up must not
    // reroll it. AC#3 (thumbs up ignored at Topping, Bake, and Cut) is
    // enforced in game.js before this update runs, so this handler only
    // exists on the Order station.
    if (ctx.order || !ctx.gesture.thumbsUp) return;
    ctx.order = createCustomerOrder();
  }

  render(ctx) {
    const g = ctx.ctx;
    const order = ctx.order;
    title(
      g,
      order
        ? "Order taken — hold thumbs right for the topping station"
        : ctx.alsoBaking
          ? "Next order — thumbs up, one pizza is already baking"
          : "Order station — thumbs up to take the order"
    );

    customer(g, 260, 180, "");
    // caption() is dark text for labels on light bins. The backdrop here is
    // the page background, so the status has to be light or it disappears.
    g.fillStyle = "rgba(232,238,242,0.85)";
    g.font = "16px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(order ? "order up" : "waiting", 260, 180 + 164);

    const { x: tx, y: ty, w, h } = ORDER_TICKET;
    labelBox(g, tx, ty, w, h, "#fdf6e3", "");
    g.fillStyle = "#1b1f24";
    g.font = "18px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("ORDER TICKET", tx + 20, ty + 20);

    g.font = "15px system-ui, sans-serif";
    if (!order) {
      g.fillText("• toppings: —", tx + 20, ty + 70);
      g.fillText("• bake time: —", tx + 20, ty + 110);
      g.fillText("• slices: —", tx + 20, ty + 150);
      return;
    }

    g.fillText(`bake ${order.bakeSeconds}s`, tx + 20, ty + 58);
    g.fillText(`${order.slices} slices`, tx + 20, ty + 84);
    order.requestedToppings.forEach((t, i) => {
      g.fillText(`${t.type} · ${placementWord(t)}`, tx + 20, ty + 130 + i * 26);
    });

    // Mini dough on the ticket, same relative layout as the real dough, so
    // "where" is a picture and not only a word.
    const diagram = { cx: tx + 315, cy: ty + 220, r: 85 };
    circle(g, diagram.cx, diagram.cy, diagram.r, "#e8c98a", "#b48a4a");
    const scale = diagram.r / DOUGH.r;
    for (const t of order.requestedToppings) {
      circle(
        g,
        diagram.cx + (t.x - DOUGH.cx) * scale,
        diagram.cy + (t.y - DOUGH.cy) * scale,
        8,
        toppingColor(t.type),
        "rgba(0,0,0,0.35)"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Topping station
// ---------------------------------------------------------------------------
export class ToppingStation extends Station {
  constructor() {
    super(STATIONS.TOPPING);
    // Reusable pinch-to-pick-up / release-to-drop helper. Sauce, cheese, and
    // toppings all ride it; trash will too.
    this._drag = new PinchDragTracker();
    // True when the sauce pinch is off the dough, so the next dab starts a new
    // stroke instead of bridging the gap.
    this._sauceLifted = true;
  }

  onExit(ctx) {
    // Don't carry a half-grabbed handful out of the station. Sauce already
    // painted stays on the pie.
    this._drag.reset();
    this._sauceLifted = true;
    void ctx;
  }

  /** @param {Pizza} pizza */
  _laySauce(pizza, point) {
    if (!point || !pointInCircle(point, DOUGH)) {
      this._sauceLifted = true;
      return;
    }
    let last = null;
    for (let i = pizza.sauce.length - 1; i >= 0; i--) {
      if (!pizza.sauce[i].gap) {
        last = pizza.sauce[i];
        break;
      }
    }
    if (this._sauceLifted && last) pizza.sauce.push({ gap: true });
    this._sauceLifted = false;
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < SAUCE_MIN_STEP) return;
    pizza.sauce.push({ x: point.x, y: point.y });
  }

  update(ctx) {
    // AC#6: pinch and drag across the dough. Sauce is laid where the cursor
    //   passes over the pie. The sauce bin starts a stroke too.
    // AC#7: pinch the cheese bin, release over the dough, and the pie is covered.
    // AC#8: pinch a topping bin, release over the dough, and it lands at the cursor.
    // AC#9: pinch a topping already on the pie and release it over the trash
    //   to remove it. Anywhere else puts it back where it was — the can is
    //   the only thing that deletes one.
    // Releasing cheese or a new topping off the dough puts that handful back.
    // A sauce stroke keeps whatever was already painted.
    const pizza = ctx.pizza;
    this._drag.update(ctx.gesture, {
      onGrab: (point) => {
        if (pointInRect(point, SAUCE_BIN)) return { kind: "sauce" };
        if (pointInRect(point, CHEESE_BIN)) return { kind: "cheese" };
        const bin = TOPPING_BINS.find((b) => b.pickable && pointInRect(point, b));
        if (bin) return { kind: "topping", type: bin.type };
        const placed = nearestToppingIndex(point, pizza);
        if (placed >= 0) {
          const topping = pizza.toppings[placed];
          return { kind: "placed", index: placed, type: topping.type };
        }
        if (pointInCircle(point, DOUGH)) return { kind: "sauce" };
        return null;
      },
      onDrop: (payload, point) => {
        if (payload.kind === "sauce") {
          this._sauceLifted = true;
          return;
        }
        if (payload.kind === "placed") {
          if (pointInRect(point, TRASH)) pizza.toppings.splice(payload.index, 1);
          return;
        }
        if (!pointInCircle(point, DOUGH)) return;
        if (payload.kind === "cheese") {
          pizza.cheese = true;
          return;
        }
        pizza.toppings.push({ type: payload.type, x: point.x, y: point.y });
      },
    });

    if (this._drag.carrying && this._drag.payload.kind === "sauce") {
      this._laySauce(pizza, this._drag.point);
    }
  }

  render(ctx) {
    // Placeholder art for the layout; the toppings/carried blob below ARE the
    // live AC#8 state (placed toppings + the item currently being dragged).
    const g = ctx.ctx;
    title(g, "Topping station — sauce, cheese, toppings; drop a misplaced one in the trash");

    // Dough, then cheese, then the sauce trail so a stroke stays visible on top.
    circle(g, DOUGH.cx, DOUGH.cy, DOUGH.r, "#e8c98a", "#b48a4a");
    if (ctx.pizza.cheese) drawCheeseLayer(g, DOUGH);
    drawSauceTrail(g, ctx.pizza.sauce, DOUGH);
    // Keep the word off the center of the dough once ticket rings are drawn,
    // so a center topping target isn't hidden under the label.
    caption(g, "dough", DOUGH.cx, ctx.order ? DOUGH.cy + DOUGH.r - 28 : DOUGH.cy);

    // The sauce bin dims while a stroke is in progress. Cheese dims once it's on.
    const carryingSauce = this._drag.carrying && this._drag.payload.kind === "sauce";
    g.save();
    if (carryingSauce) g.globalAlpha = 0.45;
    labelBox(g, SAUCE_BIN.x, SAUCE_BIN.y, SAUCE_BIN.w, SAUCE_BIN.h, SAUCE_BIN.color, "sauce");
    g.restore();
    const carryingCheese = this._drag.carrying && this._drag.payload.kind === "cheese";
    g.save();
    if (ctx.pizza.cheese || carryingCheese) g.globalAlpha = 0.45;
    labelBox(g, CHEESE_BIN.x, CHEESE_BIN.y, CHEESE_BIN.w, CHEESE_BIN.h, CHEESE_BIN.color, "cheese");
    g.restore();
    for (const bin of TOPPING_BINS) {
      labelBox(g, bin.x, bin.y, bin.w, bin.h, bin.color, bin.type);
    }

    // Brighter while a placed topping is in hand, so the can reads as the target.
    const carryingPlaced = this._drag.carrying && this._drag.payload.kind === "placed";
    labelBox(g, TRASH.x, TRASH.y, TRASH.w, TRASH.h, carryingPlaced ? "#7d868e" : TRASH.color, "trash");
    if (carryingPlaced) {
      g.strokeStyle = "rgba(232,238,242,0.85)";
      g.lineWidth = 3;
      g.strokeRect(TRASH.x - 2, TRASH.y - 2, TRASH.w + 4, TRASH.h + 4);
    }

    // AC#2: dashed rings are the ticket's requested spots, not placed toppings.
    // Drawn under the real toppings so a drop covers its target.
    if (ctx.order) {
      g.save();
      g.setLineDash([4, 3]);
      g.lineWidth = 2;
      for (const target of ctx.order.requestedToppings) {
        g.beginPath();
        g.arc(target.x, target.y, TOPPING_RADIUS + 8, 0, Math.PI * 2);
        g.strokeStyle = toppingColor(target.type);
        g.stroke();
      }
      g.restore();
      g.fillStyle = "rgba(232,238,242,0.8)";
      g.font = "14px system-ui, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText("dashed rings = where the ticket wants each topping", 24, 52);
    }

    // Placed toppings. The one in hand is hidden here and drawn as a ghost.
    const carriedIndex = carryingPlaced ? this._drag.payload.index : -1;
    ctx.pizza.toppings.forEach((t, i) => {
      if (i === carriedIndex) return;
      circle(g, t.x, t.y, TOPPING_RADIUS, toppingColor(t.type), "rgba(0,0,0,0.35)");
    });

    // The topping currently being carried follows the cursor as a ghost.
    if (this._drag.carrying && this._drag.point) {
      const payload = this._drag.payload;
      g.save();
      g.globalAlpha = 0.75;
      if (payload.kind === "sauce") {
        circle(g, this._drag.point.x, this._drag.point.y, SAUCE_WIDTH / 2, SAUCE_COLOR);
      } else if (payload.kind === "cheese") {
        circle(g, this._drag.point.x, this._drag.point.y, 28, CHEESE_BIN.color, "rgba(0,0,0,0.35)");
      } else {
        circle(
          g,
          this._drag.point.x,
          this._drag.point.y,
          TOPPING_RADIUS,
          toppingColor(payload.type),
          "rgba(0,0,0,0.5)"
        );
      }
      g.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Bake station (AC#10, AC#11)
// ---------------------------------------------------------------------------
// Full bake credit if the pull is within this many seconds of the ticket.
// Shared by the oven meter and ratePizza so the green "pull now" band is
// exactly the window that scores a point. 1s is the tightest band that still
// survives webcam lag and a single slow frame.
const BAKE_TOLERANCE_SECONDS = 1;

// One stalled frame must not jump the clock across the whole pull window
// (2s wide). 0.25s keeps a hitch inside that window; a backgrounded tab
// under-counts instead of burning the pizza. MediaPipe frames are usually
// well under this.
const BAKE_MAX_FRAME_SECONDS = 0.25;

// Oven body, the dark mouth the pizza sits in, and the glove rack.
// Hit tests use these same rects, so the art and the grab/drop targets match.
const OVEN = { x: 420, y: 172, w: 440, h: 400 };
const OVEN_MOUTH = { x: 468, y: 228, w: 344, h: 268 };
const PIZZA_IN_OVEN = {
  cx: OVEN_MOUTH.x + OVEN_MOUTH.w / 2,
  cy: OVEN_MOUTH.y + OVEN_MOUTH.h / 2,
  r: 108,
};
// Where the pizza rests once it's out, clear of the oven and the glove.
const PIZZA_OUT = { cx: 200, cy: 390, r: 140 };
const GLOVE = { x: 980, y: 300, w: 130, h: 150, color: "#d35400" };
const BAKE_METER = { x: 420, y: 600, w: 440, h: 22 };

const BAKE_TIMING_COLOR = {
  early: "#e0a458",
  ready: "#8fd9a8",
  late: "#f0a8a0",
  open: "#e8eef2",
};

/** "early" / "ready" / "late" against the ticket, or "open" when there isn't one. */
function bakeTiming(elapsed, target) {
  if (!(target > 0)) return "open";
  const diff = elapsed - target;
  if (diff < -BAKE_TOLERANCE_SECONDS) return "early";
  if (diff > BAKE_TOLERANCE_SECONDS) return "late";
  return "ready";
}

/**
 * The pizza as it exists right now: crust, anything already added, and a
 * brown wash that deepens the longer it has been in the oven.
 * `dest` is a circle in canvas pixels. Toppings live in dough space.
 */
function drawPizzaFace(g, dest, pizza, elapsed, target) {
  circle(g, dest.cx, dest.cy, dest.r, "#e8c98a", "#8a6232");
  if (pizza.cheese) drawCheeseLayer(g, dest);

  const scale = dest.r / DOUGH.r;
  drawSauceTrail(g, pizza.sauce, dest);

  for (const t of pizza.toppings) {
    circle(
      g,
      dest.cx + (t.x - DOUGH.cx) * scale,
      dest.cy + (t.y - DOUGH.cy) * scale,
      Math.max(5, TOPPING_RADIUS * scale),
      toppingColor(t.type),
      "rgba(0,0,0,0.35)"
    );
  }

  // Brown the middle only, so the crust ring stays visible. Capped so the
  // toppings still read after the ticket time. Without a ticket, 8s is the
  // same stand-in the menu uses for a middle-length bake.
  const goal = target > 0 ? target : 8;
  const alpha = Math.min(0.45, (elapsed / goal) * 0.38);
  if (alpha > 0) {
    circle(g, dest.cx, dest.cy, dest.r * 0.9, `rgba(90, 42, 12, ${alpha.toFixed(3)})`);
  }
}

function drawBakeMeter(g, elapsed, target) {
  if (!(target > 0)) return;
  const { x, y, w, h } = BAKE_METER;
  // Room past the late edge so a miss doesn't pin the marker to the end
  // the instant the window closes.
  const span = target + BAKE_TOLERANCE_SECONDS + 3;
  const win0 = ((target - BAKE_TOLERANCE_SECONDS) / span) * w;
  const win1 = ((target + BAKE_TOLERANCE_SECONDS) / span) * w;

  g.fillStyle = "#2c2f33";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(143, 217, 168, 0.45)";
  g.fillRect(x + win0, y, Math.max(2, win1 - win0), h);
  g.strokeStyle = "rgba(232,238,242,0.35)";
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);

  const mx = x + Math.min(w, Math.max(0, elapsed / span) * w);
  g.fillStyle = BAKE_TIMING_COLOR[bakeTiming(elapsed, target)];
  g.fillRect(mx - 2, y - 4, 4, h + 8);
}

export class BakeStation extends Station {
  constructor() {
    super(STATIONS.BAKE);
    // Same grab / drag / drop helper the topping bins use.
    this._drag = new PinchDragTracker();
  }

  onEnter(ctx) {
    // AC#10: arriving puts the pizza in. Coming back must not restart the
    // clock or shove a finished pizza back into the oven.
    if (!ctx.pizza.removedFromOven) {
      ctx.pizza.inOven = true;
    }
  }

  onExit() {
    // Leaving mid-pinch cancels the grab. The pizza stays where it was.
    this._drag.reset();
  }

  update(ctx) {
    const pizza = ctx.pizza;
    // The oven clock is advanced by the game loop (advanceOven), including
    // while this station is off screen, so the next pizza can be started
    // while this one keeps baking. It stops once the glove pulls the pizza.

    // AC#11: pinch the glove, drag it onto the pizza, release to take it out.
    // Releasing anywhere else puts the glove back and leaves the pizza in.
    this._drag.update(ctx.gesture, {
      onGrab: (point) => {
        if (!pizza.inOven || pizza.removedFromOven) return null;
        return pointInRect(point, GLOVE) ? "glove" : null;
      },
      onDrop: (_payload, point) => {
        if (!pizza.inOven || pizza.removedFromOven) return;
        // The dark mouth is the pizza's home while it bakes. The drawn pie is
        // smaller than that opening; a fingertip cursor needs the whole mouth
        // or the pull feels like it missed.
        if (!pointInRect(point, OVEN_MOUTH)) return;
        pizza.inOven = false;
        pizza.removedFromOven = true;
      },
    });
  }

  render(ctx) {
    const g = ctx.ctx;
    const pizza = ctx.pizza;
    const target = ctx.order ? ctx.order.bakeSeconds : 0;
    const timing = bakeTiming(pizza.bakeElapsed, target);
    const out = pizza.removedFromOven;
    const baking = pizza.inOven && !out;

    title(g, out ? "Bake station — pizza's out" : "Bake station");

    let hint = "Pinch the glove and release it on the pizza. Pull in the green.";
    if (!baking && !out) hint = "The pizza goes in when you arrive.";
    else if (out) hint = "Hold thumbs right for the cut station.";
    else if (timing === "ready") hint = "Pull now.";
    else if (timing === "late") hint = "Past the green. The glove still takes it out.";
    else if (timing === "open") hint = "Pinch the glove and release it on the pizza.";
    lightCaption(g, hint, 640, 70);

    const readout = target > 0
      ? `${pizza.bakeElapsed.toFixed(1)} / ${target}s`
      : `${pizza.bakeElapsed.toFixed(1)}s`;
    g.fillStyle = BAKE_TIMING_COLOR[timing];
    g.font = "32px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(readout, 640, 108);

    let word = "baking";
    if (!baking && !out) word = "";
    else if (out) word = "out";
    else if (timing === "ready") word = "pull now";
    else if (timing === "late") word = "too long";
    if (word) lightCaption(g, word, 640, 140);

    labelBox(g, OVEN.x, OVEN.y, OVEN.w, OVEN.h, "#7f8c8d", "");
    g.fillStyle = "#2c2f33";
    g.fillRect(OVEN_MOUTH.x, OVEN_MOUTH.y, OVEN_MOUTH.w, OVEN_MOUTH.h);
    caption(g, "oven", OVEN.x + OVEN.w / 2, OVEN.y + 28);

    if (baking) {
      drawPizzaFace(g, PIZZA_IN_OVEN, pizza, pizza.bakeElapsed, target);
    } else {
      lightCaption(g, "empty", PIZZA_IN_OVEN.cx, PIZZA_IN_OVEN.cy);
    }

    if (out) {
      drawPizzaFace(g, PIZZA_OUT, pizza, pizza.bakeElapsed, target);
    }

    if (this._drag.carrying && this._drag.point) {
      g.save();
      g.strokeStyle = "rgba(211, 84, 0, 0.45)";
      g.lineWidth = 2;
      g.strokeRect(GLOVE.x, GLOVE.y, GLOVE.w, GLOVE.h);
      g.globalAlpha = 0.8;
      labelBox(
        g,
        this._drag.point.x - GLOVE.w / 2,
        this._drag.point.y - GLOVE.h / 2,
        GLOVE.w,
        GLOVE.h,
        GLOVE.color,
        "glove"
      );
      g.restore();
    } else {
      g.save();
      // Dim the rack once the pizza is out so a second pinch doesn't look live.
      if (out) g.globalAlpha = 0.45;
      labelBox(g, GLOVE.x, GLOVE.y, GLOVE.w, GLOVE.h, GLOVE.color, "glove");
      g.restore();
    }

    drawBakeMeter(g, pizza.bakeElapsed, target);
  }
}

// ---------------------------------------------------------------------------
// 4. Cut station (AC#12)
// ---------------------------------------------------------------------------
// The pie you cut. Toppings still live in dough space; drawPizzaFace maps them.
const CUT_PIZZA = { cx: 640, cy: 400, r: 190 };

// Parked cutter: wheel, handle sticking out to the right. The hit rect covers
// both, with a little padding — the handle is thin and the cursor is one point.
const SLICER_WHEEL = { x: 1040, y: 400, r: 40 };
const SLICER_HANDLE_LEN = 160;
const SLICER_HANDLE_H = 56;
const SLICER_HIT = { x: 988, y: 348, w: 250, h: 104 };

// A swipe has to travel this far inside the pie before it counts. 0.55 × radius
// is about a quarter of the diameter: long enough that tapping the crust does
// not add a cut, short enough that a webcam drag through the middle still does
// even if the hand stops before the far edge.
const CUT_MIN_LENGTH_RATIO = 0.55;

/** Portion of segment a→b that lies inside the circle, or null if it misses. */
function clipSegmentToCircle(a, b, circle) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - circle.cx;
  const fy = a.y - circle.cy;
  const A = dx * dx + dy * dy;
  if (A === 0) return null;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - circle.r * circle.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const lo = Math.min((-B - root) / (2 * A), (-B + root) / (2 * A));
  const hi = Math.max((-B - root) / (2 * A), (-B + root) / (2 * A));
  const enter = Math.max(0, lo);
  const exit = Math.min(1, hi);
  if (enter >= exit) return null;
  return {
    x1: a.x + dx * enter,
    y1: a.y + dy * enter,
    x2: a.x + dx * exit,
    y2: a.y + dy * exit,
  };
}

/**
 * One straight cut for a whole drag. Uses the first place the path enters the
 * pie and the last place it leaves, so lining the slicer up outside the crust
 * does not aim the cut back at the rack. One drag stays one line (AC#12).
 * @returns {{x1:number,y1:number,x2:number,y2:number,length:number}|null}
 */
function strokeAcrossPizza(path, circle) {
  if (!path || path.length < 2) return null;
  let enter = null;
  let exit = null;
  for (let i = 0; i < path.length - 1; i++) {
    const chord = clipSegmentToCircle(path[i], path[i + 1], circle);
    if (!chord) continue;
    if (!enter) enter = { x: chord.x1, y: chord.y1 };
    exit = { x: chord.x2, y: chord.y2 };
  }
  if (!enter || !exit) return null;
  const length = Math.hypot(exit.x - enter.x, exit.y - enter.y);
  return { x1: enter.x, y1: enter.y, x2: exit.x, y2: exit.y, length };
}

function cutCounts(stroke, circle) {
  return !!stroke && stroke.length >= circle.r * CUT_MIN_LENGTH_RATIO;
}

function drawCut(g, cut, color, width) {
  g.save();
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(cut.x1, cut.y1);
  g.lineTo(cut.x2, cut.y2);
  g.strokeStyle = "rgba(27,31,36,0.5)";
  g.lineWidth = width + 4;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.restore();
}

/** Wheel at (x, y), handle along +x in local space, then rotated by `angle`. */
function drawSlicer(g, x, y, angle, labeled) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const r = SLICER_WHEEL.r;
  // Handle first, then the wheel, so the cutter reads as a wheel leading the swipe.
  const hx = r * 0.55;
  const hy = -SLICER_HANDLE_H / 2;
  g.fillStyle = "#d5dbe0";
  g.fillRect(hx, hy, SLICER_HANDLE_LEN, SLICER_HANDLE_H);
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 2;
  g.strokeRect(hx, hy, SLICER_HANDLE_LEN, SLICER_HANDLE_H);
  if (labeled) caption(g, "slicer", hx + SLICER_HANDLE_LEN / 2, 0);
  circle(g, 0, 0, r, "#8b949c", "#2c3e50");
  g.restore();
}

export class CutStation extends Station {
  constructor() {
    super(STATIONS.CUT);
    this._drag = new PinchDragTracker();
    /** @type {{x:number,y:number}[]} cursor samples for the drag in progress. */
    this._path = [];
  }

  onExit() {
    // Leaving mid-swipe cancels it. Cuts already on the pizza stay.
    this._drag.reset();
    this._path = [];
  }

  update(ctx) {
    const pizza = ctx.pizza;
    this._drag.update(ctx.gesture, {
      onGrab: (point) => {
        if (!pointInRect(point, SLICER_HIT)) return null;
        this._path = [{ x: point.x, y: point.y }];
        return "slicer";
      },
      // AC#12: one drag across the pizza adds one line. A miss, or a nick on
      // the crust, puts the slicer back and does not count. The rating (AC#13)
      // compares pizza.cuts.length to the ticket's slice count.
      onDrop: () => {
        const stroke = strokeAcrossPizza(this._path, CUT_PIZZA);
        if (cutCounts(stroke, CUT_PIZZA)) {
          pizza.cuts.push({
            x1: stroke.x1,
            y1: stroke.y1,
            x2: stroke.x2,
            y2: stroke.y2,
          });
        }
        this._path = [];
      },
    });

    if (this._drag.carrying && this._drag.point) {
      const p = this._drag.point;
      const last = this._path[this._path.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) {
        this._path.push({ x: p.x, y: p.y });
      }
    }
  }

  render(ctx) {
    const g = ctx.ctx;
    const pizza = ctx.pizza;
    const target = ctx.order ? ctx.order.slices : 0;
    const count = pizza.cuts.length;
    let phase = "open";
    if (target > 0 && count === target) phase = "ready";
    else if (target > 0 && count > target) phase = "late";
    else if (target > 0) phase = "early";

    const preview = this._drag.carrying
      ? strokeAcrossPizza(this._path, CUT_PIZZA)
      : null;
    const previewCounts = cutCounts(preview, CUT_PIZZA);

    title(g, "Cut station");

    let hint = target > 0
      ? `One drag across the pizza makes one cut. The ticket wants ${target}.`
      : "One drag across the pizza makes one cut.";
    if (previewCounts) hint = "Release to cut.";
    else if (phase === "ready") hint = "Hold thumbs right to serve.";
    else if (phase === "late") hint = `Too many cuts. The ticket wanted ${target}.`;
    lightCaption(g, hint, 640, 64);

    g.fillStyle = BAKE_TIMING_COLOR[phase];
    g.font = "32px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(target > 0 ? `${count} / ${target}` : `${count}`, 640, 104);

    let word = "";
    if (phase === "ready") word = "that's the ticket";
    else if (phase === "late") word = "too many";
    else if (phase === "early") word = `${target - count} to go`;
    if (word) lightCaption(g, word, 640, 138);

    drawPizzaFace(g, CUT_PIZZA, pizza, pizza.bakeElapsed, ctx.order ? ctx.order.bakeSeconds : 0);
    for (const cut of pizza.cuts) {
      drawCut(g, cut, "rgba(255,255,255,0.95)", 3);
    }
    if (preview) {
      drawCut(
        g,
        preview,
        previewCounts ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
        previewCounts ? 3 : 2
      );
    }

    if (this._drag.carrying && this._drag.point) {
      const start = this._path[0] || this._drag.point;
      const angle = Math.atan2(
        this._drag.point.y - start.y,
        this._drag.point.x - start.x
      );
      g.save();
      g.globalAlpha = 0.35;
      drawSlicer(g, SLICER_WHEEL.x, SLICER_WHEEL.y, 0, true);
      g.restore();
      // Wheel leads the swipe; the handle trails back toward where the drag began.
      drawSlicer(g, this._drag.point.x, this._drag.point.y, angle + Math.PI, false);
    } else {
      drawSlicer(g, SLICER_WHEEL.x, SLICER_WHEEL.y, 0, true);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Serve station (AC#13)
// ---------------------------------------------------------------------------
// A placed topping counts only if it is the requested type and its center is
// within this many pixels of the ticket spot. 48px still overlaps the dashed
// ring (radius 24) and stays inside half the gap between the closest same-type
// targets (80px), so one blob cannot fill two rings.
const TOPPING_MATCH_RADIUS = 48;

/**
 * Compare the finished pizza to the ticket.
 * 3 points toppings, 1 bake time, 1 slice count. Stars are the whole points
 * only, so a near miss does not round up to a perfect score.
 * Cheese and sauce are not on the ticket, so they are not scored.
 * @param {Order} order
 * @param {Pizza} pizza
 */
function ratePizza(order, pizza) {
  const available = pizza.toppings.map((t) => ({ ...t, used: false }));
  let matched = 0;
  for (const want of order.requestedToppings) {
    let best = null;
    let bestDist = TOPPING_MATCH_RADIUS;
    for (const placed of available) {
      if (placed.used || placed.type !== want.type) continue;
      const dist = Math.hypot(placed.x - want.x, placed.y - want.y);
      if (dist <= bestDist) {
        best = placed;
        bestDist = dist;
      }
    }
    if (best) {
      best.used = true;
      matched += 1;
    }
  }
  const extras = available.filter((t) => !t.used).length;
  const requestedCount = order.requestedToppings.length;
  let toppingPoints = requestedCount === 0 ? 0 : (matched / requestedCount) * 3;
  toppingPoints = Math.max(0, toppingPoints - extras * 0.25);

  const bakeTarget = order.bakeSeconds;
  const bakeActual = pizza.bakeElapsed;
  const bakeDiff = Math.abs(bakeActual - bakeTarget);
  let bakePoints = 0;
  if (bakeDiff <= BAKE_TOLERANCE_SECONDS) {
    bakePoints = 1;
  } else if (bakeTarget > BAKE_TOLERANCE_SECONDS) {
    const span = bakeTarget - BAKE_TOLERANCE_SECONDS;
    bakePoints = Math.max(0, 1 - (bakeDiff - BAKE_TOLERANCE_SECONDS) / span);
  }

  const cutCount = pizza.cuts.length;
  const sliceTarget = order.slices;
  const slicePoints =
    sliceTarget <= 0
      ? cutCount === 0
        ? 1
        : 0
      : Math.max(0, 1 - Math.abs(cutCount - sliceTarget) / sliceTarget);

  const total = toppingPoints + bakePoints + slicePoints;
  const stars = Math.max(0, Math.min(5, Math.floor(total + 1e-6)));
  const extraNote = extras ? ` (${extras} extra)` : "";
  const summary =
    `${stars}/5 stars — toppings ${matched}/${requestedCount}${extraNote}` +
    `, bake ${bakeActual.toFixed(1)}s vs ${bakeTarget}s, cuts ${cutCount}/${sliceTarget}`;

  return {
    stars,
    total,
    matched,
    requested: requestedCount,
    extras,
    bakeActual,
    bakeTarget,
    cutCount,
    sliceTarget,
    summary,
  };
}

function customerMood(stars) {
  if (stars >= 4) return "loved it";
  if (stars >= 2) return "pretty good";
  return "not quite";
}

export class ServeStation extends Station {
  constructor() {
    super(STATIONS.SERVE);
  }

  update(ctx) {
    // AC#13: one thumbs up serves. Holding it must not re-score. AC#3 keeps
    // thumbs up off Topping, Bake, and Cut; this handler only runs here.
    if (ctx.rating || !ctx.gesture.thumbsUp || !ctx.order) return;
    ctx.rating = ratePizza(ctx.order, ctx.pizza);
  }

  render(ctx) {
    const g = ctx.ctx;
    const rating = ctx.rating;
    const order = ctx.order;
    title(
      g,
      !order
        ? "Serve station — take an order before serving"
        : rating
          ? "Served"
          : "Serve station — thumbs up to serve"
    );

    customer(g, 260, 180, "");
    g.fillStyle = "rgba(232,238,242,0.85)";
    g.font = "16px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(rating ? customerMood(rating.stars) : "waiting", 260, 180 + 164);

    const rx = 620;
    const ry = 200;
    labelBox(g, rx, ry, 420, 220, "#fdf6e3", "");
    g.fillStyle = "#1b1f24";
    g.font = "18px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("RATING", rx + 20, ry + 16);

    for (let i = 0; i < 5; i++) {
      const filled = rating && i < rating.stars;
      circle(g, rx + 60 + i * 72, ry + 78, 22, filled ? "#f4d35e" : "#eee", "#caa24a");
      caption(g, "★", rx + 60 + i * 72, ry + 78);
    }

    g.fillStyle = "#1b1f24";
    g.font = "15px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    if (!order) {
      g.fillText("Take an order first.", rx + 20, ry + 130);
      return;
    }
    if (!rating) {
      g.fillText("Thumbs up to serve.", rx + 20, ry + 130);
      g.fillText("Toppings, bake time, and slices are scored.", rx + 20, ry + 156);
      return;
    }
    g.fillText(
      `toppings ${rating.matched}/${rating.requested}` +
        (rating.extras ? ` · ${rating.extras} extra` : ""),
      rx + 20,
      ry + 124
    );
    g.fillText(
      `bake ${rating.bakeActual.toFixed(1)}s vs ${rating.bakeTarget}s`,
      rx + 20,
      ry + 150
    );
    g.fillText(`cuts ${rating.cutCount}/${rating.sliceTarget}`, rx + 20, ry + 176);
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

/**
 * A ticket plus the pizza being made for it. Several can exist at once: one
 * baking, one being built, one waiting to be cut and served.
 * @typedef {Object} PizzaJob
 * @property {Order|null} order
 * @property {Pizza} pizza
 * @property {Rating|null} rating
 */

/** The pizza you're assembling: not in the oven, not pulled out, not served. */
export function isBuildJob(job) {
  const pizza = job.pizza;
  return !job.rating && !pizza.inOven && !pizza.removedFromOven;
}

function pizzaInOven(job) {
  return job.pizza.inOven && !job.pizza.removedFromOven;
}

function isOvenJob(job) {
  return pizzaInOven(job) && !job.rating;
}

function isReadyJob(job) {
  return job.pizza.removedFromOven && !job.rating;
}

/** The player has actually started this pizza, not just walked it into the oven. */
function isStartedJob(job) {
  const pizza = job.pizza;
  if (job.order) return true;
  if (pizza.cheese || pizza.toppings.length || pizza.cuts.length) return true;
  return pizza.sauce.some((dab) => dab && !dab.gap);
}

/**
 * Which job a station should show.
 * Order and topping show the pizza being built.
 * Bake shows the one in the oven, or the next started pizza once the oven is free.
 * Cut and serve show the one that has come out, else the one still baking.
 * @param {PizzaJob[]} jobs
 * @param {string} station
 * @returns {PizzaJob}
 */
export function pickJob(jobs, station) {
  const build = jobs.find(isBuildJob) || null;
  const oven = jobs.find(isOvenJob) || null;
  const ready = jobs.find(isReadyJob) || null;
  const startedBuild = build && isStartedJob(build) ? build : null;
  const last = jobs[jobs.length - 1];

  if (station === STATIONS.ORDER || station === STATIONS.TOPPING) {
    return build || ready || last;
  }
  if (station === STATIONS.BAKE) {
    // The oven holds one pizza. Show it even after it has been served, so a
    // second pizza is not walked in on top of it.
    const sitting = jobs.find(pizzaInOven) || null;
    if (sitting) return sitting;
    if (startedBuild) return startedBuild;
    return ready || build || last;
  }
  return ready || oven || startedBuild || build || last;
}

/**
 * True when the player should get a fresh ticket: a started pizza is baking
 * and nothing is waiting to be built, or every pizza so far has been served.
 * @param {PizzaJob[]} jobs
 */
export function needsBuildJob(jobs) {
  if (jobs.some(isBuildJob)) return false;
  const oven = jobs.find(isOvenJob);
  if (oven && isStartedJob(oven)) return true;
  return jobs.length > 0 && jobs.every((job) => job.rating);
}

/**
 * Open a ticket before choosing what this visit shows. Entering Order while a
 * started pizza bakes starts the next one. Any station does, once every pizza
 * has been served. Entering Topping must not, or a pizza that went into the
 * oven before it was ordered would lose its topping station to a blank pie.
 * @param {PizzaJob[]} jobs
 * @param {string} station
 */
export function shouldOpenTicket(jobs, station) {
  if (jobs.some(isBuildJob)) return false;
  if (jobs.length > 0 && jobs.every((job) => job.rating)) return true;
  if (station !== STATIONS.ORDER) return false;
  const oven = jobs.find(isOvenJob);
  return !!(oven && isStartedJob(oven));
}

/** The pizza still baking, if any. A served pizza no longer counts. */
export function findOvenJob(jobs) {
  return jobs.find(isOvenJob) || null;
}

/**
 * Keep the oven clock moving while the player is on any station. One frame
 * is capped so a stall cannot skip the whole pull window. A pizza that has
 * been pulled out does not advance. The game loop skips one that was served.
 * @param {Pizza} pizza
 * @param {number} dt seconds
 */

export function advanceOven(pizza, dt) {
  if (!pizza || !pizza.inOven || pizza.removedFromOven) return;
  const step = Math.min(BAKE_MAX_FRAME_SECONDS, Math.max(0, dt || 0));
  pizza.bakeElapsed += step;
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
