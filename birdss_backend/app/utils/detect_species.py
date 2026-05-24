from pathlib import Path
import birdnet

_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is None:
        _MODEL = birdnet.load("acoustic", "2.4", "tf")
    return _MODEL


def detect_species(audio_path: str | Path):
    if isinstance(audio_path, str):
        audio_path = Path(audio_path)

    model = _get_model()
    predictions = model.predict(
        audio_path,
        n_workers=1,
        n_producers=1,
        batch_size=1,
        device="CPU",
    )

    structured = predictions.to_structured_array()
    return structured.tolist()
