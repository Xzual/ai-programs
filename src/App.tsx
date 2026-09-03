import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { BootScreen } from './components/layout/BootScreen';
import { DesktopTitleBar } from './components/layout/DesktopTitleBar';
import { DashboardView } from './components/views/DashboardView';
import { ChatConsoleView } from './components/views/ChatConsoleView';
import { MemoryView } from './components/views/MemoryView';
import { AutomationsView } from './components/views/AutomationsView';
import { IntegrationsView } from './components/views/IntegrationsView';
import { SettingsView } from './components/views/SettingsView';
import { CodeChatView } from './components/views/CodeChatView';
import { EdithOpsView } from './components/views/EdithOpsView';
import { KnowledgeMapView } from './components/views/KnowledgeMapView';
import { Studio3DView } from './components/views/Studio3DView';
import { ProactiveView } from './components/views/ProactiveView';
import { CryptoView } from './components/views/CryptoView';
import { ThemeTransition } from './components/effects/ThemeTransition';
import { OllamaGuideModal } from './components/modals/OllamaGuideModal';
import { LoginScreen } from './components/auth/LoginScreen';
import { invokeDesktopCommand } from './edith/desktopShell';
import { fetchProviderHealth, fetchProviderProfiles, fallbackProviderProfiles, selectValidModelForProvider } from './edith/providerService';
import {
  AgentsScreen,
  AutomationsMissionScreen,
  BrowserResearchScreen,
  ComputerUseScreen,
  ContextPanel,
  FilesScreen,
  KnowledgeGraphScreen,
  MemoryBrainScreen,
  SecurityCenterScreen,
  SettingsArchitectureScreen,
  SystemHealthScreen,
  TasksScreen,
  ToolsRegistryScreen,
  TradingScreen,
  VoiceScreen,
} from './components/ui/edithOS';
import { applyAssistantTheme, assistantProfiles, getAssistantProfile } from './config/assistantProfileRegistry';
import {
  clearAuthSession,
  loadAuthSession,
  loadSettings,
  saveAuthSession,
  saveSettings,
  loadSessions,
  saveSessions,
  loadCodeSession,
  saveCodeSession,
  DEFAULT_CODE_INITIAL_MESSAGE,
  loadMemories,
  saveMemories,
  loadToolLogs,
  saveToolLogs,
  loadIntegrations,
  saveIntegrations,
  DEFAULT_TOOLS,
  DEFAULT_INITIAL_MESSAGE,
  mergeRegistryTools,
  type RegistryToolDefinition,
} from './lib/storage';
import {
  AiState,
  ChatMessage,
  ChatSession,
  MemoryItem,
  UserSettings,
  AutomationTool,
  ToolExecutionLog,
  IntegrationConfig,
  MemoryCategory,
  EdithAuthSession,
  ProviderHealthSnapshot,
  ProviderProfile,
  AiProvider,
  ProviderRuntimeStatus,
} from './types';

export default function App() {
  // Main State
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [settings, setSettings] = useState<UserSettings>(loadSettings());
  const [authSession, setAuthSession] = useState<EdithAuthSession | null>(loadAuthSession());
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions());
  const [codeSession, setCodeSession] = useState<ChatSession>(loadCodeSession());
  const [activeSessionId, setActiveSessionId] = useState<string>('session-default');
  const [memories, setMemories] = useState<MemoryItem[]>(loadMemories());
  // Tool state: DEFAULT_TOOLS her zaman güncel araç listesini içerir.
  // Eğer kullanıcı daha önce araç durumlarını değiştirdiyse (requiresConfirmation, lastRun, status)
  // o tercihleri birleştiriyoruz; böylece yeni araçlar eklendikten sonra da görünür kalır.
  const [tools, setTools] = useState<AutomationTool[]>(() => {
    try {
      const legacyToolStateKey = `${['au', 'ra'].join('')}_tool_states_v1`;
      const saved = localStorage.getItem('edith_tool_states_v1') ?? localStorage.getItem(legacyToolStateKey);
      if (!saved) return DEFAULT_TOOLS;
      const savedStates: Record<string, Partial<AutomationTool>> = JSON.parse(saved);
      return DEFAULT_TOOLS.map((t) =>
        savedStates[t.id]
          ? { ...t, requiresConfirmation: savedStates[t.id].requiresConfirmation ?? t.requiresConfirmation, lastRun: savedStates[t.id].lastRun, status: savedStates[t.id].status ?? t.status }
          : t
      );
    } catch {
      return DEFAULT_TOOLS;
    }
  });
  const [logs, setLogs] = useState<ToolExecutionLog[]>(loadToolLogs());
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>(loadIntegrations());

  // System & Connection State
  const [aiState, setAiState] = useState<AiState>('idle');
  const [ollamaConnected, setOllamaConnected] = useState<boolean>(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealthSnapshot>({
    ollamaConnected: false,
    geminiAvailable: false,
    availableModels: [],
    source: 'placeholder',
  });
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(() => fallbackProviderProfiles());
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [showOllamaModal, setShowOllamaModal] = useState<boolean>(false);
  const [bootComplete, setBootComplete] = useState<boolean>(false);
  const [activeSpeakingId, setActiveSpeakingId] = useState<string | null>(null);
  const [themeTransition, setThemeTransition] = useState<{
    id: number;
    from: ReturnType<typeof getAssistantProfile>;
    to: ReturnType<typeof getAssistantProfile>;
  } | null>(null);

  // Audio Context & Analyser Node for 3D Orb frequency visualization
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeAssistant = getAssistantProfile(settings.assistantPersona);

  const assistantInitialMessage = (): ChatMessage => ({
    id: `msg-welcome-${settings.assistantPersona}-${Date.now()}`,
    sender: 'assistant',
    assistantProfileId: activeAssistant.id,
    assistantName: activeAssistant.name,
    text: `${activeAssistant.greetingStyle || 'Merhaba.'} Ben ${activeAssistant.name}; E.D.I.T.H. içinde aktif asistan profilinizim.`,
    timestamp: Date.now(),
  });

  useEffect(() => {
    applyAssistantTheme(activeAssistant);
  }, [activeAssistant]);

  const completeBoot = useCallback(() => {
    setBootComplete(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateToolsFromRegistry() {
      try {
        const response = await fetch('/api/edith/tools');
        if (!response.ok) return;
        const data = await response.json() as { tools?: RegistryToolDefinition[] };
        if (!Array.isArray(data.tools) || cancelled) return;

        setTools((prev) => {
          const merged = mergeRegistryTools(prev, data.tools ?? []);
          saveToolStates(merged);
          return merged;
        });
      } catch (error) {
        console.warn('EDITH registry metadata could not be loaded:', error);
      }
    }

    hydrateToolsFromRegistry();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = (updates: Partial<UserSettings>) => {
    if (updates.assistantPersona && updates.assistantPersona !== settings.assistantPersona) {
      const nextProfile = assistantProfiles.find(
        (profile) => profile.id === updates.assistantPersona
      );
      if (nextProfile) {
        setThemeTransition({
          id: Date.now(),
          from: activeAssistant,
          to: nextProfile,
        });
      }
    }
    const mergedSettings = { ...settings, ...updates };
    if (updates.aiProvider || updates.selectedModel) {
      mergedSettings.selectedModel = selectValidModelForProvider(
        mergedSettings.aiProvider,
        providerProfiles,
        availableModels,
        mergedSettings.selectedModel
      );
    }
    handleSaveSettings(mergedSettings);
  };

  const handleAuthenticated = (session: EdithAuthSession) => {
    saveAuthSession(session);
    setAuthSession(session);
    handleSaveSettings({ ...settings, userName: session.user.name });
  };

  const handleLogout = () => {
    clearAuthSession();
    setAuthSession(null);
  };

  // Active Chat Session
  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || {
      id: 'session-default',
      title: 'Varsayılan Sohbet',
      messages: [DEFAULT_INITIAL_MESSAGE],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

  // 1. Initial Health Check on Mount
  useEffect(() => {
    checkHealth();
  }, [settings.ollamaUrl]);

  const checkHealth = async () => {
    setIsTestingConnection(true);
    try {
      const health = await fetchProviderHealth(settings.ollamaUrl);
      setProviderHealth(health);
      setOllamaConnected(health.ollamaConnected);
      setAvailableModels(health.availableModels || []);
      const profiles = health.providers?.length ? health.providers : await fetchProviderProfiles(health.ollamaConnected);
      const normalizedProfiles = profiles.map((profile) => {
          if (profile.provider === 'ollama') {
            const reported = health.providers?.find((candidate) => candidate.provider === 'ollama');
            return {
              ...profile,
              ...reported,
              status: reported?.status ?? (health.ollamaConnected ? 'available' : 'offline'),
              modelExamples: health.availableModels.length ? health.availableModels : profile.modelExamples,
              models: health.availableModels.length ? health.availableModels : profile.models,
            };
          }
          if (profile.provider === 'gemini') {
            const reported = health.providers?.find((candidate) => candidate.provider === 'gemini');
            return {
              ...profile,
              ...reported,
              status: reported?.status ?? (health.geminiAvailable ? 'available' : 'configuration_required'),
            };
          }
          return profile;
        });
      setProviderProfiles(normalizedProfiles);
      const validModel = selectValidModelForProvider(settings.aiProvider, normalizedProfiles, health.availableModels || [], settings.selectedModel);
      if (validModel !== settings.selectedModel) {
        handleSaveSettings({ ...settings, selectedModel: validModel });
      }
    } catch (e) {
      setOllamaConnected(false);
      setProviderHealth({
        ollamaConnected: false,
        geminiAvailable: false,
        availableModels: [],
        checkedAt: Date.now(),
        source: 'placeholder',
      });
      setProviderProfiles(fallbackProviderProfiles());
    } finally {
      setIsTestingConnection(false);
    }
  };

  const selectedProviderStatus =
    providerProfiles.find((profile) => profile.provider === settings.aiProvider)?.status ?? 'unknown';

  const normalizeChatProvider = (value: unknown): AiProvider | undefined => {
    if (
      value === 'ollama' ||
      value === 'gemini' ||
      value === 'openai' ||
      value === 'anthropic' ||
      value === 'openrouter' ||
      value === 'local' ||
      value === 'mock'
    ) {
      return value;
    }
    return undefined;
  };

  const normalizeChatProviderStatus = (value: unknown): ProviderRuntimeStatus | undefined => {
    if (
      value === 'available' ||
      value === 'unavailable' ||
      value === 'configuration_required' ||
      value === 'rate_limited' ||
      value === 'offline' ||
      value === 'degraded' ||
      value === 'error' ||
      value === 'unknown'
    ) {
      return value;
    }
    return undefined;
  };

  const chatMetadataFromSse = (data: Record<string, unknown>): Partial<ChatMessage> => {
    const providerUsed = normalizeChatProvider(data.resolvedProvider ?? data.providerUsed ?? data.provider);
    const fallbackProvider = normalizeChatProvider(data.fallbackProvider);
    const providerStatus = normalizeChatProviderStatus(data.providerStatus);
    return {
      ...(providerUsed ? { providerUsed } : {}),
      ...(typeof data.resolvedModel === 'string'
        ? { modelUsed: data.resolvedModel }
        : typeof data.modelUsed === 'string'
        ? { modelUsed: data.modelUsed }
        : typeof data.model === 'string'
        ? { modelUsed: data.model }
        : {}),
      ...(typeof data.fallbackUsed === 'boolean' ? { fallbackUsed: data.fallbackUsed } : {}),
      ...(fallbackProvider ? { fallbackProvider } : {}),
      ...(typeof data.fallbackModel === 'string' ? { fallbackModel: data.fallbackModel } : {}),
      ...(providerStatus ? { providerStatus } : {}),
      ...(typeof data.errorCode === 'string' ? { errorCode: data.errorCode } : {}),
      ...(data.error === true ? { error: true } : {}),
    };
  };

  // 2. Audio Web Audio API setup for Speech Visualizer & Microphone Analysis
  const initAudioAnalyser = async (stream?: MediaStream) => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.8;
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
        }
      }

      const ctx = audioCtxRef.current;
      const analyser = analyserRef.current;

      if (!ctx || !analyser) return analyserRef.current;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Connect provided stream (or attempt mic stream) to analyser node
      if (stream) {
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
      } else if (navigator.mediaDevices?.getUserMedia) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const source = ctx.createMediaStreamSource(micStream);
          source.connect(analyser);
        } catch (err) {
          console.warn('Microphone stream auto-connect skipped:', err);
        }
      }
    } catch (e) {
      console.warn('Failed to initialize AudioContext analyser:', e);
    }
    return analyserRef.current;
  };

  // 3. Speech Playback (TTS)
  const speakText = async (text: string, msgId?: string) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel(); // Stop any active speech
    await initAudioAnalyser();

    if (settings.ttsEngine === 'claude_voice' && settings.claudeVoiceApiKey) {
      try {
        setAiState('speaking');
        if (msgId) setActiveSpeakingId(msgId);
        const response = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            apiKey: settings.claudeVoiceApiKey,
            voiceId: activeAssistant.voiceId || settings.claudeVoiceId,
            assistantPersona: activeAssistant.id,
            voiceIdentity: activeAssistant.voice,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        const audioBlob = await response.blob();
        const audio = new Audio(URL.createObjectURL(audioBlob));
        audio.onended = () => {
          setAiState('idle');
          setActiveSpeakingId(null);
        };
        audio.onerror = () => {
          setAiState('idle');
          setActiveSpeakingId(null);
        };
        await audio.play();
        return;
      } catch (error) {
        console.warn('Claude Voice connector failed, falling back to Web Speech:', error);
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = settings.language === 'tr' ? 'tr-TR' : 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setAiState('speaking');
      if (msgId) setActiveSpeakingId(msgId);
    };

    utterance.onend = () => {
      setAiState('idle');
      setActiveSpeakingId(null);
    };

    utterance.onerror = () => {
      setAiState('idle');
      setActiveSpeakingId(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setAiState('idle');
    setActiveSpeakingId(null);
    setIsStreaming(false);
  };

  // 4. Send Message Handler
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    // Create User Message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    };

    // Prepare Assistant Message Placeholder
    const assistantMsgId = `msg-ast-${Date.now() + 1}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      sender: 'assistant',
      assistantProfileId: activeAssistant.id,
      assistantName: activeAssistant.name,
      requestedProvider: settings.aiProvider,
      requestedModel: settings.selectedModel || 'auto',
      providerUsed: settings.aiProvider,
      modelUsed: settings.selectedModel || 'auto',
      providerStatus: selectedProviderStatus,
      text: '',
      timestamp: Date.now() + 1,
      isStreaming: true,
    };

    const updatedMessages = [...activeSession.messages, userMsg, assistantMsg];
    updateActiveSessionMessages(updatedMessages);

    setAiState('thinking');
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.filter((m) => m.id !== assistantMsgId),
          provider: settings.aiProvider,
          model: settings.selectedModel,
          ollamaUrl: settings.ollamaUrl,
          temperature: settings.temperature,
          systemPrompt: activeAssistant.systemPrompt || settings.systemPrompt,
          assistantPersona: activeAssistant.id,
          assistantName: activeAssistant.name,
          assistantPlatform: activeAssistant.platform,
          memoryNamespace: activeAssistant.memoryNamespace,
          memories: settings.memoryEnabled ? memories : [],
          memoryEnabled: settings.memoryEnabled,
          userName: settings.userName,
        }),
      });

      if (!response.ok) throw new Error(`Chat endpoint returned ${response.status}`);
      if (!response.body) throw new Error('Yayın yanıtı alınamadı');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            if (data.text) {
              accumulatedText += data.text;
              updateAssistantMessageText(assistantMsgId, accumulatedText, true);
            }
            const metadata = chatMetadataFromSse(data);
            if (Object.keys(metadata).length) {
              updateAssistantMessageText(assistantMsgId, accumulatedText, true, metadata);
            }
            if (data.done) {
              break;
            }
          } catch (e) {
            // Ignore line parse glitches
          }
        }
      }

      // Mark message streaming completed
      updateAssistantMessageText(assistantMsgId, accumulatedText, false);

      // Auto-speech if enabled
      if (settings.autoSpeech && accumulatedText) {
        speakText(accumulatedText, assistantMsgId);
      } else {
        setAiState('idle');
      }
    } catch (err) {
      console.error('Chat error:', err);
      updateAssistantMessageText(
        assistantMsgId,
        'Bir hata oluştu veya yerel LLM sunucusuna ulaşılamadı. Lütfen ayarlarınızı kontrol edin.',
        false,
        { error: true, providerStatus: 'unavailable', errorCode: 'chat_request_failed' }
      );
      setAiState('error');
      setTimeout(() => setAiState('idle'), 3000);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSendCodeMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `code-msg-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    };

    const assistantMsgId = `code-msg-ast-${Date.now() + 1}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      sender: 'assistant',
      assistantProfileId: activeAssistant.id,
      assistantName: activeAssistant.name,
      requestedProvider: settings.aiProvider,
      requestedModel: settings.selectedModel || 'auto',
      providerUsed: settings.aiProvider,
      modelUsed: settings.selectedModel || 'auto',
      providerStatus: selectedProviderStatus,
      text: '',
      timestamp: Date.now() + 1,
      isStreaming: true,
    };

    const nextSession: ChatSession = {
      ...codeSession,
      messages: [...codeSession.messages, userMsg, assistantMsg],
      updatedAt: Date.now(),
    };
    setCodeSession(nextSession);
    saveCodeSession(nextSession);

    setAiState('thinking');
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextSession.messages.filter((m) => m.id !== assistantMsgId),
          provider: settings.aiProvider,
          model: settings.selectedModel,
          ollamaUrl: settings.ollamaUrl,
          temperature: Math.min(settings.temperature, 0.35),
          systemPrompt:
            `${activeAssistant.systemPrompt}\n\nKod kanalındasın: kıdemli bir yazılım mühendisliği asistanı gibi davran. Kod isteklerinde net, test edilebilir, güvenli ve mevcut projeyi bozmayan çözümler üret. Kod bloklarını Markdown fenced code block olarak yaz. Gereksiz sohbet etme; önce çözüm, sonra kısa açıklama ver.`,
          assistantPersona: activeAssistant.id,
          assistantName: activeAssistant.name,
          assistantPlatform: activeAssistant.platform,
          memoryNamespace: activeAssistant.memoryNamespace,
          memories: settings.memoryEnabled ? memories : [],
          memoryEnabled: settings.memoryEnabled,
          userName: settings.userName,
        }),
      });

      if (!response.ok) throw new Error(`Chat endpoint returned ${response.status}`);
      if (!response.body) throw new Error('Kod chat yayın yanıtı alınamadı');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            if (data.text) {
              accumulatedText += data.text;
              setCodeSession((prev) => {
                const updated = {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, text: accumulatedText, isStreaming: true } : m
                  ),
                  updatedAt: Date.now(),
                };
                saveCodeSession(updated);
                return updated;
              });
            }
            const metadata = chatMetadataFromSse(data);
            if (Object.keys(metadata).length) {
              setCodeSession((prev) => {
                const updated = {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          ...metadata,
                          providerUsed: metadata.providerUsed ?? m.providerUsed,
                          modelUsed: metadata.modelUsed ?? m.modelUsed,
                          fallbackUsed: metadata.fallbackUsed ?? m.fallbackUsed,
                          fallbackProvider: metadata.fallbackProvider ?? m.fallbackProvider,
                          fallbackModel: metadata.fallbackModel ?? m.fallbackModel,
                          providerStatus: metadata.providerStatus ?? m.providerStatus,
                          errorCode: metadata.errorCode ?? m.errorCode,
                        }
                      : m
                  ),
                  updatedAt: Date.now(),
                };
                saveCodeSession(updated);
                return updated;
              });
            }
          } catch {
            // Ignore malformed SSE fragments.
          }
        }
      }

      setCodeSession((prev) => {
        const updated = {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, text: accumulatedText, isStreaming: false } : m
          ),
          updatedAt: Date.now(),
        };
        saveCodeSession(updated);
        return updated;
      });
      setAiState('idle');
    } catch (err) {
      console.error('Code chat error:', err);
      setCodeSession((prev) => {
        const updated = {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  text: 'Kod chat isteği işlenirken hata oluştu. Lütfen model/bağlantı ayarlarını kontrol edin.',
                  isStreaming: false,
                  error: true,
                  providerStatus: 'unavailable',
                  errorCode: 'code_chat_request_failed',
                }
              : m
          ),
          updatedAt: Date.now(),
        };
        saveCodeSession(updated);
        return updated;
      });
      setAiState('error');
      setTimeout(() => setAiState('idle'), 3000);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleResetCodeChat = () => {
    const resetSession: ChatSession = {
      ...codeSession,
      messages: [DEFAULT_CODE_INITIAL_MESSAGE],
      updatedAt: Date.now(),
    };
    setCodeSession(resetSession);
    saveCodeSession(resetSession);
  };

  const updateActiveSessionMessages = (msgs: ChatMessage[]) => {
    const updated = sessions.map((s) =>
      s.id === activeSession.id ? { ...s, messages: msgs, updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
  };

  const updateAssistantMessageText = (msgId: string, text: string, streaming: boolean, metadata: Partial<ChatMessage> = {}) => {
    setSessions((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== activeSession.id) return s;
        const newMsgs = s.messages.map((m) =>
          m.id === msgId ? { ...m, ...metadata, text, isStreaming: streaming } : m
        );
        return { ...s, messages: newMsgs, updatedAt: Date.now() };
      });
      saveSessions(updated);
      return updated;
    });
  };

  // 5. New Chat & Reset
  const handleNewChat = () => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: `Sohbet ${sessions.length + 1}`,
      messages: [assistantInitialMessage()],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setActiveSessionId(newSession.id);
    saveSessions(updated);
  };

  const handleResetActiveChat = () => {
    updateActiveSessionMessages([assistantInitialMessage()]);
  };

  // 6. Memory Management
  const handleAddMemory = (
    category: MemoryCategory,
    key: string,
    value: string,
    isSensitive?: boolean
  ) => {
    const newMem: MemoryItem = {
      id: `mem-${Date.now()}`,
      category,
      key,
      value,
      createdAt: Date.now(),
      isSensitive,
      assistantNamespace: activeAssistant.memoryNamespace,
    };
    const updated = [newMem, ...memories];
    setMemories(updated);
    saveMemories(updated);
  };

  const handleDeleteMemory = (id: string) => {
    const updated = memories.filter((m) => m.id !== id);
    setMemories(updated);
    saveMemories(updated);
  };

  const handleClearAllMemories = () => {
    setMemories([]);
    saveMemories([]);
  };

  // 7. Tool Execution
  const saveToolStates = (updatedTools: AutomationTool[]) => {
    try {
      const states: Record<string, Partial<AutomationTool>> = {};
      for (const t of updatedTools) {
        states[t.id] = { requiresConfirmation: t.requiresConfirmation, lastRun: t.lastRun, status: t.status };
      }
      localStorage.setItem('edith_tool_states_v1', JSON.stringify(states));
    } catch { /* ignore */ }
  };

  const handleExecuteTool = async (toolId: string, args: Record<string, any> = {}) => {
    // Mark as running
    setTools((prev) => {
      const updated = prev.map((t) => (t.id === toolId ? { ...t, status: 'running' as const } : t));
      return updated;
    });

    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId,
          args: {
            ...args,
            assistantPersona: activeAssistant.id,
            notificationIdentity: activeAssistant.notificationIdentity,
            taskReportSignature: activeAssistant.taskReportSignature,
          },
        }),
      });
      const data = await res.json();

      const newLog: ToolExecutionLog = {
        id: `log-${Date.now()}`,
        toolId,
        toolName: tools.find((t) => t.id === toolId)?.name || toolId,
        args,
        result: data.result || data.error || 'İşlem tamamlandı.',
        timestamp: Date.now(),
        status: data.success ? 'success' : 'error',
        assistantProfileId: activeAssistant.id,
        assistantName: activeAssistant.name,
        taskReportSignature: activeAssistant.taskReportSignature,
      };

      const updatedLogs = [newLog, ...logs];
      setLogs(updatedLogs);
      saveToolLogs(updatedLogs);

      // Update Tool Status
      setTools((prev) => {
        const updated = prev.map((t) =>
          t.id === toolId ? { ...t, status: data.success ? 'success' as const : 'error' as const, lastRun: Date.now() } : t
        );
        saveToolStates(updated);
        return updated;
      });
    } catch (e: any) {
      console.error('Tool execution failed:', e);
      setTools((prev) => {
        const updated = prev.map((t) => (t.id === toolId ? { ...t, status: 'error' as const } : t));
        saveToolStates(updated);
        return updated;
      });
    }
  };

  const handleToggleToolConfirmation = (toolId: string) => {
    setTools((prev) => {
      const updated = prev.map((t) =>
        t.id === toolId ? { ...t, requiresConfirmation: !t.requiresConfirmation } : t
      );
      saveToolStates(updated);
      return updated;
    });
  };

  // 8. Integrations Management
  const handleSaveIntegration = (id: string, updates: Partial<IntegrationConfig>) => {
    const updated = integrations.map((i) => (i.id === id ? { ...i, ...updates } : i));
    setIntegrations(updated);
    saveIntegrations(updated);
  };

  // 9. Settings Management
  const handleSaveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleResetAllData = () => {
    localStorage.clear();
    window.location.reload();
  };

  const handleEmergencyStop = useCallback(async () => {
    stopSpeech();
    setIsStreaming(false);
    setAiState('warning');
    try {
      await fetch('/api/edith/kill-switch/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Emergency stop from E.D.I.T.H. desktop shell.' }),
      });
    } catch (error) {
      console.warn('Emergency stop could not reach kill switch endpoint:', error);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && event.shiftKey && key === 'k') {
        event.preventDefault();
        setActiveTab('dashboard');
      }
      if (event.ctrlKey && event.shiftKey && key === 's') {
        event.preventDefault();
        stopSpeech();
      }
      if (event.ctrlKey && event.shiftKey && key === 'f') {
        event.preventDefault();
        void invokeDesktopCommand('toggle_fullscreen');
      }
      if (event.ctrlKey && event.shiftKey && key === 'e') {
        event.preventDefault();
        void handleEmergencyStop();
      }
      if (event.ctrlKey && event.shiftKey && key === 'm') {
        event.preventDefault();
        handleSaveSettings({ ...settings, voiceHandsFree: false, autoSpeech: false });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleEmergencyStop, settings]);

  if (!bootComplete) {
    return <BootScreen assistant={activeAssistant} settings={settings} onComplete={completeBoot} />;
  }

  if (!authSession?.authenticated) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="edith-theme-shell fixed inset-0 flex flex-col overflow-hidden bg-[var(--edith-bg)] text-[var(--edith-text)] font-sans selection:bg-[var(--assistant-primary)] selection:text-slate-950">
      {themeTransition && (
        <ThemeTransition
          key={themeTransition.id}
          from={themeTransition.from}
          to={themeTransition.to}
          onComplete={() => setThemeTransition(null)}
        />
      )}
      <DesktopTitleBar activeAssistant={activeAssistant} onEmergencyStop={handleEmergencyStop} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ollamaConnected={ollamaConnected}
          selectedModel={settings.selectedModel}
          providerName={providerProfiles.find((profile) => profile.provider === settings.aiProvider)?.displayName}
          providerStatus={selectedProviderStatus}
        />

        {/* Main Content Workspace */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <Header
          settings={settings}
          activeAssistant={activeAssistant}
          assistantProfiles={assistantProfiles}
          authSession={authSession}
          ollamaConnected={ollamaConnected}
          providerProfiles={providerProfiles}
          providerHealth={providerHealth}
          availableModels={availableModels}
          onNewChat={handleNewChat}
          onResetChat={handleResetActiveChat}
          onTestConnection={checkHealth}
          onToggleAutoSpeech={() => handleSaveSettings({ ...settings, autoSpeech: !settings.autoSpeech })}
          onUpdateSettings={updateSettings}
          onEmergencyStop={handleEmergencyStop}
          onLogout={handleLogout}
          isTestingConnection={isTestingConnection}
        />

        {/* Dynamic Tab Views */}
        <main className="flex-1 flex overflow-hidden relative">
          {activeTab === 'dashboard' && (
            <DashboardView
              aiState={aiState}
              messages={activeSession.messages}
              settings={settings}
              assistantProfile={activeAssistant}
              ollamaConnected={ollamaConnected}
              providerProfiles={providerProfiles}
              onSendMessage={handleSendMessage}
              onStopSpeech={stopSpeech}
              onVoiceTranscript={(txt) => handleSendMessage(txt)}
              onSpeakMessage={(txt) => speakText(txt)}
              onOpenOllamaModal={() => setShowOllamaModal(true)}
              isStreaming={isStreaming}
              audioAnalyser={analyserRef.current}
              memories={memories}
              tools={tools}
              logs={logs}
            />
          )}

          {activeTab === 'chat' && (
            <ChatConsoleView
              aiState={aiState}
              messages={activeSession.messages}
              settings={settings}
              assistantProfile={activeAssistant}
              ollamaConnected={ollamaConnected}
              providerProfiles={providerProfiles}
              onSendMessage={handleSendMessage}
              onStopSpeech={stopSpeech}
              onVoiceTranscript={(txt) => handleSendMessage(txt)}
              onSpeakMessage={(txt) => speakText(txt)}
              onOpenOllamaModal={() => setShowOllamaModal(true)}
              isStreaming={isStreaming}
              activeSpeakingId={activeSpeakingId}
            />
          )}

          {activeTab === 'agents' && <AgentsScreen aiState={aiState} tools={tools} logs={logs} />}

          {activeTab === 'tasks' && <TasksScreen aiState={aiState} messages={activeSession.messages} logs={logs} assistant={activeAssistant} />}

          {activeTab === 'computer' && <ComputerUseScreen tools={tools} logs={logs} />}

          {activeTab === 'browser' && <BrowserResearchScreen tools={tools} logs={logs} />}

          {activeTab === 'code' && (
            <CodeChatView
              messages={codeSession.messages}
              settings={settings}
              assistantProfile={activeAssistant}
              onSendMessage={handleSendCodeMessage}
              onReset={handleResetCodeChat}
              isStreaming={isStreaming}
            />
          )}

          {activeTab === 'memory' && (
            <MemoryBrainScreen memories={memories} />
          )}

          {activeTab === 'knowledge' && (
            <KnowledgeGraphScreen memories={memories} tools={tools} logs={logs} />
          )}

          {activeTab === 'automations' && (
            <AutomationsMissionScreen tools={tools} logs={logs} />
          )}

          {activeTab === 'files' && <FilesScreen />}

          {activeTab === 'tools' && <ToolsRegistryScreen tools={tools} logs={logs} />}

          {activeTab === 'voice' && <VoiceScreen />}

          {activeTab === 'crypto' && <TradingScreen integrations={integrations} tools={tools} logs={logs} />}

          {activeTab === 'security' && <SecurityCenterScreen tools={tools} integrations={integrations} />}

          {activeTab === 'system' && <SystemHealthScreen ollamaConnected={ollamaConnected} settings={settings} tools={tools} logs={logs} />}

          {activeTab === 'integrations' && (
            <IntegrationsView
              integrations={integrations}
              onSaveIntegration={handleSaveIntegration}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsArchitectureScreen
              settings={settings}
              integrations={integrations}
              assistant={activeAssistant}
              providerProfiles={providerProfiles}
              providerHealth={providerHealth}
              availableModels={availableModels}
              onUpdateSettings={updateSettings}
              onTestConnection={checkHealth}
              isTestingConnection={isTestingConnection}
            />
          )}
          {activeTab !== 'dashboard' && activeTab !== 'chat' && (
            <ContextPanel aiState={aiState} assistant={activeAssistant} tools={tools} logs={logs} />
          )}
        </main>
        </div>
      </div>

      {/* Ollama Guide Modal */}
      <OllamaGuideModal
        isOpen={showOllamaModal}
        onClose={() => setShowOllamaModal(false)}
        onSwitchToGemini={() => updateSettings({ aiProvider: 'gemini' })}
      />
    </div>
  );
}
