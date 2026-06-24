# car-tracker

A monorepo for car tracking with GPS telemetry, built with pnpm workspaces.

## Prerequisites

- Node.js >= 20.9.0
- pnpm >= 10.0.0

## Getting Started

Install dependencies:

```bash
pnpm install
```

## Development

Run both frontend and backend in development mode:

```bash
pnpm dev
```

Or run them individually:

```bash
pnpm dev:frontend
pnpm dev:backend
```

## Build

Build all packages:

```bash
pnpm build
```

Or build individually:

```bash
pnpm build:frontend
pnpm build:backend
```

## Tracker

Start the tracker sync process:

```bash
pnpm tracker
```

## Project Structure

- `backend/` - Express.js backend API
- `frontend/` - React frontend with Vite
- `packages/tracker/` - GPS tracker sync package
- `shared/` - Shared types and utilities
