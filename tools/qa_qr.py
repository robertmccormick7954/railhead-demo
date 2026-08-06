#!/usr/bin/env python3
"""
Verify Railhead's own QR encoder two independent ways.

  1. STRUCTURAL — every module is compared against a reference encoder at the
     same version, EC level and mask. The reference is forced into byte mode,
     because it would otherwise pick alphanumeric mode for an uppercase-only
     payload and the two matrices would legitimately differ.

  2. FUNCTIONAL — the rendered image is decoded back to the original string.
     This is the check that actually matters: a decoder validates the format
     bits, the unmasking, the block de-interleaving and the Reed-Solomon
     correction, so a clean round trip exercises the whole pipeline.

Run:  node tools/qa_qr.mjs && python3 tools/qa_qr.py
"""

import json
import os
import sys

import qrcode
from qrcode.util import QRData, MODE_8BIT_BYTE
from PIL import Image
from pyzbar.pyzbar import decode

HERE = os.path.dirname(os.path.abspath(__file__))
MATRICES = os.path.join(HERE, "..", "research", "qr_out.json")

LEVELS = {
    "L": qrcode.constants.ERROR_CORRECT_L,
    "M": qrcode.constants.ERROR_CORRECT_M,
    "Q": qrcode.constants.ERROR_CORRECT_Q,
    "H": qrcode.constants.ERROR_CORRECT_H,
}


def render(grid, quiet=4, scale=4):
    n = len(grid)
    img = Image.new("1", ((n + 2 * quiet) * scale,) * 2, 1)
    px = img.load()
    for y in range(n):
        for x in range(n):
            if grid[y][x]:
                for dy in range(scale):
                    for dx in range(scale):
                        px[(x + quiet) * scale + dx, (y + quiet) * scale + dy] = 0
    return img.convert("RGB")


def main():
    if not os.path.exists(MATRICES):
        sys.exit("run `node tools/qa_qr.mjs` first")
    rows = json.load(open(MATRICES))

    struct_ok = struct_bad = dec_ok = dec_bad = 0
    failures = []

    for r in rows:
        if r.get("error"):
            continue
        grid = [[c == "1" for c in line] for line in r["modules"].split("\n")]
        n = len(grid)

        ref = qrcode.QRCode(
            version=r["version"], error_correction=LEVELS[r["ec"]],
            border=0, mask_pattern=r["mask"],
        )
        ref.add_data(QRData(r["text"].encode("utf-8"), mode=MODE_8BIT_BYTE, check_data=False))
        ref.make(fit=False)
        refm = ref.get_matrix()
        same = len(refm) == n and all(
            bool(refm[y][x]) == grid[y][x] for y in range(n) for x in range(n)
        )
        if same:
            struct_ok += 1
        else:
            struct_bad += 1
            diff = sum(1 for y in range(n) for x in range(n) if bool(refm[y][x]) != grid[y][x])
            failures.append(f"STRUCTURE v{r['version']}-{r['ec']} mask {r['mask']}: {diff} modules differ")

        got = [d.data.decode("utf-8") for d in decode(render(grid))]
        if got and got[0] == r["text"]:
            dec_ok += 1
        else:
            dec_bad += 1
            failures.append(f"DECODE v{r['version']}-{r['ec']}: got {got[:1]!r} for {r['text'][:40]!r}")

    combos = sorted({(r["version"], r["ec"]) for r in rows if not r.get("error")})
    print(f"structural: {struct_ok} passed, {struct_bad} failed")
    print(f"decode:     {dec_ok} passed, {dec_bad} failed")
    print(f"exercised:  {len(combos)} version/EC combinations — "
          + ", ".join(f"v{v}-{e}" for v, e in combos))
    for f in failures[:12]:
        print("  FAIL", f)
    return 1 if (struct_bad or dec_bad) else 0


if __name__ == "__main__":
    sys.exit(main())
