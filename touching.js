import {loadTextureFiles, PerspectiveScene, TextureCanvas, setColorMultiplier,
        Vector3, Matrix4} from './wrap3.js';
import {Animation} from './animation.js';

/* ------------------------------------------------------------------------ */

const theText = document.querySelector(".textcolumn");
const paragraphs = Array.from(theText.querySelectorAll("p"));
const HELP_PANEL = document.getElementById("help-panel");

class ScrollPosition {
  constructor(callback, onend) {
    // callback should set canvas to correct picture
    // - it must never cause theText to scroll
    this.highlight(0);
    this.onResize(callback);
    window.addEventListener("resize", () => {
      if (this._resizeTimeout !== null) {
        clearTimeout(scrollPos._resizeTimeout);
      }
      this._resizeTimeout = setTimeout(
        () => this.onResize(callback), 50);
    });
    theText.addEventListener("scroll", () => {
      callback(scrollPos.place());
    }, {passive: true});
    if (onend) {
      theText.addEventListener("scrollend", () => {
        onend();
      });
    }
    theText.addEventListener("wheel", e => {
      e.preventDefault();
      // Apparently, deltaY is always +-120, which is supposed to be 3 lines.
      // Original idea was 1/8 degree, and most wheels step by 15 degrees.
      let sign = Math.sign(e.deltaY);
      theText.scrollBy(0, Math.sign(e.deltaY)*2*this.lineHeight);
    });
    addEventListener("keydown", e => {
      switch (event.key) {
      case "Home":
        theText.scroll(0, 0);
        break;
      case "End":
        theText.scroll(0, theText.scrollHeight);
        break;
      case "PageUp":
        // theText.scrollBy(0, -this.pageHeight);
        this.stepParagraph(-1);
        break;
      case "PageDown":
        // theText.scrollBy(0, this.pageHeight);
        this.stepParagraph();
        break;
      case "ArrowUp":
      case "Up":
        theText.scrollBy(0, -this.lineHeight);
        break;
      case "ArrowDown":
      case "Down":
        theText.scrollBy(0, this.lineHeight);
        break;
      default:
        return;
      }
      e.preventDefault();
    });
  }

  stepParagraph(back) {
    let i = this.iNow;
    if (back) {
      if (i > 0) i -= 1;
    } else {
      if (i < paragraphs.length - 1) i += 1;
    }
    theText.scroll(0, this.tops[i] + 0.001);
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

/* ------------------------------------------------------------------------ */

const scene3d = new PerspectiveScene("figure", -30, 0, 0.01, 12000);

scene3d.onContextLost(() => {
  // if (skyAnimator.isPaused) return;
  // skyAnimater.pause();
  // return () => { skyAnimator.play(); }  // resume when context restored
});

window.scene3d = scene3d;

const controls = scene3d.orbitControls();
controls.enabled = true;

scene3d.setEnvironment();

const topObjects = [];
function topObjectsInvisible() {
  topObjects.forEach(obj => {
    obj.visible = false;
  });
}

const renderHooks = [];
function renderScene() {
  renderHooks.forEach(f => f());
  scene3d.render();
}

function makeCylinder(radius, length, nph, nlen, color, opacity) {
  const grp = scene3d.group();
  const matf = scene3d.createPhysical({side: 0, color: color,
                                       clearcoat: 0.5, clearcoatRoughness: 0.3,
                                       transparent: true, opacity: opacity});
  const matb = scene3d.createPhysical({side: 1, color: color,
                                       clearcoat: 0.5, clearcoatRoughness: 0.3,
                                       transparent: true, opacity: opacity});
  const cylb = scene3d.cylinder([radius, radius, length, nph, nlen, true],
                                matb, grp);
  cylb.renderOrder = -2;  // draw inner surface first
  const cylf = scene3d.cylinder([radius, radius, length, nph, nlen, true],
                                matf, grp);
  cylf.renderOrder = 2;  // draw outside surface last
  grp.rotateZ(Math.PI/2);
  return grp;
}
const cyl = makeCylinder(1, 4, 60, 5, 0xaaaaff, 0.4);
topObjects.push(cyl);

function makeSphere(radius, nph, nth, color, opacity) {
  const grp = scene3d.group();
  // Note: back side is not drawn, so opacity is only single pass.
  let mats = scene3d.createPhysical({side: 0, color: color,
                                     clearcoat: 0.5, clearcoatRoughness: 0.3,
                                     transparent: true, opacity: opacity});
  let sph = scene3d.sphere([radius, nph, nth], mats, grp);
  sph.material.depthWrite = false;  // otherwise clips focus dots
  sph.rotateZ(Math.PI/2);  // align with cylinder orientation
  sph.renderOrder = 0;  // render between inside and outside of cylinder
  const styk = scene3d.createLineStyle({color: 0x000000, linewidth: 2});
  const angle = new Array(nph+1).fill(2*Math.PI/nph).map((v, i) => i*v);
  const points = angle.map(v =>
    [0, 1.001*radius*Math.sin(v), -1.001*radius*Math.cos(v)]);
  const waist = scene3d.polyline(points, styk, grp);
  return grp;
}

function hideWaist(grp, hide) {
  grp.children[1].visible = !hide;
}

const sph1 = makeSphere(1, 60, 30, 0x99bbff, 0.4);
const sph2 = makeSphere(1, 60, 30, 0x99bbff, 0.4);
topObjects.push(sph1, sph2);

function circleSprite(radius, color, scene, parent) {
  const txcanvas = new TextureCanvas();
  const ctx = txcanvas.context;
  txcanvas.width = 2*radius;
  txcanvas.height = 2*radius;
  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, 2*Math.PI, false);
  const gradient = ctx.createRadialGradient(radius, radius, 0.75*radius,
                                            radius, radius, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.7, standardColor(color, 0.75));
  gradient.addColorStop(1, standardColor(color, 0.25));
  ctx.fillStyle = gradient;
  ctx.fill();
  return txcanvas.addTo(scene, 0.5, 0.5, parent);
}

// https://stackoverflow.com/a/47355187
function standardColor(str, mult) {
  _color_context.fillStyle = str;
  let color = _color_context.fillStyle;  // "#rrggbb" or "rgba(r, g, b, a/255)"
  if (mult !== undefined && color.length == 7) {  // assume #rrggbb
    color = parseInt(color.slice(1), 16);
    let [r, g, b] = [color >> 16, color >> 8, color].map(v => v & 0xff)
        .map(v => v*mult).map(v => (v < 0)? 0 : v)
        .map(v => (v > 255)? 255 : parseInt(v));
    color = "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }
  return color;
}

const _color_context = document.createElement('canvas').getContext('2d');

/* Arrow is a group comprising a fat line and a sprite head.
 * (An optional second sprite can be at the tail?)
 * Arrow canvas is 58x58 pixels
 *   tip (58, 29), sides (9, 8) and (9, 50), center (29, 29), radius 29
 *   head length 49
 * This texture canvas needs to be big enough to rotate the arrow around
 * its center to any orientation for material.map.rotation to work.
 * Would like to shorten the line so that the tip of the arrow is half
 * of the line thickness ahead of the point, but thickness and head length
 * are specified in pixels, and the relationship between pixels and world
 * coordinates changes with the camera.  This also has to be taken into
 * account to set the head orientation, which means the line endpoint
 * should be adjusted at that time as well.
 */
function makeArrow(points, color, thick, head, parent) {
  const grp = scene3d.group(parent);
  const data = grp.userData;
  const sty = scene3d.createLineStyle({color: color, linewidth: thick});
  data.points = points.map(p => new Vector3(...p));
  const line = scene3d.polyline(points, sty, grp);
  const txcanvas = new TextureCanvas(head / 49);  // head length is in pixels
  const ctx = txcanvas.context;
  txcanvas.width = txcanvas.height = 58;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(58, 29);
  ctx.lineTo(9, 50);
  ctx.lineTo(9, 8);
  ctx.fill();
  const sprite = txcanvas.addTo(scene3d, 0.5, 0.5, grp);
  sprite.position.set(...points[points.length-1]);
  sprite.material.map.center.set(0.5, 0.5);
  sprite.renderOrder = 1;  // and drawn after 
  // When arrowhead visible, final endpoint of line and center of head
  // will be adjusted backwards so that tip of arrow (rather than center)
  // is just half of linewidth beyond true endpoint.
  data.ds = head - thick/2;  // adjustment in pixels (why not head/2???)
  _arrows.push(grp);
  return grp;
}
function moveArrow(arrow, points) {
  arrow.userData.points = points.map(p => new Vector3(...p));
  const [line, head] = arrow.children;
  scene3d.movePoints(line, points);
  head.position.set(...points[points.length-1]);
}
function hideArrowhead(arrow, yes=true) {
  const [line, head] = arrow.children;
  if (head.visible == !yes) return;
  if (yes) {
    const points = arrow.userData.points.map(({x, y, z}) => [x, y, z]);
    scene3d.movePoints(line, points);
    head.position.set(...points[points.length-1]);
  }
  head.visible = !yes;
}
const _arrows = [];
renderHooks.push(() => {
  _arrows.forEach(arrow => {
    if (!arrow.visible) return;
    const data = arrow.userData;
    const [line, head] = arrow.children;
    if (!head.visible) return;
    // First adjust orientation of arrowhead to match line as displayed.
    const camera = scene3d.camera;
    camera.updateMatrixWorld();  // otherwise project(camera) wrong
    const [pt0, pt1] = data.points.slice(-2);
    _endpt0.copy(pt0).project(camera);
    _endpt1.copy(pt1).project(camera);
    _endpt1.sub(_endpt0);
    let {x, y, z} = _endpt1;
    const canvas = scene3d.canvas;
    [x, y] = [x*canvas.width, y*canvas.height];  // pixel coordinates
    // ECMA standard guarantees atan2(0, 0) == 0.
    head.material.map.rotation = Math.atan2(y, x);
    // Next adjust position of endpoint1 of line and position of head
    // so that tip of arrow is just one half of line thickness beyond true
    // endpoint.  The line endpoint becomes the center of the head.
    const points = data.points.map(({x, y, z}) => [x, y, z]);
    let frac = 1 - data.ds/Math.sqrt(x**2 + y**2);
    _endpt0.copy(pt0);
    _endpt1.copy(pt1).sub(_endpt0).multiplyScalar(frac).add(_endpt0);
    ({x, y, z} = _endpt1);
    points[points.length-1] = [x, y, z];
    scene3d.movePoints(line, points);
    head.position.set(...points[points.length-1]);
    // For very short arrows, the line is not visible at all.
    if (points.length == 2) line.visible = frac > 0;
  });
});
const _endpt0 = new Vector3();
const _endpt1 = new Vector3();

function makeEllipse(a, b, nph, color, opacity) {
  const grp = scene3d.group();
  const angle = new Array(nph+1).fill(2*Math.PI/nph).map((v, i) => i*v);
  let points = angle.map(v => [a*Math.cos(v), b*Math.sin(v), 0]);
  const indices = new Array(nph).fill(0).map((v, i) =>
    [nph, i,  (i<nph-1)? i+1 : 0]);
  points[nph] = [0, 0, 0];
  const surf = scene3d.mesh(points, indices, [color, opacity], grp);
  surf.material.depthWrite = false;  // avoid clipping focus dots
  surf.renderOrder = 1;
  points[nph] = points[0];
  points = points.map(([x, y, z]) => [1.001*x, 1.001*y, 1.001*z]);
  const styk = scene3d.createLineStyle({color: 0x000000, linewidth: 2});
  const waist = scene3d.polyline(points, styk, grp);
  const data = grp.userData;
  data.a = a;
  data.b = b;
  data.c = Math.sqrt(a**2 - b**2);
  let foc1 = circleSprite(3, "#000000", scene3d, grp);
  foc1.position.set(data.c, 0, 0);
  let foc2 = circleSprite(3, "#000000", scene3d, grp);
  foc2.position.set(-data.c, 0, 0);
  data.eps = data.c / data.a;
  data.ang = Math.atan2(data.b, data.c);
  data.matrix0 = new Matrix4().copy(grp.matrix);
  grp.rotateY(-data.ang);
  grp.updateMatrix();
  data.matrix1 = new Matrix4().copy(grp.matrix);
  grp.setRotationFromMatrix(data.matrix0);
  return grp;
}

function showFoci(ellipse, mask) {
  const children = ellipse.children;
  const foc1 = children[2];
  const foc2 = children[3];
  foc1.visible = (mask & 1) != 0;
  foc2.visible = (mask & 2) != 0;
}

function orientEllipse(ellipse, toCylinder) {
  const data = ellipse.userData;
  ellipse.setRotationFromMatrix(toCylinder? data.matrix1 : data.matrix0);
}

class Sector {
  // Sector consists of a point, a radial line, and a trailing shaded area.
  // Angle of radial line relative to perihelion given by area, not angle,
  // and darea similarly specifies the extent of the trailing shaded area
  // behind the radial line.
  // Actually, all areas are specified as fractions of the total ellipse
  // area, scaled to run from 0 to 2pi like an angle in radians.
  //   area parameter = ma = ea - e*sin(ea)
  //   1st approx:  ea_1 = ma + e*sin(ma)/(1-e*cos(ma))
  //   n+1sr approx:  ea_(n+1) =
  //                      ea_n + (ma - (ea_n - e*sin(ea_n)))/(1-e*cos(ea_n))
  //   point on ellipse is (a*cos(ea), b*sin(ea))
  constructor(ellipse, n, colp, colr, cola, darea, parent, colv, zoff=0.003) {
    const [a, b, c, eps] = this.reshape(ellipse);
    this.n = n;
    this.darea = darea;
    this.zoff = zoff;
    const grp = scene3d.group(parent);
    topObjects.push(grp);
    this.grp = grp;
    let points = new Array(n+1).fill([0, 0, zoff]);
    let indices = new Array(n-1).fill(0).map((v, i) => [0, i+1, i+2]);
    this.shade = scene3d.mesh(points, indices, cola, grp);
    this.line = makeArrow([[0, 0, 2*zoff], [0, 0, 2*zoff]], colr, 2, 16, grp);
    hideArrowhead(this.line);
    if (colv) {
      this.vel = makeArrow([[0, 0, 2*zoff], [0, 0, 2*zoff]], colv, 2, 16, grp);
      this.vel.visible = false;
      // make maximum velocity amplitude b
      // cv = eps*rv, vmax = (1+eps)*rv
      this.av = b / (1 + eps);
    }
    this.dotp = circleSprite(3, colp, scene3d, grp);
    this.dotp.renderOrder = 1;
    this.dots = circleSprite(3, colp, scene3d, grp);
    this.dotp.renderOrder = 1;
    this.dots.position.set(c, 0, 2*zoff);
    this.update(0);
  }

  show(yes=true) {
    this.grp.visible = yes;
  }

  newton(yes=true) {
    if (yes) {
      this.shade.visible = false;
      hideArrowhead(this.line, false);
      this.vel.visible = true;
    } else {
      this.shade.visible = true;
      hideArrowhead(this.line, true);
      this.vel.visible = false;
    }
  }

  update(ma) {
    const {c, n, darea, zoff} = this;
    let ea0 = this.eaSolve(ma - darea);
    let ea1 = this.eaSolve(ma);
    let {a, b} = this;
    let dea = (ea1 - ea0) / (n - 1);
    let points = new Array(n+1).fill([0, 0, zoff]);
    const pt0 = [c, 0, zoff];
    points = points.map((p, i) => {
      if (i < 1) return pt0;
      return this.position(ea0 + (i-1)*dea);
    });
    scene3d.meshMovePoints(this.shade, points);
    points = points.map(([x, y, z]) => [x, y, 2*z]);
    const pt1 = points[n];
    moveArrow(this.line, [pt0, pt1]);
    this.dotp.position.set(...pt1);
    if (this.vel && this.vel.visible) {
      let [vx, vy, vz] = this.velocity(ea1);
      moveArrow(this.vel, [[0, 0, vz], [vx, vy, vz]]);
      this.vel.position.set(...pt1);
    }
  }

  position(ea, dbl=1) {
    let {a, b, zoff} = this;
    return [a*Math.cos(ea), b*Math.sin(ea), dbl*zoff];
  }

  velocity(ea, dbl=1) {
    let {a, b, c, av, zoff} = this;
    let [vx, vy] = [-b*Math.sin(ea), a*Math.cos(ea) - c];
    const cv = c * av / a;
    av /= Math.sqrt(vx**2 + vy**2);
    return [av*vx, av*vy + cv, dbl*zoff];
  }

  eaSolve(ma, tol=1.e-6) {
    const eps = this.eps, sin = Math.sin, cos = Math.cos, abs = Math.abs;
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

  reshape(ellipse, b, c) {
    let a = ellipse, eps;
    if (b !== undefined) {
      if (c === undefined) c = Math.sqrt(a**2 - b**2);
      eps = c / a;
    } else {
      ({a, b, c, eps} = ellipse.userData);  // javascript syntax needs ()
    }
    [this.a, this.b, this.c, this.eps] = [a, b, c, eps];
    return [a, b, c, eps];
  }
}

const ellipse_a = 1.3;
const ellipse = makeEllipse(ellipse_a, 1, 120, 0xffffff, 0.4);
topObjects.push(ellipse);
const sector = new Sector(ellipse, 20, "#000000", 0x000000, 0xbbbbbb, 0.25,
                          undefined, "#0000ff");
sector.show(false);
sph1.position.set(-ellipse_a, 0, 0);
sph2.position.set(ellipse_a, 0, 0);

// scene3d.camera.position.set(-4, 1, 10);
scene3d.camera.position.set(0, 0, 8);
scene3d.camera.up.set(0, 1, 0);
scene3d.camera.lookAt(0, 0, 0);

topObjectsInvisible();

ellipse.visible = true;
showFoci(ellipse, 1);
orientEllipse(ellipse, false);

class ParameterAnimator extends Animation {
  constructor() {
    super((dms) => {
      if (this._worker) return this._worker(dms);
      else return true;
    });
  }

  // You can supress this behavior by having onFinish return true.
  initialize(p0, p1, msDelta, onStep, onFinish, onStart, context) {
    if (onStep === undefined) {
      delete this._worker;
      return this;
    }
    let msEase = 0, msTotal;
    if (msDelta.length) [msDelta, msEase] = msDelta;
    let ms = 0, drate = 0;
    msTotal = msDelta + msEase;
    const rate = (p1 - p0) / msTotal;
    if (msEase > 0) {
      msDelta += msEase;
      drate = 0.5 * rate / msEase;
      msTotal += msEase;
    }
    let p = p0;
    this._worker = (dms) => {
      if (dms == 0 && onStart) onStart.call(context);
      let stop = ms + dms >= msTotal;
      if (!drate) {
        p += rate * dms;
        ms += dms;
      } else {
        let t = ms + dms;
        if (dms > 0 && ms < msEase) {
          dms = t - msEase;
          if (dms > 0) t = msEase;
          p = p0 + drate*t**2;
          ms = t;
        }
        if (dms > 0 && ms < msDelta) {
          dms = t - msDelta;
          if (dms > 0) t = msDelta;
          p = p0 + drate*msEase**2 + rate*(t - msEase);
          ms = t;
        }
        if (dms > 0 && ms < msTotal) {
          dms = t - msTotal;
          if (dms > 0) t = msTotal;
          p = p0 + 2*drate*msEase**2 + rate*(msDelta - msEase);
          p -= drate*(msTotal - t)**2
          ms = t;
        }
      }
      if (stop) p = p1;
      onStep.call(context, p);
      if (stop && onFinish) onFinish.call(context);
      return stop;
    }
    return this;
  }
}

// Only one parameter animator so it can be reset.
const parameterAnimator = new ParameterAnimator();

/* ------------------------------------------------------------------------ */

function setup0() {
  parameterAnimator.stop();
  parameterAnimator.initialize();
  topObjectsInvisible();
  ellipse.visible = true;
  sector.show();
  sector.newton(false);
  showFoci(ellipse, 1);
  orientEllipse(ellipse, false);
  maNow = maNow % (2*Math.PI);
  if (maNow < 0) maNow += 2*Math.PI;
  sector.update(maNow);
  renderScene();
  let ma0 = 0;
  parameterAnimator.initialize(0, 36000, 36000000, dma => {
    maNow = ma0 + dma;
    sector.update(maNow);
    controls.update();
    renderScene();
  }, () => {
    maNow = 0;
  }, () => {
    ma0 = maNow;
  });
}

let maNow = 0;
let autoplay = false;
let prevPlace = 1000;
const scrollPos = new ScrollPosition((place) => {
  const prev = prevPlace;
  prevPlace = place;
  autoplay = false;
  parameterAnimator.pause();
  if (place < 1) {
    HELP_PANEL.classList.remove("hidden");
    setup0();
    return;
  }
  HELP_PANEL.classList.add("hidden");
  if (place < 2) {
    if (prev >= 3) setup0();
    sector.newton(false);
    sector.update(maNow);
    renderScene();
    // autoplay = true;
    if (place > 1.1 && place < 1.9) parameterAnimator.play();
  } else if (place < 3) {
    if (prev >= 3) setup0();
    sector.newton(true);
    sector.update(maNow);
    renderScene();
    // autoplay = true;
    if (place > 2.1 && place < 2.9) parameterAnimator.play();
  }
}, () => {
  if (autoplay && parameterAnimator._worker) parameterAnimator.play();
});

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
