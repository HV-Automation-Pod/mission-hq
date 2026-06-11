"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";

const PHASES = [
  "ESTABLISHING UPLINK",
  "SYNCING EMPLOYEE LOCATIONS",
  "COMPUTING ATTENDANCE ANALYTICS",
  "CALIBRATING COMPLIANCE METRICS",
  "MISSION CONTROL ONLINE",
];

export default function LoadingScreen() {
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const phaseTimer = setInterval(() => {
      setPhase((p) => (p < PHASES.length - 1 ? p + 1 : p));
    }, 700);
    const tickTimer = setInterval(() => setTick((t) => t + 1), 80);
    return () => {
      clearInterval(phaseTimer);
      clearInterval(tickTimer);
    };
  }, []);

  return (
    <div className="loader-root">
      {/* Atmospheric grid */}
      <div className="loader-grid" />
      <div className="loader-glow" />
      <div className="loader-vignette" />

      <div className="loader-stage">
        {/* Radar */}
        <div className="loader-radar">
          {/* Concentric rings */}
          <div className="ring ring-1" />
          <div className="ring ring-2" />
          <div className="ring ring-3" />
          <div className="ring ring-4" />

          {/* Pulsing pulses */}
          <span className="pulse pulse-a" />
          <span className="pulse pulse-b" />
          <span className="pulse pulse-c" />

          {/* Crosshairs */}
          <span className="cross cross-x" />
          <span className="cross cross-y" />

          {/* Sweeping arm */}
          <div className="sweep" />

          {/* Orbital satellite dots */}
          <span className="orbit orbit-1"><span className="sat" /></span>
          <span className="orbit orbit-2"><span className="sat sat-alt" /></span>
          <span className="orbit orbit-3"><span className="sat" /></span>

          {/* Center logo */}
          <div className="loader-core">
            <div className="core-halo" />
            <div className="core-logo">
              <MapPin size={22} className="text-white" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Wordmark */}
        <div className="loader-brand">
          <div className="brand-mark">MISSION<span className="brand-dot">·</span>HQ</div>
          <div className="brand-sub">OFFICE INTELLIGENCE TERMINAL</div>
        </div>

        {/* Phase + progress */}
        <div className="loader-status">
          <div className="status-line">
            <span className="status-bracket">[</span>
            <span className="status-code">{String(phase + 1).padStart(2, "0")}/{String(PHASES.length).padStart(2, "0")}</span>
            <span className="status-bracket">]</span>
            <span className="status-text">
              {PHASES[phase]}
              <span className={`status-cursor ${tick % 2 ? "on" : ""}`}>▍</span>
            </span>
          </div>

          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${((phase + 1) / PHASES.length) * 100}%` }}
            />
            <div className="progress-shine" />
          </div>

          <div className="telemetry">
            <span><i className="dot live" /> LINK</span>
            <span>LAT 12.97°N</span>
            <span>LNG 77.59°E</span>
            <span className="mono-tick">T+{String(tick).padStart(4, "0")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
