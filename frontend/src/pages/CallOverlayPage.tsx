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

    // Click-through toggle for Electron:
    // If hovering over either the REC pill or the CAPTURE pill, enable mouse events.
    // If hovering outside over the transparent canvas, forward events through to WhatsApp.
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.setIgnoreMouseEvents) {
      let isIgnoring = true;
      electronAPI.setIgnoreMouseEvents(true, { forward: true });

      const onMouseMove = (e: MouseEvent) => {
        // While dragging or clicking (any mouse button held down), NEVER toggle ignore mouse events!
        if (e.buttons !== 0) return;

        const target = e.target as HTMLElement | null;
        // Check if cursor is over any element tagged with data-overlay-interactive="true"
        const isOverInteractive = !!target?.closest('[data-overlay-interactive="true"]');

        if (isOverInteractive && isIgnoring) {
          electronAPI.setIgnoreMouseEvents(false);
          isIgnoring = false;
        } else if (!isOverInteractive && !isIgnoring) {
          electronAPI.setIgnoreMouseEvents(true, { forward: true });
          isIgnoring = true;
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        document.documentElement.style.background = '';
        document.body.style.background = '';
        document.body.style.overflow = '';
      };
    }

    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="w-screen h-screen relative bg-transparent overflow-hidden select-none">
      <CallOverlay
        onClose={() => {
          const electronAPI = (window as any).electronAPI;
          if (electronAPI?.overlay?.hide) {
            electronAPI.overlay.hide();
          } else {
            window.close();
          }
        }}
      />
    </div>
  );
};
