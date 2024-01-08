/**
 * @file Animator class handles javascript animations.
 * @author David H. Munro
 * @copyright David H. Munro 2023
 * @license MIT
 */

/**
 * Wrapper for animation details.  Animator offers play(), pause(), stop(),
 * and also skip() to advance to final frame of entire animation.
 * Set the onFinish property to a callback when the entire animation
 * completes.  It will be called with `this` set to this animator.
 *
 * @param {function|delay} part - Either a callback to generate next frame
 *    or a delay time (ms).  A delay time pauses the animation for the
 *    specified time before beginning the next part.  A callback function
 *    has a single argument callback(dt), where dt is the time elapsed
 *    since the previous call (ms).  The callback must return true when
 *    this part of the animation has finished; false to be called again.
 *    The argument dt=0 indicates that this is the first callback for this
 *    part.  Callbacks are invoked with `this` set to Animator instance, so
 *    you can access other data you have stored as properties.
 */
export class Animator {
  constructor(...parts) {
    function makeTimer(timeout) {
      const original = timeout;
      let timeLeft = timeout;
      function timer(dt) {
        if (dt !== null) timeLeft -= dt;
        else timeLeft = original;  // reset the timer
        return timeLeft <= 0;
      }
      timer.wantsAnimatorResetCallback = true;
      return timer;
    }

    this.parts = parts.map(p => Number.isFinite(p)? makeTimer(p) : p);
    this.stepper = undefined;  // will be called by requestAnimationFrame
    this.frameId = undefined;  // returned by requestAnimationFrame
    this.onFinish = undefined;  // called when animation finishes
    this._paused = true;
    this._skipping = false;
  }

  play = () => {
    this._cancelPending();
    this._paused = false;
    this._skipping = false;
    let stepper = this.stepper;
    if (stepper === undefined) {  // start new run
      let msPrev = null, iPart = 0;
      const self = this;

      this.stepper = (ms) => {  // argument is window.performance.now();
        self._cancelPending();  // cancel any pending frame requests
        const parts = self.parts;
        let dms = 0;
        if (ms !== null) {
          if (msPrev !== null) {
            dms = ms - msPrev;
            if (dms <= 0) dms = 1;  // assure finite step after start
          }
          msPrev = ms;
          while (parts[iPart].call(self, dms)) {
            iPart += 1;
            if (iPart >= parts.length) {  // whole animation finished
              self.stop();
              return;
            }
            // This is a loop to permit any part to abort on its first call,
            // and to make the initial call to the next part immediately
            // after final call to previous part, rather than waiting for
            // next animation frame request callback.
            dms = 0;
          }
        } else if (!self._skipping) {
          // To wake up from pause, just reset msPrev to huge value.
          // First step after pause will be very short interval (1 ms).
          msPrev = 1.e30;
        } else {
          // no more animation frames, just call every part of animation
          self._skipping = false;
          dms = 1.e20;
          while (true) {
            // call each part with dms=0 then dms=1e20
            if (parts[iPart].call(self, dms) || dms) {
              iPart += 1;
              if (iPart >= parts.length) {
                self.stop();
                return;  // only way out of while loop
              }
              dms = 0;
            } else {
              dms = 1e20;
            }
          }
        }
        self.frameId = requestAnimationFrame(self.stepper);
      }

      this.stepper(window.performance.now());
    } else {  // wake up from pause
      stepper(null);
    }
    return this;  // allow chaining
  }

  pause = () => {
    this._cancelPending();
    this._paused = true;
    return this;
  }

  // stop(true) intended for aborts, suppresses onFinish call
  stop = (noOnFinish=false) => {
    if (this.stepper) {
      this.pause();
      if (this.neverStop) return;
      this.stepper = undefined;
      this.parts.forEach(p => {
        if (p.wantsAnimatorResetCallback) p(null);
      });
      let onFinish = this.onFinish;
      this.onFinish = undefined;
      if (onFinish && !noOnFinish) onFinish.call(self);
    }
    return this;
  }

  skip = () => {
    if (this.stepper) {
      if (this.neverStop) {
        this.pause();
        return;
      }
      this._skipping = true;
      this.stepper(null);
    }
    return this;
  }

  get isPaused() {
    return this._paused;
  }

  get isPlaying() {
    return this.stepper !== undefined;
  }

  _cancelPending = () => {
    let id = this.frameId;
    this.frameId = undefined;
    if (id !== undefined) cancelAnimationFrame(id);
  }
}
