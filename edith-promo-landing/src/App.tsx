import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ArrowRight, ChevronDown, LockKeyhole, Play, Sparkles } from 'lucide-react';
import { actionSteps, modules, personas, storySections, trustSignals, type SceneId, type StorySection } from './data/landingData';

const OrbScene = lazy(() => import('./components/OrbScene').then((module) => ({ default: module.OrbScene })));

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

export function App() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeScene, setActiveScene] = useState<SceneId>('hero');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [sceneProgress, setSceneProgress] = useState(0);
  const reducedMotion = useReducedMotion();
  const activeIndex = useMemo(() => storySections.findIndex((section) => section.id === activeScene), [activeScene]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({
      wrapper: scroller,
      content,
      lerp: reducedMotion ? 1 : 0.085,
      wheelMultiplier: reducedMotion ? 0.75 : 0.9,
      touchMultiplier: 1,
    });

    let frameId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frameId = requestAnimationFrame(raf);
    };
    frameId = requestAnimationFrame(raf);
    let latestProgress = 0;
    let latestSceneProgress = 0;
    const updateSceneProgress = (scroll: number) => {
      const sections = Array.from(content.querySelectorAll<HTMLElement>('.story-section'));
      const height = scroller.clientHeight;
      for (let index = 1; index < sections.length; index += 1) {
        const sectionTop = sections[index].offsetTop - scroll;
        const transition = Math.max(0, Math.min(1, (height * 0.85 - sectionTop) / (height * 0.4)));
        if (transition < 1) return index - 1 + transition;
      }
      return sections.length - 1;
    };
    lenis.on('scroll', ({ progress, scroll }: { progress: number; scroll: number }) => {
      ScrollTrigger.update();
      if (Math.abs(progress - latestProgress) > 0.002) {
        latestProgress = progress;
        setScrollProgress(progress);
      }
      const position = updateSceneProgress(scroll);
      if (Math.abs(position - latestSceneProgress) > 0.005) {
        latestSceneProgress = position;
        setSceneProgress(position);
      }
    });
    ScrollTrigger.defaults({ scroller });

    const triggers = storySections.map((section) =>
      ScrollTrigger.create({
        trigger: `[data-section="${section.id}"]`,
        start: 'top 58%',
        end: 'bottom 42%',
        onEnter: () => setActiveScene(section.id),
        onEnterBack: () => setActiveScene(section.id),
      })
    );

    if (!reducedMotion) {
      gsap.utils.toArray<HTMLElement>('.story-section').forEach((section) => {
        const copy = section.querySelector('.section-copy');
        if (!copy) return;
        gsap.fromTo(
          copy,
          { autoAlpha: 0, y: 34, scale: 0.988, filter: 'blur(10px)' },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            filter: 'blur(0px)',
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              start: 'top 95%',
              end: 'top 75%',
              scrub: 0.55,
            },
          }
        );

        gsap.to(copy, {
          autoAlpha: 0.7,
          y: -12,
          scale: 0.992,
          filter: 'blur(3px)',
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'bottom 32%',
            end: 'bottom 8%',
            scrub: 0.55,
          },
        });
      });

      gsap.utils.toArray<HTMLElement>('.reveal').forEach((element) => {
        gsap.fromTo(
          element,
          { opacity: 0, y: 34, filter: 'blur(10px)' },
          {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 0.95,
            ease: 'power3.out',
            scrollTrigger: { trigger: element, start: 'top 82%', once: true },
          }
        );
      });
    }

    return () => {
      cancelAnimationFrame(frameId);
      triggers.forEach((trigger) => trigger.kill());
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      lenis.destroy();
    };
  }, [reducedMotion]);

  const scrollToOs = () => {
    document.getElementById('os')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="site-shell">
      <Suspense fallback={<div className="orb-canvas orb-fallback" />}>
        <OrbScene scene={activeScene} sceneProgress={sceneProgress} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
      </Suspense>

      <div className="atmosphere" aria-hidden="true">
        <span className="scanline" />
      </div>

      <header className="site-nav">
        <button className="brand" type="button" onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="brand-mark">E</span>
          <span>
            <strong>E.D.I.T.H.</strong>
            <small>Personal AI OS</small>
          </span>
        </button>
        <div className="scene-progress" aria-label={`Scene ${activeIndex + 1} of ${storySections.length}`}>
          <span style={{ width: `${((activeIndex + 1) / storySections.length) * 100}%` }} />
        </div>
        <a className="nav-cta" href="mailto:hello@edith.local">
          <LockKeyhole size={16} />
          Request Access
        </a>
      </header>

      <main ref={scrollerRef} className="site-scroll">
        <div ref={contentRef}>
          {storySections.map((section) => (
            <Section key={section.id} section={section} onExplore={scrollToOs} />
          ))}
        </div>
      </main>
    </div>
  );
}

function Section({ section, onExplore }: { section: StorySection; onExplore: () => void }) {
  return (
    <section id={section.id} className={`story-section section-${section.id}`} data-section={section.id}>
      <div className={`section-copy section-copy-${section.align}`}>
        <div className="reveal">
          <p className="eyebrow">{section.eyebrow}</p>
          <h1>{section.title}</h1>
          <p className="lede">{section.copy}</p>
        </div>

        {section.id === 'hero' && (
          <>
            <div className="hero-actions reveal">
              <a className="primary-cta" href="#finale">
                <Play size={17} fill="currentColor" />
                Experience the Vision
              </a>
              <button type="button" className="secondary-cta" onClick={onExplore}>
                Explore the system
                <ChevronDown size={17} />
              </button>
            </div>
            <div className="hero-stats reveal">
              {[
                ['Voice', 'natural command layer'],
                ['Memory', 'knowledge that compounds'],
                ['Action', 'human-approved execution'],
              ].map(([value, label]) => (
                <div key={value}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {section.id === 'os' && <ModuleStack />}
        {section.id === 'voice' && <VoicePanel />}
        {section.id === 'capabilities' && <CapabilityGrid />}
        {section.id === 'memory' && <KnowledgeGraph />}
        {section.id === 'action' && <ActionPipeline />}
        {section.id === 'crypto' && <CryptoPanel />}
        {section.id === 'personas' && <PersonaRail />}
        {section.id === 'trust' && <TrustGrid />}
        {section.id === 'finale' && <FinalCard />}
      </div>
    </section>
  );
}

function ModuleStack() {
  return (
    <div className="module-stack reveal">
      {['Talk', 'Listen', 'Think', 'Research', 'Automate', 'Remember', 'Act'].map((label, index) => (
        <span key={label} style={{ '--delay': `${index * 70}ms` } as React.CSSProperties}>
          {label}
        </span>
      ))}
    </div>
  );
}

function VoicePanel() {
  return (
    <div className="voice-panel reveal">
      <div className="voice-core-small">{[0, 1, 2].map((item) => <span key={item} />)}</div>
      <div className="waveform" aria-hidden="true">
        {Array.from({ length: 22 }).map((_, index) => (
          <span key={index} style={{ '--height': `${28 + ((index * 19) % 54)}%` } as React.CSSProperties} />
        ))}
      </div>
      <p>Listening for intent...</p>
    </div>
  );
}

function CapabilityGrid() {
  return (
    <div className="capability-grid reveal">
      {modules.map((module) => {
        const Icon = module.icon;
        return (
          <article key={module.title}>
            <Icon size={20} />
            <strong>{module.title}</strong>
            <p>{module.copy}</p>
          </article>
        );
      })}
    </div>
  );
}

function KnowledgeGraph() {
  return (
    <div className="knowledge-card reveal">
      {['You', 'Notes', 'Tasks', 'Research', 'Memory', 'Tools'].map((node, index) => (
        <span key={node} className={`graph-node graph-node-${index}`}>{node}</span>
      ))}
      <span className="graph-line graph-line-a" />
      <span className="graph-line graph-line-b" />
      <span className="graph-line graph-line-c" />
    </div>
  );
}

function ActionPipeline() {
  return (
    <div className="pipeline reveal">
      {actionSteps.map((step, index) => {
        const Icon = step.icon;
        return (
          <span className="pipeline-item" key={step.label}>
            <Icon size={18} />
            {step.label}
            {index < actionSteps.length - 1 && <ArrowRight size={16} className="pipeline-arrow" />}
          </span>
        );
      })}
    </div>
  );
}

function CryptoPanel() {
  return (
    <div className="crypto-panel reveal">
      <div className="signal-chart" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, index) => (
          <span key={index} style={{ '--height': `${18 + ((index * 31) % 68)}%` } as React.CSSProperties} />
        ))}
      </div>
      <div>
        <strong>Signal discipline</strong>
        <p>Observe, simulate, log, and review. Built for analysis, not empty promises.</p>
      </div>
    </div>
  );
}

function PersonaRail() {
  return (
    <div className="persona-rail reveal">
      {personas.map((persona) => (
        <article key={persona.name} style={{ '--accent': persona.accent } as React.CSSProperties}>
          <span>{persona.name}</span>
          <p>{persona.role}</p>
        </article>
      ))}
    </div>
  );
}

function TrustGrid() {
  return (
    <div className="trust-grid reveal">
      {trustSignals.map((signal) => {
        const Icon = signal.icon;
        return (
          <div key={signal.label}>
            <Icon size={18} />
            <span>{signal.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function FinalCard() {
  return (
    <div className="final-card reveal">
      <Sparkles size={20} />
      <p>Build the command environment where voice, memory, tools, and action finally feel like one system.</p>
      <a className="primary-cta" href="mailto:hello@edith.local">
        Request Access
        <ArrowRight size={17} />
      </a>
    </div>
  );
}
