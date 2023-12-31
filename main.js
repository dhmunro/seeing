import {dayOfDate, dateOfDay, positionOf, orbitParams,
        timePlanetAt} from './ephemeris.js';
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
const MAX_ASPECT = 39 / 18;  // iPhone screen most extreme common case
const MIN_ASPECT = 16 / 10;  // tall laptop screen

const STARDATE = document.getElementById("stardate");

const scene3d = new PerspectiveScene("skymap", -HFOV, 0, 0.01, 2000);
const camera = scene3d.camera;

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

const [_sun0, _sunt] = [280.46457166 * Math.PI/180.,
                        35999.37244981/36525. * Math.PI/180.];

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
        const ra = _sun0 + _sunt * xyzPlanets.jd;
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
      if (p == "venus") {
        let jd = xyzPlanets.jd;
        let [x, y, z, e, a, b, ea, ma, madot] = orbitParams("earth", jd);
        const jdStep = 2*Math.PI / madot + yearError;
        for (let sprite of rings[p].children) {
          sprite.position.set(...glPlanetPosition(p, jd));
          jd += jdStep;
        }
      } else if (isMars) {
        let jd = xyzPlanets.jd;
        const re = xyzPlanets.xyz("earth");
        let [x, y, z, e, a, b, ea, ma, madot] = orbitParams("mars", jd);
        const jdStep = 2*Math.PI / madot + yearError;
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

  setTracking(mode) {
    const labels = this.labels;
    for (const [p, sprite] of Object.entries(this.labels)) {
      sprite.visible = false;
    }
    this.modeLabels[mode].forEach(name => { labels[name].visible = true; });
    if (mode == "mars" && this.rings.mars.visible) {
      labels.antisun.visible = false;
    }
    this.scene3d.setBackground((mode == "sky")? 0.6 : 0.3);
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
    let [x, y, z, e, a, b, ea, ma, madot] = orbitParams(pref, xyzNow.jd);
    const jdStep = 2*Math.PI / madot;
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
      const anim = new ParameterAnimator(
        Math.log(hfov0), Math.log(hfov1), zstep, ms);
      anim.play()
    }
  }

  pivot(ms) {
    if (!ms || ms < 0) return;
    const scene3d = this.scene3d;
    const camera = scene3d.camera;
    let r0 = camera.position;
    const [x0, y0, z0] = [r0.x, r0.y, r0.z];
    let angle0 = camera.getWorldDirection(_dummyVector);
    const r = Math.sqrt(angle0.x**2 + angle0.z**2);
    const y = angle0.y / r;
    angle0 = Math.atan2(angle0.x, angle0.z);
    let angle1 = angle0 + 2*Math.PI;
    const rate = 2*Math.PI / ms;
    const anim = new ParameterAnimator(
      angle0, angle1, (angle) => {
        camera.lookAt(x0 + Math.sin(angle), y0 + y, z0 + Math.cos(angle));
        scene3d.render();
      }, ms);
    anim.play();
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

function pointsOnCircle(n) {
  return Array.from(new Array(n+1)).map((phi, i) => {
    phi = 2*Math.PI/n * i;
    return [Math.sin(phi), 0, Math.cos(phi)];  // xyz ecliptic -> yzx GL world
  });
}

function fadeColor(obj, mult0, mult1, ms, onFinish) {
  const anim = new ParameterAnimator(
    mult0, mult1, (mult) => {
      setColorMultiplier(obj, mult);
      scene3d.render();
    }, ms, onFinish);
  anim.play();
}

// xyzNow.jd0 = start date
// xyzNow.jd = current date
// xyzNow.xyz(p, o) = current position of planet p (relative to o)
//   in GL world coords (cyclic permutation of ecliptic coords with y north)
const xyzNow = new PlanetPositions(dayOfDate(new Date()));

const sceneUpdater = new SceneUpdater(scene3d, xyzNow);

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

function recenterEcliptic() {
  camera.up.set(0, 1, 0);
  let dir = camera.getWorldDirection(_dummyVector);
  if (dir.x != 0 || dir.z != 0) {
    dir.y = 0;
    dir.normalize();
  } else {
    dir.set(1, 0, 0);
  }
  camera.lookAt(dir.x, 0, dir.z);
}

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

  msEase(ms) {
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

  pauseAfter(ms) {
    if (this.isPaused) this.play();
    this._timeout = setTimeout(() => {
      delete this._timeout;
      this.pause();
    }, ms);
    return this;
  }

  cancelPauseAfter() {
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
        setTimeout(() => {
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
  constructor(p0, p1, funp, msDelta, callback) {
    const rate = (p1 - p0) / msDelta;
    super((dms) => {
      p0 += rate * dms;
      const stop = (rate >= 0)? (p0 >= p1) : (p0 <= p1);
      if (stop) p0 = p1;
      funp(p0);
      if (stop) {
        if (callback) callback();
        else skyAnimator.playChain();
      }
      return stop;
    });
  }
}

/* ------------------------------------------------------------------------ */

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

  // It would be more efficient to draw ecliptic, equator, and pole marks
  // directly onto the sky map.
  const ecliptic = scene3d.polyline(pointsOnCircle(24).map(([x, y, z]) =>
    [1000*z, 1000*x, 0]), solidLine);
  ecliptic.rotation.x = Math.PI / 2;
  let geom;
  const equator = scene3d.polyline(ecliptic, dashedLine);
  equator.rotation.x = Math.PI / 2;
  equator.rotation.y = -23.43928 * Math.PI/180.;
  const poleMarks = scene3d.segments(
    [-30, 1000, 0,  30, 1000, 0, 0, 1000, -30,  0, 1000, 30,
     -30,-1000, 0,  30,-1000, 0, 0,-1000, -30,  0,-1000, 30], solidLine);
  const qpoleMarks = scene3d.segments(poleMarks, dashedLine);
  qpoleMarks.rotation.z = -23.43928 * Math.PI/180.;

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

  scene3d.camera.lookAt(-1, 0, 0);  // look at brightest part of Milky Way
  sceneUpdater.setTracking("sky");
  skyAnimator.playLoop(7305);
  // sceneUpdater.initializeRing("venus", xyzNow);
  xyzNow.update(xyzNow.jd);
  scene3d.render();
}

/* ------------------------------------------------------------------------ */

const controls = new SkyControls(scene3d.camera, scene3d.canvas);
controls.addEventListener("change", () => {
  scene3d.render();
});
controls.enabled = sceneUpdater.mode == "sky";

scene3d.onContextLost(() => {
  if (skyAnimator.isPaused) return;
  skyAnimater.pause();
  return () => { skyAnimator.play(); }  // resume when context restored
});

window.scene3d = scene3d;
window.xyzNow = xyzNow;
window.sceneUpdater = sceneUpdater;
window.skyAnimator = skyAnimator;

// Use VisionTester to find that hfov=10 gives roughly 1 arc min resolution

// class VisionTester {
//   constructor(scene3d) {
//     this.scene3d = scene3d;
//     this.lines = scene3d.segments(
//       [0, -200*Math.tan(5*Math.PI/180), 200,
//        0, 200*Math.tan(5*Math.PI/180), 200,
//        200*Math.tan((1/60)*Math.PI/180), -200*Math.tan(0.5*Math.PI/180), 200,
//        200*Math.tan((1/60)*Math.PI/180), 200*Math.tan(0.5*Math.PI/180), 200],
//       {color: 0xffff00, linewidth: 1});
//     this.lines.visible = false;
//   }
// 
//   test(hfov=HFOV) {
//     skyAnimator.stop();
//     scene3d.camera.lookAt(0, 0, 200);
//     this.lines.visible = true;
//     scene3d.setSize(undefined, undefined, -hfov);
//     scene3d.render();
//   }
// }
// 
// window.vision = new VisionTester(scene3d);

/* ------------------------------------------------------------------------ */

// https://github.com/rafgraph/fscreen
(function () {
  const FULLSCREEN_ICON = document.querySelector("#fullscreen > use");
  const classList = FULLSCREEN_ICON.parentElement.classList;
  
  const documentElement = document.documentElement;
  let fsElement, fsRequest, fsExit, fsChange;
  if ("fullscreenEnabled" in document) {
    fsElement = "fullscreenElement";
    fsRequest = documentElement.requestFullscreen;
    fsExit = document.exitFullscreen;
    fsChange = "fullscreenchange";
  } else if ("webkitFullscreenEnabled" in document) {
    fsElement = "webkitFullscreenElement";
    fsRequest = documentElement.webkitRequestFullscreen;
    fsExit = document.webkitExitFullscreen;
    fsChange = "webkitfullscreenchange";
  } else if ("mozFullScreenEnabled" in document) {
    fsElement = "mozFullScreenElement";
    fsRequest = documentElement.mozRequestFullScreen;
    fsExit = document.mozCancelFullScreen;
    fsChange = "mozfullscreenchange";
  } else if ("msFullscreenEnabled" in document) {
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
