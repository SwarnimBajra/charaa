from fastapi import UploadFile, File
import tempfile
import logging
from pathlib import Path

from app.utils import detect_species, Species, prepare_audio_for_inference
from . import router


logger = logging.getLogger(__name__)


@router.post("/species")
async def species(audio: UploadFile = File(...)):
    audio_data = await audio.read()

    extension = Path(audio.filename).suffix if audio.filename else ".MP3"
    logger.info("Audio has extension %s", extension)

    # create temp File
    temp_path = None
    cleanup_paths = []
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=extension,
    ) as temp_audio:
        temp_audio.write(audio_data)
        temp_path = temp_audio.name

    logger.info(f"Audio is stored in {temp_path} temporarily")

    try:
        audio_path, cleanup_paths = prepare_audio_for_inference(Path(temp_path))
        raw_data = detect_species(audio_path)
        species_data = [Species.from_row(row) for row in raw_data]
    except ValueError as exc:
        logger.warning("Audio preprocessing failed: %s", exc)
        return {"status": "failed", "data": str(exc)}
    except Exception as e:
        logger.exception("Failed to detect species %s", e)
        return {"status": "failed", "data": str(e)}
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temp file: %s", temp_path)
        for extra in cleanup_paths:
            try:
                extra.unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temp file: %s", extra)

    return {"status": "success", "data": species_data}
    # TODO: CLEANUP tempfile
