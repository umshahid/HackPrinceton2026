"""Logging configuration for Jarvis."""

import sys
from loguru import logger


def setup_logging(level: str = "INFO"):
    """Configure loguru logging."""
    logger.remove()  # Remove default handler

    # Console output with color
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    )

    # File output for debugging
    logger.add(
        "jarvis.log",
        level="DEBUG",
        rotation="10 MB",
        retention="3 days",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{line} - {message}",
    )

    logger.info("Jarvis logging initialized")
