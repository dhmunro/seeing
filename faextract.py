#!/usr/bin/env python
"""
Extract a few fontawesome icons from a downloaded sprite file, producing
a new much smaller sprite file.

faextract.py output.svg spritefile.svg icon_id1 icon_id2 ...

where spritefile is solid, regular, etc. file in sprites subdirectory of
the "For The Web" download at fontawesome.com/download.
"""
import sys

def faextract(output, spritefile, icons):
    if not output.endswith(".svg"):
        output += ".svg"
    if not spritefile.endswith(".svg"):
        spritefile += ".svg"
    dst = open(output, "w")
    with open(spritefile) as src:
        for line in src:
            dst.write(line)
            if line.startswith("<svg"): break
        for line in src:
            if line.startswith("</svg"): break
            if not line.startswith("<symbol"): continue
            i = line.find("id=", 7)
            if i < 7 or i+5 >= len(line): continue  # ignore serious problem...
            j = line.find(line[i+3], i+4)
            if line[i+4:j] not in icons: continue
            dst.write(line)
            dst.write(src.readline())
            dst.write(src.readline())
        dst.write(line)
    dst.close()

if __name__ == "__main__":
    sys.argv.pop(0)
    output = sys.argv.pop(0)
    spritefile = sys.argv.pop(0)
    print(output, spritefile, sys.argv)
    faextract(output, spritefile, sys.argv)
