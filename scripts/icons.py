#!/usr/bin/env python3
"""Render the vector brand with AppKit and package a macOS 14-compatible ICNS."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="transcribethem-icons-") as cache:
    subprocess.run([
        "swift", "-module-cache-path", cache,
        str(ROOT / "scripts/draw-icons.swift"), str(ROOT / "icons"),
    ], check=True)
subprocess.run([
    "iconutil", "-c", "icns", str(ROOT / "icons/AppIcon.iconset"),
    "-o", str(ROOT / "icons/AppIcon.icns"),
], check=True)
