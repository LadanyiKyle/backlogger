# BackLogger — Supabase Schema

## Tables

### tasks
| Column       | Type      | Notes                          |
|-------------|-----------|--------------------------------|
| id          | text (PK) | Generated client-side (T + base36 timestamp) |
| title       | text      | Required                       |
| description | text      | Optional notes/details         |
| category    | text      | client, internal, research, training, trading, todo, meetings |
| priority    | text      | critical, high, medium, low    |
| status      | text      | backlog, in_progress, done     |
| source      | text      | Where the task came from (Slack, Email, Manual, etc.) |
| created_at  | timestamptz | Auto-set on creation         |
| updated_at  | timestamptz | Updated on every change      |

### comments
| Column     | Type      | Notes                    |
|-----------|-----------|--------------------------|
| id        | uuid (PK) | Auto-generated           |
| task_id   | text (FK) | References tasks.id      |
| body      | text      | Comment content          |
| author    | text      | Defaults to 'Kyle'       |
| created_at| timestamptz | Auto-set on creation   |

### time_logs
| Column          | Type      | Notes                  |
|----------------|-----------|------------------------|
| id             | uuid (PK) | Auto-generated         |
| task_id        | text (FK) | References tasks.id    |
| duration_minutes | integer  | Minutes logged (5, 10, 30, or custom) |
| logged         | boolean   | Whether this entry has been reported/billed (default: false) |
| created_at     | timestamptz | When the time was logged (used for reporting) |

> **Migration note:** The `started_at`, `ended_at`, and `note` columns are deprecated. New entries only use `duration_minutes`, `logged`, and `created_at`. The old timer-based workflow has been replaced with quick-add buttons (+5m, +10m, +30m, custom).

### activity
| Column     | Type      | Notes                    |
|-----------|-----------|--------------------------|
| id        | uuid (PK) | Auto-generated           |
| task_id   | text (FK) | References tasks.id      |
| action    | text      | moved, updated, commented, time logged, attached |
| detail    | text      | Human-readable description |
| created_at| timestamptz | Auto-set on creation   |

### attachments
| Column     | Type      | Notes                    |
|-----------|-----------|--------------------------|
| id        | uuid (PK) | Auto-generated           |
| task_id   | text (FK) | References tasks.id (CASCADE delete) |
| label     | text      | Display name for the link |
| url       | text      | Full URL to the document  |
| created_at| timestamptz | Auto-set on creation   |

## Data Sources
- **Manual** — Tasks created via the UI
- **Claude Cowork** — Automated daily task ingestion from Slack/Email/Calendar

## Notes for Claude Cowork Automation

When inserting time_log entries programmatically:
- Always include `task_id`, `duration_minutes`, and `created_at`
- Set `logged` to `false` (user will mark as logged manually via the Time Report page)
- Do NOT use the deprecated `started_at`, `ended_at`, or `note` fields
- The `created_at` timestamp is used for weekly reporting grouping, so set it to the actual time the work occurred
