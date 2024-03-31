import {dayOfDate, dateOfDay, positionOf, orbitParams, timePlanetAt,
        eclipticOfDate, precession, obliquity, meanSunOn, meanSunNextAt,
        periodOf, OppositionDetector} from './ephemeris.js';
import {loadTextureFiles, PerspectiveScene, TextureCanvas, setColorMultiplier,
        Vector3, Matrix4} from './wrap3.js';
import {Animation} from './animation.js';
import {SkyControls} from './skycontrols.js';

/* ------------------------------------------------------------------------ */

// J2000 obliquity of ecliptic 23.43928 degrees

/*
 *  mercury      venus      earth       mars     jupiter    saturn
 * 0.2408467  0.61519726  1.0000174  1.8808476  11.862615  29.447498  yr
 * relative to Sun, t in Julian centuries (36525 days):
 * 102.93768193 + 0.32327364*t  lon of Earth's perihelion
 * 100.46457166 + 35999.37244981*t  lon of Earth
 * -23.94362959 + 0.44441088*t  lon of Mars's perihelion
 *  -4.55343205 + 19140.30268499*t  lon of Mars
 *
 *       venus      earth       mars
 * a  0.72333566  1.00000261  1.52371034
 * e  0.00677672  0.01671123  0.09339410
 *
 * Max elongation when inner planet at aphelion, outer planet at perihelion:
 *   sin(elong) = apin / perout = (1+ei)/(1-eo) * ai/ao
 *      max elong = 47.784 for venus from earth
 *                = 47.392 for earth from mars
 */

const HFOV = 100;  // horizontal field of view
// HFOV = 10 is about 1 arc minute resolution
const MAX_ASPECT = 20 / 9;  // Galaxy S21 screen most extreme common case
const MIN_ASPECT = 4 / 3;  // tall laptop screen is 16/10

const STARDATE = document.getElementById("stardate");

const scene3d = new PerspectiveScene("skymap", -HFOV, 0, 0.01, 12000);

/* ------------------------------------------------------------------------ */

// ecl = ecliptic coordinate  system, with origin at earth
// gl = GL world coordinate system
// xecl -> zgl,   yecl -> xgl,   zecl -> ygl
const ecl2gl = ([x, y, z]) => [y, z, x];
const glPlanetPosition = (p, jd) => ecl2gl(positionOf(p, jd));

// Holder for sun and planet positions (relative to Sun) at given time
// jd = Julian days since J2000 = Julian day number - 2451545.0.
class PlanetPositions {
  constructor(jd, planets) {
    if (planets === undefined) planets = ["mercury", "venus", "earth",
                                          "mars", "jupiter", "saturn"];
    this._xyz = Object.fromEntries(
      planets.map(p => [p, glPlanetPosition(p, jd)]));
    this._xyz.sun = [0, 0, 0];
    this.jd0 = jd;
    this.jd = jd;
  }

  onUpdate(callback) {
    this.callback = callback;
  }

  update(jd, jd0, noCallback) {
    if (jd0 !== undefined) this.jd0 = jd0;  // change initial time
    if (jd === undefined) jd = this.jd0;  // reset to initial time
    const xyz = this._xyz;
    for (const p in xyz) {
      if (p == "sun") continue;
      xyz[p] = glPlanetPosition(p, jd);
    }
    this.jd = jd;
    if (this.callback && !noCallback) this.callback(this, jd0);
    return this;
  }

  xyz(p, origin) {
    const xyz = this._xyz[p];
    if (origin === undefined || origin == "sun") return xyz;
    const xyz0 = this._xyz[origin];
    return xyz.map((v, i) => v - xyz0[i]);
  }

  ellipse(p, jd) {
    if (jd === undefined) jd = this.jd0;
    // [xAxis, yAxis, zAxis, e, a, b, ea, ma, madot] = orbitParams(p, day)
    let xAxis, yAxis, zAxis, e, a, b;
    if (!Array.isArray(p)) {
      const isSun = p == "sun";
      if (isSun) p = "earth";
      // Return orbit parameters ten years after given time.
      const day = jd + 3652.5;
      [xAxis, yAxis, zAxis, e, a, b] = orbitParams(p, day);
      if (isSun) [a, b] = [-a, -b];
    } else {
      [xAxis, yAxis, zAxis, e, a, b] = p;
      xAxis = gl2ecliptic(xAxis);
      yAxis = gl2ecliptic(yAxis);
      zAxis = gl2ecliptic(zAxis);
    }
    // Construct matrix which takes points on unit circle into
    // this planet's ellipse.
    const matrix = new Matrix4();
    xAxis = xAxis.map(v => a*v);
    yAxis = yAxis.map(v => b*v);
    matrix.set(yAxis[1], zAxis[1], xAxis[1], -e*xAxis[1],
               yAxis[2], zAxis[2], xAxis[2], -e*xAxis[2],
               yAxis[0], zAxis[0], xAxis[0], -e*xAxis[0],
               0, 0, 0, 1);
    return matrix;
  }
}

function gl2ecliptic([x, y, z]) {
  return [z, x, y];
}

function ecliptic2gl([x, y, z]) {
  return [y, z, x];
}

class SceneUpdater {
  constructor(scene3d, xyz) {
    this.scene3d = scene3d;
    this.planets = {};
    this.labels = {};
    this.orbits = {};
    this.rings = {};
    this.mode = "sky";
    this.freeCamera = false;
    this.altCamera = null;

    xyz.onUpdate(xyzPlanets => this.update(xyzPlanets));
    this.updateDate(xyz.jd);

    // label visibility for different tracking modes
    this.modeLabels = {
      sky: ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "antisun"],
      sun: ["sun", "meansun"],
      venus: ["sun", "venus", "earth"],
      mars: ["sun", "mars",  "antisun", "sunmars", "earth"]
    };

    const style = c => scene3d.createLineStyle(
      {color: c, linewidth: 2, dashed: false, dashSize: 0.03, gapSize: 0.05});

    // The orbit objects are all unit circles.  Their local transform
    // matrix is set by the updateOrbits method, which squashes and
    // translates them into ellipses with focus at (0, 0).
    let unitCircle = pointsOnCircle(180);
    let sun = scene3d.polyline(pointsOnCircle(180), style(0xccccff));
    this.orbits.sun = sun;
    this.orbits.earth = scene3d.polyline(sun, style(0xccccff));
    this.orbits.venus = scene3d.polyline(sun, style(0xcccccc));
    this.orbits.mars = scene3d.polyline(sun, style(0xffcccc));
    this.orbits.mercury = scene3d.polyline(sun, style(0xcccccc));
    this.orbits.jupiter = scene3d.polyline(sun, style(0xcccccc));
    this.orbits.saturn = scene3d.polyline(sun, style(0xffffcc));
    ["sun", "earth", "venus", "mars", "mercury", "jupiter", "saturn"].forEach(
      p => {
        this.orbits[p].matrixAutoUpdate = false;
        this.orbits[p].visible = false;
      });
    this.orbits.sunMatrix = new Matrix4();
    this.updateOrbits(xyz, xyz.jd0);
  }

  update(xyzPlanets, jd0) {
    for (const [p, sprite] of Object.entries(this.planets)) {
      sprite.position.set(...xyzPlanets.xyz(p));
    }
    let rsm;  // save sunmars vector for sun orbit below
    for (const [p, sprite] of Object.entries(this.labels)) {
      let xyz = xyzPlanets.xyz(p);
      if (xyz) {
        sprite.position.set(...xyz);
      } else if (p == "antisun") {
        sprite.position.set(...xyzPlanets.xyz("earth").map(v => 2*v));
      } else if (p == "sunmars") {
        const e = xyzPlanets.xyz("earth");
        rsm = xyzPlanets.xyz("mars").map((v, i) => v + e[i]);
        sprite.position.set(...rsm);
      } else if (p == "meansun") {
        const ra = meanSunOn(xyzPlanets.jd);
        const e = xyzPlanets.xyz("earth");
        const ms = [Math.sin(ra) + e[0], e[1], Math.cos(ra) + e[2]];
        sprite.position.set(...ms);
      }
    }
    this.updateDate(xyzPlanets.jd);
    if (jd0 !== undefined) {
      this.updateOrbits(xyzPlanets, jd0);
    }
    if (this.orbits.sun.visible) {
      // While the other orbits do not change unless jd0 changes, the
      // Sun orbit needs additional translation to keep focus at earth
      // whenever jd changes.
      this._displaceSunOrbit(rsm);
    }
    const rings = this.rings;
    for (const [p, grp] of Object.entries(rings)) {
      if (!grp.visible) continue;
      const isMars = p == "mars";
      const userData = grp.userData;
      if (userData.initializing) {
        const re0 = userData.re0;
        const dre = xyzPlanets.xyz("earth").map((v, i) => v - re0[i]);
        grp.position.set(...dre);
        continue;
      }
      if (!userData.updating) continue;
      const yearError = userData.yearError;
      let jd = xyzPlanets.jd;
      if (p == "venus") {
        const jdStep = periodOf("earth", jd) + yearError;
        for (let sprite of grp.children) {
          sprite.position.set(...glPlanetPosition(p, jd));
          jd += jdStep;
        }
      } else if (isMars) {
        const re = xyzPlanets.xyz("earth");
        const jdStep = periodOf("mars", jd) + yearError;
        const heliocentric = grp.userData.heliocentric;
        const children = grp.children;
        for (let j = 0; j < children.length; j += 2) {
          let rs;
          let rm = glPlanetPosition("mars", jd);
          if (heliocentric) {
            rs = [0, 0, 0];
          } else {
            rs = glPlanetPosition("earth", jd).map((v, i) => re[i] - v);
            rm = rm.map((v, i) => v + rs[i]);
          }
          children[j].position.set(...rs);
          children[j+1].position.set(...rm);
          this._setSpoke(j/2, re, rs, rm);
          jd += jdStep;
        }
      }
    }
    if (!this.freeCamera) this.updateCamera(xyzPlanets);
    else if (this.altCamera) this.altCamera(xyzPlanets);
    adjustEcliptic(xyzPlanets.jd);
  }

  // Since orbits use local-to-world matrix to convert circle to ellipse,
  // cannot set their position directly
  _displaceSunOrbit(dr) {
    const dxyz = new Matrix4().makeTranslation(...dr);
    this.orbits.sun.matrix = this.orbits.sunMatrix.clone().premultiply(dxyz);
  }

  updateOrbits(xyzPlanets, jd) {
    this.orbits.sunMatrix = xyzPlanets.ellipse("sun", jd);  // see above
    let planets = ["earth", "venus", "mars", "mercury", "jupiter", "saturn"];
    planets.forEach(p => {
      this.orbits[p].matrix = xyzPlanets.ellipse(p, jd);
    });
  }

  addPlanet(name, texture, scale, color) {
    const sprite = this.scene3d.createSprite(texture, scale, color);
    this.planets[name] = sprite;
    return sprite;
  }

  circleSprite(radius, color, parent) {
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
    return txcanvas.addTo(this.scene3d, 0.5, 0.5, parent);
  }

  addLabel(text, params, tick=0, gap=-0.5) {
    if (params === undefined) params = {};
    const txcanvas = new TextureCanvas();
    const ctx = txcanvas.context;
    
    function getProp(params, name, value) {
      return params.hasOwnProperty(name)? params[name] : value;
    }

    // style variant weight size[/lineheight] family[,fam2,fam3,...]
    // style = normal | italic | oblique
    // variant = small-caps
    // weight = normal | bold | bolder | lighter | 100-900
    //          normal=400, bold=700
    // size = in px or em, optional /lineheight in px or em
    // family = optional
    let font = getProp(params, "font", "bold 16px Arial, sans-serif");
    ctx.font = font;
    let fontSize = parseFloat(
      ctx.font.match(/(?<value>\d+\.?\d*)/).groups.value);
    let {actualBoundingBoxLeft, actualBoundingBoxRight, actualBoundingBoxAscent,
         actualBoundingBoxDescent} = ctx.measureText(text);
    let [textWidth, textHeight] = [
      actualBoundingBoxLeft + actualBoundingBoxRight + 2,
      actualBoundingBoxAscent + actualBoundingBoxDescent + 2];
    if (!text) [textWidth, textHeight] = [0, 0];
    // Make tick and gap sizes scale with fontSize
    tick = tick * fontSize;
    gap = gap * fontSize;
    const thinText = textWidth < 1 - ((gap<0)? -2*gap : 0);
    txcanvas.width = thinText? ((gap<0)? 1-2*gap : 2) : textWidth;
    txcanvas.height = 2*tick + ((gap<0)? 0 : gap) + textHeight;
    ctx.font = font;
    // rgba(r, g, b, a)  either 0-255 or 0.0 to 1.0, a=0 transparent
    // or just a color
    ctx.fillStyle = getProp(params, "color", "#ffffff9f");
    ctx.fillText(text, actualBoundingBoxLeft+1,
                 txcanvas.height-textHeight+actualBoundingBoxAscent+1);
    if (tick) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(0.5*textWidth, 0.);
      ctx.lineTo(0.5*textWidth, tick);
      if (gap < 0) {
        ctx.moveTo(0.5*textWidth+gap, tick);
        ctx.lineTo(0.5*textWidth-gap, tick);
        ctx.moveTo(0.5*textWidth, tick);
        gap = 0;  // for bottom tick and sprite.center below
      } else {
        ctx.moveTo(0.5*textWidth, tick + gap);
      }
      ctx.lineTo(0.5*textWidth, 2*tick + gap);
      ctx.stroke();
    }
    const label = txcanvas.addTo(this.scene3d,
                                 0.5, 1. - (tick+0.5*gap)/txcanvas.height);
    this.labels[text.replace("-", "")] = label;
    return label;
  }

  addText(text, params) {
    if (params === undefined) params = {};
    const txcanvas = new TextureCanvas();
    const ctx = txcanvas.context;
    
    function getProp(params, name, value) {
      return params.hasOwnProperty(name)? params[name] : value;
    }

    // style variant weight size[/lineheight] family[,fam2,fam3,...]
    // style = normal | italic | oblique
    // variant = small-caps
    // weight = normal | bold | bolder | lighter | 100-900
    //          normal=400, bold=700
    // size = in px or em, optional /lineheight in px or em
    // family = optional
    let font = getProp(params, "font", "bold 16px Arial, sans-serif");
    ctx.font = font;
    let fontSize = parseFloat(
      ctx.font.match(/(?<value>\d+\.?\d*)/).groups.value);
    let {actualBoundingBoxLeft, actualBoundingBoxRight, actualBoundingBoxAscent,
         actualBoundingBoxDescent} = ctx.measureText(text);
    let [textWidth, textHeight] = [
      actualBoundingBoxLeft + actualBoundingBoxRight + 2,
      actualBoundingBoxAscent + actualBoundingBoxDescent + 2];
    if (!text) [textWidth, textHeight] = [0, 0];
    txcanvas.width = textWidth;
    txcanvas.height = textHeight;
    ctx.font = font;
    // rgba(r, g, b, a)  either 0-255 or 0.0 to 1.0, a=0 transparent
    // or just a color
    ctx.fillStyle = getProp(params, "color", "#ffffff9f");
    ctx.fillText(text, actualBoundingBoxLeft+1,
                 txcanvas.height-textHeight+actualBoundingBoxAscent+1);
    return txcanvas.addTo(this.scene3d, 0.5, 0.5);
  }

  setTracking(mode) {
    const freeCamera = (mode == "free");
    this.freeCamera = freeCamera;
    if (freeCamera) mode = "sky";
    else this.altCamera = null;
    for (const [p, sprite] of Object.entries(this.planets)) {
      sprite.visible = true;
    }
    const labels = this.labels;
    for (const [p, sprite] of Object.entries(labels)) {
      sprite.visible = false;
    }
    this.modeLabels[mode].forEach(name => { labels[name].visible = true; });
    if (freeCamera || (mode == "mars" && this.rings.mars.visible)) {
      labels.antisun.visible = false;
    }
    const skyMode = mode == "sky";
    this.scene3d.setBackground((skyMode && !freeCamera)? 0.6 : 0.3);
    controls.enabled = skyMode && !freeCamera;
    this.mode = mode;
  }

  updateCamera(xyzPlanets) {
    const camera = this.scene3d.camera;
    camera.position.set(...xyzPlanets.xyz("earth"));
    if (this.mode != "sky") camera.up.set(0, 1, 0);
    if (this.mode == "sun") {
      camera.lookAt(this.labels.meansun.position);
    } else if (this.mode == "venus") {
      camera.lookAt(0, 0, 0);
    } else if (this.mode == "mars") {
      camera.lookAt(this.labels.sunmars.position);
    }
  }

  addRing(planet, count) {
    const grp = this.scene3d.group();
    grp.visible = false;  // initially, group not drawn at all
    grp.userData.updating = false;
    grp.userData.count = 0;  // number currently visible
    grp.userData.n = 0;  // number currently visible
    const scene3d = this.scene3d;
    const sprite = this.planets[planet];
    if (planet == "venus") {
      for (let i = 0; i < count; i += 1) {
        let s = scene3d.createSprite(sprite, undefined, undefined, grp);
        s.visible = false;  // start with none visible
      }
    } else if (planet == "mars") {
      const sun = this.planets.sun;
      const spokes = scene3d.group();
      this.spokes = spokes;
      spokes.visible = false;
      const spokeStyle = scene3d.createLineStyle({color: 0x555577,
                                                  linewidth: 2});
      for (let i = 0; i < count; i += 1) {
        let s = scene3d.polyline([[0,0,0], [0,0,0], [0,0,0]],
                                 spokeStyle, spokes);
        s.visible = false;  // start with none visible
      }
      let mdl;
      for (let i = 0; i < 2*count; i += 1) {
        mdl = (i % 2)? sprite : sun;
        let s = scene3d.createSprite(mdl, undefined, undefined, grp);
        s.visible = false;  // start with none visible
      }
    }
    this.rings[planet] = grp;
  }

  addTriangles(count) {
    const grp = this.scene3d.group();
    grp.visible = false;  // initially, group not drawn at all
    this.triangles = grp;
    // 0x444466   0x6c6c89 is three.js 0.25 of ccccff
    let style = scene3d.createLineStyle({color: 0x6c6c89, linewidth: 2});
    let sun, earth, mars;
    for (let i = 0; i < count; i += 1) {
      let subgrp = this.scene3d.group(grp);
      scene3d.polyline([[0,0,0], [0,0,0], [0,0,0], [0,0,0]], style, subgrp);
      if (i) {
        scene3d.createSprite(sun, undefined, undefined, subgrp);
        scene3d.createSprite(earth, undefined, undefined, subgrp);
        scene3d.createSprite(mars, undefined, undefined, subgrp);
      } else {
        sun = sceneUpdater.circleSprite(4.5, "#ffffff", subgrp);
        earth = sceneUpdater.circleSprite(3.5, "#aaaaff", subgrp);
        mars = sceneUpdater.circleSprite(3.5, "#ffaaaa", subgrp);
        mars.material.depthTest = false;
        earth.material.depthTest = false;
        sun.material.depthTest = false;
      }
    }
    style = scene3d.createLineStyle({color: 0x896c6c, linewidth: 2.5});
    this.triangle = scene3d.polyline([[0,0,0], [0,0,0], [0,0,0], [0,0,0]],
                                     style);
    this.triangle.visible = false;
  }

  syncTriangles(jd, offset=0, moveLabel=false, keepMars=0) {
    const scene3d = this.scene3d;
    const triangles = this.triangles.children;
    if (offset.length === undefined) {
      offset = new Array(triangles.length).fill(offset);
    }
    const myear = periodOf("mars", jd);
    let rs, re, rm, re0;
    for (let i = 0; i < triangles.length; i += 1) {
      rs = [0, 0, 0];
      re = glPlanetPosition("earth", jd);
      rm = glPlanetPosition("mars", jd);
      if (i == 0) re0 = re;
      let parts = triangles[i].children;
      scene3d.movePoints(parts[0], [rs, re, rm, rs]);
      parts[1].position.set(...rs);
      parts[2].position.set(...re);
      if (i >= keepMars) parts[3].position.set(...rm);
      if (moveLabel && (i == 0)) {
        sceneUpdater.labels.earth.position.set(...re);
        sceneUpdater.labels.mars.position.set(...rm);
      }
      triangles[i].position.set(...re.map((v, j) => offset[i]*(re0[j] - v)));
      jd += myear;
    }
  }

  fadeTriangles(ms, on, noDraw) {
    const scene3d = this.scene3d;
    const triangles = this.triangles;
    on = on? true : false;
    let setVisibility = (visible) => {
      for (let subgrp of triangles.children) {
        setColorMultiplier(subgrp.children[0], 1);
        subgrp.children[0].visible = visible;
      }
    };
    if (!ms) {
      setVisibility(on);
      if (!noDraw) scene3d.render();
    } else {
      if (on) setVisibility(on);
      parameterAnimator.initialize(1, 0, ms, (mult) => {
        if (on) mult = 1 - mult;
        for (let subgrp of triangles.children) {
          setColorMultiplier(subgrp.children[0], mult);
        }
        if (mult == 0 && !on) setVisibility(on);
        scene3d.render();
      }).play();
    }
  }

  addCenters() {
    const centers = {};
    this.centers = centers;
    const top = this.scene3d.group();
    centers.top = top;
    top.visible = false;
    let style = scene3d.createLineStyle({color: 0x6c6c89, linewidth: 2});
    centers.earth = scene3d.segments(
      [-0.04, 0, 0,  0.04, 0, 0,  0, 0, -0.04,  0, 0, 0.04], style, top);
    centers.earthR = scene3d.segments([0, 0, 0,  1, 0, 0], style, top);
    style = scene3d.createLineStyle({color: 0x896c6c, linewidth: 2});
    centers.mars = scene3d.segments(
      [-0.04, 0, 0,  0.04, 0, 0,  0, 0, -0.04,  0, 0, 0.04], style, top);
    centers.marsR = scene3d.segments([0, 0, 0,  1.5, 0, 0], style, top);
    // ensure that centers get drawn on top of everything
    for (let obj of ["earth", "earthR", "mars", "marsR"]) {
      centers[obj].material.transparent = true;
      centers[obj].material.depthTest = false;
    }
  }

  setCenter(planet, cx, cy, cz, drawRadius=true) {
    const center = this.centers[planet];
    const radius = this.centers[planet + "R"];
    center.position.set(cx, cy, cz);
    radius.position.set(cx, cy, cz);
    radius.visible = drawRadius;
  }

  setRadius(planet, rx, ry, rz) {
    const radius = this.centers[planet + "R"];
    const {x, y, z} = radius.position;
    scene3d.movePoints(radius, [[0, 0, 0],  [rx-x, ry-y, rz-z]]);
  }

  centerVisibility(earth, mars) {
    const centers = this.centers;
    if (mars === undefined) {
      centers.top.visible = earth;
      centers.earth.visible = true;
      centers.mars.visible = true;
    } else {
      centers.top.visible = earth || mars;
      centers.earth.visible = earth;
      centers.mars.visible = mars;
    }
  }

  addOrbitPoints(nEarth, nMars, nSweep) {
    let top = this.scene3d.group();
    top.visible = false;  // initially, group not drawn at all
    this.orbitPoints = {};
    this.orbitPoints.top = top;
    let s = sceneUpdater.circleSprite(4.5, "#ffffff", top);
    s.position.set(0, 0, 0);
    s.material.depthTest = false;
    // s.renderOrder = 999;
    let i;
    let g = this.scene3d.group(top);
    g.visible = false;
    this.orbitPoints.sectors = g;
    g.userData.nSweep = nSweep;
    let indices = [];
    let points = [[0, 0, 0]];
    for (i = 1; i < nSweep; i += 1) {
      indices.push([0, i, i+1]);
      points.push([Math.sin((i-1)/nSweep), 0, Math.cos((i-1)/nSweep)]);
    }
    points.push([Math.sin(1), 0, Math.cos(1)]);
    scene3d.mesh(points, indices, [0x6c6c89, 0.4], g);
    scene3d.mesh(points, indices, [0x6c6c89, 0.5], g);
    /* mesh.material.color.set(0x896c6c) */
    g = this.scene3d.group(top);
    g.visible = false;
    this.orbitPoints.earthSpokes = g;
    // 0x444466    0x6c6c89 = three.js 0.25 of 0xcccccff
    let style = scene3d.createLineStyle({color: 0x6c6c89, linewidth: 2});
    for (i = 0; i < nEarth; i += 1) {
      scene3d.polyline([[0,0,0], [0,0,0]], style, g);
    }
    g = this.scene3d.group(top);
    g.visible = false;
    this.orbitPoints.marsSpokes = g;
    // 0x553333    0x896c6c = three.js 0.25 of 0xffccccc
    style = scene3d.createLineStyle({color: 0x896c6c, linewidth: 2});
    for (i = 0; i < nMars; i += 1) {
      scene3d.polyline([[0,0,0], [0,0,0]], style, g);
    }
    g = this.scene3d.group(top);
    this.orbitPoints.earth = g;
    for (let i = 0; i < nEarth; i += 1) {
      if (i) {
        scene3d.createSprite(s, undefined, undefined, g);
      } else {
        s = sceneUpdater.circleSprite(3.5, "#aaaaff", g);
        s.material.depthTest = false;
      }
    }
    g = this.scene3d.group(top);
    this.orbitPoints.mars = g;
    for (let i = 0; i < nMars; i += 1) {
      if (i) {
        scene3d.createSprite(s, undefined, undefined, g);
      } else {
        s = sceneUpdater.circleSprite(3.5, "#ffaaaa", g);
        s.material.depthTest = false;
      }
    }
  }

  drawEarthSpokes(jd, myr) {
    const spokes = this.orbitPoints.earthSpokes.children;
    const rs = [0, 0, 0];
    for (let i=0; i < spokes.length; i += 1) {
      if (!spokes[i].visible) continue;
      scene3d.movePoints(spokes[i], [rs, glPlanetPosition("earth", jd+i*myr)]);
    }
    this.orbitPoints.earthSpokes.visible = true;
  }

  drawEarthPoints(jd, myr, iOnly) {
    const earth = this.orbitPoints.earth.children;
    const spokes = this.orbitPoints.earthSpokes.children;
    for (let i = 0; i < earth.length; i += 1) {
      if (iOnly !== undefined && i != iOnly) {
        let visible = (i == iOnly);
        earth[i].visible = visible;
        spokes[i].visible = visible;
        if (!visible) continue;
      }
      earth[i].position.set(...glPlanetPosition("earth", jd+i*myr));
    }
  }

  resetMarsPoints() {
    this.orbitPoints.marsSpokes.visible = false;
    let spokes = this.orbitPoints.marsSpokes.children;
    const mars = this.orbitPoints.mars.children;
    let i;
    for (i = 0; i < mars.length; i += 1) {
      spokes[i].visible = false;
      mars[i].visible = false;
    }
    spokes = this.orbitPoints.earthSpokes.children;
    const earth = this.orbitPoints.earth.children;
    for (i = 0; i < earth.length; i += 1) {
      spokes[i].visible = true;
      earth[i].visible = true;
    }
  }

  drawMarsPoint(i, jd, moveLabel) {
    const mars = this.orbitPoints.mars.children;
    const rm = glPlanetPosition("mars", jd);
    mars[i].visible = true;
    mars[i].position.set(...rm);
    if (moveLabel) {
      const re = glPlanetPosition("earth", jd);
      sceneUpdater.labels.earth.position.set(...re);
      sceneUpdater.labels.mars.position.set(...rm);
    }
  }

  drawMarsSpokes() {
    const mars = this.orbitPoints.mars.children;
    const spokes = this.orbitPoints.marsSpokes.children;
    this.orbitPoints.marsSpokes.visible = true;
    const rs = [0, 0, 0];
    let rm;
    for (let i=0; i < mars.length; i += 1) {
      if (!mars[i].visible) continue;
      rm = mars[i].position;
      scene3d.movePoints(spokes[i], [rs, [rm.x, rm.y, rm.z]]);
      spokes[i].visible = true;
    }
  }

  hideOrbitSpokes(em=3) {
    const orbitPoints = this.orbitPoints;
    if (em & 1) orbitPoints.earthSpokes.visible = false;
    if (em & 2) orbitPoints.marsSpokes.visible = false;
  }

  drawLOS(i, jd, drawLabel) {
    const e = glPlanetPosition("earth", jd);
    const m8 = glPlanetPosition("mars", jd).map((m, j) => e[j] + (m-e[j])*100);
    const earth = this.orbitPoints.earth.children[i];
    const spoke = this.orbitPoints.earthSpokes.children[i];
    earth.visible = true;
    earth.position.set(...e);
    if (drawLabel) this.labels.earth.position.set(...e);
    spoke.visible = true;
    scene3d.movePoints(spoke, [e, m8]);
  }

  sweepSector(i, planet, jd0, jd1, ii, noSector) {
    const sectors = this.orbitPoints.sectors;
    const spokes = this.orbitPoints[planet+"Spokes"];
    const spoke = spokes.children[ii];
    spoke.visible = true;
    if (!ii) {
      sectors.visible = true;
      for (let s of sectors.children) {
        s.visible = false;
      }
      spokes.visible = true;
      for (let k = 1; k < spokes.children.length; k += 1) {
        spokes.children[k].visible = false;
      }
      scene3d.movePoints(spoke, [[0, 0, 0], glPlanetPosition(planet, jd0)]);
      sceneUpdater.updateDate(jd0);
      scene3d.render();
      return;
    }
    let sector = sectors.children[1];
    if (i == 0) {
      let visible = true;
      sectors.visible = true;
      for (let s of sectors.children) {
        s.material.color.set((planet=="mars")? 0x896c6c : 0x6c6c89);
        s.visible = visible;
        if (visible) sector = s;
        visible = !visible;
      }
    } else if (i == 1) {
      sector.visible = true;
    }
    const nSweep = sectors.userData.nSweep;
    function updatePoints(jd) {
      const n = nSweep - 1;
      const djd = (jd - jd0)/n;
      let points = [[0, 0, 0], glPlanetPosition(planet, jd0)];
      for (let k = 1; k <= n; k += 1) {
        points.push(glPlanetPosition(planet, jd0+k*djd));
      }
      if (!noSector) scene3d.meshMovePoints(sector, points);
      scene3d.movePoints(spoke, [[0, 0, 0], points[n+1]]);
      sceneUpdater.updateDate(jd0+n*djd);
    }
    parameterAnimator.initialize(jd0, jd1, 1000, (jd) => {
      updatePoints(jd);
      scene3d.render();
    }).play();
  }

  initializeRing(planet, xyzPlanets, noAnimate, noPlay) {
    if (!noPlay) skyAnimator.clearChain().stop();
    // Run forward or backward by up to half a year to find the
    // most open view of the orbit.
    let jdBest = this.findBestOrbitView(planet, xyzPlanets.jd0);
    let re0 = glPlanetPosition("earth", jdBest);
    const ring = this.rings[planet];
    ring.userData.jd0 = jdBest;
    ring.userData.re0 = re0;
    if (noAnimate) delete ring.userData.initializing;
    else ring.userData.initializing = true;
    ring.userData.yearError = 0;
    const pref = (planet == "venus")? "earth" : "mars";
    const jdStep = periodOf(pref, xyzNow.jd);
    if (!noAnimate) {
      this.setTracking(planet);
      if (noPlay) sceneUpdater.labels.sunmars.visible = false;
      xyzPlanets.update(jdBest - jdStep);
      this.scene3d.render();
      skyAnimator.chain(1000).chain(() => {
        ring.visible = true;  // after setTracking so antisun still visible
        skyAnimator.jdRate(jdStep / 6);
        skyAnimator.msEase(800);
        skyAnimator.playUntil(jdBest);
      }).chain(() => {
        this.labels.antisun.visible = false;  // nos remove antisun
        this.mode = "sky";  // lie about mode to prevent following planet
        skyAnimator.jdRate(jdStep);
        skyAnimator.playChain();
      });
    }
    let jd = jdBest;
    const isMars = planet == "mars";
    const isVenus = planet == "venus";
    let isSun = true, sunSprite;
    let rs, rm, iSpoke = 0, n = ring.children.length;
    for (let sprite of ring.children) {
      if (isVenus) {
        sprite.position.set(...glPlanetPosition(planet, jd));
      } else if (isMars) {
        if (isSun) {
          rs = glPlanetPosition("earth", jd).map((v, i) => re0[i] - v);
          sprite.position.set(...rs);
          sunSprite = sprite;
        } else {
          rm = glPlanetPosition("mars", jd).map((v, i) => v + rs[i]);
          sprite.position.set(...rm);
          this._setSpoke(iSpoke, re0, rs, rm);
          iSpoke += 1;
        }
        isSun = !isSun;
      }
      n -= 1;
      if (isSun) {
        ((n, sprite, sunSprite) => {
          if (noAnimate) {
            sprite.visible = true;
            if (sunSprite !== undefined) sunSprite.visible = true;
            if (!n) {
              ring.position.set(0, 0, 0);
              this.setTracking(planet);
              xyzPlanets.update(jdBest);
              this.showRing(planet, 0);
            }
          } else {
            skyAnimator.chain(500).chain(() => {
              sprite.visible = true;
              if (sunSprite !== undefined) sunSprite.visible = true;
              if (n) {
                skyAnimator.playFor(jdStep);
              } else {
                skyAnimator.jdRate(40);
                skyAnimator.msEase(0);
                delete ring.userData.initializing;
                ring.position.set(0, 0, 0);
                this.setTracking(planet);
                if (noPlay) sceneUpdater.labels.sunmars.visible = false;
                xyzPlanets.update(jdBest);
                this.showRing(planet, 3000);
              }
            });
          }
        })(n, sprite, sunSprite);
        jd += jdStep;
      }
    }
    if (!noPlay) {
      skyAnimator.playChain();
    }
  }

  _setSpoke(i, re0, rs, rm) {
    // Idea: spoke goes from sun to mars to mars-sun+earth
    // re0 = common viewing position
    // rs = sun - earth + re0
    // rm = mars - earth + re0
    const rsm = rm.map((v, j) => v - rs[j] + re0[j]);
    this.scene3d.movePoints(this.spokes.children[i], [rs, rm, rsm]);
  }

  showRing(planet, msFade) {
    for (let p in this.rings) {
      this.rings[p].visible = (p == planet);
      this.rings[p].userData.updating = false;
    }
    this.rings[planet].userData.updating = true;
    for (let p in this.planets) {
      if (p == "sun") continue;
      this.planets[p].visible = (p == planet);
    }
    if (msFade !== undefined) {
      const v = this.orbits[(planet == "venus")? "venus" : "sun"];
      v.visible = true;
      if (msFade <= 0) {
        setColorMultiplier(v, 0.25);
      } else {
        fadeColor(v, 0, 0.25, 3000);
      }
      if (planet == "mars") {
        let rsm = this.labels.sunmars.position;
        this._displaceSunOrbit([rsm.x, rsm.y, rsm.z]);
      }
    }
    return this.rings[planet];
  }

  showSpokes(ms, noPlay) {
    this.spokes.visible = true;
    const children = this.spokes.children;
    const scene3d = this.scene3d;
    let i = 0, n = children.length;
    for (i = 0; i < n ; i += 1) {
      if (ms) {
        const spoke = children[i];
        skyAnimator.chain(ms).chain(() => {
          spoke.visible = true;
          scene3d.render();
          skyAnimator.playChain();
        });
      } else {
        children[i].visible = true;
      }
    }
    if (ms && !noPlay) skyAnimator.playChain();
  }

  hideSpokes() {
    this.spokes.visible = false;
    for (let spoke of this.spokes.children) {
      spoke.visible = false;
    }
  }

  setYearError(yerr) {
    const ring = this.rings.venus.visible? this.rings.venus : this.rings.mars;
    ring.userData.yearError = yerr;
    xyzNow.update(xyzNow.jd);
  }

  zoom(hfov1, ms, callback) {
    // HFOV is default 100 degrees, 10 degrees is human eye resolution
    const scene3d = this.scene3d;
    const hfov0 = scene3d.hfov();
    const zstep = (lhfov) => {
      scene3d.setSize(undefined, undefined, -Math.exp(lhfov));
      scene3d.render();
    };
    if (!ms || ms < 0) {
      zstep(Math.log(hfov1));
      if (callback) callback(this);
      else skyAnimator.playChain();
    } else {
      parameterAnimator.initialize(
        Math.log(hfov0), Math.log(hfov1), ms, zstep, callback).play();
    }
  }

  // Variant of lookAt that looks in a direction rather than at an
  // object at finite distance.
  lookAlong(x, y, z) {
    const camera = this.scene3d.camera;
    if (y === undefined) {
      if (x.x !== undefined && x.y !== undefined && x.z !== undefined) {
        x = [x.x, x.y, x.z];
      }
      [x, y, z] = x;
    }
    let r = Math.sqrt(x**2 + y**2 + z**2);  // r = 0 is illegal direction
    [x, y, z] = [x/r, y/r, z/r];
    r = camera.position;
    const [xc, yc, zc] = [r.x, r.y, r.z];
    // Make sure that (x, y, z) is not much shorter than (x0, y0, z0).
    r = Math.sqrt(xc**2 + yc**2 + zc**2);
    if (r > 1) [x, y, z] = [x*r, y*r, z*r];
    // Look at an object in the direction of (x, y, z) from where camera is.
    camera.lookAt(xc + x, yc + y, zc + z);
  }

  recenterEcliptic() {
    const camera = this.scene3d.camera;
    let dir = camera.getWorldDirection(_dummyVector);
    if (dir.x > 0.001 || dir.z > 0.001) {
      dir.y = 0;
      dir.normalize();
    } else {
      dir.set(-1, 0, 0);
    }
    this.lookAlong(dir);
    this.scene3d.render();
  }

  cameraDirection() {
    const scene3d = this.scene3d;
    const camera = scene3d.camera;
    const {x, y, z} = camera.getWorldDirection(_dummyVector);
    return [x, y, z];
  }

  pivot(ms, msEase, to) {
    if (!ms || ms < 0) return;
    const scene3d = this.scene3d;
    const [x, y, z] = this.cameraDirection();
    const r = Math.sqrt(x**2 + z**2);
    const angle0 = Math.atan2(x, z);
    if (to === undefined) to = angle0 + 2*Math.PI;
    const angle1 = to;
    const rate = 2*Math.PI / ms;
    const self = this;
    if (msEase) ms = [ms, msEase];
    parameterAnimator.initialize(
      angle0, angle1, ms, (angle) => {
        self.lookAlong(r*Math.sin(angle), y, r*Math.cos(angle));
        scene3d.render();
      }).play();
  }

  pivotToSun(msMax, msEase) {
    const {x, y, z} = this.planets.earth.position;
    let angle = Math.atan2(-x, -z);
    const [xc, yc, zc] = this.cameraDirection();
    const r = Math.sqrt(xc**2 + zc**2);
    const angle0 = Math.atan2(xc, zc);
    if (angle > angle0+Math.PI) angle -= 2*Math.PI;
    else if (angle < angle0-Math.PI) angle += 2*Math.PI;
    const da = Math.abs(angle - angle0);
    let ms = msMax * da / Math.PI;
    this.pivot(ms, msEase, angle);
  }

  pivotToMeanSun(msMax, msEase) {
    let angle = meanSunOn(xyzNow.jd) % (2 * Math.PI);
    if (angle <= -Math.PI) angle += 2 * Math.PI;
    else if (angle > Math.PI) angle -= 2 * Math.PI;
    const [xc, yc, zc] = this.cameraDirection();
    const r = Math.sqrt(xc**2 + zc**2);
    const angle0 = Math.atan2(xc, zc);
    if (angle > angle0+Math.PI) angle -= 2*Math.PI;
    else if (angle < angle0-Math.PI) angle += 2*Math.PI;
    const da = Math.abs(angle - angle0);
    let ms = msMax * da / Math.PI;
    this.pivot(ms, msEase, angle);
  }

  hideRing(planet, msFade) {
    this.rings[planet].visible = false;
    this.rings[planet].userData.updating = false;
    for (let p in this.planets) {
      if (p == "sun") continue;
      this.planets[p].visible = true;
    }
    this.spokes.visible = false;
    const v = this.orbits[(planet == "venus")? "venus" : "sun"];
    this.hideOrbit(planet, 0.25, msFade);
  }

  showOrbit(planet, mult, msFade) {
    if (planet == "mars") planet == "sun";
    const v = this.orbits[planet];
    v.visible = true;
    if (msFade) {
      fadeColor(v, 0.05, mult, msFade);
    } else {
      setColorMultiplier(v, mult? mult : 1.0);
    }
  }

  hideOrbit(planet, mult, msFade) {
    if (planet == "mars") planet == "sun";
    const v = this.orbits[planet];
    if (msFade && msFade > 0) {
      fadeColor(v, mult, 0.05, msFade, () => {
        v.visible = false;
        setColorMultiplier(v, 1.0);
        scene3d.render();
      });
    } else {
      setColorMultiplier(v, 1.0);
      v.visible = false;
    }
  }

  resetRings() {
    const rings = this.rings;
    for (let name in rings) {
      const grp = rings[name];
      grp.visible = false;  // initially, group not drawn at all
      grp.userData.updating = false;
      for (let s of grp.children) {
        s.visible = false;
      }
      grp.userData.count = 0;  // number currently visible
      grp.userData.n = 0;  // number currently visible
    }
  }

  resetOrbits() {
    const orbits = this.orbits;
    for (let name in orbits) {
      orbits[name].visible = false;
    }
  }

  // Find a time which is near perpendicular to line of nodes,
  // on the side nearest perihelion of the outer planet.
  findBestOrbitView(planet, jd0) {
    const isMars = planet == "mars";
    const isVenus = planet == "venus";
    let jd = jd0;
    let z, pref;
    let [x, y, zn, e, a, b, ea, ma, madot] = orbitParams(planet, jd);
    if (isVenus) {
      pref = "earth";
      [x, y, z, e, a, b, ea, ma, madot] = orbitParams(pref, jd);
    } else {
      pref = planet;
      z = zn;
    }
    // x is outer planet perihelion direction (where ma = 0)
    // zn is perpendicular to nodal line, choose sign to make zn.dot(x) >= 0
    if (x[0]*zn[0] + x[1]*zn[1] < 0) {
      zn = [-zn[0], -zn[1], -zn[2]];
    }
    const jdBest = timePlanetAt(pref, zn[0], zn[1], 0, jd);
    return jdBest;
  }

  playToNodes(noPlay) {
    let isVenus;
    if (this.rings.venus.visible) isVenus = true;
    else if (this.rings.mars.visible) isVenus = false;
    else return;
    const planet = isVenus? "venus" : "mars";
    const pref = isVenus? "earth" : "mars";
    let jd = xyzNow.jd;
    let [ , , [x, y, z], , , , , , madot] = orbitParams(planet, jd);
    // z perpendicular to nodal line
    [x, y, z] = [-y, x, 0];  // line of nodes assuming ecliptic is z=0
    const year = periodOf(pref, jd);
    let jda = timePlanetAt(pref, x, y, z, jd);
    let jdb = timePlanetAt(pref, -x, -y, -z, jd);
    if (jda < jd) jda += year;
    if (jdb < jd) jdb += year;
    if (jda > jdb) [jda, jdb] = [jdb, jda];
    skyAnimator.chain(1000).chain(() => skyAnimator.playUntil(jda));
    skyAnimator.chain(2000).chain(() => skyAnimator.playUntil(jdb));
    if (!noPlay) skyAnimator.chain(() => skyAnimator.msEase(0));
    skyAnimator.jdRate(40);
    skyAnimator.msEase(800);
    if (!noPlay) skyAnimator.playChain();
    return [jda, jdb, year];
  }

  findOpposition() {
    const jdMin = 10;  // want to play for at least 10 days
    const jdNow = xyzNow.jd;  // assume this is first date on mars-ring
    const marsYear = periodOf("mars", jdNow+5*687);
    let i, jd, found, jdOpp;
    for (i = 0; i < 10; i += 1) {
      jd = jdNow + i*marsYear;  // time of i-th mars-ring point
      [found, jdOpp] = oppositionAfter(jd);
      if (found) break;
    }
    if (found) {
      jdOpp -= i*marsYear;
    } else {
      console.log("warning: no opposition found", jdNow);
      jdOpp = jdNow;
    }
    return [jdOpp, i];
  }

  updateDate(jd) {
    STARDATE.innerHTML = date4jd(jd);
  }
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

function pointsOnCircle(n, r=1) {
  return Array.from(new Array(n+1)).map((phi, i) => {
    phi = 2*Math.PI/n * i;
    return [r*Math.sin(phi), 0, r*Math.cos(phi)];  // xyz ecl -> yzx GL world
  });
}

function fadeColor(obj, mult0, mult1, ms, onFinish) {
  parameterAnimator.initialize(
    mult0, mult1, ms, (mult) => {
      setColorMultiplier(obj, mult);
      scene3d.render();
    }, onFinish).play();
}

function oppositionAfter(jd) {
  // Average synodic period of Mars is 780 days and we have 9 intervals
  // (10 points) around the ring, so takes 87 days to advance from one point
  // to the next on average - say a maximum of 100 days.
  const djd = 100;
  const detector = new OppositionDetector("mars", jd);
  const [found, oppo] = detector.next(jd + djd);
  // oppo = [revs, jd, xyz, xyze, x*ye - y*xe, x*xe + y*ye]
  // if found, oppo[4] = 0 very nearly
  return [found, oppo[1]];
}

// xyzNow.jd0 = start date
// xyzNow.jd = current date
// xyzNow.xyz(p, o) = current position of planet p (relative to o)
//   in GL world coords (cyclic permutation of ecliptic coords with y north)
const xyzNow = new PlanetPositions(dayOfDate(new Date()));

const sceneUpdater = new SceneUpdater(scene3d, xyzNow);

/* ------------------------------------------------------------------------ */

function resetScene(mode, noDelay) {
  if (!noDelay) {
    toggleText("1");
    showPlay(true);
  } else {
    showPlay(false);
  }
  toggleAreaLegend(false);
  sceneUpdater.triangle.visible = false;
  sceneUpdater.fadeTriangles(0, true, true);
  sceneUpdater.egrp.visible = true;
  sceneUpdater.eqgrp.visible = true;
  sceneUpdater.ecLabel.visible = true;
  sceneUpdater.eqLabel.visible = true;
  scene3d.setSize(undefined, undefined, -HFOV);
  sceneUpdater.resetOrbits();
  sceneUpdater.resetRings();
  sceneUpdater.hideSpokes();
  sceneUpdater.triangles.visible = false;
  sceneUpdater.orbitPoints.top.visible = false;
  sceneUpdater.orbitPoints.sectors.visible = false;
  sceneUpdater.centerVisibility(false);
  sceneUpdater.resetMarsPoints();
  sceneUpdater.hideOrbitSpokes();
  const camera = scene3d.camera;
  camera.position.set(0, 0, 0);
  camera.lookAt(-1, 0, 0);
  sceneUpdater.setTracking(mode);
  xyzNow.update();
}

function resetAnimators() {
  skyAnimator.clearChain().stop();
  skyAnimator.msEase().jdRate();
  parameterAnimator.stop();
  parameterAnimator.initialize();
}

class Pager {
  constructor(topbox, botbox, pageup, pagedn) {
    this.topPages = topbox.children;
    this.botPages = botbox.children;
    this.iPage = 0;
    this.pageup = pageup;
    this.pagedn = pagedn;

    let nowMar, mar2sep, year, textToggled;
    let jdOrigin = null;
    const sunCounter = (stop) => {
      if (jdOrigin === null) jdOrigin = xyzNow.jd;
      SUN_COUNTER.innerHTML = (xyzNow.jd - jdOrigin).toFixed(2);
    };

    this.pageEnter = [
      (noDelay) => {  // page 0: Seeing the Solar System
        scene3d.camera.up.set(0, 1, 0);
        resetScene("sky", noDelay);
        skyAnimator.chain(() => {
          sceneUpdater.pivot(12000, 1000);
        }).chain(2000).chain(() => {
          skyAnimator.msEase(1000);
          skyAnimator.playFor(5*365.25636);
        }).chain(2500).chain(() => {
          xyzNow.update();
          scene3d.render();
          skyAnimator.playChain();
        });
        scene3d.render();
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 1: First study how the Sun moves
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("sun", noDelay);
        sceneUpdater.labels.meansun.visible = false;
        for (let p of ["mercury", "venus", "mars", "jupiter", "saturn"]) {
          sceneUpdater.labels[p].visible = true;
        }
        sceneUpdater.lookAlong(xc, yc, zc);
        skyAnimator.chain(() => {
          sceneUpdater.pivotToMeanSun(4000, 1000);
        }).chain(() => {
          skyAnimator.msEase(1000);
          skyAnimator.playFor(5*365.25636);
        });
        scene3d.render();
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 2: The Sun's motion is non-uniform but periodic
        SUN_COUNTER.innerHTML = "-";
        MAR_SEP.innerHTML = "";
        SEP_MAR.innerHTML = "";
        jdOrigin = null;
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("sun", noDelay);
        sceneUpdater.labels.meansun.visible = false;
        sceneUpdater.lookAlong(xc, yc, zc);
        skyAnimator.chain(() => {
          sceneUpdater.pivotToMeanSun(4000, 1000);
        }).chain(() => {
          const jdNow = xyzNow.jd;
          const orig = -precession(jdNow);
          const [x, y] = [Math.cos(orig), Math.sin(orig)]
          year = periodOf("earth", jdNow);
          let jdNov = timePlanetAt("earth", x, y, 0, jdNow);
          if (jdNov < jdNow) jdNov += year;
          let jdMar = timePlanetAt("earth", -x, -y, 0, jdNow);
          if (jdMar < jdNow) jdMar += year;
          nowMar = jdMar < jdNov;
          mar2sep = jdNov - jdMar;
          if (!nowMar) mar2sep += year;
          skyAnimator.msEase(500);
          skyAnimator.playFor((nowMar? jdMar : jdNov) - jdNow);
        });
        function countDays() {
          return skyAnimator.chain(() => {
            SUN_COUNTER.innerHTML = "0";
            jdOrigin = null;
            skyAnimator.playChain();
          }).chain(1500).chain(() => {
            skyAnimator.syncSky = sunCounter;
            skyAnimator.playFor(nowMar? mar2sep : year-mar2sep);
          }).chain(() => {
            if (nowMar) MAR_SEP.innerHTML = mar2sep.toFixed(2) + " days";
            else SEP_MAR.innerHTML = (year-mar2sep).toFixed(2) + " days";
            nowMar = !nowMar;
            skyAnimator.playChain();
          }).chain(1500);
        }
        for (let i=0; i<6; i+=1) countDays();
        scene3d.render();
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 3: Venus zig-zags about the Sun
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("venus", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        skyAnimator.chain(() => {
          sceneUpdater.pivotToSun(4000, 1000);
        }).chain(500).chain(() => {
          skyAnimator.msEase(1000);
          // 8 Earth years very nearly 13 Venus years
          skyAnimator.playFor(8 * 365.25636);
        });
        scene3d.render();
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 4: Visualize Venus's orbit
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("venus", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("venus", xyzNow, false, true);
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 5: Find the orbital plane of Venus
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("venus", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("venus", xyzNow, true, true);
        const [ta, tb, yr] = sceneUpdater.playToNodes(true);
        for (let i = 1; i <= 4 ; i += 1) {
          skyAnimator.chain(2000).chain(() => skyAnimator.playUntil(ta + i*yr));
          skyAnimator.chain(2000).chain(() => skyAnimator.playUntil(tb + i*yr));
        }
        scene3d.render();
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 6: Venus is to Earth as Earth is to Mars
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("venus", true);  // always toggle text on
        showPlay(false);  // never show play button
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("venus", xyzNow, true, true);
        scene3d.render();
        controls.enabled = true;
      },

      (noDelay) => {  // page 7: Visualize Earth's orbit
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("mars", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("mars", xyzNow, false, true);
        skyAnimator.chain(() => {
          sceneUpdater.planets.sun.visible = false;
          scene3d.render();
          skyAnimator.playChain();
        }).chain(2000).chain(() => {
          sceneUpdater.pivot(12000, 1000);
        }).chain(() => {
          controls.enabled = true;
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 8: How to find the Sun-Mars direction
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("mars", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("mars", xyzNow, true, true);
        sceneUpdater.planets.sun.visible = false;
        sceneUpdater.labels.antisun.visible = false;
        scene3d.render();
        sceneUpdater.showSpokes(500, true);
        skyAnimator.chain(() => {
          sceneUpdater.pivot(12000, 1000);
        }).chain(2000).chain(() => {
          sceneUpdater.zoom(10, 5000);
        }).chain(2000).chain(() => {
          sceneUpdater.zoom(HFOV, 5000);
        }).chain(3000).chain(() => {
          skyAnimator.msEase(1000);
          skyAnimator.playFor(2 * periodOf("mars", xyzNow.jd));
        }).chain(() => {
          controls.enabled = true;
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 9: Opposition is the best reference time
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("mars", noDelay);
        sceneUpdater.lookAlong(xc, yc, zc);
        sceneUpdater.initializeRing("mars", xyzNow, true, true);
        sceneUpdater.showSpokes();
        scene3d.render();
        const jdNow = xyzNow.jd;
        const [jdOpp, iOpp] = sceneUpdater.findOpposition();
        skyAnimator.msEase(1000).chain(() => {
          skyAnimator.playFor(jdOpp - jdNow);
        }).chain(2000).chain(() => {
          sceneUpdater.zoom(10, 5000);
        }).chain(5000).chain(() => {
          sceneUpdater.zoom(HFOV, 5000);
        }).chain(() => {
          controls.enabled = true;
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 10: Begin surveying Earth's orbit!
        let [jdOpp, vec1, vec2, re0, rsm] = helioInit(noDelay);
        scene3d.render();
        const camera = scene3d.camera;
        skyAnimator.chain(() => {
          helioSetup(jdOpp);
          scene3d.render();
          skyAnimator.playChain();
          textToggled = toggleText("0");
        }).chain(500).chain(() => {
          const lhfov0 = Math.log(HFOV);
          const lhfov1 = Math.log(scene3d.hfov(helioFov));
          parameterAnimator.initialize(0, 3, [6000, 1000], (frac) => {
            let v, target;
            if (frac <= 1) {
              const lhfov = (1-frac)*lhfov0 + frac*lhfov1;
              scene3d.setSize(undefined, undefined, -Math.exp(lhfov));
              scene3d.horizFov = 0;  // resize keeps vertical FOV fixed
              v = vec1.map((v, i) => re0[i] + frac*v);
              target = rsm.map((v, i) => (1-frac)*v + frac*re0[i]);
            } else {
              frac = (frac - 1)/2;
              v = vec1.map((v, i) => re0[i] + (1-frac)*v + frac*vec2[i]);
              target = re0.map((v, i) => (1-0.5*frac)*v + 0.5*frac*rsm[i]);
              camera.up.set(frac, 1-frac, 0);
            }
            camera.position.set(...v);
            camera.lookAt(...target);
            scene3d.render();
          }).play();
        }).chain(3000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 11: Adopt the heliocentric view
        let [jdOpp, vec1, vec2, re0, rsm] = helioInit(noDelay);
        const camera = scene3d.camera;
        helioSetup(jdOpp);
        const pos = vec2.map((v, i) => re0[i] + v);
        const target = re0.map((v, i) => 0.5*v + 0.5*rsm[i]);
        camera.up.set(1, 0, 0);
        camera.position.set(...pos);
        camera.lookAt(...target);
        scene3d.setSize(undefined, undefined, helioFov);
        scene3d.render();
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          sceneUpdater.hideOrbit("sun", 0.25, 1000);
        }).chain(1000).chain(() => {
          const ntri = sceneUpdater.triangles.children.length;
          const offs = new Array(ntri);
          parameterAnimator.initialize(1, 0, [8000, 1000], (frac) => {
            for (let i = 0; i < ntri; i += 1) {
              let f = (ntri-1)*frac - (ntri-1 - i);  // i=0 does not move
              if (f < 0) f = 0;
              if (f > 1) f = 1;
              offs[i] = f;
            }
            sceneUpdater.syncTriangles(jdOpp, offs);
            // initially looking at target from pos, finally at 0 from 0
            camera.position.set(...pos.map((v, i) => (i==1)? v : frac*v));
            camera.lookAt(...target.map(v => frac*v));
            scene3d.render();
          }).play();
        }).chain(() => {
          sceneUpdater.showOrbit("earth", 0.25, 1000);
        }).chain(3000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 12: Survey a second point on Mars's orbit
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay);
        sceneUpdater.syncTriangles(jdOpp, 0);
        scene3d.render();
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          sceneUpdater.fadeTriangles(2000, false);
        }).chain(() => {
          parameterAnimator.initialize(0, year, [4000, 500], (djd) => {
            sceneUpdater.syncTriangles(jdOpp+djd, 0, true, 1);
            scene3d.render();
            sceneUpdater.updateDate(jdOpp+djd);
          }).play();
        })
        let triangle = sceneUpdater.triangle;
        let rm = glPlanetPosition("mars", jdOpp + year);
        const n = sceneUpdater.triangles.children.length;
        let re = new Array(n).fill(0).map(
          (v, i) => glPlanetPosition("earth", jdOpp + year + i*myear));
        // lengths of re all approximately 1
        re = re.map(v => [rm[0]*v[2] - rm[2]*v[0], v]).sort(
          (a, b) => a[0] - b[0]).map(v => v[1]);
        for (let [i0, i1] of [[0, n-1], [1, n-2], [2, n-1], [0, n-3]]) {
          skyAnimator.chain(2000).chain(() => {
            scene3d.movePoints(triangle, [rm, re[i0], re[i1], rm]);
            triangle.visible = true;
            scene3d.render();
            skyAnimator.playChain();
          });
        }
        skyAnimator.chain(2000).chain(() => {
          triangle.visible = false;
          sceneUpdater.fadeTriangles(2000, true);
        }).chain(3000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 13: Survey more points on Mars's orbit
        // Call original point 0, then second point is E (one Earth year later).
        // Let X = 2E - M (two Earth years minus one Mars year = 43.53 days)
        // Choose 15 points on Mars orbit as:
        //   -3X -2X -X 0 X 2X 3X E-4X E-3X E-2X E-X E E+X E+2X E+3X   (M => 0)
        //      X   X  X X X  X  U    X    X    X   X X   X    X    U  spacings
        // U = E-7X = M-E-6X = 7M-13E
        // M = 686.97985, E = 365.25636   ==>   X = 43.53287, U = 60.52627
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay);
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        sceneUpdater.triangles.visible = false;
        sceneUpdater.orbitPoints.top.visible = true;
        sceneUpdater.drawEarthSpokes(jdOpp, myear);
        sceneUpdater.drawEarthPoints(jdOpp, myear);
        sceneUpdater.drawMarsPoint(0, jdOpp, true);
        sceneUpdater.drawMarsPoint(1, jdOpp+year);
        sceneUpdater.drawMarsSpokes();
        scene3d.render();
        sceneUpdater.updateDate(jdOpp);
        const xstep = 2*year - myear;
        const djds = [
          0, -xstep, -2*xstep, -3*xstep,
          0, xstep, 2*xstep, 3*xstep,
          year, year-xstep, year-2*xstep, year-3*xstep, year-4*xstep,
          year, year+xstep, year+2*xstep, year+3*xstep];

        function takeStep(i, j, pause, dt) {
          if (pause) skyAnimator.chain(pause);
          skyAnimator.chain(() => {
            sceneUpdater.triangle.visible = false;
            const jd0 = jdOpp+djds[j], jd1 = jdOpp+djds[j+1];
            parameterAnimator.initialize(jd0, jd1, dt, (jd) => {
              sceneUpdater.drawMarsPoint(i, jd, true);
              sceneUpdater.drawEarthPoints(jd, myear);
              scene3d.render();
              sceneUpdater.updateDate(jd);
            }).play();
          }).chain(() => {
            const djd1 = djds[j+1];
            const nsteps = Math.round(((j >= 8)? djd1-year : djd1)/xstep);
            goodMarsTriangle(i, nsteps);
            scene3d.render();
            skyAnimator.playChain();
          });
        }
        function startStep(i, j, pause) {
          if (pause) skyAnimator.chain(pause);
          const jd = jdOpp + djds[j];
          skyAnimator.chain(() => {
            sceneUpdater.triangle.visible = false;
            sceneUpdater.drawMarsPoint(i, jd, true);
            sceneUpdater.drawEarthPoints(jd, myear);
            scene3d.render();
            sceneUpdater.updateDate(jd);
            skyAnimator.playChain();
          });
        }

        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        });
        takeStep(2, 0, 1000, 800);
        takeStep(3, 1, 2000, 800);
        takeStep(4, 2, 2000, 800);
        startStep(5, 4, 2000);
        takeStep(5, 4, 2000, 800);
        takeStep(6, 5, 2000, 800);
        takeStep(7, 6, 2000, 800);
        startStep(8, 8, 2000);
        takeStep(8, 8, 2000, 800);
        takeStep(9, 9, 2000, 800);
        takeStep(10, 10, 2000, 800);
        takeStep(11, 11, 2000, 800);
        startStep(12, 13, 2000);
        takeStep(12, 13, 2000, 800);
        takeStep(13, 14, 2000, 800);
        takeStep(14, 15, 2000, 800);
        startStep(0, 0, 2000);
        skyAnimator.chain(1000).chain(() => {
          sceneUpdater.triangle.visible = false;
          sceneUpdater.drawMarsSpokes();
          sceneUpdater.showOrbit("mars", 0.25, 1500);
        }).chain(3000).chain(() => {
          sceneUpdater.hideOrbitSpokes();
          scene3d.render();
          skyAnimator.playChain();
        }).chain(2000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 14: Fly around orbits of Earth and Mars
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay, true);
        // ecliptic (x, y, z) is webGL (z, x, y)
        let [ , , [ez, ex, ey]] = orbitParams("earth", jdOpp + 3652.5);
        let [ , , [mz, mx, my]] = orbitParams("mars", jdOpp + 3652.5);
        // axis_e.cross.axis_m is ascending node of Mars
        let [nx, ny, nz] = [ey*mz-ez*my, ez*mx-ex*mz, ex*my-ey*mx];
        let dot = ex*mx + ey*my + ez*mz;
        [mx, my, mz] = [mx-dot*ex, my-dot*ey, mz-dot*ez];
        let mr = Math.sqrt(mx**2 + my**2 + mz**2);
        [mx, my, mz] = [mx/mr, my/mr, mz/mr];  // southern mars solstice

        const {x: p0x, y: p0y, z: p0z} = scene3d.camera.position;
        skyAnimator.chain(() => {
          viewDirection([-0.25, -0.1, 0.5], 6000);
        }).chain(() => {
          viewDirection([0, 0, 1], 2000);
        }).chain(() => {
          viewZoom(1.25, 2000);
        }).chain(() => {
          viewDirection([nx, ny, nz], 2000);
        }).chain(3000).chain(() => {
          viewDirection([-mx, -my, -mz], 2500);
        }).chain(() => {
          viewDirection([-nx, -ny, -nz], 2500);
        }).chain(3000).chain(() => {
          viewDirection([0, 0, 1], 3000);
        }).chain(() => {
          viewZoom(0.8, 3000);
        }).chain(() => {
          viewDirection([p0x, p0y, p0z], 5000);
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 15: Orbits are nearly eccentric circles
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay, true);
        let [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
             ang0e, ang0m] = getOrbits(jdOpp, re0);
        function setEarthR(ang) {
          const [c, s] = [re*Math.cos(ang), re*Math.sin(ang)];
          const [x, y, z] = xe.map((v, i) => v*c + ye[i]*s);
          sceneUpdater.setRadius("earth", x+cex, y+cey, z+cez);
        }
        function setMarsR(ang) {
          const [c, s] = [rm*Math.cos(ang), rm*Math.sin(ang)];
          const [x, y, z] = xm.map((v, i) => v*c + ym[i]*s);
          sceneUpdater.setRadius("mars", x+cmx, y+cmy, z+cmz);
        }
        setEarthR(ang0e);
        setMarsR(ang0m);
        scene3d.render();

        const twopi = 2*Math.PI;
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          viewZoom(2.5, 3000);
        }).chain(4000).chain(() => {
          viewZoom(0.4, 3000);
        }).chain(2000).chain(() => {
          parameterAnimator.initialize(
            ang0e, ang0e+twopi, [4000, 500], (ang) => {
            setEarthR(ang);
            scene3d.render();
          }).play();
        }).chain(2000).chain(() => {
          parameterAnimator.initialize(
            ang0m, ang0m+twopi, [6000, 500], (ang) => {
            setMarsR(ang);
            scene3d.render();
          }).play();
        }).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 16: Kepler's First Law
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay, true);
        let [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
             ang0e, ang0m] = getOrbits(jdOpp, re0, false);
        function exaggerate(factor) {
          function adjustPos(obj, cx, cy, cz, rc) {
            let {x, y, z} = obj.position;
            if (obj.userData.originalPosition) {
              [x, y, z] = obj.userData.originalPosition;
            } else {
              obj.userData.originalPosition = [x, y, z]
            }
            let r = Math.sqrt((x-cx)**2 + (y-cy)**2 + (z-cz)**2);
            let dfactor = (factor*(r - rc) + rc) / r;
            [x, y, z] = [dfactor*x, dfactor*y, dfactor*z];
            obj.position.set(x, y, z);
          }
          for (let e of sceneUpdater.orbitPoints.earth.children) {
            adjustPos(e, cex, cey, cez, re);
          }
          for (let m of sceneUpdater.orbitPoints.mars.children) {
            adjustPos(m, cmx, cmy, cmz, rm);
          }
          scene3d.render();
        }
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          parameterAnimator.initialize(1, 40, 4000, (f) => {
            exaggerate(f);
          }).play();
        }).chain(4000).chain(() => {
          parameterAnimator.initialize(40, 1, 4000, (f) => {
            exaggerate(f);
          }).play();
        }).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 17: Earth moves faster when closer to Sun
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay);
        sceneUpdater.triangles.visible = false;
        sceneUpdater.showOrbit("mars", 0.25);
        let [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
             ang0e, ang0m] = getOrbits(jdOpp, re0, false);
        let [,,,,,,, mae, madote] = orbitParams("earth", jdOpp + 3652.5);
        mae -= madote*(jdOpp + 3652.5);
        function meanEarth(jd) {
          const ma = mae + madote*jd;
          const [c, s] = [Math.cos(ma), Math.sin(ma)];
          const glr = xe.map((v, i) => v*c + ye[i]*s);
          return [glr[2], glr[0], glr[1]];  // ecliptic coords, not gl
        }
        let [,,,,,,, mam, madotm] = orbitParams("mars", jdOpp + 3652.5);
        mam -= madotm*(jdOpp + 3652.5);
        function meanMars(jd) {
          const ma = mam + madotm*jd;
          const [c, s] = [Math.cos(ma), Math.sin(ma)];
          const glr = xm.map((v, i) => v*c + ym[i]*s);
          return [glr[2], glr[0], glr[1]];  // ecliptic coords, not gl
        }
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        sceneUpdater.orbitPoints.top.visible = true;
        sceneUpdater.hideOrbitSpokes();
        sceneUpdater.drawMarsPoint(0, jdOpp, true);
        sceneUpdater.drawEarthPoints(jdOpp, myear, 0);
        sceneUpdater.drawEarthSpokes(jdOpp, myear);
        sceneUpdater.drawMarsSpokes();
        scene3d.render();
        sceneUpdater.updateDate(jdOpp);
        // Compute djd = time required for planet to reach current
        //               position of the mean planet
        //   For Earth, djd>0 in March and djd<0 in September;
        //   djd=0 at the apsides (perihelion and aphelion
        // We want to exaggerate this time by a certain factor (eFactor
        // for Earth, mFactor for Mars), so we subtract (factor-1)*djd
        // from the actual current time.  Thus factor=1 means no change,
        // factor=0 puts the planet at the mean planet, factor=2 doubles
        // the time to reach mean planet, and so on.  Note that the mean
        // planet position does not change, just the amplitude of the
        // oscillations around it.
        const eFactor = 15, mFactor = 4;
        let djd = timePlanetAt("earth", ...meanEarth(jdOpp), jdOpp) - jdOpp;
        const jd0e = jdOpp - (eFactor-1)*djd;
        djd = timePlanetAt("mars", ...meanMars(jdOpp), jdOpp) - jdOpp;
        const jd0m = jdOpp - (mFactor-1)*djd;
        const pos = sceneUpdater.orbitPoints.earth.children[0].position;
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          parameterAnimator.initialize(
            jdOpp, jd0e+4*year, [11000, 500], (jd) => {
            sceneUpdater.drawMarsPoint(0, jd, true);
            sceneUpdater.drawEarthPoints(jd, myear, 0);
            sceneUpdater.drawEarthSpokes(jd, myear);
            sceneUpdater.drawMarsSpokes();
            scene3d.render();
            sceneUpdater.updateDate(jd);
          }).play();
        }).chain(() => {
          sceneUpdater.hideOrbitSpokes();
          sceneUpdater.orbitPoints.mars.children[0].visible = false;
          sceneUpdater.labels.mars.visible = false;
          sceneUpdater.drawEarthPoints(jd0e, myear, 0);
          sceneUpdater.drawEarthSpokes(jd0e, myear);
          sceneUpdater.labels.earth.position.copy(pos);
          scene3d.render();
          skyAnimator.playChain();
        }).chain(2000).chain(() => {
          sceneUpdater.labels.earth.position.copy(pos);
          parameterAnimator.initialize(
            jdOpp, jdOpp+4*year, [9000, 500], (jd) => {
            djd = timePlanetAt("earth", ...meanEarth(jd), jd) - jd;
            jd -= (eFactor-1)*djd;  // enhance actual-mean time difference
            sceneUpdater.drawEarthPoints(jd, myear, 0);
            sceneUpdater.drawEarthSpokes(jd, myear);
            sceneUpdater.labels.earth.position.copy(pos);
            scene3d.render();
            sceneUpdater.updateDate(jd);
          }).play();
        }).chain(() => {
          sceneUpdater.drawMarsPoint(0, jd0m, true);
          sceneUpdater.labels.mars.visible = true;
          sceneUpdater.drawMarsSpokes();
          sceneUpdater.drawEarthPoints(jd0m, myear, 0);
          sceneUpdater.drawEarthSpokes(jd0m, myear);
          scene3d.render();
          sceneUpdater.updateDate(jd0m);
          skyAnimator.playChain();
        }).chain(2000).chain(() => {
          sceneUpdater.hideOrbitSpokes();
          sceneUpdater.orbitPoints.earth.children[0].visible = false;
          sceneUpdater.labels.earth.visible = false;
          sceneUpdater.drawMarsSpokes();
          scene3d.render();
          skyAnimator.playChain();
        }).chain(2000).chain(() => {
          parameterAnimator.initialize(
            jdOpp, jdOpp+4*myear, [9000, 500], (jd) => {
            djd = timePlanetAt("mars", ...meanMars(jd), jd) - jd;
            jd -= (mFactor-1)*djd;  // enhance actual-mean time difference
            sceneUpdater.drawMarsPoint(0, jd, true);
            sceneUpdater.drawMarsSpokes();
            scene3d.render();
            sceneUpdater.updateDate(jd);
          }).play();
        }).chain(2000).chain(() => {
          sceneUpdater.orbitPoints.earth.children[0].visible = true;
          sceneUpdater.labels.earth.visible = true;
          sceneUpdater.drawEarthPoints(jd0m, myear, 0);
          sceneUpdater.drawEarthSpokes(jd0m, myear);
          sceneUpdater.labels.earth.position.copy(pos);
          scene3d.render();
          sceneUpdater.updateDate(jd0m);
          skyAnimator.playChain();
        }).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 18: Kepler's Second Law
        let [jdOpp, vec1, vec2, re0, rsm] = topViewSetup(noDelay, true);
        let [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
             ang0e, ang0m] = getOrbits(jdOpp, re0, false);
        // Cannot figure out how to prevent transparent parts of
        // label sprites from either blocking sectors (sectors not
        // normal to camera, but sprites are), or being completely
        // blocked by sectors (as if sectors were opaque).  Have
        // tried depthTest, depthWrite, and renderOrder in various
        // combinations.
        sceneUpdater.labels.sun.visible = false;
        sceneUpdater.labels.earth.visible = false;
        sceneUpdater.labels.mars.visible = false;
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        const jdStep = 2*year - myear;
        const jd0e = jdOpp + 9*myear-17*year;
        const jd0m = jdOpp - 3*jdStep;
        const jd1m = jdOpp + year - 4*jdStep;
        sceneUpdater.sweepSector(0, "earth", jd0e, 0, 0);
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        });
        let i;
        for (i = 1; i < 10 ; i += 1) {
          const jd = jd0e + i*jdStep;
          const j = i;
          skyAnimator.chain(1000).chain(() => {
            sceneUpdater.sweepSector(j-1, "earth", jd-jdStep, jd, j);
          });
        }
        skyAnimator.chain(2000).chain(() => {
          sceneUpdater.hideOrbitSpokes(1);
          sceneUpdater.orbitPoints.sectors.visible = false;
          sceneUpdater.sweepSector(0, "mars", jd0m, 0, 0);
          skyAnimator.playChain();
        });
        for (i = 1; i < 15 ; i += 1) {
          const jdf = (i<7)? jd0m + i*jdStep : jd1m + (i-7)*jdStep;
          const jdb = (i!=7)? jdf - jdStep : jd0m + 6*jdStep;
          const j = i;
          skyAnimator.chain(1000).chain(() => {
            sceneUpdater.sweepSector(j-1, "mars", jdb, jdf, j, j==7);
          });
        }
        skyAnimator.chain(2000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 19: Use Kepler's Laws to survey other orbits
        let [jdOpp, vec1, vec2, re0, rsm, iOpp] = topViewSetup(noDelay, true);
        let [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
             ang0e, ang0m] = getOrbits(jdOpp, re0, false);
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        const jdStep = 2*year - myear;
        // Five points will be jdOpp plus (-2, -1, 0, 1, 2) times jdStep
        // If iOpp <2 or >7, some of these points on Earth's orbit will not
        // have been previously surveyed, but don't worry about that here.
        const jds = [-2, -1, 0, 1, 2].map(i => jdOpp+iOpp*myear + i*jdStep);
        const earth = jds.map(jd => glPlanetPosition("earth", jd));
        const mars = jds.map(jd => glPlanetPosition("mars", jd));
        const em34 = [earth[3], mars[3], earth[4], mars[4]];
        const utrue = mars.slice(0,3).map((p, i) =>
          norm(p.map((q, j) => q - earth[i][j])));
        sceneUpdater.centerVisibility(false);
        sceneUpdater.orbitPoints.top.visible = true;
        sceneUpdater.hideOrbitSpokes(2);
        sceneUpdater.resetMarsPoints();
        sceneUpdater.hideOrbit("mars", 0.25);
        sceneUpdater.labels.mars.visible = false;
        sceneUpdater.orbitPoints.earth.children.forEach(o => {
          o.visible = false;});
        sceneUpdater.orbitPoints.earthSpokes.visible = true;
        sceneUpdater.orbitPoints.earthSpokes.children.forEach(o => {
          o.visible = false;});
        sceneUpdater.drawLOS(0, jds[0], true);
        scene3d.render();
        sceneUpdater.updateDate(jds[0]);
        skyAnimator.chain(() => {
          textToggled = toggleText("0");
          skyAnimator.playChain();
        });
        let i;
        for (i = 1; i < jds.length; i += 1) {
          const j = i;
          skyAnimator.chain(1000).chain(() => {
            parameterAnimator.initialize(
                jds[j-1], jds[j], [1000, 300], (jd) => {
              sceneUpdater.drawLOS(j, jd, true);
              scene3d.render();
              sceneUpdater.updateDate(jd);
            }).play();
          });
        }
        function wiggler(ua, ub, uc) {
          // f(0) = ua, f(max or min) = ub, f(1) = uc
          // f(x) = a*(x-b)**2 - a*b**2 + ua = a*(x-b)**2 + ub
          // f(1) = a*(1-b)**2 + ub = uc
          //   a*b**2 = ua - ub
          //   a*(1-b)**2 = uc - ub = a*b**2 - 2*a*b + a
          //   uc - ua = a*(1 - 2*b)
          //   uca*b**2 = uab*(1-2*b)  or   uca*b**2 + 2*uab - uab = 0
          //   uca*b**2 - 2*uba*b + uba = 0
          //   uca*b = uba +- sqrt(uba**2 - uba*uca)
          //      d = uba**2 - uba*uca = uba*(uba-uca) = uba*ubc > 0!
          //   uca*b = uba +- sqrt(uba*ubc)
          //   b = (uba +- gmean(uba, ubc))/uca
          //   b = uba / (uba -+ gmean(uba, ubc))
          //       sign of gmean same as sign of uba (or ubc)
          const uba = ub - ua, ubc = ub - uc, uca = uc - ua;
          let gm = uba * ubc;
          if (gm <= 0) return (x) => ua + uca*x;  // linear fallback
          gm = Math.sqrt(gm) * Math.sign(uba);
          const b = uba / (uba + gm);
          const a = -uba / b**2;
          return (x) => ub + a*(x - b)**2;
        }
        function drawAll(u0, u1, u2, all5) {
          const p0 = pointOnLOS(earth[0], mars[0], u0);
          const p1 = pointOnLOS(earth[1], mars[1], u1);
          const p2 = pointOnLOS(earth[2], mars[2], u2);
          const em = all5? em34 : [];
          drawEllipse(p0, p1, p2, ...em);
          sceneUpdater.updateDate(jds[0]);
        }
        function drawWiggles(u0, u1, u2, all5) {
          function sitOrWiggle(u) {
            if (!Array.isArray(u)) return (x) => u;
            return wiggler(...u);
          }
          const wig0 = sitOrWiggle(u0);
          const wig1 = sitOrWiggle(u1);
          const wig2 = sitOrWiggle(u2);
          parameterAnimator.initialize(
            0, 1, all5? [5000, 500] : [1000, 500], (f) => {
            drawAll(wig0(f), wig1(f), wig2(f), all5);
          }).play();
        }
        // utrue = 0.71257, 0.47514, 0.38169
        skyAnimator.chain(1000).chain(() => {
          sceneUpdater.drawLOS(0, jds[0], true);
          scene3d.render();
          sceneUpdater.updateDate(jds[0]);
          skyAnimator.playChain();
        }).chain(1000).chain(() => {
          sceneUpdater.centerVisibility(false, true);
          sceneUpdater.showOrbit("mars", 0.25);
          drawAll(0.4, 0.6, 0.2);
          skyAnimator.playChain();
        }).chain(500).chain(() => {
          drawWiggles([0.4, 0.7, 0.55], 0.6, 0.2);
        }).chain(500).chain(() => {
          drawWiggles(0.55, [0.6, 0.35, 0.43], 0.2);
        }).chain(500).chain(() => {
          drawWiggles(0.55, 0.43, [0.2, 0.45, 0.35]);
        }).chain(2000).chain(() => {
          toggleAreaLegend(true);
          drawAll(0.55, 0.43, 0.35, true);
          skyAnimator.playChain();
        }).chain(3000).chain(() => {
          drawWiggles([0.55, 0.75, utrue[0]],
                      [0.43, 0.50, utrue[1]],
                      [0.35, 0.42, utrue[2]], true);
        }).chain(2000).chain(() => {
          if (textToggled) toggleText("1");
          skyAnimator.playChain();
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 20: Kepler's Third Law
        resetScene("free", noDelay);
        sceneUpdater.labels.earth.visible = true;
        const camera = scene3d.camera;
        camera.up.set(1, 0, 0);
        camera.position.set(0, 5.2, 0);
        camera.lookAt(0, 0, 0);
        scene3d.setSize(undefined, undefined, helioFov);
        ["mercury", "venus", "earth", "mars", "jupiter", "saturn"].forEach(
          planet => {
            const v = sceneUpdater.orbits[planet];
            v.visible = true;
            setColorMultiplier(v, 0.25);
          });
        sceneUpdater.egrp.visible = false;
        sceneUpdater.eqgrp.visible = false;
        sceneUpdater.ecLabel.visible = false;
        sceneUpdater.eqLabel.visible = false;
        scene3d.render();
        skyAnimator.chain(() => {
          skyAnimator.msEase(1000);
          skyAnimator.playFor(6*365.25636);
        });
        if (noDelay) skyAnimator.playChain();
      },

      (noDelay) => {  // page 21: Ready for Newton
        resetScene("free", noDelay);
        sceneUpdater.labels.earth.visible = true;
        const camera = scene3d.camera;
        camera.up.set(1, 0, 0);
        camera.position.set(0, 5.2, 0);
        camera.lookAt(0, 0, 0);
        scene3d.setSize(undefined, undefined, helioFov);
        ["mercury", "venus", "earth", "mars", "jupiter", "saturn"].forEach(
          planet => {
            const v = sceneUpdater.orbits[planet];
            v.visible = true;
            setColorMultiplier(v, 0.25);
          });
        sceneUpdater.egrp.visible = false;
        sceneUpdater.eqgrp.visible = false;
        sceneUpdater.ecLabel.visible = false;
        sceneUpdater.eqLabel.visible = false;
        scene3d.render();
        function easer(x) {
          let y;
          if (x < 0.1) {
            y = x**2;
          } else if (x < 0.9) {
            y = 0.01 + 0.2*(x - 0.1);
          } else {
            y = 0.18 - (1 - x)**2;
          }
          return y / 0.18;
        }
        function altCamera(xyzPlanets) {
          let djd = xyzPlanets.jd - xyzPlanets.jd0;
          let jdStep = 365.25636;
          djd -= jdStep;
          if (djd < 0) return;
          if (djd < jdStep) {
            camera.position.set(0, 5.2 + (35-5.2)*djd/jdStep, 0);
            return;
          }
          djd -= 2*jdStep;
          if (djd < 0) return;
          if (djd < jdStep) {
            let f = easer(djd / jdStep);
            let ang = f * Math.PI/2;
            let [c, s] = [Math.cos(ang), Math.sin(ang)];
            let r = 25*f + 35*(1-f);
            camera.position.set(-r*s, r*c, 0);
            camera.up.set(c, s, 0);
            camera.lookAt(0, 0, 0);
            return;
          }
          djd -= 1.2*jdStep;
          if (djd < 0) return;
          if (djd < jdStep) {
            camera.position.set(-25 + (25 - 4)*djd/jdStep, 0, 0);
            return;
          }
          djd -= jdStep;
          if (djd < 0) return;
          if (djd < 3*jdStep) {
            let f = easer(djd / (3*jdStep));
            let ang = f * 2*Math.PI;
            let [c, s] = [Math.cos(ang), Math.sin(ang)];
            camera.position.set(-4*c, 0, 4*s);
            camera.lookAt(0, 0, 0);
            return;
          }
          djd -= 3*jdStep;
          if (djd < 0) return;
          if (djd < 3*jdStep) {
            let f = easer(djd / (3*jdStep));
            let ang = f * 2*Math.PI;
            let [c, s] = [Math.cos(ang), Math.sin(ang)];
            ang = f * Math.PI/6;
            let [c2, s2] = [Math.cos(ang), Math.sin(ang)];
            camera.position.set(-4*c*c2, 4*s2, 4*s*c2);
            camera.lookAt(0, 0, 0);
            return;
          }
          djd -= 3.2*jdStep;
          if (djd < 0) return;
          if (djd < jdStep) {
            let f = easer(djd / jdStep);
            let ang0 = Math.PI/6;
            let ang = f * Math.PI/3;
            let [c, s] = [Math.cos(ang0+ang), Math.sin(ang0+ang)];
            let r = 5.2*f + 4*(1-f);
            camera.position.set(-r*c, r*s, 0);
            camera.up.set(c, s, 0);
            camera.lookAt(0, 0, 0);
            return;
          }
        }
        skyAnimator.chain(() => {
          sceneUpdater.altCamera = altCamera;
          skyAnimator.msEase(1000);
          skyAnimator.playFor(14*365.25636);
        });
        if (noDelay) skyAnimator.playChain();
      }
    ];

    // gotoPage will resetAnimators() before calling exit,
    // but pageExit can often be a noop.
    const noop = () => {};
    this.pageExit = [
      noop,  // exit page 0 Seeing the Solar System
      noop,  // exit page 1 First study how the Sun moves
      noop,  // exit page 2 Sun's motion is non-uniform but periodic
      noop,  // exit page 3 Venus zig-zags about the Sun
      noop,  // exit page 4 Visualize Venus's orbit
      noop,  // exit page 5 Find the orbital plane of Venus
      noop,  // exit page 6 Venus is to Earth as Earth is to Mars
      noop,  // exit page 7 Visualize Earth's orbit
      noop,  // exit page 8 How to find the Sun-Mars direction
      noop,  // exit page 9 Opposition is the best reference time
      noop,  // exit page 10 Begin surveying Earth's orbit!
      noop,  // exit page 11 Adopt the heliocentric view
      noop,  // exit page 12 Survey a second point on Mars's orbit
      noop,  // exit page 13 Survey more points on Mars's orbit
      noop,  // exit page 14 Fly around orbits of Earth and Mars
      noop,  // exit page 15 Orbits are nearly eccentric circles
      noop,  // exit page 16 Kepler's First Law
      noop,  // exit page 17 Earth moves faster when closer to Sun
      noop,  // exit page 18 Kepler's Second Law
      noop,  // exit page 19 Use Kepler's Laws to survey other orbits
      noop,  // exit page 20: Kepler's Third Law
      noop  // exit page 21: Kepler's Laws set the stage for Newton
    ];

    const helioFov = 36;  // fit Mars orbit for -3000-01-01

    // Note: findOpposition will always get an opposition near perigee here.
    // The reason is that findBestOrbitView will always select a Sun-Mars
    // direction looking near the perigee of Mars's orbit, so that the
    // nearest opposition will also be near there.
    // This is actually an advantage in planning some of the fly around
    // animations, since you don't have to worry about coordinate singularities
    // for every possible position of the jdOpp point.
    function helioInit(noDelay) {
      sceneUpdater.recenterEcliptic();
      let [xc, yc, zc] = sceneUpdater.cameraDirection();
      resetScene("mars", noDelay);
      sceneUpdater.lookAlong(xc, yc, zc);
      sceneUpdater.initializeRing("mars", xyzNow, true, true);
      sceneUpdater.showSpokes();
      sceneUpdater.egrp.visible = false;
      sceneUpdater.eqgrp.visible = false;
      sceneUpdater.ecLabel.visible = false;
      sceneUpdater.eqLabel.visible = false;
      const jdNow = xyzNow.jd;
      const [jdOpp, iOpp] = sceneUpdater.findOpposition();
      xyzNow.update(jdOpp);
      sceneUpdater.labels.sunmars.visible = false;
      sceneUpdater.labels.antisun.visible = false;
      const myear = periodOf("mars", jdOpp);
      const re0 = glPlanetPosition("earth", jdOpp);
      let rsm = glPlanetPosition("mars", jdOpp + iOpp*myear).map(
        (v, i) => v + re0[i]);
      let rs = glPlanetPosition("earth", jdOpp + iOpp*myear).map(
        (v, i) => re0[i] - v);
      let rm = glPlanetPosition("mars", jdOpp + iOpp*myear).map(
        (v, i) => v + rs[i]);
      [xc, yc, zc] = sceneUpdater.cameraDirection();
      let rc = Math.sqrt(xc**2 + zc**2);
      let [xcn, zcn] = [xc/rc, zc/rc];
      const vec1 = [-4*xcn, 0.4, -4*zcn];
      const rvec1 = Math.sqrt(vec1[0]**2 + vec1[1]**2 + vec1[2]**2);
      // const [c, s] = [Math.cos(1.4), Math.sin(1.4)];
      // const vec2 = [-2*(xcn*c + zcn*s), 8, -2*(zcn*c - xcn*s)];
      const vec2 = [0, 5.2, 0];
      return [jdOpp, vec1, vec2, re0, rsm, iOpp];
    }

    function helioSetup(jdOpp) {
      sceneUpdater.hideSpokes();
      sceneUpdater.hideRing("mars");  // makes all planets visible (sigh)
      for (let p of ["sun", "mercury", "earth", "venus", "mars",
                     "jupiter", "saturn"]) {
        sceneUpdater.planets[p].visible = false;
      }
      sceneUpdater.showOrbit("sun", 0.25);
      sceneUpdater.syncTriangles(jdOpp, 1);
      sceneUpdater.triangles.visible = true;
    }

    function topViewSetup(noDelay, full) {
      let [jdOpp, vec1, vec2, re0, rsm, iOpp] = helioInit(noDelay);
      const camera = scene3d.camera;
      helioSetup(jdOpp);
      sceneUpdater.hideOrbit("sun", 0.25);
      sceneUpdater.showOrbit("earth", 0.25);
      camera.up.set(1, 0, 0);
      camera.position.set(...vec2);
      camera.lookAt(0, 0, 0);
      scene3d.setSize(undefined, undefined, helioFov);
      if (full) {
        year = periodOf("earth", jdOpp);
        const myear = periodOf("mars", jdOpp);
        sceneUpdater.triangles.visible = false;
        sceneUpdater.orbitPoints.top.visible = true;
        sceneUpdater.drawEarthPoints(jdOpp, myear);
        sceneUpdater.showOrbit("mars", 0.25);
        const xstep = 2*year - myear;
        const djds = [0, year, -xstep, -2*xstep, -3*xstep,
                      xstep, 2*xstep, 3*xstep,
                      year-xstep, year-2*xstep, year-3*xstep, year-4*xstep,
                      year+xstep, year+2*xstep, year+3*xstep];
        for (let i=0 ; i < 15; i += 1) {
          sceneUpdater.drawMarsPoint(i, jdOpp+djds[i]);
        }
        scene3d.render();
        sceneUpdater.updateDate(jdOpp);
      }
      return [jdOpp, vec1, vec2, re0, rsm, iOpp];
    }

    function getLoc(obj) {
      const p = obj.position;
      return [p.x, p.y, p.z];
    }

    function cosAngle([ax, ay, az], [bx, by, bz]) {
      const rr = Math.sqrt((ax**2 + ay**2 + az**2)*(bx**2 + by**2 + bz**2));
      return (ax*bx + ay*by + az*bz) / rr;
    }

    const cosLimit = -Math.cos(Math.PI/12.);  // 15 degrees

    function goodMarsTriangle(i, nsteps) {
      const orbitPoints = sceneUpdater.orbitPoints;
      const rs = [0, 0, 0];
      const rm = getLoc(orbitPoints.mars.children[i]);
      let re = orbitPoints.earth.children.map(c => getLoc(c));;
      if (nsteps >= 0) {
        re = re.slice(nsteps);
      } else {
        re = re.slice(0, nsteps);
      }
      // reject points where Mars within 15 degrees of Sun.
      re = re.filter((re) => cosAngle(re, rm) >= cosLimit);
      re = re.map(v => [rm[0]*v[2] - rm[2]*v[0], v]).sort(
        (a, b) => a[0] - b[0]).map(v => v[1]);
      const triangle = sceneUpdater.triangle;
      scene3d.movePoints(triangle, [rm, re[0], re[re.length-1], rm]);
      triangle.visible = true;
    }

    function viewDirection([x1, y1, z1], msMove) {
      const camera = scene3d.camera;
      let {x: x0, y: y0, z: z0} = camera.position;
      let r0 = Math.sqrt(x0**2 + y0**2 + z0**2);
      let r1 = Math.sqrt(x1**2 + y1**2 + z1**2);
      [x0, y0, z0, x1, y1, z1] = [x0/r0, y0/r0, z0/r0, x1/r1, y1/r1, z1/r1];
      // rotate e0 to e1 in their plane
      // (e1.dot.e0)e0 is projection of e1 onto e0
      // e1 - (e1.dot.e0)e0 is perpendicular to e0 in (e1,e0) plane
      let dot = x1*x0 + y1*y0 + z1*z0;
      let [x, y, z] = [x1 - dot*x0, y1 - dot*y0, z1 - dot*z0];
      let r = Math.sqrt(x**2 + y**2 + z**2);
      [x, y, z] = [x/r, y/r, z/r];
      let ang = Math.acos(dot);
      [x0, y0, z0, x, y, z] = [x0*r0, y0*r0, z0*r0, x*r0, y*r0, z*r0];
      parameterAnimator.initialize(0, ang, [msMove-600, 300], (a) => {
        const [c, s] = [Math.cos(a), Math.sin(a)];
        cameraTo(x0*c + x*s, y0*c + y*s, z0*c + z*s);
        scene3d.render();
      }).play();
    }

    function cameraTo(x, y, z) {
      const camera = scene3d.camera;
      camera.position.set(x, y, z);
      let r = Math.sqrt(x**2 + y**2 + z**2);
      let s = y / r;
      let c = Math.sqrt(1 - s*s);
      camera.up.set(s*s, c*c, 0);  // arbitrary, smooth derivative
      camera.lookAt(0, 0, 0);
    }

    function viewZoom(factor, msMove) {
      const camera = scene3d.camera;
      let {x: x0, y: y0, z: z0} = camera.position;
      parameterAnimator.initialize(1, factor, msMove, (fac) => {
        camera.position.set(x0/fac, y0/fac, z0/fac);
        scene3d.render();
      }).play();
    }

    function getOrbits(jdOpp, re0, drawRadius) {
      let [xe, ye, , e, ae, be] = orbitParams("earth", jdOpp + 3652.5);
      // ecliptic (x, y, z) is webGL (z, x, y)
      xe = [1, 2, 0].map(i => xe[i]);
      ye = [1, 2, 0].map(i => ye[i]);
      let [cex, cey, cez] = xe.map(v => -e*ae*v);
      let xm, ym, am, bm;
      [xm, ym, , e, am, bm] = orbitParams("mars", jdOpp + 3652.5);
      xm = [1, 2, 0].map(i => xm[i]);
      ym = [1, 2, 0].map(i => ym[i]);
      let [cmx, cmy, cmz] = xm.map(v => -e*am*v);
      re0 = [re0[0] - cex, re0[1] - cey, re0[2] - cez];
      const ang0e = Math.atan2(dot(re0, ye), dot(re0, xe));
      let rsm = glPlanetPosition("mars", jdOpp);  // re0 is Earth at jdOpp
      rsm = [rsm[0] - cmx, rsm[1] - cmy, rsm[2] - cmz];
      const ang0m = Math.atan2(dot(rsm, ym), dot(rsm, xm));
      const re = 0.5*(ae + be);  // min-max
      const rm = 0.5*(am + bm);  // min-max
      sceneUpdater.centerVisibility(true);
      sceneUpdater.setCenter("earth", cex, cey, cez, drawRadius);
      sceneUpdater.setCenter("mars", cmx, cmy, cmz, drawRadius);
      scene3d.render();
      return [cex, cey, cez, re, cmx, cmy, cmz, rm, xe, ye, xm, ym,
              ang0e, ang0m];
    }

    // Return normal to plane of 0 and two vectors, or if more than
    // two vectors, return the average of normals of successive pairs.
    function planeOf(...vectors) {
      let total, len;
      let prev = vectors.shift();
      for (let v of vectors) {
        let p = cross(prev, v);
        len = norm(p);
        p = p.map(v => v/len);
        if (total === undefined) {
          total = p;
        } else {
          if (dot(total, p) < 0) p = p.map(v => -v);
          total = p.map((v, i) => total[i] + v);
        }
        prev = v;
      }
      len = norm(total);
      return total.map(v => v/len);
    }

    // Find ellipse with focus at 0 given three (coplanar) points.
    function ellipseOf(p0, p1, p2) {
      let zAxis = planeOf(p0, p1, p2);
      let xAxis = project([0, 0, 1], zAxis);
      let r = norm(xAxis);
      xAxis = xAxis.map(v => v/r);
      let yAxis = cross(zAxis, xAxis);
      let [p0x, p0y] = [dot(p0, xAxis), dot(p0, yAxis)];
      let [p1x, p1y] = [dot(p1, xAxis), dot(p1, yAxis)];
      let [p2x, p2y] = [dot(p2, xAxis), dot(p2, yAxis)];
      p0 = Math.sqrt(p0x**2 + p0y**2);
      p1 = Math.sqrt(p1x**2 + p1y**2);
      p2 = Math.sqrt(p2x**2 + p2y**2);
      //  (p1x-p0x)*ecx + (p1y-p0y)*ecy = p1 - p0
      //  (p2x-p1x)*ecx + (p2y-p1y)*ecy = p2 - p1
      let [mxx, mxy, myx, myy] = [p1x-p0x, p1y-p0y, p2x-p1x, p2y-p1y];
      let [bx, by] = [p1-p0, p2-p1];
      let det = mxx*myy - mxy*myx;
      let [ecx, ecy] = [(myy*bx - mxy*by)/det, (mxx*by - myx*bx)/det];
      let b = ecx**2 + ecy**2;  // just a temporary for now
      let e = Math.sqrt(b);  // eccentricity
      b = 1 - b;  // now 1-e**2
      let a = (p0 - (ecx*p0x + ecy*p0y))/b;  // = p1-ec.dot.p1 = p2-ec.dot.p2
      b = a * Math.sqrt(b);  // e, a, b now eccentricity and semi-axes
      if (e) {
        // make xAxis be in -ec direction, i.e.- toward perihelion
        xAxis = xAxis.map((v, i) => (-ecx*v - ecy*yAxis[i])/e);
        yAxis = cross(zAxis, xAxis);
      }
      return [xAxis, yAxis, zAxis, e, a, b];
    }

    function pointOnEllipse([xAxis, yAxis, zAxis, e, a, b], earth, plos) {
      // Assume xAxis, yAxis, zAxis in GL coordinates, not orbitParams!
      // First project earth and plos into plane of ellipse.
      earth = project(earth, zAxis);
      plos = project(plos, zAxis);
      // Convert to ellipse (x, y) coordinates, scaled and translated
      // to make ellipse a unit circle centered at (0, 0).
      let [ex, ey] = [dot(earth, xAxis)/a + e, dot(earth, yAxis)/b];
      let [px, py] = [dot(plos, xAxis)/a + e, dot(plos, yAxis)/b];
      let [dx, dy] = [px - ex, py - ey];
      // If f>0 is the fraction of the distance from e to p of intersection,
      // then (ex + f*dx)**2 + (ey + f*dy)**2 = 1
      // (dx**2+dy**2)*f**2 + 2*(ex*dx+ey*dy)*f + (ex**2+ey**2) - 1 = 0
      // Assume e inside ellipse, so that ex**2+ey**2 < 1.
      let aa = dx**2 + dy**2;
      let bb = ex*dx + ey*dy;
      let cc = 1 - (ex**2 + ey**2);  // > 0
      if (cc <= 0) return [null, -1];
      let dd = Math.sqrt(bb**2 + aa*cc);  // > abs(bb)
      let f = (bb < 0)? (dd - bb) / aa : cc / (dd + bb);
      [px, py] = [ex + f*dx, ey + f*dy];
      [px, py] = [(px - e)*a, py*b];  // restore origin and scale
      // put back in original coordinates
      let p = xAxis.map(v => px*v);
      p = yAxis.map(v => py*v).map((v, i) => v + p[i]);
      return [p, f];  // point and fraction
    }

    function pointOnLOS(earth, plos, u) {
      plos = plos.map((v, i) => v - earth[i]);
      let r = norm(plos);
      plos = plos.map(v => v*u/r);
      return plos.map((v, i) => v + earth[i]);
    }

    function drawMarsGuess(...p) {
      const mars = sceneUpdater.orbitPoints.mars.children;
      let spokes = sceneUpdater.orbitPoints.marsSpokes;
      const drawSpoke = spokes.visible;
      if (drawSpoke) spokes = spokes.children;
      for (let i = 0; i < p.length; i += 1) {
        if (p[i] !== null) {
          mars[i].visible = true;
          mars[i].position.set(...p[i]);
          if (drawSpoke) scene3d.movePoints(spokes[i], [[0, 0, 0], p[i]]);
        } else {
          spokes[i].visible = false;
        }
      }
    }

    function drawEllipse(p0, p1, p2, e3, m3, e4, m4) {
      let ell = ellipseOf(p0, p1, p2);
      let [xAxis, yAxis, zAxis, e, a, b] = ell;
      let c = xAxis.map(v => -e*a*v);
      sceneUpdater.setCenter("mars", c[0], c[1], c[2], false);
      sceneUpdater.orbits.mars.matrix = xyzNow.ellipse(ell);
      let spokes = sceneUpdater.orbitPoints.marsSpokes;
      let p = [p0, p1, p2];
      if (e3 !== undefined) {
        let i;
        spokes.visible = true;
        spokes = spokes.children;
        for (i = 0; i < spokes.length; i += 1) {
          spokes[i].visible = i < 5;
        }
        p.push(pointOnEllipse(ell, e3, m3)[0], pointOnEllipse(ell, e4, m4)[0]);
        let areas = getAreas(ell, p);
        for (i = 0; i < 4; i += 1) {
          if (areas[i] === null) continue;
          if (areas[i+1] === null) areas[i] = null;
          else areas[i] = areas[i+1] - areas[i];
        }
        areas.pop();
        setAreaLegend(...areas);
      } else {
        spokes.visible = false;
      }
      drawMarsGuess(...p);
      scene3d.render();
    }

    function getAreas([xAxis, yAxis, zAxis, e, a, b], points) {
      let area0 = 0.5*a*b;
      let x, y, areas = [];
      for (let p of points) {
        if (p !== null) {
          [x, y] = [dot(p, xAxis)/a + e, dot(p, yAxis)/b];
          areas.push(area0*(Math.atan2(y, x) - e*y));
        } else {
          areas.push(null);
        }
      }
      area0 = Math.PI*a*b;
      for (let i = 1 ; i < areas.length; i += 1) {
        if (areas[i] === null) break;
        if (areas[i] < areas[i-1]) areas[i] += area0;
      }
      return areas;
    }

    function project(p, n, normalize) {
      // project point p into plane normal to n
      if (normalize) {
        const r = norm(n);
        n = n.map(v => v/r);
      }
      const pdotn = dot(p, n);
      return p.map((v, i) => v - pdotn*n[i]);
    }

    function norm([x, y, z]) {
      return Math.sqrt(x**2 + y**2 + z**2);
    }

    function dot([a, b, c], [x, y, z]) {
      return a*x + b*y + c*z;
    }

    function cross([a, b, c], [x, y, z]) {
      return [b*z - c*y, c*x - a*z, a*y - b*x];
    }
  }

  gotoPage(i, noDelay) {
    const {topPages, botPages, iPage, pageup, pagedn} = this;
    const mxPage = botPages.length - 1;
    if (i === undefined) i = iPage;
    if (i < 0) i += mxPage + 1;
    if (i < 0 || i > mxPage) return;
    topPages[iPage].classList.add("hidden");
    botPages[iPage].classList.add("hidden");
    topPages[i].classList.remove("hidden");
    botPages[i].classList.remove("hidden");
    this.iPage = i;
    if (iPage == mxPage) this.pagedn.classList.remove("disabled");
    else if (iPage == 0) this.pageup.classList.remove("disabled");
    if (i == mxPage) this.pagedn.classList.add("disabled");
    else if (i == 0) this.pageup.classList.add("disabled");
    const pageExit = this.pageExit[iPage];
    const pageEnter = this.pageEnter[i];
    resetAnimators();
    if (noDelay) showPlay(false);
    if (pageExit) pageExit();
    if (pageEnter) pageEnter(noDelay);
  }

  replay() {
    this.gotoPage(undefined, true);
  }

  next() {
    this.gotoPage(this.iPage + 1);
  }

  prev() {
    let iPage = this.iPage;
    if (iPage == 0) return;
    this.gotoPage(this.iPage - 1);
  }

  step(delta) {
    if (skyAnimator.isPlaying && skyAnimator.isPaused && delta) {
      xyzNow.update(xyzNow.jd + delta);
      scene3d.render();
    }
  }
}

const TOP_BOX = document.getElementById("topbox");
const BOT_BOX = document.getElementById("botbox");

const pager = new Pager(TOP_BOX, BOT_BOX,
                        document.getElementById("pageup"),
                        document.getElementById("pagedn"));

const SUN_COUNTER = document.getElementById("sun-counter");
const MAR_SEP = document.getElementById("mar-sep");
const SEP_MAR = document.getElementById("sep-mar");
const AREA_LEGEND = document.getElementById("area-legend");
const AREA_ITEMS = AREA_LEGEND.querySelectorAll("ul li");

function toggleAreaLegend(visible) {
  const classList = AREA_LEGEND.classList;
  if (visible) classList.remove("hidden");
  else classList.add("hidden");
}

function setAreaLegend(a0, a1, a2, a3) {
  const areas = [a0, a1, a2, a3];
  for (let i = 0; i < 4; i += 1) {
    if (areas[i] !== null) {
      AREA_ITEMS[i].innerHTML = areas[i].toFixed(4);
    } else {
      AREA_ITEMS[i].innerHTML = "-";
    }
  }
}

/* ------------------------------------------------------------------------ */

function date4jd(jd) {
  let date = dateOfDay(jd);
  return (date.getFullYear() + "<br>" +
          ("0" + (1+date.getMonth())).slice(-2) + "-" +
          ("0" + date.getDate()).slice(-2));
}

function jd4date(text) {
  let parts = text.split("-");
  const minus = parts[0] == "";
  if (minus) parts = parts.slice(1);
  parts = parts.map((v) => parseInt(v));
  if (minus) parts[0] = -parts[0];
  const date = new Date();
  date.setFullYear(parts[0]);
  date.setMonth((parts.length>1)? parts[1]-1 : 0);
  date.setDate((parts.length>2)? parts[2] : 1);
  return dayOfDate(date);
}

const _dummyVector = new Vector3();

/* ------------------------------------------------------------------------ */

class SkyAnimator extends Animation {
  constructor(scene3d, xyzNow, daysPerSecond) {
    super(dms => {
      let stop = self.step(dms);
      if (stop && self._chain.length) {
        const callback = self._chain.shift();
        setTimeout(() => callback(self), 0);
      } else if (stop) {
        runIndicator(false);
      }
      return stop;
    });
    let self = this;
    // this.neverStop = true;  // stop same as pause
    this.scene3d = scene3d;
    this.xyzNow = xyzNow;
    this.jdRate(daysPerSecond);
    this._msEase = 0;
    this._ms = 0;
    this._chain = [];
  }

  msEase(ms=0) {
    this._msEase = ms;
    this._ms = this._msEase;
    delete this._msStart;
    return this;
  }

  // must call after msEase and jdRate, msStop() to turn off
  msStop(ms) {
    const msEase = this._msEase;
    if (ms === undefined) {
      delete this._msStart;
      this._ms = this.isPaused? 0 : msEase;
      return;
    } else if (ms <= 0) {
      this.pause();
      delete this._msStart;
      return;
    }
    let msStart = ms - msEase;
    if (this.isPaused) {
      this._msStart = (msStart < msEase)? ms/2 : msStart;
      this._ms = 0;
    } else {
      this._msStart = msEase + msStart;
      this._ms = msEase;
    }
    return this;
  }

  jdRate(jdPerSecond=40) {
    this._jdRate = 0.001 * jdPerSecond;  // days per millisecond
    this._ms = this._msEase;
    delete this._msStart;
    return this;
  }

  // must call after msEase and jdRate, jdStop() to turn off
  jdStop(jd, absolute=false) {
    if (jd === undefined) return this.msStop();
    if (absolute) jd -= this.xyzNow.jd;
    let ms = jd / this._jdRate;  // final answer when msEase = 0
    if (jd > 0) {  // else pass non-positive ms to msStop to pause immediately
      const msEase = this._msEase;
      if (msEase) {
        if (this.isPaused) {  // acceleration + deceleration
          if (ms >= msEase) {
            ms += msEase;
          } else {
            ms = 2 * Math.sqrt(ms * msEase);
          }
        } else {  // deceleration only
          if (ms >= 0.5*msEase) {
            ms += 0.5*msEase;
          } else {
            ms = Math.sqrt(2 * ms * msEase);
          }
        }
      }
    }
    return this.msStop(ms);
  }

  step(dms) {
    if (dms <= 0) {
      this._ms = 0;
      this.xyzNow.update(this.xyzNow.jd);
      this.scene3d.render();
      return false;
    }
    let ms = this._ms;
    if (!ms) this._jd0 = 0;
    const jdRate = this._jdRate;
    const msEase = this._msEase;
    let hacc = msEase? 0.5*jdRate/msEase : 0;
    let msStart = this._msStart;
    const noStart = msStart === undefined;
    const msPart = (noStart || msStart >= msEase)? msEase : msStart;
    ms += dms;
    //      0 <= ms < msPart            acceleration phase
    // msPart <= ms <= msStart          coast phase
    // msStart < ms <= msStart+msPart   deceleration phase
    let stop = ms >= msPart;
    let jd = hacc * (stop? msPart : ms)**2
    if (stop) {
      stop = !noStart && ms >= msStart;
      jd += jdRate*((stop? msStart : ms) - msPart);
      if (stop) {
        let mms = msStart + msPart - ms;
        stop = mms <= 0;
        if (stop) mms = 0;
        jd += hacc*(msPart + mms)*(msPart - mms);
      }
    }
    this._ms = ms;
    const jd0 = this._jd0;
    this._jd0 = jd;
    jd -= jd0;
    this.xyzNow.update(this.xyzNow.jd + jd);
    this.scene3d.render();
    if (this.syncSky) {
      const keep = this.syncSky(stop);
      if (stop && !keep) delete this.syncSky;
    }
    if (stop) {
      delete this._msStart;
      this._ms = 0;
    }
    return stop;
  }

  playFor(djd) {
    if (djd > 0) {
      this.jdStop(djd);
      if (this.isPaused) this.play();
    }
    return this;
  }

  playUntil(jd) {
    return this.playFor(jd - this.xyzNow.jd);
  }

  cancelTimeout() {
    let id = this._timeout;
    if (id !== undefined) {
      delete this._timeout;
      clearTimeout(id);
    }
    return this;
  }

  // callback can be pause time in ms or callback(this skyAnimator)
  chain(callback) {
    if (Number.isFinite(callback)) {
      if (callback <= 0) return this;
      const _chain = this._chain;
      const time = callback;
      callback = () => {
        this.cancelTimeout();
        this._timeout = setTimeout(() => {
          if (_chain.length) _chain.shift()(this);
          else runIndicator(false);
        }, time);
      };
    }
    this._chain.push(callback);
    return this;
  }

  playChain() {
    this.cancelTimeout();  // clear pending timeouts as well
    if (this._chain.length) {
      const callback = this._chain.shift();
      setTimeout(() => callback(this), 0);
      runIndicator(true);
    } else {
      runIndicator(false);
    }
    return this;
  }

  clearChain() {
    this.cancelTimeout();  // clear pending timeouts as well
    this._chain.length = 0;  // NOT = []; timeouts hold copies of _chain
    return this;  // anim.clearChain().stop() to abort a chain
  }

  playLoop(djd) {
    const xyzPlanets = this.xyzNow;
    const jdStart = xyzPlanets.jd;
    this.clearChain();
    this.playFor(djd).chain(1000).chain((self) => {
      xyzPlanets.update(jdStart);
      self.playLoop(djd);
    });
    return this;
  }
}

const skyAnimator = new SkyAnimator(scene3d, xyzNow, 40);

class ParameterAnimator extends Animation {
  constructor() {
    super((dms) => {
      if (this._worker) return this._worker(dms);
      else return true;
    });
  }

  // Note that default onFinish is to unpause or playChain skyAnimator.
  // You can supress this behavior by having onFinish return true.
  // The skyAnimator is paused before funp(p0) is called.
  initialize(p0, p1, msDelta, funp, onFinish) {
    if (funp === undefined) {
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
      if (dms == 0 && !skyAnimator.isPaused) skyAnimator.pause();
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
      funp(p);
      if (stop) {
        if (onFinish && onFinish.call(this)) return;
        if (skyAnimator.isPlaying) skyAnimator.play();
        else skyAnimator.playChain();
      }
      return stop;
    }
    return this;
  }
}

// Only one parameter animator so it can be reset.
const parameterAnimator = new ParameterAnimator();

/* ------------------------------------------------------------------------ */

const controls = new SkyControls(scene3d.camera, scene3d.canvas);
controls.addEventListener("change", () => {
  scene3d.render();
});

const solidLine = scene3d.createLineStyle({color: 0x335577, linewidth: 2});
const dashedLine = scene3d.createLineStyle({
  color: 0x335577, linewidth: 3,
  dashed: true, dashScale: 1.5, dashSize: 10, gapSize: 10});
const textureMaps = loadTextureFiles(
  [["starmap_2020_4k_rt.png",
    "starmap_2020_4k_lf.png",
    "starmap_2020_4k_tp.png",
    "starmap_2020_4k_bt.png",
    "starmap_2020_4k_fr.png",
    "starmap_2020_4k_bk.png"],  // sky cube background
   "sun-alpha.png", "planet-alpha.png"],  // sprites
  ()  => setupSky(),
  "images/");
let initialPage = 0;

function setupSky() {
  document.querySelector(".lds-spinner").style.display = "none";
  // See https://svs.gsfc.nasa.gov/4851
  // Converted with exrtopng from http://scanline.ca/exrtools/ then
  // equirectangular to cubemap using images/starmapper.py script in this repo.
  // The starmapper script will also produce equitorial and galactic
  // coordinate oriented cubes.

  scene3d.setBackground(textureMaps[0], 0.6);
  // 0.3-0.4 fades to less distracting level

  // This scheme allows for ecliptic, equator, and their poles to be easily
  // adjusted from J2000 epoch to any given date:
  // (1) Set eqgrp.rotation.z to minus obliquity of date
  // (2) Reset egrp rotation, then rotate by minus precession around y,
  //     then rotate by (small) inclination about line of nodes.
  const egrp = scene3d.group();
  const ecliptic = scene3d.polyline(pointsOnCircle(24, 1000), solidLine, egrp);
  const poleMarks = scene3d.segments(
    [-30, 1000, 0,  30, 1000, 0, 0, 1000, -30,  0, 1000, 30,
     -30,-1000, 0,  30,-1000, 0, 0,-1000, -30,  0,-1000, 30], solidLine, egrp);
  const eqgrp = scene3d.group(egrp);
  const equator = scene3d.polyline(ecliptic, dashedLine, eqgrp);
  const qpoleMarks = scene3d.segments(poleMarks, dashedLine, eqgrp);
  eqgrp.rotation.z = -obliquity(xyzNow.jd0);
  sceneUpdater.egrp = egrp;
  sceneUpdater.eqgrp = eqgrp;

  const ecLabel = sceneUpdater.addText("ecliptic", {color: "#113366"});
  ecLabel.position.set(-7070, -180, 7070);
  const eqLabel = sceneUpdater.addText("equator", {color: "#113366"});
  eqLabel.position.set(-7070, 2900, 7070);
  sceneUpdater.ecLabel = ecLabel;
  sceneUpdater.eqLabel = eqLabel;

  // planets.sun = scene3d.createSprite(textureMaps[1], 0.6, 0xffffff);
  sceneUpdater.addPlanet("sun", textureMaps[1], 0.4, 0xffffff);

  const planetTexture = textureMaps[2];
  sceneUpdater.addPlanet("venus", planetTexture, 0.6, 0xffffff);
  sceneUpdater.addPlanet("mars", planetTexture, 0.6, 0xffaaaa);
  sceneUpdater.addPlanet("jupiter", planetTexture, 0.6, 0xffffff);
  sceneUpdater.addPlanet("saturn", planetTexture, 0.6, 0xffffaa);
  sceneUpdater.addPlanet("mercury", planetTexture, 0.4, 0xffffff);
  sceneUpdater.addPlanet("earth", planetTexture, 0.6, 0xaaaaff);

  sceneUpdater.addLabel("sun", {}, 2, 1.8);
  sceneUpdater.addLabel("venus", {}, 2, 1.25);
  sceneUpdater.addLabel("mars", {}, 2, 1.25);
  sceneUpdater.addLabel("anti-sun", {}, 2);
  sceneUpdater.addLabel("mean-sun", {}, 4, 0);
  sceneUpdater.addLabel("sun-mars", {}, 2);
  sceneUpdater.addLabel("mercury", {}, 2, 1.25);
  sceneUpdater.addLabel("jupiter", {}, 2, 1.25);
  sceneUpdater.addLabel("saturn", {}, 2, 1.25);
  sceneUpdater.addLabel("earth", {}, 2, 1.25);

  sceneUpdater.addRing("venus", 20);
  sceneUpdater.addRing("mars", 10);
  sceneUpdater.addTriangles(10);
  sceneUpdater.addOrbitPoints(10, 15, 12);
  sceneUpdater.addCenters();

  pager.gotoPage(initialPage);
}

function adjustEcliptic(jd) {
  let [incl, nlon] = eclipticOfDate(jd);
  let prec = precession(jd);
  let obl = obliquity(jd);
  const r2d = 180/Math.PI;
  // (1) Set eqgrp.rotation.z to minus obliquity of date
  // (2) Reset egrp rotation, then rotate by minus precession around y,
  //     then rotate by (small) inclination about line of nodes.
  sceneUpdater.eqgrp.rotation.z = -obl;
  const egrp = sceneUpdater.egrp;
  egrp.quaternion.set(0, 0, 0, 1);
  egrp.rotation.y = -prec;
  nlon += prec;  // ecliptic longitude of date slightly larger
  _dummyVector.set(Math.sin(nlon), 0, Math.cos(nlon));
  egrp.rotateOnAxis(_dummyVector, incl);
}

/* ------------------------------------------------------------------------ */

scene3d.onContextLost(() => {
  if (!maybePause()) return;
  return () => { togglePause(); }  // resume when context restored
});

window.scene3d = scene3d;
window.xyzNow = xyzNow;
window.sceneUpdater = sceneUpdater;
window.skyAnimator = skyAnimator;

/* ------------------------------------------------------------------------ */

const PRESS_TIMEOUT = 750;

STARDATE.addEventListener("pointerdown", (event) => {
  if (STARDATE.classList.contains("disabled")) return;
  const didPause = maybePause();  // pause immediately if playing
  if (sceneUpdater.mode == "sky" &&
      !sceneUpdater.freeCamera) sceneUpdater.recenterEcliptic();
  // Wait to test for for press and hold.
  const gotPointerup = (event) => {
    // Got pointerup before timeout, this is just a click.
    STARDATE.removeEventListener("pointerup", gotPointerup);
    const id0 = id;
    id = null;
    if (id0 === null) return;
    clearTimeout(id0);
    if (!didPause) togglePause();  // maybePause did nothing, so toggle now
  };
  SET_DATE.style.display = "grid";
  let id = setTimeout(() => {
    // Got timeout before pointer up, this is press and hold.
    id = null;
    STARDATE.removeEventListener("pointerup", gotPointerup);
    SET_DATE.style.transform = "scale(1)";
    const date = dateOfDay(xyzNow.jd0);
    YYYY.value = date.getFullYear();
    MMDD.value = ("0" + (1+date.getMonth())).slice(-2) + "-" +
      ("0" + date.getDate()).slice(-2);
  }, PRESS_TIMEOUT);
  STARDATE.addEventListener("pointerup", gotPointerup);
});

function maybePause() {
  if (parameterAnimator.isPlaying) {
    if (!parameterAnimator.isPaused) {
      parameterAnimator.pause();
      return true;
    }
  } else if (skyAnimator.isPlaying) {
    if (!skyAnimator.isPaused) {
      skyAnimator.pause();
      return true;
    }
  } else if (skyAnimator._timeout !== undefined) {
    skyAnimator.cancelTimeout();
    return true;
  }
  return false;
}

function togglePause() {
  showPlay(false);
  if (parameterAnimator.isPlaying) {
    if (parameterAnimator.isPaused) parameterAnimator.play()
    else parameterAnimator.pause();
  } else if (skyAnimator.isPlaying) {
    if (!skyAnimator.isPaused) skyAnimator.pause();
    else skyAnimator.play();
  } else {
    // prevent any pending timeout from waking up
    if (skyAnimator._timeout !== undefined) skyAnimator.cancelTimeout();  
    skyAnimator.playChain();
  }
}

/* ------------------------------------------------------------------------ */

const PLAY_BUTTON = document.getElementById("play");
function showPlay(yes=true) {
  PLAY_BUTTON.style.display = yes? "block" : "none";
  if (yes) runIndicator(false);
  else if (throbbing) stopThrobbing();
}
PLAY_BUTTON.addEventListener("click", () => {
  showPlay(false);
  skyAnimator.playChain();
});

const MAIN_MENU = document.getElementById("menu-bars");
MAIN_MENU.addEventListener("click", () => {
  if (throbbing) stopThrobbing();
  if (MAIN_MENU.classList.contains("disabled")) return;
  MENU_BODY.style.transform = "scale(1)";
});
let throbbing = true;
function stopThrobbing() {
  MAIN_MENU.classList.remove("throbbing");
  throbbing = false;
}

const MENU_BODY = document.getElementById("menu-body");
const CLOSE_MENU = document.getElementById("close-menu");
CLOSE_MENU.addEventListener("click", () => {
  MENU_BODY.style.transform = "scale(0)";
});

function toggleText(opacity) {
  if (getComputedStyle(HIDE_TEXT).display == "none") return;
  const opacNow = getComputedStyle(TOP_BOX).opacity;
  if (opacity == undefined) {
    opacity = (opacNow == "0")? "1" : "0";
  } else if (opacNow == opacity) {
    return false;
  }
  TOP_BOX.style.opacity = opacity;
  BOT_BOX.style.opacity = opacity;
  if (opacity == "0") HIDE_ICON.setAttribute("xlink:href", "#fa-plus");
  else HIDE_ICON.setAttribute("xlink:href", "#fa-xmark");
  return true;
}

const HIDE_TEXT = document.getElementById("hide-text");
const HIDE_ICON = document.querySelector("#hide-text > use");
HIDE_TEXT.addEventListener("click", () => {
  if (HIDE_TEXT.classList.contains("disabled")) return;
  if (throbbing) stopThrobbing();
  toggleText();
});

const PAGE_UP = pager.pageup;
PAGE_UP.addEventListener("click", () => {
  if (PAGE_UP.classList.contains("disabled")) return;
  if (throbbing) stopThrobbing();
  pager.prev();
});

const PAGE_DOWN = pager.pagedn;
PAGE_DOWN.addEventListener("click", () => {
  if (PAGE_DOWN.classList.contains("disabled")) return;
  if (throbbing) stopThrobbing();
  pager.next();
});

const REPLAY = document.getElementById("replay");
REPLAY.addEventListener("click", () => {
  if (REPLAY.classList.contains("disabled")) return;
  pager.replay();
});

function runIndicator(yes=true) {
  if (yes) {
    REPLAY.classList.add("highlighted");
    PAGE_UP.classList.add("highlighted");
    PAGE_DOWN.classList.add("highlighted");
  } else {
    REPLAY.classList.remove("highlighted");
    PAGE_UP.classList.remove("highlighted");
    PAGE_DOWN.classList.remove("highlighted");
  }
}

const SET_DATE = document.getElementById("set-date");
const YYYY = document.getElementById("base-year");
const MMDD = document.getElementById("base-date");
let sdState = 0;
SET_DATE.ontransitionend = () => {
  if (sdState) {
    sdState = 0;
    return;
  }
  sdState = 1;
  YYYY.focus();
  const value = YYYY.value;
  YYYY.value = "";  // hack to put cursor at end of initial text
  YYYY.value = value;
};
function setFocusTo(el) {
  el.focus();
  const value = el.value;
  el.value = "";  // hack to put cursor at end of initial text
  el.value = value;
}
function setBaseDate(buttonClick) {
  let date = dateOfDay(xyzNow.jd0);
  let bad = false;
  let value = YYYY.value;
  let y = Number(value);
  bad = isNaN(y) || !Number.isInteger(y) || (y.toString() != value);
  if (bad) {
    y = date.getFullYear();
    YYYY.focus();
    sdState = 1;
  } else if (y < -3000) {
    y = -3000;
  } else if (y > 3000) {
    y = 3000;
  }
  YYYY.value = y.toString();
  let md = MMDD.value.split("-");
  let [m, d] = (md.length == 2)? md.map(v => Number(v)) : [0, 0];
  if (isNaN(m) || !Number.isInteger(m) || isNaN(d) || !Number.isInteger(d) ||
      m < 1 || m > 12 || d < 1 || d > 31) {
    m = 1 + date.getMonth();
    d = date.getDate();
    if (!bad) {
      MMDD.focus();
      sdState = 2;
    }
    bad = true;
  }
  MMDD.value = ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2);
  if (sdState == 1 && !buttonClick) {
    setFocusTo(MMDD);
    sdState = 2;
    return true;
  }
  if (bad) return true;
  let jd = jd4date(YYYY.value + "-" + MMDD.value);
  xyzNow.update(jd, jd);
  sceneUpdater.updateOrbits(xyzNow, jd);
  pager.gotoPage();
  YYYY.blur();
  MMDD.blur();
  SET_DATE.style.transform = "scale(0)";
  return false;  // base date changed, dialog box taken down
}

window.setBaseDate = setBaseDate;  // used in index.html

addEventListener("keydown", (event) => {
  if (throbbing) stopThrobbing();
  if (event.target == YYYY || event.target == MMDD) {
    if (sdState == 0) return;
    if (event.key == "Enter") {
      setBaseDate();
      event.preventDefault();
    } else if (event.key == "Tab") {
      let active = document.activeElement;
      if (active == YYYY) {
        setFocusTo(MMDD);
      } else {
        setFocusTo(YYYY);
      }
      event.preventDefault();
    }
    return;
  }
  switch (event.key) {
  case " ":
  case "Spacebar":
    if (!STARDATE.classList.contains("disabled")) togglePause();
    break;
  case "PageUp":
  case "ArrowUp":
  case "Up":
    pager.prev();
    break;
  case "PageDown":
  case "ArrowDown":
  case "Down":
    pager.next();
    break;
  case "Backspace":
    pager.replay();
    break;
  case "ArrowLeft":
  case "Left":
    pager.step(-1);
    break;
  case "ArrowRight":
  case "Right":
    pager.step(1);
    break;
  case "Home":
    pager.gotoPage(0);
    break;
  case "End":
    pager.gotoPage(-1);
    break;
  case "X":
  case "x":
    if (MENU_BODY.getBoundingClientRect().height > 0) {
      MENU_BODY.style.transform = "scale(0)"
    } else {
      toggleText();
    }
    break;
  case "?":
    if (MENU_BODY.getBoundingClientRect().height > 0) {
      MENU_BODY.style.transform = "scale(0)"
    } else {
      MENU_BODY.style.transform = "scale(1)"
    }
    break;
  }
});

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {
  const FULLSCREEN_ICON = document.querySelector("#fullscreen > use");
  const classList = FULLSCREEN_ICON.parentElement.classList;
  
  const documentElement = document.documentElement;
  let fsElement, fsRequest, fsExit, fsChange;
  if ("fullscreenEnabled" in document) {  // standard Fullscreen API
    fsElement = "fullscreenElement";
    fsRequest = documentElement.requestFullscreen;
    fsExit = document.exitFullscreen;
    fsChange = "fullscreenchange";
  } else if ("webkitFullscreenEnabled" in document) {  // webkit prefix
    fsElement = "webkitFullscreenElement";
    fsRequest = documentElement.webkitRequestFullscreen;
    fsExit = document.webkitExitFullscreen;
    fsChange = "webkitfullscreenchange";
  } else if ("mozFullScreenEnabled" in document) {  // mozilla prefix
    fsElement = "mozFullScreenElement";
    fsRequest = documentElement.mozRequestFullScreen;
    fsExit = document.mozCancelFullScreen;
    fsChange = "mozfullscreenchange";
  } else if ("msFullscreenEnabled" in document) {  // microsoft prefix
    fsElement = "msFullscreenElement";
    fsRequest = documentElement.msRequestFullscreen;
    fsExit = document.msExitFullscreen;
    fsChange = "MSFullscreenChange";
  } else {
    classList.add("hidden");
    return;
  }

  if (window.matchMedia("(display-mode: fullscreen)").matches ||
      document[fsElement]) {
    if (document[fsElement]) {
      FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-compress");
    } else {
      classList.add("hidden");
    }
  }
  // addEventListener(fsChange, toggleIcon);
  // resize needed to handle manual F11 fullscreening entire browser
  // However, if whole browser is fullscreen, the compress button
  // cannot work, so hide it.
  addEventListener("resize", () => {
    const fsel = document[fsElement];
    classList.remove("hidden");
    if (window.matchMedia("(display-mode: fullscreen)").matches || fsel) {
      if (fsel) {
        FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-compress");
      } else {
        classList.add("hidden");
      }
    } else {
      FULLSCREEN_ICON.setAttribute("xlink:href", "#fa-expand");
    }
    if (getComputedStyle(HIDE_TEXT).display == "none") {
      TOP_BOX.style.opacity = "1";
      BOT_BOX.style.opacity = "1";
      HIDE_ICON.setAttribute("xlink:href", "#fa-xmark");  // even though hidden
    }
  });

  document.getElementById("fullscreen").addEventListener("click", () => {
    if (document[fsElement]) {
      fsExit.call(document);
    } else {
      fsRequest.call(documentElement);
    }
  });

  // Interpret URL query parameters
  // page=n           (to set initial page displayed, default is 0)
  // date=yyyy-mm-dd  (to set base date, else uses current date)
  let urlQueries = window.location.search.replace("\?", "");
  if (urlQueries) {
    urlQueries = Object.fromEntries(urlQueries.split("&")
                                    .map(q => q.split("=")));
  } else {
    urlQueries = {}
  }
  if (urlQueries.page && !isNaN(urlQueries.page)) {
    let page = parseInt(urlQueries.page);
    if (page > -22 && page < 22) initialPage = page;
  }
  if (urlQueries.date) {
    let parts = urlQueries.date.split("-");
    let minus = (parts[0] == "");
    if (minus) parts.shift();
    parts = parts.map(n => parseInt(n));
    if (parts.length == 3 &&
        !isNaN(parts[0])  && !isNaN(parts[1])  && !isNaN(parts[2])) {
      let jd = jd4date(urlQueries.date);
      if (!isNaN(jd)) {
        xyzNow.update(jd, jd, true);
        sceneUpdater.updateDate(jd);
      }
    }
  }
})();

/* ------------------------------------------------------------------------ */
