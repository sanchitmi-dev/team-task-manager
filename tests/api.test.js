import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const port = 3456;
let child;

function request(path, options = {}) {
  return fetch(`http://localhost:${port}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

async function json(response) {
  return response.json();
}

before(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ttm-'));
  child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SESSION_SECRET: 'test-secret' },
    stdio: 'ignore'
  });
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await request('/api/health');
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Server did not start');
});

after(() => {
  child?.kill();
});

test('admin can create project and task, member cannot create project', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'Admin@12345' }
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];

  const usersResponse = await request('/api/users', { headers: { Cookie: adminCookie } });
  const users = (await json(usersResponse)).users;
  const member = users.find((user) => user.email === 'member@example.com');
  assert.ok(member);

  const projectResponse = await request('/api/projects', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { name: 'QA Project', description: 'Regression work', memberIds: [member.id] }
  });
  assert.equal(projectResponse.status, 201);
  const project = (await json(projectResponse)).project;

  const taskResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { projectId: project.id, title: 'Verify auth flow', assigneeId: member.id, status: 'todo', priority: 'high' }
  });
  assert.equal(taskResponse.status, 201);
  const task = (await json(taskResponse)).task;

  const memberLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'member@example.com', password: 'Member@12345' }
  });
  const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];

  const forbiddenProject = await request('/api/projects', {
    method: 'POST',
    headers: { Cookie: memberCookie },
    body: { name: 'Member Project' }
  });
  assert.equal(forbiddenProject.status, 403);

  const statusUpdate = await request(`/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { Cookie: memberCookie },
    body: { status: 'done' }
  });
  assert.equal(statusUpdate.status, 200);
  assert.equal((await json(statusUpdate)).task.status, 'done');
});
