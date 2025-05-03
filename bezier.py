"""Translate CSS easing function to piecewise cubic

The knot points of the cubic are equally spaced to make it easy to perform
the interpolation.

First, find the values of the function and its first derivative at many points
in the interval by bisecting the original [0, 1] andpoints and the provided
control points several times.  This results in a list of x, y, and dy/dx values
which determine a piecewise cubic y(x) that very closely approximates the
Bezier curve.  By evaluating this function and its derivative at a few equally
spaced x values covering [0, 1], we can derive a small set of piecewise
polynomial coefficients comprising the final simplified form.

CSS default values:
ease         [[0, 0], [.25, .1], [.25, 1], [1, 1]]
ease-in      [[0, 0], [.42, 0], [1, 1], [1, 1]]
ease-out     [[0, 0], [0, 0], [.58, 1], [1, 1]]
ease-in-out  [[0, 0], [.42, 0], [.58, 1], [1, 1]]

The hardest one to accurately fit with a uniform piecewise cubic is "ease",
which requires n=5 intervals (20 coefficients) to get sub-percent accuracy.
Here are the n=2 coefficients for ease-in and ease-out, good to 0.00274:
ease-in:
    -0.99641585,  1.73761391,  0.        ,  0.
    -0.2740442 ,  1.08596399,  0.19364273, -0.01889653
     0.63221727, -0.90863995,  1.64476602, -0.36834334
ease-out:
     0.63221727, -0.98801186,  1.72413793,  0.
    -0.2740442 , -0.26383139,  1.54343811,  0.01333402
    -0.99641585,  1.25163365,  0.48598026,  0.25880195
And for ease-in-out, good to 0.00172
     0.0248329 ,  2.07769571,  0.        ,  0.
    -3.88697388,  5.83046081, -1.19790781,  0.12721044
     0.0248329 , -2.15219442,  4.22989013, -1.10252861
Here are the n=6 coefficients for ease, good to 0.00274:
     -2.92032048,   6.03097489,   0.4       ,   0.
    -11.25427161,   7.28784683,   0.67553861,  -0.0422531 
      2.09984154,  -4.9904124 ,   4.40967372,  -0.41731056
      1.42398262,  -3.93101673,   3.85717224,  -0.32142638
      0.74379963,  -2.58692153,   2.97195595,  -0.12712213
      0.42092685,  -1.78755675,   2.31233296,   0.05429695

Two part piecewise cubic optima:
ease-in, good to 0.00345, split at 0.55974585:
    -0.74015112,  1.64384427,  0.        ,  0.
     0.39179008, -0.25841715,  1.06560198, -0.19897492
ease-out, good to 0.00345, split at 0.44025426:
     0.39178986, -0.916953  ,  1.72413793,  0.
    -0.74015128,  0.57660948,  1.06723489,  0.09630692
ease-in-out, good to 0.00443, split at 0.5:
    -0.50782681,  2.25391341,  0.        ,  0.
    -0.50782681, -0.73043297,  2.98434637, -0.74608659
        has nudge = [0., 0., 0.14890537]
ease, good to 0.00660, split at  0.22399346:
    -7.935681  ,  6.92937852,  0.4       ,  0.
     1.04553848, -3.40785808,  3.6791007 , -0.31678111
        generated with nudge0 = [0.005, 0., 0.03]
"""

from numpy import (asarray, concatenate, arange, digitize, newaxis, floor,
                   array, where, zeros)
from scipy.optimize import brent, minimize


class BezierSpline(object):
    def __init__(self, xy, full=True, nudge0=None, tol=1.e-5):
        xy = asarray(xy, float)
        xy = array([[0., 0.], *xy, [1., 1.]])
        self.xy = xy
        xysub = self.subdivide(10)[:2]  # 1025 points
        tsplit, check, n, nc = brent(self.bs, (xysub,),
                                     (0.01, 0.99), 1.e-6, True)
        nudge = zeros(3)
        if full:
            if nudge0 is not None:
                nudge = nudge0
            fun = lambda x: self.bs(tsplit+x[0], xysub, x[1:])
            bnds = (-0.03, 0.03), (-0.02, 0.02), (-0.2, 0.2)
            res = minimize(fun, nudge, bounds=bnds, tol=tol)
            if not res.success:
                print("warning: minimize failed:", res)
            nudge, check, n, nc = res.x, res.fun, res.nit, res.nfev
        self.nudge = nudge
        self.xsplit, self.coefs = self.bispline(tsplit+nudge[0], nudge[1:])
        self.check = check

    def subdivide(self, n=8, t=0.5, xy=None, ab=False):
        if xy is None:
            xy = self.xy
        a, b, xy = xy[1:2], xy[2:3], xy[0::3]
        t = float(t)
        u = 1. - t
        sz = 1
        while n > 0:  # 2**n is number of intervals in result, 2**n+1 points
            n -= 1
            aa, p, bb = u*xy[:-1] + t*a, u*a + t*b, u*b + t*xy[1:]
            a, b, xy = aa.repeat(2, 0), bb.repeat(2, 0), xy.repeat(2, 0)[:-1]
            bb, aa = u*aa + t*p, u*p + t*bb
            b[::2], a[1::2], xy[1:-1:2] = bb, aa, u*bb + t*aa
        if ab:
            return xy, a, b
        # default is to return x, y, dydx at n+1 points on spline
        dxy = xy.copy()
        dxy[1:] -= b
        dxy[0] = (a[0] if any(dxy[0] != a[0]) else b[0]) - dxy[0]
        if not any(dxy[-1]):
            dxy[-1] = xy[-1] - a[-1]
        return xy[:, 0], xy[:, 1], dxy[:, 1]/dxy[:, 0]

    def bezier(self, t, nodydx=True):
        t = asarray(t, float)[..., newaxis];
        u = 1. - t
        xy = self.xy
        a, p, b = u*xy[0] + t*xy[1], u*xy[1] + t*xy[2], u*xy[2] + t*xy[3]
        a, b = u*a + t*p, u*p + t*b
        x, y = (u*a + t*b).T
        if nodydx:
            return x, y
        dxy = b - a
        return x, y, dxy[..., 1]/dxy[..., 0]

    def bispline(self, t, nudge=None):
        """return pair of spline coefficients to split interval at t"""
        t = float(t)
        (x0, x2), (y0, y2), (yp0, yp2) = self.subdivide(0)
        x1, y1, yp1 = self.bezier(t, False)
        if nudge is not None:
            y1 += nudge[0]
            yp1 += nudge[1]
        lo = self.getcoefs(x0, x1, y0, y1, yp0, yp1)
        hi = self.getcoefs(x1, x2, y1, y2, yp1, yp2)
        return x1, array([lo, hi])

    def bs(self, t, xysub=None, nudge=None):
        xsplit, lohi = self.bispline(t, nudge)
        if xysub is None:
            xysub = self.subdivide(10)[:2]  # 1025 points
        x, y = xysub
        coefs = lohi[where(x <= xsplit, 0, 1)].T
        ys = coefs[0]
        for c in coefs[1:]:
            ys *= x
            ys += c
        return abs(y - ys).max()

    @staticmethod
    def getcoefs(x0, x1, y0, y1, yp0, yp1):
        dx = x1 - x0
        yt0, yt1 = dx*yp0, dx*yp1
        # y = y0*u**2*(1+2*t) + yt0*u**2*t - yt1*u*t**2 + y1*t**2*(1+2*u)
        #   = y0*(1-3t^2+2t^3)+yt0*(t-2t^2+t^3)-yt1*(t^2-t^3)+y1*(3*t^2-2*t^3)
        #   = y0 + yt0*t + c2*t**2 + c3*t**3
        # c2 = 3*(y1 - y0) - (yt1 + 2*yt0)
        # c3 = (yt1 + yt0) - 2*(y1 - y0)
        # yt = yt0 + 2*c2*t + 3*c3*t**2
        dy, yts = y1 - y0, yt1 + yt0
        c2 = 3.*dy - yts - yt0
        c3 = yts - 2.*dy
        t0 = x0/dx
        c0 = y0 - ((c3*t0 - c2)*t0 + yt0)*t0
        c1 = yt0 + (3.*c3*t0 - 2.*c2)*t0
        c2 -= 3.*c3*t0
        dx2 = dx**2
        return array([c3/(dx2*dx), c2/dx2, c1/dx, c0])

    def __call__(self, x):
        x = asarray(x, float).clip(0., 1.)
        coefs = self.coefs[where(x <= self.xsplit, 0, 1)].T
        y = coefs[0]
        for c in coefs[1:]:
            y *= x
            y += c
        return y


class BezierEvaluator(object):
    def __init__(self, xy, n=3, m=8):  # xy is [p1, p2]
        xy = array([[0., 0.], *asarray(xy, float), [1., 1.]])
        self.xy, self.n, self.m = xy.copy(), n, m
        xy, dydx = self.bisect_spline(m)  # unnecessary except for check...
        x0= xy[0, 0]
        dx = (xy[-1, 0] - x0) / n
        self.x0, self.dx = x0, dx
        x, y, dydx = self.sample_spline(xy, dydx)
        # f = u**2*(1+2*t)*y0 + u**2*t*fp0 - t**2*u*fp1 + t**2*(1+2*u)*y1
        # fp = -6*u*t*y0 + u*(1-3*t)*fp0 + t*(1-3*u)*fp1 + 6*u*t*y1
        # fpp = fp1 - fp0 + 3*(u-t)*(2*(y1 - y0) - (fp1 + fp0))
        # fppp = 6*(fp1 + fp0 - 2*(y1 - y0))
        # --> fpp0 = fp1 - fp0 - fppp/2
        #     fpp1 = fp1 - fp0 + fppp/2
        # fp = dydx*dx, fpp = d2ydx2*dx**2, fppp = d2ydx3*dx**3
        fp = dydx * dx
        fppp6 = fp[1:] + fp[:-1] - 2.*(y[1:] - y[:-1])
        fpp = fp[1:] - fp[:-1] - 3.*fppp6
        dx2 = dx*dx
        coefs = array([fppp6/(dx2*dx), fpp*0.5/dx2, dydx[:-1], y[:-1]])
        # eliminate need to make x be relative to beginning of interval
        xx = x0 + dx*arange(n)
        c3, c2, c1, c0 = coefs
        c0 -= ((c3*xx - c2)*xx + c1)*xx
        c1 += (3.*c3*xx - 2.*c2)*xx
        c2 -= 3.*c3*xx
        coefs = concatenate((array([[0.], [0.], [0.], y[0:1]]), coefs,
                             array([[0.], [0.], [0.], y[-1:]])), 1)
        self.coefs = coefs
        # Check against original spline
        f = self(xy[:, 0]) - xy[:, 1]
        self.check = (xy[f.argmin(), 0], f.min()), (xy[f.argmax(), 0], f.max())

    def bisect_spline(self, m):
        xy = self.xy
        xy, a, b = bezier_bisect(xy[::3], xy[1:2], xy[2:3], m)
        dxy = xy.copy()
        dxy[1:] -= b
        dxy[0] = a[0] - xy[0]
        if dxy[0, 0] == 0:  # handle duplicate endpoints as special case
            dxy[0] = b[0] - a[0]
        elif dxy[-1, 0] == 0:
            dxy[-1] = b[-1] - a[-1]
        return xy, dxy[:, 1] / dxy[:, 0]  # = dy/dx

    def sample_spline(self, xy, dydx, n=None):
        if n is not None:
            x00 = xy[0, 0]
            dx0 = (xy[-1, 0] - xy[0, 0]) / n
        else:
            x00, dx0, n = self.x0, self.dx, self.n
        x = x00 + dx0*arange(n+1)
        ip = digitize(x, xy[:, 0]).clip(1, xy.shape[0]-1)
        (x0, y0), (x1, y1) = xy[ip-1].T, xy[ip].T
        dx = x1 - x0
        dydt0, dydt1 = dydx[ip-1]*dx, dydx[ip]*dx
        t = ((x - x0)/dx).clip(0., 1.)  # fractional position in interval
        # f = u**2*(1+2*t)*y0 + u**2*t*fp0 - t**2*u*fp1 + t**2*(1+2*u)*y1
        #   = u**2*(y0 + t*(2*y0+fp0)) + t**2*(y1 + u*(2*y1-fp1))
        # f' = -6*u*t*y0 + u*(1-3*t)*fp0 + t*(1-3*u)*fp1 + 6*u*t*y1
        #    = u*(fp0-3*t*(2*y0+fp0)) + t*(fp1+3*u*(2*y1-fp1))
        u = 1. - t
        c0, c1 = 2.*y0 + dydt0, 2.*y1 - dydt1
        y = u**2*(y0 + t*c0) + t**2*(y1 + u*c1)
        dydt = u*(dydt0 - 3*t*c0) + t*(dydt1 + 3*u*c1)
        return x, y, dydt/dx

    def __call__(self, x):
        x = asarray(x, float)
        i = floor((x - self.x0) / self.dx).astype(int).clip(-1, self.n)
        y = 0. * x
        for c in self.coefs[:, i+1]:
            y *= x
            y += c
        return y


def bezier_bisect(f, a, b, n=1):
    """Given endpoints f and control points a and b, return doubled fp, ap, bp

    If a and b have N points, f must have N+1.
    The returned a and b have 2*N.
    """
    f, a, b = asarray(f, float), asarray(a, float), asarray(b, float)
    while n > 0:
        n -= 1;
        f0, f1 = f[:-1], f[1:]
        p, q, r = 0.5*(f0 + a), 0.5*(a + b), 0.5*(b + f1)
        s, t = 0.5*(p + q), 0.5*(q + r)
        f = concatenate((f, f1), 0)
        f[:-1:2], f[1::2] = f0, 0.5*(s + t)
        a = concatenate([p[:, newaxis, ...], t[:, newaxis, ...]], 1)
        b = concatenate([s[:, newaxis, ...], r[:, newaxis, ...]], 1)
        shape = f[:-1].shape
        a, b = a.reshape(shape), b.reshape(shape)
    return f, a, b
