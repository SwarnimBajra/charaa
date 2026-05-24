import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.routes import router
# from app.routes import forest_health

logging.basicConfig(
    level=logging.INFO, format="    [%(levelname)s]: %(name)s -> %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI()
allowed_origins = os.getenv("FRONTEND_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/")
def health():
    return {"status": "healthy"}
