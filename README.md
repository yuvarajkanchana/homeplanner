# HomePlanner MVP

A fully functional home floor planning application with 2D editing and real-time 3D visualization.

## Stack

- **Backend**: FastAPI + MongoDB (Beanie ODM) + Python 3.11
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **2D Editor**: Konva.js (react-konva)
- **3D Viewer**: Three.js via React Three Fiber
- **State**: Zustand

---

## Quick Start

### Prerequisites
- Docker Desktop (or Docker + Docker Compose)
- That's it — no Node.js or Python needed locally

### 1. Clone / extract the project

```bash
cd homeplanner
```

### 2. Start everything

```bash
docker-compose up --build
```

First build takes 3–5 minutes (installing npm packages + pip packages).

### 3. Open the app

| Service   | URL                        |
|-----------|----------------------------|
| Frontend  | http://localhost:5173      |
| Backend   | http://localhost:8000      |
| API Docs  | http://localhost:8000/docs |

---

## Local Development Without Docker

If you run the frontend and backend directly on Windows, start MongoDB first and use localhost URLs.

Backend:

```bash
cd backend
copy .env.example .env
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
copy .env.example .env
npm install
npm run dev
```

For deployed frontend builds, set `VITE_API_URL` to the deployed backend URL, for example:

```env
VITE_API_URL=https://your-render-service.onrender.com
```

For Render backend deploys, make sure `MONGO_URL`, `SECRET_KEY`, and `CORS_ORIGINS` are set in the Render service environment.

---

## Using the App

### Register & Login
1. Open http://localhost:5173
2. Click "Create one" to register
3. Enter email, username, password

### Create a Project
1. Click **New Project** on the dashboard
2. Enter a name and click **Create & Open**

### 2D Editor

| Tool    | Shortcut | Description                                 |
|---------|----------|---------------------------------------------|
| Select  | V        | Click to select, drag to move               |
| Pan     | Space    | Drag to pan the canvas                      |
| Wall    | W        | Click to start, click to place, dblclick to stop |
| Delete  | X        | Click any element to delete it              |
| Undo    | Ctrl+Z   | Undo last action                            |

**Wall drawing tips:**
- Hold **Shift** while drawing to snap to 0°/90° (orthogonal)
- Walls snap to endpoints of other walls (shown by cursor)
- Walls snap to the 20px grid
- Drag endpoints (blue dots) to adjust after placing
- The length label updates live in meters

**Furniture:**
- Click any item in the **Furniture panel** (right side) to place it
- Drag to reposition (snaps to grid)
- Click the blue circle above a selected item to rotate
- Edit exact position/size/rotation in the **Properties panel**

### 3D View
- **Orbit**: Left-click drag
- **Zoom**: Scroll wheel
- **Pan**: Right-click drag
- Updates live as you draw walls and add furniture

### View Modes
Use the toggle in the header bar:
- **2D Plan** — full-screen 2D editor
- **Split** — side-by-side 2D and 3D (default)
- **3D View** — full-screen 3D

### Save / Auto-save
- Auto-saves 1.5 seconds after any change (dot in header turns green)
- Click **Save** button in header to save immediately

---

## Project Structure

```
homeplanner/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py              ← FastAPI app + CORS + router registration
│       ├── core/
│       │   ├── config.py        ← Settings (env vars)
│       │   ├── db.py            ← MongoDB / Beanie init
│       │   └── security.py      ← JWT + password hashing
│       ├── models/
│       │   ├── user.py          ← User document + schemas
│       │   └── project.py       ← Project + FloorPlan + all sub-schemas
│       └── api/v1/
│           ├── auth.py          ← /register /login /me
│           └── projects.py      ← CRUD + /floorplan save
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts           ← Vite + proxy /api → backend
    └── src/
        ├── App.tsx              ← Routes + auth guard
        ├── types/schema.ts      ← TypeScript types + furniture presets
        ├── api/client.ts        ← Axios with JWT interceptor
        ├── store/
        │   ├── useAuthStore.ts  ← Auth state (persisted to localStorage)
        │   └── useFloorPlanStore.ts ← Full editor state + undo history
        ├── hooks/
        │   └── useAutoSave.ts   ← Debounced auto-save to backend
        ├── components/
        │   ├── editor/Canvas2D.tsx      ← Konva.js 2D editor (walls, furniture, snapping)
        │   ├── viewer3d/Viewer3D.tsx     ← React Three Fiber 3D scene
        │   ├── furniture/FurniturePanel.tsx ← Object library
        │   └── layout/
        │       ├── EditorHeader.tsx     ← Top bar (view toggle, save button)
        │       ├── Toolbar.tsx          ← Left tool palette
        │       ├── PropertiesPanel.tsx  ← Right properties inspector
        │       └── StatusBar.tsx        ← Bottom hints + stats
        └── pages/
            ├── LoginPage.tsx
            ├── RegisterPage.tsx
            ├── DashboardPage.tsx
            └── EditorPage.tsx
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### Auth
| Method | Path            | Description                   |
|--------|-----------------|-------------------------------|
| POST   | /auth/register  | Create account, returns token |
| POST   | /auth/login     | Login (form data), returns token |
| GET    | /auth/me        | Get current user              |

### Projects
| Method | Path                         | Description             |
|--------|------------------------------|-------------------------|
| GET    | /projects/                   | List all user projects  |
| POST   | /projects/                   | Create new project      |
| GET    | /projects/{id}               | Get project with floor plan |
| PUT    | /projects/{id}               | Update name/description |
| PUT    | /projects/{id}/floorplan     | Save floor plan (auto-save) |
| DELETE | /projects/{id}               | Delete project          |

Full interactive docs at http://localhost:8000/docs

---

## Data Model

```json
{
  "floor_plan": {
    "walls": [
      {
        "id": "uuid",
        "start": { "x": 100, "y": 100 },
        "end":   { "x": 500, "y": 100 },
        "thickness": 10,
        "height": 2.8
      }
    ],
    "objects": [
      {
        "id": "uuid",
        "type": "sofa",
        "label": "Sofa",
        "x": 200, "y": 200,
        "width": 160, "height": 70,
        "rotation": 0,
        "color": "#8b7355"
      }
    ],
    "openings": [],
    "canvas_width": 1200,
    "canvas_height": 800,
    "grid_size": 20
  }
}
```

All coordinates are in canvas pixels. 50px = 1 metre in 3D.

---

## Stopping / Resetting

```bash
# Stop
docker-compose down

# Stop and wipe database
docker-compose down -v
```

---

## Environment Variables

Defined in `docker-compose.yml`. For production, move to a `.env` file:

| Variable                    | Default                     | Description             |
|-----------------------------|-----------------------------|-------------------------|
| MONGO_URL                   | mongodb://mongo:27017       | MongoDB connection      |
| DB_NAME                     | homeplanner                 | Database name           |
| SECRET_KEY                  | (set in compose)            | JWT signing key — change for production! |
| ACCESS_TOKEN_EXPIRE_MINUTES | 1440                        | Token lifetime (24h)    |

---

## Known Limitations (MVP scope)

- No door/window geometry in 3D (walls are solid boxes)
- No texture rendering (solid colors only)
- Single user per project (no sharing/collaboration)
- No image export (planned: canvas screenshot)
- Furniture library is presets only (no custom model upload)

---

## License

MIT
