# Creative Anchor (Artist Burnout Visualizer & Sync Shell)

A local-first, anti-burnout desktop utility designed for digital artists. It dynamically monitors paint canvases, evaluates invested effort, provides local Gemini critiques, and displays master synchronization status.

---

## How to run:
``` terminal
cd frontend
npm install
npm run start
```


## Repository Structure

The project is structured as a clean monorepo:
* **`/backend`**: Express server running on port `5000`. Monitors active drawing directories dynamically via `chokidar`, extracts `.clip` binary thumbs/Photoshop composite layers, and tracks local access history.
* **`/frontend`**: Electron desktop application shell loaded directly with Brutalist warm Velvet paper styling templates.

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
