# HomePlanner Free Deployment

Recommended free setup:

- Frontend: Vercel
- Backend: Render Web Service
- Database: MongoDB Atlas Free Cluster

## 1. MongoDB Atlas

Create a free Atlas cluster, then create a database user and copy the connection string.

Use this database name:

```text
homeplanner
```

Your `MONGO_URL` should look similar to:

```text
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net
```

## 2. Render Backend

Create a new Render Blueprint or Web Service from this repo.

If using Blueprint, Render will read `render.yaml`.

If using manual setup:

```text
Root Directory: backend
Runtime: Python
Build Command: pip install -r requirements.txt
Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health Check Path: /health
```

Add environment variables:

```env
MONGO_URL=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net
DB_NAME=homeplanner
SECRET_KEY=replace-with-a-long-random-secret
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
CORS_ORIGINS=https://your-vercel-app.vercel.app
```

After deploy, test:

```text
https://your-render-service.onrender.com/health
```

## 3. Vercel Frontend

Import the same repo into Vercel.

Use these settings:

```text
Framework Preset: Vite
Root Directory: frontend
Build Command: npm run build
Output Directory: dist
Install Command: npm ci
```

Add this environment variable:

```env
VITE_API_URL=https://your-render-service.onrender.com
```

After Vercel deploys, update Render's `CORS_ORIGINS` to your real Vercel URL.

## 4. Final Test

Open the Vercel app and test:

1. Register
2. Login
3. Create a project
4. Draw a wall
5. Refresh
6. Confirm your project is still saved

Render's free backend can sleep after inactivity. The first request after sleep may take about a minute.
