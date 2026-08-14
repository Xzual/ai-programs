import { createTask, type EdithTask, type EdithTaskStatus } from './core';
import { getEdithPersistenceStore } from './persistence';

export function listTasks(): EdithTask[] {
  return getEdithPersistenceStore().listTasks();
}

export function createStoredTask(params: {
  title: string;
  objective: string;
  originalUserRequest: string;
  toolsRequired?: string[];
  permissionsRequired?: string[];
  riskLevel?: 0 | 1 | 2 | 3 | 4 | 5;
}): EdithTask {
  const task = createTask(params);
  return getEdithPersistenceStore().createTask(task);
}

export function updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
  return getEdithPersistenceStore().updateTaskStatus(id, status, result);
}

export function getTaskStorePath(): string {
  const paths = getEdithPersistenceStore().getPaths();
  return paths.sqliteFile ?? paths.legacyTaskFile;
}
