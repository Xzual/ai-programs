import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { edithToolRegistry, executeEdithTool } from "./src/edith/serverRegistry";
import { listExternalSkillProjects } from "./src/edith/skills/catalog";
import { readRecentAuditEvents } from "./src/edith/audit";
import { createStoredTask, listTasks, updateTaskStatus } from "./src/edith/taskStore";
import { getEdithPersistenceStore } from "./src/edith/persistence";

const app = express();
const PORT = 3000;

app.use(express.json());

app.post("/api/voice/tts", async (req, res) => {
  const { text, apiKey, voiceId = "pNInz6obpgDQGcFmaJgB" } = req.body ?? {};
  if (!text || !apiKey) {
    return res.status(400).json({
      success: false,
      error: "text and apiKey are required for Claude Voice connector.",
    });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: String(text).slice(0, 4500),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      return res.status(response.status).send(await response.text());
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize Gemini API client lazily if key exists
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error("Gemini init error:", err);
    return null;
  }
}

// 1. Health & Connection Diagnostic
app.get("/api/health", async (req, res) => {
  const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
  let ollamaConnected = false;
  let availableModels: string[] = [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      ollamaConnected = true;
      availableModels = (data.models || []).map((m) => m.name);
    }
  } catch (err) {
    ollamaConnected = false;
  }

  const geminiClient = getGeminiClient();

  res.json({
    status: "ok",
    ollamaConnected,
    ollamaUrl,
    availableModels,
    geminiAvailable: !!geminiClient,
    timestamp: Date.now(),
  });
});

app.get("/api/edith/tools", (_req, res) => {
  res.json({
    success: true,
    tools: edithToolRegistry.list(),
  });
});

app.get("/api/edith/skill-catalog", (_req, res) => {
  res.json({
    success: true,
    projects: listExternalSkillProjects(),
  });
});

app.get("/api/edith/audit", (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json({
    success: true,
    events: readRecentAuditEvents(Number.isFinite(limit) ? limit : 100),
  });
});

app.get("/api/edith/persistence", (_req, res) => {
  const store = getEdithPersistenceStore();
  res.json({
    success: true,
    kind: store.kind,
    paths: store.getPaths(),
  });
});

app.get("/api/edith/tasks", (_req, res) => {
  res.json({
    success: true,
    tasks: listTasks(),
  });
});

app.post("/api/edith/tasks", (req, res) => {
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
  const task = createStoredTask({
    title,
    objective,
    originalUserRequest,
    toolsRequired,
    permissionsRequired,
    riskLevel,
  });
  res.json({ success: true, task });
});

app.patch("/api/edith/tasks/:id/status", (req, res) => {
  const task = updateTaskStatus(req.params.id, req.body?.status, req.body?.result);
  if (!task) return res.status(404).json({ success: false, error: "Task not found." });
  res.json({ success: true, task });
});

app.get("/api/edith/memories", (_req, res) => {
  const store = getEdithPersistenceStore();
  res.json({
    success: true,
    memories: store.listMemories?.() ?? [],
  });
});

app.post("/api/edith/memories", (req, res) => {
  const store = getEdithPersistenceStore();
  if (!store.upsertMemory) {
    return res.status(501).json({ success: false, error: "Memory persistence is unavailable." });
  }

  const { category = "custom", key, value, isSensitive = false } = req.body ?? {};
  if (!key || !value) {
    return res.status(400).json({ success: false, error: "key and value are required." });
  }

  const memory = {
    id: req.body?.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    key,
    value,
    createdAt: Number(req.body?.createdAt ?? Date.now()),
    isSensitive: Boolean(isSensitive),
  };
  store.upsertMemory(memory);
  res.json({ success: true, memory });
});

type ChatToolRoute = {
  toolId: string;
  args: Record<string, unknown>;
  summary: string;
};

function stripCommandNoise(text: string): string {
  return text
    .replace(/\b(lütfen|please|edith|aura|jarvis|şunu|bunu|bir|bi)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedText(text: string): string | undefined {
  const match = text.match(/["“”'‘’](.+?)["“”'‘’]/);
  return match?.[1]?.trim();
}

function routeChatToolIntent(message: string): ChatToolRoute | null {
  const text = message.trim();
  const lower = text.toLocaleLowerCase("tr-TR");
  const quoted = extractQuotedText(text);

  const wantsTask =
    /\b(görev|task|planla|takibe al|yapılacak|todo|hatırla ve yap|sonra yap)\b/i.test(lower) &&
    !/\b(skill|tool|araç)\b/i.test(lower);
  if (wantsTask) {
    const objective = quoted || stripCommandNoise(text);
    return {
      toolId: "task_create",
      args: {
        title: objective.slice(0, 80) || "EDITH Task",
        objective,
        originalUserRequest: text,
      },
      summary: `Görev oluşturuyorum: ${objective.slice(0, 120)}`,
    };
  }

  const wantsSkillCatalog =
    /\b(skill|tool|araç|yetenek|katalog|neler yapabiliyorsun)\b/i.test(lower) &&
    /\b(listele|göster|say|ne var|catalog|katalog)\b/i.test(lower);
  if (wantsSkillCatalog) {
    return {
      toolId: "ai_skill_catalog",
      args: {},
      summary: "EDITH skill kataloğunu listeliyorum.",
    };
  }

  const wantsSystem =
    /\b(sistem|bilgisayar|pc|cpu|ram|bellek|performans|durum)\b/i.test(lower) &&
    /\b(durum|bak|göster|kontrol|kaç|nasıl)\b/i.test(lower);
  if (wantsSystem) {
    return {
      toolId: "system_monitor",
      args: {},
      summary: "Sistem durumunu kontrol ediyorum.",
    };
  }

  const urlMatch = text.match(/\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
  const wantsOpen =
    /\b(tarayıcı|browser|chrome|edge|firefox|site|url)\b/i.test(lower) &&
    /\b(aç|git|open|navigate|ziyaret)\b/i.test(lower);
  if (wantsOpen && urlMatch?.[0]) {
    return {
      toolId: "browser_open",
      args: { url: urlMatch[0] },
      summary: `Tarayıcıda açıyorum: ${urlMatch[0]}`,
    };
  }

  const wantsSearch =
    /\b(araştır|ara|search|google|bak|bul|webde|internette|tarayıcıda)\b/i.test(lower) &&
    !/\b(dosyada|klasörde|local dosya)\b/i.test(lower);
  if (wantsSearch) {
    let query = quoted;
    if (!query) {
      query = stripCommandNoise(text)
        .replace(/\b(tarayıcıda|tarayıcı|browser|chrome|google|internette|webde|web|araştır|ara|search|bak|bul|hakkında)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (query.length >= 2) {
      return {
        toolId: "browser_search",
        args: { query },
        summary: `Tarayıcıda arıyorum: ${query}`,
      };
    }
  }

  return null;
}

// 2. Ollama Models Proxy
app.get("/api/ollama/models", async (req, res) => {
  const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
    res.status(502).json({ error: "Ollama sunucusuna ulaşılamadı", models: [] });
  } catch (err) {
    res.json({
      error: "Ollama sunucusuna ulaşılamadı. Lütfen 'ollama serve' çalıştığından emin olun.",
      models: [
        { name: "llama3.2:latest", details: { family: "llama" } },
        { name: "qwen2.5:latest", details: { family: "qwen" } },
        { name: "mistral:latest", details: { family: "mistral" } },
        { name: "gemma2:latest", details: { family: "gemma" } },
      ],
      offline: true,
    });
  }
});

// 3. Streaming Chat Endpoint
app.post("/api/chat", async (req, res) => {
  const {
    messages,
    provider = "ollama",
    model = "llama3.2",
    ollamaUrl = "http://localhost:11434",
    temperature = 0.7,
    systemPrompt = "Sen AURA adında yerel çalışan futuristik bir AI asistanısın. Türkçe konuş ve yardımsever ol.",
    memories = [],
    userName = "Kullanıcı",
  } = req.body;

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Build full system prompt with user memories
  let fullSystem = `${systemPrompt}\nKullanıcı Adı: ${userName}.`;
  if (memories && memories.length > 0) {
    fullSystem += `\nKullanıcı Hakkında Bilinen Bellek Kayıtları:\n` +
      memories.map((m: any) => `- [${m.category}] ${m.key}: ${m.value}`).join("\n");
  }

  const lastUserMessage = [...messages].reverse().find((m: any) => m.sender === "user")?.text ?? "";
  const toolRoute = routeChatToolIntent(lastUserMessage);
  if (toolRoute) {
    sendEvent({ text: `${toolRoute.summary}\n`, done: false });
    const result = await executeEdithTool(toolRoute.toolId, toolRoute.args, {
      actor: "aura-chat-router",
    });
    if (result.success) {
      sendEvent({
        text: `\n✅ Tool çalıştı: ${toolRoute.toolId}\n\n${result.result ?? "İşlem tamamlandı."}`,
        done: false,
      });
    } else {
      sendEvent({
        text: `\n⚠️ Tool çalıştırılamadı: ${toolRoute.toolId}\n${result.error ?? "Bilinmeyen hata."}`,
        done: false,
      });
    }
    sendEvent({ done: true, toolId: toolRoute.toolId, auditEventId: result.auditEventId });
    return res.end();
  }

  // Attempt Ollama standard streaming if provider is ollama
  if (provider === "ollama") {
    try {
      const formattedMessages = [
        { role: "system", content: fullSystem },
        ...messages.map((m: any) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text,
        })),
      ];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          options: { temperature },
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (ollamaRes.ok && ollamaRes.body) {
        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          const lines = chunkText.split("\n").filter((l) => l.trim() !== "");

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                sendEvent({ text: parsed.message.content, done: false });
              }
              if (parsed.done) {
                sendEvent({ done: true });
              }
            } catch (e) {
              // Ignore line parse errors
            }
          }
        }
        return res.end();
      }
    } catch (err: any) {
      console.log("Ollama connection failed, falling back gracefully to Cloud/Mock mode...", err.message);
      sendEvent({
        warning: "Ollama local API unreachable. Switch to Gemini/Mock mode or start Ollama service.",
      });
    }
  }

  // Fallback 1: Gemini API
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const historyStr = messages
        .map((m: any) => `${m.sender === "user" ? "Kullanıcı" : "AURA"}: ${m.text}`)
        .join("\n");

      const fullPrompt = `${fullSystem}\n\nKonuşma Geçmişi:\n${historyStr}\n\nAURA (Türkçe yanıt ver):`;

      const resultStream = await gemini.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: fullPrompt,
      });

      for await (const chunk of resultStream) {
        if (chunk.text) {
          sendEvent({ text: chunk.text, done: false });
        }
      }
      sendEvent({ done: true });
      return res.end();
    } catch (geminiErr: any) {
      console.error("Gemini API error:", geminiErr);
    }
  }

  // Fallback 2: Intelligent Local AI Assistant Mock Engine
  const lastUserMsg = messages[messages.length - 1]?.text || "Merhaba";
  const mockResponses = generateMockResponse(lastUserMsg, userName, memories);

  for (let i = 0; i < mockResponses.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 40));
    sendEvent({ text: mockResponses[i], done: false });
  }

  sendEvent({ done: true });
  res.end();
});

// Helper for realistic fallback assistant response generator
function generateMockResponse(prompt: string, userName: string, memories: any[]): string[] {
  const lower = prompt.toLowerCase();
  let fullText = "";

  if (lower.includes("merhaba") || lower.includes("selam")) {
    fullText = `Merhaba ${userName}! Ben AURA, yerel makinenizde çalışan futuristik AI asistanınızım. Size nasıl yardımcı olabilirim?`;
  } else if (lower.includes("dosya") || lower.includes("klasör")) {
    fullText = `Yerel dosya sisteminizdeki güvenli çalışma alanında kayıtlı dosyaları 'Automations' ekranından görüntüleyebilir veya analiz etmemi isteyebilirsiniz.`;
  } else if (lower.includes("hatırla") || lower.includes("bellek")) {
    fullText = `Anlaşıldı! Bu bilgiyi kişisel bellek sistemime ekliyorum. Memory ekranından tüm kayıtlı tercihlerinizi kontrol edebilirsiniz.`;
  } else if (lower.includes("kimsin") || lower.includes("aura")) {
    fullText = `Ben AURA (Automated Universal Responsive Assistant). Yerel makinenizde gizlilik odaklı çalışan, sesli ve metinsel etkileşim yeteneğine sahip kişisel yapay zekâ dashboard'uyum.`;
  } else {
    fullText = `Anladım "${prompt}". Bu isteğinizi yerel işleme yeteneklerimle değerlendiriyorum. Ollama veya Gemini servisleriniz bağlandığında daha kapsamlı model yanıtları alabilirsiniz.`;
  }

  // Split into small character chunks for natural typing animation
  const chunks: string[] = [];
  const words = fullText.split(" ");
  for (const word of words) {
    chunks.push(word + " ");
  }
  return chunks;
}

// 4. Tools Execution API — Mark-L skill'leri dahil genişletilmiş araç seti
app.post("/api/tools/execute", async (req, res) => {
  const { toolId, args = {} } = req.body;

  // ── Yardımcı: Gemini metin üretimi ──────────────────────────────────────
  async function geminiGenerate(prompt: string): Promise<string> {
    const gemini = getGeminiClient();
    if (!gemini) throw new Error("Gemini API anahtarı tanımlı değil.");
    const result = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return (result as any).text ?? JSON.stringify(result);
  }

  // ── Yardımcı: DuckDuckGo arama (fetch tabanlı) ───────────────────────────
  async function ddgSearch(query: string, max = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1`;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await r.json() as any;
      const results: Array<{ title: string; snippet: string; url: string }> = [];
      if (data.AbstractText) results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || "" });
      for (const rel of (data.RelatedTopics || []).slice(0, max - 1)) {
        if (rel.Text) results.push({ title: rel.Text.slice(0, 60), snippet: rel.Text, url: rel.FirstURL || "" });
      }
      return results;
    } catch {
      return [];
    }
  }

  // ── Yardımcı: os-benzeri sistem metrikleri (Node built-in) ───────────────
  function getSystemMetrics(): Record<string, any> {
    const os = require("os") as typeof import("os");
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptime = os.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpu: { model: cpus[0]?.model ?? "N/A", cores: cpus.length },
      memory: {
        total: `${(totalMem / 1024 ** 3).toFixed(1)} GB`,
        used: `${(usedMem / 1024 ** 3).toFixed(1)} GB`,
        free: `${(freeMem / 1024 ** 3).toFixed(1)} GB`,
        usagePercent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
      },
      uptime: `${h}s ${m}d`,
      nodeVersion: process.version,
    };
  }

  const edithTool = edithToolRegistry.get(toolId);
  if (edithTool) {
    const result = await executeEdithTool(toolId, args as Record<string, unknown>, {
      actor: "aura-dashboard",
    });
    return res.status(result.success ? 200 : 403).json(result);
  }

  switch (toolId) {

    // ════════════════════════════════════════════════════════════════════════
    // MEVCUT ARAÇLAR
    // ════════════════════════════════════════════════════════════════════════

    case "list_dir": {
      const dirPath = args.path || "/workspace/documents";
      return res.json({
        success: true,
        toolId,
        result: JSON.stringify({
          path: dirPath,
          files: [
            { name: "notlar.txt",       type: "file",      size: "2.4 KB",  modified: "2026-08-12" },
            { name: "proje_ozeti.md",   type: "file",      size: "14.1 KB", modified: "2026-08-11" },
            { name: "veri_analizi.csv", type: "file",      size: "88.0 KB", modified: "2026-08-10" },
            { name: "yedekler",         type: "directory", items: 3,        modified: "2026-08-01" },
          ],
        }, null, 2),
      });
    }

    case "read_file": {
      const fileName = args.fileName || "notlar.txt";
      return res.json({
        success: true, toolId,
        result: `[OKUNDU: ${fileName}]\n\nAURA Sistem Notları:\n- Yerel Ollama LLM yapılandırması tamamlandı.\n- Bellek ve ses modülleri aktif.\n- Güvenli araç izinleri kullanıcı onayına bağlıdır.`,
      });
    }

    case "export_markdown": {
      return res.json({
        success: true, toolId,
        result: `# AURA Sohbet Özeti\n\nTarih: ${new Date().toLocaleString("tr-TR")}\n\n## Özet\nSohbet oturumu başarıyla Markdown formatında dışa aktarıldı.`,
      });
    }

    case "schedule_reminder": {
      const text = args.reminderText || "AURA Görev Takibi";
      const time = args.time || "10 dakika sonra";
      return res.json({
        success: true, toolId,
        result: `✅ Zamanlanmış Hatırlatıcı Oluşturuldu\n\nMesaj : "${text}"\nZaman : ${time}\nDurum : Aktif`,
      });
    }

    case "summarize_analytics": {
      return res.json({
        success: true, toolId,
        result: JSON.stringify({
          toplamSohbet: 42,
          toplamIstem: 189,
          ortalamaYanitSuresi: "1.2s",
          kullanilanModel: "llama3.2 (Yerel)",
          bellekOgesiSayisi: 8,
        }, null, 2),
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // MARK-L'DEN GELEN YENİ SKILL'LER
    // ════════════════════════════════════════════════════════════════════════

    // ── WEB SEARCH ──────────────────────────────────────────────────────────
    case "web_search": {
      const query  = (args.query || "").trim();
      const mode   = (args.mode  || "search").toLowerCase();
      if (!query) return res.json({ success: false, error: "Arama sorgusu boş olamaz." });

      try {
        let result = "";

        if (mode === "research") {
          // Gemini grounded research
          result = await geminiGenerate(
            `Comprehensive, detailed explanation of: "${query}". Include key facts, background context, and current state. Respond in Turkish.`
          );
        } else if (mode === "news") {
          // Gemini ile güncel haber
          try {
            result = await geminiGenerate(`Latest news today about: "${query}". Return 5 recent headlines with brief descriptions. Respond in Turkish.`);
          } catch {
            const hits = await ddgSearch(`${query} news`, 6);
            result = hits.length
              ? hits.map((h, i) => `${i + 1}. **${h.title}**\n   ${h.snippet}\n   ${h.url}`).join("\n\n")
              : `"${query}" için haber bulunamadı.`;
          }
        } else if (mode === "price") {
          result = await geminiGenerate(`Current price of "${query}" — how much does it cost today? Give specific prices if available. Respond in Turkish.`);
        } else if (mode === "compare") {
          const items = Array.isArray(args.items) && args.items.length ? args.items : [query];
          result = await geminiGenerate(`Compare these items: ${items.join(" vs ")}. Give key differences, pros/cons. Respond in Turkish.`);
        } else {
          // Default search — try Gemini first, DDG fallback
          try {
            result = await geminiGenerate(`Answer this search query in detail: "${query}". Be factual and concise. Respond in Turkish.`);
          } catch {
            const hits = await ddgSearch(query, 6);
            if (hits.length) {
              result = `🔍 "${query}" için arama sonuçları:\n\n` +
                hits.map((h, i) => `${i + 1}. **${h.title}**\n   ${h.snippet}\n   ${h.url}`).join("\n\n");
            } else {
              result = `Arama başarısız. Gemini API anahtarını kontrol edin veya farklı bir sorgu deneyin.`;
            }
          }
        }

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Arama hatası: ${e.message}` });
      }
    }

    // ── SYSTEM MONITOR ──────────────────────────────────────────────────────
    case "system_monitor": {
      try {
        const metrics = getSystemMetrics();
        return res.json({
          success: true, toolId,
          result: JSON.stringify(metrics, null, 2),
        });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Sistem metrikleri alınamadı: ${e.message}` });
      }
    }

    // ── WEATHER REPORT ──────────────────────────────────────────────────────
    case "weather_report": {
      const city = (args.city || "Istanbul").trim();
      const lang = args.lang || "tr";
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        const wttrRes = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=${lang}`,
          { signal: ctrl.signal }
        );
        clearTimeout(tid);

        if (wttrRes.ok) {
          const data = await wttrRes.json() as any;
          const cur  = data.current_condition?.[0] ?? {};
          const area = data.nearest_area?.[0];
          const loc  = area?.areaName?.[0]?.value ?? city;
          const country = area?.country?.[0]?.value ?? "";
          const desc = (lang === "tr"
            ? cur.lang_tr?.[0]?.value
            : cur.weatherDesc?.[0]?.value) ?? "Bilinmiyor";
          const tempC     = cur.temp_C      ?? "?";
          const feelsLike = cur.FeelsLikeC  ?? "?";
          const humidity  = cur.humidity    ?? "?";
          const wind      = cur.windspeedKmph ?? "?";
          const uv        = cur.uvIndex      ?? "?";

          const tomorrow = data.weather?.[1];
          const tomorrowHigh = tomorrow?.maxtempC ?? "?";
          const tomorrowLow  = tomorrow?.mintempC ?? "?";
          const tomorrowDesc = (lang === "tr"
            ? tomorrow?.hourly?.[4]?.lang_tr?.[0]?.value
            : tomorrow?.hourly?.[4]?.weatherDesc?.[0]?.value) ?? "";

          const result =
`📍 ${loc}, ${country}
🌡️  Sıcaklık    : ${tempC}°C  (Hissedilen: ${feelsLike}°C)
☁️  Durum       : ${desc}
💧 Nem          : %${humidity}
💨 Rüzgar       : ${wind} km/s
☀️  UV İndeksi  : ${uv}

📅 Yarın: ${tomorrowLow}°C – ${tomorrowHigh}°C${tomorrowDesc ? `  ${tomorrowDesc}` : ""}`;

          return res.json({ success: true, toolId, result });
        }
        throw new Error(`wttr.in HTTP ${wttrRes.status}`);
      } catch (e: any) {
        // Fallback: Gemini ile hava durumu
        try {
          const result = await geminiGenerate(`What is the current weather in ${city}? Give temperature, conditions, and tomorrow's forecast. Respond in Turkish.`);
          return res.json({ success: true, toolId, result });
        } catch {
          return res.json({ success: false, toolId, error: `Hava durumu alınamadı: ${e.message}` });
        }
      }
    }

    // ── FILE PROCESSOR ──────────────────────────────────────────────────────
    case "file_processor": {
      const filePath   = (args.file_path || "").trim();
      const action     = (args.action || "summarize").toLowerCase();
      const instruction = args.instruction || "";

      if (!filePath) return res.json({ success: false, error: "Dosya yolu boş olamaz." });

      try {
        const fs   = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");

        if (!fs.existsSync(filePath)) {
          return res.json({ success: false, toolId, error: `Dosya bulunamadı: ${filePath}` });
        }

        const ext  = path.extname(filePath).toLowerCase().replace(".", "");
        const stat = fs.statSync(filePath);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

        // Metin tabanlı dosyalar — doğrudan oku + Gemini
        const textExts = ["txt", "md", "rst", "log", "csv", "json", "xml", "html", "css", "js", "ts", "py", "java", "cs", "go", "rs", "rb", "php"];
        const codeExts = ["py", "js", "ts", "jsx", "tsx", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "ps1", "sql"];

        if (textExts.includes(ext)) {
          const MAX_CHARS = 12000;
          const rawContent = fs.readFileSync(filePath, "utf-8").slice(0, MAX_CHARS);
          const isCode = codeExts.includes(ext);

          let prompt = "";
          if (instruction) {
            prompt = `${instruction}\n\nDosya içeriği (${ext.toUpperCase()}):\n\`\`\`\n${rawContent}\n\`\`\`\nTürkçe yanıt ver.`;
          } else {
            const actionPrompts: Record<string, string> = {
              summarize:    `Aşağıdaki ${isCode ? "kod" : "metin"} dosyasını Türkçe özetle:\n\n${rawContent}`,
              explain:      `Aşağıdaki kodu Türkçe satır satır açıkla:\n\n${rawContent}`,
              review:       `Aşağıdaki kodu incele, iyileştirme önerileri ve potansiyel hataları Türkçe listele:\n\n${rawContent}`,
              fix:          `Aşağıdaki koddaki hataları tespit et ve düzeltilmiş versiyonu yaz:\n\n${rawContent}`,
              word_count:   ``,
              extract_text: `Aşağıdaki içerikten tüm metni çıkar ve düzenle:\n\n${rawContent}`,
              analyze:      `Aşağıdaki veriyi detaylı analiz et, istatistikler ve önemli bulguları Türkçe sun:\n\n${rawContent}`,
              validate:     `Aşağıdaki ${ext.toUpperCase()} verisinin geçerliliğini kontrol et, hataları listele:\n\n${rawContent}`,
            };

            if (action === "word_count") {
              const words = rawContent.split(/\s+/).filter(Boolean).length;
              const chars = rawContent.length;
              const lines = rawContent.split("\n").length;
              return res.json({
                success: true, toolId,
                result: `📄 **${path.basename(filePath)}**\n\nKelime : ${words}\nKarakter: ${chars}\nSatır  : ${lines}\nBoyut  : ${sizeMB} MB`,
              });
            }

            prompt = actionPrompts[action] ?? `Bu dosyayı analiz et:\n\n${rawContent}`;
          }

          const aiResult = await geminiGenerate(prompt);
          return res.json({ success: true, toolId, result: `📄 **${path.basename(filePath)}** (${sizeMB} MB)\n\n${aiResult}` });
        }

        // İkili dosyalar — meta bilgi ver
        const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
        const pdfExts   = ["pdf"];
        const audioExts = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
        const videoExts = ["mp4", "avi", "mov", "mkv", "webm"];
        const archiveExts = ["zip", "rar", "tar", "gz", "7z"];

        if (imageExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🖼️ **${path.basename(filePath)}** — Görüntü Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Görüntü analizi (OCR/describe) için Gemini Vision API gereklidir. GEMINI_API_KEY tanımlıysa tam destek sağlanır.` });
        }
        if (pdfExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `📕 **${path.basename(filePath)}** — PDF Dosyası\nBoyut: ${sizeMB} MB\n\n⚠️ PDF özet/metin çıkarma için 'pdf-parse' npm paketi gereklidir: npm install pdf-parse` });
        }
        if (audioExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🎵 **${path.basename(filePath)}** — Ses Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Transkripsiyon için Whisper entegrasyonu gereklidir.` });
        }
        if (videoExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `🎬 **${path.basename(filePath)}** — Video Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Video işleme için ffmpeg kurulu olmalı.` });
        }
        if (archiveExts.includes(ext)) {
          return res.json({ success: true, toolId,
            result: `📦 **${path.basename(filePath)}** — Arşiv Dosyası\nBoyut: ${sizeMB} MB\nFormat: ${ext.toUpperCase()}\n\n⚠️ Arşiv işleme için uygun npm paketi gereklidir.` });
        }

        return res.json({ success: false, toolId, error: `Desteklenmeyen dosya türü: .${ext}` });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Dosya işleme hatası: ${e.message}` });
      }
    }

    // ── CODE HELPER ─────────────────────────────────────────────────────────
    case "code_helper": {
      const action      = (args.action || "write").toLowerCase();
      const description = (args.description || "").trim();
      const language    = args.language || "python";
      const filePath    = (args.file_path || "").trim();
      const code        = (args.code || "").trim();

      if (!description && !filePath && !code) {
        return res.json({ success: false, error: "Açıklama, dosya yolu veya kod girilmedi." });
      }

      try {
        let prompt = "";
        let existingCode = code;

        // Dosya varsa oku
        if (filePath && !existingCode) {
          try {
            const fs = require("fs") as typeof import("fs");
            if (fs.existsSync(filePath)) existingCode = fs.readFileSync(filePath, "utf-8").slice(0, 12000);
          } catch { /* ignore */ }
        }

        const prompts: Record<string, string> = {
          write:    `Write clean, well-commented ${language} code for: "${description}". Return only the code with a brief explanation in Turkish.`,
          edit:     `Edit this ${language} code as instructed: "${description}"\n\nCode:\n\`\`\`${language}\n${existingCode}\n\`\`\`\nReturn the improved code and explain changes in Turkish.`,
          explain:  `Explain this ${language} code in detail in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          review:   `Code review for this ${language} code. List bugs, improvements, security issues in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          fix:      `Fix all bugs and errors in this ${language} code. Return fixed code and list what was fixed in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          optimize: `Optimize this ${language} code for performance and readability. Return optimized code and explain changes in Turkish:\n\`\`\`${language}\n${existingCode || description}\n\`\`\``,
          run:      ``,
          build:    `Design and write a complete, working ${language} project for: "${description}". Include all necessary files and explain the structure in Turkish.`,
        };

        if (action === "run" && filePath) {
          // Dosyayı child_process ile çalıştır
          const { execFile } = require("child_process") as typeof import("child_process");
          const runners: Record<string, string> = {
            python: "python", javascript: "node", typescript: "npx ts-node", bash: "bash",
          };
          const runner = runners[language] || "python";
          const runnerArgs = language === "typescript" ? ["ts-node", filePath] : [filePath];
          const cmd = language === "typescript" ? "npx" : runner;

          return new Promise<void>((resolve) => {
            execFile(cmd, language === "typescript" ? runnerArgs : [filePath], { timeout: 30000 }, (err, stdout, stderr) => {
              const output = stdout || stderr || (err ? err.message : "Çıktı yok.");
              res.json({
                success: !err || !!stdout,
                toolId,
                result: `▶️ **Çalıştırıldı:** ${filePath}\n\n\`\`\`\n${output.slice(0, 4000)}\n\`\`\``,
              });
              resolve();
            });
          });
        }

        prompt = prompts[action] ?? `Help with this ${language} code request: "${description}"`;
        const aiResult = await geminiGenerate(prompt);
        return res.json({ success: true, toolId, result: aiResult });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Kod yardımcısı hatası: ${e.message}` });
      }
    }

    // ── DEV AGENT ───────────────────────────────────────────────────────────
    case "dev_agent": {
      const description = (args.description || "").trim();
      const language    = args.language || "python";
      const projectName = (args.project_name || "aura_project").trim().replace(/[^\w-]/g, "_");

      if (!description) return res.json({ success: false, error: "Proje açıklaması gereklidir." });

      try {
        // 1. Plan
        const planPrompt = `You are a senior software architect. Create a minimal project plan as JSON for:
Language: ${language}
Description: ${description}

Return ONLY valid JSON:
{
  "project_name": "snake_case_name",
  "entry_point": "main.py",
  "files": [
    { "path": "main.py", "description": "what it does", "imports": [] }
  ],
  "run_command": "python main.py",
  "dependencies": ["requests"]
}`;

        const planRaw = await geminiGenerate(planPrompt);
        const jsonMatch = planRaw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Plan JSON parse hatası");

        const plan = JSON.parse(jsonMatch[0]);
        const projName = plan.project_name || projectName;
        const files    = plan.files || [];
        const deps     = plan.dependencies || [];

        // 2. Her dosyayı yaz
        const os     = require("os") as typeof import("os");
        const fsNode = require("fs") as typeof import("fs");
        const pathNode = require("path") as typeof import("path");
        const projectDir = pathNode.join(os.homedir(), "Desktop", "AURAProjects", projName);
        fsNode.mkdirSync(projectDir, { recursive: true });

        const writtenFiles: string[] = [];
        for (const fileInfo of files.slice(0, 6)) {
          const writePrompt = `Write the complete ${language} code for file "${fileInfo.path}" in project: "${description}".
File description: ${fileInfo.description}
Return only the code, no explanations.`;
          const fileCode = await geminiGenerate(writePrompt);
          const cleanCode = fileCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "").trim();
          const fullPath = pathNode.join(projectDir, fileInfo.path);
          fsNode.mkdirSync(pathNode.dirname(fullPath), { recursive: true });
          fsNode.writeFileSync(fullPath, cleanCode, "utf-8");
          writtenFiles.push(fileInfo.path);
        }

        const result = `✅ **Proje Oluşturuldu: ${projName}**

📁 Konum : ${projectDir}
📄 Dosyalar : ${writtenFiles.join(", ")}
📦 Bağımlılıklar : ${deps.length ? deps.join(", ") : "Yok"}
▶️  Çalıştırma : ${plan.run_command}

${deps.length ? `💡 Kurulum için: pip install ${deps.join(" ")}` : ""}`;

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Dev Agent hatası: ${e.message}` });
      }
    }

    // ── YOUTUBE CONTROL ─────────────────────────────────────────────────────
    case "youtube_control": {
      const action = (args.action || "play").toLowerCase();
      const query  = (args.query || "").trim();

      if (!query) return res.json({ success: false, error: "Video/konu sorgusu gereklidir." });

      try {
        if (action === "play") {
          const encoded = encodeURIComponent(query);
          const ytUrl = `https://www.youtube.com/results?search_query=${encoded}`;
          return res.json({
            success: true, toolId,
            result: `▶️ YouTube arama açıldı: "${query}"\n\n🔗 ${ytUrl}\n\n💡 Bu linki tarayıcıda açarak videoyu izleyebilirsiniz.`,
          });
        }

        if (action === "trending") {
          const result = await geminiGenerate(`List the top 5 trending YouTube videos or topics right now in Turkey. For each give title and why it's trending. Respond in Turkish.`);
          return res.json({ success: true, toolId, result });
        }

        if (action === "summarize" || action === "get_info") {
          const result = await geminiGenerate(
            action === "summarize"
              ? `Summarize the content and key points of YouTube videos about: "${query}". If it's a specific video URL, summarize it. Respond in Turkish.`
              : `Provide information about YouTube videos related to: "${query}". Include typical duration, content type, popular channels. Respond in Turkish.`
          );
          return res.json({ success: true, toolId, result });
        }

        return res.json({ success: false, toolId, error: `Bilinmeyen YouTube aksiyonu: ${action}` });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `YouTube hatası: ${e.message}` });
      }
    }

    // ── BACKGROUND MONITOR ──────────────────────────────────────────────────
    case "background_monitor": {
      const action = (args.action || "list").toLowerCase();
      const topic  = (args.topic || "").trim();

      // Basit bellek dosyası: proje kökünde .aura_monitors.json
      const fsNode = require("fs") as typeof import("fs");
      const pathNode = require("path") as typeof import("path");
      const monitorsPath = pathNode.join(process.cwd(), ".aura_monitors.json");

      const loadMonitors = (): string[] => {
        try { return JSON.parse(fsNode.readFileSync(monitorsPath, "utf-8")); } catch { return []; }
      };
      const saveMonitors = (list: string[]) => {
        fsNode.writeFileSync(monitorsPath, JSON.stringify(list, null, 2), "utf-8");
      };

      const BLOCKED = ["crypto", "bitcoin", "ethereum", "borsa", "hisse", "forex", "trading"];
      const isBlocked = (t: string) => BLOCKED.some(b => t.toLowerCase().includes(b));

      if (action === "add") {
        if (!topic) return res.json({ success: false, error: "İzlenecek konu girilmedi." });
        if (isBlocked(topic)) return res.json({ success: false, error: "Kripto/finans konuları izleme listesine eklenemez." });
        const monitors = loadMonitors();
        if (monitors.includes(topic)) return res.json({ success: true, toolId, result: `"${topic}" zaten izleniyor.` });
        monitors.push(topic);
        saveMonitors(monitors);
        return res.json({ success: true, toolId, result: `✅ "${topic}" izleme listesine eklendi.\nToplam izlenen: ${monitors.length} konu.` });
      }

      if (action === "remove") {
        if (!topic) return res.json({ success: false, error: "Kaldırılacak konu girilmedi." });
        const monitors = loadMonitors().filter(m => m !== topic);
        saveMonitors(monitors);
        return res.json({ success: true, toolId, result: `🗑️ "${topic}" izleme listesinden kaldırıldı.` });
      }

      if (action === "list") {
        const monitors = loadMonitors();
        const result = monitors.length
          ? `👁️ **İzlenen Konular (${monitors.length})**\n\n${monitors.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
          : "İzlenen konu yok. Konu eklemek için 'add' aksiyonunu kullanın.";
        return res.json({ success: true, toolId, result });
      }

      if (action === "check") {
        const monitors = loadMonitors();
        if (!monitors.length) return res.json({ success: true, toolId, result: "İzlenecek konu bulunmuyor." });

        try {
          const checkPrompt = `Check for the latest news/developments on these topics: ${monitors.join(", ")}.
For each topic, give 1-2 new developments if any. Be concise. Respond in Turkish.`;
          const result = await geminiGenerate(checkPrompt);
          return res.json({ success: true, toolId, result: `🔔 **İzleme Raporu**\n\n${result}` });
        } catch (e: any) {
          return res.json({ success: false, toolId, error: `İzleme kontrolü başarısız: ${e.message}` });
        }
      }

      return res.json({ success: false, error: "Geçersiz aksiyon. add / remove / list / check seçin." });
    }

    // ── SCREEN PROCESSOR ────────────────────────────────────────────────────
    case "screen_processor": {
      const source   = (args.source || "screen").toLowerCase();
      const question = args.question || "Ne görüyorsun?";

      try {
        if (source === "camera") {
          // Webcam erişimi sunucu tarafında kısıtlı — browser'a yönlendir
          return res.json({
            success: true, toolId,
            result: `📷 **Kamera Analizi**\n\nKamera erişimi için tarayıcı API'si gereklidir.\n\n💡 Sohbet ekranında kameranızı açıp görüntüyü sürükleyip bırakabilirsiniz. Gemini Vision ile analiz edilecektir.\n\nSoru: "${question}"`,
          });
        }

        // Ekran görüntüsü alma girişimi (screenshot-desktop paketi yoksa bilgi mesajı)
        try {
          const screenshot = require("screenshot-desktop");
          const imgBuffer = await screenshot({ format: "png" }) as Buffer;
          const base64 = imgBuffer.toString("base64");

          // Gemini Vision ile analiz et
          const gemini = getGeminiClient();
          if (!gemini) {
            return res.json({ success: true, toolId, result: `🖥️ Ekran görüntüsü alındı (${(imgBuffer.length / 1024).toFixed(1)} KB). Analiz için GEMINI_API_KEY gereklidir.` });
          }

          const result = await (gemini as any).models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              { role: "user", parts: [
                { text: question },
                { inlineData: { mimeType: "image/png", data: base64 } }
              ]}
            ],
          });

          const text = (result as any).text ?? "Görüntü analiz edildi.";
          return res.json({ success: true, toolId, result: `🖥️ **Ekran Analizi**\n\n${text}` });
        } catch {
          // screenshot-desktop yoksa
          return res.json({
            success: true, toolId,
            result: `🖥️ **Ekran Analizi**\n\nEkran yakalama için 'screenshot-desktop' paketi gereklidir:\nnpm install screenshot-desktop\n\nKurulduktan sonra bu araç ekranınızı gerçek zamanlı analiz edebilir.\n\nSoru: "${question}"`,
          });
        }
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Ekran işleme hatası: ${e.message}` });
      }
    }

    // ── FLIGHT FINDER ───────────────────────────────────────────────────────
    case "flight_finder": {
      const origin      = (args.origin || "").toUpperCase().trim();
      const destination = (args.destination || "").toUpperCase().trim();
      const date        = (args.date || "").trim();
      const returnDate  = (args.return_date || "").trim();
      const cabin       = args.cabin || "economy";
      const passengers  = args.passengers || 1;

      if (!origin || !destination || !date) {
        return res.json({ success: false, error: "Kalkış, varış ve tarih bilgisi gereklidir." });
      }

      try {
        // Google Flights URL oluştur
        const cabinMap: Record<string, string> = { economy: "1", premium_economy: "2", business: "3", first: "4" };
        const cabinCode = cabinMap[cabin] || "1";
        const gFlightsUrl = returnDate
          ? `https://www.google.com/travel/flights?q=Flights+from+${origin}+to+${destination}+on+${date}+returning+${returnDate}`
          : `https://www.google.com/travel/flights?q=Flights+from+${origin}+to+${destination}+on+${date}`;

        // Gemini ile uçuş bilgisi
        const flightPrompt = `Find flight information for:
- From: ${origin}
- To: ${destination}  
- Date: ${date}${returnDate ? `\n- Return: ${returnDate}` : ""}
- Cabin: ${cabin}
- Passengers: ${passengers}

Provide typical flight duration, airlines that usually operate this route, approximate price range in USD/TRY, and any layover information. Respond in Turkish.`;

        const aiResult = await geminiGenerate(flightPrompt);

        const result = `✈️ **Uçuş Arama: ${origin} → ${destination}**
📅 Tarih: ${date}${returnDate ? ` | Dönüş: ${returnDate}` : ""}
💺 Kabin: ${cabin} | 👤 Yolcu: ${passengers}

${aiResult}

🔗 **Google Flights'ta Gerçek Fiyatlar:**
${gFlightsUrl}`;

        return res.json({ success: true, toolId, result });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Uçuş arama hatası: ${e.message}` });
      }
    }

    // ── BROWSER CONTROL ─────────────────────────────────────────────────────
    case "browser_control": {
      const action = (args.action || "open").toLowerCase();
      const url    = (args.url || "").trim();
      const query  = (args.query || "").trim();

      try {
        if (action === "open" && url) {
          // OS'ta varsayılan tarayıcıda aç
          const { exec } = require("child_process") as typeof import("child_process");
          const os = require("os") as typeof import("os");
          const platform = os.platform();
          const openCmd = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;

          return new Promise<void>((resolve) => {
            exec(openCmd, (err) => {
              res.json({
                success: !err,
                toolId,
                result: err
                  ? `⚠️ Tarayıcı açılamadı: ${err.message}\n🔗 Manuel olarak açın: ${url}`
                  : `🌐 Tarayıcıda açıldı: ${url}`,
              });
              resolve();
            });
          });
        }

        if (action === "search" && query) {
          const { exec } = require("child_process") as typeof import("child_process");
          const os = require("os") as typeof import("os");
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          const platform = os.platform();
          const openCmd = platform === "win32" ? `start "" "${searchUrl}"` : platform === "darwin" ? `open "${searchUrl}"` : `xdg-open "${searchUrl}"`;

          return new Promise<void>((resolve) => {
            exec(openCmd, (err) => {
              res.json({
                success: !err,
                toolId,
                result: err
                  ? `⚠️ Tarayıcı açılamadı\n🔗 Link: ${searchUrl}`
                  : `🔍 Google'da arandı: "${query}"\n🔗 ${searchUrl}`,
              });
              resolve();
            });
          });
        }

        if (action === "screenshot") {
          return res.json({
            success: true, toolId,
            result: `📸 Tarayıcı ekran görüntüsü için 'screen_processor' aracını kullanın.\n\nTam tarayıcı otomasyonu için Playwright kurulumu önerilir:\nnpm install playwright`,
          });
        }

        return res.json({ success: false, error: "URL veya arama sorgusu girilmedi." });
      } catch (e: any) {
        return res.json({ success: false, toolId, error: `Tarayıcı kontrol hatası: ${e.message}` });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    default:
      return res.status(400).json({ success: false, error: `Bilinmeyen araç ID'si: ${toolId}` });
  }
});

// Start Express Server with Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AURA Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
