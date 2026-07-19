# Car Tracker

Car Tracker is a fleet operations system for managing vehicles, drivers, travel orders, maintenance, and GPS-derived trip activity. It combines live data from Cartrack with internal travel-order workflows, PostgreSQL persistence, operational dashboards, reports, in-app notifications, and optional Telegram alerts.

This repository is a pnpm monorepo containing the browser application, API, shared types, database migrations, and the fleet synchronization engine.

## Features

- Vehicle, driver, maintenance, and user administration
- Travel-order requests, review, approval, scheduling, assignment, and completion
- Public travel-order request form for unauthenticated users
- Live fleet status, dashboard summaries, charts, and operational tables
- GPS telemetry classification for ignition, motion, idling, speeding, low fuel, and location changes
- GPS trip logs, stops, multi-destination progress, and travel-order reconciliation
- Detection and review of trips without a travel order (No-TO trips)
- Monthly, yearly, and reconciliation reports with export support
- Role-based access control, in-app notifications, global search, and activity shortcuts
- Optional Telegram delivery for fleet alerts
- Persistent scheduler run history and manual or protected cron-triggered synchronization

## System architecture

```mermaid
flowchart LR
    Browser[React + Vite frontend]
    API[Express API]
    DB[(PostgreSQL / Supabase)]
    Cartrack[Cartrack API]
    Scheduler[Local scheduler or external cron]
    Tracker[Fleet sync and alert engine]
    Telegram[Telegram Bot API]

    Browser -->|Cookie-authenticated /api requests| API
    API --> DB
    Scheduler -->|Run cycle| API
    API --> Tracker
    Tracker -->|Fetch fleet and trip data| Cartrack
    Tracker -->|Telemetry and trip state| DB
    Tracker -->|Optional alerts| Telegram
    DB -->|Dashboard, logs, reports, notifications| API
```

The main runtime flow is:

1. The scheduler or protected cron endpoint starts a synchronization cycle.
2. The tracker fetches the current Cartrack fleet snapshot and, when needed, detailed history.
3. Backend services classify telemetry, confirm vehicle state changes, and suppress duplicate events.
4. Telemetry is matched to active travel orders or maintained as a No-TO journey.
5. Trip logs, stops, destination progress, vehicle state, scheduler metrics, and notifications are persisted in PostgreSQL.
6. Configured alerts are sent to Telegram and their delivery result is recorded.
7. The frontend reads the resulting operational state through the Express API.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 6, TypeScript, React Router, TanStack Query, Tailwind CSS, Leaflet, Recharts |
| Backend | Node.js, Express 4, TypeScript, PostgreSQL (`pg`), bcrypt |
| Tracking | Cartrack HTTP integration, GPS state and trip lifecycle services |
| Database | PostgreSQL or Supabase PostgreSQL with ordered SQL migrations |
| Deployment | Vercel static frontend and Node serverless API; local Node server is also supported |
| Notifications | In-app notifications and optional Telegram Bot API alerts |

## Repository layout

```text
.
├── api/                    # Vercel serverless entry point for the compiled Express app
├── backend/                # Express API, services, security, routes, and database code
│   └── src/db/migrations/  # Ordered, tracked PostgreSQL migrations
├── frontend/               # React/Vite single-page application
├── packages/tracker/       # Reusable Cartrack sync and alert engine
├── shared/                 # Shared application types workspace package
├── scripts/                # Validation, regression, and operational helper scripts
├── package.json            # Root development, build, tracker, and lint commands
└── vercel.json             # Production build, API rewrite, and SPA routing configuration
```

Some compiled JavaScript and diagnostic output files remain in the repository, but TypeScript files under `backend/src` and `frontend/src` are the source of truth.

## Access control

Authentication uses username and password credentials stored in the `users` table. A successful login creates a signed, HTTP-only `car_tracker_session` cookie valid for 24 hours. The cookie is `Secure` in production and is verified by the backend on every protected request.

| Role | High-level access |
| --- | --- |
| `SUPERADMIN` | Full system access, including settings, integrations, manual synchronization, and user administration |
| `ADMIN` | Operational data, reports, and user administration; no system settings or admin synchronization |
| `DISPATCHER` | Dashboard, fleet data, GPS logs, travel-order requests, scheduling, and assignments |
| `HR` | Dashboard, fleet and maintenance data, GPS logs, and relevant travel-order workflows |
| `VIEWER` | Read-only dashboard, travel-order, request, and reporting views; protected mutations are denied |

The backend is the authorization boundary. Frontend route visibility is a usability feature and does not replace API authorization.

## Prerequisites

- Node.js 20.9.0 or newer
- pnpm 10.x (the repository pins `pnpm@10.25.0`)
- A reachable PostgreSQL database
- Cartrack API credentials for live synchronization
- Optional Telegram bot token and chat ID for Telegram alerts

## Local setup

### 1. Install dependencies

From the repository root:

```bash
pnpm install
```

### 2. Configure the backend

Create `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/car_tracker
AUTH_SECRET=replace-with-at-least-32-random-characters
APP_ORIGINS=http://localhost:5173

CARTRACK_API_URL=https://your-cartrack-api.example
CARTRACK_USERNAME=your-cartrack-username
CARTRACK_PASSWORD=your-cartrack-password

BOT_TOKEN=
CHAT_ID=
CRON_SECRET=replace-with-a-separate-random-secret
```

`DATABASE_URL` is required for database-backed functionality. In production, `AUTH_SECRET` must contain at least 32 characters and `APP_ORIGINS` must contain at least one trusted browser origin. Origins are comma-separated, contain no path, and may have a trailing slash (it is removed during normalization).

### 3. Configure the frontend

For normal local development, no frontend environment file is needed: Vite proxies `/api` to `http://localhost:3500`.

If the API runs on another origin, create `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:3500
```

Leave `VITE_API_URL` unset for a same-origin production deployment such as the included Vercel configuration.

### 4. Apply database migrations

```bash
pnpm --filter car-tracker-backend migrate
```

The migration runner applies pending `.sql` files from `backend/src/db/migrations` in filename order. Each migration runs in its own transaction, and the `_migrations` table records the filename and checksum so repeated runs skip migrations already applied.

Run migrations before starting a fresh environment and before deploying application code that depends on a newer schema.

### 5. Start development

Run the frontend and backend together:

```bash
pnpm dev
```

Or run them in separate terminals:

```bash
pnpm dev:backend
pnpm dev:frontend
```

Default local addresses:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| API | `http://localhost:3500` |
| Health check | `http://localhost:3500/api/health` |
| Public travel-order form | `http://localhost:5173/user-to/request` |

The local backend starts the in-process fleet scheduler immediately and repeats it at `SYNC_INTERVAL_SECONDS`, clamped to a minimum of 10 seconds. Configure valid Cartrack and database credentials before using live synchronization.

## Environment variables

### Core server and security

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | None | PostgreSQL connection string |
| `AUTH_SECRET` | Production | Development-only fallback | HMAC secret for signed session cookies; at least 32 characters in production |
| `APP_ORIGINS` | Production | None | Comma-separated trusted browser origins for credentialed CORS and origin validation |
| `NODE_ENV` | No | `development` | Enables production security behavior when set to `production` |
| `PORT` | No | `3500` | Local API listen port |

### Integrations and scheduling

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CARTRACK_API_URL` | For sync | None | Cartrack API base URL |
| `CARTRACK_USERNAME` | For sync | None | Cartrack API username |
| `CARTRACK_PASSWORD` | For sync | None | Cartrack API password |
| `BOT_TOKEN` | For Telegram | None | Telegram bot token |
| `CHAT_ID` | For Telegram | None | Destination Telegram chat ID |
| `CRON_SECRET` | For cron/manual production sync | None | Secret accepted by the protected scheduler route |
| `SYNC_INTERVAL_SECONDS` | No | `30` | Local scheduler interval; runtime minimum is 10 seconds |
| `VITE_API_URL` | No | Same origin | Browser API base URL; normally unset locally and on Vercel |

### Alert and Cartrack tuning

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPEED_LIMIT_KMH` | `90` | Speeding alert threshold |
| `LOW_FUEL_LITERS` | `5` | Low-fuel alert threshold |
| `ALERT_DEDUPE_SECONDS` | `SYNC_INTERVAL_SECONDS` or `300` | Alert suppression window |
| `CARTRACK_TIMEOUT_MS` | `15000` | Cartrack request timeout |
| `CARTRACK_RETRIES` | `1` | Retry count for retriable Cartrack failures |
| `FLEET_CACHE_SECONDS` | `30` | Fresh fleet response cache lifetime |
| `FLEET_STALE_CACHE_SECONDS` | `3600` | Maximum stale fleet cache lifetime used during upstream failures |
| `IGNITION_CONFIRMATION_POLLS` | `2` | Consecutive samples used to confirm ignition state changes |
| `IGNITION_DUPLICATE_WINDOW_SECONDS` | `30` | Ignition event duplicate window |
| `MIN_MOVEMENT_METERS` | `20` | Distance threshold used when determining movement |
| `MIN_MOVING_SPEED_KMH` | `3` | Speed threshold used when determining movement |
| `GPS_STATE_RESET_AFTER_HOURS` | `6` | Age after which persisted GPS state may be reset |
| `GPS_STALE_PACKET_TOLERANCE_SECONDS` | `5` | Tolerance for out-of-order or stale GPS packets |

Idling milestones are currently defined in code: alerts begin at 10 and 25 minutes, then repeat every additional 30 minutes.

### Travel-order and trip matching tuning

| Variable | Default | Purpose |
| --- | --- | --- |
| `GPS_TO_MATCH_TOLERANCE_MINUTES` | `10` | General GPS-to-travel-order match tolerance |
| `TO_DRIVING_MATCH_TOLERANCE_MINUTES` | `10` | Driving-event time tolerance used in trip matching |
| `GPS_TO_DESTINATION_THRESHOLD_METERS` | `300` | Destination coordinate verification threshold |
| `ALLOW_TRIP_SUMMARY_TIME_FALLBACK` | `false` | Allows Cartrack summary times when detailed history is unavailable |
| `TO_SYNC_DEPARTURE_WINDOW_MINUTES` | `120` | Travel-order departure candidate window |
| `TO_SYNC_RECENT_COMPLETED_MINUTES` | `30` | Recently completed order reconciliation window |
| `TO_SYNC_MINIMUM_SCORE` | `80` | Minimum travel-order matching score |
| `BUSINESS_TRIP_BASE_RADIUS_METERS` | `300` | Base geofence radius for business-trip lifecycle logic |
| `BUSINESS_TRIP_DESTINATION_RADIUS_METERS` | `700` | Destination arrival radius |
| `BUSINESS_TRIP_PAUSE_RESUME_RADIUS_METERS` | `300` | Pause/resume proximity radius |
| `DESTINATION_RADIUS_METERS` | `100` | Legacy standalone tracker arrival radius |
| `RETURN_DIRECTION_MARGIN_METERS` | `100` | Required distance improvement for return-direction detection |
| `NO_TO_CONTINUATION_MAX_HOURS` | `24` | Maximum gap for continuing a No-TO journey |
| `NO_TO_BASE_ANCHOR_MAX_MINUTES` | `120` | Maximum age of the base anchor used for No-TO matching |
| `BUSINESS_TRIP_LIFECYCLE_SYNC` | Current lifecycle | Set to `legacy` only to select the legacy GPS-log path |

The tracker package also recognizes legacy Supabase REST settings (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ALERTS_TABLE`, and `SUPABASE_VEHICLES_TABLE`). The main application uses `DATABASE_URL` and direct PostgreSQL access.

Never commit real secrets or credentials. Root and package `.env` files are ignored by Git.

## Application areas

### Frontend routes

| Route | Purpose |
| --- | --- |
| `/` | Operational dashboard |
| `/travel-orders` | Travel-order workflow |
| `/travel-requests` | Request and scheduling queues |
| `/gps-logs` | Trip logs, No-TO logs, and telemetry |
| `/list` | Vehicles, drivers, and maintenance records |
| `/reports` | Monthly, yearly, and reconciliation reporting |
| `/settings` | Superadmin users, integrations, scheduler, and system settings |
| `/user-to/request` | Public travel-order request form |

### API route families

All routes are available below `/api`; the backend also mounts equivalent unprefixed routes for compatibility.

| Route family | Responsibility | Access summary |
| --- | --- | --- |
| `/api/health` | Process health and current timestamp | Public |
| `/api/auth` | Login, session restoration, and logout | Public/session-aware |
| `/api/public/travel-orders` | Travel-order number lookup and public submission | Public, rate-limited |
| `/api/dashboard` | Dashboard summaries, charts, live state, and tables | All authenticated roles |
| `/api/travel-orders` | Travel-order queues, destinations, assignment, and lifecycle | Authenticated; viewers read-only |
| `/api/vehicles`, `/api/drivers`, `/api/maintenance` | Fleet master data and maintenance | Operational roles |
| `/api/gps-logs` | Telemetry, trip logs, No-TO journeys, synchronization, stops, and details | Operational roles |
| `/api/reports` | Monthly, yearly, and reconciliation reports | Superadmin, admin, and viewer |
| `/api/notifications`, `/api/search` | User notifications and global search | All authenticated roles |
| `/api/users` | User administration | Superadmin and admin |
| `/api/settings`, `/api/admin` | Integrations, scheduler operations, and admin sync | Superadmin |
| `/api/cron/sync-tracker` | One protected synchronization cycle | Cron secret |

The API returns JSON and generally uses a `{ success, data, error, message }` envelope. Protected browser calls rely on the HTTP-only session cookie and must include credentials when made across origins.

## Database domains

The schema is managed entirely through `backend/src/db/migrations`. Its main domains are:

- Fleet master data: vehicles, drivers, maintenance, and users
- Travel orders: workflow status, assignments, coordinates, and ordered destinations
- Raw and classified tracking: telemetry, alerts, durable vehicle state, and idling deduplication
- Trips: travel-order trip logs, active trip state, stops, and actual route endpoints
- No-TO journeys: unmatched trip logs and their active lifecycle state
- Application support: notifications, scheduler run history, rate-limit buckets, and migration tracking

Do not edit an already-applied migration. Add a new numbered migration so existing environments can advance safely.

## Development commands

Run these commands from the repository root unless noted otherwise.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run frontend and backend development servers |
| `pnpm dev:frontend` | Run only Vite on port 5173 |
| `pnpm dev:backend` | Run only the watched Express server on port 3500 |
| `pnpm build` | Compile the backend and build the frontend |
| `pnpm build:backend` | Type-check and compile the backend |
| `pnpm build:frontend` | Build the frontend into `frontend/dist` |
| `pnpm --filter car-tracker-frontend preview` | Preview the built frontend |
| `pnpm --filter car-tracker-backend migrate` | Apply pending database migrations |
| `pnpm tracker` | Run one standalone fleet sync cycle and exit |
| `pnpm lint` | Lint all TypeScript and TSX sources |
| `pnpm lint:backend` | Lint backend TypeScript sources |
| `pnpm lint:frontend` | Lint frontend TypeScript and TSX sources |
| `pnpm --filter car-tracker-backend test` | Run backend service and security tests serially |
| `pnpm --filter car-tracker-backend test:security` | Run only the security regression tests |

The standalone `pnpm tracker` command reads from the process environment; it does not load `backend/.env` by itself. Export the required variables in the invoking shell or use an environment manager when running it independently.

## Scheduling and synchronization

### Local or long-running Node deployment

`backend/src/index.ts` starts Express and the in-memory scheduler. It runs one cycle on startup and then every `SYNC_INTERVAL_SECONDS`. A cycle lock prevents overlapping runs. The scheduler fetches fleet state, persists telemetry, updates trip lifecycles, and records alert delivery results.

Changing the interval through the Superadmin settings API affects only the current process and is not a durable cross-instance scheduler configuration.

### Vercel or another serverless deployment

The Vercel function imports the compiled Express app from `backend/dist/app.js`, not the long-running server entry point. It therefore does not start an in-memory interval. Configure Vercel Cron or another trusted scheduler to invoke:

```text
GET /api/cron/sync-tracker
```

The request must provide `CRON_SECRET` by one of these methods:

```http
X-Cron-Secret: your-secret
Authorization: Bearer your-secret
```

For schedulers that cannot set headers, `?secret=your-secret` is also accepted, but headers are preferred because URLs are commonly logged. The endpoint returns a synchronization summary and writes its status and metrics to `scheduler_runs`. Requests without a valid configured secret receive `401`.

The Superadmin **Run Once** action calls the same protected endpoint through the backend.

## Production deployment

The root `vercel.json` defines the current combined deployment:

- installs the frozen pnpm lockfile;
- builds the backend before the frontend;
- serves `frontend/dist` as the static application;
- rewrites `/api/*` to `api/index.ts`;
- rewrites non-API paths to `index.html` for client-side routing; and
- allows the API function to run for up to 60 seconds.

Recommended deployment order:

1. Configure `DATABASE_URL`, `AUTH_SECRET`, `APP_ORIGINS`, Cartrack credentials, `CRON_SECRET`, and optional Telegram settings in the deployment environment.
2. Set `NODE_ENV=production` if the platform does not set it automatically.
3. Apply pending migrations to the production database.
4. Run `pnpm build` locally or in continuous integration.
5. Deploy the Vercel project.
6. Configure a platform or external cron schedule for `/api/cron/sync-tracker`.
7. Verify API health, login, integration status, one synchronization cycle, scheduler history, and Telegram delivery if enabled.

Example production checks:

```bash
curl https://your-domain.example/api/health
curl -H "X-Cron-Secret: your-secret" https://your-domain.example/api/cron/sync-tracker
```

Do not put a production cron secret directly in shell history on shared systems. Prefer a secret-aware scheduler or environment-backed command.

## Verification and testing

Before deployment, run:

```bash
pnpm --filter car-tracker-backend migrate
pnpm --filter car-tracker-backend test
pnpm lint
pnpm build
```

Then verify:

- `/api/health` returns `status: "ok"`.
- The frontend can log in and restore the session after a refresh.
- Each role sees only its intended navigation and receives `403` for prohibited APIs.
- Settings reports the database, Cartrack, Telegram, and scheduler states accurately.
- A manual synchronization creates a successful scheduler history record.
- Telemetry and trip logs update without duplicate events.
- Travel-order and No-TO journeys follow their expected lifecycle.
- The public request page can submit a valid request while protected routes reject unauthenticated access.

Detailed operational checks are maintained in:

- [Deployment validation checklist](scripts/deploy-validation-checklist.md)
- [System testing plan](scripts/testing-plan.md)
- [Migration verification SQL](scripts/verify-migrations.sql)

Some historical examples in these documents may describe an earlier migration or alert label. Treat current source, migrations, and API responses as authoritative when they differ.

## Troubleshooting

### The frontend cannot reach the API

- Confirm the backend is listening on port 3500.
- In local development, call paths beginning with `/api` so the Vite proxy is used.
- For a separate API host, set `VITE_API_URL` before building the frontend.
- In production, ensure `/api/*` reaches `api/index.ts` and `VITE_API_URL` is not accidentally set to localhost.

### Login succeeds locally but fails in production

- Set `NODE_ENV=production`, a stable `AUTH_SECRET` of at least 32 characters, and the exact frontend origin in `APP_ORIGINS`.
- Do not include paths in `APP_ORIGINS`; list multiple origins with commas.
- Ensure HTTPS is used so the production `Secure` session cookie can be stored and sent.
- Confirm cross-origin browser requests include credentials.

### Database errors or missing relations

- Verify `DATABASE_URL` points to the intended environment.
- Run `pnpm --filter car-tracker-backend migrate` and inspect the first failed migration.
- Do not manually mark a failed migration as applied; correct the database condition and rerun the idempotent migrator.

### Synchronization does not run

- On a local Node server, check the backend logs and `SYNC_INTERVAL_SECONDS`.
- On Vercel, configure an external or platform cron; deploying `api/index.ts` alone does not create a repeating job.
- Verify all three Cartrack variables and `DATABASE_URL` are present.
- Confirm the cron request supplies the configured `CRON_SECRET`.
- Review the Settings connection page and recent `scheduler_runs` records.

### Telegram alerts do not arrive

- Configure both `BOT_TOKEN` and `CHAT_ID`.
- Use the Telegram connection test in Superadmin settings.
- Check telemetry delivery status and backend logs; fleet data can still be persisted when Telegram delivery fails.

### The backend port is already in use

Stop the existing process or set another `PORT`. If the port changes, also update the Vite proxy or use `VITE_API_URL` for local frontend requests.

## Security notes

- Never commit `.env` files, database URLs, API passwords, bot tokens, session secrets, or cron secrets.
- Use different high-entropy values for `AUTH_SECRET` and `CRON_SECRET`.
- Restrict `APP_ORIGINS` to browser origins you control.
- Keep mutations behind backend role checks; do not rely on hidden frontend controls.
- Prefer cron authentication headers over query parameters.
- Apply security and rate-limit migrations before exposing a deployment.
- Use a restricted database account where operational requirements allow it, and rotate credentials after suspected exposure.

## License

No license file is currently included. Treat the repository as private unless the project owner specifies otherwise.
