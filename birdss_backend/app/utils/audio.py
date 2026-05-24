import logging
import shutil
import subprocess
from pathlib import Path
logger = logging.getLogger(__name__)

SUPPORTED_AUDIO_EXTS = {
    ".aifc",
    ".aiff",
    ".au",
    ".avr",
    ".caf",
    ".flac",
    ".htk",
    ".ircam",
    ".mat4",
    ".mat5",
    ".mp3",
    ".mpc2k",
    ".nist",
    ".ogg",
    ".opus",
    ".paf",
    ".pvf",
    ".raw",
    ".rf64",
    ".sd2",
    ".sds",
    ".svx",
    ".voc",
    ".w64",
    ".wav",
    ".wavex",
    ".wve",
    ".xi",
}


def prepare_audio_for_inference(path: Path) -> tuple[Path, list[Path]]:
    suffix = path.suffix.lower()
    if suffix in SUPPORTED_AUDIO_EXTS:
        return path, []

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError(
            f"Unsupported audio format: {suffix}. Install ffmpeg or upload one of: {sorted(SUPPORTED_AUDIO_EXTS)}"
        )

    converted = path.with_suffix(".wav")
    result = subprocess.run(
        [ffmpeg, "-y", "-i", str(path), str(converted)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.error("ffmpeg conversion failed: %s", result.stderr.strip())
        raise ValueError("Failed to convert audio to WAV for BirdNET")

    return converted, [converted]
