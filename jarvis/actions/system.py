"""System-level actions — app launching, window management, OS control."""

import asyncio
import subprocess
import os
from loguru import logger

try:
    import pyautogui
    pyautogui.FAILSAFE = True  # Move mouse to corner to abort
except ImportError:
    pyautogui = None

try:
    import pygetwindow as gw
except ImportError:
    gw = None

from jarvis.actions.registry import ActionRegistry


async def open_application(name: str) -> str:
    """Open an application by name."""
    # Common app mappings for Windows
    app_map = {
        "chrome": "chrome",
        "google chrome": "chrome",
        "browser": "chrome",
        "firefox": "firefox",
        "edge": "msedge",
        "notepad": "notepad",
        "calculator": "calc",
        "terminal": "wt",
        "cmd": "cmd",
        "powershell": "powershell",
        "explorer": "explorer",
        "file explorer": "explorer",
        "spotify": "spotify",
        "discord": "discord",
        "vscode": "code",
        "visual studio code": "code",
        "task manager": "taskmgr",
        "settings": "ms-settings:",
    }

    app_cmd = app_map.get(name.lower(), name)

    try:
        proc = await asyncio.create_subprocess_exec(
            "cmd", "/c", "start", "", app_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        return f"Opened {name}"
    except Exception as e:
        return f"Failed to open {name}: {e}"


async def run_shell_command(command: str) -> str:
    """Run a shell command and return the output."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode().strip()
        error = stderr.decode().strip()
        if proc.returncode != 0 and error:
            return f"Error: {error}"
        return output or "Command completed."
    except asyncio.TimeoutError:
        return "Command timed out after 30 seconds."
    except Exception as e:
        return f"Failed: {e}"


async def type_text(text: str) -> str:
    """Type text using keyboard simulation."""
    if pyautogui is None:
        return "pyautogui not installed"
    pyautogui.typewrite(text, interval=0.02)
    return f"Typed: {text}"


async def press_key(key: str) -> str:
    """Press a keyboard key or key combination (e.g., 'ctrl+c', 'enter')."""
    if pyautogui is None:
        return "pyautogui not installed"

    if "+" in key:
        keys = [k.strip() for k in key.split("+")]
        pyautogui.hotkey(*keys)
    else:
        pyautogui.press(key)
    return f"Pressed: {key}"


async def get_active_window() -> str:
    """Get the title of the currently active window."""
    if gw is None:
        return "pygetwindow not installed"
    win = gw.getActiveWindow()
    return win.title if win else "No active window"


async def take_screenshot() -> str:
    """Take a screenshot of the PC screen. Returns a description for the AI."""
    if pyautogui is None:
        return "pyautogui not installed"
    screenshot = pyautogui.screenshot()
    # Save temporarily for vision processing
    path = os.path.join(os.environ.get("TEMP", "/tmp"), "jarvis_screenshot.png")
    screenshot.save(path)
    return f"Screenshot saved to {path}"


async def set_volume(level: int) -> str:
    """Set system volume (0-100)."""
    try:
        # Use PowerShell to set volume on Windows
        cmd = f'powershell -c "(Get-AudioDevice -PlaybackVolume {level})"'
        # Fallback: use nircmd or similar
        proc = await asyncio.create_subprocess_shell(
            f'powershell -c "$wshShell = New-Object -ComObject WScript.Shell; '
            f'1..50 | ForEach-Object {{ $wshShell.SendKeys([char]174) }}; '
            f'1..{level // 2} | ForEach-Object {{ $wshShell.SendKeys([char]175) }}"',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        return f"Volume set to approximately {level}%"
    except Exception as e:
        return f"Failed to set volume: {e}"


async def get_time() -> str:
    """Get the current time and date."""
    from datetime import datetime
    now = datetime.now()
    return now.strftime("It's %I:%M %p on %A, %B %d, %Y")


async def get_weather(location: str = "auto") -> str:
    """Get current weather (uses wttr.in)."""
    try:
        loc = "" if location == "auto" else location
        proc = await asyncio.create_subprocess_exec(
            "curl", "-s", f"wttr.in/{loc}?format=3",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return stdout.decode().strip() or "Could not fetch weather."
    except Exception:
        return "Weather service unavailable."


def register_system_actions():
    """Register all system actions with the global registry."""
    registry = ActionRegistry.get_instance()

    registry.register(
        "open_app",
        "Open an application by name (e.g., 'chrome', 'spotify', 'vscode')",
        open_application,
        {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Application name to open"},
            },
            "required": ["name"],
        },
    )

    registry.register(
        "run_command",
        "Run a shell command on the PC and return its output",
        run_shell_command,
        {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute"},
            },
            "required": ["command"],
        },
    )

    registry.register(
        "type_text",
        "Type text on the keyboard as if the user typed it",
        type_text,
        {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to type"},
            },
            "required": ["text"],
        },
    )

    registry.register(
        "press_key",
        "Press a key or key combination (e.g., 'enter', 'ctrl+c', 'alt+tab')",
        press_key,
        {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Key or combination to press"},
            },
            "required": ["key"],
        },
    )

    registry.register(
        "screenshot",
        "Take a screenshot of the PC screen",
        take_screenshot,
        {"type": "object", "properties": {}},
    )

    registry.register(
        "get_time",
        "Get the current time and date",
        get_time,
        {"type": "object", "properties": {}},
    )

    registry.register(
        "get_weather",
        "Get current weather for a location",
        get_weather,
        {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "City name or 'auto' for current location"},
            },
        },
    )

    registry.register(
        "set_volume",
        "Set the system audio volume (0-100)",
        set_volume,
        {
            "type": "object",
            "properties": {
                "level": {"type": "integer", "description": "Volume level 0-100"},
            },
            "required": ["level"],
        },
    )
