from fastapi import APIRouter

router = APIRouter()

from . import forest_health
from . import list_species
from . import analyze_audio

