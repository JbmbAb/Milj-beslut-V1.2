import React from 'react';

export const MpsCompass: React.FC<any> = ({ size, ringColor, coreColor }) => (
  <svg width={size} height={size} viewBox='0 0 100 100'>
    <circle cx="50" cy="50" r="45" stroke={ringColor} strokeWidth="2" fill="none" />
    <circle cx="50" cy="50" r="10" fill={coreColor} />
  </svg>
);
