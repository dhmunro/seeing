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
  const dt = window.getComputedStyle(pages[0]).getPropertyValue(p);
  let dms = parseFloat(dt);
  if (dt.slice(-2) != "ms") {  // But dt always in units of s?
    dms *= 1000;
  }
  return dms;
})("transition-duration");
const figBgColor = (p =>
  window.getComputedStyle(theFigure).getPropertyValue(p)
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
    window.getComputedStyle(pages[q]).getPropertyValue("transform");
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
    figures[q](0);
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
    figures[q](astates[q][1]);
    app.renderer.render({container: app.stage, target: overlayTexture});
    // Redraw old figure on canvas, with overlay visible but initially rotated.
    figures[p](0);
    overlay.visible = true;
    // Animate new figure rotating to cover old.
    figEaseOut.start();
  } else if (q > p) {  /* turn figure side first, then trigger text side */
    // Draw old figure to overlay texture.  Set overlay to 0 degrees.
    figures[p](astates[p][1]);
    app.renderer.render({container: app.stage, target: overlayTexture});
    // Draw new figure on canvas, with overlay visible, initially covering it.
    figures[q](0);
    overlay.visible = true;
    // Animate old figure rotating to expose new.
    figEaseIn.start();
  } else {  // can have q==p when initializing
    figures[q](0);
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
    figures[endPage](0);
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
  let p = parseInt(currentPage.value);
  figures[p](frac);
  app.renderer.render({container: app.stage});
  astates[p][1] = frac;
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

  rescale(width, height, scale) {
    const space = this.space;
    if (this.observer) {  // this is the virtual stage
      [width, height] = [app.screen.width, app.screen.height];
      overlayTexture.resize(width, height);  // keep RenderTexture same size as canvas
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
    app.renderer.render({container: app.stage});
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
}

class EllipsePlus {
  constructor(x, y, a, b, fill, stroke, dotSize, dotStyle, dma, sectStyle) {
    this.x = x;
    this.y = y;
    this.a = a;
    this.b = b;
    const c = Math.sqrt(a**2 - b**2);
    this.c = c;
    this.dma = dma;
    const ellipse = new Graphics().ellipse(0, 0, a, b)
          .fill(fill).stroke(stroke);
    this.ellipse = ellipse;
    // if object argument to stroke(), but not setStrokeStyle()?
    // type LineCap = 'butt' | 'round' | 'square'
    // type LineJoin = 'bevel' | 'round' | 'miter'
    const vColor = "#0000bb", aColor = "#5c4033", opColor = "#008800";
    const vStroke = {...stroke};
    vStroke.color = vColor;
    const aStroke = {...stroke};
    aStroke.color = aColor;
    const opStroke = {...stroke};
    opStroke.color = opColor;
    const circle = new Graphics().circle(c, 0, 2*a).stroke(vStroke);
    const vplanet = new Graphics().circle(0, 0, dotSize).fill(vColor);
    vplanet.position.set(2*a+c, 0);
    const lineSQ = new Graphics().moveTo(c, 0).lineTo(2*a+c,0).stroke(vStroke);
    const lineOP = new Graphics().moveTo(-c, 0).lineTo(a, 0).stroke(opStroke);
    const linePQ = new Graphics().moveTo(a, 0).lineTo(2*a+c,0).stroke(opStroke);
    const linePM = new Graphics().moveTo(a, c/2).lineTo(a,-c/2).stroke(vStroke);
    const foc0 = new Graphics().circle(c, 0, dotSize).fill(dotStyle);
    const foc1 = new Graphics().circle(-c, 0, dotSize).fill(vColor);
    const planet = new Graphics().circle(0, 0, dotSize).fill(dotStyle);
    planet.x = a;
    const [xx, yy, y0, xm, ym, xs, ys] = this.arcSolve(0);
    const sector = new Graphics().moveTo(xs, ys).lineTo(c, 0).lineTo(xx, y0)
      .arcTo(xm, ym, xs, ys, a).fill(sectStyle);
    sector.scale.set(1, b/a);
    positionSpace.add(ellipse, sector, lineOP, linePQ, linePM);
    velocitySpace.add(lineSQ, circle, foc1, vplanet);
    const lineOQ = new Arrow(velocitySpace.space, vStroke, [24, 12],
                             -c, 0, 2*a+c, 0);
    lineOQ.headVisible(false);
    positionSpace.add(foc0, planet);
    const radius = new Arrow(positionSpace.space, stroke, [24, 12],
                             c, 0, a, 0);
    const vScale = dma * a/b;  // common dt for vel arrow and shaded sector
    this.vScale = vScale;
    const vtStroke = {...stroke};
    vtStroke.color = "#6c6ce6";
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
    this.ma = 0;
    foc1.visible = lineOP.visible = linePQ.visible = vplanet.visible = false;
    radius.visible = velocity.visible = accel.visible = linePM.visible = false;
    circle.visible = lineSQ.visible = lineOQ.visible = false;
    this.vtraj = vtraj;
    this.vtrajr = vtrajr
    vtraj.visible = vtrajr.visible = false;

    const style = new TextStyle({
      fontFamily: "Arial", fontSize: 30, fontWeight: "bold",
    });
    const sLabel = new Text({text: "S", style: style});
    sLabel.anchor.set(0.5, 0.5);
    const offset = 20;
    this.labelOffset = offset;
    sLabel.position.set(c, offset);
    const oStyle = style.clone();
    oStyle.fill = vColor;
    const oLabel = new Text({text: "O", style: oStyle});
    oLabel.anchor.set(0.5, 0.5);
    oLabel.position.set(-c, offset);
    oLabel.visible = false;
    const pLabel = new Text({text: "P", style: style});
    pLabel.anchor.set(0.5, 0.5);
    pLabel.position.set(a+offset, 0);
    positionSpace.add(sLabel, pLabel, oLabel);
    const qLabel = new Text({text: "Q", style: oStyle});
    qLabel.anchor.set(0.5, 0.5);
    qLabel.position.set(2*a+c+offset, 0);
    qLabel.visible = false;
    positionSpace.add(sLabel, pLabel);
    velocitySpace.add(oLabel, qLabel);
    this.label = [sLabel, pLabel, oLabel, qLabel];

    // In v8 there is no obvious way to force the transform matrices
    // to be updated to their current values without rendering the scene.
    // Nevertheless, even without the correctly updated transform matrices,
    // the toGlobal function works properly.
    const scale = positionSpace.space.toGlobal({x:1, y:0}).x -
          positionSpace.space.toGlobal({x:0, y:0}).x;
    this.scale0 = this.pscale = this.vscale = scale;
  }

  checkScale() {
    const pscale = positionSpace.space.toGlobal({x:1, y:0}).x -
          positionSpace.space.toGlobal({x:0, y:0}).x;
    const vscale = velocitySpace.space.toGlobal({x:1, y:0}).x -
          velocitySpace.space.toGlobal({x:0, y:0}).x;
    if (pscale == this.pscale && vscale == this.vscale) return;
  }

  // move planet to new place on ellipse, specified by mean anomaly (radians)
  pMove(ma, dma0, ma1) {
    this.checkScale();
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
    this.lineOP.clear().moveTo(-c, 0).lineTo(x, y).stroke();
    this.linePQ.clear().moveTo(x, y).lineTo(qx, qy).stroke();
    this.lineOQ.modify(qx+c, qy);
    this.lineSQ.clear().moveTo(c, 0).lineTo(qx, qy).stroke();
    this.vplanet.position.set(qx, qy);
    let factor = 1 + this.labelOffset/Math.sqrt(x**2 + y**2);
    this.label[1].position.set(factor*x, factor*y);
    factor = 1 + this.labelOffset/Math.sqrt(qx**2 + qy**2);
    this.label[3].position.set(factor*qx, factor*qy);
    this.sector.clear().moveTo(xs, ys).lineTo(c, 0).lineTo(x, y0)
      .arcTo(xm, ym, xs, ys, a).fill();
    const [mx, my] = [0.5*(qx+c) - c, 0.5*qy];
    const fq = Math.sqrt((qx+c)**2 + qy**2);
    const [ex, ey] = [qy/fq, -(qx+c)/fq];  // tangent direction
    const hang = (y < 0)? c/2 : -c/2;
    const [t1x, t1y] = [x - ex*hang, y - ey*hang];
    const [t0x, t0y] = [mx + ex*hang, my + ey*hang];
    this.linePM.clear().moveTo(t1x, t1y).lineTo(t0x, t0y).stroke();
    ellipse.ma = ma % twoPi;
  }

  setAlphas(kepler, newton) {
    let {ellipse, sector, radius, velocity, accel, focus, lineOP, label} = this;
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
    focus[1].visible = lineOP.visible = label[2].visible = false;
    focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
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
const ellipse = new EllipsePlus(0, 0, 400, 320, "#d9cfba",
                                {color: "#073642", width: 3, cap: "round"},
                                6, "#073642", Math.PI/10, "#8884");

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
defineFigure((frac) => {  // simple SPO diagram, P at theta=pi/10
  ellipse.setAlphas(0, 1);
  const {radius, velocity, accel, focus, lineOP, label} = ellipse;
  ellipse.ellipse.visible = true;
  if (radius.head.visible) radius.headVisible(false);
  velocity.visible = accel.visible = false;
  focus[1].visible = lineOP.visible = label[2].visible = true;
  focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
  const [x, a] = [frac, 0.1];
  let y = 1 + 7*a;
  const x0 = 4*a/y;
  y *= x;
  y = (x < 2*x0)? 0.5*y*x/x0 - y + a : y - 7*a;
  ellipse.pMove(twoPi*0.5*y);
}, 6000);
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
