"""Gemini Live API engine — native audio streaming with vision support."""

import asyncio
import json
import numpy as np
from typing import AsyncIterator
from loguru import logger

from jarvis.ai.base import AIEngine, AIResponse, ToolCall
from jarvis.config import GEMINI_API_KEY, AUDIO_SAMPLE_RATE

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None


JARVIS_SYSTEM_PROMPT = """You are JARVIS, an advanced AI assistant inspired by Iron Man's JARVIS.
You are running on the user's PC and communicating through their Meta Ray-Ban smart glasses.

Key behaviors:
- Be concise and direct. The user hears your responses through glasses speakers.
- Keep responses SHORT (1-3 sentences) unless asked for detail.
- You can see through the glasses camera when asked to look at something.
- You have access to tools to control the user's computer, browse the web, and more.
- Address the user naturally. You are their personal AI assistant.
- Be proactive with useful information when you see something relevant.
- If the user asks you to do something on their computer, use the available tools.

You are speaking out loud — avoid markdown, bullet points, or formatting. Speak naturally."""


class GeminiLiveEngine(AIEngine):
    """Gemini 3.1 Flash Live for streaming audio conversations (free, unlimited)."""

    def __init__(self):
        self._client = None
        self._session = None
        self._model = "gemini-3.1-flash-live-preview"

    @property
    def name(self) -> str:
        return "gemini_live"

    @property
    def supports_audio_streaming(self) -> bool:
        return True

    @property
    def supports_vision(self) -> bool:
        return True

    async def initialize(self):
        if genai is None:
            raise ImportError(
                "google-genai not installed. Install with: pip install google-genai"
            )
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not set in .env file")

        self._client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info(f"Gemini Live engine initialized (model: {self._model})")

    def _build_config(self):
        """Build the LiveConnectConfig."""
        tools = self.get_tools_schema()

        config_kwargs = {
            "response_modalities": ["AUDIO"],
            "system_instruction": types.Content(
                parts=[types.Part(text=JARVIS_SYSTEM_PROMPT)]
            ),
        }

        if tools:
            config_kwargs["tools"] = tools

        return types.LiveConnectConfig(**config_kwargs)

    async def start_session(self):
        """Start a live streaming session. Returns an async context manager.

        Usage:
            async with await engine.start_session() as session:
                # session is now the live session with send/receive methods
        """
        config = self._build_config()
        ctx = self._client.aio.live.connect(model=self._model, config=config)
        logger.info(f"Gemini Live session starting (model: {self._model})")
        return ctx

    def _set_session(self, session):
        """Store the active session so send/receive methods work."""
        self._session = session

    async def send_audio(self, audio_chunk: bytes):
        """Send an audio chunk to the live session."""
        if self._session is None:
            logger.warning("No active Gemini session")
            return

        await self._session.send_realtime_input(
            audio=types.Blob(
                data=audio_chunk,
                mime_type=f"audio/pcm;rate={AUDIO_SAMPLE_RATE}",
            )
        )

    async def send_image(self, frame: np.ndarray):
        """Send a camera frame to the live session for vision."""
        if self._session is None:
            return

        try:
            import cv2
            _, jpeg_data = cv2.imencode(".jpg", frame[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 70])
            jpeg_bytes = jpeg_data.tobytes()
        except ImportError:
            from PIL import Image
            import io
            img = Image.fromarray(frame)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=70)
            jpeg_bytes = buf.getvalue()

        await self._session.send_realtime_input(
            video=types.Blob(data=jpeg_bytes, mime_type="image/jpeg")
        )

    async def send_text(self, text: str):
        """Send a text message to the live session."""
        if self._session is None:
            return
        await self._session.send_realtime_input(text=text)

    @staticmethod
    def _clean_thinking_text(text: str) -> str:
        """Strip chain-of-thought artifacts from native audio model text output.

        The native audio model outputs its reasoning as text (with **Bold Headers**
        and verbose internal monologue). We extract only the user-facing content.
        """
        import re
        # Remove **Bold Section Headers**
        text = re.sub(r'\*\*[^*]+\*\*\s*', '', text)
        # Collapse multiple newlines
        text = re.sub(r'\n{2,}', ' ', text)
        return text.strip()

    async def receive_responses(self) -> AsyncIterator[AIResponse]:
        """Receive streaming responses from the live session.

        Yields AIResponse objects containing audio chunks and/or text.
        """
        if self._session is None:
            return

        async for message in self._session.receive():
            response = AIResponse()

            # Handle server content (text/audio responses)
            if hasattr(message, "server_content") and message.server_content:
                content = message.server_content
                if hasattr(content, "model_turn") and content.model_turn:
                    for part in content.model_turn.parts:
                        if hasattr(part, "text") and part.text:
                            cleaned = self._clean_thinking_text(part.text)
                            if cleaned:
                                response.text = cleaned
                        if hasattr(part, "inline_data") and part.inline_data:
                            response.audio = part.inline_data.data
                            response.is_partial = True

                # Check if turn is complete
                if hasattr(content, "turn_complete") and content.turn_complete:
                    response.is_partial = False

            # Handle tool calls
            if hasattr(message, "tool_call") and message.tool_call:
                for fc in message.tool_call.function_calls:
                    response.tool_calls.append(
                        ToolCall(
                            name=fc.name,
                            arguments=dict(fc.args) if fc.args else {},
                            id=fc.id,
                        )
                    )

            yield response

    async def send_tool_result(self, tool_call_id: str, result: str):
        """Send the result of a tool call back to Gemini."""
        if self._session is None:
            return
        await self._session.send_tool_response(
            function_responses=[
                types.FunctionResponse(
                    name=tool_call_id,
                    id=tool_call_id,
                    response={"result": result},
                )
            ]
        )

    async def process_text(self, text: str, image: np.ndarray | None = None) -> AIResponse:
        """Process a text query (non-streaming fallback)."""
        if self._client is None:
            await self.initialize()

        contents = [types.Part(text=text)]
        if image is not None:
            try:
                import cv2
                _, jpeg_data = cv2.imencode(".jpg", image[:, :, ::-1])
                contents.insert(0, types.Part(
                    inline_data=types.Blob(data=jpeg_data.tobytes(), mime_type="image/jpeg")
                ))
            except ImportError:
                pass

        response = await self._client.aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=JARVIS_SYSTEM_PROMPT,
            ),
        )

        return AIResponse(text=response.text or "")

    async def process_audio_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        video_frame: np.ndarray | None = None,
    ) -> AsyncIterator[AIResponse]:
        """Stream audio to Gemini and yield responses."""
        # This is handled by the session-based API (start_session + send_audio + receive_responses)
        # This method exists for interface compliance
        async for chunk in audio_chunks:
            await self.send_audio(chunk)

        async for response in self.receive_responses():
            yield response

    async def shutdown(self):
        if self._session:
            await self._session.close()
            self._session = None
        self._client = None
        logger.info("Gemini Live engine shut down")

    def get_tools_schema(self) -> list[dict] | None:
        """Return tools in Gemini function calling format."""
        from jarvis.actions.registry import ActionRegistry

        registry = ActionRegistry.get_instance()
        if not registry or not registry.actions:
            return None

        declarations = []
        for action in registry.actions.values():
            declarations.append(
                types.FunctionDeclaration(
                    name=action["name"],
                    description=action["description"],
                    parameters=action.get("parameters"),
                )
            )

        if not declarations:
            return None

        return [types.Tool(function_declarations=declarations)]
