from beanie import Document
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


class Point(BaseModel):
    x: float
    y: float


class Wall(BaseModel):
    id: str = Field(default_factory=new_id)
    start: Point
    end: Point
    thickness: float = 10.0   # pixels on canvas (20px = ~20cm at 50px/m)
    height: float = 2.8       # metres, for 3D
    color: Optional[str] = None
    dimension_offset: Optional[float] = None


class Opening(BaseModel):
    id: str = Field(default_factory=new_id)
    wall_id: str
    type: str = "door"        # door | window
    offset: float = 0.5       # fraction along wall 0..1
    width: float = 80.0       # canvas pixels
    swing: str = "left"
    height: Optional[float] = None
    elevation: Optional[float] = None
    trim: Optional[float] = None
    door_style: Optional[str] = None
    mount: Optional[str] = None
    swing_direction: Optional[str] = None
    swing_angle: Optional[float] = None
    handle_style: Optional[str] = None
    frame_color: Optional[str] = None
    panel_color: Optional[str] = None


class PlacedObject(BaseModel):
    id: str = Field(default_factory=new_id)
    type: str                  # sofa | bed | table | chair | desk | wardrobe
    label: str
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    color: str = "#a3b18a"


class FloorPlan(BaseModel):
    walls: List[Wall] = []
    openings: List[Opening] = []
    objects: List[PlacedObject] = []
    canvas_width: float = 1200
    canvas_height: float = 800
    grid_size: float = 20.0


class Project(Document):
    name: str
    owner_id: str
    description: str = ""
    floor_plan: FloorPlan = Field(default_factory=FloorPlan)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "projects"


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectSummary(BaseModel):
    id: str
    name: str
    description: str
    created_at: datetime
    updated_at: datetime
    wall_count: int
    object_count: int


class ProjectDetail(BaseModel):
    id: str
    name: str
    description: str
    floor_plan: FloorPlan
    created_at: datetime
    updated_at: datetime
