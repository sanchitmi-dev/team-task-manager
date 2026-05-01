# Team Task Manager

A full-stack web app for managing team projects, assigning tasks, tracking progress, and enforcing role-based access control.

## Features

- Authentication with signup, login, logout, signed HTTP-only session cookies, and hashed passwords
- Admin/member role-based access control
- Project management with team membership
- Task creation, assignment, priority, due dates, and status tracking
- Dashboard with project count, task count, completion, overdue tasks, status overview, and recent work
- REST API plus JSON-backed NoSQL database
- Responsive UI with no external frontend dependency
- Railway-ready Node deployment

## Demo Accounts

The app creates these accounts automatically on first run:

- Admin: `admin@example.com` / `Admin@12345`
- Member: `member@example.com` / `Member@12345`

## Run Locally

```bash
npm start
```

Open `http://localhost:3000`.

## Environment Variables

```bash
PORT=3000
SESSION_SECRET=replace-with-a-long-random-secret
DATA_DIR=./data
DB_PATH=./data/db.json
```

## Railway Deployment

1. Push this repository to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Set `SESSION_SECRET` in Railway variables.
4. Railway will run `npm start` automatically.
5. Use the generated Railway domain as the live URL.

## REST API

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### Users

- `GET /api/users`
- `PATCH /api/users` admin only, updates a user's role

### Projects

- `GET /api/projects`
- `POST /api/projects` admin only
- `PATCH /api/projects/:id` admin only
- `DELETE /api/projects/:id` admin only

### Tasks

- `GET /api/tasks`
- `POST /api/tasks` admin only
- `PATCH /api/tasks/:id` admin can update all fields; members can update status for assigned tasks
- `DELETE /api/tasks/:id` admin only

### Dashboard

- `GET /api/dashboard`

## Data Model

The database is stored in `data/db.json` and contains:

- `users`: name, email, password hash, role, active status
- `projects`: name, description, owner, member relationships
- `tasks`: project, assignee, status, priority, due date
- `audit`: recent user actions

## Selection Submission Checklist

- Live URL: deploy on Railway
- GitHub repo: push this project
- README: included
- Demo video: record login, admin project/task creation, member status update, and dashboard changes
