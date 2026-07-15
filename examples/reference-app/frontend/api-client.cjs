// Thin fetch wrapper for the Task Tracker reference app backend.
// Introduced at checkpoint 005 (specs/005-frontend-backend-integration.md).
//
// Named .cjs (not .js) so this file is unambiguously CommonJS to Node when
// required from tests/frontend/test_app.cjs, independent of any package.json
// "type" field in this repo or its parents. Browsers don't care about file
// extension for a classic (non type="module") <script src>, so index.html
// loads it the same way either way.

const TaskApiClient = {
  async listTasks() {
    const response = await fetch("/api/tasks");
    return response.json();
  },

  async addTask(title) {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return response.json();
  },
};

if (typeof module !== "undefined") {
  module.exports = TaskApiClient;
}
