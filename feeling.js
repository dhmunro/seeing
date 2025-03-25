/* import {Application, Container, Graphics, Text, TextStyle,
   Transform} from 'pixi.js'; */
const {Application, Container, Graphics, Text, TextStyle, Transform,
       RenderTexture} = PIXI

/* ------------------------------------------------------------------------ */

const theText = document.querySelector("#text-box");
const paragraphs = Array.from(theText.querySelectorAll("p"));
const currentPage = document.getElementById("currentPage");
const pages = Array.from(theText.querySelectorAll("div.page"));
pages[0].classList.add("hidden");
for (let i = 0; i < pages.length; i += 1) {
  if (i == parseInt(currentPage.value)) {
    pages[i].classList.remove("hidden");
  } else {
    pages[i].classList.add("hidden");
  }
}
const HELP_PANEL = document.getElementById("help-panel");

const canvas = document.getElementById("figure");
const app = new Application();
await app.init({canvas: canvas, resizeTo: canvas.parentElement,
                background: 0xd0c3a4, antialias: true,
                autoDensity: true,  // makes renderer view units CSS pixels
                resolution: window.devicePixelRatio || 1});
// PIXI.Text has independent resolution option

const auxcanvas = document.getElementById("auxfigure");
const auxctx = auxcanvas.getContext("2d");
window.fig = canvas;
window.auxfig = auxcanvas;
window.auxctx = auxctx;
window.app = app;

/* ------------------------------------------------------------------------ */
/*

The web page has three visual components: a text caption part, a figure part,
and a control part.  For landscape screens, the text and figure parts are side
by side with text on the left and figure on the right, and the control part
is a full width narrow strip at the bottom.  For portrait screens, the text
=art is at the top, the figure section occupies an equal height below the
text part, and the control part is again a narrow strip at the bottom.

These parts are defined by the classes "txt", "fig", and "ctl".  The ctl div is
a fixed html element.  Only a single txt or fig div is visible except during
transitions, when a second txt or fig may be visible under the first.  The
non-visible divs have both a "hidden" and "pending" class.  The "hidden" class
sets display:none, while the "pending" class sets a width multiplier to zero.
A txt div is right justified, so its right edge is always centered for any
width multiplier, while a fig div is left justified, so its left edge is always
cenetred for any width mulitplier.  (For portrait layout, txt is bottom
justified, fig is top justified, and height instead of width multipliers are
used.)  A third class "infront" is applied during transitions to set stacking
order.

A forward page-turning transition works like this:
1. Add "infront" class to old fig, then remove "hidden" from new fig.  The new
  fig remains hidden because it is behind the old.
2. Add "pending" to old fig, triggering the first half of the transition.
  This progressively reveals the new fig as the old fig on top shrinks to the
  center of the screen.
3. When the transition ends, add "hidden" and remove "pending" from old fig.
  Next add "infront" and "pending" to new txt, then remove "hidden" from
  new txt.  Finally, remove "pending" from new txt, triggering the second
  half of the transition.  This progressively covers the old txt with the new
  txt.  Note that you need to do window.getComputedStyle(newtxt).property
  where property is the animated width mulitplier between adding and removing
  the "pending" class to new txt.
4. When the transition ends, add "hidden" to the old txt and remove "infront"
  from the new txt.

The text side consists of "page" divs, with the number of divs equal to the
number of pages, and the page turning procedure is straightforward.

The figure side, however, presents a different challenge: There are only two
canvases.  One canvas is the one the javascript actually draws on, while the
second is an overlay used in the page turning.  The drawImage function first
copies the old figure to this second canvas, so there is a copy of the old
figure.  This can be placed in front of the live canvas, while the javascript
draws the new figure underneath.  The sequence to reveal the new figure then
depends on whether you are turning to the next page or to the previous page:

To switch to the next page, simply add the "pending" class to trigger the
scaling transition (also "easein").  When the transition ends, hide the
now zero width canvas with the copied old page, and remove the "pending" (and
"easein") and "infront" classes, then call the function to change the text
side.

To switch to the previous page, the procedure will be called when the text
side transition ends.  First add "hidden" and "pending" (and "easeout") to
the newly drawn figure that is under the copy of the old figure, then
remove "infront" from the old copy and add "infront" to the (now zero width)
new figure.  Next, remove "hidden", then "pending" to trigger the scaling
transition.  When the transition finishes, hide the old canvas, and remove
"infront" (and "easout") from the new figure.
*/

class ScrollPosition {
  constructor(callback, onend) {
    // callback should set canvas to correct picture
    // - it must never cause theText to scroll
    // Use clumsy hidden input to store currentPage so that page reload
    // does not return to page 0.
    pages[parseInt(currentPage.value)].classList.remove("hidden");
    this.highlight(0);
    this.onResize(callback);
    // theText.scrollTop is delayed when CSS scroll-behavior: smooth
    // keep separate value for eventual scrollTop position
    this.scrollTop = theText.scrollTop;
    window.addEventListener("resize", () => {
      if (this._resizeTimeout !== null) {
        clearTimeout(this._resizeTimeout);
      }
      this._resizeTimeout = setTimeout(
        () => this.onResize(callback), 50);
    });
    // theText.addEventListener("scroll", () => {
    //   callback(this.place());
    //   this.scrollTop = theText.scrollTop;
    // }, {passive: true});
    // theText.addEventListener("scrollend", () => {
    //   // every wheel event calls this, but not every scrollbar drag
    //   if (onend) onend(this.place());
    // });
    // theText.addEventListener("wheel", e => {
    //   e.preventDefault();
    //   // Apparently, deltaY is always +-120, which is supposed to be 3 lines.
    //   // Original idea was 1/8 degree, and most wheels step by 15 degrees.
    //   this.scrollBy(Math.sign(e.deltaY));
    // });
    window.addEventListener("keydown", e => {
      switch (e.key) {
      case "Home":
        this.scrollTop = 0;
        theText.scroll(0, 0);
        break;
      case "End":
        this.scrollTop = theText.scrollHeight - theText.clientHeight;
        theText.scroll(0, this.scrollTop);
        break;
      case "PageUp":
        this.stepPage(-1);
        break;
      case "PageDown":
        this.stepPage();
        break;
      case "ArrowUp":
      case "Up":
        this.scrollBy(-1);
        break;
      case "ArrowDown":
      case "Down":
        this.scrollBy(1);
        break;
      default:
        return;
      }
      e.preventDefault();
    });
  }

  scrollBy(nlines) {
    this.scrollTop += nlines*this.lineHeight;
    theText.scroll(0, this.scrollTop);
  }

  stepParagraph(back) {
    let i = this.iNow;
    if (back) {
      if (i > 0) i -= 1;
    } else {
      if (i < paragraphs.length - 1) i += 1;
    }
    this.scrollTop = Math.floor(this.tops[i] + 0.001);
    theText.scroll(0, this.scrollTop);
  }

  stepPage(back) {
    let p = parseInt(currentPage.value);
    let q = (back < 0)? p - 1 : p + 1;
    if (q < 0 || q >= pages.length) return;
    pages[p].classList.add("hidden");
    pages[q].classList.remove("hidden");
    currentPage.value = "" + q;
  }

  place() {  // current position of center of view in paragraphs
    const {coffset, tops, iNow} = this;
    let i = iNow;
    let top = theText.scrollTop;
    let imax = paragraphs.length - 1;
    while (tops[i] <= top) {
      i += 1;
      if (i > imax) {
        i = imax;
        break;
      }
    }
    while (tops[i] > top) {
      i -= 1;
      if (i < 0) {
        i = 0;
        break;
      }
    }
    this.iNow = i;  // remember as initial guess for next call
    // Center of text box is in paragraph i, estimate fraction.
    const ptop = tops[i];
    const pbot = (i<imax)? tops[i+1] : theText.scrollHeight;
    let frac = (top - ptop)/(pbot - ptop);
    if (frac < 0) frac = 0;
    if (frac >= 1) frac = 0.999;
    this.highlight(i);
    return i + frac;
  }

  onResize(callback) {
    this._resizeTimeout = null;
    const topNow = theText.scrollTop;
    const scrollh = theText.scrollHeight;
    const coffset = theText.clientHeight/2;
    this.coffset = coffset;
    // center = top + coffset    usually, but
    // center = 1.5*top          when top < 2*coffset (= page height)
    // center = top + 0.5*(5*coffset + center - height)
    //        = top + 0.5*(6*coffset + top - height)
    //        = 1.5*top + 3*coffset - 0.5*height
    //          when top > height - 4*coffset  (center > height - 3*coffset)
    // find i with tops[i] <= top < tops[i+1]
    let center = topNow + this.coffset;
    if (center < 3*coffset) {
      center = 1.5*topNow;
    }
    if (center > scrollh - 3*coffset) {
      center = 1.5*topNow - 0.5*scrollh + 3*coffset;
    }
    let iNow = 0;
    let tops = paragraphs.map(pp => 0);
    let splits = paragraphs.map((pp, i) => {
      if (!i) return 0;
      const pp0 = paragraphs[i-1];
      let off = pp0.offsetTop + pp0.clientHeight;
      off = (off + pp.offsetTop)/2;
      let top = off - coffset;    
      if (top < 2*coffset) {
        top = off / 1.5;
      } else if (top > scrollh - 4*coffset) {
        top = (off + 0.5*scrollh - 3*coffset) / 1.5;
      }
      top = Math.ceil(top);
      if (top <= topNow) iNow = i;
      tops[i] = top;
      return off;
    });
    this.tops = tops;
    this.splits = splits;
    this.iNow = iNow;
    this.lineHeight = Number(
      window.getComputedStyle(paragraphs[0]).getPropertyValue("font-size")
        .match(/\d+/)[0]) * 1.2;  // 1.2 * 1em is "normal" line spacing
    this.lineHeight = Math.ceil(this.lineHeight);
    this.pageHeight = theText.clientHeight - this.lineHeight;
    callback(this.place());
  }

  highlight(i) {
    if (this.highlighted !== undefined) {
      paragraphs[this.highlighted].classList.remove("highlighted");
    }
    this.highlighted = i;
    paragraphs[i].classList.add("highlighted");
  }
}

window.addEventListener("keydown", e => {
  let p = parseInt(currentPage.value);
  switch (e.key) {
  case "Home":
    pages[p].classList.add("hidden");
    pages[0].classList.remove("hidden");
    currentPage.value = "0";
    break;
  case "End":
    pages[p].classList.add("hidden");
    p = pages.length - 1;
    pages[p].classList.remove("hidden");
    currentPage.value = "" + p;
    break;
  case "PageUp":
    stepPage(-1);
    break;
  case "PageDown":
    stepPage();
    break;
  default:
    return;
  }
  e.preventDefault();
});

let startPage, endPage;

function stepPage(back) {
  let p = parseInt(currentPage.value);
  let q = (back < 0)? p - 1 : p + 1;
  if (q < 0 || q >= pages.length) return;
  [startPage, endPage] = [p, q];
  currentPage.value = "" + q;
  if (q > p) {
    changeFigure();
  } else {
    changePage();
  }
}

function changePage() {
  let [p, q] = [startPage, endPage];
  console.log("changePage", p, q);
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
}

function bckHandler() {
  let p = startPage;
  pages[p].removeEventListener("transitionend", bckHandler);
  pages[p].classList.add("hidden");
  pages[p].classList.remove("infront", "easein", "midturn");
  /* now turn figure side */
  changeFigure();
}

function changeFigure() {
  let [p, q] = [startPage, endPage];
  // auxctx.drawImage(canvas, 0, 0);  /* copy startPage to auxfigure canvas */
  // let cvs = app.renderer.extract.canvas(app.stage, app.screen);
  // let png = app.renderer.extract.image(app.stage, "image/png");
  let tx = RenderTexture.create(
    {width: app.screen.width, height: app.screen.height,
     resolution: app.renderer.resolution});
  app.renderer.render(app.stage, tx);
  let im = app.renderer.extract.pixels(tx);
  console.log("changeFigure", im, app.screen.width, app.screen.height);
  let data = new ImageData(im.pixels, im.width, im.height);
  auxctx.putImageData(data, 0, 0);
  if (q < p) {  /* text side already turned */
    auxcanvas.classList.remove("hidden");
    canvas.classList.add("infront", "easeout", "midturn");
    window.graphics.scrollTo(1 + q%2);
    /* need getComputedStyle to force transform to update in DOM */
    window.getComputedStyle(canvas).getPropertyValue("transform");
    canvas.addEventListener("transitionend", bckFigHandler);
    console.log("begin bck", p, q);
    canvas.classList.remove("midturn");
  } else {
    auxcanvas.classList.add("infront", "easein");
    auxcanvas.classList.remove("hidden");
    window.getComputedStyle(auxcanvas).getPropertyValue("transform");
    window.graphics.scrollTo(1 + q%2);
    auxcanvas.addEventListener("transitionend", fwdFigHandler);
    console.log("begin fwd", p, q);
    auxcanvas.classList.add("midturn");
  }
}

function fwdFigHandler() {
  auxcanvas.removeEventListener("transitionend", fwdFigHandler);
  console.log("fwdFigHandler", startPage, endPage);
  auxcanvas.classList.add("hidden");
  auxcanvas.classList.remove("infront", "easein", "midturn");
  /* now turn text side */
  changePage();
}

function bckFigHandler() {
  canvas.removeEventListener("transitionend", bckFigHandler);
  console.log("bckFigHandler", startPage, endPage);
  auxcanvas.classList.add("hidden");
  canvas.classList.remove("infront", "easeout");
}

/* ------------------------------------------------------------------------ */
/* Two top level containers hold all the other objects.  One is the
   position space container, and the second is the velocity space container.
   These always have the origin at the center and an x coordinate
   running from -220 to 220.  They rescale whenever the stage size changes
   (e.g.- on window resize).  They can also change dynamically to either
   overlap or move to non-overlapping positions.  (Note that the container
   coordinates must have a scale of several hundred as this affects the
   number of points chosen for the Graphics.ellipse object.)
 */

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
    if (this.observer) {
      [width, height] = [app.screen.width, app.screen.height];
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
    app.renderer.render(app.stage);
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
  pMove(ma) {
    this.checkScale();
    const [x, y, y0, xm, ym, xs, ys] = this.arcSolve(ma);
    const {a, c, vScale, aScale} = this;
    this.planet.position.set(x, y);
    this.radius.modify(x-c, y);
    this.velocity.position.set(x, y);
    const vr = a / Math.sqrt((x-c)**2 + y**2);
    const [vx, vy] = [vScale*vr*y, vScale*(vr*(c-x) - c)];
    this.velocity.modify(vx, vy);
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
    if (newton === undefined) newton = 1 - kepler;
    let {ellipse, sector, radius, velocity, accel, focus, lineOP, label} = this;
    ellipse.visible = sector.visible = (kepler != 0);
    radius.visible = velocity.visible = accel.visible = (newton != 0);
    ellipse.alpha = sector.alpha = (kepler == 0)? 1 : kepler;
    radius.alpha = velocity.alpha = accel.alpha = (newton == 0)? 1 : newton;
    radius.headVisible(true);
    focus[1].visible = lineOP.visible = label[2].visible = false;
    focus[1].alpha = lineOP.alpha = label[2].alpha = 1;
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

  arcSolve(ma) {
    const {a, b, dma} = this;
    const ea = this.eaSolve(ma);
    let [x, y] = [a*Math.cos(ea), a*Math.sin(ea)];
    const eas = this.eaSolve(ma + dma);
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

class GraphicsState {
  constructor(msJump, dgoal=0) {
    this.msJump = msJump;  // delay time for jump transitions
    this.dgoal = dgoal;  // max number of pending transitions
    this.place = null;
    this.triggers = [];
    this.transitions = [];
    this.animators = [];
    this.current = 0;
    this.goal = null;
    this.t = 0;  // t is elapsed time for current transition
    app.ticker.add(this.stepper, this);
    app.ticker.stop();  // need this even though autoStart false?
  }

  scrollTo(place, force=false) {
    if (this.place === null) {
      // called from ScrollPosition constructor, transition lists not built yet
      this.place = place;
      return;
    }
    let {triggers, transitions, animators, current, goal, t} = this;
    let i = current;
    // find i such that triggers[i] <= place < triggers[i+1]
    while (triggers[i] > place) {
      i -= 1;
    }
    if (i == current) {
      const imax = triggers.length - 1;
      while (i < imax && place >= triggers[i + 1]) {
        i += 1;
      }
    }
    // triggers[i] <= place < triggers[i+1]
    if (goal === null) {
      // initializing from call just after transition lists built
      this.goal = this.current = i;
      for (let j = 0; j <= i; j += 1) {
        // On first pass, call all transitions in order, so that any
        // one transition simply needs to alter the drawing to change
        // between its initial and final states.
        transitions[j].finish(false);
      }
      app.renderer.render(app.stage);
      if (animators[i]) app.ticker.start();
      return;
    }
    if (i == goal) return;  // place does not cross a trigger
    // scroll has crossed a trigger boundary
    const animator = (goal == current) && animators[current];
    if (animator && animator.started) {
      animator.cancel();  // immediately cancel any animation
    }
    // ensure no more than dgoal transitions pending
    const dgoal = this.dgoal;
    let transition = transitions[current];
    while (i > current + dgoal) {
      transition.finish(false);
      current += 1;
      transition = transitions[current];
    }
    while (i < current - dgoal) {
      transition.finish(true);
      current -= 1;
      transition = transitions[current];
    }
    if (dgoal == 0) {
      app.renderer.render(app.stage);
      return;
    }
    // set current and goal, then start the ticker
    const down = (i < current);
    if (!down) current += 1;
    transitions[current].start(down);
    this.current = current;
    this.goal = i;
    if (!app.ticker.started) app.ticker.start();
  }

  // stepper is called by ticker, which is started by scrollTo
  // current is transition which is happening now or most recently completed
  //   "completed" means state is at current transition(1)
  // goal is the transition such that transition(1) state corresponds
  //   to the current place (most recent scrollTo)
  stepper(ticker) {
    let {animators, transitions, current, goal, t} = this;
    let animator = (current == goal)? animators[current] : null;
    let dms = ticker.deltaMS;
    if (dms == 0) return;
    if (animator && animator.started) {
      if (!animators[current].step(dms)) {  // animation ended
        ticker.stop();
      }
      return;
    }
    const down = (goal < current);
    const transition = transitions[current];
    if (down) dms = -dms;
    this.t = t + dms;
    if (!transition.step(dms)) {  // transition finished
      if (down) {
        current -= 1;
        this.current = current;
        if (goal < current) {
          transitions[current].start(true);
        } else {  // all transitions done, start animator or stop ticker
          animator = animators[current];
          if (animator) animator.start();
          else ticker.stop();
        }
      } else {
        if (goal > current) {
          current += 1;
          this.current = current;
          transitions[current].start(false);
        } else {  // all transitions done, start animator or stop ticker
          animator = animators[current];
          if (animator) animator.start();
          else ticker.stop();
        }
      }
    }
  }

  append(stepper) {
    if (stepper instanceof Animator) {
      this.animators[this.transitions.length - 1] = stepper;
    } else {
      this.triggers.push(stepper.trigger);
      this.transitions.push(stepper);
    }
  }

  appendJump(trigger, updateScene) {
    const inow = this.transitions.length - 1;
    const revertScene = (inow < 0)? updateScene : this.transitions[inow].update;
    let prev;
    this.append(new Transition(trigger, this.msJump, (frac) => {
      frac -= 0.5;
      if (frac * prev <= 0) {
        if (frac < 0) revertScene(1);
        else updateScene(1);
      }
      prev = frac;
    }));
  }
}

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

const graphics = new GraphicsState(500);
positionSpace.graphics = graphics;
window.graphics = graphics;

// const scrollPos = new ScrollPosition((place) => {
//   if (place < 0.5) HELP_PANEL.classList.remove("hidden");
//   else HELP_PANEL.classList.add("hidden");
//   graphics.scrollTo(place);
// });
// window.scrollPos = scrollPos;

/* ------------------------------------------------------------------------ */

graphics.appendJump(0, (frac) => {
  ellipse.setAlphas(1, 0);
  ellipse.pMove(0);
});
// 0 state: plain ellipse + sector, P at theta=0

graphics.append(new Transition(
  1, [250, 500, 250], (frac) => {
    ellipse.setAlphas(1, 0);
    ellipse.pMove(0.3*frac);
  }));
const demoOrbits = new Animator([500, 7000, 500], (frac) => {
  ellipse.pMove(0.3 + 2*twoPi*frac);
}, 1000);
graphics.append(demoOrbits);
// 1 state: plain ellipse + sector, P at theta=0.3

graphics.append(new Transition(
  2, [250, 1500, 250], (frac) => {
    ellipse.setAlphas(1-frac**2, frac**2);
    ellipse.pMove(0.3);
  }));
graphics.append(demoOrbits);
// 2 state: plain r+v+g vectors, P at theta=0.3

graphics.append(new Transition(
  3, [500, 3500, 500], (frac) => {
    ellipse.setAlphas(0, 1);
    ellipse.ellipse.visible = ellipse.sector.visible = true;
    ellipse.ellipse.alpha = ellipse.sector.alpha = frac**2;
    ellipse.pMove(0.3 + twoPi*frac);
  }));
graphics.append(demoOrbits);
// 3 state: r+v+g vectors + ellipse + sector, P at theta=0.3

graphics.append(new Transition(
  5, [250, 1500, 250], (frac) => {
    ellipse.setAlphas(0, 1);
    const alpha = (1 - 2*frac)**2;
    const {radius, velocity, accel, sector, focus, lineOP, label} = ellipse;
    if (frac < 0.5) {
      if (frac) ellipse.pMove(0.3);
      ellipse.ellipse.visible = sector.visible = true;
      sector.alpha = radius.head.alpha = alpha;
      velocity.alpha = accel.alpha = alpha;
    } else {
      ellipse.ellipse.visible = true;
      if (radius.head.visible) radius.headVisible(false);
      velocity.visible = accel.visible = false;
      focus[1].visible = lineOP.visible = label[2].visible = true;
      focus[1].alpha = lineOP.alpha = label[2].alpha = (1 - 2*frac)**2;
    }
  }));
graphics.append(new Animator([250, 3500, 250], (frac) => {
  ellipse.pMove(0.3 + twoPi*frac);
}, 1000));
// 4 state: simple SPF diagram, P at theta=0.3

graphics.scrollTo(graphics.place);

window.app = app;
window.theText = theText;

window.graphics = graphics;
window.ellipse = ellipse;

let stepDir = 1;
function tester() {
  let p = parseInt(currentPage.value);
  let q = p + stepDir;
  if (stepDir < 0) {
    if (q < 0) stepDir = -stepDir;
  } else {
    if (q > 2) stepDir = -stepDir
  }
  stepPage(stepDir);
}
window.tester = tester;

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
