import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'db.json');
const PUBLIC_DIR = join(__dirname, 'public');

const STATUS_VALUES = ['todo', 'in_progress', 'review', 'done'];
const ROLE_VALUES = ['admin', 'member'];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomBytes(9).toString('hex')}`;
}

function createEmptyDb() {
  return { users: [], projects: [], tasks: [], invites: [], sessions: [], audit: [] };
}

function ensureDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) writeFileSync(DB_PATH, JSON.stringify(createEmptyDb(), null, 2));
}

function readDb() {
  ensureDb();
  return JSON.parse(readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 64);
  const storedBytes = Buffer.from(hash, 'hex');
  return storedBytes.length === candidate.length && timingSafeEqual(storedBytes, candidate);
}

function sign(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function createSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, createdAt: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getSessionUser(req, db) {
  const token = parseCookies(req.headers.cookie).session;
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (sign(payload) !== signature) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return db.users.find((user) => user.id === session.userId && user.active !== false) || null;
  } catch {
    return null;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(body);
}

function ok(res, data = {}) {
  send(res, 200, data);
}

function fail(res, status, message, details) {
  send(res, status, { error: message, details });
}

function requireAuth(req, res, db) {
  const user = getSessionUser(req, db);
  if (!user) fail(res, 401, 'Authentication required');
  return user;
}

function requireAdmin(user, res) {
  if (user.role !== 'admin') {
    fail(res, 403, 'Admin access required');
    return false;
  }
  return true;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function requireText(value, label, min = 2, max = 120) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) return `${label} must be ${min}-${max} characters`;
  return null;
}

function canAccessProject(user, project) {
  return user.role === 'admin' || project.memberIds.includes(user.id);
}

function visibleProjects(db, user) {
  return db.projects.filter((project) => canAccessProject(user, project));
}

function decorateTask(db, task) {
  const assignee = db.users.find((user) => user.id === task.assigneeId);
  const project = db.projects.find((item) => item.id === task.projectId);
  return { ...task, assignee: sanitizeUser(assignee), projectName: project?.name || 'Deleted project' };
}

function dashboard(db, user) {
  const projects = visibleProjects(db, user);
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = db.tasks
    .filter((task) => projectIds.has(task.projectId))
    .filter((task) => user.role === 'admin' || task.assigneeId === user.id || projects.some((p) => p.ownerId === user.id && p.id === task.projectId));
  const today = new Date();
  const overdue = tasks.filter((task) => task.status !== 'done' && task.dueDate && new Date(`${task.dueDate}T23:59:59`) < today);
  const byStatus = Object.fromEntries(STATUS_VALUES.map((status) => [status, tasks.filter((task) => task.status === status).length]));
  return {
    stats: {
      projects: projects.length,
      tasks: tasks.length,
      completed: tasks.filter((task) => task.status === 'done').length,
      overdue: overdue.length
    },
    byStatus,
    recentTasks: tasks
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((task) => decorateTask(db, task)),
    overdueTasks: overdue.map((task) => decorateTask(db, task))
  };
}

function audit(db, actorId, action, target) {
  db.audit.unshift({ id: id('audit'), actorId, action, target, createdAt: now() });
  db.audit = db.audit.slice(0, 80);
}

function createSeedDataIfNeeded() {
  const db = readDb();
  if (db.users.length) return;
  const admin = {
    id: id('usr'),
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    passwordHash: hashPassword('Admin@12345'),
    active: true,
    createdAt: now()
  };
  const member = {
    id: id('usr'),
    name: 'Team Member',
    email: 'member@example.com',
    role: 'member',
    passwordHash: hashPassword('Member@12345'),
    active: true,
    createdAt: now()
  };
  const project = {
    id: id('prj'),
    name: 'Launch Website',
    description: 'Plan, build, and ship the marketing launch.',
    ownerId: admin.id,
    memberIds: [admin.id, member.id],
    createdAt: now(),
    updatedAt: now()
  };
  db.users.push(admin, member);
  db.projects.push(project);
  db.tasks.push(
    {
      id: id('tsk'),
      projectId: project.id,
      title: 'Create wireframes',
      description: 'Draft the first dashboard layout.',
      assigneeId: member.id,
      status: 'in_progress',
      priority: 'high',
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      createdBy: admin.id,
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: id('tsk'),
      projectId: project.id,
      title: 'Review deployment checklist',
      description: 'Verify env vars, health endpoint, and README.',
      assigneeId: admin.id,
      status: 'todo',
      priority: 'medium',
      dueDate: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
      createdBy: admin.id,
      createdAt: now(),
      updatedAt: now()
    }
  );
  writeDb(db);
}

async function routeApi(req, res, pathname) {
  const db = readDb();
  const method = req.method || 'GET';

  if (pathname === '/api/health') return ok(res, { status: 'ok', time: now() });

  if (pathname === '/api/auth/signup' && method === 'POST') {
    const body = await readJson(req);
    const nameError = requireText(body.name, 'Name');
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (nameError) return fail(res, 400, nameError);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Valid email is required');
    if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
    if (db.users.some((user) => user.email === email)) return fail(res, 409, 'Email already exists');
    const user = {
      id: id('usr'),
      name: String(body.name).trim(),
      email,
      role: db.users.length === 0 ? 'admin' : 'member',
      passwordHash: hashPassword(password),
      active: true,
      createdAt: now()
    };
    db.users.push(user);
    audit(db, user.id, 'signed up', user.email);
    writeDb(db);
    const cookie = createSessionCookie(user.id);
    return send(res, 201, { user: sanitizeUser(user) }, { 'Set-Cookie': `session=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const user = db.users.find((item) => item.email === email && item.active !== false);
    if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) return fail(res, 401, 'Invalid email or password');
    audit(db, user.id, 'logged in', user.email);
    writeDb(db);
    const cookie = createSessionCookie(user.id);
    return send(res, 200, { user: sanitizeUser(user) }, { 'Set-Cookie': `session=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  const user = requireAuth(req, res, db);
  if (!user) return;

  if (pathname === '/api/me' && method === 'GET') {
    return ok(res, { user: sanitizeUser(user), dashboard: dashboard(db, user) });
  }

  if (pathname === '/api/users' && method === 'GET') {
    return ok(res, { users: db.users.filter((item) => item.active !== false).map(sanitizeUser) });
  }

  if (pathname === '/api/users' && method === 'PATCH') {
    if (!requireAdmin(user, res)) return;
    const body = await readJson(req);
    const target = db.users.find((item) => item.id === body.userId);
    if (!target) return fail(res, 404, 'User not found');
    if (!ROLE_VALUES.includes(body.role)) return fail(res, 400, 'Role must be admin or member');
    target.role = body.role;
    audit(db, user.id, 'changed role', target.email);
    writeDb(db);
    return ok(res, { user: sanitizeUser(target) });
  }

  if (pathname === '/api/projects' && method === 'GET') {
    return ok(res, {
      projects: visibleProjects(db, user).map((project) => ({
        ...project,
        members: project.memberIds.map((memberId) => sanitizeUser(db.users.find((item) => item.id === memberId))).filter(Boolean),
        taskCount: db.tasks.filter((task) => task.projectId === project.id).length,
        doneCount: db.tasks.filter((task) => task.projectId === project.id && task.status === 'done').length
      }))
    });
  }

  if (pathname === '/api/projects' && method === 'POST') {
    if (!requireAdmin(user, res)) return;
    const body = await readJson(req);
    const nameError = requireText(body.name, 'Project name');
    if (nameError) return fail(res, 400, nameError);
    const memberIds = Array.from(new Set([user.id, ...(Array.isArray(body.memberIds) ? body.memberIds : [])]));
    if (memberIds.some((memberId) => !db.users.find((item) => item.id === memberId))) return fail(res, 400, 'Project member not found');
    const project = {
      id: id('prj'),
      name: String(body.name).trim(),
      description: String(body.description || '').trim(),
      ownerId: user.id,
      memberIds,
      createdAt: now(),
      updatedAt: now()
    };
    db.projects.push(project);
    audit(db, user.id, 'created project', project.name);
    writeDb(db);
    return send(res, 201, { project });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === 'PATCH') {
    if (!requireAdmin(user, res)) return;
    const project = db.projects.find((item) => item.id === projectMatch[1]);
    if (!project) return fail(res, 404, 'Project not found');
    const body = await readJson(req);
    const nameError = body.name === undefined ? null : requireText(body.name, 'Project name');
    if (nameError) return fail(res, 400, nameError);
    if (body.name !== undefined) project.name = String(body.name).trim();
    if (body.description !== undefined) project.description = String(body.description || '').trim();
    if (Array.isArray(body.memberIds)) {
      if (body.memberIds.some((memberId) => !db.users.find((item) => item.id === memberId))) return fail(res, 400, 'Project member not found');
      project.memberIds = Array.from(new Set([project.ownerId, ...body.memberIds]));
    }
    project.updatedAt = now();
    audit(db, user.id, 'updated project', project.name);
    writeDb(db);
    return ok(res, { project });
  }

  if (projectMatch && method === 'DELETE') {
    if (!requireAdmin(user, res)) return;
    const index = db.projects.findIndex((item) => item.id === projectMatch[1]);
    if (index === -1) return fail(res, 404, 'Project not found');
    const [project] = db.projects.splice(index, 1);
    db.tasks = db.tasks.filter((task) => task.projectId !== project.id);
    audit(db, user.id, 'deleted project', project.name);
    writeDb(db);
    return ok(res, { ok: true });
  }

  if (pathname === '/api/tasks' && method === 'GET') {
    const projectIds = new Set(visibleProjects(db, user).map((project) => project.id));
    return ok(res, { tasks: db.tasks.filter((task) => projectIds.has(task.projectId)).map((task) => decorateTask(db, task)) });
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    if (!requireAdmin(user, res)) return;
    const body = await readJson(req);
    const titleError = requireText(body.title, 'Task title');
    if (titleError) return fail(res, 400, titleError);
    const project = db.projects.find((item) => item.id === body.projectId);
    if (!project) return fail(res, 404, 'Project not found');
    const assignee = db.users.find((item) => item.id === body.assigneeId);
    if (!assignee || !project.memberIds.includes(assignee.id)) return fail(res, 400, 'Assignee must be a project member');
    const task = {
      id: id('tsk'),
      projectId: project.id,
      title: String(body.title).trim(),
      description: String(body.description || '').trim(),
      assigneeId: assignee.id,
      status: STATUS_VALUES.includes(body.status) ? body.status : 'todo',
      priority: ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium',
      dueDate: body.dueDate || '',
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    audit(db, user.id, 'created task', task.title);
    writeDb(db);
    return send(res, 201, { task: decorateTask(db, task) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    const task = db.tasks.find((item) => item.id === taskMatch[1]);
    if (!task) return fail(res, 404, 'Task not found');
    const project = db.projects.find((item) => item.id === task.projectId);
    if (!project || !canAccessProject(user, project)) return fail(res, 403, 'No access to this task');
    const body = await readJson(req);
    const adminChangingProtectedFields = body.title !== undefined || body.description !== undefined || body.assigneeId !== undefined || body.projectId !== undefined || body.priority !== undefined || body.dueDate !== undefined;
    if (adminChangingProtectedFields && !requireAdmin(user, res)) return;
    if (body.title !== undefined) {
      const titleError = requireText(body.title, 'Task title');
      if (titleError) return fail(res, 400, titleError);
      task.title = String(body.title).trim();
    }
    if (body.description !== undefined) task.description = String(body.description || '').trim();
    if (body.status !== undefined) {
      if (!STATUS_VALUES.includes(body.status)) return fail(res, 400, 'Invalid task status');
      if (user.role !== 'admin' && task.assigneeId !== user.id) return fail(res, 403, 'Members can update only their assigned task status');
      task.status = body.status;
    }
    if (body.assigneeId !== undefined) {
      const assignee = db.users.find((item) => item.id === body.assigneeId);
      if (!assignee || !project.memberIds.includes(assignee.id)) return fail(res, 400, 'Assignee must be a project member');
      task.assigneeId = assignee.id;
    }
    if (body.priority !== undefined) task.priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : task.priority;
    if (body.dueDate !== undefined) task.dueDate = body.dueDate || '';
    task.updatedAt = now();
    audit(db, user.id, 'updated task', task.title);
    writeDb(db);
    return ok(res, { task: decorateTask(db, task) });
  }

  if (taskMatch && method === 'DELETE') {
    if (!requireAdmin(user, res)) return;
    const index = db.tasks.findIndex((item) => item.id === taskMatch[1]);
    if (index === -1) return fail(res, 404, 'Task not found');
    const [task] = db.tasks.splice(index, 1);
    audit(db, user.id, 'deleted task', task.title);
    writeDb(db);
    return ok(res, { ok: true });
  }

  if (pathname === '/api/dashboard' && method === 'GET') return ok(res, dashboard(db, user));

  fail(res, 404, 'API route not found');
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(resolve(PUBLIC_DIR))) return fail(res, 403, 'Forbidden');
  if (!existsSync(filePath)) return serveStatic(req, res, '/');
  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

createSeedDataIfNeeded();

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url.pathname);
      return serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      return fail(res, error.status || 500, error.message || 'Server error');
    }
  })
  .listen(PORT, () => {
    console.log(`Team Task Manager running on http://localhost:${PORT}`);
  });
