'use client';

import React from 'react';
import { GradientAscii, GradientAsciiProps } from './gradient-ascii/gradient-ascii';
import { CHARACTER_SETS } from './gradient-ascii/presets';

export type { GradientAsciiProps };

export default function GradientASCII(props: GradientAsciiProps) {
  return (
    <div className="w-full h-full relative overflow-hidden">
      <GradientAscii
        controls={false}
        autoplay={false}
        decorative={true}
        shape="pinch"
        colors={props.colors || ['#0d9488', '#5eead4', '#f0fdfa']}
        characters={props.characters || CHARACTER_SETS.Classic}
        cellSize={props.cellSize ?? 16}
        density={props.density ?? 0.8}
        glyphOpacity={props.glyphOpacity ?? 0.85}
        gradientOpacity={props.gradientOpacity ?? 0.9}
        glow={props.glow ?? 0.2}
        depthOfField={props.depthOfField ?? 10}
        flicker={props.flicker ?? 0.2}
        softness={props.softness ?? 0.5}
        scale={props.scale ?? 1}
        flow={props.flow ?? 0.5}
        speed={props.speed ?? 1}
        grain={props.grain ?? 0.08}
        variation={props.variation ?? 0}
        scrambleRadius={props.scrambleRadius ?? 0.1}
        mouseInteraction={props.mouseInteraction ?? true}
        clickEffect={props.clickEffect || 'wave'}
        {...props}
      />
    </div>
  );
}

export { GradientASCII };
