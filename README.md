# FrameForge

FrameForge is a browser-based website layout designer inspired by visual design tools such as Figma. It lets you arrange interface elements on a canvas, manage layers, adjust properties, save projects, and export designs as standalone HTML and CSS.

## Live Demo

[Open FrameForge](https://frame-forge-1pwr49zak-tech-titans-a2ba.vercel.app/)

## Features

- Visual canvas for creating website layouts
- Tools for frames, rectangles, ellipses, text, buttons, and images
- Pan and zoom controls, including fit-to-screen
- Layer management: rename, hide, lock, and reorder elements
- Element properties for position, size, fill, stroke, border radius, opacity, shadows, typography, and alignment
- Device presets, resize handles, multi-selection, and snapping guides
- Copy, paste, duplicate, and keyboard nudging
- Undo and redo history
- Save and reopen projects
- Import and export designs as JSON
- Preview designs and export standalone HTML/CSS
- SQLite storage for saved projects
- Built-in user manual

## Technology Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Python, Flask
- **Database:** SQLite
- **Export:** Generated standalone HTML and CSS

## Run Locally

### 1. Requirements

- Python 3.9 or newer
- pip

### 2. Download the project

Clone the repository or download the project files, then open a terminal in the project directory.

```bash
git clone <your-repository-url>
cd <project-directory>
```

Replace the placeholders with your repository URL and folder name.

### 3. Create and activate a virtual environment (recommended)

Windows:

```bash
python -m venv .venv
.venv\Scripts\activate
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

### 5. Start the Flask server

```bash
python app.py
```

Then open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

The application creates the SQLite database table for projects when it starts. The database file is stored as `designs.db` in the application directory.

## Basic Usage

1. Open FrameForge and create a new design.
2. Choose a tool from the bottom toolbar and draw or add an element on the canvas.
3. Select an element to edit its properties in the right-hand panel.
4. Use the Layers panel to select, rename, hide, lock, or reorder elements.
5. Save the project to store it in the database.
6. Use Preview to inspect the design, or Export HTML to generate HTML and CSS.
7. Use Export JSON to keep a portable copy of the design, or Import to load a previously exported JSON file.

Keyboard shortcuts are shown in the interface tooltips. Common shortcuts include `Ctrl+S` to save, `Ctrl+Z` to undo, and `Ctrl+Shift+Z` to redo.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/projects` | List saved projects |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/<id>` | Retrieve a project |
| `PUT` | `/api/projects/<id>` | Update a project |
| `DELETE` | `/api/projects/<id>` | Delete a project |
| `POST` | `/api/export` | Export a design |
| `GET` | `/api/projects/<id>/export.html` | Export a saved project as HTML |

## Project Structure

```text
.
├── app.py                  # Flask application and project API
├── designs.db              # SQLite database (created/used by the app)
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Main editor page
└── static/
    ├── app.js              # Editor interactions and client-side logic
    ├── frame.png           # App icon
    ├── style.css           # Application styles
    └── user_guide.html     # In-app user manual
```

## Notes

- The deployed demo URL is listed above. The local run instructions start the Flask application and its SQLite-backed API.
- If you deploy the Flask backend to a hosting provider, make sure that provider supports Python/Flask and persistent storage if you want saved SQLite projects to remain available across deployments or restarts.
- Do not commit secrets, API keys, or private configuration values to source control.

## License

No license has been specified yet. Add a license file if you intend to distribute or reuse the project under specific terms.
