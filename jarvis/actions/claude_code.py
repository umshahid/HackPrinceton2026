"""Claude Code CLI bridge — invoke Claude Code for complex software tasks."""

import asyncio
from loguru import logger

from jarvis.actions.registry import ActionRegistry
from jarvis.config import CLAUDE_CODE_PATH


async def invoke_claude_code(prompt: str, working_directory: str = None) -> str:
    """Run a prompt through Claude Code CLI.

    Args:
        prompt: The task description for Claude Code.
        working_directory: Directory to run in (optional).
    """
    cmd = [CLAUDE_CODE_PATH, "--print", prompt]

    logger.info(f"Claude Code: {prompt[:80]}...")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=working_directory,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        output = stdout.decode().strip()
        if proc.returncode != 0:
            error = stderr.decode().strip()
            if error:
                output = f"Error: {error}"

        # Truncate very long outputs
        if len(output) > 2000:
            output = output[:2000] + "\n... (truncated)"

        return output or "Completed with no output."
    except asyncio.TimeoutError:
        return "Claude Code timed out after 3 minutes."
    except FileNotFoundError:
        return f"Claude Code not found at '{CLAUDE_CODE_PATH}'. Is it installed?"


async def claude_code_interactive(prompt: str, working_directory: str = None) -> str:
    """Run Claude Code in interactive mode (for longer tasks).

    Streams output and returns a summary.
    """
    cmd = [CLAUDE_CODE_PATH, "--print", "--verbose", prompt]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=working_directory,
        )

        output_lines = []
        while True:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=180)
            if not line:
                break
            decoded = line.decode().strip()
            if decoded:
                output_lines.append(decoded)
                logger.debug(f"Claude Code: {decoded}")

        await proc.wait()
        output = "\n".join(output_lines[-20:])  # Last 20 lines
        return output or "Completed."
    except asyncio.TimeoutError:
        return "Claude Code timed out."
    except Exception as e:
        return f"Claude Code failed: {e}"


def register_claude_code_actions():
    """Register Claude Code actions with the global registry."""
    registry = ActionRegistry.get_instance()

    registry.register(
        "claude_code",
        "Ask Claude Code to perform a complex software engineering task (coding, debugging, file analysis). "
        "Use this for tasks that require reading/writing code, analyzing project structure, or multi-step development work.",
        invoke_claude_code,
        {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Detailed description of the task for Claude Code",
                },
                "working_directory": {
                    "type": "string",
                    "description": "Directory to work in (optional)",
                },
            },
            "required": ["prompt"],
        },
    )
