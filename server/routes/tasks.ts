import { Router } from "express";
import { KillSwitchActiveError } from "../../src/edith/killSwitch";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { executorService } from "../../src/edith/executor";
import { plannerService } from "../../src/edith/planner";
import { recoveryService } from "../../src/edith/recovery";
import { taskQueueService } from "../../src/edith/taskQueueService";
import { taskService } from "../../src/edith/taskService";
import { createStoredTask, listTasks, updateTaskStatus } from "../../src/edith/taskStore";
import { verificationService } from "../../src/edith/verifier";

export function createTasksRouter(): Router {
  const router = Router();

  router.get("/api/edith/tasks", (_req, res) => {
    res.json({
      success: true,
      tasks: listTasks(),
    });
  });

  router.get("/api/edith/tasks/queue", (_req, res) => {
    res.json({ success: true, queue: taskQueueService.snapshot(), next: taskQueueService.next() });
  });

  router.get("/api/edith/tasks/:id/activity", (req, res) => {
    const task = taskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({
      success: true,
      taskId: task.id,
      status: task.status,
      timeline: task.timeline ?? [],
      agentActivity: task.agentActivity ?? [],
      recoveryEvents: task.recoveryEvents ?? [],
      verification: task.verification,
    });
  });

  router.post("/api/edith/tasks", (req, res) => {
    const {
      title = "EDITH Task",
      objective,
      originalUserRequest,
      toolsRequired = [],
      permissionsRequired = [],
      riskLevel = 1,
    } = req.body ?? {};
    if (!objective || !originalUserRequest) {
      return res.status(400).json({ success: false, error: "objective and originalUserRequest are required." });
    }
    try {
      const task = createStoredTask({
        title,
        objective,
        originalUserRequest,
        toolsRequired,
        permissionsRequired,
        riskLevel,
      });
      obsidianVaultService.writeTaskNote(task);
      res.json({ success: true, task });
    } catch (error) {
      if (error instanceof KillSwitchActiveError) {
        return res.status(423).json({ success: false, error: error.message, killSwitch: error.state });
      }
      throw error;
    }
  });

  router.patch("/api/edith/tasks/:id/status", (req, res) => {
    const task = updateTaskStatus(req.params.id, req.body?.status, req.body?.result);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    obsidianVaultService.writeTaskNote(task);
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/queue", (req, res) => {
    const queued = taskQueueService.enqueue(req.params.id);
    if (!queued) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task: queued });
  });

  router.post("/api/edith/tasks/:id/pause", (req, res) => {
    const task = taskQueueService.pause(req.params.id, String(req.body?.reason ?? "Task paused."));
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/resume", (req, res) => {
    const task = taskQueueService.resume(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/cancel", (req, res) => {
    const task = taskQueueService.cancel(req.params.id, String(req.body?.reason ?? "Task cancelled by user."), "edith-api");
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/observations", (req, res) => {
    const observation = String(req.body?.observation ?? "").trim();
    if (!observation) return res.status(400).json({ success: false, error: "observation is required." });
    const task = taskService.addObservation(req.params.id, observation);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/checkpoints", (req, res) => {
    const checkpoint = String(req.body?.checkpoint ?? "").trim();
    if (!checkpoint) return res.status(400).json({ success: false, error: "checkpoint is required." });
    const task = taskService.addCheckpoint(req.params.id, checkpoint);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/artifacts", (req, res) => {
    const artifact = String(req.body?.artifact ?? "").trim();
    if (!artifact) return res.status(400).json({ success: false, error: "artifact is required." });
    const task = taskService.addArtifact(req.params.id, artifact);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/plan", (req, res) => {
    const result = plannerService.planTask(req.params.id);
    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error ?? "Task not found." });
    }
    res.json({ success: true, plan: result.plan, task: result.task });
  });

  router.post("/api/edith/tasks/:id/execute", async (req, res) => {
    const result = await executorService.executeTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post("/api/edith/tasks/:id/verify", (req, res) => {
    const result = verificationService.verifyTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post("/api/edith/tasks/:id/recover", (req, res) => {
    const result = recoveryService.recoverTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  return router;
}
