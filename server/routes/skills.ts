import { Router, type Response } from 'express';
import { getEdithToolRegistrySnapshot } from '../../src/edith/serverRegistry';
import {
  buildCapabilitySummary,
  getSkillRegistry,
  type SkillRegistrySnapshot,
} from '../../src/edith/skillRegistry';
import { buildCapabilityToolRegistry } from '../../src/edith/toolRegistry';

export interface SkillsRouterDependencies {
  readRegistry?: (options?: { forceRefresh?: boolean }) => Promise<SkillRegistrySnapshot>;
  readToolSnapshot?: () => ReturnType<typeof getEdithToolRegistrySnapshot>;
}

function wantsRefresh(value: unknown): boolean {
  return value === 'true' || value === '1';
}

export function createSkillsRouter(dependencies: SkillsRouterDependencies = {}): Router {
  const router = Router();
  const readRegistry = dependencies.readRegistry ?? getSkillRegistry;
  const readToolSnapshot = dependencies.readToolSnapshot ?? getEdithToolRegistrySnapshot;

  async function snapshotFor(query: Record<string, unknown>): Promise<SkillRegistrySnapshot> {
    return readRegistry({ forceRefresh: wantsRefresh(query.refresh) });
  }

  function registryError(res: Response, error: unknown): void {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Capability registry unavailable.',
    });
  }

  router.get('/api/edith/skills', async (req, res) => {
    try {
      const snapshot = await snapshotFor(req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, ...snapshot });
    } catch (error) {
      registryError(res, error);
    }
  });

  router.get('/api/edith/skills/status', async (req, res) => {
    try {
      const { checkedAt, skills, counts } = await snapshotFor(req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        checkedAt,
        counts,
        statuses: skills.map(({ id, name, status, readiness, riskLevel, lastChecked, limitations }) => ({
          id, name, status, readiness, riskLevel, lastChecked, limitations,
        })),
      });
    } catch (error) {
      registryError(res, error);
    }
  });

  router.get('/api/edith/tools', async (req, res) => {
    try {
      const snapshot = await snapshotFor(req.query);
      const registry = readToolSnapshot();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        ...registry,
        skillRegistryCheckedAt: snapshot.checkedAt,
        planningCapabilities: buildCapabilityToolRegistry(snapshot),
      });
    } catch (error) {
      registryError(res, error);
    }
  });

  router.get('/api/edith/capabilities', async (req, res) => {
    try {
      const snapshot = await snapshotFor(req.query);
      const registry = readToolSnapshot();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        ...snapshot,
        summary: buildCapabilitySummary(snapshot),
        toolRegistry: registry,
        planningCapabilities: buildCapabilityToolRegistry(snapshot),
      });
    } catch (error) {
      registryError(res, error);
    }
  });

  router.get('/api/edith/capabilities/summary', async (req, res) => {
    try {
      const snapshot = await snapshotFor(req.query);
      const registry = readToolSnapshot();
      const summary = buildCapabilitySummary(snapshot);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        ...summary,
        toolRegistryAuthority: registry.authority,
        toolCounts: registry.counts,
      });
    } catch (error) {
      registryError(res, error);
    }
  });

  return router;
}
