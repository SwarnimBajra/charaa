import asyncio
from app.utils import Species
from app.routes.forest_health import forest, ForestRequest

async def main():
    req = ForestRequest(
        loc="Kathmandu, Nepal",
        species=[
            Species(audio_path="test.mp3", start_time=0.0, end_time=3.0, species_label="Passer domesticus_House Sparrow", confidence=0.9),
            Species(audio_path="test.mp3", start_time=3.0, end_time=6.0, species_label="Lophophorus impejanus_Himalayan Monal", confidence=0.8),
            Species(audio_path="test.mp3", start_time=6.0, end_time=9.0, species_label="Gyps bengalensis_White-rumped Vulture", confidence=0.9)
        ]
    )
    result = await forest(req)
    import pprint
    pprint.pprint(result)

asyncio.run(main())
