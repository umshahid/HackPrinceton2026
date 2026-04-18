"""Reusable HUD UI elements for building more complex displays."""

from dataclasses import dataclass

try:
    from PIL import ImageDraw, ImageFont
except ImportError:
    ImageDraw = None

from jarvis.config import HUD_TEXT_COLOR, HUD_ACCENT_COLOR, HUD_PADDING


@dataclass
class Card:
    """A card-style notification or info panel."""
    title: str
    body: str
    x: int = HUD_PADDING
    y: int = 50
    width: int = 400
    bg_color: tuple = (10, 20, 40)
    border_color: tuple = HUD_ACCENT_COLOR

    def draw(self, draw: ImageDraw.Draw, font, font_small):
        # Background
        height = 80  # Will expand based on text
        draw.rectangle(
            [(self.x, self.y), (self.x + self.width, self.y + height)],
            fill=self.bg_color,
            outline=self.border_color,
            width=1,
        )
        # Title
        draw.text(
            (self.x + 10, self.y + 8),
            self.title.upper(),
            font=font_small,
            fill=self.border_color,
        )
        # Separator
        draw.line(
            [(self.x + 10, self.y + 28), (self.x + self.width - 10, self.y + 28)],
            fill=self.border_color,
            width=1,
        )
        # Body
        draw.text(
            (self.x + 10, self.y + 35),
            self.body,
            font=font,
            fill=HUD_TEXT_COLOR,
        )


@dataclass
class ProgressBar:
    """A horizontal progress bar."""
    x: int
    y: int
    width: int = 300
    height: int = 12
    progress: float = 0.0  # 0.0 to 1.0
    color: tuple = HUD_ACCENT_COLOR
    bg_color: tuple = (30, 30, 30)

    def draw(self, draw: ImageDraw.Draw):
        # Background
        draw.rectangle(
            [(self.x, self.y), (self.x + self.width, self.y + self.height)],
            fill=self.bg_color,
            outline=(60, 60, 60),
        )
        # Fill
        fill_width = int(self.width * min(1.0, max(0.0, self.progress)))
        if fill_width > 0:
            draw.rectangle(
                [(self.x, self.y), (self.x + fill_width, self.y + self.height)],
                fill=self.color,
            )


@dataclass
class WaveformDisplay:
    """Displays an audio waveform visualization."""
    x: int
    y: int
    width: int = 200
    height: int = 40
    color: tuple = HUD_ACCENT_COLOR
    bars: int = 20

    def draw(self, draw: ImageDraw.Draw, levels: list[float] = None):
        """Draw waveform bars.

        Args:
            levels: List of amplitude levels (0.0-1.0). If None, draws idle state.
        """
        import random
        if levels is None:
            levels = [random.uniform(0.05, 0.15) for _ in range(self.bars)]

        bar_width = max(2, (self.width // self.bars) - 2)
        gap = 2

        for i, level in enumerate(levels[:self.bars]):
            bar_height = int(self.height * min(1.0, level))
            bx = self.x + i * (bar_width + gap)
            by = self.y + self.height - bar_height
            draw.rectangle(
                [(bx, by), (bx + bar_width, self.y + self.height)],
                fill=self.color,
            )
