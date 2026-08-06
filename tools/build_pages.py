#!/usr/bin/env python3
"""
Railhead — static page assembly.

Pages are content fragments in pages/. Each carries a small JSON front matter
block and is wrapped in the shared layout to produce docs/<name>.html.

Why a build step rather than twenty hand-written files: the header, the
mandatory retailer disclosure, the footer and the demo notice must be identical
everywhere. Hand-copying them across twenty pages guarantees they drift, and the
disclosure is the one piece of chrome that is not allowed to.

Run: python3 tools/build_pages.py
"""

import json
import os
import re
import sys
import html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGES = os.path.join(ROOT, "pages")
SITE = os.path.join(ROOT, "docs")

FRONT_MATTER = re.compile(r"^\s*<!--railhead\s*(\{.*?\})\s*-->", re.S)

LAYOUT = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="website">
<link rel="icon" href="{root}assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{root}assets/img/icon-180.png">
<link rel="preload" href="{root}assets/fonts/publicsans-latin-300-800-n.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{root}assets/fonts/archivo-latin-400-800-n.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{root}assets/fonts/fonts.css">
<link rel="stylesheet" href="{root}assets/css/tokens.css">
<link rel="stylesheet" href="{root}assets/css/app.css">
<link rel="stylesheet" href="{root}assets/css/print.css" media="print">
<script>
/* Paint the storefront's brand colour before first paint, so the page does not
   flash the house palette and then repaint. */
(function () {{
  try {{
    var t = new URLSearchParams(location.search).get('tenant') || localStorage.getItem('railhead.tenant');
    if (t) document.documentElement.dataset.tenant = t;
    var c = localStorage.getItem('railhead.brandcache');
    if (c) {{
      c = JSON.parse(c);
      if (c.id === t) {{
        var r = document.documentElement.style;
        for (var k in c.vars) r.setProperty(k, c.vars[k]);
      }}
    }}
  }} catch (e) {{ /* private mode: fall through to the default palette */ }}
}})();
</script>
</head>
<body data-nav="{nav}" data-depth="{depth}" data-page="{name}">
<a class="skip-link" href="#main">Skip to content</a>
<div id="disclosure-strip" class="disclosure-strip"></div>
<header id="site-header" class="site-header"></header>
<main id="main">
{content}
</main>
<footer id="site-footer" class="site-footer"></footer>
<script type="module" src="{root}assets/js/pages/{script}.js"></script>
</body>
</html>
"""

CANONICAL_BASE = "https://railhead-demo.example/"


def build_page(path):
    raw = open(path, encoding="utf-8").read()
    m = FRONT_MATTER.match(raw)
    if not m:
        sys.exit(f"{path}: missing front matter")
    meta = json.loads(m.group(1))
    content = raw[m.end():].strip()

    name = os.path.splitext(os.path.relpath(path, PAGES))[0].replace(os.sep, "/")
    depth = name.count("/")
    root = "../" * depth

    out = LAYOUT.format(
        nav=meta.get("nav", ""),
        depth=depth,
        name=name,
        title=html.escape(meta["title"]),
        description=html.escape(meta["description"]),
        robots=meta.get("robots", "noindex, nofollow"),
        canonical=CANONICAL_BASE + name + ".html",
        root=root,
        content=content,
        script=meta.get("script", "generic"),
    )
    dest = os.path.join(SITE, name + ".html")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(out)
    return name, len(out), meta


def main():
    if not os.path.isdir(PAGES):
        sys.exit("no pages/ directory")
    found = []
    for dirpath, _dirs, files in os.walk(PAGES):
        for f in sorted(files):
            if f.endswith(".html") and not f.startswith("_"):
                found.append(os.path.join(dirpath, f))
    if not found:
        sys.exit("no page fragments found")

    scripts_needed = set()
    for path in sorted(found):
        name, size, meta = build_page(path)
        scripts_needed.add(meta.get("script", "generic"))
        print(f"  {name + '.html':38s} {size / 1024:6.1f} KB")

    print(f"\n  {len(found)} pages built")
    missing = [s for s in sorted(scripts_needed)
               if not os.path.exists(os.path.join(SITE, "assets", "js", "pages", s + ".js"))]
    if missing:
        print(f"  ! page scripts referenced but not present: {', '.join(missing)}")
        return 1
    return 0


if __name__ == "__main__":
    print("Railhead page build")
    sys.exit(main())
