from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import certifi

from app.core.config import settings
from app.models.user import User
from app.models.project import Project


async def init_db():
    mongo_options = {"serverSelectionTimeoutMS": 10000}
    if settings.MONGO_URL.startswith("mongodb+srv://") or "tls=true" in settings.MONGO_URL.lower():
        mongo_options["tlsCAFile"] = certifi.where()

    client = AsyncIOMotorClient(settings.MONGO_URL, **mongo_options)
    await init_beanie(
        database=client[settings.DB_NAME],
        document_models=[User, Project],
    )
