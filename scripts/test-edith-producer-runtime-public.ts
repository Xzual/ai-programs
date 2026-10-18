import assert from 'node:assert/strict';
import { BoundedResearchAcquisitionWorker } from '../src/edith/researchAcquisitionAdapter';
import { ResearchService } from '../src/edith/researchService';
import { MemoryPhase4Persistence } from '../src/edith/phase4Persistence';

// Explicit W2 acceptance probe: one harmless public read, no search or credentials.
const worker = new BoundedResearchAcquisitionWorker();
const result = await new ResearchService(new MemoryPhase4Persistence(), [worker], worker.resolver)
  .execute({ query: 'example domain documentation', mode: 'FAST', seedUrls: ['https://example.com/'], maxRetries: 0 });
assert.equal(result.outcome, 'completed', JSON.stringify(result.reasonCodes));
assert.ok(result.measurements?.retrievedBytes);
assert.equal(result.measurements?.fixture, false);
assert.equal(result.measurements?.modelCalls, 0);
assert.ok(result.run.sources?.[0]?.contentSha256);
console.log(JSON.stringify({ success: true, productionTransportVerified: true, outcome: result.outcome,
  measurements: result.measurements, source: result.run.sources?.[0], citation: result.run.citations?.[0], claim: result.run.claims?.[0], uncertainty: result.run.uncertainty }));
