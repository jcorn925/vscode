// Minimal Node-runnable smoke test for the Task Tracker frontend.
// Introduced at checkpoint 006 (specs/006-reference-app-test-suite.md).
// Run with: node examples/reference-app/tests/frontend/test_app.cjs
//
// Named .cjs so `require` works regardless of this repo's root package.json
// "type": "module" — see frontend/api-client.cjs for the same reasoning.

const assert = require("assert");
const path = require("path");

const TaskApiClient = require(path.join(__dirname, "..", "..", "frontend", "api-client.cjs"));

assert.strictEqual(typeof TaskApiClient.listTasks, "function", "listTasks should be exported");
assert.strictEqual(typeof TaskApiClient.addTask, "function", "addTask should be exported");

console.log("test_app.cjs: TaskApiClient exports look correct");
