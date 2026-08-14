import fs from 'fs';
import path from 'path';
import { createTask, type EdithTask, type EdithTaskStatus } from './core';

const EDITH_DIR = path.resolve(process.cwd(), '.edith');
const TASK_FILE = path.join(EDITH_DIR, 'tasks.json');

function ensureDir(): void {
  fs.mkdirSync(EDITH_DIR, { recursive: true });
}

function readTasks(): EdithTask[] {
  ensureDir();
  if (!fs.existsSync(TASK_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TASK_FILE, 'utf8')) as EdithTask[];
  } catch {
    return [];
  }
}

function writeTasks(tasks: EdithTask[]): void {
  ensureDir();
  fs.writeFileSync(TASK_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

export function listTasks(): EdithTask[] {
  return readTasks().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
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
  writeTasks([task, ...readTasks()]);
  return task;
}

export function updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
  const tasks = readTasks();
  const updated = tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          status,
          result: result ?? task.result,
          observations: [...task.observations, `Status changed to ${status} at ${new Date().toISOString()}`],
        }
      : task
  );
  writeTasks(updated);
  return updated.find((task) => task.id === id);
}

export function getTaskStorePath(): string {
  return TASK_FILE;
}
