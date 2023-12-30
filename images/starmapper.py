#!/usr/bin/env python
"""starmapper.py

Produce skybox cube maps from NASA plate carree (equirectangular) maps of
the sky at https://svs.gsfc.nasa.gov/4851 and similar sites.  Note that
the exr format can be to png using http://scanline.ca/exrtools/ (which
requires the OpenEXR library development package).  The skybox maps can
be used as textures on the inner surface of a huge cube to draw the
entire night sky (excluding Sun and planets) as the background for 3D
models of outer space.

The input is an image of the sky in equirectangular celestial
coordinates, right ascension along x with twice as many pixels as
declination along y.  The fastest varying or second axis is x, slowest
or first axis is y.  Right ascension decreases with 0h RA at the
center (180 to -180 degrees), while declination decreases from +90 to
-90.  The leftmost and rightmost pixel edges (not centers) are at 12h
RA, while the topmost pixel edge is at +90 DEC.

A skybox is laid out like so (https://learnopengl.com/Advanced-OpenGL/Cubemaps):

       top
left  front  right  back
      bottom

(There is some confusion about whether this box is folded with the
textures on the outside surface or the inside surface, so this picture
is not really unambiguous.  It looks like this labeling corresponds to
texture on the inside surface - which makes sense if you a viewing the
inside of the box; occasionally you see front and back reversed.)

Note that the default front direction is +z (depth) direction, while
the +x direction is right and the +y direction is up, making this a
left handed coordinate system.  A camera looks at (0,0,1) with (0,1,0)
up by default.

             OpenGL   celestial
right    rt   pos x      -y
left     lf   neg x      +y
top      tp   pos y      +z
bottom   bt   neg y      -z
back     bk   pos z      +x
front    fr   neg z      -x

Assuming we put 0h RA at the center of the front face of the skymap,
the back face will take its left half from the right edge of the
equirectangular picture, and its right half from the left edge.
"""

import sys
from PIL import Image
from numpy import (array, asfarray, concatenate, pi, sin, cos, arctan2, sqrt,
                   arange, zeros)
from scipy.ndimage import map_coordinates


def remap(filename, coords="ecliptic"):
    img, radec2img = read_map(filename)
    name, ext = filename.rsplit(".")
    if coords == "galactic":
        name = name + "g"
    elif coords != "ecliptic":
        name = name + "q"
    pattern = name + "_{}." + ext
    for pts, nm in zip(box_xyzs(img), ("fr", "bk", "lf", "rt", "tp", "bt")):
        if coords == "ecliptic":
            pts = ecl2equ(pts)
        elif coords == "galactic":
            pts = gal2equ(pts)
        radec = equ2radec(pts)
        im = radec2img(radec)
        name = pattern.format(nm)
        Image.fromarray(im).save(name, optimize=True)
        print("wrote {}".format(name))


def read_map(filename):
    img = array(Image.open(filename))
    shape = img.shape
    if shape[0]*2 != shape[1]:
        raise ValueError("unexpected image shape: " + str(shape))
    if shape[2] == 4:
        img = img[:, :, :3]
    dx, dy = 2.*pi/shape[1], pi/shape[0]
    # Append image rows at dec=90+dy/2 and -90-dy/2 for bilinear interpolation.
    dt = img.dtype
    im = concatenate((img[:1].mean(axis=0,keepdims=1).astype(dt), img,
                      img[-1:].mean(axis=0,keepdims=1).astype(dt)))
    # ra = pi-dx/2 - i*dx, so i = (pi - ra)/dx  - 1/2
    # dec = pi/2+dy/2 - j*dy, so j = (pi/2 - dec)/dy + 1/2 (with extra row)

    # Construct a function that maps radec = (ra, dec) to image value
    def radec2img(radec, output=None):
        ra, dec = asfarray(radec)
        i = (pi - ra)/dx - 0.5
        j = (0.5*pi - dec)/dy + 0.5
        is_scalar = not ra.shape
        if is_scalar:
            i, j = [i], [j]
        rgb = map_coordinates(im[:,:,0], [j, i], output, 1, "grid-wrap")
        rgb = rgb[..., None] + array([0, 0, 0], rgb.dtype)
        rgb[...,1] = map_coordinates(im[:,:,1], [j, i], output, 1, "grid-wrap")
        rgb[...,2] = map_coordinates(im[:,:,2], [j, i], output, 1, "grid-wrap")
        return rgb[0] if is_scalar else rgb

    # Return padded image and functions that convert (dec, ra) coordinates
    # in radians to indices into this array.
    # Note that the final axis of img is rgb.
    return img, radec2img


def box_xyzs(img):
    size = (img.shape[1] // 4) if (hasattr(img, "shape") and img.shape) else img
    dx = 2. / size
    m2p = arange(-1., 0.999999, dx) + 0.5*dx
    p2m = arange(1., -0.999999, -dx) - 0.5*dx
    zero = zeros((size, size))
    one = zero + 1.
    fr = array([one, p2m+zero, p2m[:, None]+zero])
    bk = fr * array([-one, -one, one])
    lf = array([m2p+zero, one, p2m[:, None]+zero])
    rt = lf * array([-one, -one, one])
    tp = array([m2p[:, None]+zero, p2m+zero, one])
    bt = tp * array([-one, one, -one])
    return fr, bk, lf, rt, tp, bt


# Convert equatorial xyz to (ra, dec) in radians.
# Returns ra<0 instead of ra>pi), which is consistent with above radec2ji.
def equ2radec(xyz):
    x, y, z = asfarray(xyz)
    r = sqrt(x**2 + y**2)
    return arctan2(y, x), arctan2(z, r)


# Convert ecliptic xyz coordinates to equatorial coordinates.
def ecl2equ(xyz):
    x, y, z = asfarray(xyz)
    eps = 23.43928 * pi/180.  # JPL Approximate Positions of Planets
    ceps, seps = cos(eps), sin(eps)
    return x, y*ceps - z*seps, y*seps + z*ceps


# Convert galactic xyz coordinates to equatorial coordinates.
def gal2equ(xyz):
    global _gal2equ
    if _gal2equ is None:
        rap = 192.85 * pi/180.  # right ascension of north galactic pole
        decp = 27.13 * pi/180.  # declination of north galactic pole
        rac = 266.40 * pi/180.  # right ascension of galactic center
        decc = -28.94 * pi/180.  # declination of galactic center
        # lcp = 122.93314 * pi/180.  # galactic latitude of north celestial pole
        xp = cos(decp)
        xp, yp, zp = xp*cos(rap), xp*sin(rap), sin(decp)
        # galactic (0,0,1) maps tp (xp, yp, zp)
        xc = cos(decc)
        xc, yc, zc = xc*cos(rac), xc*sin(rac), sin(decc)
        # Make (xc, yc, zc) exactly orthogonal to (xp, yp, zp)
        dot = xp*xc + yp*yc + zp*zc
        xc -= xp*dot
        yc -= yp*dot
        zc -= zp*dot
        dot = sqrt(xc**2 + yc**2 + zc**2)
        xc /= dot
        yc /= dot
        zc /= dot
        # galactic (1,0,0) maps tp (xc, yc, zc)
        xy, yy, zy = yp*zc - zp*yc, zp*xc - xp*zc, xp*yc - yp*xc
        # galactic (0,1,0) maps tp (xy, yy, zy)
        _gal2equ = array([[xc, xy, xp], [yc, yy, yp], [zc, zy, zp]])
    return _gal2equ.dot(asfarray(xyz).transpose([1,0,2]))

_gal2equ = None


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] in ["-h", "--help"]:
        print("Usage: starmapper.py filename [ecliptic|equatorial|galactic]")
    else:
        filename = sys.argv[1]
        coords = "ecliptic"
        if len(sys.argv) > 2:
            arg = sys.argv[2]
            if arg.startswith("eq"): coords = "equatorial"
            elif arg.startswith("g"): coords = "galactic"
        remap(filename, coords)

