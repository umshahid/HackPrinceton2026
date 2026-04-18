"""Claude API engine — for complex reasoning tasks and Claude Code integration."""

import asyncio
import json
import numpy as np
from loguru import logger

from jarvis.ai.base import AIEngine, AIResponse, ToolCall
from jarvis.config import ANTHROPIC_API_KEY, CLAUDE_CODE_PATH

try:
    import anthropic
except ImportError:
    anthropic = None

JARVIS_SYSTEM_PROMPT = """You are JARVIS, an advanced AI assistant inspired by Iron Man's JARVIS.
You are the complex reasoning backend. When the primary voice AI (Gemini Live) encounters
a task requiring deep analysis, coding, or multi-step reasoning, it delegates to you.

Keep responses concise — they will be spoken aloud through glasses speakers.
When using tools, explain what you're doing briefly."""


class ClaudeEngine(AIEngine):
    """Claude API for complex reasoning and Claude Code CLI for software tasks."""

    def __init__(self):
        self._client = None
        self._model = "claude-sonnet-4-20250514"

    @property
    def name(self) -> str:
        return "claude"

    @property
    def supports_vision(self) -> bool:
        return True

    async def initialize(self):
        if anthropic is None:
            raise ImportError("anthropic not installed. Install with: pip install anthropic")
        if not ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY not set in .env file")

        self._client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        logger.info(f"Claude engine initialized (model: {self._model})")

    async def process_text(self, text: str, image: np.ndarray | None = None) -> AIResponse:
        if self._client is None:
            await self.initialize()

        messages_content = []

        if image is not None:
            try:
                import cv2
                _, jpeg_data = cv2.imencode(".jpg", image[:, :, ::-1])
                import base64
                b64 = base64.b64encode(jpeg_data.tobytes()).decode()
                messages_content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                })
            except ImportError:
                pass

        messages_content.append({"type": "text", "text": text})

        tools = self.get_tools_schema()

        kwargs = {
            "model": self._model,
            "max_tokens": 1024,
            "system": JARVIS_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": messages_content}],
        }
        if tools:
            kwargs["tools"] = tools

        response = await self._client.messages.create(**kwargs)

        result = AIResponse()
        for block in response.content:
            if block.type == "text":
                result.text += block.text
            elif block.type == "tool_use":
                result.tool_calls.append(
                    ToolCall(name=block.name, arguments=block.input, id=block.id)
                )

        return result

    async def invoke_claude_code(self, prompt: str, working_dir: str = None) -> str:
        """Invoke Claude Code CLI for complex software engineering tasks.

        Args:
            prompt: The task description for Claude Code.
            working_dir: Optional working directory.

        Returns:
            Claude Code's output as a string.
        """
        cmd = [CLAUDE_CODE_PATH, "--print", prompt]

        logger.info(f"Invoking Claude Code: {prompt[:80]}...")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=120  # 2 min timeout
            )
            output = stdout.decode().strip()
            if proc.returncode != 0:
                error = stderr.decode().strip()
                logger.warning(f"Claude Code returned non-zero: {error}")
                output = f"Error: {error}" if error else output
            return output or "Claude Code completed with no output."
        except asyncio.TimeoutError:
            logger.error("Claude Code timed out after 120 seconds")
            return "Claude Code timed out."
        except FileNotFoundError:
            logger.error(f"Claude Code not found at: {CLAUDE_CODE_PATH}")
            return "Claude Code CLI not found. Make sure it's installed and in PATH."

    async def shutdown(self):
        self._client = None
        logger.info("Claude engine shut down")

    def get_tools_schema(self) -> list[dict] | None:
        """Return tools in Claude's tool format."""
        from jarvis.actions.registry import ActionRegistry

        registry = ActionRegistry.get_instance()
        if not registry or not registry.actions:
            return None

        tools = []
        for action in registry.actions.values():
            tool = {
                "name": action["name"],
                "description": action["description"],
                "input_schema": action.get("parameters", {"type": "object", "properties": {}}),
            }
            tools.append(tool)
        return tools if tools else None
