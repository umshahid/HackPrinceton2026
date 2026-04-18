"""HUD Renderer — generates frames for the glasses display via virtual camera."""

import math
import time
import numpy as np
from loguru import logger

from jarvis.config import (
    VIRTUAL_CAM_WIDTH, VIRTUAL_CAM_HEIGHT,
    HUD_BG_COLOR, HUD_TEXT_COLOR, HUD_ACCENT_COLOR,
    HUD_FONT_SIZE, HUD_PADDING,
)

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = None
    ImageDraw = None
    ImageFont = None


class HUDState:
    """Current state of the HUD display."""

    def __init__(self):
        self.status: str = "ONLINE"  # ONLINE, LISTENING, THINKING, SPEAKING, ACTION
        self.response_text: str = ""
        self.action_text: str = ""
        self.notification: str = ""
        self.notification_expire: float = 0
        self.show_time: bool = True
        self.subtitle_text: str = ""
        self.mic_level: float = 0.0  # 0.0 - 1.0 current mic amplitude
        self.mic_levels_history: list[float] = []  # Rolling waveform

    def set_notification(self, text: str, duration: float = 5.0):
        self.notification = text
        self.notification_expire = time.time() + duration

    def update_mic_level(self, level: float):
        self.mic_level = min(1.0, max(0.0, level))
        self.mic_levels_history.append(self.mic_level)
        if len(self.mic_levels_history) > 60:
            self.mic_levels_history.pop(0)

    def clear_expired(self):
        if self.notification and time.time() > self.notification_expire:
            self.notification = ""


# Color palette
CYAN = (0, 200, 255)
CYAN_DIM = (0, 80, 120)
CYAN_BRIGHT = (0, 240, 255)
GREEN = (0, 255, 120)
GREEN_DIM = (0, 100, 50)
AMBER = (255, 200, 0)
ORANGE = (255, 165, 0)
RED = (255, 60, 60)
WHITE = (220, 220, 220)
WHITE_DIM = (120, 120, 120)
BG_PANEL = (5, 12, 20)
BG_PANEL_LIGHT = (10, 25, 40)


class HUDRenderer:
    """Renders Iron Man inspired HUD frames using Pillow."""

    def __init__(self, width: int = None, height: int = None):
        self.width = width or VIRTUAL_CAM_WIDTH
        self.height = height or VIRTUAL_CAM_HEIGHT
        self.state = HUDState()
        self._font = None
        self._font_small = None
        self._font_large = None
        self._font_tiny = None
        self._frame_count = 0
        self._start_time = time.time()

        if Image is None:
            logger.error("Pillow not installed. HUD rendering disabled.")
            return

        # Load fonts
        for font_name in ["consola.ttf", "cour.ttf", "lucon.ttf"]:
            try:
                self._font = ImageFont.truetype(font_name, HUD_FONT_SIZE)
                self._font_small = ImageFont.truetype(font_name, HUD_FONT_SIZE - 8)
                self._font_large = ImageFont.truetype(font_name, HUD_FONT_SIZE + 14)
                self._font_tiny = ImageFont.truetype(font_name, HUD_FONT_SIZE - 14)
                break
            except (OSError, IOError):
                continue
        else:
            self._font = ImageFont.load_default()
            self._font_small = self._font
            self._font_large = self._font
            self._font_tiny = self._font

    def render_frame(self) -> np.ndarray:
        """Render a single HUD frame."""
        if Image is None:
            return np.zeros((self.height, self.width, 3), dtype=np.uint8)

        self.state.clear_expired()
        self._frame_count += 1
        t = time.time() - self._start_time

        img = Image.new("RGB", (self.width, self.height), HUD_BG_COLOR)
        draw = ImageDraw.Draw(img)

        self._draw_scan_lines(draw, t)
        self._draw_corner_brackets(draw)
        self._draw_top_bar(draw, t)
        self._draw_side_bars(draw, t)
        self._draw_center_arc(draw, t)
        self._draw_mic_waveform(draw, t)
        self._draw_response_text(draw)
        self._draw_action_text(draw)
        self._draw_notification(draw)
        self._draw_subtitle(draw)
        self._draw_bottom_bar(draw, t)

        return np.array(img)

    def _draw_scan_lines(self, draw: ImageDraw.Draw, t: float):
        """Subtle horizontal scan lines for that sci-fi feel."""
        for y in range(0, self.height, 4):
            draw.line([(0, y), (self.width, y)], fill=(5, 8, 12), width=1)

        # Moving scan line
        scan_y = int((t * 40) % self.height)
        for i in range(6):
            alpha = max(0, 30 - i * 5)
            y = scan_y - i * 2
            if 0 <= y < self.height:
                draw.line([(0, y), (self.width, y)], fill=(0, alpha, alpha * 2), width=1)

    def _draw_corner_brackets(self, draw: ImageDraw.Draw):
        """Large corner bracket accents."""
        s = 50   # bracket size
        w = 2    # line width
        m = 6    # margin
        c = CYAN

        # Top-left
        draw.line([(m, m), (m + s, m)], fill=c, width=w)
        draw.line([(m, m), (m, m + s)], fill=c, width=w)
        # Top-right
        draw.line([(self.width - m - s, m), (self.width - m, m)], fill=c, width=w)
        draw.line([(self.width - m, m), (self.width - m, m + s)], fill=c, width=w)
        # Bottom-left
        draw.line([(m, self.height - m - s), (m, self.height - m)], fill=c, width=w)
        draw.line([(m, self.height - m), (m + s, self.height - m)], fill=c, width=w)
        # Bottom-right
        draw.line([(self.width - m, self.height - m - s), (self.width - m, self.height - m)], fill=c, width=w)
        draw.line([(self.width - m - s, self.height - m), (self.width - m, self.height - m)], fill=c, width=w)

        # Inner subtle brackets (smaller, dimmer)
        s2 = 25
        m2 = 16
        draw.line([(m2, m2), (m2 + s2, m2)], fill=CYAN_DIM, width=1)
        draw.line([(m2, m2), (m2, m2 + s2)], fill=CYAN_DIM, width=1)
        draw.line([(self.width - m2 - s2, m2), (self.width - m2, m2)], fill=CYAN_DIM, width=1)
        draw.line([(self.width - m2, m2), (self.width - m2, m2 + s2)], fill=CYAN_DIM, width=1)

    def _draw_top_bar(self, draw: ImageDraw.Draw, t: float):
        """Top status bar with JARVIS branding."""
        pad = HUD_PADDING + 10
        y = 18

        # Status colors with pulse
        status_config = {
            "ONLINE":    (GREEN, "SYSTEMS NOMINAL"),
            "LISTENING": (CYAN_BRIGHT, "AUDIO INPUT ACTIVE"),
            "THINKING":  (AMBER, "PROCESSING"),
            "SPEAKING":  (CYAN, "AUDIO OUTPUT"),
            "ACTION":    (ORANGE, "EXECUTING TASK"),
        }
        color, sub_text = status_config.get(self.state.status, (CYAN, ""))

        # Pulse for active states
        if self.state.status != "ONLINE":
            pulse = 0.6 + 0.4 * math.sin(t * 4)
            color = tuple(int(c * pulse) for c in color)

        # Status dot (larger, with glow ring)
        dot_x, dot_y = pad, y + 4
        # Glow
        draw.ellipse([dot_x - 3, dot_y - 3, dot_x + 15, dot_y + 15], fill=None, outline=(*color[:3],), width=1)
        # Solid dot
        draw.ellipse([dot_x + 1, dot_y + 1, dot_x + 11, dot_y + 11], fill=color)

        # JARVIS title
        draw.text((pad + 22, y - 1), "J.A.R.V.I.S.", font=self._font, fill=CYAN_BRIGHT)

        # Separator dash
        title_bbox = draw.textbbox((0, 0), "J.A.R.V.I.S.", font=self._font)
        title_w = title_bbox[2] - title_bbox[0]
        sep_x = pad + 22 + title_w + 12
        draw.text((sep_x, y - 1), "//", font=self._font, fill=CYAN_DIM)

        # Status text
        draw.text((sep_x + 28, y - 1), self.state.status, font=self._font, fill=color)

        # Sub-status (smaller)
        draw.text((sep_x + 28, y + HUD_FONT_SIZE + 2), sub_text, font=self._font_tiny, fill=WHITE_DIM)

        # Time + date (top right)
        from datetime import datetime
        now = datetime.now()
        time_str = now.strftime("%H:%M:%S")
        date_str = now.strftime("%Y.%m.%d")

        time_bbox = draw.textbbox((0, 0), time_str, font=self._font)
        tw = time_bbox[2] - time_bbox[0]
        date_bbox = draw.textbbox((0, 0), date_str, font=self._font_tiny)
        dw = date_bbox[2] - date_bbox[0]

        draw.text((self.width - pad - tw, y - 1), time_str, font=self._font, fill=CYAN)
        draw.text((self.width - pad - dw, y + HUD_FONT_SIZE + 2), date_str, font=self._font_tiny, fill=WHITE_DIM)

        # Separator line
        line_y = y + HUD_FONT_SIZE + 18
        # Gradient-style line (bright center, dim edges)
        mid = self.width // 2
        draw.line([(pad, line_y), (mid - 100, line_y)], fill=CYAN_DIM, width=1)
        draw.line([(mid - 100, line_y), (mid + 100, line_y)], fill=CYAN, width=1)
        draw.line([(mid + 100, line_y), (self.width - pad, line_y)], fill=CYAN_DIM, width=1)

        # Small tick marks on the line
        for x in range(pad + 50, self.width - pad - 50, 80):
            draw.line([(x, line_y - 3), (x, line_y + 3)], fill=CYAN_DIM, width=1)

    def _draw_side_bars(self, draw: ImageDraw.Draw, t: float):
        """Side data readout bars."""
        # Left side — system stats
        x = 20
        y_start = 90
        labels = ["SYS", "NET", "MEM", "AUD"]
        for i, label in enumerate(labels):
            y = y_start + i * 28
            draw.text((x, y), label, font=self._font_tiny, fill=CYAN_DIM)

            # Bar background
            bar_x = x + 40
            bar_w = 80
            bar_h = 8
            draw.rectangle([(bar_x, y + 4), (bar_x + bar_w, y + 4 + bar_h)], fill=(10, 15, 25))

            # Animated fill
            phase = (t * 0.3 + i * 0.7) % 1.0
            fill_pct = 0.4 + 0.3 * math.sin(phase * math.pi * 2)
            if label == "AUD":
                fill_pct = self.state.mic_level
            fill_w = int(bar_w * fill_pct)
            if fill_w > 0:
                bar_color = GREEN if fill_pct < 0.7 else (AMBER if fill_pct < 0.9 else RED)
                draw.rectangle([(bar_x, y + 4), (bar_x + fill_w, y + 4 + bar_h)], fill=bar_color)

            # Percentage
            draw.text((bar_x + bar_w + 8, y), f"{int(fill_pct * 100)}%", font=self._font_tiny, fill=WHITE_DIM)

        # Right side — uptime + frame counter
        x_r = self.width - 140
        uptime = time.time() - self._start_time
        mins, secs = divmod(int(uptime), 60)
        hrs, mins = divmod(mins, 60)

        draw.text((x_r, 90), "UPTIME", font=self._font_tiny, fill=CYAN_DIM)
        draw.text((x_r, 106), f"{hrs:02d}:{mins:02d}:{secs:02d}", font=self._font_small, fill=WHITE_DIM)

        draw.text((x_r, 135), "FRAMES", font=self._font_tiny, fill=CYAN_DIM)
        draw.text((x_r, 151), f"{self._frame_count:,}", font=self._font_small, fill=WHITE_DIM)

    def _draw_center_arc(self, draw: ImageDraw.Draw, t: float):
        """Central arc/circle element — the signature Jarvis look."""
        cx = self.width // 2
        cy = self.height // 2 + 10

        # Only draw when idle or listening (not when text is showing)
        if self.state.response_text:
            return

        # Outer ring (rotating dashes)
        r = 80
        segments = 24
        rotation = t * 30  # degrees per second
        for i in range(segments):
            angle = (i * (360 / segments) + rotation) % 360
            if i % 3 == 0:  # Skip every 3rd for gap effect
                continue
            rad = math.radians(angle)
            rad2 = math.radians(angle + (360 / segments) * 0.6)
            x1 = cx + int(r * math.cos(rad))
            y1 = cy + int(r * math.sin(rad))
            x2 = cx + int(r * math.cos(rad2))
            y2 = cy + int(r * math.sin(rad2))
            draw.line([(x1, y1), (x2, y2)], fill=CYAN_DIM, width=1)

        # Inner ring (counter-rotating)
        r2 = 55
        rotation2 = -t * 45
        for i in range(16):
            angle = (i * (360 / 16) + rotation2) % 360
            if i % 2 == 0:
                continue
            rad = math.radians(angle)
            rad2 = math.radians(angle + (360 / 16) * 0.5)
            x1 = cx + int(r2 * math.cos(rad))
            y1 = cy + int(r2 * math.sin(rad))
            x2 = cx + int(r2 * math.cos(rad2))
            y2 = cy + int(r2 * math.sin(rad2))
            draw.line([(x1, y1), (x2, y2)], fill=CYAN, width=2)

        # Center point
        draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=CYAN_BRIGHT)

        # Status text in center
        if self.state.status == "LISTENING":
            # Pulsing ring
            pulse_r = 55 + int(15 * math.sin(t * 6))
            for angle in range(0, 360, 5):
                rad = math.radians(angle)
                x = cx + int(pulse_r * math.cos(rad))
                y = cy + int(pulse_r * math.sin(rad))
                intensity = int(80 + 40 * math.sin(math.radians(angle * 3 + t * 200)))
                draw.point((x, y), fill=(0, intensity, intensity * 2))

        elif self.state.status == "THINKING":
            # Spinning dots
            for i in range(8):
                angle = (i * 45 + t * 180) % 360
                rad = math.radians(angle)
                x = cx + int(45 * math.cos(rad))
                y = cy + int(45 * math.sin(rad))
                dot_size = 2 + (i % 3)
                brightness = 100 + int(155 * ((i + 1) / 8))
                draw.ellipse(
                    [x - dot_size, y - dot_size, x + dot_size, y + dot_size],
                    fill=(0, brightness, int(brightness * 1.2)),
                )

    def _draw_mic_waveform(self, draw: ImageDraw.Draw, t: float):
        """Audio waveform visualization at the bottom center."""
        levels = self.state.mic_levels_history
        if not levels:
            # Draw idle waveform
            levels = [0.03 + 0.02 * math.sin(t * 2 + i * 0.3) for i in range(40)]

        cx = self.width // 2
        y_base = self.height - 80
        bar_count = min(len(levels), 50)
        bar_width = 4
        gap = 3
        total_w = bar_count * (bar_width + gap)
        start_x = cx - total_w // 2

        for i in range(bar_count):
            idx = len(levels) - bar_count + i
            if idx < 0:
                continue
            level = levels[idx]
            bar_h = max(2, int(level * 50))
            x = start_x + i * (bar_width + gap)

            # Color based on level
            if level < 0.3:
                color = CYAN_DIM
            elif level < 0.6:
                color = CYAN
            else:
                color = CYAN_BRIGHT

            # Draw bar (mirrored around baseline)
            draw.rectangle(
                [(x, y_base - bar_h), (x + bar_width, y_base + bar_h)],
                fill=color,
            )

        # Label
        label = "AUDIO INPUT" if self.state.mic_level > 0.05 else "AUDIO STANDBY"
        bbox = draw.textbbox((0, 0), label, font=self._font_tiny)
        lw = bbox[2] - bbox[0]
        draw.text((cx - lw // 2, y_base + 55), label, font=self._font_tiny, fill=CYAN_DIM)

    def _draw_response_text(self, draw: ImageDraw.Draw):
        """Main area: AI response text."""
        if not self.state.response_text:
            return

        pad = HUD_PADDING + 20
        y_start = 80
        max_width = self.width - (pad * 2)

        # "JARVIS:" label
        draw.text((pad, y_start - 4), "JARVIS:", font=self._font_small, fill=CYAN)

        # Response text
        lines = self._wrap_text(self.state.response_text, self._font, max_width, draw)
        line_height = HUD_FONT_SIZE + 6
        max_lines = (self.height - y_start - 140) // line_height
        visible_lines = lines[-max_lines:] if len(lines) > max_lines else lines

        text_y = y_start + 24
        for i, line in enumerate(visible_lines):
            y = text_y + i * line_height
            draw.text((pad, y), line, font=self._font, fill=WHITE)

    def _draw_action_text(self, draw: ImageDraw.Draw):
        """Show current action."""
        if not self.state.action_text:
            return

        pad = HUD_PADDING + 20
        y = self.height - 130

        # Action panel background
        draw.rectangle(
            [(pad - 5, y - 3), (self.width - pad + 5, y + 22)],
            fill=BG_PANEL_LIGHT,
            outline=ORANGE,
            width=1,
        )
        draw.text((pad + 5, y), f"▸ {self.state.action_text}", font=self._font_small, fill=ORANGE)

    def _draw_notification(self, draw: ImageDraw.Draw):
        """Show notification banner."""
        if not self.state.notification:
            return

        pad = HUD_PADDING + 10
        bar_y = 65
        bar_height = 28

        draw.rectangle(
            [(pad, bar_y), (self.width - pad, bar_y + bar_height)],
            fill=(0, 40, 60),
            outline=CYAN,
            width=1,
        )

        # Center the notification text
        bbox = draw.textbbox((0, 0), self.state.notification, font=self._font_small)
        tw = bbox[2] - bbox[0]
        tx = (self.width - tw) // 2
        draw.text((tx, bar_y + 5), self.state.notification, font=self._font_small, fill=CYAN_BRIGHT)

    def _draw_subtitle(self, draw: ImageDraw.Draw):
        """Live transcription subtitle at the bottom."""
        if not self.state.subtitle_text:
            return

        pad = HUD_PADDING + 20
        y = self.height - 50
        max_width = self.width - (pad * 2)

        lines = self._wrap_text(self.state.subtitle_text, self._font_small, max_width, draw)
        for i, line in enumerate(lines[-2:]):
            bbox = draw.textbbox((0, 0), line, font=self._font_small)
            lw = bbox[2] - bbox[0]
            x = (self.width - lw) // 2  # Center subtitles
            draw.text((x, y + i * 22), line, font=self._font_small, fill=WHITE_DIM)

    def _draw_bottom_bar(self, draw: ImageDraw.Draw, t: float):
        """Bottom info bar."""
        pad = HUD_PADDING + 10
        y = self.height - 22

        # Left: mode indicator
        draw.text((pad, y), "LOCAL MODE", font=self._font_tiny, fill=CYAN_DIM)

        # Center: decorative hex code (rotating for visual interest)
        hex_val = f"0x{int(t * 100) % 0xFFFF:04X}"
        bbox = draw.textbbox((0, 0), hex_val, font=self._font_tiny)
        hw = bbox[2] - bbox[0]
        draw.text((self.width // 2 - hw // 2, y), hex_val, font=self._font_tiny, fill=CYAN_DIM)

        # Right: version
        draw.text((self.width - pad - 60, y), "v0.1.0", font=self._font_tiny, fill=CYAN_DIM)

    def _wrap_text(self, text: str, font, max_width: int, draw: ImageDraw.Draw) -> list[str]:
        """Word-wrap text to fit within max_width pixels."""
        words = text.split()
        lines = []
        current_line = ""

        for word in words:
            test_line = f"{current_line} {word}".strip()
            bbox = draw.textbbox((0, 0), test_line, font=font)
            if bbox[2] - bbox[0] <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word

        if current_line:
            lines.append(current_line)

        return lines or [""]
