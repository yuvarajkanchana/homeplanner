from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import certifi

from app.core.config import settings
from app.models.user import User
from app.models.project import Project


async def init_db():
    client = AsyncIOMotorClient(
        settings.MONGO_URL,
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=10000,
    )
    await init_beanie(
        database=client[settings.DB_NAME],
        document_models=[User, Project],
    )
