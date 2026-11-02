# Gesture-Controlled Papa's Pizzeria

Make pizzas with hand gestures tracked by your webcam (MediaPipe, in the
browser). One pizza at a time through five stations: Order → Topping → Bake →
Cut → Serve. Full design and acceptance criteria (AC#n) are in
[`SPEC.md`](./SPEC.md).

**Status:** Hand cursor, station switching, and placing toppings work. Other
stations have placeholder graphics and `TODO(AC#n)` markers only.

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
Pinch / hold / release: Grab, drag, drop: Topping station

Left/right are from the player's point of view (the camera is mirrored in code).

## Acceptance criteria status

AC Number: Status: Notes
#1 Cursor: Working
#2 Order ticket: Not started: Placeholder ticket only
#3 Thumbs up blocked at middle stations: Partial: Guard exists, but nothing uses thumbs up yet
#4 Station switching: Working
#5 Quick flick ignored: Working: Part of #4 
#6 Sauce: Not started: Bin drawn, not interactive
#7 Cheese: Not started: Bin drawn, not interactive
#8 Place toppings: Working:Pepperoni and pepper bins only
#9 Trash: Not started: Drawn only
#10 Auto into oven: Not started
#11 Glove takes pizza out: Not started: Drawn only
#12 Cutting: Not started: Drawn only
#13 Serve and rating: Not started: Placeholder stars only

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

All MUST items (AC#1, #4, #8) are done. In order:

1. **AC#2** order + ticket (needed for the rating)
2. **AC#13** serve + rating (compare pizza to order)
3. **AC#10–11** baking
4. **AC#12** cutting
5. **AC#7** cheese (nearly free; reuses the AC#8 code)
6. Cut first if short on time: AC#6 sauce, AC#9 trash

## Known bugs

- **Pinch sometimes reads as thumbs left/right**, causing an accidental station
  switch. Likely fix: skip the thumbs check in `gestures.js` while pinching.
- **Thresholds are lightly tested.** Pinch and thumbs work on the author's
  webcam but aren't tuned for other hands or lighting. Adjust in `config.js`.

### Possible traps (not observed)

- If tracking drops mid-drag, a topping may be placed at the last cursor
  position.
- MediaPipe uses the GPU; on machines without WebGL, switch to `"CPU"` in
  `handTracking.js`.
- No reset between orders yet. You'll need one once serving works.

## Where corners were cut

- Built one AC at a time in priority order, so the risky parts (tracking,
  switching, pinch) work and the rest are deliberately placeholders.
- Graphics are basic canvas shapes to lock in layout and hit areas cheaply.
- No tests or bundler, to keep it zero-install. Test by hand in the browser.