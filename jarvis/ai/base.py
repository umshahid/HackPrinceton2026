"""Abstract base class for AI engines."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator
import numpy as np


class ResponseType(Enum):
    TEXT = "text"
    AUDIO = "audio"
    ACTION = "action"


@dataclass
class ToolCall:
    """Represents a tool/function call requested by the AI."""
    name: str
    arguments: dict
    id: str = ""


@dataclass
class AIResponse:
    """Response from an AI engine."""
    text: str = ""
    audio: bytes | None = None  # Raw PCM int16 audio
    tool_calls: list[ToolCall] = field(default_factory=list)
    is_partial: bool = False  # True if this is a streaming chunk


class AIEngine(ABC):
    """Abstract interface for pluggable AI engines.

    All AI engines must implement this interface so they can be swapped
    transparently by the orchestrator.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name of this engine."""
        ...

    @property
    def supports_audio_streaming(self) -> bool:
        """Whether this engine supports native audio-in/audio-out streaming."""
        return False

    @property
    def supports_vision(self) -> bool:
        """Whether this engine can process images/video frames."""
        return False

    @abstractmethod
    async def initialize(self):
        """Set up the engine (API connections, model loading, etc.)."""
        ...

    @abstractmethod
    async def process_text(self, text: str, image: np.ndarray | None = None) -> AIResponse:
        """Process a text query with optional image.

        Args:
            text: User's text input (from STT or direct).
            image: Optional camera frame (RGB numpy array).

        Returns:
            AIResponse with text and optional tool calls.
        """
        ...

    async def process_audio_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        video_frame: np.ndarray | None = None,
    ) -> AsyncIterator[AIResponse]:
        """Process streaming audio input and yield streaming responses.

        Only engines with supports_audio_streaming=True need to implement this.
        Default implementation raises NotImplementedError.

        Args:
            audio_chunks: Async iterator of PCM int16 audio chunks.
            video_frame: Optional current camera frame for context.

        Yields:
            AIResponse objects (may contain partial text or audio chunks).
        """
        raise NotImplementedError(f"{self.name} does not support audio streaming")
        yield  # Make this a generator

    @abstractmethod
    async def shutdown(self):
        """Clean up resources."""
        ...

    def get_tools_schema(self) -> list[dict]:
        """Return tool/function definitions in the format the AI engine expects.

        Override in subclasses to provide engine-specific tool formatting.
        """
        from jarvis.actions.registry import get_tools_for_ai
        return get_tools_for_ai(self.name)
