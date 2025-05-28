/* import {Application, Container, Graphics, Text, TextStyle,
        Transform} from "pixi.js"; */
const {Application, Container, Graphics, Text, TextStyle, Transform,
       RenderTexture} = PIXI

/* ------------------------------------------------------------------------ */

const theText = document.querySelector("#text-box");
const theFigure = document.querySelector("#figure-box");
const currentPage = document.getElementById("currentPage");
const pageForward = document.getElementById("pg-forward");
const pageBackward = document.getElementById("pg-backward");
const pages = Array.from(theText.querySelectorAll("div.page"));
const pagingDms = (p => {
  const dt = getComputedStyle(pages[0]).getPropertyValue(p);
  let dms = parseFloat(dt);
  if (dt.slice(-2) != "ms") {  // But dt always in units of s?
    dms *= 1000;
  }
  return dms;
})("transition-duration");
const figBgColor = (p =>
  getComputedStyle(theFigure).getPropertyValue(p)
)("background");

const canvas = document.getElementById("figure");
const app = new Application();
await app.init({canvas: canvas, resizeTo: canvas.parentElement,
                background: 0xd0c3a4, antialias: true,
                autoDensity: true,  // makes renderer view units CSS pixels
                resolution: window.devicePixelRatio || 1});
// PIXI.Text has independent resolution option
const overlayTexture = RenderTexture.create({
  width: app.screen.width,
  height: app.screen.height,
  resolution: window.devicePixelRatio || 1
});
const portraitOrientation = window.matchMedia("(max-aspect-ratio: 1/1)");
let calendarLike = portraitOrientation.matches;
portraitOrientation.addEventListener("change", () => {
  calendarLike = portraitOrientation.matches;
});
let rem = parseFloat(getComputedStyle(document.documentElement).fontSize);

window.fig = canvas;
window.app = app;

/* ------------------------------------------------------------------------ */
/*

The web page has two visual components: a text caption part, a figure part.  For
landscape screens, the text and figure parts are side by side with text on the
left and figure on the right.  For portrait screens, the text part is at the
top, and the figure section occupies an equal height below the text part.

The text side consists of a "text-wrap" div with "page" div children.  The
number of "page" divs equals the number of pages, and the page turning procedure
is handled as CSS transitions.  The figure side consists of a "fig-wrap" div
containing the PIXI canvas.

The figure side, however, presents a different challenge for page turning: I
could not figure out how to copy the PIXI canvas in order to be able to use CSS
for the page turning transitions, so they are done entirely in javascript:

To turn the page forward, the entire stage is rendered to a texture of the same
size.  The stage is then updated to the new figure, except that the texture with
the copy of the old figure is rendered in a rectangle on top of everything else.
The scene is then rendered as the first frame in the transition animation, with
the top rectangle transformed to successively narrower portions of at the left
edge in following frames to look like the page is being rotated, revealing the
new frame underneath.  Finally, the stage can be rerendered without adding the
textured rectangle.

To turn the page backward, the new figure is rendered to the textured rectangle,
which begins fully rotated.  After it has rotated down to completely cover the
old figure, the scene is redrawn a final time with the new figure on the stage
and no textured rectangle.
*/

window.addEventListener("keydown", e => {
  switch (e.key) {
  case "Home":
    stepPage(0, true);
    break;
  case "End":
    stepPage(pages.length-1, true);
    break;
  case "PageUp":
  case "Backspace":
    stepPage(-1);
    break;
  case "PageDown":
  case "Enter":
    stepPage();
    break;
  case " ":
    animationControl.playPause();
    break;
  default:
    return;
  }
  e.preventDefault();
});

let startPage = 0, endPage = parseInt(currentPage.value);

let dtparts, dttot;
function drawFigure(p, frac) {
  if (p === undefined) p = parseInt(currentPage.value);
  const state = astates[p];
  if (frac === undefined) {
    frac = state[1];
  } else {
    state[1] = frac;
  }
  if (state[0].length) {
    dtparts = state[0];
    dttot = dtparts.reduce((p, q) => p + q);
  } else {
    dttot = state[0];
    dtparts = [dttot];
  }
  figures[p](frac);
}

function stepPage(by=1, from0=false) {
  let p = parseInt(currentPage.value);
  let q = from0? by : p + by;
  if (q < 0 || q >= pages.length) return;
  [startPage, endPage] = [p, q];
  currentPage.value = "" + q;
  for (let p of [pageForward, pageBackward, animationControl.parent])
    p.style.display = "none";
  if (q > p) {
    changeFigure();
  } else {
    changePage();
  }
}

pageForward.addEventListener("click", e => stepPage());
pageBackward.addEventListener("click", e => stepPage(-1));

function flashPagers() {
  for (let p of [pageForward, pageBackward]) p.style.display = "grid";
  pageForward.classList.add("pg-flash");
  pageBackward.classList.add("pg-flash");
  setTimeout(() => {
    pageForward.classList.remove("pg-flash");
    pageBackward.classList.remove("pg-flash");
  }, 1000);
}

function setAnimationControlState(q) {
  const isAnimated = (q >= 0)? figures[q].length : 0;
  animationControl.parent.style.display = isAnimated? "block" : "none";
  animationControl.setThumb(astates[q][1]);
}

function changePage(noTransition=false) {
  let [p, q] = [startPage, endPage];
  if (noTransition) {
    pages[p].classList.add("hidden");
    pages[q].classList.remove("hidden");
    if (q <= p) {
      changeFigure(true);
    } else {
      flashPagers();
      setAnimationControlState(q);
    }
    return;
  }
  if (q > p) {  /* figure side already turned */
    pages[q].classList.add("infront", "easeout", "midturn");
    pages[q].classList.remove("hidden");
    /* need getComputedStyle to force transform to update in DOM */
    getComputedStyle(pages[q]).getPropertyValue("transform");
    pages[q].addEventListener("transitionend", fwdHandler);
    pages[q].classList.remove("midturn");
  } else {
    pages[p].classList.add("infront", "easein");
    pages[q].classList.remove("hidden");
    pages[p].addEventListener("transitionend", bckHandler);
    pages[p].classList.add("midturn");
  }
}

function fwdHandler() {
  let [p, q] = [startPage, endPage];
  pages[q].removeEventListener("transitionend", fwdHandler);
  pages[q].classList.remove("infront", "easeout");
  pages[p].classList.add("hidden");
  flashPagers();
  setAnimationControlState(q);
}

function bckHandler() {
  let p = startPage;
  pages[p].removeEventListener("transitionend", bckHandler);
  pages[p].classList.add("hidden");
  pages[p].classList.remove("infront", "easein", "midturn");
  /* now turn figure side */
  changeFigure();
}

function changeFigure(noTransition=false) {
  let [p, q] = [startPage, endPage];
  // Animate the page turn for figure side using PIXI.
  if (noTransition) {
    drawFigure(q);
    app.renderer.render({container: app.stage});
    if (q > p) {
      changePage(true);
    } else {
      flashPagers();
      setAnimationControlState(q);
    }
    return;
  }
  if (q < p) {  /* text side already turned back */
    // Draw new figure to overlay Texture.  Set overlay to 90 degrees.
    drawFigure(q);
    app.renderer.render({container: app.stage, target: overlayTexture});
    // Redraw old figure on canvas, with overlay visible but initially rotated.
    drawFigure(p);
    overlay.visible = true;
    // Animate new figure rotating to cover old.
    figEaseOut.start();
  } else if (q > p) {  /* turn figure side first, then trigger text side */
    // Draw old figure to overlay texture.  Set overlay to 0 degrees.
    drawFigure(p);
    app.renderer.render({container: app.stage, target: overlayTexture});
    // Draw new figure on canvas, with overlay visible, initially covering it.
    drawFigure(q);
    overlay.visible = true;
    // Animate old figure rotating to expose new.
    figEaseIn.start();
  } else {  // can have q==p when initializing
    drawFigure(q);
    app.renderer.render({container: app.stage});
  }
}

class CssTransition {
  // Default  CSS transitions are defined as Bezier curves, which are
  // inconvenient because they are parametric.  Here are reasonably accurate
  // piecewise cubic approximations.
  constructor(type, dms, cb, ctx) {
    let split = 0.5;
    let coefs = [[0., 0., 1., 0.], [0., 0., 1., 0.]];  // y = x is default
    if (type == "ease") {  // maximum error 0.00660
      split = 0.22399346;
      coefs = [[-7.9356810,  6.92937852,  0.4,  0.],
               [1.04553848, -3.40785808,  3.6791007, -0.31678111]];
    } else if (type == "ease-in") {  // maximum error 0.00345
      split = 0.55974585;
      coefs = [[-0.74015112,  1.64384427,  0., 0.],
               [ 0.39179008, -0.25841715,  1.06560198, -0.19897492]];
    } else if (type == "ease-out") {  // maximum error 0.00345
      split = 0.44025426;
      coefs = [[ 0.39178986, -0.91695300,  1.72413793,  0.],
               [-0.74015128,  0.57660948,  1.06723489,  0.09630692]];
    } else if (type == "ease-in-out") {  // maximum error 0.00443
      coefs = [[-0.50782681,  2.25391341,  0.,  0.],
               [-0.50782681, -0.73043297,  2.98434637, -0.74608659]];
    }
    this.split = split
    this.coefs = coefs
    this.dms = dms;  // duration of transition
    this.cb = cb;
    this.ctx = ctx;
    this.ms = 0;
    this.running = false;
  }

  f(x) {
    let coefs = this.coefs[(x < this.split)? 0 : 1];
    let y = coefs[0];
    for (let c of coefs.slice(1)) {
      y *= x
      y += c
    }
    return y
  }

  start() {
    if (this.running) this.stop();
    this.ms = 0;
    app.ticker.add(this.step, this);
    this.running = true;
    app.ticker.start();
  }

  stop() {
    if (this.running) {
      app.ticker.remove(this.step, this);
      this.running = false;
      app.ticker.stop();
      this.cb.call(this.ctx, 1.0);
    }
  }

  step() {
    this.ms += app.ticker.deltaMS;
    if (this.ms >= this.dms) {
      this.stop();
    } else {
      this.cb.call(this.ctx, this.f(this.ms / this.dms));
    }
  }
}

const figEaseOut = new CssTransition("ease-out", pagingDms, (frac) => {
  if (frac < 1.) {
    drawOverlay(0.25*twoPi*(1.-frac));
  } else {
    drawFigure(endPage);
    overlay.visible = false;
    flashPagers();
    setAnimationControlState(endPage);
  }
  app.renderer.render({container: app.stage});
});

const figEaseIn = new CssTransition("ease-in", pagingDms, (frac) => {
  if (frac < 1.) {
    drawOverlay(0.25*twoPi*frac);
  } else {
    overlay.visible = false;
  }
  app.renderer.render({container: app.stage});
  if (!overlay.visible) changePage();
});

/* ------------------------------------------------------------------------ */

class AnimationControl {
  constructor(parentId, callback) {
    this.parent = document.getElementById(parentId);
    this.play = document.querySelector("#" + parentId + " .play");
    this.pause = document.querySelector("#" + parentId + " .pause");
    this.slider = document.querySelector("#" + parentId + " .slider");
    this.thumb = document.querySelector("#" + parentId + " .thumb");
    this.playing = this.play.classList.contains("hidden");
    this.dragging = false;
    document.querySelector("#" + parentId + " .play-pause").addEventListener(
      "click", () => this.playPause());
    this.thumb.addEventListener("pointerdown", (e) => this.beginThumb(e));
    this.moving = false;
    this.moveThumb = this.moveThumb.bind(this);
    // this.mover = (e) => this.moveThumb(e);
    this.endThumb = this.endThumb.bind(this);
    // this.ender = (e) => this.endThumb(e);
    this.callback = callback;
    this.msTotal = 0;
    this.currentPage = 0;
  }

  playPause() {
    if (this.moving) return;  // needed despite pointer capture
    if (this.playing) {  // pause
      this.playing = false;
      this.pause.classList.add("hidden");
      this.play.classList.remove("hidden");
      app.ticker.remove(this.drawFrame, this);
      app.ticker.stop();
    } else {  // play
      this.currentPage = parseInt(currentPage.value);
      let [duration, frac] = astates[this.currentPage];
      if (duration.length) {
        dtparts = duration;
        duration = dttot = dtparts.reduce((p, q) => p + q);
      }
      this.duration = duration;
      if (frac < 0.995) {
        this.playing = true;
        this.play.classList.add("hidden");
        this.pause.classList.remove("hidden");
      } else {
        frac = 0;
        this.setThumb(0);
      }
      this.msTotal = frac * duration;
      app.ticker.add(this.drawFrame, this);
      if (this.callback) this.callback(frac);
      if (this.playing) app.ticker.start();
    }
  }

  drawFrame() {
    if (!this.playing) return;
    this.msTotal += app.ticker.deltaMS;
    let frac = this.msTotal / this.duration;
    if (frac >= 1) frac = 1;
    this.setThumb(frac);
    if (frac >= 1) this.playPause();
  }

  beginThumb(e) {
    if (this.moving) return;
    if (this.playing) this.playPause();  // pause before manual move
    this.moving = true;
    let bbSlider = this.slider.getBoundingClientRect();
    let bbThumb = this.thumb.getBoundingClientRect();
    let wthumb = bbThumb.right - bbThumb.left;
    this.offset = bbThumb.left - bbSlider.left - e.clientX;
    this.width = bbSlider.right - bbSlider.left - wthumb;
    this.thumb.addEventListener("pointermove", this.moveThumb);
    this.thumb.addEventListener("pointerup", this.endThumb);
    this.thumb.addEventListener("pointercancel", this.endThumb);
    this.thumb.setPointerCapture(e.pointerId);
  }

  moveThumb(e) {
    let left = e.clientX + this.offset;
    if (left < 0) left = 0;
    else if (left > this.width) left = this.width;
    this.thumb.style.left = left + "px";
    if (this.callback) this.callback(this.getThumb());
  }

  endThumb(e) {
    this.moveThumb(e);
    this.thumb.removeEventListener("pointermove", this.moveThumb);
    this.thumb.removeEventListener("pointerup", this.endThumb);
    this.thumb.removeEventListener("pointercancel", this.endThumb);
    this.thumb.releasePointerCapture(e.pointerId);
    setTimeout((ac) => {
      ac.moving = false;  // delay slightly to prevent play-pause from firing
    }, 50, this);
  }

  setThumb(frac) {
    const {left, right} = this.slider.getBoundingClientRect();
    let {left: lthumb, right: wthumb} = this.thumb.getBoundingClientRect();
    wthumb -= lthumb;
    this.thumb.style.left = ((right-wthumb-left)*frac) + "px";
    if (this.callback) this.callback(frac);
  }

  getThumb() {
    const {left, right} = this.slider.getBoundingClientRect();
    let {left: lthumb, right: width} = this.thumb.getBoundingClientRect();
    width -= lthumb;
    width = right - left - width;
    let frac = (lthumb - left) / width;
    if (frac < 0) frac = 0;
    else if (frac > 0.995) frac = 1;
    return frac;
  }
}

const animationControl = new AnimationControl("animation-control", (frac) => {
  drawFigure(parseInt(currentPage.value), frac);
  app.renderer.render({container: app.stage});
});

/* ------------------------------------------------------------------------ */

class Space {
  constructor(parent, virtualStage) {
    const space = new Container();
    parent.addChild(space);
    this.space = space;
    if (virtualStage) {
      this.observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          let w, h;
          if (entry.contentBoxSize) {
            const box = entry.contentBoxSize[0];
            [w, h] = [box.inlineSize, box.blockSize];
          } else {
            const box = entry.contentRect;
            [w, h] = [box.width, box.height];
          }
          this.rescale(w, h);
        }
      });
      this.observer.observe(canvas.parentElement);
      this.center = [0.5, 0.5];
      this.rescale();
    } else {
      this.center = [0, 0];
    }
    this.graphics = null;
  }

  rescale(width, height, scale, draw=true) {
    const space = this.space;
    if (this.observer) {  // this is the virtual stage
      [width, height] = [app.screen.width, app.screen.height];
      overlayTexture.resize(width, height);  // overlay same size as canvas
      rem = parseInt(getComputedStyle(document.documentElement).fontSize);
    }
    if (scale !== undefined) {
      const [x, y] = [width, height];
      space.position.set(x, y);
      space.scale.set(scale, scale);
    } else {
      const [xcen, ycen] = this.center;
      const [xmax, ymax] = [xcen*width, ycen*height];
      space.position.set(xmax, ymax);
      // Set up virtual stage so that smaller dimension is always 500 units.
      const sc = ((xmax < ymax)? xmax : ymax) / 500;
      space.scale.set(sc, sc);
    }
    if (draw) app.renderer.render({container: app.stage});
  }

  add(...children) {
    this.space.addChild(...children);
  }

  removeChildAt(...indices) {
    for (let i of indices) {
      this.space.removeChildAt(i);
    }
  }

  childAt(i) {
    return this.space.getChildAt(i);
  }

  get visible() {
    return this.space.visible;
  }

  set visible(on) {
    this.space.visible = on;
  }
}

const virtualStage = new Space(app.stage, true);
const stage = virtualStage.space;
const positionSpace = new Space(stage);
const velocitySpace = new Space(stage);
const overlay = new Graphics().rect(-100, -100, 100, 100).fill("blue");
overlay.visible = false;
stage.addChild(overlay);

function drawOverlay(angle=0) {
  const scr = app.screen;
  let {x: width, y: height} = stage.toLocal({x: scr.width, y: scr.height});
  // let width = wh.x, height = wh.y;
  let {x, y} = stage.toLocal({x: 0, y: 0});
  width -= x;
  height -= y;
  if (calendarLike) {
    height *= Math.cos(angle);
  } else {
    width *= Math.cos(angle);
  }
  overlay.clear();
  overlay.rect(x, y, width, height).fill(figBgColor);
  overlay.rect(x, y, width, height).fill({texture: overlayTexture});
}

class Arrow {
  constructor(parent, style, lwhead, x0, y0, x1, y1) {
    const lineStyle = {...style};
    if (lwhead === undefined) lwhead = [2, 4, true];
    let [lhead, whead, widthScale] = lwhead;  // head length, half width
    let {width, color} = lineStyle;
    if (width === undefined) width = 1;
    if (color === undefined) color = "black";
    if (widthScale) {  // head dimensions optionally scaled by width
      lhead *= width;
      whead *= width;
    }
    if (y1 === undefined) {
      x0 = y0 = 0;
      x1 = 100;
      y1 = 0;
    }
    this.lhead = lhead;
    this.whead = whead;
    this.headScale = [lhead/width, whead/width];
    const both = new Container();
    both.addChild(new Graphics(), new Graphics());
    parent.addChild(both);
    this.both = both;
    both.position.set(x0, y0);  // position of arrow is its tail
    const line = both.getChildAt(0);
    const head = both.getChildAt(1);
    this.line = line;
    this.head = head;

    x1 -= x0;
    y1 -= y0;
    this.dxy = [x1, y1];
    let dr = Math.sqrt(x1**2 + y1**2);
    if (dr == 0) dr = x1 = 0.001;
    const [ex, ey] = [x1/dr, y1/dr];
    [x0, y0] = [x1 - lhead*ex, y1 - lhead*ey];  // center of base of head
    const [hx, hy] = [-whead*ey, whead*ex];
    head.moveTo(x1, y1).lineTo(x0+hx, y0+hy).lineTo(x0-hx, y0-hy)
      .closePath().fill(color);
    if (dr <= lhead) [x0, y0] = [-0.001*ex, -0.001*ey];
    line.moveTo(0, 0).lineTo(x0, y0).stroke(lineStyle);
  }

  get position() {  // tail position, with set method
    return this.both.position;
  }

  get visible() {
    return this.both.visible;
  }

  set visible(v) {
    this.both.visible = v;
  }


  get alpha() {
    return this.both.alpha;
  }

  set alpha(a) {
    this.both.alpha = a;
  }

  headVisible(v=true) {
    if (v != this.head.visible) {
      this.head.alpha = 1;
      this.head.visible = v;
      this.modify(...this.dxy);
    }
  }

  modify(dx, dy) {
    const {line, head, lhead, whead} = this;
    this.dxy = [dx, dy];
    if (head.visible) {
      let dr = Math.sqrt(dx**2 + dy**2);
      if (dr == 0) dr = dx = 0.001;
      const [ex, ey] = [dx/dr, dy/dr];
      let [x0, y0] = [dx - lhead*ex, dy - lhead*ey];  // center of base
      const [hx, hy] = [-whead*ey, whead*ex];
      head.clear().moveTo(dx, dy).lineTo(x0+hx, y0+hy).lineTo(x0-hx, y0-hy)
        .closePath().fill();
      if (dr <= lhead) [x0, y0] = [-0.001*ex, -0.001*ey];
      else if (head.alpha < 1) [x0, y0] = [dx, dy];
      line.clear().moveTo(0, 0).lineTo(x0, y0).stroke();
    } else {
      line.clear().moveTo(0, 0).lineTo(dx, dy).stroke();
    }
  }

  setLineWidth(lw) {
    this.line.strokeStyle.width = lw;
    const [lrel, wrel] = this.headScale;
    this.lhead *= lrel*lw;
    this.whead *= wrel*lw;
  }
}

class EllipsePlus {
  constructor(x, y, a, b, dma, sizes, colors) {
    // In v8 there is no obvious way to force the transform matrices
    // to be updated to their current values without rendering the scene.
    // Nevertheless, even without the correctly updated transform matrices,
    // the toGlobal function works properly.
    const scale = positionSpace.space.toGlobal({x:1, y:0}).x -
      positionSpace.space.toGlobal({x:0, y:0}).x;
    this.pscale = this.vscale = scale;
    // scale units in CSS root coords is 1 unit in positionSpace
    const rem0 = rem / scale;  // 1 CSS rem in positionSpace
    this.rem0 = rem0;
    this.sizes = sizes;  // sizes are in units of CSS rem
    let {lw, dot: dotSize, font: fontSize} = sizes;
    [lw, dotSize, fontSize] = [rem0*lw, rem0*dotSize, rem0*fontSize];
    this.colors = colors;
    const stroke = {color: colors.p, width: lw, cap: "round"};
    const vStroke = {color: colors.v, width: lw, cap: "round"};
    const aStroke = {color: colors.a, width: lw, cap: "round"};
    const opStroke = {color: colors.op, width: lw, cap: "round"};
    const vtStroke = {color: colors.vt, width: lw, cap: "round"};

    // ellipse .ellipse(0, 0, a, b)  circle .circle(c, 0, 2*a)
    // lineSQ, lineOP, linePQ, linePM,        focus[foc0, foc1], planet
    // sector, lineOQ, vtraj, vtrajr, velocity, accel
    this.offscale = [0, 0, 1];  // overall [xoffset, yoffset, scale]

    this.x = x;
    this.y = y;
    this.a = a;
    this.b = b;
    const c = Math.sqrt(a**2 - b**2);
    this.c = c;
    this.dma = dma;
    const ellipse = new Graphics().ellipse(0, 0, a, b)
          .fill(colors.f).stroke(stroke);
    this.ellipse = ellipse;
    // if object argument to stroke(), but not setStrokeStyle()?
    // type LineCap = 'butt' | 'round' | 'square'
    // type LineJoin = 'bevel' | 'round' | 'miter'
    const circle = new Graphics().circle(c, 0, 2*a).stroke(vStroke);
    const vplanet = new Graphics().circle(0, 0, dotSize).fill(colors.v);
    vplanet.position.set(2*a+c, 0);
    const lineSQ = new Graphics().moveTo(c, 0).lineTo(2*a+c,0).stroke(vStroke);
    const lineOP = new Graphics().moveTo(-c, 0).lineTo(a, 0).stroke(opStroke);
    const linePQ = new Graphics().moveTo(a, 0).lineTo(2*a+c,0).stroke(opStroke);
    const linePM = new Graphics().moveTo(a, c/2).lineTo(a,-c/2).stroke(stroke);
    const foc0 = new Graphics().circle(c, 0, dotSize).fill(colors.p);
    const foc1 = new Graphics().circle(-c, 0, dotSize).fill(colors.v);
    const planet = new Graphics().circle(0, 0, dotSize).fill(colors.p);
    const pointM = new Graphics().circle(0, 0, dotSize).fill(colors.p);
    planet.x = a;
    const [xx, yy, y0, xm, ym, xs, ys] = this.arcSolve(0);
    const sector = new Graphics().moveTo(xs, ys).lineTo(c, 0).lineTo(xx, y0)
      .arcTo(xm, ym, xs, ys, a).fill(colors.s);
    sector.scale.set(1, b/a);
    positionSpace.add(ellipse, sector, lineOP, linePM, linePQ,
                      foc0, planet, pointM);
    velocitySpace.add(lineSQ, circle, foc1, vplanet);
    const lineOQ = new Arrow(velocitySpace.space, vStroke, [24, 12],
                             -c, 0, 2*a+c, 0);
    lineOQ.headVisible(false);
    const radius = new Arrow(positionSpace.space, stroke, [24, 12],
                             c, 0, a, 0);
    const vScale = dma * a/b;  // common dt for vel arrow and shaded sector
    this.vScale = vScale;
    const vtrajr = new Graphics().moveTo(a, -vScale*c).lineTo(
      a, -vScale*a).stroke(vtStroke);
    const vtraj = new Graphics().arc(a, -vScale*c, vScale*a,
      0, twoPi).stroke(vtStroke);
    positionSpace.add(vtrajr, vtraj);
    const velocity = new Arrow(positionSpace.space, vStroke, [24, 12],
                               a, 0, a, -vScale*(a+c));
    const aScale = (vScale*b)**2/(a*c);  // common dt for vel and acc arrows
    this.aScale = aScale;
    const accel = new Arrow(positionSpace.space, aStroke, [24, 12],
                            a, -vScale*(a+c),
                            a-aScale*c*(a/(a-c))**2, -vScale*(a+c), 0);
    this.focus = [foc0, foc1];
    this.planet = planet;
    this.sector = sector;
    this.radius = radius;
    this.velocity = velocity;
    this.accel = accel;
    this.lineOP = lineOP;
    this.linePQ = linePQ;
    this.lineOQ = lineOQ;
    this.linePM = linePM;
    this.lineSQ = lineSQ;
    this.vplanet = vplanet;
    this.pointM = pointM;
    this.circle = circle;
    this.ma = 0;
    foc1.visible = lineOP.visible = linePQ.visible = vplanet.visible = false;
    radius.visible = velocity.visible = accel.visible = linePM.visible = false;
    circle.visible = lineSQ.visible = lineOQ.visible = pointM.visible = false;
    this.vtraj = vtraj;
    this.vtrajr = vtrajr
    vtraj.visible = vtrajr.visible = false;

    const style = new TextStyle({
      fontFamily: "Arial", fontSize: 1.17*rem/scale, fontWeight: "bold",
    });
    const sLabel = new Text({text: "S", style: style});
    sLabel.anchor.set(0.5, 0.5);
    const offset = 0.8*rem0;
    this.labelOffset = 0.8;
    sLabel.position.set(c, offset);
    const oStyle = style.clone();
    oStyle.fill = colors.v;
    const oLabel = new Text({text: "O", style: oStyle});
    oLabel.anchor.set(0.5, 0.5);
    oLabel.position.set(-c, offset);
    oLabel.visible = false;
    const pLabel = new Text({text: "P", style: style});
    pLabel.anchor.set(0.5, 0.5);
    pLabel.position.set(a+offset, 0);
    const mLabel = new Text({text: "M", style: style});
    mLabel.anchor.set(0.8, 0.5);
    mLabel.position.set(a-offset, 0);
    mLabel.visible = false;
    const qLabel = new Text({text: "Q", style: oStyle});
    qLabel.anchor.set(0.5, 0.5);
    qLabel.position.set(2*a+c+offset, 0);
    qLabel.visible = false;
    positionSpace.add(sLabel, pLabel, mLabel);
    velocitySpace.add(oLabel, qLabel);
    this.label = [sLabel, pLabel, oLabel, qLabel, mLabel];
  }

  checkScale() {
    const pscale = positionSpace.space.toGlobal({x:1, y:0}).x -
      positionSpace.space.toGlobal({x:0, y:0}).x;
    const vscale = velocitySpace.space.toGlobal({x:1, y:0}).x -
      velocitySpace.space.toGlobal({x:0, y:0}).x;
    // If size of Space has changed, PIXI line widths and font sizes will
    // scale, but we want to keep them a constant size in screen pixels,
    // just like the font size in ordinary html elements.
    if (pscale != this.pscale) {
      this.pscale = pscale;
      const rem0 = rem / pscale;
      let {lw, dot, font} = this.sizes;
      [lw, dot, font] = [rem0*lw, rem0*dot, rem0*font];
      const {ellipse, lineOP, linePQ, linePM, vtraj, vtrajr} = this;
      for (let g of [ellipse, lineOP, linePQ, linePM, vtraj, vtrajr])
        g.strokeStyle.width = lw;
      ellipse.clear().ellipse(0, 0, this.a, this.b).fill().stroke();
      this.lineOQ.setLineWidth(lw);
      this.planet.clear().circle(0, 0, dot).fill();
      this.pointM.clear().circle(0, 0, dot).fill();
      this.focus[0].clear().circle(this.c, 0, dot).fill();
      const offset = this.labelOffset * rem / pscale;
      this.label[0].position.set(this.c, offset);
      for (let i of [0, 1, 4]) this.label[i].style.fontSize = font;
    }
    if (vscale != this.vscale) {
      this.vscale = vscale;
      const rem0 = rem / pscale;
      let {lw, dot, font} = this.sizes;
      [lw, dot, font] = [rem0*lw, rem0*dot, rem0*font];
      const {circle, lineSQ} = this;
      for (let g of [circle, lineSQ]) g.strokeStyle.width = lw;
      circle.clear().circle(this.c, 0, 2*this.a).stroke();
      const {radius, velocity, accel} = this;
      for (let a of [radius, velocity, accel]) a.setLineWidth(lw);
      this.vplanet.clear().circle(0, 0, dot).fill();
      this.focus[1].clear().circle(-this.c, 0, dot).fill();
      const offset = this.labelOffset * rem / vscale;
      this.label[2].position.set(-this.c, offset);
      for (let i of [2, 3]) this.label[i].style.fontSize = font;
    }
  }

  // move planet to new place on ellipse, specified by mean anomaly (radians)
  pMove(ma, dma0, ma1) {
    this.checkScale();
    let dither;
    if (ma.length) [ma, dither] = ma;
    const [x, y, y0, xm, ym, xs, ys] = this.arcSolve(ma, dma0);
    const {a, c, vScale, aScale} = this;
    this.planet.position.set(x, y);
    this.radius.modify(x-c, y);
    this.velocity.position.set(x, y);
    const vr = a / Math.sqrt((x-c)**2 + y**2);
    const [vx, vy] = [vScale*vr*y, vScale*(vr*(c-x) - c)];
    this.velocity.modify(vx, vy);
    let [ang0, ang1, vyc] = [0, twoPi, vScale*c];
    if (ma1 !== undefined && ma-ma1 > twoPi && ma-ma1 < 2*twoPi) {
      const [x1, y1] = this.arcSolve(ma1);
      const vr1 = a / Math.sqrt((x1-c)**2 + y1**2);
      const [vx1, vy1c] = [vScale*vr1*y1, vScale*vr1*(c-x1)];
      ang0 = Math.atan2(vy+vyc, vx);
      ang1 = Math.atan2(vy1c, vx1);
    }
    this.vtraj.clear().arc(x, y-vyc, vScale*a, ang0, ang1).stroke();
    this.vtrajr.clear().moveTo(x, y-vyc).lineTo(x+vx, y+vy).stroke();
    this.accel.position.set(x+vx, y+vy);
    const ar = aScale * vr**2;
    this.accel.modify(ar*(c-x), -ar*y);
    const [qx, qy] = [c + 2*vr*(x-c), 2*vr*y];
    const [mx, my] = [0.5*(qx+c) - c, 0.5*qy];
    this.pointM.position.set(mx, my);
    const fq = Math.sqrt((qx+c)**2 + qy**2);
    const [ex, ey] = [qy/fq, -(qx+c)/fq];  // tangent direction
    const hang = (y < 0)? c/2 : -c/2;
    const [t1x, t1y] = [x - ex*hang, y - ey*hang];
    const [t0x, t0y] = [mx + ex*hang, my + ey*hang];
    this.linePM.clear().moveTo(t1x, t1y).lineTo(t0x, t0y).stroke();
    let [xd, yd] = [x, y];
    if (dither !== undefined) {
      [xd, yd] = [x - ex*hang*dither, y - ey*hang*dither]
      this.planet.position.set(xd, yd);
      this.radius.modify(xd-c, yd);
    }
    this.lineOP.clear().moveTo(-c, 0).lineTo(xd, yd).stroke();
    this.linePQ.clear().moveTo(xd, yd).lineTo(qx, qy).stroke();
    this.lineOQ.modify(qx+c, qy);
    this.lineSQ.clear().moveTo(c, 0).lineTo(qx, qy).stroke();
    this.vplanet.position.set(qx, qy);
    const offset = this.labelOffset;  // label offset in rem
    const [offp, offv] = [offset*rem/this.pscale, offset*rem/this.vscale];
    let factor = 1 + offp/Math.sqrt(xd**2 + yd**2);
    this.label[1].position.set(factor*xd, factor*yd);
    factor = 1 + 1.25*offp/Math.sqrt(mx**2 + my**2);
    this.label[4].position.set(factor*mx, factor*my);
    factor = 1 + offv/Math.sqrt(qx**2 + qy**2);
    this.label[3].position.set(factor*qx, factor*qy);
    this.sector.clear().moveTo(xs, ys).lineTo(c, 0).lineTo(x, y0)
      .arcTo(xm, ym, xs, ys, a).fill();
    ellipse.ma = ma % twoPi;
  }

  setAlphas(kepler, newton) {
    positionSpace.rescale(0, 0, 1, false);
    velocitySpace.rescale(0, 0, 1, false);
    let {ellipse, sector, radius, velocity, accel, focus, lineOP, linePQ,
         label, circle, lineOQ, linePM, pointM, lineSQ, vplanet} = this;
    if (kepler == -1) {
      focus[0].visible = this.planet.visible = false;
      label[0].visible = label[1].visible = false;
      kepler = newton = 0;
    } else {
      focus[0].visible = this.planet.visible = true;
      label[0].visible = label[1].visible = true;
    }
    if (newton === undefined) newton = 1 - kepler;
    ellipse.visible = sector.visible = (kepler != 0);
    radius.visible = velocity.visible = accel.visible = (newton != 0);
    ellipse.alpha = sector.alpha = (kepler == 0)? 1 : kepler;
    radius.alpha = velocity.alpha = accel.alpha = (newton == 0)? 1 : newton;
    radius.headVisible(true);
    focus[1].visible = lineOP.visible = linePQ.visible = false;
    label[2].visible = label[3].visible = label[4].visible = false;
    focus[1].alpha = lineOP.alpha = label[2].alpha = pointM.alpha = 1;
    lineOQ.visible = linePM.visible = pointM.visible = lineSQ.visible = false;
    lineOQ.alpha = linePM.alpha = label[4].alpha = 1;
    vplanet.visible = circle.visible = false;
    lineOP.position.set(0, 0);  // moved during one figure animation
    linePQ.pivot.set(0, 0);
    linePQ.rotation = 0;
    linePQ.position.set(0, 0);
    this.vtraj.visible = this.vtrajr.visible = false;
  }

  eaSolve(ma, tol=1.e-6) {
    const eps = this.c/this.a, sin = Math.sin, cos = Math.cos, abs = Math.abs;
    let ea = ma, dma;
    let npass = 0;
    while (npass < 10) {  // Use Newton iteration to solve Kepler's equation.
      npass += 1;
      dma = ma - (ea - eps*sin(ea));
      if (abs(dma) < tol) break;
      ea += dma / (1 - eps*cos(ea));
    }
    return ea;
  }

  arcSolve(ma, dma0) {
    const {a, b, dma} = this;
    if (dma0 === undefined) dma0 = dma;
    const ea = this.eaSolve(ma);
    let [x, y] = [a*Math.cos(ea), a*Math.sin(ea)];
    const eas = this.eaSolve(ma + dma0);
    let [xs, ys] = [a*Math.cos(eas), a*Math.sin(eas)];
    // (-y, x) is 90 degrees ahead of (x, y)
    const ttho2 = (ys*x - xs*y)/(a**2 + xs*x + ys*y);  // sin(th)/(1+cos(th))
    let [xm, ym] = [x - ttho2*y, y + ttho2*x];
    return [x, -y*b/a, -y, xm, -ym, xs, -ys];
  }
}

const twoPi = 2*Math.PI;

// #d0c3a4 is hsl(42, 32%, 73%)
// #c1b497 is hsl(41, 25%, 67%)
// #d9cfba is hsl(41, 29%, 79%)
// #073642 is hsl(192, 81%, 14%)
const xform = new Transform();
const ellipse = new EllipsePlus(
  0, 0, 400, 320, Math.PI/10, {lw: 0.12, dot: 0.24, font: 1.2},
  {f: "#d9cfba", p: "#073642", v: "#0000bb", a: "#5c4033", op: "#008800",
   vt: "#6c6ce6", s: "#8884"});

// velocitySpace.space.rotation = -Math.PI/2;
// velocitySpace.rescale(0, 60, 0.5);
// positionSpace.rescale(-60, 0, 0.5);

/* ------------------------------------------------------------------------ */

app.ticker.autoStart = false;

class Transition {
  constructor(trigger, dts, updateScene) {
    this.trigger = trigger;  // place at which this transition triggers
    this.update = updateScene;  // argument is frac = interp(t, ...dts)
    let [dti, dt, dtf] = (dts.length === undefined)? [dts] : dts;
    if (dt === undefined) [dti, dt, dtf] = [0, dti, 0];
    if (dtf === undefined) dtf = 0;
    this.dts = [dti, dt, dtf];
    this.dt0 = dti + dt + dtf;
    this.t = 0;
  }

  start(down) {
    this.t = down? this.dt0 : 0;
    this.update(down? 1 : 0);
  }

  finish(down) {
    this.t = down? 0 : this.dt0;
    this.update(down? 0 : 1);
  }

  step(dms) {
    let {t, dt0, dts, update} = this;
    t += dms;
    update(interp(t, ...dts));
    let more = (dms < 0)? (t > 0) : (t < dt0);
    if (dms < 0) this.t = more? t : 0;
    else this.t = more? t : dt0;
    return more;
  }
}

class Animator {
  constructor(dts, updateScene, delay=0) {
    this.update = updateScene;  // argument is frac = interp(t, ...dts)
    let [dti, dt, dtf] = (dts.length === undefined)? [dts] : dts;
    if (dt === undefined) [dti, dt, dtf] = [0, dti, 0];
    if (dtf === undefined) dtf = 0;
    this.dts = [dti, dt, dtf];
    this.delay = delay;
    this.t = 0;
    this.started = false;
  }

  cancel() {
    this.update(1);  // final step
    this.started = false;
  }

  start(noDelay) {
    this.t = noDelay? this.delay : 0;
    this.started = true;
  }

  step(dms) {
    if (!this.started) return false;
    const t = this.t - this.delay;
    this.t += dms;
    if (t < 0) return true;
    const frac = interp(t, ...this.dts);
    const more = (frac < 1);
    this.update(frac);
    this.started = more
    return more;
  }
}

function interp(t, dti, dt, dtf) {
  if (t <= 0) return 0;
  if (dti || dtf) {
    const dt1 = dti + dt;
    const dt2 = dt1 + dtf;
    if (t >= dt2) return 1;
    // dfdt = gi * t, then gi*dti, then gf*(dt2 - t)
    //    v = gi*dti = gf*dt1
    // df = 0.5*v*dti, then v*dt, then 0.5*v*dtf
    //    1 = 0.5*v*dti + v*dt + 0.5*v*dtf
    //    2 = v*(dti + 2*dt + dtf)
    const v = 2/(dt2 + dt);
    if (t < dti) return 0.5*v*t**2 / dti;  // impossible if dti == 0
    if (t <= dt1) return v*(t - 0.5*dti);
    // impossible if dtf == 0
    return 1 - 0.5*v*(dt2 - t)**2 / dtf;
  } else {
    return (t >= dt)? 1 : t / dt;
  }
}

/* ------------------------------------------------------------------------ */

function blankFigure() {
  ellipse.setAlphas(-1);
}

const figures = pages.map((p) => blankFigure);
const astates = pages.map((p) => [0, 0]);  // animation [duration, fraction]
let nFigures = 0;
function defineFigure(f, duration=0) {
  if (nFigures >= pages.length) {
    console.log("discarding figure beyond last page");
    return;
  }
  // If animated, f(frac) draws animation frame at 0<=frac<=1
  // otherwsie, simply define f(), so that f.length is zero if no animation.
  figures[nFigures] = f;
  astates[nFigures][0] = duration;  // animation duration in ms
  nFigures += 1;
}

// How Newton recast Kepler's Laws and grounded the heavens
defineFigure(() => {  // plain ellipse + sector, P at theta=0
  ellipse.setAlphas(1, 0);
  ellipse.pMove(0);
});
// How Kepler thinks about motion
defineFigure((frac) => {  // plain ellipse + sector, P at theta=pi/10
  ellipse.setAlphas(1, 0);
  ellipse.pMove(twoPi*(0.05 + 3*frac));
}, 12000);
// How Newton thinks about motion
defineFigure((frac) => {  // plain r+v+g vectors, P at theta=pi/10
  ellipse.setAlphas(0, 1);
  // Of three orbits, want first half to step by 1/20, second half by 1/40
  // third half by 1/80, fourth half by 1/160, third orbit continuous.
  const period = 1./3.;
  let dma = 0;
  if (frac < 0.5*period) {
    frac -= (frac % (period/10));
    dma = twoPi / 10;
  } else if (frac < period) {
    frac -= (frac % (period/20));
    dma = twoPi / 20;
  } else if (frac < 1.5*period) {
    frac -= (frac % (period/40));
    dma = twoPi / 40;
  } else if (frac < 2*period) {
    frac -= (frac % (period/80));
    dma = twoPi / 80;
  } else if (frac < 2.5*period) {
    frac -= (frac % (period/160));
    dma = twoPi / 160;
  }
  ellipse.pMove(twoPi*(0.05 + 3*frac), dma);
  ellipse.ellipse.visible = ellipse.sector.visible = true;
  ellipse.velocity.visible = ellipse.accel.visible = false;
  ellipse.ellipse.alpha = ellipse.sector.alpha = 1;
}, 12000);
// Velocity trajectory
defineFigure((frac) => {  // plain r+v+g vectors, P at theta=pi/10
  ellipse.setAlphas(0, 1);
  if (frac > 1./3.) {
    ellipse.pMove(twoPi*(0.05 + 3*frac), ellipse.dma, twoPi*0.05);
    ellipse.vtraj.visible = true;
    ellipse.vtrajr.visible = true;
    ellipse.vtrajr.alpha = (frac > 2./3.)? 1 : 3*frac - 1;
  } else {
    ellipse.pMove(twoPi*(0.05 + 3*frac));
  }
  ellipse.ellipse.visible = ellipse.sector.visible = true;
  ellipse.accel.visible = false;
  ellipse.ellipse.alpha = ellipse.sector.alpha = 1;
}, 15000);
// Defining an ellipse
defineFigure((frac) => {
  ellipse.setAlphas(0, 1);
  const {radius, velocity, accel, focus, lineOP, linePQ, label,
         vplanet} = ellipse;
  ellipse.ellipse.visible = true;
  if (radius.head.visible) radius.headVisible(false);
  velocity.visible = accel.visible = false;
  focus[1].visible = lineOP.visible = label[2].visible = true;
  focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
  let x, y, y0, x0;
  const {a, c} = ellipse;
  let [tprev, tnow, tnext] = [0, frac * dttot, dtparts[0]];
  if (tnow <= tnext) {
    [x, y0] = [tnow/tnext, 0.1];
    y = 1 + 7*y0;
    x0 = 4*y0/y;
    y *= x;
    y = (x < 2*x0)? 0.5*y*x/x0 - y + y0 : y - 7*y0;
    ellipse.pMove(twoPi*0.5*y);
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[1]];
  if (tnow <= tnext) {
    ellipse.pMove(twoPi*0.5);
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    if (x < 1./3) {
      lineOP.alpha = (x < 0.25)? 4*x : 1;
      lineOP.position.set(a+c, 0);
    } else {
      x = 1.5*x - 0.5;  // varies from 0 to 1
      y = 0.5 - Math.abs(x-0.5);
      if (y > 0.05) y = 0.05;
      lineOP.position.set((a+c)*(1-x), -c*y);
    }
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[2]];
  if (tnow <= tnext) {
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    ellipse.pMove(twoPi*(0.5 + 0.3*x));
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[3]];
  if (tnow <= tnext) {
    ellipse.pMove(twoPi*0.8);
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[4]];
  if (tnow <= tnext) {
    ellipse.pMove(twoPi*0.8);
    linePQ.visible = true;
    [x0, y0] = ellipse.arcSolve(twoPi*0.8);
    linePQ.pivot.set(x0, y0);  // also changes position??
    let ang = 0.5*twoPi - Math.atan2(y0, x0-c) + Math.atan2(y0, x0+c);
    x = 1.5*(tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    linePQ.rotation = (x < 1)? ang*(1-x) : 0;
    linePQ.position.set(x0, y0);  // fix pivot?
    label[3].visible = vplanet.visible = x >= 1;
    return;
  }
  linePQ.visible = label[3].visible = true;
  ellipse.circle.visible = true;
  [tprev, tnext] = [tnext, tnext + dtparts[5]];
  if (tnow <= tnext) {
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    positionSpace.rescale(-0.5*c*x, 0, 1-0.5*x, false);
    velocitySpace.rescale(-0.5*c*x, 0, 1-0.5*x, false);
    ellipse.pMove(twoPi*0.8);
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[6]];
  if (tnow <= tnext) {
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    positionSpace.rescale(-0.5*c, 0, 0.5, false);
    velocitySpace.rescale(-0.5*c, 0, 0.5, false);
    ellipse.pMove(twoPi*(0.8 + x));
  }
}, [5000, 4000, 2000, 1000, 1500, 2000, 5000]);
// Tangent to an ellipse
defineFigure((frac) => {
  ellipse.setAlphas(0, 1);
  const {radius, velocity, accel, focus, lineOP, linePQ, label,
    lineOQ, linePM, vplanet, pointM} = ellipse;
  ellipse.ellipse.visible = vplanet.visible = true;
  if (radius.head.visible) radius.headVisible(false);
  velocity.visible = accel.visible = false;
  focus[1].visible = lineOP.visible = label[2].visible = true;
  focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
  let x, y, y0, x0;
  const {a, c} = ellipse;
  positionSpace.rescale(-0.5*c, 0, 0.5, false);
  velocitySpace.rescale(-0.5*c, 0, 0.5, false);
  linePQ.visible = lineOQ.visible = label[3].visible = pointM.visible = true;
  ellipse.circle.visible = linePM.visible = label[4].visible = true;
  ellipse.pMove(twoPi*(0.8 + x));
  let [tprev, tnow, tnext] = [0, frac * dttot, dtparts[0]];
  if (tnow <= tnext) {
    x = tnow / tnext;
    lineOQ.alpha = linePM.alpha = pointM.alpha = label[4].alpha = x;
    ellipse.pMove(twoPi*0.8);
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[1]];
  if (tnow <= tnext) {
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    ellipse.pMove(twoPi*(0.8 + 0.25*x));
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[2]];
  if (tnow <= tnext) {
    ellipse.pMove(twoPi*0.05);
    return;
  }
  [tprev, tnext] = [tnext, tnext + dtparts[3]];
  if (tnow <= tnext) {
    x = (tnow - tprev)/(tnext - tprev);  // varies from 0 to 1
    ellipse.pMove([twoPi*0.05, -Math.sin(twoPi*x)]);
    ellipse.lineSQ.visible = x < 0.995;
    return;
  }
}, [2000, 2000, 1000, 4000]);
defineFigure((frac) => {  // simple SPO diagram, P at theta=pi/10
  ellipse.setAlphas(0, 1);
  const {radius, velocity, accel, focus, lineOP, label} = ellipse;
  ellipse.ellipse.visible = true;
  if (radius.head.visible) radius.headVisible(false);
  velocity.visible = accel.visible = false;
  focus[1].visible = lineOP.visible = label[2].visible = true;
  focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
  ellipse.pMove(twoPi*(0.05 + 0.55*frac));
}, 3000);

window.app = app;
window.theText = theText;

window.ellipse = ellipse;

window.CssTransition = CssTransition;
window.stage = stage;

// Set initial page according to #currentPage <input> element.
if (endPage < figures.length) {  // get rid of this test eventually
  changeFigure(true);  // turn to initial page
} else {
  changePage(true);
}

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
