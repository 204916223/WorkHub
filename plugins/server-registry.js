import { WorkspacePlugin } from './workspace/server.js'
import { TasksPlugin } from './tasks/server.js'
import { WorktimePlugin } from './worktime/server.js'

// Composition root: each workspace gets fresh plugin instances and its own runtime.
export function createPlugins() { return [new WorkspacePlugin(), new TasksPlugin(), new WorktimePlugin()] }
