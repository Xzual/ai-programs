import rawAssistantProfiles from './assistantProfiles.json';
import { AssistantPersona, AssistantProfile } from '../types';

export const assistantProfiles = rawAssistantProfiles as AssistantProfile[];
export const DEFAULT_ASSISTANT_ID: AssistantPersona = 'jarvis';

export function isAssistantPersona(value: unknown): value is AssistantPersona {
  return assistantProfiles.some((profile) => profile.id === value);
}

export function getAssistantProfile(id: unknown): AssistantProfile {
  return assistantProfiles.find((profile) => profile.id === id) ??
    assistantProfiles.find((profile) => profile.id === DEFAULT_ASSISTANT_ID) ??
    assistantProfiles[0];
}

export function applyAssistantTheme(profile: AssistantProfile, root: HTMLElement = document.documentElement): void {
  const tokens = profile.themeTokens;
  root.style.setProperty('--edith-primary', tokens.primary);
  root.style.setProperty('--edith-secondary', tokens.secondary);
  root.style.setProperty('--edith-accent', tokens.accent);
  root.style.setProperty('--edith-bg', tokens.background);
  root.style.setProperty('--edith-surface', tokens.surface);
  root.style.setProperty('--edith-text', tokens.text);
  root.style.setProperty('--assistant-primary', tokens.primary);
  root.style.setProperty('--assistant-secondary', tokens.secondary);
  root.style.setProperty('--assistant-accent', tokens.accent);
  root.style.setProperty('--assistant-glow', tokens.glow);
  root.style.setProperty('--assistant-bg-tint', tokens.bgTint);
  root.style.setProperty('--assistant-core', tokens.core);
  root.style.setProperty('--assistant-notification', tokens.notification);
}
