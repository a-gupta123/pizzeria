to Kiro:
PROMPT 1: Read SPEC.md. Set up the project structure for this game. Use separate files for hand tracking, gesture detection, the stations, and the main game loop. Don’t implement features yet; just the skeleton TPDOwith comments pointing to the acceptance criteria.

PROMPT 2: Implement AC#1 only, then stop so I can test it.

PROMPT 3: Implement acceptance criterion 4 from SPEC.md: holding thumbs right switches to the next station, holding thumbs left switches to the previous one. Direction is from the player's point of view (account for the mirrored camera).

1. In handTracking.js, switch from HandLandmarker to  GestureRecognizer so wealso get built-in gestures (needed later for thumbs up). Keep the cursor behavior from AC#1 exactly as it is.
2. In gestures.js, implement the custom thumbs left/right check: thumb extended, other fingers curled, thumb tip left or right of the wrist. It must be held for the duration in config.js before it counts.
3. In game.js, use it to switch stations, and show the current station name in the HUD.

Only change handTracking.js, gestures.js, game.js, and config.js. Don't implement pinch or any station logic yet. Use descriptive names and comment why each threshold was chosen. Stop when done so I can test.

PROMPT 4: Add simple placeholder graphics for each station in stations.js, so someone reading the code can see the intended layout of the game. Use basic canvas shapes and text labels only (circles, rectangles, colors). No images or
animations.
- Order: a customer shape and an order ticket area
- Topping: the dough circle in the center, labeled bins for sauce, cheese,
  and a few toppings, and a trash can
- Bake: an oven and a glove
- Cut: the pizza and a slicer
- Serve: the customer and a rating area
Only change the render() methods in stations.js. Don't add any interaction or game logic. Keep the cursor and station switching working. Add a comment in each render() saying these are placeholders. Stop when done so I can test.

PROMPT 5: Implement acceptance criterion 8 from SPEC.md: at the Topping station, pinching over a topping bin picks up that topping; releasing the pinch over the pizza places it at the cursor's position.

1. In gestures.js, implement pinch detection (thumb tip and index tip close together) with start / hold / release events, using a threshold in config.js. Write it as a reusable pinch-and-drag helper, since sauce, cheese, trash, glove, and slicer will reuse it later.
2. In stations.js, use it in the Topping station only: pinch over a bin to
   pick up that topping, the held topping follows the cursor, release over the dough to place it there. Releasing off the pizza drops it (it disappears). Placed toppings stay on the pizza.
3. Use the existing bin positions from the placeholder graphics.

Don't implement sauce, cheese, trash, or any other station yet. Keep the cursor and station switching working. Comment why each threshold was chosen.
Stop when done so I can test.

PROMPT 6: Update README.md for the developer who will take over this project without being able to ask me questions. Include:
- How to install and run it
- Controls
- Each acceptance criterion from SPEC.md marked as working, partial, or not started. Only mark something working if it's actually implemented.
- A code map: what each file is responsible for
- What to do next, in priority order
- Known bugs and traps
- Where corners were cut and why
Also make sure each file has a short header comment explaining its job, and
TODOs point to the acceptance criterion numbers. Don't change any logic.

Phase 2 prompts, sent in Cursor. Verbatim.

PROMPT 1:
read https://github.com/meabhhenn/HW7 and SPEC.md. don't change anything. list unfinished acceptance criteria in README build order. when i say go, do one phase at a time and stop so i can test.

PROMPT 2:
fix pinch switching stations. ignore thumbs left/right during a pinch and reset the hold timer on release. a normal 0.6s thumbs hold should still switch. don't add station features.

PROMPT 3:
build order. thumbs up takes one ticket with topping types/positions, bake time, and slices. holding shouldn't reroll. keep it in the top bar and show dashed placement rings. only use pepperoni and pepper. thumbs up at topping, bake, and cut should do nothing.

PROMPT 4:
build serve. thumbs up scores once against the ticket. show stars and a breakdown for topping type/position, bake time within 1s, and cut count. don't score sauce or cheese. bake/cut points can stay empty until implemented.

PROMPT 5:
build bake. entering starts the oven timer once; leaving and returning shouldn't reset it. pinch the glove, drag to the oven mouth, and release to remove the pizza. misses reset the glove and keep baking. show the ±1s green band and cap elapsed time per frame at 0.25s.

PROMPT 6:
build cut. pinch the slicer and swipe across the pizza to add one line from entry to exit. short crust nicks shouldn't count. score cuts against ticket slices, so 4 slices means 4 cuts. show whether it matches.

PROMPT 7:
add cheese. pinch the bin and release over dough to cover inside the crust, under toppings. misses return the handful without removing existing cheese. dim the bin after adding it. don't score cheese.

PROMPT 8:
add sauce. pinch the sauce bin or empty dough and drag to paint inside the dough. leaving it breaks the stroke. starting on a topping shouldn't paint. don't score sauce.

PROMPT 9:
add trash. grab an existing topping and release over trash to delete it. anywhere else returns it to its original spot. grab the closest topping if they overlap. grabbing toppings shouldn't paint sauce.

PROMPT 10:
build the stretch. keep one pizza in the oven while i take and top the next order. only allow the next ticket once a started pizza is baking. keep the timer running everywhere and show it in the top bar. don't bake blank pizzas. allow another order after the last pizza is served.

PROMPT 11:
how many acceptance criteria from SPEC.md and README are still missing? name them.

PROMPT 12:
 is every SPEC.md criterion done, including the stretch? list only anything missing or rough.

PROMPT 13:
explain how to run and play it, station by station, using the README.

PROMPT 14:
is everything committed, and is there a github remote? what's still only local?

PROMPT 15:
ead the phase 2 assignment rules and tell me the required commit order and what this folder is missing.

PROMPT 16:
give me this project's github remote url, or tell me if it doesn't have one.

PROMPT 17:
commit my changes and push to https://github.com/meabhhenn/HW7. don't force push or rewrite history. stop if i don't have write access.
The prompt log is not updated on the github repo, attach my exact prompts there

