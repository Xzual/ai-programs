import React, { useEffect } from 'react';

interface ThemePalette {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
}

interface ThemeTransitionProps {
  from: ThemePalette;
  to: ThemePalette;
  onComplete: () => void;
}

export const ThemeTransition: React.FC<ThemeTransitionProps> = ({ from, to, onComplete }) => {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 1700);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  const style = {
    '--theme-from-primary': from.primary,
    '--theme-from-secondary': from.secondary,
    '--theme-to-primary': to.primary,
    '--theme-to-secondary': to.secondary,
    '--theme-to-accent': to.accent,
    '--theme-to-background': to.background,
  } as React.CSSProperties;

  return (
    <div className="edith-theme-transition" style={style} aria-hidden="true">
      <div className="edith-theme-transition__dim" />
      <div className="edith-theme-transition__reveal" />
      <div className="edith-theme-transition__scan" />

      <div className="edith-theme-transition__reticle">
        <span className="edith-theme-transition__ring edith-theme-transition__ring--outgoing" />
        <span className="edith-theme-transition__ring edith-theme-transition__ring--outer" />
        <span className="edith-theme-transition__ring edith-theme-transition__ring--middle" />
        <span className="edith-theme-transition__ring edith-theme-transition__ring--inner" />
        <span className="edith-theme-transition__axis edith-theme-transition__axis--horizontal" />
        <span className="edith-theme-transition__axis edith-theme-transition__axis--vertical" />
        <span className="edith-theme-transition__core" />
      </div>

      <div className="edith-theme-transition__identity">
        <span className="edith-theme-transition__identity-line" />
        <span className="edith-theme-transition__name">{to.name}</span>
        <span className="edith-theme-transition__identity-line" />
      </div>
    </div>
  );
};
