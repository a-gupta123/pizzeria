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