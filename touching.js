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
    theText.addEventListener("wheel", e => {
      e.preventDefault();
      // Apparently, deltaY is always +-120, which is supposed to be 3 lines.
      // Original idea was 1/8 degree, and most wheels step by 15 degrees.
      let sign = Math.sign(e.deltaY);
      theText.scrollBy(0, Math.sign(e.deltaY)*this.lineHeight);
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
const sph2 = makeSphere(1, 60, 30, 0x99bbff, 0.4);

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
  constructor(ellipse, n, colp, colr, cola, darea, parent, zoff=0.003) {
    const [a, b, c, eps] = this.reshape(ellipse);
    this.n = n;
    this.darea = darea;
    this.zoff = zoff;
    const grp = scene3d.group(parent);
    this.grp = grp;
    let points = new Array(n+1).fill([0, 0, zoff]);
    let indices = new Array(n-1).fill(0).map((v, i) => [0, i+1, i+2]);
    this.shade = scene3d.mesh(points, indices, cola, grp);
    const sty = scene3d.createLineStyle({color: colr, linewidth: 2});
    this.line = scene3d.polyline([[0, 0, zoff], [0, 0, zoff]], sty, grp);
    this.dotp = circleSprite(3, colp, scene3d, grp);
    this.dots = circleSprite(3, colp, scene3d, grp);
    this.dots.position.set(c, 0, 2*zoff);
    this.update(0);
  }

  show(yes=true) {
    this.grp.visible = yes;
  }

  update(ma) {
    const zoff = this.zoff, c = this.c;
    let ea0 = this.eaSolve(ma - this.darea);
    let ea1 = this.eaSolve(ma);
    let {a, b, n} = this;
    let dea = (ea1 - ea0) / (n - 1);
    let points = new Array(n+1).fill([0, 0, zoff]);
    points = points.map(([x, y, z], i) => {
      if (i < 1) return [c, 0, z];
      let ea = ea0 + (i-1)*dea;
      return [a*Math.cos(ea), b*Math.sin(ea), z];
    });
    scene3d.meshMovePoints(this.shade, points);
    points = points.map(([x, y, z]) => [x, y, 2*z]);
    scene3d.movePoints(this.line, [[c, 0, zoff], points[n]]);
    this.dotp.position.set(...points[n]);
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
const sector = new Sector(ellipse, 20, "#000000", 0x000000, 0xbbbbbb, 0.25);
sph1.position.set(-ellipse_a, 0, 0);
sph2.position.set(ellipse_a, 0, 0);

// scene3d.camera.position.set(-4, 1, 10);
scene3d.camera.position.set(0, 0, 8);
scene3d.camera.up.set(0, 1, 0);
scene3d.camera.lookAt(0, 0, 0);

cyl.visible = false;
sph1.visible = false;
sph2.visible = false;

showFoci(ellipse, 1);
orientEllipse(ellipse, false);
scene3d.render();

let xsph1 = 0, maNow = 0;
function animate() {
//   xsph1 += 0.01;
//   if (xsph1 > 2) {
//     xsph1 = -5;
//     sph1.position.set(xsph1, 0, 0);
//     hideWaist(sph1, true);
//     showFoci(ellipse, 1);
//   } else if (xsph1 <= -ellipse.userData.a) {
//     sph1.position.set(xsph1, 0, 0);
//     hideWaist(sph1, xsph1 < -2);
//   } else {
//     showFoci(ellipse, 3);
//   }
  maNow += 0.01;
  sector.update(maNow);
  requestAnimationFrame(animate);
  controls.update();
  scene3d.render();
}
animate();

/* ------------------------------------------------------------------------ */

const scrollPos = new ScrollPosition((place) => {
});

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
