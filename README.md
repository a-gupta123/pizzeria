# Gesture-Controlled Papa's Pizzeria

Original game and spec by [meabhhenn](https://github.com/meabhhenn/HW7). This repo continues that handoff.

Make pizzas with hand gestures tracked by your webcam (MediaPipe, in the
browser). Five stations: Order → Topping → Bake → Cut → Serve. A second
pizza can be started while one is in the oven. Full design and acceptance
criteria (AC#n) are in [`SPEC.md`](./SPEC.md).

**Status:** Every acceptance criterion in SPEC.md is implemented, including
the stretch: the next order can start while one pizza bakes. The oven clock
keeps running on every station. After a pizza is served, thumbs up at Order
starts another.

## Install and run

No build step. Needs Chrome, a webcam, and internet on first load (MediaPipe
loads from a CDN).

```bash
python3 -m http.server 8000
```

Open **http://localhost:8000**, click **Start camera**, and allow camera access.

## Controls So Far

Gesture: Action: Where
Move index finger: Move cursor: Everywhere
Hold thumbs right (~0.6s): Next station: Everywhere
Hold thumbs left (~0.6s): Previous station: Everywhere
Pinch / hold / release: Grab a topping, drag, drop on the dough: Topping station
Pinch and drag across the dough: Add sauce along the path: Topping station
Pinch the cheese bin, release over the dough: Cover the pizza with cheese: Topping station
Pinch a topping on the pizza, release over the trash: Remove it: Topping station
Pinch the glove, drag onto the pizza, release: Take the pizza out (clock stops): Bake station
Pinch the slicer, drag across the pizza, release: One cut per drag: Cut station
Thumbs up: Take the order (ticket shows toppings, where, bake time, slices): Order station
Thumbs up while a pizza is baking: Take the next order. The oven clock keeps running, and the baking ticket stays on the oven readout: Order station
Thumbs up: Serve the pizza and show a 5-star rating: Serve station

Left/right are from the player's point of view (the camera is mirrored in code).

## Acceptance criteria status

AC Number: Status: Notes
#1 Cursor: Working
#2 Order ticket: Working: Thumbs up at Order fills toppings and where they go, bake time, and slices. Dashed rings on the dough repeat the placement.
#3 Thumbs up blocked at middle stations: Working: `game.js` strips thumbs up before Topping, Bake, and Cut see it. Order takes the ticket; Serve rates the pizza.
#4 Station switching: Working
#5 Quick flick ignored: Working: Part of #4 
#6 Sauce: Working: Pinch the sauce bin, or pinch on the dough, and drag. Sauce is laid where the cursor passes over the dough. Leaving the dough breaks the stroke. A pinch that starts on a topping does not paint. Sauce is not on the ticket, so the rating does not score it.
#7 Cheese: Working: Pinch the cheese bin and release over the dough. Cheese covers the pie inside the crust. A miss puts the handful back and does not remove cheese already there. Cheese is not on the ticket, so the rating does not score it.
#8 Place toppings: Working: Pepperoni and pepper bins only
#9 Trash: Working: Pinch a topping already on the pie and release it over the trash to remove it. Releasing anywhere else puts it back where it was. The closest blob wins when two overlap.
#10 Auto into oven: Working: Entering Bake puts the pizza in. The clock keeps running after you leave, so the next pizza can be started, and coming back does not restart it. A frame longer than 0.25s only counts 0.25s, so a stall cannot skip the pull window. The HUD shows the bake time on every station. A served pizza stops the clock.
#11 Glove takes pizza out: Working: Pinch the glove and release it on the oven mouth. A miss puts the glove back and leaves the pizza in. The clock stops on a hit. The green band is the ±1s window that scores a full bake point.
#12 Cutting: Working: Pinch the slicer and drag across the pizza. One drag adds one line, from where the swipe enters the pie to where it leaves. A short nick on the crust does not count. The count is scored against the ticket's slice number.
#13 Serve and rating: Working: Thumbs up at Serve scores toppings (type and position), bake time (±1s), and cut count against the ticket, then fills that many stars. Bake time is the live oven clock. The cut count is how many slicer drags crossed the pizza.

## Code map

- `index.html` / `styles.css`: page, canvas, HUD, Start button.
- `src/config.js`: all constants and thresholds. Tune here first.
- `src/handTracking.js`: camera + MediaPipe GestureRecognizer → landmarks,
  cursor, built-in gesture label.
- `src/gestures.js`: pinch, thumbs up, thumbs left/right. Also
  **`PinchDragTracker`**, the reusable grab/drag/drop helper. Use it for
  cheese, sauce, trash, glove, and slicer.
- `src/stations.js`: one class per station (`update()` for rules, `render()`
  for drawing). Shared layout constants keep hit-tests and graphics aligned.
- `src/game.js`: main loop, station switching, routing gestures to stations.

## What to do next

Nothing in SPEC.md is left. The stretch is in: one pizza bakes while you take and top the next order, and serving the last pizza lets thumbs up at Order start another. The oven still holds one pizza at a time.

## Known bugs

- **Pinch no longer switches stations.** A sideways pinch used to satisfy the
  thumbs-left/right pose and jump stations mid-drag. `gestures.js` now skips
  that check while a pinch is held, and the hold timer resets so letting go
  does not immediately switch.
- **Thresholds are lightly tested.** Pinch and thumbs work on the author's
  webcam but aren't tuned for other hands or lighting. Adjust in `config.js`.

### Possible traps (not observed)

- If tracking drops mid-drag, a topping may be placed, cheese may be added,
  a held topping may land in the trash, the pizza pulled from the oven, or a
  cut committed, at the last cursor position. Sauce is painted as the cursor
  moves, so a lost hand keeps the trail drawn so far.
- MediaPipe uses the GPU; on machines without WebGL, switch to `"CPU"` in
  `handTracking.js`.

## Where corners were cut

- Built one AC at a time in priority order, so the risky parts (tracking,
  switching, pinch) work and the rest are deliberately placeholders.
- Graphics are basic canvas shapes to lock in layout and hit areas cheaply.
- No tests or bundler, to keep it zero-install. Test by hand in the browser.