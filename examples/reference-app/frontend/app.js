// UI wiring for the Task Tracker reference app.
// Introduced at checkpoint 004 (specs/004-frontend-scaffold.md), then wired
// to the backend at checkpoint 005 via api-client.cjs.

function renderTasks(tasks) {
  const list = document.getElementById("task-list");
  list.innerHTML = "";
  for (const task of tasks) {
    const item = document.createElement("li");
    item.textContent = `${task.done ? "[x]" : "[ ]"} ${task.title}`;
    list.appendChild(item);
  }
}

async function refresh() {
  const tasks = await TaskApiClient.listTasks();
  renderTasks(tasks);
}

document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("task-title");
  if (!input.value.trim()) {
    return;
  }
  await TaskApiClient.addTask(input.value.trim());
  input.value = "";
  await refresh();
});

refresh();
