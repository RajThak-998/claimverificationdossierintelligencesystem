import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Camera, Square, AlertCircle, Phone, X } from 'lucide-react';
import { CaptureState } from '../services/capture/types';
import { CaptureBroadcastBridge } from '../services/capture/broadcastBridge';
import { getCaptureService } from '../services/capture';

interface CallOverlayProps {
  onStop?: () => void;
  onCapture?: () => void;
  onClose?: () => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({ onStop, onCapture, onClose }) => {
  const [state, setState] = useState<CaptureState>(() => getCaptureService().getState());
  const [capFlash, setCapFlash] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // 1. Direct subscription (works if in same window/PiP)
    const service = getCaptureService();
    const unsub = service.subscribe((s) => {
      setState(s);
      if (s.lastScreenshotToast) {
        setToast(s.lastScreenshotToast);
      }
    });

    // 2. BroadcastChannel subscription (works across popup window or Electron process)
    const bridge = new CaptureBroadcastBridge();
    const unsubBridge = bridge.onMessage((msg) => {
      if (msg.type === 'STATE_UPDATE') {
        setState(msg.payload);
      } else if (msg.type === 'TOAST_FEEDBACK') {
        setToast(msg.message);
        setTimeout(() => setToast(null), 3000);
      }
    });

    // Request initial state from main tab in case running in standalone window
    bridge.postMessage({ type: 'CMD_REQUEST_STATE' });

    return () => {
      unsub();
      unsubBridge();
      bridge.destroy();
    };
  }, []);

  const handleCapture = () => {
    setCapFlash(true);
    setTimeout(() => setCapFlash(false), 300);

    if (onCapture) {
      onCapture();
      return;
    }

    // Try direct service call first, otherwise broadcast command
    try {
      const service = getCaptureService();
      if (service.getState().hasActiveStream) {
        service.takeScreenshot().catch(() => {
          // If error or running in standalone window, fallback to bridge
          const bridge = new CaptureBroadcastBridge();
          bridge.postMessage({ type: 'CMD_TAKE_SCREENSHOT' });
          bridge.destroy();
        });
        return;
      }
    } catch {}

    const bridge = new CaptureBroadcastBridge();
    bridge.postMessage({ type: 'CMD_TAKE_SCREENSHOT' });
    bridge.destroy();
  };

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);

    if (onStop) {
      onStop();
      return;
    }

    try {
      const service = getCaptureService();
      if (service.getState().isRecording) {
        await service.stopRecording();
        setStopping(false);
        return;
      }
    } catch {}

    const bridge = new CaptureBroadcastBridge();
    bridge.postMessage({ type: 'CMD_STOP_RECORDING' });
    bridge.destroy();
    setStopping(false);
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      window.close();
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-2 bg-transparent select-none">
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl text-white">
        {/* Case / Phone info pill */}
        {(state.caseNumber || state.contactPhone) && (
          <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] font-mono text-slate-300">
            {state.caseNumber && <span className="font-bold text-white">{state.caseNumber}</span>}
            {state.contactPhone && (
              <span className="flex items-center text-slate-400">
                <Phone className="w-3 h-3 mr-1 text-emerald-400" />
                {state.contactPhone}
              </span>
            )}
          </div>
        )}

        {/* ═══ BUTTON 1: STOP RECORDING ═══ */}
        <button
          onClick={handleStop}
          disabled={stopping || !state.isRecording}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 ${
            state.isRecording
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/50'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
          title="Stop and save call recording"
        >
          {state.isRecording && (
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          )}
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>{stopping ? 'SAVING...' : 'STOP'}</span>
          <span className="font-mono text-[11px] bg-black/40 px-1.5 py-0.5 rounded font-bold ml-0.5">
            {formatTimer(state.elapsedSeconds)}
          </span>
        </button>

        {/* ═══ BUTTON 2: INSTANT CAPTURE SCREENSHOT ═══ */}
        <button
          onClick={handleCapture}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 ${
            capFlash
              ? 'bg-emerald-400 text-slate-950 ring-4 ring-emerald-300 scale-105'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40'
          }`}
          title="Grab instantaneous video screenshot with exact offset"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>CAPTURE</span>
          {state.screenshotCount > 0 && (
            <span className="font-mono text-[10px] bg-black/30 text-emerald-200 px-1.5 py-0.5 rounded-full font-bold">
              {state.screenshotCount}
            </span>
          )}
        </button>

        {/* Toast feedback */}
        {(toast || state.lastScreenshotToast) && (
          <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full animate-fade-in truncate max-w-[140px]">
            {toast || state.lastScreenshotToast}
          </span>
        )}

        {/* Error pill if any */}
        {state.error && (
          <span
            className="flex items-center text-[10px] text-rose-300 bg-rose-950/80 border border-rose-500/40 px-2 py-0.5 rounded-full truncate max-w-[150px]"
            title={state.error}
          >
            <AlertCircle className="w-3 h-3 mr-1 text-rose-400 shrink-0" />
            {state.error}
          </span>
        )}

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="p-1 hover:text-rose-400 text-slate-400 rounded-full hover:bg-slate-800 transition-colors ml-1"
          title="Close overlay"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/**
 * Helper to mount CallOverlay into Document Picture-in-Picture window container
 */
export function mountCallOverlayInContainer(
  container: HTMLElement,
  _service: any,
  onClose?: () => void
): () => void {
  const root = ReactDOM.createRoot(container);
  root.render(<CallOverlay onClose={onClose} />);
  return () => {
    root.unmount();
  };
}
