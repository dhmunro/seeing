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

/* ------------------------------------------------------------------------ */

// See https://github.com/rafgraph/fscreen
(function () {

})();

/* ------------------------------------------------------------------------ */
