// SkyControls allows you to drag the sky more intuitively than any of
// the built-in controls (OrbitControls, FlyControls, etc.)
import {Vector3, EventDispatcher, Quaternion} from 'three';

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

export class SkyControls extends EventDispatcher {
  constructor(camera, domElement) {
    super();

    this.camera = camera;
    this.domElement = domElement;
    this.domElement.style.touchAction = "none";  // disable touch scroll

    this.enabled = true;
    this.speed = 1.0;

    const self = this;  // copy binding for subsequent functions
    let dragStrategy = true;
    const pointers = [];
    // Allocate working objects just once here.
    const u = new Vector3();
    const p = new Vector3();
    const q = new Vector3();
    const u0 = new Vector3();
    const q0 = new Vector3();
    const pxq = new Vector3();
    const pp = new Vector3();
    const tmp = new Vector3();
    const quat = new Quaternion();
    const qtmp = new Quaternion();

    this.dispose = function() {
      const domElement = self.domElement;
      domElement.removeEventListener("pointerdown", onPointerDown);
      domElement.removeEventListener("pointercancel", onPointerUp);
      domElement.removeEventListener("pointermove", onPointerMove);
      domElement.removeEventListener("pointerup", onPointerUp);
    }

    this.update = function() {
      return function() {
        const camera = self.camera;
      }
    }();

    function getXY(event) {
      let x, y;
      if (event.pointerType === "touch") {
        [x, y] = [event.pageX, event.pageY];
        if (pointers.length > 1) {
          let i = (event.pointerId == pointers[0].pointerId)? 1 : 0;
          x = 0.5*(x + pointers[i].pageX);
          y = 0.5*(y + pointers[i].pageY);
        }
      } else {
        [x, y] = [event.clientX, event.clientY];
      }
      return [x, y];
    }

    function getXYZ(event) {
      let [x, y] = getXY(event);
      // (x, y) are tan(angle) / scale
      const height = self.domElement.clientHeight;
      const width = self.domElement.clientWidth;
      const fov = self.camera.fov;  // vertical field of view (VFOV)
      const camera = self.camera;
      const scale = 2*Math.tan(fov * Math.PI/360) / height;
      // screen x --> camera x, screen y -> camera -y
      x = (x - 0.5*width)*scale;
      y = (0.5*height - y)*scale;
      let z = 1 / Math.sqrt(x**2 + y**2 + 1);
      x *= z;
      y *= z;
      // Camera looks toward its -z axis (not +z)!
      return [x, y, -z];  // camera coordinate unit vector of selected point
    }

    /*
     * Solve x*c + y*s = w for unit vector (c, s), assuming w**2 <= x**2+y**2.
     * Consider the rotated coordinate system in which (x,y) is (r,0):
     *   x = (x/r)*xp - (y/r)*yp
     *   y = (y/r)*xp + (x/r)*yp
     * The dot product is rotation invariant, so x*c + y*s = xp*cp + yp*sp = w,
     * or  r*cp = w, and the solution is cp = w/r.  Since (cp, sp) is a unit
     * vector, sp = +-sqrt(1-cp**2).  Transforming back to original coordinates,
     *   c = (x/r)*cp - (y/r)*sp
     *   s = (y/r)*cp + (x/r)*sp
     * In the applications here, we always want the smallest positive s root,
     * and the sign of w is indeterminate. (sometimes??)
     */
    function dotSolve(x, y, w, eitherSign=false) {
      const rr = 1 / Math.sqrt(x**2 + y**2);
      const cp = w * rr;
      const sp = Math.sqrt(Math.max(1 - cp**2, 0));  // roundoff protection
      let [cx, cy] = [x*cp*rr, -y*sp*rr];
      let [sx, sy] = [y*cp*rr, x*sp*rr];
      // Solution is either (cx+cy, sx+sy) or (cx-cy, sx-sy).
      // This is way too ugly - surely there is a better way...
      if (eitherSign) {
        [cx, cy] = [Math.abs(cx), Math.abs(cy)];
        [sx, sy] = [Math.abs(sx), Math.abs(sy)];
        return [cx+cy, Math.abs(sx-sy)];

      // Other cases do not work properly??  Sometimes give s<0.
      } else if (sx < 0) {
        return (sy > 0)? [cx+cy, sx+sy] : [cx-cy, sx-sy];
      } else if (sy < 0) {
        return (sx+sy<=0)? [cx-cy, sx-sy] : [cx+cy, sx+sy];
      } else {
        return (sx-sy>0)? [cx-cy, sx-sy] : [cx+cy, sx+sy];
      }
    }

    function onPointerDown(event) {
      if (!self.enabled) return;
      const domElement = self.domElement;
      if (pointers.length === 0) {
        domElement.setPointerCapture(event.pointerId)
        domElement.addEventListener("pointermove", onPointerMove);
        domElement.addEventListener("pointerup", onPointerUp);
      }
      pointers.push(event);
      let [x, y, z] = getXYZ(event);
      p.set(x, y, z);
      self.dispatchEvent(_startEvent);
      u.set(0, 1, 0);  // north ecliptic pole
      u.applyQuaternion(self.camera.quaternion.clone().conjugate());
      dragStrategy = u.y > ((u.z < 0)? p.y : -p.y);
    }

    function onPointerMove(event) {
      if (!self.enabled) return;
      let [x, y, z] = getXYZ(event);
      q.set(x, y, z);
      if (q.equals(p)) return;
      q0.copy(q);
      // Note that a camera looks along its -z-axis (not +z!)!
      const camera = self.camera;
      u.set(0, 1, 0);  // north pole
      u.applyQuaternion(self.camera.quaternion.clone().conjugate());
      u.x = 0;
      u.normalize();
      u0.copy(u);
      if (dragStrategy) {  // Star under pointer on down stays under pointer.
        let udotp = u.dot(p);
        /* Since u.x=0, u.dot(q) just involves (q.y, q.z), so the problem
         * is to find (u.y, u.z) on the unit circle such that this new u
         * has u.dot(q) equal to udotp.  If we work in the coordinate
         * system with its axis along (q.y, q.z), where q = (qr, 0) and
         * u = (ua, ub), u.dot.q = qr*ua = udotp, so ua = udotp/qr.  We can
         * work out ub from the condition that u is a unit vector, and
         * always choose ub>0 in this rotated system.
         * u = (ua*q.y-ub*q.z, ua*q.z+ub*q.y) in the (y, z) coordinates
         * There are two things that can go wrong:
         * 1. abs(ua) > 1
         * 2. u.y = ua*q.y-ub*q.z < 0, note that q.z<0 and ub>0 always
         * In either case, we need to fall back and move q back toward p.
         */
        let qr = Math.sqrt(q.y**2 + q.z**2);  // p.z and q.z > 0 always
        let ua = udotp / qr;
        let ub = 1 - ua**2;
        if (ub < 0) {
          qr = Math.abs(udotp);
          ua = (udotp < 0)? -1 : 1;
          ub = 0.;
          /* Move q to make qr = abs(udotp).  Let pp = perpendicular to p, so
           * new q = p*c + pp*s, and qx = px*c + ppx*s = +-sqrt(1-udot**2),
           * where (c,s) is a unit vector and s should be small and positive.
           */
          pxq.crossVectors(p, q).normalize();
          pp.crossVectors(pxq, p).normalize();  // normalize any roundoff errors
          let [c, s] = dotSolve(p.x, pp.x, Math.sqrt(1 - udotp**2), true);
          q.copy(p).multiplyScalar(c).add(tmp.copy(pp).multiplyScalar(s));
        }
        ub = Math.sqrt(ub);
        [u.y, u.z] = [(ua*q.y - ub*q.z)/qr, (ua*q.z + ub*q.y)/qr];
        const eps = 0.00001;
        const epsc = Math.sqrt(1 - eps**2);
        dragStrategy = u.y > 0;
        if (!dragStrategy) {
          /* This means up - the north pole - wants to move into the lower
           * hemisphere of the camera.  We do not allow this, so we change
           * to a "pivot strategy" in which we put move u exactly to
           * (0, +-1) (with the sign  of the u.z corresponding to the u.y<0,
           * and rotate about u by the angle from the rotated p to the final q
           * instead of trying to actually move p to q.
           */
          [u.y, u.z] = [0, (u.z < 0)? -1 : 1];
        }
        /* Set quaternion to the first rotation (about x axis). */
        quat.setFromUnitVectors(u0, u);  // so u = u0.applyQuaternion(quat))
        p.applyQuaternion(quat);
      } else {  // Rotate around NEP or SEP using only directions of p, q.
        quat.setFromUnitVectors(u, u);
      }
      p.sub(tmp.copy(u).multiplyScalar(u.dot(p)));
      q.sub(tmp.copy(u).multiplyScalar(u.dot(q)));
      qtmp.setFromUnitVectors(p.normalize(), q.normalize());  // p->q, u->u
      quat.premultiply(qtmp);
      // camera.quaternion is worldToLocal transform
      camera.quaternion.multiply(quat.conjugate());
      p.copy(q0);  // Subsequent move needs to begin from original q.
      self.dispatchEvent(_changeEvent);
    }

    function onPointerUp(event) {
      for (let i=0; i<pointers.length; i++) {
        if (pointers[i].pointerId == event.pointerId) {
          pointers.splice(i, 1);
          break;
        }
      }
      if (pointers.length === 0) {
        const domElement = self.domElement;
        domElement.releasePointerCapture(event.pointerId)
        domElement.removeEventListener("pointermove", onPointerMove);
        domElement.removeEventListener("pointerup", onPointerUp);
      }
      self.dispatchEvent(_endEvent);
    }
    domElement.addEventListener("pointerdown", onPointerDown);
    domElement.addEventListener("pointercancel", onPointerUp);
  }
}
