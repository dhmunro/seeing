/**
 * @file High level wrapper for WebGL API, currently based on three.js.
 * @author David H. Munro
 * @copyright David H. Munro 2023
 * @license MIT
 *
 * Yikes!
 */

// console.log(THREE.REVISION);  --> 155

import {DefaultLoadingManager, TextureLoader, CubeTextureLoader, Fog,
        WebGLRenderer, PerspectiveCamera, Scene, Color, Sprite,
        SpriteMaterial, CanvasTexture, Object3D, Group, BufferGeometry,
        BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide,
        CylinderGeometry, SphereGeometry, MeshPhysicalMaterial,
        FrontSide, BackSide, PMREMGenerator} from "three";
import {Vector2, Vector3, Matrix3, Matrix4} from "three";
export {Vector2, Vector3, Matrix3, Matrix4};
import WebGL from 'three/addons/capabilities/WebGL.js';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export function loadTextureFiles(filenames, callback, prefix) {
  if (prefix === undefined) prefix = "./";
  const textures = [];  // result will correspond to filenames
  filenames.forEach(file => {
    if (typeof file === "string" || file instanceof String) {
      textures.push(new TextureLoader().load(prefix + file));
    } else {  // file is list of 6 files for CubeTextureLoader
      textures.push(new CubeTextureLoader().setPath(prefix).load(file));
    }
    if (callback !== undefined) {
      DefaultLoadingManager.onLoad = callback;
    }
  });
  return textures;
}

export class PerspectiveScene {
  /**
   * Wrapper combining a WebGL renderer with a scene and a camera
   *
   * @param [number] fov - field of view in degrees.  If positive this
   *    is the vertical field of view (as in three.js); if negative this
   *    is the horizontal field of view.
   * @param [number] aspect - width/height.  If 0, compute from canvas size.
   * @param [number] near - clipping plane for view frustum (world coordinates)
   * @param [number] far - clipping plane for view frustum (world coordinates)
   */
  constructor(canvas, fov, aspect, near, far) {
    if (typeof canvas === "string" || canvas instanceof String) {
      canvas = document.getElementById(canvas);
    }
    checkAvailability(canvas);
    this.renderer = new WebGLRenderer(
      {canvas: canvas, antialias: true, alpha: true});
    // Initially, canvas width,height is 300,150, but clientWidth is correct.
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0.0);
    this.scene = new Scene();
    if (!aspect) aspect = canvas.width / canvas.height;
    if (fov < 0) {  // convert from horizontal to vertical fov
      this.horizFov = fov;  // but < 0
      const hh = Math.tan(-fov * Math.PI/360.) / aspect;  // half height
      fov = Math.atan(hh) * 360./Math.PI;
    } else {
      this.horizFov = 0;
    }
    this.camera = new PerspectiveCamera(fov, aspect, near, far);
    this.sprites = [];
    this.lineMaterials = [];
    // Relies on canvas being inside a div whose dimensions are determined
    // by CSS.  The renderer will set absolute canvas dimensions, so canvas
    // never changes size by itself when layout changes.
    this.resizeObserver = new ResizeObserver(() => {
      const parent = this.renderer.domElement.parentElement;
      this.setSize(parent.offsetWidth, parent.offsetHeight);
      this.render();
    });
    this.resizeObserver.observe(canvas.parentElement);
    this.nContextLosses = 0;
  }

  onContextLost(callback) {
    const canvas = this.canvas;
    canvas.addEventListener(
      "webglcontextlost", (event) => {
        event.preventDefault();
        this.nContextLosses += 1;
        const onRestored = callback();
        if (onRestored) {
          const listener = (event) => {
            onRestored();
            canvas.removeEventListener("webglcontextrestored", listener);
          };
          canvas.addEventListener("webglcontextrestored", listener);
        }
      });
    return this;  // allow chained calls
  }

  get canvas() {
    return this.renderer.domElement;
  }

  add(...objects) {
    this.scene.add(...objects);
    return this;  // allow chained calls
  }

  // This currently does not recurse removing children - probably should.
  remove(...objects) {
    for (const obj of objects) {
      if (!obj instanceof Object3D) continue;
      // More importantly, need a reference counter system for geometries and
      // materials, since they are often used in multiple objects.
      // if (obj.geometry) obj.geometry.dispose();
      // if (obj.material) {
      //   if (obj.material instanceof Array) {
      //     obj.material.forEach(m => m.dispose());
      //   } else {
      //     obj.material.dispose();
      //   }
      // }
      obj.removeFromParent();
    }
    return this;  // allow chained calls
  }

  clear() {
    this.scene.clear();
    return this;  // allow chained calls
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  setBackground(background, intensity, blurriness) {
    if (background >= 0 && background <= 1) {
      blurriness = intensity;
      intensity = background;
    } else {
      if (typeof background === "string" || background instanceof String) {
        // looks like Color is ordinary garbage collected javascript object
        background = new Color(background);
      }
      this.scene.background = background;
    }
    if (intensity !== undefined) {
      this.scene.backgroundIntensity = intensity;
    }
    if (blurriness !== undefined) {
      this.scene.backgroundBlurriness = blurriness;
    }
    return this;  // allow chained calls
  }

  setEnvironment(scene) {
    let texture = scene;
    if (scene === undefined) {  // default room-like environment
      scene = new RoomEnvironment(this.renderer);
    }
    if (scene.isScene) {
      const pmremgen = new PMREMGenerator(this.renderer);
      texture = pmremgen.fromScene(scene).texture;
    }
    this.scene.environment = texture;
  }

  hfov(fov) {
    const canvas = this.renderer.domElement;
    const [width, height] = [canvas.clientWidth, canvas.clientHeight];
    if (fov === undefined) fov = this.camera.fov;
    const hh = Math.tan(fov * Math.PI/360.) * width / height;  // half height
    return Math.atan(hh) * 360./Math.PI;
  }

  setSize(width, height, fov) {
    if (width === undefined || height === undefined) {
      const canvas = this.renderer.domElement;
      [width, height] = [canvas.clientWidth, canvas.clientHeight];
    }
    this.camera.aspect = width / height;
    this.renderer.setSize(width, height);
    if (fov === undefined) {
      fov = this.horizFov? this.horizFov : this.camera.fov;
    } else {
      this.horizFov = (fov < 0)? fov : 0;
    }
    let hh = Math.tan(fov * Math.PI/360.);
    if (fov < 0) {  // fix horizontal field of view
      hh *= -height / width;  // half height
      fov = Math.atan(hh) * 360./Math.PI;
    }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // Existing fat lines and sprites need to told about size change, in
    // order to keep them the same number of pixels rather than scaling
    // with the window size.
    this.lineMaterials.forEach(m => {
      m.resolution.set(width, height);  // crucial!!
      m.resolution.needsUpdate = true;
    });
    // Sprite image initially maps onto a square that is 1x1 world units,
    // and presumably at a 1 unit distance when sizeAttenuation false.
    // Sprite size in pixels is stored in sprite.userData.
    // We want to keep the sprites a constant size in pixels for legibility,
    // which means we would like to set up the sprite scaling so the size in
    // pixels of the sprite always matches the size it is displayed at.
    // Note that this assumes sizeAttenutation is false; otherwise there is
    // an additional factor of the relative z to the camera.
    const scale = 2*hh / height;  // sprite scale
    this.sprites.forEach(s => {
      s.scale.set(s.userData.width*scale, s.userData.height*scale, 1);
    });
    return this;  // allow chained calls
  }

  createLineStyle(properties) {
    // color, linewidth, dashed, dashScale, dashSize, gapSize
    const style = new LineMaterial(properties);
    const canvas = this.renderer.domElement;
    style.resolution.set(canvas.width, canvas.height);
    style.resolution.needsUpdate = true;
    this.lineMaterials.push(style);
    return style;
  }

  destroyLineStyle(style) {
    const i = this.lineMaterials.indexOf(style);
    if (i > -1) this.lineMaterials.splice(i, 1);
    style.dispose();
  }

  // Note: createSprite, polyline, segments, and group all have
  //   optional parent argument, but it is also possible to create object
  //   at top level and move it into a group with the group.add() method.
  //   Also note that group.children is an Array of the objects in the group.

  createSprite(texture, scale, color, parent) {
    if (parent === undefined) parent = this.scene;
    let scalex, scaley, sprite;
    if (texture.isSprite) {
      scalex = texture.userData.width;
      scaley = texture.userData.height;
      sprite = texture.clone();
    } else {
      let atten;
      if (scale instanceof Array) {
        [scalex, scaley] = scale;
        atten = scalex < 0;
        if (atten) scalex = -scalex;
        if (scaley < 0) scaley = -scaley;
      } else {
        atten = scale < 0;
        if (atten) scale = -scale;
        scalex = scaley = scale;
      }
      if (texture instanceof HTMLCanvasElement) {
        scalex *= texture.width;
        scaley *= texture.height;
        texture = new CanvasTexture(texture);
      } else {
        // source.data does not exist until texture image has loaded
        const data = texture.source.data;
        scalex *= data.width;
        scaley *= data.height;
      }
      const props = {map: texture, sizeAttenuation: atten};
      if (color !== undefined) props.color = color;
      sprite = new Sprite(new SpriteMaterial(props));
    }
    sprite.userData.width = scalex;
    sprite.userData.height = scaley;
    scale = Math.tan(this.camera.fov * Math.PI/360.);  // half of projected fov
    scale *= 2 / this.renderer.domElement.height;
    sprite.scale.set(scalex*scale, scaley*scale, 1);
    this.sprites.push(sprite);
    parent.add(sprite);
    return sprite;
  }

  destroySprite(sprite) {
    sprite.removeFromParent();
    const i = this.sprites.indexOf(sprite);
    if (i > -1) this.sprites.splice(i, 1);
    // ?? sprite.dispose();
  }

  // Points can be previous polyline to reuse LineGeometry.
  polyline(points, style, parent) {
    if (parent === undefined) parent = this.scene;
    let geom;
    if (points.isLine2) {
      geom = points.geometry;
    } else {
      if (points instanceof Array) points = points.flat();
      geom = new LineGeometry();
      geom.setPositions(points);
    }
    if (!style.isMaterial) style = this.createLineStyle(style);
    const lines = new Line2(geom, style);
    if (style.dashed) lines.computeLineDistances();
    parent.add(lines);
    return lines;
  }

  // Points can be previous polyline to reuse LineSegmentsGeometry.
  segments(points, style, parent) {
    if (parent === undefined) parent = this.scene;
    let geom;
    if (points.isLineSegments2) {
      geom = points.geometry;
    } else {
      if (points instanceof Array) points = points.flat();
      geom = new LineSegmentsGeometry();
      geom.setPositions(points);
    }
    if (!style.isMaterial) style = this.createLineStyle(style);
    const lines = new LineSegments2(geom, style);
    if (style.dashed) lines.computeLineDistances();
    parent.add(lines);
    return lines;
  }

  mesh(points, indices, color, parent) {
    // points is list of (x, y, z), possibly nested
    // indices is list of indices into points (/3), in groups of three
    //   each specifying one triangle
    if (parent === undefined) parent = this.scene;
    const geom = new BufferGeometry();
    if (indices !== null) {
      if (indices instanceof Array) indices = indices.flat();
      geom.setIndex(indices);
    }
    if (points instanceof Array) points = points.flat();
    geom.setAttribute("position",
                      new BufferAttribute(new Float32Array(points), 3));
    let mat = color;
    if (!mat.isMaterial) {
      let props = {color: color, side: DoubleSide};
      if (color instanceof Array) {
        [props.color, props.opacity] = color;
        props.transparent = true;
      }
      mat = new MeshBasicMaterial(props);
    }
    const msh = new Mesh(geom, mat);
    parent.add(msh);
    return msh;
  }

  cylinder([rtop, rbot, height, nang, nlen, open, theta0, dtheta],
           color, parent) {
    const g = new CylinderGeometry(rtop, rbot,  // top and bottom radii
                                   height,      // cylinder length
                                   nang, nlen,  // # segments around and along
                                   open,        // true if no caps (false)
                                   theta0,      // start angle (0)
                                   dtheta);     // cylinder angle (2*pi)
    let mat = color;
    if (!mat.isMaterial) {
      let props = {color: color, side: DoubleSide};
      if (color instanceof Array) {
        [props.color, props.opacity] = color;
        props.transparent = true;
      }
      mat = new MeshBasicMaterial(props);
    }
    if (parent === undefined) parent = this.scene;
    const msh = new Mesh(g, mat);
    parent.add(msh);
    return msh;
  }

  sphere([r, nphi, ntheta, phi0, dphi, theta0, dtheta],
           color, parent) {
    const g = new SphereGeometry(r,             // sphere radius
                                 ntheta, nphi,  // # segments around and along
                                 phi0,          // start angle (0)
                                 dphi,          // cylinder angle (2*pi)
                                 theta0,        // start angle (0)
                                 dtheta);       // cylinder angle (pi)
    let mat = color;
    if (!mat.isMaterial) {
      let props = {color: color, side: DoubleSide};
      if (color instanceof Array) {
        [props.color, props.opacity] = color;
        props.transparent = true;
      }
      mat = new MeshBasicMaterial(props);
    }
    if (parent === undefined) parent = this.scene;
    const msh = new Mesh(g, mat);
    parent.add(msh);
    return msh;
  }

  createPhysical(properties) {
    return new MeshPhysicalMaterial(properties);
  }

  destroyPhysical(material) {
    material.dispose();
  }

  movePoints(obj, points) {
    if (isNaN(points[0])) points = points.flat();
    obj.geometry.setPositions(points);
  }

  meshMovePoints(obj, points) {
    if (points instanceof Array) points = points.flat();
    obj.geometry.setAttribute(
      "position", new BufferAttribute(new Float32Array(points), 3));
  }

  group(parent) {
    const grp = new Group();
    if (parent === undefined) parent = this.scene;
    parent.add(grp);
    return grp;
  }

  fog(color, near, far) {
    if (color === undefined || color === null) {
      this.scene.fog = null;
    } else {
      this.scene.fog = new Fog(color, near, far);
    }
  }

  orbitControls() {
    const controls = new OrbitControls(this.camera, this.canvas);
    controls.enableDamping = true;
    controls.minDistance = 5;
    controls.maxDistance = 25;
    controls.update();
    return controls;
  }
}

export class TextureCanvas {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  set width(w) {
    this.canvas.width = w;
  }

  set height(h) {
    this.canvas.height = h;
  }

  addTo(perspectiveScene, xcenter, ycenter, parent) {
    const sprite = perspectiveScene.createSprite(this.canvas, 1, undefined,
                                                 parent);
    if (xcenter !== undefined) {
      sprite.center.set(xcenter, ycenter);
    }
    return sprite;
  }
}

export function setColorMultiplier(object, factor) {
  if (object.material !== undefined && object.material.userData != undefined &&
      object.material.color !== undefined && object.material.color.isColor) {
    const color = object.material.color;
    let originalColor = object.material.userData.originalColor;
    if (originalColor === undefined) {
      originalColor = color.clone();
      object.material.userData.originalColor = originalColor;
    } else {
      color.set(originalColor);
    }
    color.multiplyScalar(factor);
  }
}

function checkAvailability(canvas) {
  if (!WebGL.isWebGLAvailable()) {
    const warning = WebGL.getWebGLErrorMessage();
    canvas.appendChild(warning);
    throw new Error("Your graphics card does not seem to support WebGL");
  }
}
