import type { EdithSkill, EdithSkillId, SkillRegistrySnapshot, SkillRisk } from './skillRegistry';

export interface EdithCapabilityTool {
  id: string;
  name: string;
  description: string;
  skillId: EdithSkillId;
  riskLevel: SkillRisk;
  requiresApproval: boolean;
  enabled: boolean;
  enabledReason: string;
  endpoint?: string;
  adapter?: string;
  limitations: string[];
  lastChecked: string;
}

type EnableRule = 'ready' | 'configured' | 'catalog_only' | 'safety_stop';

interface ToolDefinition extends Omit<EdithCapabilityTool, 'enabled' | 'enabledReason' | 'lastChecked'> {
  enableRule?: EnableRule;
}

const DEFINITIONS: ToolDefinition[] = [
  {
    id: 'geminiTextChat', name: 'Gemini Text Chat', skillId: 'gemini_text_chat', riskLevel: 'low', requiresApproval: false,
    description: 'Streams a text response through the configured Gemini model.', endpoint: '/api/chat',
    limitations: ['Availability depends on provider health and the selected model.'],
  },
  {
    id: 'startLiveSession', name: 'Start Live Session', skillId: 'voice_room', riskLevel: 'medium', requiresApproval: true,
    description: 'Starts an owner-initiated Gemini Live audio session.', adapter: '/api/voice/live/ws', enableRule: 'configured',
    limitations: ['Microphone permission is granted by the user in the client.'],
  },
  {
    id: 'sendAudio', name: 'Send Audio', skillId: 'voice_room', riskLevel: 'medium', requiresApproval: true,
    description: 'Sends 16 kHz PCM audio to the active Gemini Live session.', adapter: '/api/voice/live/ws',
    limitations: ['Requires an active, ready Voice Room session.'],
  },
  {
    id: 'receiveAudio', name: 'Receive Audio', skillId: 'voice_room', riskLevel: 'low', requiresApproval: false,
    description: 'Receives 24 kHz PCM assistant audio from Gemini Live.', adapter: '/api/voice/live/ws',
    limitations: ['Requires an active, ready Voice Room session.'],
  },
  {
    id: 'stopSession', name: 'Stop Voice Session', skillId: 'voice_room', riskLevel: 'low', requiresApproval: false,
    description: 'Ends the current Gemini Live session.', adapter: '/api/voice/live/ws', enableRule: 'configured', limitations: [],
  },
  {
    id: 'transcriptEvents', name: 'Voice Transcript Events', skillId: 'voice_room', riskLevel: 'medium', requiresApproval: false,
    description: 'Emits user and assistant transcript events for the active session.', adapter: '/api/voice/live/ws',
    limitations: ['Transcript quality depends on the live provider.'],
  },
  {
    id: 'observeScreen', name: 'Observe Screen', skillId: 'computer_use', riskLevel: 'medium', requiresApproval: true,
    description: 'Captures a read-only observation of the owner-approved primary display.', adapter: 'Tauri invoke: observe_screen',
    limitations: ['Primary display only.', 'No OCR semantic targeting yet.'],
  },
  {
    id: 'getScreenshot', name: 'Get Screenshot', skillId: 'computer_use', riskLevel: 'medium', requiresApproval: true,
    description: 'Captures a screenshot inside an active owner session.', adapter: 'Tauri invoke: capture_primary_screen',
    limitations: ['Primary display only.', 'Screenshot data is not stored by the status API.'],
  },
  {
    id: 'moveMouse', name: 'Move Mouse', skillId: 'computer_use', riskLevel: 'high', requiresApproval: true,
    description: 'Moves the pointer through the Windows input bridge.', adapter: 'Tauri invoke: computer_action/moveMouse',
    limitations: ['Owner command mode and an unexpired desktop session are required.'],
  },
  {
    id: 'clickMouse', name: 'Click Mouse', skillId: 'computer_use', riskLevel: 'high', requiresApproval: true,
    description: 'Performs an approved click through the Windows input bridge.', adapter: 'Tauri invoke: computer_action/click',
    limitations: ['No purchase, payment, or destructive confirmation clicks.'],
  },
  {
    id: 'typeText', name: 'Type Text', skillId: 'computer_use', riskLevel: 'high', requiresApproval: true,
    description: 'Types owner-provided text through the Windows input bridge.', adapter: 'Tauri invoke: computer_action/typeText',
    limitations: ['Secrets and destructive commands are blocked by policy.'],
  },
  {
    id: 'hotkey', name: 'Approved Hotkey', skillId: 'computer_use', riskLevel: 'high', requiresApproval: true,
    description: 'Sends a constrained allowlisted key combination.', adapter: 'Tauri invoke: computer_action/hotkey',
    limitations: ['Alt and Escape combinations are blocked.', 'Only two or three allowlisted keys are accepted.'],
  },
  {
    id: 'scroll', name: 'Scroll', skillId: 'computer_use', riskLevel: 'high', requiresApproval: true,
    description: 'Scrolls the active owner-approved desktop target.', adapter: 'Tauri invoke: computer_action/scroll',
    limitations: ['Scroll distance is bounded.'],
  },
  {
    id: 'stopComputerUse', name: 'Emergency Stop', skillId: 'computer_use', riskLevel: 'low', requiresApproval: false,
    description: 'Immediately activates the local Computer Use kill switch.', endpoint: '/api/computer-use/stop', enableRule: 'safety_stop',
    limitations: ['Local requests only.'],
  },
  {
    id: 'getMarketData', name: 'Get Market Data', skillId: 'crypto_demo_exchange', riskLevel: 'low', requiresApproval: false,
    description: 'Reads public Binance market data through the demo service.', endpoint: '/api/crypto/market', limitations: ['Public market data only.'],
  },
  {
    id: 'getPortfolio', name: 'Get Demo Portfolio', skillId: 'crypto_demo_exchange', riskLevel: 'low', requiresApproval: false,
    description: 'Reads the 10,000-credit demo portfolio.', endpoint: '/api/crypto/portfolio', limitations: ['Demo credits have no monetary value.'],
  },
  {
    id: 'getPositions', name: 'Get Demo Positions', skillId: 'crypto_demo_exchange', riskLevel: 'low', requiresApproval: false,
    description: 'Reads open positions in the demo ledger.', endpoint: '/api/crypto/positions', limitations: ['Demo ledger only.'],
  },
  {
    id: 'getTradeHistory', name: 'Get Demo Trade History', skillId: 'crypto_demo_exchange', riskLevel: 'low', requiresApproval: false,
    description: 'Reads demo trade history.', endpoint: '/api/crypto/trades', limitations: ['Demo ledger only.'],
  },
  {
    id: 'demoBuy', name: 'Demo Buy', skillId: 'crypto_demo_exchange', riskLevel: 'medium', requiresApproval: true,
    description: 'Places a simulated buy in the local demo ledger.', endpoint: '/api/crypto/demo/buy',
    limitations: ['Never submits a real exchange order.', 'Uses demo credits only.'],
  },
  {
    id: 'demoSell', name: 'Demo Sell', skillId: 'crypto_demo_exchange', riskLevel: 'medium', requiresApproval: true,
    description: 'Places a simulated sell in the local demo ledger.', endpoint: '/api/crypto/demo/sell',
    limitations: ['Never submits a real exchange order.', 'Uses demo positions only.'],
  },
  {
    id: 'resetPortfolio', name: 'Reset Demo Portfolio', skillId: 'crypto_demo_exchange', riskLevel: 'medium', requiresApproval: true,
    description: 'Resets the demo ledger to its configured starting balance.', endpoint: '/api/crypto/demo/reset',
    limitations: ['Changes demo history and requires explicit confirmation.'],
  },
  {
    id: 'runJevDecision', name: 'Run Jev Decision', skillId: 'jev_decision_model', riskLevel: 'medium', requiresApproval: false,
    description: 'Requests a validated BUY, SELL, or HOLD recommendation for demo use.', endpoint: '/api/crypto/decision/run',
    limitations: ['Decision output cannot execute real trades.', 'Requires a configured backend Jev adapter.'],
  },
  {
    id: 'readNote', name: 'Read Obsidian Note', skillId: 'obsidian_memory', riskLevel: 'low', requiresApproval: false,
    description: 'Reads an indexed note from the configured local vault.', endpoint: '/api/knowledge/node/:id', limitations: ['Configured vault only.'],
  },
  {
    id: 'writeNote', name: 'Write Obsidian Note', skillId: 'obsidian_memory', riskLevel: 'medium', requiresApproval: true,
    description: 'Writes a generated note to the configured local vault.', endpoint: '/api/knowledge/write-note',
    limitations: ['Existing user-owned notes are preserved by registry export workflows.'],
  },
  {
    id: 'searchVault', name: 'Search Obsidian Vault', skillId: 'obsidian_memory', riskLevel: 'low', requiresApproval: false,
    description: 'Searches the indexed local vault.', endpoint: '/api/obsidian/search', limitations: ['Results depend on the current index.'],
  },
  {
    id: 'createLinkedSkillNote', name: 'Create Linked Skill Note', skillId: 'obsidian_memory', riskLevel: 'medium', requiresApproval: true,
    description: 'Creates or updates EDITH-generated linked skill registry notes.', adapter: 'obsidianVaultService.writeSkillRegistryNotes',
    limitations: ['Runs only when the vault is enabled, present, and writable.'],
  },
  {
    id: 'openWebSearch', name: 'Open Web Search', skillId: 'browser_research', riskLevel: 'medium', requiresApproval: false,
    description: 'Opens a validated web search URL.', adapter: 'edithToolRegistry: browser_search', enableRule: 'configured',
    limitations: ['No autonomous extraction or form submission.'],
  },
  {
    id: 'openValidatedUrl', name: 'Open Validated URL', skillId: 'browser_research', riskLevel: 'medium', requiresApproval: true,
    description: 'Opens an HTTP or HTTPS URL after validation.', adapter: 'edithToolRegistry: browser_open', enableRule: 'configured',
    limitations: ['Does not prove page content was read or acted on.'],
  },
  {
    id: 'readSystemStatus', name: 'Read System Status', skillId: 'system_status', riskLevel: 'low', requiresApproval: false,
    description: 'Reads CPU, RAM, OS, uptime, and Node runtime metrics.', adapter: 'edithToolRegistry: system_monitor',
    limitations: ['GPU metrics are not implemented.'],
  },
  {
    id: 'refreshCapabilities', name: 'Refresh Capabilities', skillId: 'control_center', riskLevel: 'low', requiresApproval: false,
    description: 'Refreshes the live skill and tool registry snapshot.', endpoint: '/api/edith/capabilities/summary?refresh=true', limitations: [],
  },
  {
    id: 'listSkillCatalog', name: 'List Skill Catalog', skillId: 'skill_store', riskLevel: 'low', requiresApproval: false,
    description: 'Reads the external skill catalog without installing or executing entries.', endpoint: '/api/edith/skill-catalog', enableRule: 'catalog_only',
    limitations: ['Community installation and execution remain unavailable.', 'Catalog entries are untrusted metadata.'],
  },
];

function enabledFor(skill: EdithSkill, rule: EnableRule): { enabled: boolean; enabledReason: string } {
  if (rule === 'safety_stop') return { enabled: true, enabledReason: 'Safety stop remains available regardless of runtime readiness.' };
  if (rule === 'catalog_only') return { enabled: true, enabledReason: 'Read-only catalog listing exists; installation and execution remain disabled.' };
  if (rule === 'configured') {
    const enabled = !['config_required', 'broken', 'unavailable', 'planned', 'disabled'].includes(skill.status);
    return { enabled, enabledReason: enabled ? `Parent skill is ${skill.status} and its connector is configured.` : skill.readiness.reason };
  }
  return { enabled: skill.status === 'ready', enabledReason: skill.status === 'ready' ? 'Parent skill is operational.' : skill.readiness.reason };
}

export function buildCapabilityToolRegistry(snapshot: SkillRegistrySnapshot): EdithCapabilityTool[] {
  const skills = new Map(snapshot.skills.map((skill) => [skill.id, skill]));
  return DEFINITIONS.map(({ enableRule = 'ready', ...definition }) => {
    const parent = skills.get(definition.skillId);
    if (!parent) {
      return {
        ...definition,
        enabled: false,
        enabledReason: 'Parent skill is not registered.',
        lastChecked: snapshot.checkedAt,
      };
    }
    const state = enabledFor(parent, enableRule);
    return { ...definition, ...state, lastChecked: snapshot.checkedAt };
  });
}

export function listToolsForSkill(snapshot: SkillRegistrySnapshot, skillId: EdithSkillId): EdithCapabilityTool[] {
  return buildCapabilityToolRegistry(snapshot).filter((tool) => tool.skillId === skillId);
}
