---
name: headless-browser
description: Pick and drive the headless page tools. Use before opening, reading, scraping, clicking through, or screenshotting a web page.
---

# Headless browser

Open pages with the `chrome-devtools` MCP tools (`xd://mcp__chrome_devtools_*`), which the starter kit adds to `mcp.json` and which run headless Chrome on a throwaway profile.
When the starter kit also added the `obscura` MCP server, use its tools (`xd://mcp__obscura_browser_*`) by default to read, scrape, or click through a page, such as `browser_navigate` then `browser_markdown` or `browser_snapshot`: it loads a page several times faster than Chrome in a tenth of the memory.
Keep `chrome-devtools` for anything about how a page looks, such as screenshots, layout, or design review, since Obscura lays pages out with its own engine.
Every page tool takes a `pageId` from `list_pages`, the first page being `1`; `resize_page` to 1920×1080 before screenshots, since Chrome starts at 800×600.
Use `take_snapshot` for the page's elements and their `uid`s, which `click`, `fill`, and `hover` take; `list_console_messages`, `list_network_requests`, and `performance_start_trace` cover errors, failed calls, and load time.
There is no cookie tool, and `evaluate_script` sets only non-`httpOnly` cookies; yampa verification is unaffected, since `control-yampa browser start` runs its own Playwright Chromium with the session cookie.
