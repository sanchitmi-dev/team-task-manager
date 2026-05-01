const state = {
  authMode: 'login',
  user: null,
  users: [],
  projects: [],
  tasks: [],
  dashboard: null,
  activeView: 'dashboard'
};

const labels = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done'
};

const statuses = ['todo', 'in_progress', 'review', 'done'];
const priorities = ['low', 'medium', 'high'];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatDate(date) {
  if (!date) return 'No due date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'done') return false;
  return new Date(`${task.dueDate}T23:59:59`) < new Date();
}

function initials(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase();
}

function isAdmin() {
  return state.user?.role === 'admin';
}

function setAuthMode(mode) {
  state.authMode = mode;
  $$('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
  $$('.signup-only').forEach((el) => el.classList.toggle('hidden', mode !== 'signup'));
  $('#authForm input[name="password"]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

async function loadAll() {
  const me = await api('/api/me');
  state.user = me.user;
  state.dashboard = me.dashboard;
  const [users, projects, tasks] = await Promise.all([api('/api/users'), api('/api/projects'), api('/api/tasks')]);
  state.users = users.users;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  render();
}

function renderShell() {
  $('#authView').classList.toggle('hidden', Boolean(state.user));
  $('#appView').classList.toggle('hidden', !state.user);
  if (!state.user) return;
  $('#roleBadge').textContent = state.user.role;
  $('#userName').textContent = state.user.name;
  $('#userEmail').textContent = state.user.email;
  $('#userInitial').textContent = initials(state.user.name);
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin()));
}

function renderDashboard() {
  const stats = state.dashboard?.stats || {};
  $('#statProjects').textContent = stats.projects || 0;
  $('#statTasks').textContent = stats.tasks || 0;
  $('#statCompleted').textContent = stats.completed || 0;
  $('#statOverdue').textContent = stats.overdue || 0;

  const byStatus = state.dashboard?.byStatus || {};
  const max = Math.max(1, ...statuses.map((status) => byStatus[status] || 0));
  $('#statusBars').innerHTML = statuses
    .map((status) => {
      const count = byStatus[status] || 0;
      return `
        <div class="bar-row">
          <div class="bar-label"><span>${labels[status]}</span><span>${count}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
        </div>
      `;
    })
    .join('');

  $('#recentTasks').innerHTML = (state.dashboard?.recentTasks || []).map(taskCard).join('') || emptyState('No tasks yet');
}

function renderProjects() {
  $('#projectList').innerHTML =
    state.projects
      .map((project) => {
        const progress = project.taskCount ? Math.round((project.doneCount / project.taskCount) * 100) : 0;
        return `
          <article class="project-card">
            <div>
              <h4>${escapeHtml(project.name)}</h4>
              <p class="muted">${escapeHtml(project.description || 'No description')}</p>
            </div>
            <div class="progress" aria-label="${progress}% complete"><span style="width:${progress}%"></span></div>
            <div class="meta">
              <span>${project.taskCount} tasks</span>
              <span>${progress}% complete</span>
              <span>${project.members.length} members</span>
            </div>
            <div class="card-actions admin-only ${isAdmin() ? '' : 'hidden'}">
              <button class="ghost" data-edit-project="${project.id}">Edit</button>
              <button class="danger-btn" data-delete-project="${project.id}">Delete</button>
            </div>
          </article>
        `;
      })
      .join('') || emptyState('No projects found');
}

function taskCard(task) {
  const overdue = isOverdue(task);
  return `
    <article class="task-card">
      <h4>${escapeHtml(task.title)}</h4>
      <p class="muted">${escapeHtml(task.description || 'No description')}</p>
      <div class="meta">
        <span class="pill ${task.status}">${labels[task.status]}</span>
        <span class="pill ${task.priority}">${task.priority}</span>
        ${overdue ? '<span class="pill overdue">Overdue</span>' : ''}
        <span>${escapeHtml(task.projectName)}</span>
        <span>${escapeHtml(task.assignee?.name || 'Unassigned')}</span>
        <span>${formatDate(task.dueDate)}</span>
      </div>
      <div class="task-actions">
        <select data-status-task="${task.id}">
          ${statuses.map((status) => `<option value="${status}" ${task.status === status ? 'selected' : ''}>${labels[status]}</option>`).join('')}
        </select>
        ${
          isAdmin()
            ? `<button class="ghost" data-edit-task="${task.id}">Edit</button><button class="danger-btn" data-delete-task="${task.id}">Delete</button>`
            : ''
        }
      </div>
    </article>
  `;
}

function renderTasks() {
  const projectFilter = $('#projectFilter');
  const selectedProject = projectFilter.value;
  projectFilter.innerHTML = '<option value="">All projects</option>' + state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join('');
  projectFilter.value = selectedProject;

  const statusFilter = $('#statusFilter').value;
  const projectId = $('#projectFilter').value;
  const filtered = state.tasks.filter((task) => (!statusFilter || task.status === statusFilter) && (!projectId || task.projectId === projectId));
  $('#taskBoard').innerHTML = statuses
    .map(
      (status) => `
        <section class="column">
          <h3>${labels[status]}</h3>
          ${filtered.filter((task) => task.status === status).map(taskCard).join('') || emptyState('No tasks')}
        </section>
      `
    )
    .join('');
}

function renderTeam() {
  $('#teamList').innerHTML =
    state.users
      .map(
        (user) => `
          <article class="team-card">
            <div class="card-head">
              <span class="brand-mark">${initials(user.name)}</span>
              <div>
                <strong>${escapeHtml(user.name)}</strong>
                <div class="muted">${escapeHtml(user.email)}</div>
              </div>
            </div>
            <select data-role-user="${user.id}" ${user.id === state.user.id ? 'disabled' : ''}>
              <option value="member" ${user.role === 'member' ? 'selected' : ''}>Member</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </article>
        `
      )
      .join('');
}

function render() {
  renderShell();
  if (!state.user) return;
  $('#viewTitle').textContent = state.activeView.charAt(0).toUpperCase() + state.activeView.slice(1);
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${state.activeView}View`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.activeView));
  renderDashboard();
  renderProjects();
  renderTasks();
  renderTeam();
}

function emptyState(text) {
  return `<p class="muted">${text}</p>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function fillProjectForm(project = null) {
  const form = $('#projectForm');
  form.reset();
  form.projectId.value = project?.id || '';
  form.name.value = project?.name || '';
  form.description.value = project?.description || '';
  $('#projectDialogTitle').textContent = project ? 'Edit project' : 'New project';
  form.memberIds.innerHTML = state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`).join('');
  Array.from(form.memberIds.options).forEach((option) => {
    option.selected = project ? project.memberIds.includes(option.value) : option.value === state.user.id;
  });
  $('#projectDialog').showModal();
}

function fillTaskForm(task = null) {
  const form = $('#taskForm');
  form.reset();
  form.taskId.value = task?.id || '';
  form.title.value = task?.title || '';
  form.description.value = task?.description || '';
  form.projectId.innerHTML = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join('');
  form.status.innerHTML = statuses.map((status) => `<option value="${status}">${labels[status]}</option>`).join('');
  form.priority.innerHTML = priorities.map((priority) => `<option value="${priority}">${priority}</option>`).join('');
  form.projectId.value = task?.projectId || state.projects[0]?.id || '';
  form.status.value = task?.status || 'todo';
  form.priority.value = task?.priority || 'medium';
  form.dueDate.value = task?.dueDate || '';
  updateAssignees(task?.assigneeId);
  $('#taskDialogTitle').textContent = task ? 'Edit task' : 'New task';
  $('#taskDialog').showModal();
}

function updateAssignees(selectedId = '') {
  const form = $('#taskForm');
  const project = state.projects.find((item) => item.id === form.projectId.value);
  const members = project?.members || [];
  form.assigneeId.innerHTML = members.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join('');
  form.assigneeId.value = selectedId || members[0]?.id || '';
}

async function refresh(message) {
  await loadAll();
  if (message) toast(message);
}

function bindEvents() {
  $$('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));

  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    try {
      const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const data = await api(path, { method: 'POST', body: payload });
      state.user = data.user;
      await refresh('Welcome in');
    } catch (error) {
      toast(error.message);
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    render();
  });

  $$('.nav-item').forEach((button) =>
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      render();
    })
  );

  $('#newProjectBtn').addEventListener('click', () => fillProjectForm());
  $('#newTaskBtn').addEventListener('click', () => fillTaskForm());
  $('#statusFilter').addEventListener('change', renderTasks);
  $('#projectFilter').addEventListener('change', renderTasks);
  $('#taskForm select[name="projectId"]').addEventListener('change', () => updateAssignees());

  $$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

  $('#projectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      name: form.name.value,
      description: form.description.value,
      memberIds: Array.from(form.memberIds.selectedOptions).map((option) => option.value)
    };
    try {
      if (form.projectId.value) await api(`/api/projects/${form.projectId.value}`, { method: 'PATCH', body });
      else await api('/api/projects', { method: 'POST', body });
      $('#projectDialog').close();
      await refresh('Project saved');
    } catch (error) {
      toast(error.message);
    }
  });

  $('#taskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      if (form.taskId.value) await api(`/api/tasks/${form.taskId.value}`, { method: 'PATCH', body });
      else await api('/api/tasks', { method: 'POST', body });
      $('#taskDialog').close();
      await refresh('Task saved');
    } catch (error) {
      toast(error.message);
    }
  });

  document.body.addEventListener('click', async (event) => {
    const projectEdit = event.target.closest('[data-edit-project]');
    const projectDelete = event.target.closest('[data-delete-project]');
    const taskEdit = event.target.closest('[data-edit-task]');
    const taskDelete = event.target.closest('[data-delete-task]');

    if (projectEdit) fillProjectForm(state.projects.find((project) => project.id === projectEdit.dataset.editProject));
    if (taskEdit) fillTaskForm(state.tasks.find((task) => task.id === taskEdit.dataset.editTask));

    if (projectDelete && confirm('Delete this project and all of its tasks?')) {
      await api(`/api/projects/${projectDelete.dataset.deleteProject}`, { method: 'DELETE' });
      await refresh('Project deleted');
    }

    if (taskDelete && confirm('Delete this task?')) {
      await api(`/api/tasks/${taskDelete.dataset.deleteTask}`, { method: 'DELETE' });
      await refresh('Task deleted');
    }
  });

  document.body.addEventListener('change', async (event) => {
    const statusSelect = event.target.closest('[data-status-task]');
    const roleSelect = event.target.closest('[data-role-user]');
    try {
      if (statusSelect) {
        await api(`/api/tasks/${statusSelect.dataset.statusTask}`, { method: 'PATCH', body: { status: statusSelect.value } });
        await refresh('Status updated');
      }
      if (roleSelect) {
        await api('/api/users', { method: 'PATCH', body: { userId: roleSelect.dataset.roleUser, role: roleSelect.value } });
        await refresh('Role updated');
      }
    } catch (error) {
      toast(error.message);
      await loadAll();
    }
  });
}

async function init() {
  bindEvents();
  setAuthMode('login');
  try {
    await loadAll();
  } catch {
    state.user = null;
    render();
  }
}

init();
