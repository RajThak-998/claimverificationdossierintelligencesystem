import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Square,
  Camera,
  Circle,
  GripVertical,
  X,
  ExternalLink,
  MessageSquare,
  Pause,
  Play,
} from 'lucide-react';
import { api } from '../api/client';

interface SeparateCallWidgetsProps {
  caseId: string;
  caseNumber?: string;
  contactPhone?: string;
  contactName?: string;
  onClose: () => void;
  onRecordingSaved?: () => void;
}

/**
 * SeparateCallWidgets — OS-level Always-On-Top floating REC + CAPTURE buttons.
 *
 * Uses the Document Picture-in-Picture API (Chrome 116+) to create a small
 * OS-native window that floats ABOVE ALL browser tabs — including the WhatsApp
 * Web tab the agent just opened. The buttons control screen recording and
 * live screenshot capture powered by getDisplayMedia, and upload results
 * directly to the backend via the existing API.
 *
 * Fallback: If Document PiP is unavailable, renders as fixed-position draggable
 * pills within the original tab (z-index 99999).
 */
export const SeparateCallWidgets: React.FC<SeparateCallWidgetsProps> = ({
  caseId,
  caseNumber,
  contactPhone,
  contactName,
  onClose,
  onRecordingSaved,
}) => {
  // ─── Stream & Recorder refs ────────────────────────────────────────────
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  // ─── PiP ───────────────────────────────────────────────────────────────
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipSupported] = useState(() => 'documentPictureInPicture' in window);
  const pipContainerRef = useRef<HTMLDivElement | null>(null);

  // ─── Draggable positions (in-tab fallback only) ────────────────────────
  const [widgetPos, setWidgetPos] = useState<{ x: number; y: number }>({
    x: Math.max(20, window.innerWidth / 2 - 230),
    y: Math.max(20, window.innerHeight - 90),
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ startX: 0, startY: 0, posX: 0, posY: 0 });

  // ─── Recording state ──────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recToast, setRecToast] = useState<string | null>(null);

  // ─── Snapshot state ───────────────────────────────────────────────────
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capFlash, setCapFlash] = useState(false);
  const [capToast, setCapToast] = useState<string | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  /** Attach a combined stream to our hidden <video> and wire track-end. */
  const attachStream = useCallback((stream: MediaStream) => {
    mediaStreamRef.current = stream;
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      videoTrackRef.current = vTrack;
      vTrack.onended = () => {
        // User clicked Chrome's native "Stop sharing" bar
        handleStopRecording();
      };
    }
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.srcObject = stream;
      hiddenVideoRef.current.play().catch(() => {});
    }
  }, []);

  /** Acquire or reuse a live display+mic stream. */
  const ensureLiveStream = async (): Promise<MediaStream> => {
    const cur = mediaStreamRef.current;
    const vt = cur?.getVideoTracks()[0];
    if (cur && vt && vt.readyState === 'live') return cur;

    // Prompt user to pick a tab / window / screen to share
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window' } as any,
      audio: true,
    });

    // Optional microphone audio
    let micStream: MediaStream | null = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // mic denied — no problem
    }

    const finalTracks: MediaStreamTrack[] = [];
    const newVTrack = displayStream.getVideoTracks()[0];
    if (newVTrack) finalTracks.push(newVTrack);

    // Mix display audio + mic audio via Web Audio API
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const mixedDest = audioCtx.createMediaStreamDestination();

      if (displayStream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(displayStream).connect(mixedDest);
      }
      if (micStream && micStream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(micStream).connect(mixedDest);
      }
      if (mixedDest.stream.getAudioTracks().length > 0) {
        finalTracks.push(mixedDest.stream.getAudioTracks()[0]);
      }
    } catch (aErr) {
      console.warn('Audio mix notice:', aErr);
    }

    const combined = new MediaStream(finalTracks);
    attachStream(combined);
    return combined;
  };

  // ─── PiP Window ────────────────────────────────────────────────────────

  const openPipWindow = useCallback(async () => {
    if (!('documentPictureInPicture' in window)) return;

    try {
      const pip: Window = await (window as any).documentPictureInPicture.requestWindow({
        width: 480,
        height: 70,
      });

      // Copy all stylesheets into PiP window so Tailwind classes work
      [...document.styleSheets].forEach((sheet) => {
        try {
          const cssText = [...sheet.cssRules].map((r) => r.cssText).join('\n');
          const style = pip.document.createElement('style');
          style.textContent = cssText;
          pip.document.head.appendChild(style);
        } catch {
          if (sheet.href) {
            const link = pip.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            pip.document.head.appendChild(link);
          }
        }
      });

      pip.document.body.style.cssText =
        'margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;';

      pip.addEventListener('pagehide', () => {
        setPipWindow(null);
      });

      setPipWindow(pip);
    } catch (err) {
      console.warn('PiP window cancelled:', err);
    }
  }, []);

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    // Auto-open PiP on mount so buttons float over WhatsApp immediately
    if (pipSupported) {
      openPipWindow();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Close PiP window on unmount
  useEffect(() => {
    return () => {
      if (pipWindow) {
        try { pipWindow.close(); } catch {}
      }
    };
  }, [pipWindow]);

  // ─── Drag (in-tab fallback) ────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button:not([data-drag])')) return;
    setIsDragging(true);
    dragOffset.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: widgetPos.x,
      posY: widgetPos.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragOffset.current.startX;
      const dy = e.clientY - dragOffset.current.startY;
      setWidgetPos({
        x: Math.min(Math.max(10, dragOffset.current.posX + dx), window.innerWidth - 400),
        y: Math.min(Math.max(10, dragOffset.current.posY + dy), window.innerHeight - 60),
      });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // ─── START RECORDING ───────────────────────────────────────────────────

  const handleStartRecording = async () => {
    try {
      setIsStarting(true);
      setRecToast(null);

      const activeStream = await ensureLiveStream();

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(activeStream, {
        mimeType,
        videoBitsPerSecond: 1_200_000,
      });

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current = recorder;
      // Gather slices every 500ms so buffer is continuously populated
      recorder.start(500);

      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((p) => p + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Recording start error:', err);
      setRecToast('Screen share cancelled');
      setTimeout(() => setRecToast(null), 3000);
    } finally {
      setIsStarting(false);
    }
  };

  // ─── PAUSE / RESUME ────────────────────────────────────────────────────

  const handleTogglePause = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || !isRecording) return;

    if (rec.state === 'recording') {
      rec.pause();
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } else if (rec.state === 'paused') {
      rec.resume();
      setIsPaused(false);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((p) => p + 1);
      }, 1000);
    }
  };

  // ─── STOP RECORDING & DIRECT UPLOAD ────────────────────────────────────

  const handleStopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) return;

    // Stop elapsed timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
    setIsSaving(true);
    setRecToast('Saving recording…');

    const duration = Math.max(1, elapsedSeconds);

    try {
      // 1. Force-flush any pending buffered data
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        try { recorder.requestData(); } catch {}
      }

      // 2. Await the recorder's stop event to guarantee all data has fired
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          resolve();
        }
      });

      // 3. Assemble the full blob from all accumulated chunks
      const fullBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      console.log('Recording assembled:', fullBlob.size, 'bytes, duration:', duration, 's');

      if (fullBlob.size === 0) {
        throw new Error('Recording captured 0 bytes — was screen sharing active?');
      }

      // 4. Release hardware tracks (screen share indicator disappears)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      videoTrackRef.current = null;

      // 5. Upload the finalized video to the backend
      await api.uploadDirectRecording(caseId, fullBlob, duration);

      setRecToast(`✅ Saved (${Math.floor(duration / 60)}m ${duration % 60}s)`);
      if (onRecordingSaved) onRecordingSaved();
      setTimeout(() => setRecToast(null), 4000);
    } catch (err: any) {
      console.error('Recording upload failed:', err);
      setRecToast(`⚠️ ${err.message || 'Save failed'}`);
      setTimeout(() => setRecToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── CAPTURE SCREENSHOT ────────────────────────────────────────────────

  const handleCaptureSnapshot = async () => {
    try {
      setIsCapturing(true);
      setCapFlash(true);
      setTimeout(() => setCapFlash(false), 300);

      const activeStream = await ensureLiveStream();
      const track = activeStream.getVideoTracks()[0];
      const video = hiddenVideoRef.current;

      const canvas = document.createElement('canvas');
      let captured = false;

      // Method A: Native Chromium ImageCapture API
      if (typeof (window as any).ImageCapture === 'function' && track) {
        try {
          const ic = new (window as any).ImageCapture(track);
          const bitmap = await ic.grabFrame();
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          captured = true;
        } catch (icErr) {
          console.warn('ImageCapture fallback:', icErr);
        }
      }

      // Method B: Hidden <video> element fallback
      if (!captured && video && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        captured = true;
      }

      if (!captured) {
        throw new Error('Video frame not ready — click REC first');
      }

      // Convert canvas → PNG blob and upload
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Canvas toBlob returned null');

      await api.uploadScreenshot(
        caseId,
        blob,
        elapsedSeconds,
        `Live field capture at ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
      );

      setSnapshotCount((p) => p + 1);
      setCapToast(`📸 Saved #${snapshotCount + 1}`);
      setTimeout(() => setCapToast(null), 2500);
      if (onRecordingSaved) onRecordingSaved();
    } catch (err: any) {
      console.error('Snapshot failed:', err);
      setCapToast(err.message || 'Capture failed');
      setTimeout(() => setCapToast(null), 3000);
    } finally {
      setIsCapturing(false);
    }
  };

  // ─── Open WhatsApp ─────────────────────────────────────────────────────

  const handleOpenWhatsApp = () => {
    if (contactPhone) {
      const clean = contactPhone.replace(/[^0-9]/g, '');
      window.open(`https://web.whatsapp.com/send?phone=${clean}`, '_blank');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  RENDER: Shared controls UI (used in both PiP and in-tab fallback)
  // ═══════════════════════════════════════════════════════════════════════

  const renderControls = (isPiP: boolean) => (
    <div className="flex items-center space-x-2 select-none p-1">
      {/* Case Badge */}
      <div className="hidden sm:flex flex-col border-r border-slate-700/80 pr-2 mr-1">
        <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider leading-tight">
          {caseNumber || 'CALL'}
        </span>
        <span className="text-[10px] text-slate-300 font-medium truncate max-w-[80px] leading-tight">
          {contactName || contactPhone || 'Session'}
        </span>
      </div>

      {/* ═══ BUTTON 1: REC / STOP ═══ */}
      <div className="rounded-full bg-slate-900/95 backdrop-blur-md border border-slate-700/90 text-white px-2.5 py-1 flex items-center space-x-1.5 shadow-2xl">
        {isRecording ? (
          <div className="flex items-center space-x-1.5">
            <button
              onClick={handleStopRecording}
              disabled={isSaving}
              className="group flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/90 hover:bg-rose-950/80 border border-rose-500/80 hover:border-rose-400 text-white font-bold text-xs tracking-wide transition-all shadow-sm"
              title="Stop recording and save video"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
              </span>
              <Square className="w-2.5 h-2.5 text-rose-400 fill-rose-400" />
              <span>■ STOP</span>
              <span className="pl-1 border-l border-rose-500/40 font-mono text-rose-300 text-[11px]">
                {formatTimer(elapsedSeconds)}
              </span>
            </button>

            <button
              onClick={handleTogglePause}
              disabled={isSaving}
              className={`p-1.5 rounded-full border text-xs transition-colors ${
                isPaused
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 hover:bg-amber-500/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play className="w-3 h-3 fill-amber-300" /> : <Pause className="w-3 h-3" />}
            </button>
          </div>
        ) : (
          <button
            onClick={handleStartRecording}
            disabled={isStarting || isSaving}
            className="flex items-center space-x-1.5 px-3.5 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide transition-all shadow-md shadow-rose-900/40 active:scale-95"
            title="Start recording"
          >
            <Circle className="w-2 h-2 fill-white text-white animate-pulse" />
            <span>{isStarting ? 'Selecting…' : '● REC'}</span>
          </button>
        )}

        {recToast && (
          <span className="text-[10px] text-slate-300 font-medium px-1 truncate max-w-[120px]">
            {recToast}
          </span>
        )}
      </div>

      {/* ═══ BUTTON 2: CAPTURE ═══ */}
      <div
        className={`rounded-full bg-slate-900/95 backdrop-blur-md border border-teal-500/80 text-white px-2.5 py-1 flex items-center space-x-1.5 shadow-2xl transition-all ${
          capFlash ? 'ring-4 ring-teal-400 scale-105' : ''
        }`}
      >
        <button
          onClick={handleCaptureSnapshot}
          disabled={isCapturing}
          className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/90 hover:bg-teal-950/80 border border-teal-500/80 text-teal-300 font-bold text-xs tracking-wide transition-all active:scale-95 shadow-sm shadow-teal-900/30"
          title="Capture live screenshot"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
          <Camera className="w-3 h-3 text-teal-300" />
          <span>CAPTURE</span>
          {snapshotCount > 0 && (
            <span className="ml-0.5 px-1.5 rounded-full bg-teal-500/30 text-teal-200 text-[10px] font-mono">
              {snapshotCount}
            </span>
          )}
        </button>
        {capToast && (
          <span className="text-[10px] text-teal-300 font-medium px-1 truncate max-w-[100px]">
            {capToast}
          </span>
        )}
      </div>

      {/* ═══ Auxiliary: WhatsApp, PiP toggle, Close ═══ */}
      <div className="flex items-center space-x-1 pl-1 border-l border-slate-700/70">
        {contactPhone && (
          <button
            onClick={handleOpenWhatsApp}
            className="p-1.5 rounded-full bg-emerald-600/80 hover:bg-emerald-600 text-white shadow-sm"
            title={`Open WhatsApp (${contactPhone})`}
          >
            <MessageSquare className="w-3 h-3" />
          </button>
        )}

        {pipSupported && !isPiP && (
          <button
            onClick={openPipWindow}
            className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="Pop out as Always-On-Top window"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={onClose}
          className="p-1.5 hover:text-rose-400 text-slate-400 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
          title="End session"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════

  return (
    <>
      {/* Hidden <video> for continuous live frame decoding (screenshot source) */}
      <video
        ref={hiddenVideoRef}
        autoPlay
        playsInline
        muted
        style={{ display: 'none' }}
      />

      {/*
        CASE A: PiP Window is open → portal our controls INTO the OS-level
        always-on-top window so they float over WhatsApp and every other tab.
      */}
      {pipWindow && pipWindow.document?.body
        ? createPortal(renderControls(true), pipWindow.document.body)
        : null}

      {/*
        CASE B: No PiP → render controls as a fixed draggable bar in-tab.
      */}
      {!pipWindow && (
        <div
          style={{ left: `${widgetPos.x}px`, top: `${widgetPos.y}px` }}
          className={`fixed z-[99999] select-none transition-shadow ${
            isDragging ? 'cursor-grabbing shadow-2xl scale-105' : 'shadow-xl'
          }`}
          onMouseDown={handleMouseDown}
        >
          <div className="rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-700/90 text-white shadow-2xl flex items-center">
            {/* Drag Handle */}
            <div
              className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 px-2 flex items-center self-stretch border-r border-slate-700/60"
              title="Drag to reposition"
            >
              <GripVertical className="w-4 h-4" />
            </div>
            {renderControls(false)}
          </div>
        </div>
      )}
    </>
  );
};
