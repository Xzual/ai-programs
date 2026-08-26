import { NodeColor, NodeType } from '../types';

export interface ColorScheme {
  bgLight: string;
  bgDark: string;
  borderLight: string;
  borderDark: string;
  textLight: string;
  textDark: string;
  badgeBgLight: string;
  badgeBgDark: string;
  badgeTextLight: string;
  badgeTextDark: string;
  glowDark: string;
  glowLight: string;
  accent: string;
  fill: string;
  stroke: string;
}

export const NODE_COLOR_MAP: Record<NodeColor, ColorScheme> = {
  indigo: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-indigo-950/20 backdrop-blur-xl',
    borderLight: 'border-indigo-200/70 hover:border-indigo-400',
    borderDark: 'border-indigo-500/30 hover:border-indigo-400/80',
    textLight: 'text-indigo-950',
    textDark: 'text-indigo-100',
    badgeBgLight: 'bg-indigo-500/10 text-indigo-700 border border-indigo-200/60',
    badgeBgDark: 'bg-indigo-500/15 text-indigo-300 border border-indigo-400/20',
    badgeTextLight: 'text-indigo-800',
    badgeTextDark: 'text-indigo-200',
    glowDark: 'rgba(99, 102, 241, 0.45)',
    glowLight: 'rgba(99, 102, 241, 0.25)',
    accent: '#6366f1',
    fill: '#818cf8',
    stroke: '#6366f1'
  },
  cyan: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-cyan-950/20 backdrop-blur-xl',
    borderLight: 'border-cyan-200/70 hover:border-cyan-400',
    borderDark: 'border-cyan-500/30 hover:border-cyan-400/80',
    textLight: 'text-cyan-950',
    textDark: 'text-cyan-100',
    badgeBgLight: 'bg-cyan-500/10 text-cyan-700 border border-cyan-200/60',
    badgeBgDark: 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/20',
    badgeTextLight: 'text-cyan-800',
    badgeTextDark: 'text-cyan-200',
    glowDark: 'rgba(6, 182, 212, 0.45)',
    glowLight: 'rgba(6, 182, 212, 0.25)',
    accent: '#06b6d4',
    fill: '#22d3ee',
    stroke: '#06b6d4'
  },
  emerald: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-emerald-950/20 backdrop-blur-xl',
    borderLight: 'border-emerald-200/70 hover:border-emerald-400',
    borderDark: 'border-emerald-500/30 hover:border-emerald-400/80',
    textLight: 'text-emerald-950',
    textDark: 'text-emerald-100',
    badgeBgLight: 'bg-emerald-500/10 text-emerald-700 border border-emerald-200/60',
    badgeBgDark: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20',
    badgeTextLight: 'text-emerald-800',
    badgeTextDark: 'text-emerald-200',
    glowDark: 'rgba(16, 185, 129, 0.45)',
    glowLight: 'rgba(16, 185, 129, 0.25)',
    accent: '#10b981',
    fill: '#34d399',
    stroke: '#10b981'
  },
  amber: {
    bgLight: 'bg-amber-50/80 backdrop-blur-xl',
    bgDark: 'bg-amber-950/20 backdrop-blur-xl',
    borderLight: 'border-amber-200/70 hover:border-amber-400',
    borderDark: 'border-amber-500/30 hover:border-amber-400/80',
    textLight: 'text-amber-950',
    textDark: 'text-amber-100',
    badgeBgLight: 'bg-amber-500/10 text-amber-900 border border-amber-200/60',
    badgeBgDark: 'bg-amber-500/15 text-amber-300 border border-amber-400/20',
    badgeTextLight: 'text-amber-900',
    badgeTextDark: 'text-amber-200',
    glowDark: 'rgba(245, 158, 11, 0.45)',
    glowLight: 'rgba(245, 158, 11, 0.25)',
    accent: '#f59e0b',
    fill: '#fbbf24',
    stroke: '#f59e0b'
  },
  rose: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-rose-950/20 backdrop-blur-xl',
    borderLight: 'border-rose-200/70 hover:border-rose-400',
    borderDark: 'border-rose-500/30 hover:border-rose-400/80',
    textLight: 'text-rose-950',
    textDark: 'text-rose-100',
    badgeBgLight: 'bg-rose-500/10 text-rose-800 border border-rose-200/60',
    badgeBgDark: 'bg-rose-500/15 text-rose-300 border border-rose-400/20',
    badgeTextLight: 'text-rose-800',
    badgeTextDark: 'text-rose-200',
    glowDark: 'rgba(244, 63, 94, 0.45)',
    glowLight: 'rgba(244, 63, 94, 0.25)',
    accent: '#f43f5e',
    fill: '#fb7185',
    stroke: '#f43f5e'
  },
  violet: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-violet-950/20 backdrop-blur-xl',
    borderLight: 'border-violet-200/70 hover:border-violet-400',
    borderDark: 'border-violet-500/30 hover:border-violet-400/80',
    textLight: 'text-violet-950',
    textDark: 'text-violet-100',
    badgeBgLight: 'bg-violet-500/10 text-violet-800 border border-violet-200/60',
    badgeBgDark: 'bg-violet-500/15 text-violet-300 border border-violet-400/20',
    badgeTextLight: 'text-violet-800',
    badgeTextDark: 'text-violet-200',
    glowDark: 'rgba(139, 92, 246, 0.45)',
    glowLight: 'rgba(139, 92, 246, 0.25)',
    accent: '#8b5cf6',
    fill: '#a78bfa',
    stroke: '#8b5cf6'
  },
  fuchsia: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-fuchsia-950/20 backdrop-blur-xl',
    borderLight: 'border-fuchsia-200/70 hover:border-fuchsia-400',
    borderDark: 'border-fuchsia-500/30 hover:border-fuchsia-400/80',
    textLight: 'text-fuchsia-950',
    textDark: 'text-fuchsia-100',
    badgeBgLight: 'bg-fuchsia-500/10 text-fuchsia-800 border border-fuchsia-200/60',
    badgeBgDark: 'bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-400/20',
    badgeTextLight: 'text-fuchsia-800',
    badgeTextDark: 'text-fuchsia-200',
    glowDark: 'rgba(217, 70, 239, 0.45)',
    glowLight: 'rgba(217, 70, 239, 0.25)',
    accent: '#d946ef',
    fill: '#e879f9',
    stroke: '#d946ef'
  },
  slate: {
    bgLight: 'bg-white/80 backdrop-blur-xl',
    bgDark: 'bg-white/5 backdrop-blur-xl',
    borderLight: 'border-slate-300/70 hover:border-slate-400',
    borderDark: 'border-white/10 hover:border-white/20',
    textLight: 'text-slate-900',
    textDark: 'text-slate-100',
    badgeBgLight: 'bg-slate-500/10 text-slate-800 border border-slate-200/60',
    badgeBgDark: 'bg-white/10 text-slate-300 border border-white/10',
    badgeTextLight: 'text-slate-800',
    badgeTextDark: 'text-slate-200',
    glowDark: 'rgba(148, 163, 184, 0.35)',
    glowLight: 'rgba(148, 163, 184, 0.2)',
    accent: '#64748b',
    fill: '#94a3b8',
    stroke: '#64748b'
  }
};

export const NODE_TYPE_LABELS: Record<NodeType, { name: string; icon: string; desc: string }> = {
  concept: {
    name: 'Kavram Düğümü',
    icon: 'Brain',
    desc: 'Ana başlık, özet ve detaylı bilgi açıklaması'
  },
  sticky: {
    name: 'Yapışkan Not (Sticky)',
    icon: 'StickyNote',
    desc: 'Hızlı fikirler, anlık notlar ve hatırlatıcılar'
  },
  task: {
    name: 'Görev & Kontrol Listesi',
    icon: 'CheckSquare',
    desc: 'Tamamlanma yüzdesi olan kontrol adımları'
  },
  resource: {
    name: 'Kaynak & Doküman',
    icon: 'Link2',
    desc: 'Makaleler, videolar, kütüphaneler ve bağlantılar'
  }
};
