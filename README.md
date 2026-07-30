# Inventory

A spatial inventory for a 3D-printing / electronics workshop. Instead of a list
of rows it draws your storage the way [SpaceSniffer] draws a disk: nested
rectangles you click into, one level at a time, with a breadcrumb trail back out.

You build the map by drawing on it — open a space, drag a rectangle across its
grid, name it. A treemap mode is one click away for when the question is "what am
I actually full of?" rather than "which drawer do I open?".

[SpaceSniffer]: http://www.uderzo.it/main_products/space_sniffer/

## Running it

```bash
npm install && npm run serve
```

Then everything is on <http://localhost:5178>. Use `npm run dev` instead for hot
reload — UI on :5179, API on :5178.

Needs Node 22.5+ for the built-in SQLite. On older Node run
`npm install better-sqlite3` and the server picks it up automatically.

The database is a single file at `data/inventory.db`. On every start the server
writes a consistent snapshot to `data/snapshots/` with `VACUUM INTO` and keeps
the last fourteen.

## On your phone

The server binds `0.0.0.0` and prints its address on the network at startup:

```
on your phone    http://192.168.1.20:5178
```

Open that on any device on the same WiFi. There is no login and no encryption —
this lives on your network, not the internet. **Add to Home Screen** gives it an
icon and drops the browser chrome.

Below about 860 px the shell folds: the toolbar becomes `▤ ← breadcrumb ⌕ ✎ ⋯`
with everything else behind ⋯, the tree becomes a drawer, and details become a
bottom sheet. A tablet in landscape keeps the full desktop shell *and* gets touch
gestures — that is decided from what the device can do, never from the user
agent, because iPadOS Safari reports itself as a Mac.

| Gesture | |
| --- | --- |
| **Drag** | Moves the map — always, in every mode |
| **Pinch** | Zooms |
| **Tap** / **double-tap** | Select / go inside |

Editing is off until you tap **✎**, and even then a plain drag still pans.
With it on: tap something and drag its **⠿ pad** to move or its corner **circle**
to resize; **＋** drops a new rectangle into the biggest free space; **press and
hold** bare grid to draw freehand, or a block to pick it up and carry it.

`?touch=1` and `?phone=1` force either mode on from a desktop browser (`=0` off).

Two things cannot work on an iPhone: **printing to the NIIMBOT** (no iOS browser
has Web Bluetooth — Chrome there is Safari underneath), and **scanning a label
printed at `localhost`**, which points at the phone itself. See Labels.

## The model

Everything is measured in **units (U)** — abstract squares, not millimetres.
Finding a part does not need millimetres; it needs to know the thing you want is
the third drawer down on the left.

| | |
| --- | --- |
| **Space** | Anything that holds things: the workshop, a closet, a drawer, a bin |
| **Item** | A kind of thing you own — a resistor, a filament spool, socks |
| **Holding** | *N* of an item inside a space, at a slot on its grid |

Every space is a grid of `cols × rows` units and claims a **slot**, a rectangle
of its parent's units. The top level is a grid as well, so the room itself can be
arranged — the drawer unit directly under the cabinet, the bench along the far
wall. A `grid` space snaps its children to whole units and draws the grid
clearly; a `free` one snaps to halves and only whispers it.

### Footprint is not interior

The one idea worth understanding. Every space is drawn twice, in two shapes that
are not the same:

- **From the front**, as a slice of its parent's face. One drawer of a unit is
  `12 × 1`.
- **From above**, once you open it — its own floor plan. That same drawer is a
  full `12 × 12` grid of compartments.

Those are two independent fields, which is why resizing a drawer on the front of
a cabinet never disturbs what is inside it. It also means a drawer one slice tall
can hold far more than a slice can show, which is what the presentation tiers
below exist for.

**Space types** (toolbar → Types) are your own templates carrying a default size,
layout and colour, so the second Gridfinity tray is one click. They supply
defaults *at creation only* — changing or deleting a type never moves anything
you have already drawn.

## Using it

A click never moves you; standing still and looking is the common case.

| | |
| --- | --- |
| **Click** | Inspect — the panel describes it and you stay where you are |
| **Double-click** or **Enter** | Go inside |
| The margin, **← Back**, **Backspace**, right-click, browser Back | Come back out |
| **`/`** | Search |

The orange outline is the level you are standing in; the margin around it is the
way back. Clicking bare space clears the selection.

**Drawing**, in Layout mode: drag on bare grid to make a space; drag a block by
its title bar to move it; drag its bottom-right corner to resize. Resizing meets
resistance at a neighbour's edge rather than being refused. Overlapping drops go
red and are discarded.

**Drag anything onto anything** to move it, from any depth on screen. Drop onto
the bare grid of the level you are in to pull something up out of whatever it was
buried in. The target lights green, and dropping it back where it started does
nothing.

**Items** go in from the details panel. Typing a name that already exists reuses
it rather than duplicating, which is how the same 470 Ω resistor lives in two
drawers and still reports one total. Every holding takes a free slot
automatically. *Remove from here* takes it out of one space; *Delete item*
forgets it everywhere.

**Search** requires every word to match, so `470 resistor` narrows and `10K` does
not drag in `100K`. Hits glow blue and everything else dims. **Layout / Count /
Volume** switches what block size means: the grid you drew, the number of
distinct items, or total quantity held. Set an item's **Min** and it turns red
wherever it drops below.

The **tree** down the left is the whole inventory drawn as a section, and
selecting anything lights the chain it belongs to. Right-click any row for a
menu. A **Displaced** branch collects items the catalogue still knows about that
are not stored anywhere.

## How contents are drawn

A holding takes its own area and no more — one item in a big drawer is one small
tile with a lot of real empty space around it. That only holds while a cell is
big enough to see, so below about 11 px per cell the tray gives up on geometry
and steps down:

| Form | When |
| --- | --- |
| **Tiles** | every holding gets a legible tile |
| **Rows** | tiles will not all fit — several times as many rows do |
| **+N more** | even rows run out; click to open |
| **Count** | nothing legible fits |

Completeness beats prettiness: tiles are used only when *all* of them fit,
otherwise the denser form that shows more of them wins.

## Two kinds of bigger

**Interface size** (⚙ Settings, 80–160%) scales the toolbar, both panels, the
tree, menus and dialogs — text and the controls around it together, so nothing
outgrows the box it sits in. The map is deliberately excluded.

**Map zoom** (the wheel, a pinch, middle-drag to pan) changes how much of the
workshop you are looking at. It is not a magnifying glass: zooming enlarges the
stage the level is laid out into and runs the layout again, so text stays crisp
at its own size and the tiers re-evaluate — a `+8 more` becomes eight real tiles.
100% always means the whole level fits the window.

## Labels

**🏷 Labels** in the details panel makes labels for whatever is selected, or for
everything inside it in one pass. Each carries a name and a QR code that opens
the app at that space, so scanning a drawer shows you its contents.

A label says **what** something is, never **where** it is. Printing an address
would mean reprinting every label the moment you rearrange; the QR is the durable
pointer and the app is what knows where the space currently sits.

Set **where the QR codes point** (toolbar → Labels) to your machine's address on
the network once, or every label made at `localhost` will be dead on the phone
that scans it.

Three ways out: **NIIMBOT over Web Bluetooth**, via
[`@mmote/niimbluelib`](https://github.com/MultiMote/niimbluelib) — needs a secure
context, so `localhost` or https, and never iOS; **Save PNGs** at true printer
resolution for NiimBlue or any other tool; **Print sheet** to an ordinary printer
at true physical size. Stock sizes run 12 × 30 mm to 50 × 80 mm, named the way
the packet is with tape width first; **⇄** flips the orientation.

## Settings and backups

⚙ keeps per-device preferences in that browser's storage, so the phone at the
bench and the PC across the room can behave differently. They are not part of a
backup. Individual navigation shortcuts can be switched off, along with how many
levels are drawn at once and the delete confirmation.

**↓ Back up** writes everything to a `.json` file; **↑ Restore** loads one back
and **replaces everything** currently stored, after confirming. Ids are
preserved, so a dump restores exactly.

## Code

```
server/          Express + SQLite. schema.sql is the whole data model.
client/public/   Manifest and icons, for adding it to a home screen.
client/src/
  layout.ts      Unit space, squarified treemap, presentation tiers.
  transform.ts   Map zoom and pan.
  tree.ts        Flat tables -> tree with rolled-up totals.
  search.ts      Token-AND matching and match/on-path sets.
  mobile.ts      Narrow? Coarse? Touchable at all? Three separate questions.
  components/    SpaceView is the blocks and every gesture; the rest are panels,
                 dialogs and the ⋯ sheet.
```

Zoom re-runs the layout rather than transforming the result, so blocks are always
laid out in real screen pixels and no hit-test has to convert coordinates.

The phone shell is not a separate app — same components, same state. `mobile.ts`
answers the three capability questions and the few places that care branch on
whichever one they actually mean. The CSS breakpoint and `PHONE_QUERY` must be
kept in step by hand, and anything about fingertips belongs in the
`(pointer: coarse)` block rather than the width one.

**Naming:** the interface says Space / Item / Holding. The code and database
still say `container` / `part` / `stock`; that rename is pending.
