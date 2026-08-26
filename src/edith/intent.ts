export type EdithIntentKind = 'conversation' | 'task_objective' | 'tool_execution';

export interface EdithIntentToolRoute {
  toolId: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface EdithIntentDecision {
  kind: EdithIntentKind;
  confidence: number;
  originalText: string;
  normalizedText: string;
  requiresTask: boolean;
  requiresPlanning: boolean;
  route?: EdithIntentToolRoute;
  rationale: string;
}

function stripCommandNoise(text: string): string {
  return text
    .replace(/\b(lütfen|please|edith|jarvis|şunu|bunu|bir|bi)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuotedText(text: string): string | undefined {
  const match = text.match(/["“”'‘’](.+?)["“”'‘’]/);
  return match?.[1]?.trim();
}

function routeDecision(params: {
  originalText: string;
  normalizedText: string;
  confidence: number;
  requiresTask?: boolean;
  requiresPlanning?: boolean;
  route: EdithIntentToolRoute;
  rationale: string;
}): EdithIntentDecision {
  return {
    kind: params.requiresTask ? 'task_objective' : 'tool_execution',
    confidence: params.confidence,
    originalText: params.originalText,
    normalizedText: params.normalizedText,
    requiresTask: Boolean(params.requiresTask),
    requiresPlanning: Boolean(params.requiresPlanning),
    route: params.route,
    rationale: params.rationale,
  };
}

export class IntentService {
  understand(message: string): EdithIntentDecision {
    const originalText = message.trim();
    const normalizedText = originalText.toLocaleLowerCase('tr-TR');
    const quoted = extractQuotedText(originalText);

    if (!originalText) {
      return {
        kind: 'conversation',
        confidence: 1,
        originalText,
        normalizedText,
        requiresTask: false,
        requiresPlanning: false,
        rationale: 'Empty message is treated as conversation/no-op.',
      };
    }

    const wantsTask =
      /\b(görev|task|planla|takibe al|yapılacak|todo|hatırla ve yap|sonra yap)\b/i.test(normalizedText) &&
      !/\b(skill|tool|araç)\b/i.test(normalizedText);
    if (wantsTask) {
      const objective = quoted || stripCommandNoise(originalText);
      const complexObjective =
        /\b(planla|araştır|hazırla|rapor|analiz|birden fazla|adım|sonra|takibe al)\b/i.test(normalizedText);
      return routeDecision({
        originalText,
        normalizedText,
        confidence: 0.86,
        requiresTask: true,
        requiresPlanning: complexObjective,
        route: {
          toolId: 'task_create',
          args: {
            title: objective.slice(0, 80) || 'EDITH Task',
            objective,
            originalUserRequest: originalText,
          },
          summary: `Görev oluşturuyorum: ${objective.slice(0, 120)}`,
        },
        rationale: 'User asked for a durable task/objective.',
      });
    }

    const wantsSkillCatalog =
      /\b(skill\w*|tool\w*|araç\w*|yetenek\w*|katalog\w*|neler yapabiliyorsun)\b/i.test(normalizedText) &&
      /\b(listele|göster|say|ne var|catalog|katalog)\b/i.test(normalizedText);
    if (wantsSkillCatalog) {
      return routeDecision({
        originalText,
        normalizedText,
        confidence: 0.83,
        route: {
          toolId: 'ai_skill_catalog',
          args: {},
          summary: 'EDITH skill kataloğunu listeliyorum.',
        },
        rationale: 'User asked to inspect available tools/capabilities.',
      });
    }

    const wantsSystem =
      /\b(sistem|bilgisayar|pc|cpu|ram|bellek|performans|durum)\b/i.test(normalizedText) &&
      /\b(durum|bak|göster|kontrol|kaç|nasıl)\b/i.test(normalizedText);
    if (wantsSystem) {
      return routeDecision({
        originalText,
        normalizedText,
        confidence: 0.82,
        route: {
          toolId: 'system_monitor',
          args: {},
          summary: 'Sistem durumunu kontrol ediyorum.',
        },
        rationale: 'User asked for local system status.',
      });
    }

    const urlMatch = originalText.match(/\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
    const wantsOpen =
      /(tarayıcı|browser|chrome|edge|firefox|site|url)/i.test(normalizedText) &&
      /(aç|git|open|navigate|ziyaret)/i.test(normalizedText);
    if (wantsOpen && urlMatch?.[0]) {
      return routeDecision({
        originalText,
        normalizedText,
        confidence: 0.84,
        route: {
          toolId: 'browser_open',
          args: { url: urlMatch[0] },
          summary: `Tarayıcıda açıyorum: ${urlMatch[0]}`,
        },
        rationale: 'User asked to open a specific URL.',
      });
    }

    const wantsSearch =
      /\b(araştır|ara|search|google|bak|bul|webde|internette|tarayıcıda)\b/i.test(normalizedText) &&
      !/\b(dosyada|klasörde|local dosya)\b/i.test(normalizedText);
    if (wantsSearch) {
      const query = quoted ||
        stripCommandNoise(originalText)
          .replace(/\b(tarayıcıda|tarayıcı|chrome|google|internette|webde|web|araştır|ara|search|bak|bul|hakkında)\b/gi, ' ')
          .replace(/\bbrowser\b(?!-)/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      if (query.length >= 2) {
        return routeDecision({
          originalText,
          normalizedText,
          confidence: 0.76,
          route: {
            toolId: 'browser_search',
            args: { query },
            summary: `Tarayıcıda arıyorum: ${query}`,
          },
          rationale: 'User asked for a web search.',
        });
      }
    }

    return {
      kind: 'conversation',
      confidence: 0.62,
      originalText,
      normalizedText,
      requiresTask: false,
      requiresPlanning: false,
      rationale: 'No actionable tool/task intent matched; route to model conversation.',
    };
  }
}

export const intentService = new IntentService();
