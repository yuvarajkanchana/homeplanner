from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from app.models.project import Project, ProjectCreate, ProjectSummary, ProjectDetail, FloorPlan
from app.models.user import User
from app.core.security import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


def to_summary(p: Project) -> ProjectSummary:
    floors = p.floor_plan.floors
    return ProjectSummary(
        id=str(p.id),
        name=p.name,
        description=p.description,
        created_at=p.created_at,
        updated_at=p.updated_at,
        wall_count=sum(len(floor.walls) for floor in floors) if floors else len(p.floor_plan.walls),
        object_count=sum(len(floor.objects) for floor in floors) if floors else len(p.floor_plan.objects),
    )


def to_detail(p: Project) -> ProjectDetail:
    return ProjectDetail(
        id=str(p.id),
        name=p.name,
        description=p.description,
        floor_plan=p.floor_plan,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("/", response_model=List[ProjectSummary])
async def list_projects(user: User = Depends(get_current_user)):
    projects = await Project.find(Project.owner_id == str(user.id)).sort(-Project.updated_at).to_list()
    return [to_summary(p) for p in projects]


@router.post("/", response_model=ProjectDetail, status_code=201)
async def create_project(data: ProjectCreate, user: User = Depends(get_current_user)):
    project = Project(
        name=data.name,
        description=data.description,
        owner_id=str(user.id),
    )
    await project.insert()
    return to_detail(project)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: str, user: User = Depends(get_current_user)):
    project = await Project.get(project_id)
    if not project or project.owner_id != str(user.id):
        raise HTTPException(status_code=404, detail="Project not found")
    return to_detail(project)


@router.put("/{project_id}", response_model=ProjectDetail)
async def update_project(project_id: str, data: ProjectCreate, user: User = Depends(get_current_user)):
    project = await Project.get(project_id)
    if not project or project.owner_id != str(user.id):
        raise HTTPException(status_code=404, detail="Project not found")
    project.name = data.name
    project.description = data.description
    project.updated_at = datetime.utcnow()
    await project.save()
    return to_detail(project)


@router.put("/{project_id}/floorplan", response_model=ProjectDetail)
async def save_floor_plan(project_id: str, floor_plan: FloorPlan, user: User = Depends(get_current_user)):
    project = await Project.get(project_id)
    if not project or project.owner_id != str(user.id):
        raise HTTPException(status_code=404, detail="Project not found")
    project.floor_plan = floor_plan
    project.updated_at = datetime.utcnow()
    await project.save()
    return to_detail(project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, user: User = Depends(get_current_user)):
    project = await Project.get(project_id)
    if not project or project.owner_id != str(user.id):
        raise HTTPException(status_code=404, detail="Project not found")
    await project.delete()
