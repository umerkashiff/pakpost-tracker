'use client';

import React from 'react';
import { GradientAscii, GradientAsciiProps } from './gradient-ascii/gradient-ascii';

export type { GradientAsciiProps };

export default function GradientASCII(props: GradientAsciiProps) {
  return (
    <GradientAscii
      controls={false}
      autoplay={false}
      decorative={true}
      {...props}
    />
  );
}

export { GradientASCII };

