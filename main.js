import {dayOfDate, dateOfDay, positionOf, orbitParams, timePlanetAt,
        eclipticOfDate, precession, obliquity,
        meanSunOn, meanSunNextAt, periodOf} from './ephemeris.js';
import {loadTextureFiles, PerspectiveScene, TextureCanvas, setColorMultiplier,
        Vector3, Matrix4} from './wrap3.js';
import {Animator} from './animator.js';
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
const MAX_ASPECT = 39 / 18;  // iPhone screen most extreme common case
const MIN_ASPECT = 16 / 10;  // tall laptop screen

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

  update(jd, jd0) {
    if (jd0 !== undefined) this.jd0 = jd0;  // change initial time
    if (jd === undefined) jd = this.jd0;  // reset to initial time
    const xyz = this._xyz;
    for (const p in xyz) {
      if (p == "sun") continue;
      xyz[p] = glPlanetPosition(p, jd);
    }
    this.jd = jd;
    if (this.callback) this.callback(this, jd0);
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
    const isSun = p == "sun";
    if (isSun) p = "earth";
    // Return orbit parameters ten years after given time.
    const day = jd + 3652.5;
    let [xAxis, yAxis, zAxis, e, a, b, ea, ma, madot] = orbitParams(p, day);
    if (isSun) [a, b] = [-a, -b];
    // sidereal period = 2*Math.PI / madot
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

class SceneUpdater {
  constructor(scene3d, xyz) {
    this.scene3d = scene3d;
    this.planets = {};
    this.labels = {};
    this.orbits = {};
    this.rings = {};
    this.mode = "sky";

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
    ["sun", "earth", "venus", "mars"].forEach(p => {
      this.orbits[p].matrixAutoUpdate = false;
      this.orbits[p].visible = false;
    })
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
        for (let sprite of rings[p].children) {
          sprite.position.set(...glPlanetPosition(p, jd));
          jd += jdStep;
        }
      } else if (isMars) {
        const re = xyzPlanets.xyz("earth");
        const jdStep = periodOf("mars", jd) + yearError;
        const ring = rings[p];
        const children = ring.children;
        for (let j = 0; j < children.length; j += 2) {
          let rs = glPlanetPosition("earth", jd).map((v, i) => re[i] - v);
          let rm = glPlanetPosition("mars", jd).map((v, i) => v + rs[i]);
          children[j].position.set(...rs);
          children[j+1].position.set(...rm);
          this._setSpoke(j/2, re, rs, rm);
          jd += jdStep;
        }
      }
    }
    this.updateCamera(xyzPlanets);
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
    ["earth", "venus", "mars"].forEach(p => {
      this.orbits[p].matrix = xyzPlanets.ellipse(p, jd);
    });
  }

  addPlanet(name, texture, scale, color) {
    const sprite = this.scene3d.createSprite(texture, scale, color);
    this.planets[name] = sprite;
    return sprite;
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
    let font = getProp(params, "font", "16px Arial, sans-serif");
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
    let font = getProp(params, "font", "16px Arial, sans-serif");
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
    const labels = this.labels;
    for (const [p, sprite] of Object.entries(this.labels)) {
      sprite.visible = false;
    }
    this.modeLabels[mode].forEach(name => { labels[name].visible = true; });
    if (mode == "mars" && this.rings.mars.visible) {
      labels.antisun.visible = false;
    }
    const skyMode = mode == "sky";
    this.scene3d.setBackground(skyMode? 0.6 : 0.3);
    controls.enabled = skyMode;
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

  initializeRing(planet, xyzPlanets) {
    skyAnimator.clearChain().stop();
    // Run forward or backward by up to half a year to find the
    // most open view of the orbit.
    let jdBest = this.findBestOrbitView(planet, xyzPlanets.jd0);
    let re0 = glPlanetPosition("earth", jdBest);
    const ring = this.rings[planet];
    ring.userData.jd0 = jdBest;
    ring.userData.re0 = re0;
    ring.userData.initializing = true;
    ring.userData.yearError = 0;
    const pref = (planet == "venus")? "earth" : "mars";
    const jdStep = periodOf(pref, xyzNow.jd);
    skyAnimator.chain(500).chain(() => {
      this.setTracking(planet);
      ring.visible = true;  // after setTracking so antisun still visible
      xyzPlanets.update(jdBest - jdStep);
      skyAnimator.jdRate(jdStep / 6);
      skyAnimator.msEase(800);
      skyAnimator.playUntil(jdBest);
    }).chain(() => {
      this.labels.antisun.visible = false;  // nos remove antisun
      this.mode = "sky";  // lie about mode to prevent following planet
      skyAnimator.jdRate(jdStep);
      skyAnimator.playChain();
    });
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
              xyzPlanets.update(jdBest);
              this.showRing(planet, 3000);
            }
          });
        })(n, sprite, sunSprite);
        jd += jdStep;
      }
    }
    skyAnimator.playChain();
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

  showSpokes(callback) {
    this.spokes.visible = true;
    const children = this.spokes.children;
    const scene3d = this.scene3d;
    let i = 0, n = children.length;
    const showNext = () => {
      children[i].visible = true;
      scene3d.render();
      i += 1;
      if (i < n) setTimeout(() => showNext(), 500);
      else if (callback) callback(this);
      else skyAnimator.playChain();
    };
    showNext();
  }

  hideSpokes() {
    this.spokes.visible = false;
    for (let spoke of this.spokes.children) {
      spoke.visible = false;
    }
    this.scene3d.render();
  }

  setYearError(yerr) {
    const ring = this.rings.venus.visible? this.rings.venus : this.rings.mars;
    ring.userData.yearError = yerr;
    xyzNow.update(xyzNow.jd);
  }

  zoom(bigger, ms, callback) {
    const [hfov0, hfov1] = bigger? [HFOV, 10] : [10, HFOV];
    const scene3d = this.scene3d;
    const zstep = (lhfov) => {
      scene3d.setSize(undefined, undefined, -Math.exp(lhfov));
      scene3d.render();
    };
    if (!ms || ms < 0) {
      zstep(Math.log(hfov1));
      if (callback) callback(this);
      else skyAnimator.playChain();
    } else {
      const rate = (hfov1 - hfov0) / ms;
      parameterAnimator.initialize(
        Math.log(hfov0), Math.log(hfov1), ms, zstep).play()
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
    const v = this.orbits[(planet == "venus")? "venus" : "sun"];
    v.visible = true;
    if (msFade) {
      fadeColor(v, 0.05, mult, msFade);
    } else {
      setColorMultiplier(v, mult? mult : 1.0);
    }
  }

  hideOrbit(planet, mult, msFade) {
    const v = this.orbits[(planet == "venus")? "venus" : "sun"];
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

  playToNodes() {
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
    if (isVenus) madot = orbitParams(pref, jd)[8];
    const year = 2*Math.PI / madot;
    let jda = timePlanetAt(pref, x, y, z, jd);
    let jdb = timePlanetAt(pref, -x, -y, -z, jd);
    if (jda < jd) jda += year;
    if (jdb < jd) jdb += year;
    if (jda > jdb) [jda, jdb] = [jdb, jda];
    skyAnimator.chain(500).chain(() => skyAnimator.playUntil(jda));
    skyAnimator.chain(2000).chain(() => skyAnimator.playUntil(jdb));
    skyAnimator.chain(() => skyAnimator.msEase(0));
    skyAnimator.jdRate(40);
    skyAnimator.msEase(800);
    skyAnimator.playChain();
  }

  updateDate(jd) {
    STARDATE.innerHTML = date4jd(jd);
  }
}

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

// xyzNow.jd0 = start date
// xyzNow.jd = current date
// xyzNow.xyz(p, o) = current position of planet p (relative to o)
//   in GL world coords (cyclic permutation of ecliptic coords with y north)
const xyzNow = new PlanetPositions(dayOfDate(new Date()));

const sceneUpdater = new SceneUpdater(scene3d, xyzNow);

/* ------------------------------------------------------------------------ */

function resetScene(mode) {
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

    const noop = () => {};
    let nowMar, mar2sep, year;
    let jdOrigin = null;
    const sunCounter = (stop) => {
      if (jdOrigin === null) jdOrigin = xyzNow.jd;
      SUN_COUNTER.innerHTML = (xyzNow.jd - jdOrigin).toFixed(2);
    };

    this.pageEnter = [
      () => {  // page 0: Seeing the Solar System
        resetScene("sky");
        skyAnimator.chain(4000).chain(() => {
          sceneUpdater.pivot(8000, 1000);
        }).chain(2000).chain(() => {
          skyAnimator.playFor(730.51272);
        }).chain(2500).chain(() => {
          xyzNow.update();
          scene3d.render();
          skyAnimator.playChain();
        }).chain(() => {
          pager.gotoPage(0);
        });
        scene3d.render();
        skyAnimator.playChain();
      },

      () => {  // page 1: First study how the Sun moves
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("sun");
        sceneUpdater.labels.meansun.visible = false;
        sceneUpdater.lookAlong(xc, yc, zc);
        skyAnimator.chain(() => {
          sceneUpdater.pivotToMeanSun(4000, 1000);
        }).chain(() => {
          skyAnimator.msEase(1000);
          skyAnimator.playFor(730.51272);
        }).chain(() => {
          xyzNow.update(xyzNow.jd - 730.51272);
          scene3d.render();
          skyAnimator.playChain();
        }).chain(() => {
          pager.gotoPage(1);
        });
        scene3d.render();
        skyAnimator.playChain();
      },

      () => {  // page 2: The Sun does not move around at constant speed
        SUN_COUNTER.innerHTML = "-";
        MAR_SEP.innerHTML = "";
        SEP_MAR.innerHTML = "";
        jdOrigin = null;
        sceneUpdater.recenterEcliptic();
        const [xc, yc, zc] = sceneUpdater.cameraDirection();
        resetScene("sun");
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
          }).chain(1500).chain(() => {
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
        countDays();
        countDays();
        countDays().chain(() => {
          pager.gotoPage(2);
        });
        scene3d.render();
        skyAnimator.playChain();
      }
    ];

    // gotoPage will resetAnimators() before calling exit,
    // but pageExit can often be a noop.
    this.pageExit = [
      noop,  // exit page 0
      noop,  // exit page 1
      noop  // exit page 2
    ];
  }

  gotoPage(i) {
    const {topPages, botPages, iPage, pageup, pagedn} = this;
    const mxPage = botPages.length - 1;
    if (i === undefined) i = iPage;
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
    if (pageExit) pageExit();
    if (pageEnter) pageEnter();
  }

  next() {
    this.gotoPage(this.iPage + 1);
  }

  prev() {
    this.gotoPage(this.iPage - 1);
  }

  step(delta) {
    if (skyAnimator.isPlaying && skyAnimator.isPaused && delta) {
      xyzNow.update(xyzNow.jd + delta);
      scene3d.render();
    }
  }
}

const pager = new Pager(document.getElementById("topbox"),
                        document.getElementById("botbox"),
                        document.getElementById("pageup"),
                        document.getElementById("pagedn"));

const SUN_COUNTER = document.getElementById("sun-counter");
const MAR_SEP = document.getElementById("mar-sep");
const SEP_MAR = document.getElementById("sep-mar");

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

function setStartDate(event) {
  const text = event.target.value;
  const match = event.target.value.match(/(-?[012]\d\d\d)(-\d\d)?(-\d\d)?/);
  const jd = match? jd4date(event.target.value) : xyzNow.jd0;
  xyzNow.update(jd, jd);
  DATE_BOX.value = date4jd(xyzNow.jd0);
  scene3d.render();
}

function gotoStartDate() {
  xyzNow.update();
  scene3d.render();
}

const _dummyVector = new Vector3();

/* ------------------------------------------------------------------------ */

const radii = (() => {
  function makeRadius(c, dashed=false) {
    const line = scene3d.segments([0, 0, 0,  1, 0, 0],
      {color: c, linewidth: 2, dashed: dashed, dashSize: 0.03, gapSize: 0.05});
    line.visible = false;
    return line;
  }
  return {
    earth: makeRadius(0xccccff),
    venus: makeRadius(0xcccccc),
    mars: makeRadius(0xffcccc),
    gearth: makeRadius(0xccccff, true),
    gmars: makeRadius(0xffcccc, true)
  }
})();

/* ------------------------------------------------------------------------ */

class SkyAnimator extends Animator {
  constructor(scene3d, xyzNow, daysPerSecond) {
    super(dms => {
      let stop = self.step(dms);
      if (stop && self._chain.length) {
        setTimeout(() => self._chain.shift()(self), 0);
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
      const chain = this._chain;
      const time = callback;
      callback = () => {
        this.cancelTimeout();
        this._timeout = setTimeout(() => {
          if (chain.length) chain.shift()(this);
        }, time);
      };
    }
    this._chain.push(callback);
    return this;
  }

  playChain() {
    if (this._chain.length) this._chain.shift()(this);
    return this;
  }

  clearChain() {
    this._chain = [];
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

class ParameterAnimator extends Animator {
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

function setupSky() {
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
  eqgrp.rotation.z = -23.43928 * Math.PI/180.;
  sceneUpdater.egrp = egrp;
  sceneUpdater.eqgrp = eqgrp;

  const ecLabel = sceneUpdater.addText("ecliptic", {color: "#113366"});
  ecLabel.position.set(-7070, -180, 7070);
  const eqLabel = sceneUpdater.addText("equator", {color: "#113366"});
  eqLabel.position.set(-7070, 2900, 7070);
  sceneUpdater.ecLabel = ecLabel;
  sceneUpdater.eqLabel = eqLabel;

  // planets.sun = scene3d.createSprite(textureMaps[1], 0.6, 0xffffff);
  sceneUpdater.addPlanet("sun", textureMaps[1], 0.6, 0xffffff);

  const planetTexture = textureMaps[2];
  sceneUpdater.addPlanet("venus", planetTexture, 0.6, 0xffffff);
  sceneUpdater.addPlanet("mars", planetTexture, 0.6, 0xffcccc);
  sceneUpdater.addPlanet("jupiter", planetTexture, 0.6, 0xffffff);
  sceneUpdater.addPlanet("saturn", planetTexture, 0.6, 0xffffcc);
  sceneUpdater.addPlanet("mercury", planetTexture, 0.4, 0xffffff);
  sceneUpdater.addPlanet("earth", planetTexture, 0.6, 0xccccff);

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

  pager.gotoPage(2);
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
  if (skyAnimator.isPaused) return;
  skyAnimater.pause();
  return () => { skyAnimator.play(); }  // resume when context restored
});

window.scene3d = scene3d;
window.xyzNow = xyzNow;
window.sceneUpdater = sceneUpdater;
window.skyAnimator = skyAnimator;

window.getCamera = () => {
  let dir = scene3d.camera.getWorldDirection(_dummyVector);
  return scene3d.camera, dir;
};

/* ------------------------------------------------------------------------ */

const PRESS_TIMEOUT = 750;

STARDATE.addEventListener("pointerdown", (event) => {
  if (STARDATE.classList.contains("disabled")) return;
  const didPause = maybePause();  // pause immediately if playing
  if (sceneUpdater.mode == "sky") sceneUpdater.recenterEcliptic();
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
  let id = setTimeout(() => {
    // Got timeout before pointer up, this is press and hold.
    id = null;
    STARDATE.removeEventListener("pointerup", gotPointerup);
    console.log("press and hold action", xyzNow.jd);
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
  if (parameterAnimator.isPlaying) {
    if (parameterAnimator.isPaused) parameterAnimator.play()
    else parameterAnimeator.pause();
  } else if (skyAnimator.isPlaying) {
    if (!skyAnimator.isPaused) skyAnimator.pause();
    else skyAnimator.play();
  } else if (skyAnimator._timeout !== undefined) {
    skyAnimator.cancelTimeout();  // prevent it from waking up
  } else {
    skyAnimator.playChain();
  }
}

/* ------------------------------------------------------------------------ */

const MAIN_MENU = document.getElementById("main-menu");
MAIN_MENU.addEventListener("click", () => {
  if (MAIN_MENU.classList.contains("disabled")) return;
  console.log("open main menu");
});

const PAGE_UP = pager.pageup;
PAGE_UP.addEventListener("click", () => {
  if (PAGE_UP.classList.contains("disabled")) return;
  pager.prev();
});

const PAGE_DOWN = pager.pagedn;
PAGE_DOWN.addEventListener("click", () => {
  if (PAGE_DOWN.classList.contains("disabled")) return;
  pager.next();
});

const REPLAY = document.getElementById("replay");
REPLAY.addEventListener("click", () => {
  if (REPLAY.classList.contains("disabled")) return;
  pager.gotoPage();
});

addEventListener("keydown", (event) => {
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
    pager.gotoPage();
    break;
  case "ArrowLeft":
  case "Left":
    pager.step(-1);
    break;
  case "ArrowRight":
  case "Right":
    pager.step(1);
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
  });

  document.getElementById("fullscreen").addEventListener("click", () => {
    if (document[fsElement]) {
      fsExit.call(document);
    } else {
      fsRequest.call(documentElement);
    }
  });
})();

/* ------------------------------------------------------------------------ */
