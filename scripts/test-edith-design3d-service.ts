import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-design3d-service-test-'));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';

  const { design3dService } = await import('../src/edith/design3dService');
  const { agentRegistryService } = await import('../src/edith/agentRegistry');
  const { plannerService } = await import('../src/edith/planner');
  const { taskService } = await import('../src/edith/taskService');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  const fork = design3dService.createProject({
    prompt: 'JARVIS, bana paslanmaz çelik bir çatal tasarla.',
  });
  assert.equal(fork.version, 1);
  assert.equal(fork.components.some((component) => component.name === 'Tines'), true);
  assert.equal(fork.engineStatus.cadquery, 'CONFIGURATION_REQUIRED');
  assert.equal(fork.history.some((entry) => entry.includes('no CAD geometry was generated')), true);

  const car = design3dService.createProject({
    prompt: 'Dört tekerlekli elektrikli araç konsepti tasarla.',
  });
  assert.equal(car.components.some((component) => component.name === 'Battery Pack'), true);
  assert.equal(car.exportFormats.includes('STEP'), true);

  const snapshot = design3dService.snapshot(car.id, 'Acceptance snapshot.');
  assert.equal(snapshot?.version, 2);
  assert.equal(snapshot?.history.some((entry) => entry.includes('Acceptance snapshot')), true);

  const routes = agentRegistryService.routeTask({
    objective: '3D CAD ve Blender render planla',
    riskLevel: 1,
    toolsRequired: ['design3d_cad_foundation', 'design3d_render_foundation'],
    permissionsRequired: ['system:read'],
  });
  assert.equal(routes.some((route) => route.agentId === 'design3d-orchestrator'), true);

  const task = taskService.createTask({
    title: '3D planner regression',
    objective: '3D CAD STEP STL render simulation için güvenli foundation planla',
    originalUserRequest: 'JARVIS, bana çalışan bir araba tasarla.',
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.plan?.requiredTools.includes('design3d_cad_foundation'), true);
  assert.equal(planned.plan?.requiredTools.includes('design3d_render_foundation'), true);
  assert.equal(planned.plan?.requiredTools.includes('design3d_simulation_foundation'), true);

  const report = design3dService.engineReport();
  assert.equal(report.blender.status, 'CONFIGURATION_REQUIRED');
  assert.equal(report.freecad.status, 'CONFIGURATION_REQUIRED');
  assert.equal(report.cadquery.status, 'CONFIGURATION_REQUIRED');

  const architectureReport = design3dService.architectureReport();
  assert.equal(architectureReport.selectedTechnologies.some((technology) => technology.name.includes('Blender')), true);
  assert.equal(architectureReport.selectedTechnologies.some((technology) => technology.name.includes('FreeCAD')), true);
  assert.equal(architectureReport.selectedTechnologies.some((technology) => technology.name.includes('CadQuery')), true);
  assert.equal(architectureReport.selectedTechnologies.some((technology) => technology.name.includes('Playwright')), true);
  assert.equal(architectureReport.safetyBoundaries.some((boundary) => boundary.includes('No CAD geometry')), true);

  const audits = readRecentAuditEvents(1000);
  assert.equal(audits.some((event) => event.action === 'design3d.project_create'), true);
  assert.equal(audits.some((event) => event.action === 'design3d.snapshot'), true);

  console.log(JSON.stringify({
    success: true,
    projects: design3dService.listProjects().length,
    forkComponents: fork.components.map((component) => component.name),
    carVersion: snapshot?.version,
    scenarios: [
      'create_fork_project',
      'create_vehicle_project',
      'component_tree_inference',
      'snapshot_version_history',
      'design3d_agent_route',
      'planner_selects_3d_foundation_tools',
      'honest_engine_status',
      'architecture_report',
      'audit',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort on Windows.
  }
}
