import React from 'react';

export default function TuringramLogo({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size}>
      <defs>
        <filter id="tg-glow" colorInterpolationFilters="sRGB" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="512" height="512" fill="#020210" rx="64"/>
      <text x="256" y="68" textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize="22" fontWeight="700" letterSpacing="0.2" fill="#40EFAB">You were saying that it records your</text>
      <text x="256" y="100" textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize="22" fontWeight="700" letterSpacing="0.2" fill="#40EFAB">system audio and transcribes it</text>
      <text x="256" y="132" textAnchor="middle" fontFamily="'Space Grotesk',system-ui,sans-serif" fontSize="22" fontWeight="700" letterSpacing="0.2" fill="#40EFAB">without a bot in the call…</text>
      <g filter="url(#tg-glow)" fill="#40EFAB">
        <rect x="199" y="212" width="10" height="260" rx="2"/>
        <rect x="212" y="188" width="10" height="284" rx="2"/>
        <rect x="225" y="170" width="10" height="302" rx="2"/>
        <rect x="238" y="205" width="10" height="267" rx="2"/>
        <rect x="251" y="160" width="10" height="312" rx="2"/>
        <rect x="264" y="164" width="10" height="308" rx="2"/>
        <rect x="277" y="185" width="10" height="287" rx="2"/>
        <rect x="290" y="199" width="10" height="273" rx="2"/>
        <rect x="303" y="228" width="10" height="244" rx="2"/>
      </g>
    </svg>
  );
}
