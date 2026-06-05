from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.db import init_db
from app.core.config import settings
from app.api.v1 import auth, projects


# 🔁 Startup (DB connection)
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting backend...")
    await init_db()
    print("✅ Database connected")
    yield
    print("🛑 Shutting down backend...")


# 🚀 Create app
app = FastAPI(
    title="HomePlanner API",
    version="1.0.0",
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in settings.CORS_ORIGINS.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 📦 Routes
app.include_router(auth.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")


# ❤️ Health check
@app.get("/")
async def root():
    return {"message": "HomePlanner API running"}

@app.get("/health")
async def health():
    return {"status": "ok"}
