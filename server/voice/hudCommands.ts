import type {HudPresentationV1} from '../../src/edith/taskHudContracts';

/** Frozen whole-command phrases; never infer a command from a substring. */
export function classifyHudCommand(text: unknown): HudPresentationV1['action'] | undefined {
  if (typeof text !== 'string' || text.length > 2_000) return undefined;
  const command = text.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/[.!?]+$/, '');
  if (['jarvis ne yapıyorsun','jarvis ne yapiyorsun','ne yapıyorsun','ne yapiyorsun'].includes(command)) return 'show_current';
  if (['paneli kapat','jarvis paneli kapat'].includes(command)) return 'hide';
  return undefined;
}
