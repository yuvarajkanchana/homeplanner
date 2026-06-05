from beanie import Document
from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class User(Document):
    email: EmailStr
    username: str
    hashed_password: str
    created_at: datetime = datetime.utcnow()

    class Settings:
        name = "users"

    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "username": "johndoe",
            }
        }


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    username: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
