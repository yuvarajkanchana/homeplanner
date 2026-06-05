#!/bin/bash
echo ""
echo "╔════════════════════════════════════╗"
echo "║     HomePlanner - Starting Up      ║"
echo "╚════════════════════════════════════╝"
echo ""

# Stop any running containers
echo "► Stopping any existing containers..."
docker-compose down 2>/dev/null

# Remove old frontend image to force clean build
echo "► Removing cached frontend image..."
docker rmi homeplanner-frontend 2>/dev/null || true
docker rmi homeplanner_frontend 2>/dev/null || true

# Build and start fresh
echo "► Building and starting (this takes 3-5 min first time)..."
echo ""
docker-compose up --build --force-recreate

