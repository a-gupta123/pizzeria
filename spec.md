# SPEC: Gesture-Controlled Papa's Pizzeria

## The game
A single-player version of Papa's Pizzeria where you control everything with
finger and hand gestures seen by your computer's camera (MediaPipe hand
tracking). You handle one order at a time, moving through five stations:

1. **Order station.** A customer arrives with an order. The ticket shows which
   toppings go where, how long to bake, and how many slices.
2. **Topping station.** Add sauce, cheese, and toppings to the dough.
3. **Bake station.** The pizza goes into the oven automatically. Take it out
   at the right time.
4. **Cut station.** Cut the pizza into the requested number of slices.
5. **Serve.** Serve the pizza and the customer rates it.

Feel: Zen-vibe where player feels accomplished with creating one good pizza that is evaluated nicely (and accurately) by customer.

## Full intended feature set

**Gesture primitives**
- Hand cursor: the index fingertip position on screen.
- Pinch: thumb and index together to grab, hold to drag, release to drop.
- Thumbs up: built-in MediaPipe gesture.
- Thumbs left / thumbs right: custom check (not built into MediaPipe): thumb
  extended, other fingers curled, thumb tip left or right of the wrist. Must
  be held briefly so it doesn't trigger by accident.

**Gesture mapping**
Stage: Action: Gesture
Order: Take order: Thumbs up
Topping: Add sauce: Pinch and drag across the dough
Topping: Add cheese: Pinch over the bin, release over the pizza
Topping: Place topping: Pinch over the bin, release over the pizza
Topping: Remove misplaced topping: Pinch it, release over the trash
Bake: Put pizza in oven: Automatic
Bake: Take pizza out: Pinch the glove, drag to the pizza, release
Cut: Cut slices: Pinch the slicer, drag across the pizza (one drag = one cut)
Serve: Serve the pizza: Thumbs up
Any: Previous / next station: Thumbs left / thumbs right

**Rules**
- Thumbs up only counts at the Order and Serve stations.
- Left and right are from the player's point of view, not the mirrored
  camera image.
- One order at a time.

**Stretch**
- Multiple orders at once (start the next pizza while one bakes).

## Acceptance criteria
## Acceptance criteria
1. The player's index fingertip controls an on-screen cursor that follows
   their hand.
2. At the Order station, a thumbs up takes the customer's order and shows a
   ticket with the toppings, bake time, and number of slices.
3. Thumbs up does nothing at the Topping, Bake, or Cut stations.
4. Holding thumbs right for TODO seconds moves to the next station; thumbs
   left moves to the previous one. Direction is from the player's point of
   view.
5. A quick thumbs left/right (shorter than the hold time) does not switch
   stations.
6. At the Topping station, pinching and dragging across the dough adds sauce
   where the cursor passes.
7. Pinching over the cheese bin and releasing over the pizza adds cheese.
8. Pinching over a topping bin picks up that topping; releasing over the pizza
   places it at the cursor's position.
9. Pinching a topping already on the pizza and releasing it over the trash
   removes it.
10. When the player reaches the Bake station, the pizza goes into the oven
    automatically.
11. Pinching the glove, dragging it to the pizza, and releasing takes the
    pizza out of the oven.
12. At the Cut station, pinching the slicer and dragging across the pizza
    makes one cut line per drag.
13. At the Serve station, a thumbs up serves the pizza and the customer
    rates it.

## Priorities
- MUST: #1 (hand cursor). Every pinch interaction depends on it. Nothing else works without it; #4 (switching stations). Without it, the player is stuck at one station and there’s no game; #8 (placing toppings). This is the core of pizza-making, and it proves pinch-and-drop works, which sauce, trash, glove, and slicer all reuse.
- SHOULD: 2 (order ticket), 13 (serve and rating), 10 + 11 (baking), 12 (cutting), 7 (cheese). The ticket and rating are what make it feel like you made a good pizza, so they matter more than extra prep steps. Cheese is nearly free, since it reuses the topping code.
- CUT FIRST: 6 (sauce drag), 9 (trash), 5 (quick-gesture guard), 3 (thumbs up blocked elsewhere). The game still works without them.