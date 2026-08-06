#!/usr/bin/env python3
"""
Railhead — whole-site QA gate.

Loads every built page in a real browser, on three viewports, for every tenant,
and checks the things that screenshots do not catch.

Contrast is measured by walking the rendered tree and compositing translucent
backgrounds against what is actually behind them — reading the declared colour
is how invisible text ships.

Run:  python3 tools/qa_site.py [--base http://localhost:8811]
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(os.path.dirname(HERE), "docs")

PLACEHOLDERS = [
    r"lorem ipsum", r"\bTODO\b", r"\bTBD\b", r"coming soon", r"placeholder",
    r"\bFIXME\b", r"insert (?:your|the) ", r"\bxxx+\b", r"dolor sit amet",
    r"\[[A-Z_ ]{3,}\]", r"sample text",
]

CONTRAST_JS = r"""
() => {
  const parseRGB = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // Effective background: walk up compositing every translucent layer, and
  // fold in each ancestor's opacity, which multiplies down the tree.
  const bgOf = (el) => {
    let acc = null;
    let node = el;
    while (node && node !== document.documentElement.parentNode) {
      const cs = getComputedStyle(node);
      let c = parseRGB(cs.backgroundColor);
      const op = parseFloat(cs.opacity);
      if (c && c.a > 0) {
        if (!isNaN(op) && op < 1) c = { ...c, a: c.a * op };
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const white = { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, white) : white;
  };

  const out = [];
  const nodes = document.querySelectorAll('body *');
  for (const el of nodes) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    // only elements with their own visible text
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) === 0) continue;
    // WCAG 1.4.3 exempts inactive user interface components.
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest('[disabled],[aria-disabled="true"]')) continue;
    let fg = parseRGB(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    if (fg.a < 1) fg = over(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3.0 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 60),
        text: text.slice(0, 50),
        ratio: Math.round(r * 100) / 100,
        need,
        size: Math.round(size * 10) / 10,
        color: cs.color,
      });
    }
  }
  return out;
}
"""

STRUCTURE_JS = r"""
() => {
  const res = { headings: [], unlabelled: [], divButtons: 0, imgNoAlt: [], dupIds: [], links: [] };
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (!h.offsetParent && getComputedStyle(h).position !== 'fixed') return;
    res.headings.push(Number(h.tagName[1]));
  });
  document.querySelectorAll('input,select,textarea').forEach((f) => {
    if (f.type === 'hidden') return;
    const id = f.id;
    const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
      || f.closest('label')
      || f.getAttribute('aria-label')
      || f.getAttribute('aria-labelledby')
      || f.getAttribute('title');
    if (!labelled) res.unlabelled.push((f.tagName + '#' + (id || '') + '.' + (f.className || '')).slice(0, 70));
  });
  document.querySelectorAll('div[onclick],span[onclick]').forEach(() => { res.divButtons += 1; });
  document.querySelectorAll('img').forEach((i) => { if (!i.hasAttribute('alt')) res.imgNoAlt.push(i.src.slice(-40)); });
  const seen = new Set();
  document.querySelectorAll('[id]').forEach((e) => {
    if (seen.has(e.id)) res.dupIds.push(e.id); else seen.add(e.id);
  });
  document.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href');
    if (h && !/^(https?:|mailto:|tel:|#)/.test(h)) res.links.push(h);
    if (!a.textContent.trim() && !a.getAttribute('aria-label')) res.links.push('EMPTY_LINK:' + h);
  });
  return res;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8811")
    args = ap.parse_args()

    pages = []
    for root, _dirs, files in os.walk(SITE):
        for f in sorted(files):
            if f.endswith(".html"):
                rel = os.path.relpath(os.path.join(root, f), SITE).replace(os.sep, "/")
                pages.append(rel)
    pages.sort()

    tenants = json.load(open(os.path.join(SITE, "data", "tenants.json")))["tenants"]
    tenant_ids = [t["id"] for t in tenants]

    problems = defaultdict(list)
    checked = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # --- pass 1: every page, default tenant, desktop ---
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        console_errors = []
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: console_errors.append(f"REQUEST FAILED {r.url}"))

        for rel in pages:
            console_errors.clear()
            url = f"{args.base}/{rel}"
            page.goto(url, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(900)
            checked += 1

            if console_errors:
                for e in console_errors[:3]:
                    problems[rel].append(("console", e[:160]))

            ready = page.evaluate("document.body.dataset.ready")
            if ready != "true":
                problems[rel].append(("boot", f"body data-ready = {ready!r}"))

            text = page.evaluate("document.body.innerText")
            for pat in PLACEHOLDERS:
                m = re.search(pat, text, re.I)
                if m:
                    problems[rel].append(("placeholder", f"{pat} -> {m.group(0)!r}"))

            s = page.evaluate(STRUCTURE_JS)
            h = s["headings"]
            if h.count(1) != 1:
                problems[rel].append(("headings", f"{h.count(1)} h1 elements"))
            for i in range(1, len(h)):
                if h[i] - h[i - 1] > 1:
                    problems[rel].append(("headings", f"level jump h{h[i-1]} -> h{h[i]}"))
                    break
            for u in s["unlabelled"]:
                problems[rel].append(("label", f"form control without a label: {u}"))
            if s["divButtons"]:
                problems[rel].append(("a11y", f"{s['divButtons']} clickable div/span"))
            for i in s["imgNoAlt"]:
                problems[rel].append(("alt", f"img without alt: {i}"))
            for d in set(s["dupIds"]):
                problems[rel].append(("dup-id", d))

            for href in set(s["links"]):
                if href.startswith("EMPTY_LINK:"):
                    problems[rel].append(("link", href))
                    continue
                target = href.split("#")[0].split("?")[0]
                if not target:
                    continue
                base_dir = os.path.dirname(os.path.join(SITE, rel))
                resolved = os.path.normpath(os.path.join(base_dir, target))
                if not os.path.exists(resolved):
                    problems[rel].append(("link", f"broken: {href}"))

            for c in page.evaluate(CONTRAST_JS):
                problems[rel].append((
                    "contrast",
                    f"{c['ratio']}:1 (needs {c['need']}) {c['tag']}.{c['cls']} {c['size']}px {c['text']!r}",
                ))

        # --- pass 2: overflow at narrow widths ---
        for width, label in ((390, "mobile"), (768, "tablet")):
            p2 = browser.new_page(viewport={"width": width, "height": 900})
            for rel in pages:
                p2.goto(f"{args.base}/{rel}", wait_until="networkidle", timeout=45000)
                p2.wait_for_timeout(500)
                over = p2.evaluate(
                    "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
                if over > 1:
                    culprit = p2.evaluate(
                        """() => {
                            const w = document.documentElement.clientWidth;
                            for (const el of document.querySelectorAll('body *')) {
                                const r = el.getBoundingClientRect();
                                if (r.right <= w + 1 || r.width <= 0) continue;
                                const cs = getComputedStyle(el);
                                if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
                                // Inside a scroll container it is contained, not overflowing.
                                let anc = el.parentElement, contained = false;
                                while (anc) {
                                    const a = getComputedStyle(anc).overflowX;
                                    if (a === 'auto' || a === 'scroll' || a === 'hidden') { contained = true; break; }
                                    anc = anc.parentElement;
                                }
                                if (contained) continue;
                                return el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 50)
                                     + ' right=' + Math.round(r.right);
                            }
                            return 'unknown';
                        }""")
                    problems[rel].append(("overflow", f"{label} {width}px overflows by {over}px — {culprit}"))
            p2.close()

        # --- pass 3: every tenant boots and themes ---
        p3 = browser.new_page(viewport={"width": 1280, "height": 900})
        tenant_errors = []
        p3.on("pageerror", lambda e: tenant_errors.append(str(e)))
        for tid in tenant_ids:
            tenant_errors.clear()
            p3.goto(f"{args.base}/index.html?tenant={tid}", wait_until="networkidle", timeout=45000)
            p3.wait_for_timeout(1200)
            got = p3.evaluate("document.documentElement.dataset.tenant")
            brand = p3.evaluate(
                "getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()")
            ink = p3.evaluate(
                "getComputedStyle(document.documentElement).getPropertyValue('--brand-ink').trim()")
            if got != tid:
                problems["tenants"].append(("tenant", f"{tid}: root data-tenant is {got!r}"))
            if not brand:
                problems["tenants"].append(("tenant", f"{tid}: --brand did not resolve"))
            if ink not in ("#FFFFFF", "#0B0B0B"):
                problems["tenants"].append(("tenant", f"{tid}: --brand-ink is {ink!r}"))
            for e in tenant_errors[:2]:
                problems["tenants"].append(("tenant", f"{tid}: {e[:140]}"))
        p3.close()
        browser.close()

    # --- report ---
    by_kind = defaultdict(int)
    for rel, items in problems.items():
        for kind, _ in items:
            by_kind[kind] += 1

    print(f"\nchecked {checked} pages x 3 viewports x {len(tenant_ids)} tenants\n")
    if not problems:
        print("CLEAN — no problems found")
        return 0

    for rel in sorted(problems):
        print(f"--- {rel} ({len(problems[rel])}) ---")
        for kind, detail in problems[rel][:14]:
            print(f"    [{kind}] {detail}")
        if len(problems[rel]) > 14:
            print(f"    ... {len(problems[rel]) - 14} more")
    print("\nby kind:", dict(sorted(by_kind.items(), key=lambda x: -x[1])))
    total = sum(by_kind.values())
    print(f"total problems: {total}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
