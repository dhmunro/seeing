/**
 * @file Animation class handles javascript animations.
 * @author David H. Munro
 * @copyright David H. Munro 2023
 * @license MIT
 */

/**
 * Wrapper for animation details.  Animation offers play(), pause(), stop(),
 * and also skip() to advance to final frame of entire animation.
 * Set the onFinish property to a callback when the entire animation
 * completes.  It will be called with `this` set to this animator.
 *
 * @param {Function|Number} part - Either a callback to generate next frame
 *    or a delay time (ms).  A delay time pauses the animation for the
 *    specified time before beginning the next part.  A callback function
 *    has one or two arguments callback(dt, t), where dt is the time elapsed
 *    since the previous call (ms) and t is the total time elapsed since the
 *    beginning of the animation.  The callback must return true when
 *    this part of the animation has finished; false to be called again.
 *    The argument dt=0 indicates that this is the first callback for this
 *    part.  Callbacks are invoked with `this` set to Animation instance, so
 *    you can access other data you have stored as properties.
 */
export class Animation {
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
      let msElapsed = 0, msPrev = null, iPart = 0;
      const self = this;

      this.stepper = (ms) => {  // argument is window.performance.now();
        self._cancelPending();  // cancel any pending frame requests
        const parts = self.parts;
        let dms = 0;
        if (document[_hidden]) {
          msPrev = null;  // act like implicit pause
        } else if (ms !== null) {
          if (msPrev !== null) {
            dms = ms - msPrev;
            msElapsed += (dms > 0)? dms : 0;
          }
          msPrev = ms;
          if (dms <= 0) dms = 1;  // assure finite step after start
          while (parts[iPart].call(self, dms, msElapsed)) {
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
            if (parts[iPart].call(self, dms, 1.e20) || dms) {
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

const _hidden = (function() {
  let key;
  for (key of ["hidden", "webkitHidden", "mozHidden", "msHidden"]) {
    if (key in document) break;
  }
  return key;
})();

/**
 * Interpolator for transitions with optional ease-in and ease-out.
 *
 * @param {Number|Array} ms or [ms, msInOut] ot [ms, msIn, msOut]
 * @return {Function} - interp(t) runs from 0 to 1
 *                        as t runs from 0 to msIn + ms + msOut.
 *
 * Interpolator function has property msDelta = msIn + ms + msOut.
 */
export function interpEase(ms, msIn, msOut) {
  if (ms instanceof Array) [ms, msIn, msOut] = ms;
  if (msIn === undefined) {
    msIn = 0;
    if (msOut === undefined) msOut = 0;
  } else if (msOut === undefined) {
    msOut = msIn;
  }
  const msDelta = 0.5*msIn + ms + 0.5*msOut;
  let f;
  if (msDelta <= 0) {
    f = t => 1;
  } else if (msOut === 0) {
    if (msIn === 0) {
      const k0 = 1 / msDelta;
      f = t => t * k0;
    } else {
      const t1 = msIn, c1 = 0.5*t1, k1 = 1/msDelta, k0 = k1*0.5/t1;
      f = t => (t < t1)? k0*t**2 : k1*(t - c1);
    }
  } else {
    if (msIn === 0) {
      const t1 = ms, k0 = 1/msDelta, k1 = k0*0.5/msOut;
      const c1 = ms + msOut;
      f = t => (t <= t1)? k0*t : ((k0*t >= 1)? 1 : 1 - k1*(c1 - t)**2);
    } else {
      const t1 = msIn, c1 = 0.5*t1, k1 = 1/msDelta;
      const k0 = k1*0.5/t1, t2 = t1 + ms, c2 = t2 + msOut, k2 = k1*0.5/msOut;
      f = t => {
        if (t <= t2) return (t < t1)? k0*t**2 : k1*(t - c1);
        return (k1*t >= 1)? 1 : 1 - k2*(c2 - t)**2;
      }
    }
  }
  f.msDelta = msDelta;
  f.ms = 0;
  f.ms0 = 0;
  return f;
}

/*
 * Want to be able to run interpolator function backwards, f(ms0 - ms).
 * Also want to be able to restart flip backwards to forwards, f(ms0 + ms).
 */

/**
 * Transition is a derived class of Animation specialized for changing
 * something smoothly from one state to another.
 *
 * @param {Number} ms, msIn, msOut - implicit timing() call
 *
 * Each action will be called successively with the step index plus the
 * fraction of the step to advance the transition.  When the transition
 * begins to play, the first call will always be action(0), and when
 * the transition ends, the final call will always be action(1).
 *
 * The timing method takes 0, 1, 2, or 3 arguments:
 *   timing() - resets the transition to no timings or actions like reset()
 *   timing(ms) - linearly interpolates elapsed time to argument of callback
 *   timing(ms, msInOut) - ease in and out over msInOut before and after ms
 *   timing(ms, msIn, msOut) - different ease in and ease out times
 * A call to the timing method is generally followed by a call to the actions
 * method; those actions will be executed repeatedly as action(x) with x
 * running from 0 to 1 (the first call will have x=0, and the final call will
 * have x=1).  If no actions are specified, the transition simply waits for
 * the specified time.  (If the total time is 0 or less, actions will be
 * called only once as action(1).)
 *
 * Calling timing (with at least one argument) a second time chains the
 * first transition to another; a following actions call sets the actions
 * for that second transition.  Calling actions a second time before the
 * next call to timing simply appends more actions to be done for the
 * most recent timing in the chain.  You can chain any number of transitions.
 *
 * When you play the transition, it resets itself, so you can only play
 * it once.  You can use the save and restore methods to reconstruct the
 * transition if you do not want this behavior.  Note that save(true)
 * automatically does a restore when the transition ends, so it can be
 * played multiple times.
 */
export class Transition extends Animation {
  constructor(ms, msIn, msOut) {
    super((dms, ms) => {
      const interp = self._interps[0], actions = self._actions[0];
      if (!interp) return true;
      const ms0 = interp.ms0;
      ms += ms0;
      if (ms0 < 0) {
        ms = -ms;
        if (ms < 0) ms = 0;
      }
      let x = interp(ms);
      interp.ms = ms;
      let done;
      if (ms0 >= 0) {
        done = (x >= 1);
        if (done) x = 1;
      } else {
        done = (x <= 0);
        if (done) x = 0;
      }
      actions.forEach(f => f.call(self, x));  // actions may be []
      if (done) {
        self._interps.shift();
        self._actions.shift();
        if (!self._interps[0]) {
          self.restore();
          return true;
        }
      }
      return false;
    });
    const self = this;
    this._interps = [];
    this._actions = [];
    this.timing(ms, msIn, msOut);
  }

  reset(toAuto) {
    this._interps.splice(0, this._interps.length);
    this._actions.splice(0, this._actions.length);
    if (this._auto) {
      if (toAuto) this.restore(this._auto);
      else delete this._auto;
    }
  }

  timing(ms, msIn, msOut) {
    if (this.isPlaying) {
      this.stop(true);
      this.reset();
    }
    const {interps, actions} = this;
    if (ms === undefined) {
      this.reset();
    } else {
      this._interps.push(interpEase(ms, msIn, msOut));
      this._actions.push([]);
    }
    return this;
  }

  actions(...callbacks) {
    if (this.isPlaying) {
      this.stop(true);
      this.reset();
    }
    const actions = this._actions;
    if (actions.length) actions[actions.length-1].push(...callbacks);
    return this;
  }

  get queued() {
    return this._interps.length;
  }

  pop(soft) {
    const interps = this._interps;
    const actions = this._actions;
    const len = interps.length;
    if (soft && len == 1) {
      // Do not pop off last timing/actions pair, just reverse direction,
      // so it plays backwards to its initial state.
      // Exception is if last pair has never played, then call actions
      // once for initial state and pop them off of queue.
      const playing = !this.isPaused;
      this.stop();  // reset ms to 0 on next callback
      const ms = interps[0].ms;  // most recent argument, current position
      if (interps[0].ms0 >= 0) {
        if (ms == 0) {
          actions.forEach(f => f.call(self, 0));  // actions may be []
          interps.splice(0, 1);
          actions.splice(0, 1);
          playing = false;
        } else {
          interps[0].ms0 = -ms;  // run backwards from current position
        }
      } else {
        interps[0].ms0 = ms;  // run forwards from current position
      }
      if (playing) this.play();
    } else {
      interps.splice(len-1, 1);
      actions.splice(len-1, 1);
    }
    return interps.length;
  }

  save(auto) {
    const saved = [this._interps.map(x => x), this._actions.map(x => x)];
    if (auto) this._auto = saved;
    else delete this._auto;
    return saved;  // cannot chain this
  }

  restore(saved) {
    if (saved === undefined) {
      saved = this._auto;
      if (saved === undefined) return this;
    }
    const interps = this._interps;
    const actions = this._actions;
    interps.splice(0, interps.length);
    actions.splice(0, actions.length);
    interps.push(...saved[0]);
    actions.push(...saved[1]);
    return this;
  }
}

/**
 * Helper function to linearly interpolate parameter list.
 *
 * @param {Array} from - list of numerical parameters initial values
 * @param {Array} to - list of numerical parameters final values
 * @param {Number} x - fraction between 0 and 1
 * @return {Array} - list of values fraction x between from and to
 */
export function linterp(from, to, x) {
  if (x < 0) x = 0;
  else if (x > 1) x = 1;
  return from.map((v, i) => (1-x)*v + x*to[i]);
}
