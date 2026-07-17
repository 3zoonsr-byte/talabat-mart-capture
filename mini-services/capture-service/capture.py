#!/usr/bin/env python3
"""
Talabat Mart product screenshot capture script.

Follows the spec: bootstrap Chromium (1440x900, DPR 2, ar-EG, Africa/Cairo)
-> navigate to a category page -> scroll to load all cards -> for each card,
navigate to its detail page -> wait for the hero <img> -> settle (paint flush)
-> screenshot the raw <img> -> save PNG named after the product.

Emits JSON-line events to stdout (one JSON object per line) so the parent
process (Node.js API route) can parse + forward them to a WebSocket
mini-service for live UI updates.

Event types:
  start, total, card-found, scroll, navigate, image-found, screenshot,
  log, warning, error, skip, done, stopped, process-exit
"""

import argparse
import json
import os
import re
import signal
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from playwright.sync_api import (
    Page,
    Browser,
    BrowserContext,
    sync_playwright,
    TimeoutError as PlaywrightTimeoutError,
)


# ---------------------------------------------------------------------------
# Event emission (JSON-line to stdout)
# ---------------------------------------------------------------------------

def emit(event: dict[str, Any]) -> None:
    """Write one JSON-line event to stdout, flushed immediately."""
    try:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        # Never let event emission crash the capture.
        pass


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Filename sanitization (spec 6.3)
# ---------------------------------------------------------------------------

# Keep Arabic letters, Latin letters, digits, and hyphens. Replace everything
# else (spaces, punctuation, emoji) with a hyphen. Collapse runs of hyphens.
_SLUG_KEEP_RE = re.compile(r"[^\w\u0600-\u06FF-]", re.UNICODE)
_SLUG_COLLAPSE_RE = re.compile(r"-+")
# Arabic normalization: unify alef forms, remove diacritics (tashkeel).
_ALEF_RE = re.compile(r"[\u0622\u0623\u0625]")


def sanitize_filename(name: str, max_len: int = 120) -> str:
    """Turn a product name into a filesystem-safe slug ending in .png."""
    if not name:
        return "product.png"
    s = unicodedata.normalize("NFKC", name.strip())
    s = _ALEF_RE.sub("\u0627", s)  # unify alef variants -> plain alef
    # Remove Arabic diacritics (tashkeel) - they're noisy in filenames.
    s = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", s)
    s = _SLUG_KEEP_RE.sub("-", s)
    s = _SLUG_COLLAPSE_RE.sub("-", s).strip("-")
    if not s:
        s = "product"
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0] or s[:max_len]
    return s + ".png"


# ---------------------------------------------------------------------------
# Cloudflare / login-redirect detection
# ---------------------------------------------------------------------------

CLOUDFLARE_MARKERS = ("cf-chl-", "cf-browser-verification", "cf-mitigated")
LOGIN_MARKERS = ("/login", "/signin", "/auth", "account.talabat", "login.talabat")


def looks_like_block(page: Page) -> Optional[str]:
    """Return a reason string if the page looks like a Cloudflare/login block."""
    try:
        url = page.url or ""
        if any(m in url for m in LOGIN_MARKERS):
            return f"redirected to login: {url}"
    except Exception:
        pass
    try:
        html = page.content()[:4000].lower()
        if any(m in html for m in CLOUDFLARE_MARKERS):
            return "cloudflare challenge detected"
        if "just a moment" in html and "cloudflare" in html:
            return "cloudflare interstitial"
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Image loading helpers
# ---------------------------------------------------------------------------

# CDN-priority selectors. dhmedia.io is Talabat's product CDN. The
# `product-information-management` path is an older CDN. We prefer these over
# generic img[alt] because the latter can match the site logo.
IMG_SELECTORS = [
    "img[src*='dhmedia.io']",
    "img[src*='product-information-management']",
    "img[srcset*='dhmedia.io']",
    "picture img",
    "img[alt][src*='talabat' i]",
    "main img",
    "article img",
]


def wait_for_image_loaded(page: Page, timeout_ms: int = 15000) -> Optional[Any]:
    """Find a hero <img> on the detail page and wait until it has dimensions."""
    try:
        page.wait_for_load_state("domcontentloaded", timeout=10000)
    except PlaywrightTimeoutError:
        pass

    deadline = time.time() + timeout_ms / 1000
    last_eval_error = None
    while time.time() < deadline:
        for sel in IMG_SELECTORS:
            try:
                loc = page.locator(sel).first
                if loc.count() == 0:
                    continue
                # Check naturalWidth via evaluate (handles lazy-loaded images).
                info = loc.evaluate(
                    "(el) => ({"
                    "complete: el.complete,"
                    "nw: el.naturalWidth || 0,"
                    "nh: el.naturalHeight || 0,"
                    "src: el.currentSrc || el.src || ''"
                    "})"
                )
                if (
                    info
                    and info.get("complete")
                    and info.get("nw", 0) >= 200
                    and info.get("nh", 0) >= 200
                ):
                    return loc
            except Exception as e:
                last_eval_error = str(e)
        time.sleep(0.4)
    return None


# ---------------------------------------------------------------------------
# Main capture routine
# ---------------------------------------------------------------------------

def run_capture(
    url: str,
    category: str,
    output_dir: str,
    headless: bool = True,
    proxy: Optional[str] = None,
    max_scroll_rounds: int = 20,
    settle_ms: int = 3000,
) -> int:
    """Run the full capture flow. Returns process exit code (0 = success)."""
    os.makedirs(output_dir, exist_ok=True)
    manifest_path = os.path.join(output_dir, "manifest.json")
    manifest: dict[str, Any] = {
        "category": category,
        "source_url": url,
        "output_dir": output_dir,
        "started_at": now_iso(),
        "items": [],
        "failed": [],
        "skipped": [],
    }

    emit({"type": "start", "at": now_iso(), "url": url, "category": category,
          "output_dir": output_dir, "headless": headless,
          "max_scroll_rounds": max_scroll_rounds, "settle_ms": settle_ms})

    # SIGTERM -> KeyboardInterrupt so we can emit a 'stopped' event + cleanup.
    stop_requested = {"flag": False}

    def handle_sigterm(_signum, _frame):
        stop_requested["flag"] = True
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_sigterm)

    with sync_playwright() as pw:
        launch_args = [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ]
        browser: Browser = pw.chromium.launch(
            headless=headless, args=launch_args
        )
        context: BrowserContext = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
            locale="ar-EG",
            timezone_id="Africa/Cairo",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            **({"proxy": {"server": proxy}} if proxy else {}),
        )
        # Hide navigator.webdriver
        context.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        page: Page = context.new_page()

        try:
            emit({"type": "log", "message": f"navigating to {url}", "at": now_iso()})
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(2500)

            block = looks_like_block(page)
            if block:
                emit({"type": "error", "message": f"blocked: {block}", "at": now_iso()})
                emit({"type": "done", "at": now_iso(), "captured": 0,
                      "failed": 0, "skipped": 0, "total": 0,
                      "reason": "blocked"})
                return 2

            # Find card selector. Talabat cards are <a> with an <img> inside,
            # tagged with data-testid. We use :has(img) to avoid matching the
            # nested name/price elements.
            card_selector = 'a[data-testid="product-card"]:has(img)'
            try:
                page.wait_for_selector(card_selector, timeout=15000)
            except PlaywrightTimeoutError:
                # Fallback: try a more generic card selector.
                card_selector = 'a[href*="/"]:has(img)'
                try:
                    page.wait_for_selector(card_selector, timeout=8000)
                except PlaywrightTimeoutError:
                    emit({"type": "error",
                          "message": "no product cards found on the page",
                          "at": now_iso()})
                    emit({"type": "done", "at": now_iso(), "captured": 0,
                          "failed": 0, "skipped": 0, "total": 0,
                          "reason": "no-cards"})
                    return 3

            # Scroll to bottom in rounds to trigger lazy loading.
            emit({"type": "log", "message": "scrolling to load lazy images",
                  "at": now_iso()})
            last_height = 0
            for rnd in range(1, max_scroll_rounds + 1):
                page.evaluate(
                    "() => window.scrollTo(0, document.body.scrollHeight)"
                )
                page.wait_for_timeout(1200)
                cur = page.evaluate("() => document.body.scrollHeight")
                emit({"type": "scroll", "round": rnd,
                      "height": cur, "at": now_iso()})
                if cur == last_height:
                    break
                last_height = cur
            # Scroll back to top so the first card is in view.
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(800)

            # Collect cards. We re-query after each navigation because locators
            # go stale when the DOM changes (spec 6.10).
            cards = page.locator(card_selector)
            total = cards.count()
            emit({"type": "total", "count": total, "at": now_iso()})

            captured = 0
            failed = 0
            skipped = 0
            i = 0
            while i < total:
                if stop_requested["flag"]:
                    raise KeyboardInterrupt

                # Re-query cards (stale-locators guard).
                cards = page.locator(card_selector)
                if i >= cards.count():
                    emit({"type": "warning", "message": f"card {i} vanished",
                          "at": now_iso()})
                    break

                card = cards.nth(i)
                try:
                    name = (card.locator('h3, h2, [data-testid="product-name"]')
                            .first.inner_text(timeout=2000)).strip()
                except Exception:
                    name = ""
                try:
                    href = card.get_attribute("href") or ""
                except Exception:
                    href = ""
                try:
                    price = (card.locator('[data-testid="product-price"]')
                             .first.inner_text(timeout=1000)).strip()
                except Exception:
                    price = ""

                emit({"type": "card-found", "index": i, "name": name,
                      "price": price, "href": href, "at": now_iso()})

                if not href:
                    emit({"type": "skip", "index": i, "reason": "no href",
                          "at": now_iso()})
                    skipped += 1
                    manifest["skipped"].append({"index": i, "name": name,
                                                "reason": "no href"})
                    i += 1
                    continue

                detail_url = href
                if detail_url.startswith("/"):
                    p = urlparse(url)
                    detail_url = f"{p.scheme}://{p.netloc}{detail_url}"

                emit({"type": "navigate", "index": i, "url": detail_url,
                      "at": now_iso()})
                try:
                    page.goto(detail_url, wait_until="domcontentloaded",
                              timeout=30000)
                except PlaywrightTimeoutError:
                    emit({"type": "warning",
                          "message": f"detail page timeout for card {i}",
                          "at": now_iso()})

                page.wait_for_timeout(1200)
                block = looks_like_block(page)
                if block:
                    emit({"type": "skip", "index": i,
                          "reason": f"blocked: {block}", "at": now_iso()})
                    skipped += 1
                    manifest["skipped"].append({"index": i, "name": name,
                                                "reason": block})
                    page.go_back(wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(800)
                    i += 1
                    continue

                img_loc = wait_for_image_loaded(page, timeout_ms=15000)
                if img_loc is None:
                    emit({"type": "skip", "index": i,
                          "reason": "no hero image", "at": now_iso()})
                    skipped += 1
                    manifest["skipped"].append({"index": i, "name": name,
                                                "reason": "no hero image"})
                    page.go_back(wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(800)
                    i += 1
                    continue

                img_info = img_loc.evaluate(
                    "(el) => ({src: el.currentSrc||el.src||'', "
                    "alt: el.alt||'', w: el.naturalWidth||0, "
                    "h: el.naturalHeight||0})"
                )
                emit({"type": "image-found", "index": i,
                      "src": img_info.get("src", ""),
                      "naturalWidth": img_info.get("w", 0),
                      "naturalHeight": img_info.get("h", 0),
                      "at": now_iso()})

                # Resolve the final filename. If the name is empty or matches
                # the brand ("طلبات مارت" / "Talabat Mart"), fall back to the
                # image's alt text.
                final_name = name
                brand_markers = ("طلبات مارت", "Talabat Mart", "talabat mart")
                if not final_name or any(
                    b.lower() in final_name.lower() for b in brand_markers
                ):
                    alt = (img_info.get("alt") or "").strip()
                    if alt:
                        final_name = alt

                filename = sanitize_filename(final_name)
                # Avoid clobbering: append index if filename exists and is
                # a different product.
                full_path = os.path.join(output_dir, filename)
                if os.path.exists(full_path):
                    base, ext = os.path.splitext(filename)
                    filename = f"{base}-{i}{ext}"
                    full_path = os.path.join(output_dir, filename)

                # Settle: wait for the image to actually paint before
                # screenshotting. This fixes the white-screenshot bug where
                # the image metadata is loaded but pixels aren't composited.
                emit({"type": "log",
                      "message": (f"waiting {settle_ms}ms for image to paint "
                                  f"before screenshot"),
                      "at": now_iso()})
                if settle_ms > 0:
                    try:
                        page.evaluate(
                            "() => new Promise(r => "
                            "requestAnimationFrame(() => "
                            "requestAnimationFrame(r)))"
                        )
                    except Exception:
                        pass
                    time.sleep(settle_ms / 1000)

                try:
                    img_loc.screenshot(path=full_path)
                    size = os.path.getsize(full_path) if os.path.exists(full_path) else 0
                    emit({"type": "screenshot", "index": i,
                          "filename": filename, "bytes": size,
                          "path": full_path, "at": now_iso()})
                    captured += 1
                    manifest["items"].append({
                        "index": i, "name": final_name, "price": price,
                        "url": detail_url, "filename": filename,
                        "image_src": img_info.get("src", ""),
                        "bytes": size,
                        "dimensions": [img_info.get("w", 0),
                                       img_info.get("h", 0)],
                    })
                except Exception as e:
                    emit({"type": "error", "index": i,
                          "message": f"screenshot failed: {e}", "at": now_iso()})
                    failed += 1
                    manifest["failed"].append({"index": i, "name": final_name,
                                               "reason": str(e)})

                # Go back to the category page for the next card.
                page.go_back(wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(800)
                i += 1

            manifest["finished_at"] = now_iso()
            manifest["captured"] = captured
            manifest["failed_count"] = failed
            manifest["skipped_count"] = skipped
            manifest["total"] = total
            try:
                with open(manifest_path, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, ensure_ascii=False, indent=2)
            except Exception as e:
                emit({"type": "warning",
                      "message": f"failed to write manifest: {e}",
                      "at": now_iso()})

            emit({"type": "done", "at": now_iso(),
                  "captured": captured, "failed": failed,
                  "skipped": skipped, "total": total})
            return 0

        except KeyboardInterrupt:
            emit({"type": "stopped", "at": now_iso(),
                  "reason": "interrupted by user (SIGTERM)"})
            manifest["stopped_at"] = now_iso()
            try:
                with open(manifest_path, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
            return 130
        except Exception as e:
            emit({"type": "error", "message": f"fatal: {e}", "at": now_iso()})
            emit({"type": "done", "at": now_iso(), "captured": 0,
                  "failed": 0, "skipped": 0, "total": 0, "reason": "fatal"})
            return 1
        finally:
            try:
                context.close()
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Talabat Mart product screenshot capture")
    ap.add_argument("--url", required=True, help="category page URL")
    ap.add_argument("--category", required=True, help="leaf category slug (folder name)")
    ap.add_argument("--output-dir", required=True, help="output directory for PNGs")
    ap.add_argument("--headless", default="true",
                    help="run browser headless (true/false)")
    ap.add_argument("--proxy", default=None,
                    help="proxy server URL (e.g. http://host:port)")
    ap.add_argument("--max-scroll-rounds", type=int, default=20,
                    help="max scroll-to-bottom rounds for lazy loading")
    ap.add_argument("--settle-ms", type=int, default=3000,
                    help="ms to wait for image to paint before screenshot")
    args = ap.parse_args()

    code = run_capture(
        url=args.url,
        category=args.category,
        output_dir=args.output_dir,
        headless=str(args.headless).lower() == "true",
        proxy=args.proxy,
        max_scroll_rounds=args.max_scroll_rounds,
        settle_ms=args.settle_ms,
    )
    emit({"type": "process-exit", "code": code, "at": now_iso()})
    return code


if __name__ == "__main__":
    sys.exit(main())
