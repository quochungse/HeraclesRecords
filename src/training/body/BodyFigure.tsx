// Overview's body figure: a low-poly wireframe of the athlete's sex, shaped by
// their height and weight, toned by their VO2max, lit from the feet up to their
// recovery.
//
// SVG, from paths worked out once per body (bodyFigureDrawing.ts). It was
// WebGL — three.js, a bloom pass, a GPU context held for the panel — and it
// is SVG because the two draw the same picture and SVG costs none of that: no
// context, nothing redrawn when the stage changes size (the drawing scales
// with its box; WebGL showed the old frame stretched on every step of a
// window zoom until it drew again), and no GPU needed at all. Every colour
// and strength is a custom property on the stage, so a theme switch is the
// stylesheet's alone.

import { useId, type CSSProperties } from "react";
import { blendFigure, type FigureTone } from "./bodyFigureMath";
import { drawFigure, type FigureDrawing } from "./bodyFigureDrawing";
import { readFigureFile } from "./figureFile";
import type { FigureSex } from "./physique";

export interface BodyFigureProps {
  sex: FigureSex;
  /** The height-adjusted BMI the figure is shaped by (`readPhysique`). */
  shape: number;
  /** 0–1, how far towards its toned twin (`readFirmness`). */
  firmness: number;
  /** Recovery, 0–100. Undefined draws the whole figure in the idle colour. */
  level?: number;
  tone: FigureTone;
}

// A shape's paths never change, so a return to Overview reuses them; the
// shape is kept to a tenth and the firmness to a twentieth, finer than a line
// on screen can show. Each layer carries its share of its kind's strength as
// `--figure-layer`; the stylesheet multiplies it by the theme's.
const drawings = new Map<string, FigureDrawing>();

function drawingFor(sex: FigureSex, shape: number, firmness: number): FigureDrawing {
  const roundedShape = Math.round(shape * 10) / 10;
  const roundedFirmness = Math.round(firmness * 20) / 20;
  const key = `${sex}:${roundedShape}:${roundedFirmness}`;
  let drawing = drawings.get(key);
  if (!drawing) {
    drawing = drawFigure(blendFigure(readFigureFile(), sex, roundedShape, roundedFirmness));
    drawings.set(key, drawing);
  }
  return drawing;
}

export function BodyFigure({ sex, shape, firmness, level, tone }: BodyFigureProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const drawing = drawingFor(sex, shape, firmness);
  // No reading lights the whole figure in the idle colour (`--figure-tone`).
  const fill = tone === "neutral" || level === undefined ? 1 : level / 100;
  const levelY = drawing.levelY(fill);
  const lines = `url(#${id}-lines)`;

  return (
    <svg
      className="body-figure"
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <defs>
        {/* Lit below the line, dim above, across a soft band. */}
        <linearGradient
          id={`${id}-lines`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={levelY - drawing.levelEdge}
          y2={levelY + drawing.levelEdge}
        >
          <stop offset="0" className="body-figure-dim" />
          <stop offset="1" className="body-figure-lit" />
        </linearGradient>
        {/* The glow is two things. The lines' own, a tight blur added back
            onto them; and a halo, the outline blurred wide under the opaque
            skin so only what spills past the edge shows — glowing the lines
            wide instead lights the whole body as a haze. In the drawing's
            units, so both keep their share of the figure at any size. */}
        <filter id={`${id}-bloom`} x="-10%" y="-5%" width="120%" height="110%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="near" />
          <feComposite in="SourceGraphic" in2="near" operator="arithmetic" k2="1" k3="0.6" />
        </filter>
        <filter id={`${id}-halo`} x="-30%" y="-15%" width="160%" height="130%">
          <feGaussianBlur stdDeviation="60" />
        </filter>
      </defs>
      <path className="body-figure-halo" d={drawing.skin} fill={lines} filter={`url(#${id}-halo)`} />
      <path className="body-figure-skin" d={drawing.skin} />
      <g className="body-figure-rim">
        {drawing.rim.map((layer) => (
          <path
            key={layer.strength}
            d={layer.d}
            style={{ "--figure-layer": layer.strength } as CSSProperties}
          />
        ))}
      </g>
      {/* The far side's lines over the skin, faint, and glowing with the
          front's: on an opaque skin they are what shows the mesh's depth. */}
      <g className="body-figure-lines" stroke={lines} filter={`url(#${id}-bloom)`}>
        {(["back", "front"] as const).map((side) => (
          <g key={side} className={`body-figure-${side}`}>
            {drawing[side].map((layer) => (
              <path
                key={layer.strength}
                d={layer.d}
                style={{ "--figure-layer": layer.strength } as CSSProperties}
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
