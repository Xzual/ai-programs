import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-local-tool-probes-test-'));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.CADQUERY_PYTHON;
  delete process.env.EDITH_CADQUERY_PYTHON;

  const { localToolProbeService } = await import('../src/edith/localToolProbes');
  const { design3dService } = await import('../src/edith/design3dService');
  const { visionObservationService } = await import('../src/edith/visionService');

  const probes = localToolProbeService.list();
  const probeIds = probes.map((probe) => probe.id);
  assert.deepEqual(
    ['blender', 'freecad', 'cadquery', 'tesseract', 'openfoam', 'playwright', 'ollama'].every((id) => probeIds.includes(id as any)),
    true
  );
  assert.equal(probes.every((probe) => probe.safeToProbe && probe.startsProcess === false), true);
  assert.equal(localToolProbeService.get('ollama')?.startsProcess, false);

  process.env.EDITH_CADQUERY_PYTHON = path.join(tempRoot, 'python.exe');
  const cadqueryProbe = localToolProbeService.get('cadquery');
  assert.equal(cadqueryProbe?.status, 'detected');
  assert.equal(cadqueryProbe?.detectionMethod, 'env_hint');

  const architectureReport = design3dService.architectureReport();
  assert.equal(architectureReport.localProbes.some((probe) => probe.id === 'playwright'), true);
  assert.equal(architectureReport.selectedTechnologies.every((technology) => technology.bindingStatus === 'CONFIGURATION_REQUIRED'), true);

  const observation = visionObservationService.createObservation({ source: 'pdf', question: 'Read text.' });
  assert.equal(observation.readOnly, true);
  assert.ok((observation.metadata.localProbes as Record<string, unknown>).playwright);
  assert.ok((observation.metadata.localProbes as Record<string, unknown>).tesseract);

  console.log(JSON.stringify({
    success: true,
    probes: probeIds,
    scenarios: [
      'read_only_probe_catalog',
      'ollama_probe_does_not_start_server',
      'cadquery_env_hint',
      'design3d_report_includes_probes',
      'vision_observation_includes_probe_metadata',
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
