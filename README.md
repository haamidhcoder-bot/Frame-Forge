# FrameForge

**FrameForge** is a browser-based visual website and interface designer inspired by tools such as Figma. Create layouts on a visual canvas, organise elements into pages and components, preview designs across device sizes, and export your work into code or image formats.

<p align="center">
  <strong>Live Demo</strong><br>
  <a href="https://frame-forge-blush.vercel.app/">https://frame-forge-blush.vercel.app/</a>
</p>

## Features

### Visual design editor
- Design on a canvas with frames, rectangles, ellipses, lines, polygons, text, buttons, images and form controls.
- Edit element properties, arrange layers, group and ungroup elements, and align objects.
- Use rulers, guides, layout grids, snapping, a minimap and zoom controls.
- Work with multiple pages, reusable components and component instances.
- Apply fills, gradients, strokes, effects, text styling and Google Fonts.
- Save colour and text styles for consistent designs.

### Layout and responsive preview
- Create layouts with flexbox-style auto layout and CSS grid.
- Preview frame designs in phone, tablet and desktop device sizes.
- Resize the preview, rotate devices, change zoom and inspect clickable areas.
- Add prototype links between frames to explore a design flow.

### Libraries and assets
- Browse built-in block and page templates, including light and dark variations.
- Search and insert icons from the built-in icon collection and Bootstrap Icons.
- Upload images and use them as design elements.
- Import supported project and design files.

### Import and export
Export designs in several formats:

| Format | Output |
|---|---|
| HTML | Single HTML file |
| HTML + CSS | ZIP with separate stylesheet |
| React | React project ZIP |
| Tailwind | Tailwind-based HTML |
| Bootstrap | Bootstrap 5 project ZIP |
| Flask | Flask project ZIP |
| Kivy | Python Kivy app or project ZIP |
| PNG | Image export, including 2× |
| SVG | Vector export |
| PDF | Print-ready PDF |
| JSON | Editable FrameForge project |

FrameForge can also import supported JSON, HTML, ZIP, SVG, PNG and image files. When the editable-project option is included in an export, the design can be imported back into FrameForge for further editing.

## Tech Stack

- **Frontend:** HTML, CSS and vanilla JavaScript
- **Backend:** Python and Flask
- **Database:** SQLite
- **Code generation:** Python export modules
- **Icons:** Built-in icon set and Bootstrap Icons

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/haamidhcoder-bot/Frame-Forge.git
```

### 2. Create and activate a virtual environment (recommended)

**Windows**
```bash
python -m venv .venv
.venv\Scripts\activate
```

**macOS / Linux**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Start the application

```bash
python app.py
```

Open the local URL printed by Flask in your browser (usually `http://127.0.0.1:5000`).

The SQLite database is created/initialised by the application when it starts.

## Project Structure

```text
FrameForge/
├── app.py                  # Flask application and project APIs
├── exporter.py             # HTML, CSS and framework export generation
├── kivy_export.py          # Python Kivy export generation
├── importer.py             # Import supported project/design files
├── icons.py                # Built-in icon data
├── bootstrap_icons.json    # Bootstrap Icons data
├── designs.db              # SQLite project database
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Main editor interface
└── static/
    ├── style.css           # Editor styling
    ├── app.js              # Frontend entry script (if used)
    ├── User_Guide.html     # User manual
    └── js/                 # Editor modules
```

## User Guide

The in-app **User Manual** opens `static/User_Guide.html`. Refer to it for detailed instructions on using the editor and its tools.

## Keyboard Shortcuts

A few useful shortcuts available in the editor:

| Shortcut | Action |
|---|---|
| `V` | Move tool |
| `H` | Hand tool |
| `F` | Frame tool |
| `R` | Rectangle tool |
| `O` | Ellipse tool |
| `L` | Line tool |
| `P` | Polygon tool |
| `T` | Text tool |
| `B` | Button tool |
| `I` | Image tool |
| `K` | Icon picker |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |
| `Ctrl + S` | Save |
| `Ctrl + D` | Duplicate |
| `Ctrl + G` | Group |
| `Shift + A` | Add/remove auto layout |
| `Shift + 1` | Fit canvas to view |
| `Shift + R` | Toggle rulers and guides |

Open **Keyboard shortcuts** in the editor for the complete list.

## Notes

- The live demo is hosted at [frame-forge-blush.vercel.app](https://frame-forge-blush.vercel.app/).
- The project requires Python and the dependencies listed in `requirements.txt` when running the Flask application locally.
- Kivy exports require Kivy to be installed in the environment where the exported app will run:

```bash
pip install kivy
python main.py
```

## License

No license is specified in this project. Add a `LICENSE` file before distributing the project with explicit reuse permissions.
