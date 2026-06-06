# Creative Anchor (Artist Burnout Visualizer & Sync Shell)

```TODO
Архитектурна диаграма (може да е изображение в docs/ папка)
Структура на проекта (кратко описание на основните папки/модули)
```

A local-first, anti-burnout desktop utility designed for digital artists. It dynamically monitors paint canvases, evaluates invested effort, provides local Gemini critiques, and displays master synchronization status.

---
## Architecture


---

## How to run:

### Backend:
1. Get a working supabase instance
2. Cd into the backend folder
```bash
cd .\backend\
```
3. Configure the .env values in backend/
```bash
cp .env .env.example
```
4. Run the project
```bash
py run.py
```


### Frontend:

``` terminal
cd frontend
npm install
npm run start
```

---

## Used technologies

### Backend
Flask 3.0.2
Flask-smorest 0.44.0
Marshmallow 3.21.0
Gunicorn 22.0.0
supabase 2.25.0
websockets
google-genai
Google Gemini 3.5 Flash

### Local Backend
ExpressJS >4.19.2
NodeJS 24.13.1

### Frontend
Electron >42.3.2

---
## Api Docs
[API Docs here](/docs/api/openapi.json)
---

## Repository Structure

The project is structured as a clean monorepo:
* **`/backend`**: Express server running on port `5000`. Monitors active drawing directories dynamically via `chokidar`, extracts `.clip` binary thumbs/Photoshop composite layers, and tracks local access history.
* **`/frontend`**: Electron desktop application shell loaded directly with Brutalist warm Velvet paper styling templates.
* **`/local-backend`**: 

---

## Single-Command Bootstrap & Execution

You can install all dependencies and run both application layers simultaneously using these root-level scripts:

### 1. Installation Bootstrap
From the root directory, run this command once to install all dependencies for the root, backend, and frontend folders:
```bash
npm run bootstrap
```

### 2. Simultaneous Startup
To launch the backend folder scanner server and start the Electron desktop interface concurrently with a single command, run:
```bash
npm start
```
*Closing the terminal process or stopping execution (`Ctrl + C`) will automatically clean up and terminate both processes together.*
