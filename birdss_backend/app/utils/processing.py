from typing import Any
from collections import defaultdict
from pydantic import BaseModel, model_validator


class Species(BaseModel):
    audio_path: str
    start_time: float
    end_time: float
    species_label: str
    confidence: float

    @model_validator(mode="before")
    @classmethod
    def validate_row(cls, value: Any) -> Any:
        if isinstance(value, (list, tuple)):
            if len(value) < 5:
                raise ValueError("Species list must have at least 5 elements")
            return {
                "audio_path": value[0],
                "start_time": value[1],
                "end_time": value[2],
                "species_label": value[3],
                "confidence": value[4],
            }
        return value

    @classmethod
    def from_row(cls, row: list | tuple) -> "Species":
        return cls(
            audio_path=row[0],
            start_time=row[1],
            end_time=row[2],
            species_label=row[3],
            confidence=row[4],
        )


"""
species:
[
[ "/tmp/tmp1dyb0aq_.mp3", 0, 3, "Lophophorus impejanus_Himalayan Monal", 0.8378916382789612 ],
[ "/tmp/tmp1dyb0aq_.mp3", 0, 3, "Numenius arquata_Eurasian Curlew", 0.4291985034942627 ]
[ "/tmp/tmp1dyb0aq_.mp3", 4, 5, "Lophophorus impejanus_Himalayan Monal", 0.7378916382789612 ],
[ "audio_path", "start_time", "end_time", "species_label","confidence"],
]
"""


def preprocess_species(predictions: list, threshold=0.6):
    filtered = []

    for item in predictions:
        if isinstance(item, Species):
            audio_path = item.audio_path
            start_time = item.start_time
            end_time = item.end_time
            species_label = item.species_label
            confidence = item.confidence
        elif isinstance(item, (list, tuple)):
            if len(item) < 5:
                continue
            (audio_path, start_time, end_time, species_label, confidence) = item[:5]
        elif isinstance(item, dict):
            audio_path = item.get("audio_path")
            start_time = item.get("start_time")
            end_time = item.get("end_time")
            species_label = item.get("species_label")
            confidence = item.get("confidence")
            if None in (audio_path, start_time, end_time, species_label, confidence):
                continue
        else:
            continue

        if confidence < threshold:
            continue

        (scientic_name, common_name) = (
            species_label.split("_", 1)
            if "_" in species_label
            else (species_label, species_label)
        )

        filtered.append(
            {
                "scientific_name": scientic_name,
                "common_name": common_name,
                "confidence": confidence,
                "start_time": start_time,
                "end_time": end_time,
                "audio_path": audio_path,
            }
        )

    return filtered


def merge_species(predictions: list):
    species_map = defaultdict(list)

    for pred in predictions:
        species_id = pred["scientific_name"]
        species_map[species_id].append(pred)

    merged = []

    for species_id, detections in species_map.items():
        count = len(detections)

        avg_confidence = sum(d["confidence"] for d in detections) / count

        merged.append(
            {
                "scientific_name": species_id,
                "common_name": detections[0]["common_name"],
                "count": count,
                "avg_confidence": round(avg_confidence, 3),
                "timestamps": [
                    {
                        "start": d["start_time"],
                        "end": d["end_time"],
                    }
                    for d in detections
                ],
            }
        )

    return merged
