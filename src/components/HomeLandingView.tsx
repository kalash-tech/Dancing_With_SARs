import {
  ArrowUpRight,
  Droplets,
  Layers,
  Mountain,
  MousePointerClick,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { REGION_DATASETS } from '../data/samples/asfVertexSamples.ts';
import type { RegionId } from '../types/sar.ts';
import { EarthGlobeCanvas } from './EarthGlobeCanvas.tsx';
import { ParticleSpiralCanvas } from './ParticleSpiralCanvas.tsx';

interface HomeLandingViewProps {
  activeRegionId: RegionId;
  onSelectRegionFromGlobe: (regionId: RegionId) => void;
  isTransitioning: boolean;
  onOpenAbout: () => void;
}

interface RegionMissionCard {
  id: RegionId;
  title: string;
  location: string;
  plainSummary: string;
  liveHighlight: string;
  techTag: string;
  icon: 'water' | 'cloud' | 'fault';
  helps: string;
}

const REGION_MISSION_CARDS: RegionMissionCard[] = [
  {
    id: 'maharashtra_gcov',
    title: 'Maharashtra: Farms & Dam Water',
    location: 'Wainganga & Wardha · India',
    plainSummary:
      'Spots standing floodwater near Gosikhurd Dam and checks farm moisture across cotton fields.',
    liveHighlight: 'Dam Floodwater + Crop Moisture',
    techTag: 'Water & Crop Radar · Track 084',
    icon: 'water',
    helps: 'Helps dam operators, cotton farmers & irrigation planners',
  },
  {
    id: 'northeast_india_gcov',
    title: 'Northeast India: Monsoon Floods',
    location: 'Brahmaputra & Kaziranga · India',
    plainSummary:
      'Sees right through thick monsoon clouds to map flooded riverbanks and soaked wetlands.',
    liveHighlight: 'Floodwater Tracking Through Clouds',
    techTag: 'Water & Crop Radar · Track 098',
    icon: 'cloud',
    helps: 'Helps flood response teams & Kaziranga wildlife rangers',
  },
  {
    id: 'japan_gunw',
    title: 'Japan: Earthquake Ground Shift',
    location: 'Noto Peninsula & Toyama Bay · Japan',
    plainSummary:
      'Shows how many centimeters the coastline rose or sank after major earthquakes.',
    liveHighlight: '+18.2 cm Land Lift & -18.6 cm Drop',
    techTag: 'Ground Movement (cm) · Track 009',
    icon: 'fault',
    helps: 'Helps earthquake planners & coastal recovery teams',
  },
];

export function HomeLandingView({
  activeRegionId,
  onSelectRegionFromGlobe,
  isTransitioning,
  onOpenAbout,
}: HomeLandingViewProps) {
  return (
    <div className="mx-auto max-w-[1600px] border-x border-[var(--rr-border)] px-4 sm:px-8 py-5 space-y-5">
      {/* Compact Header */}
      <section
        aria-label="Satellite Earth overview"
        className="relative overflow-hidden flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-[var(--rr-border)] pb-4"
      >
        <ParticleSpiralCanvas />
        <div className="relative space-y-1.5">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--rr-accent)]">
            Satellite Radar · Sees Through Clouds &amp; Darkness
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-[-0.03em] text-[var(--rr-text)]">
            Watch Floods, Crops &amp; Ground Movement
          </h1>
          <p className="text-sm sm:text-base text-[var(--rr-text)] max-w-2xl leading-relaxed">
            NISAR's radar satellite scans the ground every 12 days — through
            clouds and at night. This site turns those raw radar waves into
            colorful maps anyone can read.
          </p>
          <p className="text-xs sm:text-sm text-[var(--rr-muted)] max-w-2xl">
            Click a glowing ring on the 3D Earth below—or choose one of the 3 places—to open its 2D satellite and radar map.
          </p>
        </div>

        <div className="relative flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenAbout}
            className="border border-[var(--rr-border)] bg-[var(--rr-surface)] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--rr-text)] hover:border-[var(--rr-border-strong)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rr-accent)]"
          >
            Data Sources
          </button>
          <button
            type="button"
            onClick={() => onSelectRegionFromGlobe(activeRegionId)}
            className="inline-flex items-center gap-1.5 border border-[var(--rr-accent-solid)] bg-[var(--rr-accent-solid)] px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rr-accent)]"
          >
            <span>Open 2D Map</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* Photorealistic 3D Satellite Earth */}
      <section aria-label="Interactive 3D Satellite Earth">
        <EarthGlobeCanvas
          activeRegionId={activeRegionId}
          onSelectRegionTransition={onSelectRegionFromGlobe}
          isTransitioning={isTransitioning}
        />
      </section>

      {/* How to Use: 3 Steps */}
      <section
        aria-label="How to use this site"
        className="border border-[var(--rr-border)] bg-[var(--rr-surface)] px-4 sm:px-6 py-4"
      >
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--rr-accent)] pb-3 border-b border-[var(--rr-border)]">
          How to use this site · 3 steps
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
          {(
            [
              {
                icon: MousePointerClick,
                step: '1',
                title: 'Pick a place',
                body: 'Each glowing ring on the globe is a real study area. Click one — or a card below — to open its map.',
              },
              {
                icon: ScanSearch,
                step: '2',
                title: 'Compare the views',
                body: 'Drag the Satellite / Radar slider. Radar "sees" floodwater and ground shift that normal photos miss.',
              },
              {
                icon: Sparkles,
                step: '3',
                title: 'Understand the change',
                body: 'Read the plain-English numbers, or ask the AI Guide (bottom-right) what the colors mean.',
              },
            ] as const
          ).map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--rr-border-strong)] bg-[var(--rr-bg)]">
                <item.icon className="h-4 w-4 text-[var(--rr-accent)]" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-[var(--rr-text)]">
                  <span className="font-mono text-[var(--rr-accent)] mr-1.5">{item.step}.</span>
                  {item.title}
                </div>
                <p className="text-xs text-[var(--rr-muted)] leading-relaxed">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3 Clickable Place Cards */}
      <section
        id="study-area-index"
        aria-label="Monitored regions"
        className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-2"
      >
        {REGION_MISSION_CARDS.map((card, index) => {
          const isSelected = activeRegionId === card.id;
          const zoneCount = REGION_DATASETS[card.id].zones.length;

          return (
            <button
              key={card.id}
              type="button"
              data-testid={`project-row-${card.id}`}
              onClick={() => onSelectRegionFromGlobe(card.id)}
              className={`group text-left border p-4 flex flex-col justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rr-accent)] ${
                isSelected
                  ? 'border-[var(--rr-accent)] bg-[var(--rr-surface)]'
                  : 'border-[var(--rr-border)] bg-[var(--rr-surface)] hover:border-[var(--rr-border-strong)]'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
                  <span
                    className={
                      card.icon === 'fault'
                        ? 'text-[#F97316]'
                        : 'text-[var(--rr-accent)]'
                    }
                  >
                    0{index + 1} · {card.location}
                  </span>
                  {card.icon === 'water' && (
                    <Droplets
                      className="h-4 w-4 text-[var(--rr-accent)] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {card.icon === 'cloud' && (
                    <Layers
                      className="h-4 w-4 text-[var(--rr-accent)] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {card.icon === 'fault' && (
                    <Mountain
                      className="h-4 w-4 text-[#F97316] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <h2 className="text-base sm:text-lg font-black tracking-[-0.02em] text-[var(--rr-text)] group-hover:text-[var(--rr-accent)] transition-colors">
                  {card.title}
                </h2>

                <p className="text-xs text-[var(--rr-muted)] leading-relaxed">
                  {card.plainSummary}
                </p>
              </div>

              <div className="pt-2.5 border-t border-[var(--rr-border)] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-[var(--rr-text)] truncate">
                    {card.liveHighlight}
                  </div>
                  <div className="font-mono text-[10px] text-[var(--rr-muted)] mt-0.5">
                    {card.techTag} · {zoneCount} Zones
                  </div>
                  <div className="text-[11px] text-[var(--rr-accent)] mt-1.5 leading-snug">
                    {card.helps}
                  </div>
                </div>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--rr-border-strong)] bg-[var(--rr-surface-inverse)] text-[var(--rr-text-inverse)] group-hover:bg-[var(--rr-accent-solid)] group-hover:border-[var(--rr-accent-solid)] group-hover:text-white transition-colors">
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
            </button>
          );
        })}
      </section>
    </div>
  );
}
