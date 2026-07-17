#!/usr/bin/env python3
"""
Talabat Mart product screenshot capture script — with pagination support.

Two-phase flow:
  Phase 1 (DISCOVERY): Navigate to a category page, scroll to load lazy
    cards, collect every product-card href on the page, then look for a
    "next page" / "load more" control and advance. Repeat across ALL
    pages until there is no next page or --max-pages is hit. De-duplicate
    by href so a product appearing on multiple pages is captured once.
  Phase 2 (CAPTURE): For each unique product URL, navigate directly to
    the detail page, wait for the hero <img> to load, settle (paint
    flush), screenshot the raw <img>, save PNG named after the product.

Emits JSON-line events to stdout (one JSON object per line) so the parent
process (Node.js API route) can parse + forward them to a WebSocket
mini-service for live UI updates.

Event types:
  start, total, page, card-found, scroll, navigate, image-found,
  screenshot, log, warning, error, skip, done, stopped, process-exit
"""

import argparse
import json
import os
import re
import signal
import sys
import time
import unicodedata
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

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
# Filename sanitization
# ---------------------------------------------------------------------------

_SLUG_KEEP_RE = re.compile(r"[^\w\u0600-\u06FF-]", re.UNICODE)
_SLUG_COLLAPSE_RE = re.compile(r"-+")
_ALEF_RE = re.compile(r"[\u0622\u0623\u0625]")


def sanitize_filename(name: str, max_len: int = 120) -> str:
    """Turn a product name into a filesystem-safe slug ending in .png."""
    if not name:
        return "product.png"
    s = unicodedata.normalize("NFKC", name.strip())
    s = _ALEF_RE.sub("\u0627", s)
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
    while time.time() < deadline:
        for sel in IMG_SELECTORS:
            try:
                loc = page.locator(sel).first
                if loc.count() == 0:
                    continue
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
            except Exception:
                pass
        time.sleep(0.4)
    return None


# ---------------------------------------------------------------------------
# Pagination control detection
# ---------------------------------------------------------------------------

# Selectors for "next page" / "load more" controls, tried in order. We look
# for buttons/links whose aria-label or text suggests advancing, plus SVG
# arrow buttons that commonly appear in pagination bars.
NEXT_SELECTORS = [
    # data-testid based (most reliable if present)
    '[data-testid*="next-page" i]',
    '[data-testid*="pagination-next" i]',
    '[data-testid*="load-more" i]',
    '[data-testid*="show-more" i]',
    # aria-label based
    'button[aria-label*="next" i]',
    'a[aria-label*="next" i]',
    'button[aria-label*="التالي"]',
    'a[aria-label*="التالي"]',
    'button[aria-label*="تحميل المزيد"]',
    # text-content based (Arabic + English)
    'button:has-text("التالي")',
    'a:has-text("التالي")',
    'button:has-text("التالى")',
    'button:has-text("تحميل المزيد")',
    'button:has-text("عرض المزيد")',
    'button:has-text("Load more")',
    'button:has-text("Show more")',
    'button:has-text("Next")',
    # generic pagination arrow (SVG inside button at bottom nav)
    'nav[role="navigation"] button:has(svg):last-of-type',
    '[class*="pagination" i] button:has(svg):last-of-type',
    '[class*="pagination" i] a:has(svg):last-of-type',
]


def find_next_control(page: Page) -> Optional[Any]:
    """Find a visible, enabled 'next page' / 'load more' control. Returns the
    locator or None."""
    for sel in NEXT_SELECTORS:
        try:
            loc = page.locator(sel)
            cnt = loc.count()
            for j in range(cnt):
                el = loc.nth(j)
                try:
                    if not el.is_visible():
                        continue
                except Exception:
                    continue
                # Skip disabled controls.
                try:
                    disabled = el.evaluate(
                        "(e) => e.disabled === true || "
                        "e.getAttribute('aria-disabled') === 'true' || "
                        "e.classList.contains('disabled')"
                    )
                    if disabled:
                        continue
                except Exception:
                    pass
                return el
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Card collection (discovery)
# ---------------------------------------------------------------------------

CARD_SELECTOR_PRIMARY = 'a[data-testid="product-card"]:has(img)'
CARD_SELECTOR_FALLBACK = 'a[href*="/"]:has(img)'


def resolve_card_selector(page: Page) -> str:
    """Return the first card selector that matches at least one element."""
    for sel in (CARD_SELECTOR_PRIMARY, CARD_SELECTOR_FALLBACK):
        try:
            if page.locator(sel).count() > 0:
                return sel
        except Exception:
            continue
    return CARD_SELECTOR_PRIMARY


def scroll_to_load(page: Page, max_rounds: int, page_label: str) -> None:
    """Scroll to the bottom in rounds to trigger lazy loading."""
    last_height = 0
    for rnd in range(1, max_rounds + 1):
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1200)
        cur = page.evaluate("() => document.body.scrollHeight")
        emit({"type": "scroll", "page": page_label, "round": rnd,
              "height": cur, "at": now_iso()})
        if cur == last_height:
            break
        last_height = cur
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(500)


def collect_cards_on_page(
    page: Page, card_selector: str, page_label: str
) -> list[dict[str, str]]:
    """Collect {href, name, price} for every card currently in the DOM."""
    out: list[dict[str, str]] = []
    cards = page.locator(card_selector)
    total = cards.count()
    for i in range(total):
        try:
            card = cards.nth(i)
            try:
                name = (card.locator('h3, h2, [data-testid="product-name"]')
                        .first.inner_text(timeout=1500)).strip()
            except Exception:
                name = ""
            try:
                href = card.get_attribute("href") or ""
            except Exception:
                href = ""
            try:
                price = (card.locator('[data-testid="product-price"]')
                         .first.inner_text(timeout=800)).strip()
            except Exception:
                price = ""
            if href:
                out.append({"href": href, "name": name, "price": price})
        except Exception:
            continue
    emit({"type": "log", "message": f"{page_label}: collected {len(out)} cards",
          "at": now_iso()})
    return out


def absolute_url(href: str, base: str) -> str:
    if href.startswith("http"):
        return href
    if href.startswith("/"):
        p = urlparse(base)
        return f"{p.scheme}://{p.netloc}{href}"
    return href


# ---------------------------------------------------------------------------
# Discovery phase — collect ALL product URLs across ALL pages
# ---------------------------------------------------------------------------

def discover_products(
    page: Page,
    base_url: str,
    max_scroll_rounds: int,
    max_pages: int,
    stop_flag: dict,
) -> list[dict[str, str]]:
    """Walk every page of the category, returning a de-duplicated list of
    {href(abs), name, price} for every product card found."""
    card_selector = resolve_card_selector(page)
    emit({"type": "log",
          "message": f"card selector: {card_selector}", "at": now_iso()})

    seen: dict[str, dict[str, str]] = {}  # href -> info (dedup)
    page_no = 0

    while page_no < max_pages:
        if stop_flag["flag"]:
            raise KeyboardInterrupt

        page_no += 1
        label = f"page {page_no}"
        emit({"type": "page", "page": page_no, "at": now_iso(),
              "url": page.url})

        # Wait for cards to render on this page.
        try:
            page.wait_for_selector(card_selector, timeout=15000)
        except PlaywrightTimeoutError:
            if page_no == 1:
                emit({"type": "error",
                      "message": "no product cards found on the first page",
                      "at": now_iso()})
                return []
            emit({"type": "warning",
                  "message": f"{label}: no cards found, stopping discovery",
                  "at": now_iso()})
            break

        # Scroll to load lazy images on this page.
        scroll_to_load(page, max_scroll_rounds, label)

        # Collect cards on this page.
        cards_here = collect_cards_on_page(page, card_selector, label)
        new_count = 0
        for c in cards_here:
            abs_href = absolute_url(c["href"], base_url)
            # Strip query/fragment for dedup key (same product may have
            # different tracking params on different pages).
            key = abs_href.split("?")[0].split("#")[0]
            if key not in seen:
                seen[key] = {"href": abs_href, "name": c["name"],
                             "price": c["price"], "page": page_no}
                new_count += 1
                emit({"type": "card-found", "index": len(seen) - 1,
                      "page": page_no, "name": c["name"],
                      "price": c["price"], "href": abs_href, "at": now_iso()})

        emit({"type": "log",
              "message": (f"{label}: {len(cards_here)} cards on page, "
                          f"{new_count} new, {len(seen)} unique total"),
              "at": now_iso()})

        # If this page added nothing new, we've likely hit a loop or the
        # "next" button didn't actually advance. Stop to avoid infinite loop.
        if page_no > 1 and new_count == 0:
            emit({"type": "warning",
                  "message": (f"{label}: no new products, stopping "
                              f"discovery to avoid loop"),
                  "at": now_iso()})
            break

        # Look for a next-page / load-more control.
        next_ctl = find_next_control(page)
        if next_ctl is None:
            emit({"type": "log",
                  "message": f"{label}: no next-page control found, "
                             f"discovery complete",
                  "at": now_iso()})
            break

        # Click it and wait for new content.
        emit({"type": "log",
              "message": f"{label}: clicking next-page control",
              "at": now_iso()})
        try:
            # Record the URL + card count before clicking so we can detect
            # whether the click actually advanced the page.
            url_before = page.url
            count_before = page.locator(card_selector).count()
            try:
                next_ctl.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass
            page.wait_for_timeout(400)
            next_ctl.click(timeout=8000)
        except Exception as e:
            emit({"type": "warning",
                  "message": f"failed to click next: {e}", "at": now_iso()})
            break

        # Wait for either URL change or new cards to appear.
        try:
            page.wait_for_load_state("domcontentloaded", timeout=15000)
        except PlaywrightTimeoutError:
            pass
        page.wait_for_timeout(2500)

        # Check for blocks after advancing.
        block = looks_like_block(page)
        if block:
            emit({"type": "warning",
                  "message": f"blocked after advancing: {block}",
                  "at": now_iso()})
            break

        # If neither the URL nor the card count changed, the click probably
        # didn't do anything useful — stop.
        url_after = page.url
        try:
            count_after = page.locator(card_selector).count()
        except Exception:
            count_after = count_before
        if url_before == url_after and count_after <= count_before:
            emit({"type": "warning",
                  "message": (f"next click had no effect "
                              f"(url+count unchanged), stopping"),
                  "at": now_iso()})
            break

    products = list(seen.values())
    emit({"type": "log",
          "message": (f"discovery complete: {len(products)} unique "
                      f"products across {page_no} page(s)"),
          "at": now_iso()})
    return products


# ---------------------------------------------------------------------------
# Capture phase — screenshot each product
# ---------------------------------------------------------------------------

def capture_products(
    page: Page,
    products: list[dict[str, str]],
    output_dir: str,
    settle_ms: int,
    manifest: dict[str, Any],
    stop_flag: dict,
) -> tuple[int, int, int]:
    """For each product URL, navigate to the detail page and screenshot the
    hero image. Returns (captured, failed, skipped)."""
    captured = 0
    failed = 0
    skipped = 0
    total = len(products)

    for i, prod in enumerate(products):
        if stop_flag["flag"]:
            raise KeyboardInterrupt

        name = prod.get("name", "")
        price = prod.get("price", "")
        detail_url = prod["href"]

        emit({"type": "navigate", "index": i, "page": prod.get("page", 1),
              "url": detail_url, "at": now_iso()})
        try:
            page.goto(detail_url, wait_until="domcontentloaded", timeout=30000)
        except PlaywrightTimeoutError:
            emit({"type": "warning",
                  "message": f"detail page timeout for product {i}",
                  "at": now_iso()})

        page.wait_for_timeout(1200)
        block = looks_like_block(page)
        if block:
            emit({"type": "skip", "index": i,
                  "reason": f"blocked: {block}", "at": now_iso()})
            skipped += 1
            manifest["skipped"].append({"index": i, "name": name,
                                        "reason": block})
            continue

        img_loc = wait_for_image_loaded(page, timeout_ms=15000)
        if img_loc is None:
            emit({"type": "skip", "index": i,
                  "reason": "no hero image", "at": now_iso()})
            skipped += 1
            manifest["skipped"].append({"index": i, "name": name,
                                        "reason": "no hero image"})
            continue

        try:
            img_info = img_loc.evaluate(
                "(el) => ({src: el.currentSrc||el.src||'', "
                "alt: el.alt||'', w: el.naturalWidth||0, "
                "h: el.naturalHeight||0})"
            )
        except Exception as e:
            emit({"type": "skip", "index": i,
                  "reason": f"img eval failed: {e}", "at": now_iso()})
            skipped += 1
            continue

        emit({"type": "image-found", "index": i,
              "src": img_info.get("src", ""),
              "naturalWidth": img_info.get("w", 0),
              "naturalHeight": img_info.get("h", 0), "at": now_iso()})

        # Resolve the final filename. Fall back to image alt text if the
        # card name is empty or is just the brand.
        final_name = name
        brand_markers = ("طلبات مارت", "Talabat Mart", "talabat mart")
        if not final_name or any(
            b.lower() in final_name.lower() for b in brand_markers
        ):
            alt = (img_info.get("alt") or "").strip()
            if alt:
                final_name = alt

        filename = sanitize_filename(final_name)
        full_path = os.path.join(output_dir, filename)
        if os.path.exists(full_path):
            base, ext = os.path.splitext(filename)
            filename = f"{base}-{i}{ext}"
            full_path = os.path.join(output_dir, filename)

        # Settle: wait for the image to actually paint before screenshot.
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
            size = (os.path.getsize(full_path)
                    if os.path.exists(full_path) else 0)
            emit({"type": "screenshot", "index": i,
                  "filename": filename, "bytes": size,
                  "path": full_path,
                  "progress": f"{i + 1}/{total}", "at": now_iso()})
            captured += 1
            manifest["items"].append({
                "index": i, "name": final_name, "price": price,
                "url": detail_url, "filename": filename,
                "image_src": img_info.get("src", ""), "bytes": size,
                "dimensions": [img_info.get("w", 0),
                               img_info.get("h", 0)],
                "source_page": prod.get("page", 1),
            })
        except Exception as e:
            emit({"type": "error", "index": i,
                  "message": f"screenshot failed: {e}", "at": now_iso()})
            failed += 1
            manifest["failed"].append({"index": i, "name": final_name,
                                       "reason": str(e)})

    return captured, failed, skipped


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
    max_pages: int = 50,
) -> int:
    """Run the full capture flow. Returns process exit code (0 = success)."""
    os.makedirs(output_dir, exist_ok=True)
    manifest_path = os.path.join(output_dir, "manifest.json")
    manifest: dict[str, Any] = {
        "category": category,
        "source_url": url,
        "output_dir": output_dir,
        "started_at": now_iso(),
        "max_pages": max_pages,
        "items": [],
        "failed": [],
        "skipped": [],
    }

    emit({"type": "start", "at": now_iso(), "url": url, "category": category,
          "output_dir": output_dir, "headless": headless,
          "max_scroll_rounds": max_scroll_rounds, "settle_ms": settle_ms,
          "max_pages": max_pages})

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
        context.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        page: Page = context.new_page()

        try:
            emit({"type": "log", "message": f"navigating to {url}",
                  "at": now_iso()})
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(2500)

            block = looks_like_block(page)
            if block:
                emit({"type": "error",
                      "message": f"blocked: {block}", "at": now_iso()})
                emit({"type": "done", "at": now_iso(), "captured": 0,
                      "failed": 0, "skipped": 0, "total": 0,
                      "pages": 0, "reason": "blocked"})
                return 2

            # ---------- Phase 1: discovery (all pages) ----------
            emit({"type": "log",
                  "message": (f"Phase 1: discovering products across up "
                              f"to {max_pages} pages"), "at": now_iso()})
            products = discover_products(
                page=page,
                base_url=url,
                max_scroll_rounds=max_scroll_rounds,
                max_pages=max_pages,
                stop_flag=stop_requested,
            )

            total = len(products)
            emit({"type": "total", "count": total, "at": now_iso()})
            if total == 0:
                emit({"type": "done", "at": now_iso(), "captured": 0,
                      "failed": 0, "skipped": 0, "total": 0,
                      "pages": 0, "reason": "no-cards"})
                manifest["finished_at"] = now_iso()
                manifest["total"] = 0
                with open(manifest_path, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, ensure_ascii=False, indent=2)
                return 3

            # ---------- Phase 2: capture (screenshot each) ----------
            emit({"type": "log",
                  "message": (f"Phase 2: capturing {total} unique "
                              f"product images"), "at": now_iso()})
            captured, failed, skipped = capture_products(
                page=page,
                products=products,
                output_dir=output_dir,
                settle_ms=settle_ms,
                manifest=manifest,
                stop_flag=stop_requested,
            )

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
                  "skipped": skipped, "total": total,
                  "pages": manifest.get("max_pages", max_pages)})
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
                  "failed": 0, "skipped": 0, "total": 0,
                  "pages": 0, "reason": "fatal"})
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
    ap = argparse.ArgumentParser(
        description="Talabat Mart product screenshot capture (pagination-aware)"
    )
    ap.add_argument("--url", required=True, help="category page URL")
    ap.add_argument("--category", required=True,
                    help="leaf category slug (folder name)")
    ap.add_argument("--output-dir", required=True,
                    help="output directory for PNGs")
    ap.add_argument("--headless", default="true",
                    help="run browser headless (true/false)")
    ap.add_argument("--proxy", default=None,
                    help="proxy server URL (e.g. http://host:port)")
    ap.add_argument("--max-scroll-rounds", type=int, default=20,
                    help="max scroll-to-bottom rounds per page for lazy loading")
    ap.add_argument("--settle-ms", type=int, default=3000,
                    help="ms to wait for image to paint before screenshot")
    ap.add_argument("--max-pages", type=int, default=50,
                    help="max category pages to walk (pagination limit)")
    args = ap.parse_args()

    code = run_capture(
        url=args.url,
        category=args.category,
        output_dir=args.output_dir,
        headless=str(args.headless).lower() == "true",
        proxy=args.proxy,
        max_scroll_rounds=args.max_scroll_rounds,
        settle_ms=args.settle_ms,
        max_pages=args.max_pages,
    )
    emit({"type": "process-exit", "code": code, "at": now_iso()})
    return code


if __name__ == "__main__":
    sys.exit(main())
