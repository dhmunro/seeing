import {loadTextureFiles, PerspectiveScene, TextureCanvas, setColorMultiplier,
        Vector3, Matrix4} from './wrap3.js';
import {Animator} from './animator.js';

/* ------------------------------------------------------------------------ */

const theText = document.querySelector(".textcolumn");
const paragraphs = Array.from(theText.querySelectorAll("p"));

class ScrollPosition {
  constructor(callback) {
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
    addEventListener("keydown", e => {
      switch (event.key) {
      case "Home":
        theText.scroll(0, 0);
        break;
      case "End":
        theText.scroll(0, theText.scrollHeight);
        break;
      case "PageUp":
        theText.scrollBy(0, -this.pageHeight);
        break;
      case "PageDown":
        theText.scrollBy(0, this.pageHeight);
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

  place() {  // current position of center of view in paragraphs
    const {coffset, splits, iNow} = this;
    let i = iNow;
    let center = theText.scrollTop + coffset;
    if (center < 3*coffset) {
      center = theText.scrollTop + 0.5 * (center - coffset);
    }
    if (theText.scrollHeight - center < 3*coffset) {
      center = theText.scrollTop +
        0.5 * (5*coffset + center - theText.scrollHeight);
    }
    // find i with splits[i] <= center < splits[i+1]
    let imax = paragraphs.length - 1;
    while (splits[i] <= center) {
      i += 1;
      if (i > imax) {
        i = imax;
        break;
      }
    }
    while (splits[i] > center) {
      i -= 1;
      if (i < 0) {
        i = 0;
        break;
      }
    }
    this.iNow = i;  // remember as initial guess for next call
    // Center of text box is in paragraph i, estimate fraction.
    const ptop = splits[i];
    const pbot = (i<imax)? splits[i+1] : theText.scrollHeight;
    let frac = (center - ptop)/(pbot - ptop);
    if (frac < 0) frac = 0;
    if (frac >= 1) frac = 0.999;
    this.highlight(i); 
    return i + frac;
  }

  onResize(callback) {
    this._resizeTimeout = null;
    const topNow = theText.scrollTop;
    this.coffset = theText.clientHeight/2;
    let center = topNow + this.coffset;
    let iNow = 0;
    let splits = paragraphs.map((pp, i) => {
      if (!i) return 0;
      const pp0 = paragraphs[i-1];
      let off = pp0.offsetTop + pp0.clientHeight;
      off = (off + pp.offsetTop)/2;
      if (off <= center) iNow = i;
      return off;
    });
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

const scrollPos = new ScrollPosition((place) => {});

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
let xsph1 = 0;

const sph2 = makeSphere(1, 60, 30, 0x99bbff, 0.4);
// sph2.visible = false;

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

const ellipse = makeEllipse(1.3, 1, 120, 0xffffff, 0.4);
orientEllipse(ellipse, true);
sph1.position.set(-1.3, 0, 0);
sph2.position.set(1.3, 0, 0);

scene3d.camera.position.set(-4, 1, 10);
scene3d.camera.up.set(0, 1, 0);
scene3d.camera.lookAt(0, 0, 0);

function animate() {
  xsph1 += 0.01;
  if (xsph1 > 2) {
    xsph1 = -5;
    sph1.position.set(xsph1, 0, 0);
    hideWaist(sph1, true);
    showFoci(ellipse, 1);
  } else if (xsph1 <= -ellipse.userData.a) {
    sph1.position.set(xsph1, 0, 0);
    hideWaist(sph1, xsph1 < -2);
  } else {
    showFoci(ellipse, 3);
  }
  requestAnimationFrame(animate);
  controls.update();
  scene3d.render();
}
animate();

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
