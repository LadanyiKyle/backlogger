# BackLogger

Personal task and project management tool with Kanban board, calendar view, time tracking, and activity logging. Backed by Supabase.

## Project Structure

```
BackLogger/
├── src/                 ← Frontend (open src/index.html to run)
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── assets/
├── scripts/             ← Claude cowork automation scripts
├── docs/
│   └── schema.md        ← Supabase table schema reference
├── data/
│   └── backlog.json     ← Seed/reference data
├── .gitignore
└── README.md
```

## Running

Open `src/index.html` in a browser. The app connects directly to Supabase — no build step or server required.

## Data Flow

- **UI** → Creates/updates tasks via Supabase REST API
- **Claude Cowork** → Automated daily ingestion of tasks from Slack, Email, Calendar into Supabase
