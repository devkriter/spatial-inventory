# Inventory

A spatial parts inventory for a 3D-printing / electronics workshop. Instead of a
list of rows, it draws your storage the way [SpaceSniffer] draws a disk: nested
rectangles you click into, one level at a time, with a breadcrumb trail back out.

You build the map by **drawing on it**. Open a container, drag a rectangle
across its grid, name it. A treemap mode is one click away for when the question
is "what am I actually full of?" rather than "which drawer do I open?".

[SpaceSniffer]: http://www.uderzo.it/main_products/space_sniffer/

## Running it

```bash
npm install
```

Development, with hot reload on the UI:

```bash
npm run dev
```

The UI is on <http://localhost:5179> and the API on <http://localhost:5178>.

For everyday use, build once and run the single server:

```bash
npm run serve
```

Then it is all on <http://localhost:5178>.

Requires Node 22.5+, which has SQLite built in. On older Node, run
`npm install better-sqlite3` and the server picks it up automatically.

## On your phone

The server binds `0.0.0.0` and prints every address it can be reached at when it
starts:

```
inventory api    http://localhost:5178  (sqlite driver: node:sqlite)
database         C:\...\data\inventory.db
on your phone    http://192.168.1.20:5178
```

Open that second address in Chrome (or Safari — on iOS they are the same engine
underneath) on any device on the same WiFi. There is no login and no encryption:
this is a thing on your own network, not on the internet.

**Add it to the home screen** and it opens without browser chrome, full-bleed,
with its own icon. On iOS that is Share → Add to Home Screen.

The phone shell is not a shrunk desktop:

- The toolbar folds to **▤ ← breadcrumb ⌕ ✎ ⋯**. Everything else — adding,
  types, labels, settings, backups, the Layout/Count/Volume switch and the
  running totals — lives behind **⋯**.
- Details arrive as a **sheet from the bottom** instead of a side panel. Drag its
  handle up for the full thing; ✕ dismisses it and clears the selection.
- **Everything** (the tree) slides in over the map and closes when you pick
  somewhere to go.
- Only two levels of nesting are drawn, not three. Any deeper and it is a
  mosaic of specks.
- Your phone's own back gesture steps back through the app rather than leaving
  it.

### Touch gestures

The map pans and zooms itself rather than letting the browser do it, so a pinch
magnifies **the drawer, not the app**: the toolbar, the tree and the sheet keep
their true size at every zoom level. That is the difference between zooming in
to read a part name and zooming in to lose every control you need.

| Gesture | What it does |
| --- | --- |
| **Drag** | Moves the map. Always — this is the default in every mode |
| **Pinch** | Zooms, anchored between your fingers |
| **Tap** | Selects; the details sheet peeks up |
| **Double-tap** | Goes inside |

At rest the whole level is already on screen, so dragging holds still — there is
nowhere to pan to until you have zoomed in.

Editing is off until you tap **✎** — which is in the toolbar on every
touch device, tablets included, so there is always a way to switch it back off.
Even then a plain drag still pans. Everything that changes something has to be
meant:

| Gesture | What it does |
| --- | --- |
| **Tap, then drag a handle** | The selection grows a **⠿ pad** on top to move it and a **circle** at its bottom-right to resize. Both sit outside the transform, so they stay finger-sized however far you have zoomed in — a 1 × 1 slot is as easy to grab as a whole closet |
| **＋** | Drops a new rectangle into the biggest clear space, sized to half of it, and goes straight to naming it |
| **Press and hold empty grid**, then drag | Draws a rectangle freehand, the desktop way |
| **Press and hold a block**, then drag | Picks it up to drop into another container, at any depth. Dropping on bare grid pulls it up out of whatever it was buried in |

A second finger cancels whatever the first one was doing and becomes a pinch, so
a mis-started drag is always abandonable. Putting parts in needs none of this —
tap a container and use **Put a part in here** in the sheet.

`?touch=1` and `?phone=1` force either mode on (`=0` off) from a desktop
browser, which is how the touch model gets tested without a touchscreen.

### How the app decides what you are on

Not by device type — there is no reliable way to ask the web that, and the usual
guess is wrong for the case that matters most here: **since iPadOS 13, Safari on
an iPad reports itself as `Macintosh; Intel Mac OS X`.** Sniffing the user agent
for "iPad" finds nothing at all. (The one tell is `MacIntel` with more than one
touch point, which a real Mac never has; `niimbot.ts` uses it because a printer
error has to name the platform.)

What *can* be asked, reliably and dynamically, is what the machine can do. Three
separate questions, because they have three different answers:

| Question | Asked with | Decides |
| --- | --- | --- |
| **Narrow?** | `(max-width: 860px)`, plus a short-and-coarse clause for phones held sideways | Whether the shell folds: panels or overlays, toolbar or ⋯ menu |
| **Coarse?** | `(pointer: coarse)` | Gesture model, hit-target sizes, 16px fields, safe-area insets |
| **Touchable at all?** | `(any-pointer: coarse)` or `navigator.maxTouchPoints > 0` | Claiming the gesture, so a finger pans instead of scrolling the page |

They combine rather than pick one another:

| Device | Narrow | Coarse | Gets |
| --- | --- | --- | --- |
| iPhone | ✓ | ✓ | Phone shell, touch gestures |
| iPad portrait (820pt) | ✓ | ✓ | Phone shell, touch gestures |
| **iPad landscape (1180pt)** | ✗ | ✓ | **Full toolbar and both panels, touch gestures** |
| iPad in Split View | ✓ | ✓ | Phone shell |
| Desktop | ✗ | ✗ | Everything as it always was |
| Touchscreen laptop | ✗ | ✗ | Desktop, but a finger still pans and pinches |

An iPad in landscape has room for the tree, the map and the details panel, and
would be worse off with a phone toolbar — so the folding really is about size,
and only the folding is.

**Which gesture a given drag gets is decided per event, from `pointerType`, not
from the device.** An iPad with a Magic Keyboard has a trackpad and a
touchscreen at the same time, and no device-level flag can be right for both:
the finger pans and long-presses, the trackpad draws and drags directly, on the
same screen in the same second. Verified in both directions.

Anything driven by a fingertip therefore keys off `(pointer: coarse)`, never off
the width. Getting that wrong is what made an iPad zoom itself every time a
field took focus: the 16px rule was scoped to the phone breakpoint, and an iPad
in landscape is 1180px across.

Two things do not work on an iPhone, and cannot:

- **Printing to the NIIMBOT.** Web Bluetooth does not exist in any iOS browser —
  Chrome on iOS is Safari underneath. The label dialog says so, and *Print
  sheet* and *Save PNG* still work. Print from the machine the printer is
  paired with.
- **Scanning a label printed at `localhost`.** The QR encodes whatever address
  the app was open at when the label was made, and `localhost` means the phone
  itself. Set **where the QR codes point** in ⋯ → Labels to the machine's
  network address once, and every label works from anywhere.

## Units, not millimetres

Everything is measured in **units (U)** — abstract squares. A unit is whatever
you decide it is for a given container, and nothing tries to be true to scale
across containers. Finding a part does not need millimetres; it needs to know
that the thing you want is the third drawer down on the left.

Every container is a grid of `cols × rows` units and claims a rectangle of its
parent's units. That one idea covers all of it — including the top level, which
is a grid as well, so the room itself can be arranged: the drawer unit directly
under the cabinet, the bench along the far wall. Resize the room from the
details panel while standing at the top level.

| Thing | Interior | Children |
| --- | --- | --- |
| Workshop | 24 × 16, grid | closets, benches, shelving, placed where they really are |
| Two-door closet | 16 × 20, free | drawer units, a rack, boxes, wherever they fit |
| Printed drawer unit | 12 × 12, grid | drawers of 3×3, 2×2, 12×3 … |
| Small-parts cabinet | 4 × 12, grid | 2×1 and 2×2 drawers |
| Filament rack | 8 × 2, grid | one 1×2 spool per slot |

The footprint a container takes up in its parent is **separate** from its own
interior. A drawer unit can be 6×12 of closet space while holding a 12×12 grid
of drawers — which is exactly what a printed drawer unit off a 12×12 base is.

`grid` and `free` only change how placement behaves:

- **grid** — children snap to whole units, and the unit grid is drawn clearly.
- **free** — children snap to half units, the grid is only a whisper, and there
  is no expectation of filling the space.

Grid containers can be numbered from the bottom up, the way small-parts cabinets
usually are. That affects the addresses shown — `R3·C2` — never the drawing.

## Storage types

Types are yours to define, under **Types** in the toolbar. Each one carries a
default size, layout and colour, so the second Gridfinity tray is one click.

Six generic ones ship to get you moving — Closet, Shelf, Drawer unit, Drawer,
Rack, Box. Rename them, resize them, delete the ones you do not use, add the
ones you do.

A type only supplies defaults at creation. Once a container exists its size and
layout are its own, so changing or deleting a type never moves anything you have
already drawn — a container with a deleted type just loses the label.

## Drawing the map

Inside any container, in Layout mode:

- **Drag on empty space** to draw a new container. Name it and pick a type; the
  type decides what it is like *inside*, the rectangle you drew decides how much
  room it takes up.
- **Drag a block by its title bar** — the strip across the top, marked ⠿ — to move it.
  The body of a block is not a drag handle, so clicking into something can never
  nudge it out of place. A block too small to show a title bar can be dragged
  anywhere on its face.
- **Drag the bottom-right corner** of a block to resize it. Resizing meets
  resistance rather than being refused: grow it into a neighbour and it stops at
  that neighbour's edge. A container's footprint and its own interior grid are
  separate fields, so resizing furniture never disturbs what is inside it.
- Moving something onto something else is refused — the rectangle turns red and
  reads *blocked*, and the drop is discarded.

## Two kinds of bigger

These are separate on purpose, because they answer different questions.

### Interface size — ⚙ Settings

How big the *app* is drawn: toolbar, both panels, the tree, menus, dialogs.
An accessibility setting, 80% to 160%, live as you drag it, remembered per
browser. Text and the controls around it move together — panels widen with the
typeface, so nothing outgrows the box it sits in.

It is one CSS variable, `--ui`, that every chrome dimension is written against.
The map does not read it: at 80%, 100% and 160% the blocks keep the same type
sizes and the same layout. Blocks are sized by the layout and by the map's own
zoom, and folding those two ideas into one control would make each of them worse.

### Map zoom — the wheel, or a pinch

How much of the workshop you are looking at. There is no widget: the wheel zooms
about the cursor, a pinch zooms about your fingers, the middle mouse button
drags, and a **⤢** appears at the bottom right *only while zoomed in*, showing
how far and taking you back.

This is **not a magnifying glass**, and that is the point. Zooming enlarges the
stage the level is laid out into and runs the layout again, so:

- Blocks get bigger, but text stays at its own size and stays crisp — there is
  no scaled bitmap to go soft.
- The presentation tiers re-evaluate. A drawer that had only room for a compact
  list gets proper tiles; a **+8 more** turns into eight real items. At the
  workshop level, 100% draws 12 blocks and 125% draws 20 — the extra eight are
  contents that had nowhere legible to go a moment earlier.

So "bigger" here means *more visible*, not merely larger. 100% always means the
whole level fits the window, which is why there is nothing below it.

## Getting around

A click never moves you. Standing still and looking is the common case, so:

- **Click** a block to inspect it — the panel describes it and you can add parts
  to it, edit it or delete it without going anywhere.
- **Double-click** it, or press **Enter**, to actually go inside.
- To come back out: **click the space around the level** (the cursor turns to
  `zoom-out` there), the **← Back** button, **Backspace**, a breadcrumb, or
  right-click.
- The **browser's own Back button** steps back out too, rather than leaving the
  app — which matters most on a phone, where Back is the system gesture.

The orange outline is the level you are standing in; the margin outside it is
the way back. The details panel says which of the two it is describing — *"You
are inside"* versus *"Selected — inside …"*.

Clicking bare space — the level's own floor or the margin around it — clears the
selection. The margin only takes you back out when *click outside to go back* is
switched on, and the `zoom-out` cursor only appears when it will.

A walkthrough opens the first time you load the app, covering navigation,
drawing, and what every toolbar control does; on a phone it is the phone
version, with taps and the ⋯ menu instead of clicks and a toolbar. The **?**
button reopens it. Search results jump you to wherever the hit lives — for a part,
inside its container; for a container, to its parent with the block highlighted,
so you can see where it sits.

Parts go in from the panel on the right. Type a name into "Put a part in here" —
it autocompletes against everything already in the catalogue, and an existing
part of that name is reused rather than duplicated, which is how the same 470 Ω
resistor lives in two drawers and still reports one total.

**Remove from here** takes a part out of one container; **Delete part** forgets
it everywhere at once.

## The two side panels

The map sits between them, and each collapses independently — from its own
header, or from **▤** and **☰** in the toolbar. Whether they are open is
remembered per browser. Below about 860 px wide they stop being panels: the tree
becomes a drawer over the map and the details become a bottom sheet, both
starting closed regardless of what was remembered.

**Everything**, down the left, is the whole inventory as an outline drawn the way
a section is: each entry a box, joined by elbow connectors, with the level you
are standing in filled solid. Click a place to go there, a part to jump to it and
highlight it where it lives.

Selecting anything lights up the whole chain it belongs to, so you can see at a
glance which cabinet a drawer is in without hunting — the same read as Fusion's
browser.

**Right-click** any row for a menu: open, rename, add inside, labels and delete
for a place; show, rename, remove from here and delete everywhere for a part.

A **Displaced** branch appears at the top level whenever the catalogue still
knows about a part that is not stored anywhere. Click one to rename it, put it
back into any container, or forget it entirely. Its description and datasheet are
kept in the meantime, so putting it back is not a retype.

**Details**, down the right, describes whatever you last clicked — its size, its
contents, its parts and their quantities — and is where you add parts, edit and
delete.

While you are searching the two work together: the tree prunes to just the
branches leading to a hit, and the details panel lists the hits themselves.

## Finding things

**`/`** focuses search. Every word you type must match, so `470 resistor`
narrows and `10K` does not drag in `100K`. Matches glow blue, everything else
dims, and the results list shows the full path to each hit.

The **Layout / Count / Volume** switch chooses what block size means: the grid
you drew, the number of distinct parts, or total quantity held.

Set a part's **Min** and it turns red anywhere it drops below that.

## Two projections

Every container is drawn twice over, in two different views, and they are not
the same shape:

- **From the front**, as a slice of its parent's face. A drawer unit is stacked
  horizontal slices; one drawer is `12 × 1`.
- **From above**, once you open it — its own floor plan. That same drawer is a
  full `12 × 12` grid of compartments.

The footprint field is the first; the interior field is the second. They are
deliberately independent, which is why resizing a drawer on the front of a
cabinet never disturbs what is inside it.

The consequence is that a drawer one slice tall can hold far more than a slice
can show. There is no honest way to draw a 12 × 12 plan inside a 12 × 1
elevation, so the contents change *presentation* instead of shrinking — see
below.

## Parts in slots

**Every part has a slot** on its container's plan-view grid, exactly as a
container has one on its parent's. You never have to assign it: adding a part
takes the next free cell automatically, and moving one to another container
re-slots it there. Drag a part to move it, its corner to resize, and overlaps are
refused the same way as for storage.

Draw a rectangle on the grid and the prompt asks whether it is **Storage** or a
**Part**, so a compartment full of resistors is one drag.

**Drag anything onto anything** to move it. Pick up a part — or a whole
container — from any depth on screen and drop it into another container, and it
takes a free slot there. Drop it on the **bare grid of the level you are in** to
pull it up out of whatever it was buried in. The thing follows the pointer, the
target lights up green, and dropping it back where it started does nothing. A
container cannot be dropped inside itself or its own contents.

The one exception is a grid with no room left. The part is still stored — it just
has nowhere of its own, so it gets listed rather than drawn, marked with a hollow
square in the tree and a `—` in the details panel. Make the grid bigger with
**Edit** and it takes a slot on the next change.

## How parts are drawn

Child containers and parts keep their exact grid position, so a part takes up
its own area and no more — one part in a big drawer is one small tile with a lot
of free space around it, which is the truth.

That only works while a cell is big enough to see. Squeezed into a nested strip a
1 × 1 slot would be a four-pixel sliver, so below about 11 px per cell the tray
gives up on geometry and steps down through three denser forms:

| Form | When | Shows |
| --- | --- | --- |
| **Tiles** | every part gets a legible tile | name and quantity, two lines |
| **Rows** | tiles will not all fit | one line each — several times as many fit |
| **+N more** | even rows run out | the last cell stands in for the rest; click to open |
| **Count** | nothing legible fits | a single total |

Completeness beats prettiness: tiles are only used when *all* the parts fit as
tiles, otherwise the denser form that shows more of them wins. Opening the
container gives the contents the whole screen, where the real slots come back
and everything almost always fits in full.

Two more rules keep the space usable:

- A container holding **only loose parts** — nothing pinned, no children —
  ignores its own grid proportions and uses the whole block. Letterboxing a
  12 × 12 plan inside a 12 × 1 elevation would be mostly empty margin, and with
  nothing positioned there is nothing for the grid to line up.
- Otherwise the grid is kept true, and loose parts go in the largest solid
  rectangle of cells nothing else claimed, so they stay one readable block
  instead of being scattered around the slots.

## Labels

**🏷 Labels** in the *details panel* makes labels for whatever is selected, or for
everything inside it in one go — a whole drawer cabinet in a single pass. Each
label carries the name and a QR code that opens the app at that exact container.
Scan a drawer with your phone and you are looking at its contents.

The QR points at whatever address the app was open at when the label was made,
which is wrong if that was `localhost`. **Where the QR codes point** in the
toolbar's label dialog overrides it — set it to the machine's address on the
network (`http://192.168.1.20:5178`) once and every label works from any device.

A label deliberately says **what** something is, never **where** it is. Printing
the address would mean reprinting every label the moment you rearrange, so it is
off by default — the QR is the durable pointer, and the app is what knows where
that container currently sits. The same caveat applies to "Where it lives", which
is on by default but goes stale if you move a drawer between cabinets.

**🏷 Labels** in the *toolbar* is the other half: the printer, the stock loaded in
it, what appears on every label, and a test print. Set once and forget.

Three ways out:

- **Print to a NIIMBOT** over Web Bluetooth, via
  [`@mmote/niimbluelib`](https://github.com/MultiMote/niimbluelib) — the library
  behind [NiimBlue](https://niim.blue). The printer is picked in the browser's
  own Bluetooth prompt. Web Bluetooth needs a secure context, so this works at
  `http://localhost:5178` or over https, but **not** from a phone on
  `http://<your-ip>:5178` — and on iOS not at all, in any browser. The dialog
  says which of the two applies rather than silently failing.
- **Save PNGs** at true printer resolution — drop them into NiimBlue, or any
  other label tool.
- **Print sheet** hands the batch to an ordinary printer at true physical size.

Label stock is picked in the toolbar dialog — the usual NIIMBOT sizes from
12 × 30 mm up to 50 × 80 mm, or type your own. Sizes are named the way the packet
is, tape width first, and drawn with the long side across; **⇄** swaps the
orientation if your roll feeds the other way. Below 16 mm tall the path line is
left off automatically so the name stays readable. 203 dpi suits every current
NIIMBOT — exactly 8 dots per millimetre.

The library is loaded only when you open the label dialog, and is pinned to an
exact version because it is alpha.

## Settings

**⚙** holds per-device preferences, kept in that browser's local storage rather
than the database — your phone at the bench and the PC across the room can
behave differently. They are not included in a backup.

Navigation shortcuts can be turned off individually: click-outside-to-go-back,
right-click, Backspace, and whether a single click goes inside or merely
inspects. You can also set how many levels are drawn at once, hide the unit
grid, and skip the delete confirmation — though anything with contents inside it
always asks.

## Backups

**↓ Back up** saves everything — places, parts and quantities — to a `.json`
file. **↑ Restore** loads one back, and **replaces everything** currently
stored after asking you to confirm. Ids are preserved, so a dump restores
exactly. The database itself is a single file at `data/inventory.db`.

## Layout

```
server/          Express + SQLite. schema.sql is the whole data model.
client/public/   Manifest and icons, for adding it to a phone's home screen.
client/src/
  layout.ts      Unit space, squarified treemap, addresses.
  tree.ts        Flat tables -> tree with rolled-up totals.
  search.ts      Token-AND matching and match/on-path sets.
  mobile.ts      Narrow? Coarse? Touchable at all? Three separate questions.
  transform.ts   Pan and zoom, applied to the block layer and nothing else.
  components/
    SpaceView      The blocks, and the draw / move / resize gestures.
    DrawPrompt     The name-it popover that follows a drawn rectangle.
    TypeManager    Define your own storage types.
    ContainerDialog Numeric editing, and top-level places.
    Sidebar        Details, contents, part editing, search results.
    MobileMenu     The ⋯ sheet: everything the phone toolbar has no room for.
```

The phone shell is not a separate app — same components, same state. `mobile.ts`
answers the three capability questions above and the handful of places that care
branch on whichever one they actually mean. The CSS breakpoint and `PHONE_QUERY`
must be kept in step by hand; anything about fingers belongs in the
`(pointer: coarse)` block, not the width one.

Blocks are laid out in **stage** pixels — where they would sit at rest — and
`transform.ts` maps between those and the screen. Only `.stage-xform` is
transformed, which is what confines a zoom to the map; handles and overlays live
outside it and convert on the way out. Every hit-test converts the pointer on
the way in, so the layout never has to know the view moved.
