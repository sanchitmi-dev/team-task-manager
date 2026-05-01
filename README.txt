Team Task Manager
=================

A full-stack web app for managing team projects, assigning tasks, tracking progress, and enforcing role-based access control.

GitHub Repository
-----------------
https://github.com/sanchitmi-dev/team-task-manager

Features
--------
- Authentication with signup, login, logout, signed HTTP-only session cookies, and hashed passwords
- Admin/member role-based access control
- Project management with team membership
- Task creation, assignment, priority, due dates, and status tracking
- Dashboard with project count, task count, completion, overdue tasks, status overview, and recent work
- REST API plus JSON-backed NoSQL database
- Responsive UI with no external frontend dependency
- Railway-ready Node deployment

Demo Accounts
-------------
The app creates these accounts automatically on first run:

Admin:
Email: admin@example.com
Password: Admin@12345

Member:
Email: member@example.com
Password: Member@12345

Run Locally
-----------
npm start

Open:
http://localhost:3000

Environment Variables
---------------------
PORT=3000
SESSION_SECRET=replace-with-a-long-random-secret
DATA_DIR=./data
DB_PATH=./data/db.json

Railway Deployment
------------------
1. Push this repository to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Set SESSION_SECRET in Railway variables.
4. Railway will run npm start automatically.
5. Use the generated Railway domain as the live application URL.

REST API
--------
Auth:
- POST /api/auth/signup
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/me

Users:
- GET /api/users
- PATCH /api/users

Projects:
- GET /api/projects
- POST /api/projects
- PATCH /api/projects/:id
- DELETE /api/projects/:id

Tasks:
- GET /api/tasks
- POST /api/tasks
- PATCH /api/tasks/:id
- DELETE /api/tasks/:id

Dashboard:
- GET /api/dashboard

Data Model
----------
The database is stored in data/db.json and contains:
- users: name, email, password hash, role, active status
- projects: name, description, owner, member relationships
- tasks: project, assignee, status, priority, due date
- audit: recent user actions

Submission Checklist
--------------------
- Live URL: Deploy on Railway and paste the generated Railway URL
- GitHub repo: https://github.com/sanchitmi-dev/team-task-manager
- README: README.md and README.txt are included
- Demo video: Record login, admin project/task creation, member status update, and dashboard changes
