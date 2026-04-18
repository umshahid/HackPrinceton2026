"""Web browsing actions — search, navigate, extract content."""

import asyncio
from loguru import logger

from jarvis.actions.registry import ActionRegistry

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None


_browser = None
_page = None


async def _get_page():
    """Get or create a browser page."""
    global _browser, _page

    if async_playwright is None:
        logger.error("playwright not installed. Run: pip install playwright && playwright install chromium")
        return None

    if _page is None or _page.is_closed():
        pw = await async_playwright().start()
        _browser = await pw.chromium.launch(headless=False)  # Visible so user can see
        _page = await _browser.new_page()

    return _page


async def web_search(query: str) -> str:
    """Search the web using Google and return top results."""
    page = await _get_page()
    if page is None:
        # Fallback: use curl
        try:
            proc = await asyncio.create_subprocess_exec(
                "curl", "-s", f"https://lite.duckduckgo.com/lite/?q={query.replace(' ', '+')}",
                stdout=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            # Extract text snippets (rough extraction)
            text = stdout.decode()
            # Simple extraction of result snippets
            results = []
            for line in text.split("\n"):
                line = line.strip()
                if line and len(line) > 30 and "<" not in line:
                    results.append(line)
                    if len(results) >= 5:
                        break
            return "\n".join(results) if results else "No results found."
        except Exception:
            return "Web search unavailable."

    try:
        await page.goto(f"https://www.google.com/search?q={query}")
        await page.wait_for_load_state("domcontentloaded")

        # Extract search results
        results = await page.evaluate("""
            () => {
                const items = document.querySelectorAll('.g');
                return Array.from(items).slice(0, 5).map(item => {
                    const title = item.querySelector('h3')?.textContent || '';
                    const snippet = item.querySelector('.VwiC3b')?.textContent || '';
                    const link = item.querySelector('a')?.href || '';
                    return `${title}\\n${snippet}\\n${link}`;
                }).join('\\n\\n');
            }
        """)
        return results or "No results found."
    except Exception as e:
        return f"Search failed: {e}"


async def open_url(url: str) -> str:
    """Open a URL in the browser."""
    page = await _get_page()
    if page is None:
        return "Browser not available."

    try:
        await page.goto(url)
        title = await page.title()
        return f"Opened: {title} ({url})"
    except Exception as e:
        return f"Failed to open URL: {e}"


async def get_page_text(url: str = None) -> str:
    """Get the text content of the current page or a specific URL."""
    page = await _get_page()
    if page is None:
        return "Browser not available."

    try:
        if url:
            await page.goto(url)

        text = await page.evaluate("() => document.body.innerText")
        # Truncate to avoid overwhelming the AI
        if len(text) > 3000:
            text = text[:3000] + "\n... (truncated)"
        return text
    except Exception as e:
        return f"Failed to get page text: {e}"


async def close_browser() -> str:
    """Close the browser."""
    global _browser, _page
    if _browser:
        await _browser.close()
        _browser = None
        _page = None
    return "Browser closed."


def register_web_actions():
    """Register web actions with the global registry."""
    registry = ActionRegistry.get_instance()

    registry.register(
        "web_search",
        "Search the web for information. Returns top results with titles and snippets.",
        web_search,
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
            },
            "required": ["query"],
        },
    )

    registry.register(
        "open_url",
        "Open a URL in the web browser",
        open_url,
        {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to open"},
            },
            "required": ["url"],
        },
    )

    registry.register(
        "get_page_text",
        "Get the text content of a web page",
        get_page_text,
        {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to read (optional, uses current page if empty)"},
            },
        },
    )
