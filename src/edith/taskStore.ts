import type { EdithTask, EdithTaskStatus } from './core';
import { getEdithPersistenceStore } from './persistence';
import { taskService } from './taskService';

export function listTasks(): EdithTask[] {
  return taskService.listTasks();
}

export function createStoredTask(params: {
  title: string;
  objective: string;
  originalUserRequest: string;
  toolsRequired?: string[];
  permissionsRequired?: string[];
  riskLevel?: 0 | 1 | 2 | 3 | 4 | 5;
}): EdithTask {
  return taskService.createTask(params);
}

export function updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
  return taskService.updateStatus(id, status, result);
}

export function getTaskStorePath(): string {
  const paths = getEdithPersistenceStore().getPaths();
  return paths.sqliteFile ?? paths.legacyTaskFile;
}
