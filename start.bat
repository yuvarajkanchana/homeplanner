@echo off
echo.
echo  HomePlanner - Starting Up
echo.

echo Stopping any existing containers...
docker-compose down

echo Removing cached images to force clean build...
docker rmi homeplanner-frontend 2>nul
docker rmi homeplanner_frontend 2>nul

echo Building and starting...
docker-compose up --build --force-recreate

