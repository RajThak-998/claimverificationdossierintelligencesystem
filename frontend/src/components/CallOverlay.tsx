import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Camera, Square, Circle, GripVertical, X } from 'lucide-react';
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

  // ═══════════════════════════════════════════════════════════════════════
  // Separate Draggable Positions (Saved to localStorage)
  // ═══════════════════════════════════════════════════════════════════════
  const getInitialPos = (key: string, defaultX: number, defaultY: number) => {
    if (typeof window === 'undefined') return { x: defaultX, y: defaultY };
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.x === 'number' &&
          typeof parsed.y === 'number' &&
          parsed.x >= 0 &&
          parsed.x < window.innerWidth &&
          parsed.y >= 0 &&
          parsed.y < window.innerHeight
        ) {
          return parsed;
        }
      }
    } catch {}
    return { x: defaultX, y: defaultY };
  };

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 720;

  // Widget 1: Recording Button position (Default: bottom-center left)
  const [posRec, setPosRec] = useState<{ x: number; y: number }>(() =>
    getInitialPos('overlay_rec_pill_pos', Math.max(20, Math.floor(winW / 2) - 170), Math.max(20, winH - 80))
  );

  // Widget 2: Screenshot Button position (Default: bottom-center right)
  const [posCap, setPosCap] = useState<{ x: number; y: number }>(() =>
    getInitialPos('overlay_cap_pill_pos', Math.max(20, Math.floor(winW / 2) + 20), Math.max(20, winH - 80))
  );

  // Dragging refs
  const dragRecRef = useRef({ isDragging: false, startX: 0, startY: 0, posX: 0, posY: 0 });
  const dragCapRef = useRef({ isDragging: false, startX: 0, startY: 0, posX: 0, posY: 0 });

  useEffect(() => {
    // 1. Direct service subscription
    const service = getCaptureService();
    const unsub = service.subscribe((s) => {
      setState(s);
      if (s.lastScreenshotToast) {
        setToast(s.lastScreenshotToast);
      }
    });

    // 2. BroadcastChannel subscription
    const bridge = new CaptureBroadcastBridge();
    const unsubBridge = bridge.onMessage((msg) => {
      if (msg.type === 'STATE_UPDATE') {
        setState((prev) => ({ ...prev, ...msg.payload }));
      } else if (msg.type === 'TOAST_FEEDBACK') {
        setToast(msg.message);
        setTimeout(() => setToast(null), 2500);
      }
    });

    // 3. Electron IPC subscription
    let unsubIpcState: (() => void) | undefined;
    let unsubIpcToast: (() => void) | undefined;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay) {
      if (electronAPI.overlay.onState) {
        unsubIpcState = electronAPI.overlay.onState((newState: CaptureState) => {
          setState((prev) => ({ ...prev, ...newState }));
          if (newState.lastScreenshotToast) {
            setToast(newState.lastScreenshotToast);
          }
        });
      }
      if (electronAPI.overlay.onToast) {
        unsubIpcToast = electronAPI.overlay.onToast((msg: string) => {
          setToast(msg);
          setTimeout(() => setToast(null), 2500);
        });
      }
      if (electronAPI.overlay.sendCommand) {
        electronAPI.overlay.sendCommand('CMD_REQUEST_STATE');
      }
    }

    bridge.postMessage({ type: 'CMD_REQUEST_STATE' });

    return () => {
      unsub();
      unsubBridge();
      bridge.destroy();
      unsubIpcState?.();
      unsubIpcToast?.();
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // Action Handlers
  // ═══════════════════════════════════════════════════════════════════════

  const handleCapture = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCapFlash(true);
    setTimeout(() => setCapFlash(false), 250);

    if (onCapture) {
      onCapture();
      return;
    }

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.sendCommand) {
      electronAPI.overlay.sendCommand('CMD_TAKE_SCREENSHOT');
      return;
    }

    try {
      const service = getCaptureService();
      if (service.getState().hasActiveStream) {
        service.takeScreenshot().catch(() => {
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

  const handleStop = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (stopping) return;
    setStopping(true);

    if (onStop) {
      onStop();
      return;
    }

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.sendCommand) {
      electronAPI.overlay.sendCommand('CMD_STOP_RECORDING');
      setStopping(false);
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

  const handleClose = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onClose) {
      onClose();
    } else {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.overlay?.hide) {
        electronAPI.overlay.hide();
      } else {
        window.close();
      }
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Pointer Dragging Mechanics (Fluid & Bounds-Constrained)
  // ═══════════════════════════════════════════════════════════════════════

  const handlePointerDownRec = (e: React.PointerEvent<HTMLDivElement>) => {
    // If clicking a button directly, don't drag
    if ((e.target as HTMLElement)?.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRecRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      posX: posRec.x,
      posY: posRec.y,
    };
  };

  const handlePointerMoveRec = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRecRef.current.isDragging) return;
    const dx = e.clientX - dragRecRef.current.startX;
    const dy = e.clientY - dragRecRef.current.startY;
    const nextX = Math.max(10, Math.min(window.innerWidth - 180, dragRecRef.current.posX + dx));
    const nextY = Math.max(10, Math.min(window.innerHeight - 50, dragRecRef.current.posY + dy));
    setPosRec({ x: nextX, y: nextY });
  };

  const handlePointerUpRec = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRecRef.current.isDragging) {
      dragRecRef.current.isDragging = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      localStorage.setItem('overlay_rec_pill_pos', JSON.stringify(posRec));
    }
  };

  const handlePointerDownCap = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragCapRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      posX: posCap.x,
      posY: posCap.y,
    };
  };

  const handlePointerMoveCap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragCapRef.current.isDragging) return;
    const dx = e.clientX - dragCapRef.current.startX;
    const dy = e.clientY - dragCapRef.current.startY;
    const nextX = Math.max(10, Math.min(window.innerWidth - 180, dragCapRef.current.posX + dx));
    const nextY = Math.max(10, Math.min(window.innerHeight - 50, dragCapRef.current.posY + dy));
    setPosCap({ x: nextX, y: nextY });
  };

  const handlePointerUpCap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragCapRef.current.isDragging) {
      dragCapRef.current.isDragging = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      localStorage.setItem('overlay_cap_pill_pos', JSON.stringify(posCap));
    }
  };

  return (
    <>
      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* SEPARATE BUTTON 1: MINIMAL RECORDING / STOP PILL                  */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <div
        id="call-overlay-rec-pill"
        data-overlay-interactive="true"
        onPointerDown={handlePointerDownRec}
        onPointerMove={handlePointerMoveRec}
        onPointerUp={handlePointerUpRec}
        style={{
          position: 'fixed',
          left: `${posRec.x}px`,
          top: `${posRec.y}px`,
          touchAction: 'none',
        }}
        className="z-[99999] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl text-white select-none cursor-grab active:cursor-grabbing transition-shadow hover:shadow-rose-950/30 hover:border-slate-600"
        title="Drag anywhere on your screen"
      >
        {/* Subtle Grip Drag Indicator */}
        <GripVertical className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 pointer-events-none shrink-0" />

        {/* Action Button: STOP or REC */}
        <button
          onClick={handleStop}
          disabled={stopping || !state.isRecording}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 cursor-pointer ${
            state.isRecording
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/50'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
          title={state.isRecording ? 'Click to stop and save call recording' : 'Not currently recording'}
        >
          {state.isRecording ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              <Square className="w-3 h-3 fill-current" />
              <span>{stopping ? 'SAVING…' : 'STOP'}</span>
            </>
          ) : (
            <>
              <Circle className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
              <span>REC</span>
            </>
          )}
        </button>

        {/* Minimal Monospaced Timer Pill */}
        {state.isRecording && (
          <span className="font-mono text-xs font-bold text-rose-200 bg-rose-950/80 border border-rose-500/40 px-2 py-0.5 rounded-full">
            {formatTimer(state.elapsedSeconds)}
          </span>
        )}

        {/* Minimal Close Button */}
        <button
          onClick={handleClose}
          className="p-1 hover:text-rose-400 text-slate-500 hover:bg-slate-800/80 rounded-full transition-colors cursor-pointer"
          title="Hide widget"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* SEPARATE BUTTON 2: MINIMAL SCREENSHOT CAPTURE PILL               */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <div
        id="call-overlay-cap-pill"
        data-overlay-interactive="true"
        onPointerDown={handlePointerDownCap}
        onPointerMove={handlePointerMoveCap}
        onPointerUp={handlePointerUpCap}
        style={{
          position: 'fixed',
          left: `${posCap.x}px`,
          top: `${posCap.y}px`,
          touchAction: 'none',
        }}
        className={`z-[99999] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl text-white select-none cursor-grab active:cursor-grabbing transition-all hover:shadow-emerald-950/30 hover:border-slate-600 ${
          capFlash ? 'ring-4 ring-emerald-400 scale-105' : ''
        }`}
        title="Drag anywhere on your screen"
      >
        {/* Subtle Grip Drag Indicator */}
        <GripVertical className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 pointer-events-none shrink-0" />

        {/* Action Button: CAPTURE */}
        <button
          onClick={handleCapture}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 cursor-pointer"
          title="Instant screenshot frame grab (tagged with exact timestamp)"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>CAPTURE</span>
        </button>

        {/* Screenshot Count Badge */}
        {state.screenshotCount > 0 && (
          <span className="font-mono text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded-full font-bold">
            {state.screenshotCount}
          </span>
        )}

        {/* Instant Toast Feedback */}
        {toast && (
          <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/90 border border-emerald-500/40 px-2 py-0.5 rounded-full animate-fade-in truncate max-w-[120px]">
            {toast}
          </span>
        )}
      </div>
    </>
  );
};

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
