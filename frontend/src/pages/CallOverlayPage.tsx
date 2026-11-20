import React, { useEffect, useState } from 'react';
import { CallOverlay } from '../components/CallOverlay';

export const CallOverlayPage: React.FC = () => {
  const [mode, setMode] = useState<'rec' | 'cap' | 'both'>('both');

  useEffect(() => {
    // Set document background transparent for frameless floating pill window
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';

    // Parse mode from URL search/hash
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('mode=rec') || search.includes('mode=rec')) {
      setMode('rec');
    } else if (hash.includes('mode=cap') || search.includes('mode=cap')) {
      setMode('cap');
    } else {
      setMode('both');
    }

    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      className={
        mode === 'both'
          ? 'w-screen h-screen relative bg-transparent overflow-hidden select-none'
          : 'w-full h-full flex items-center justify-center bg-transparent overflow-hidden select-none'
      }
    >
      <CallOverlay
        mode={mode}
        onClose={() => {
          const electronAPI = (window as any).electronAPI;
          if (electronAPI?.overlay?.hide) {
            electronAPI.overlay.hide(mode !== 'both' ? mode : undefined);
          } else {
            window.close();
          }
        }}
      />
    </div>
  );
};
