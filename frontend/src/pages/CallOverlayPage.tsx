import React, { useEffect } from 'react';
import { CallOverlay } from '../components/CallOverlay';

export const CallOverlayPage: React.FC = () => {
  useEffect(() => {
    // Set document background transparent for frameless/floating overlay
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-transparent">
      <CallOverlay onClose={() => window.close()} />
    </div>
  );
};
