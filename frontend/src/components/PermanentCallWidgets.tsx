import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Square,
  Camera,
  Circle,
  GripVertical,
  X,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { api } from '../api/client';

interface PermanentCallWidgetsProps {
  caseId: string;
  caseNumber?: string;
  contactPhone?: string;
  onClose: () => void;
  onRecordingSaved?: () => void;
}

export const PermanentCallWidgets: React.FC<PermanentCallWidgetsProps> = ({
  caseId,
  caseNumber,
  contactPhone,
  onClose,
  onRecordingSaved,
}) => {
  // Shared Media References
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recToast, setRecToast] = useState<string | null>(null);

  // Snapshot State
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capFlash, setCapFlash] = useState(false);
  const [capToast, setCapToast] = useState<string | null>(null);

  // Position 1: Recording Widget (saved in localStorage for persistence)
  const [recPos, setRecPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('call_rec_pos');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      x: Math.max(20, window.innerWidth / 2 - 220),
      y: Math.max(20, window.innerHeight - 80),
    };
  });
  const [isRecDragging, setIsRecDragging] = useState(false);
  const recDragOffset = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });

  // Position 2: Capture Widget (saved in localStorage for persistence)
  const [capPos, setCapPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('call_cap_pos');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      x: Math.max(20, window.innerWidth / 2 + 30),
      y: Math.max(20, window.innerHeight - 80),
    };
  });
  const [isCapDragging, setIsCapDragging] = useState(false);
  const capDragOffset = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });

  // Attach stream to hidden video for continuous frame decoding
  const attachStream = useCallback((stream: MediaStream) => {
    mediaStreamRef.current = stream;
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.onended = () => {
        handleStopRecording();
      };
    }

    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.srcObject = stream;
      hiddenVideoRef.current.play().catch(() => {});
    }
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Ensure live screen stream
  const ensureLiveStream = async (): Promise<MediaStream> => {
    const currentStream = mediaStreamRef.current;
    const vTrack = currentStream?.getVideoTracks()[0];

    if (currentStream && vTrack && vTrack.readyState === 'live') {
      return currentStream;
    }

    // Request screen share with system audio
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window' } as any,
      audio: true,
    });

    // Try optional mic audio
    let micStream: MediaStream | null = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Mic optional
    }

    const finalTracks: MediaStreamTrack[] = [];
    const newVTrack = displayStream.getVideoTracks()[0];
    if (newVTrack) {
      finalTracks.push(newVTrack);
    }

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const mixedDest = audioCtx.createMediaStreamDestination();

      if (displayStream.getAudioTracks().length > 0) {
        const dSource = audioCtx.createMediaStreamSource(displayStream);
        dSource.connect(mixedDest);
      }
      if (micStream && micStream.getAudioTracks().length > 0) {
        const mSource = audioCtx.createMediaStreamSource(micStream);
        mSource.connect(mixedDest);
      }
      if (mixedDest.stream.getAudioTracks().length > 0) {
        finalTracks.push(mixedDest.stream.getAudioTracks()[0]);
      }
    } catch (aErr) {
      console.warn('Audio mixer notice:', aErr);
    }

    const combined = new MediaStream(finalTracks);
    attachStream(combined);
    return combined;
  };

  // Dragging handlers for Button 1 (Recording)
  const handleRecMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button:not([data-drag])')) return;
    setIsRecDragging(true);
    recDragOffset.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: recPos.x,
      posY: recPos.y,
    };
  };

  // Dragging handlers for Button 2 (Capture)
  const handleCapMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button:not([data-drag])')) return;
    setIsCapDragging(true);
    capDragOffset.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: capPos.x,
      posY: capPos.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isRecDragging) {
        const dx = e.clientX - recDragOffset.current.startX;
        const dy = e.clientY - recDragOffset.current.startY;
        const newX = Math.min(Math.max(10, recDragOffset.current.posX + dx), window.innerWidth - 200);
        const newY = Math.min(Math.max(10, recDragOffset.current.posY + dy), window.innerHeight - 50);
        setRecPos({ x: newX, y: newY });
        try {
          localStorage.setItem('call_rec_pos', JSON.stringify({ x: newX, y: newY }));
        } catch {}
      }
      if (isCapDragging) {
        const dx = e.clientX - capDragOffset.current.startX;
        const dy = e.clientY - capDragOffset.current.startY;
        const newX = Math.min(Math.max(10, capDragOffset.current.posX + dx), window.innerWidth - 180);
        const newY = Math.min(Math.max(10, capDragOffset.current.posY + dy), window.innerHeight - 50);
        setCapPos({ x: newX, y: newY });
        try {
          localStorage.setItem('call_cap_pos', JSON.stringify({ x: newX, y: newY }));
        } catch {}
      }
    };

    const handleMouseUp = () => {
      setIsRecDragging(false);
      setIsCapDragging(false);
    };

    if (isRecDragging || isCapDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isRecDragging, isCapDragging]);

  // START RECORDING
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
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setRecToast('Screen share cancelled');
      setTimeout(() => setRecToast(null), 3000);
    } finally {
      setIsStarting(false);
    }
  };

  // PAUSE / RESUME RECORDING
  const handleTogglePause = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) return;

    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
  };

  // STOP RECORDING & ONE-SHOT UPLOAD (Guaranteed non-zero buffer)
  const handleStopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
    setIsSaving(true);
    setRecToast('Saving recording...');

    const duration = Math.max(1, elapsedSeconds);

    try {
      // 1. Force flush all pending buffered data before stopping
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        try {
          recorder.requestData();
        } catch (e) {
          console.warn('requestData error:', e);
        }
      }

      // 2. Wait for the stop event to complete
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          resolve();
        }
      });

      // 3. Assemble full blob
      const fullBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      console.log('Assembled recording size:', fullBlob.size, 'bytes, duration:', duration);

      if (fullBlob.size === 0) {
        throw new Error('Recording captured 0 bytes');
      }

      // Stop stream tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      // 4. Upload single finalized video file
      await api.uploadDirectRecording(caseId, fullBlob, duration);

      setRecToast(`✅ Saved (${Math.floor(duration / 60)}m ${duration % 60}s)`);
      if (onRecordingSaved) {
        onRecordingSaved();
      }
      setTimeout(() => setRecToast(null), 3500);
    } catch (err: any) {
      console.error('Recording upload failed:', err);
      setRecToast(`⚠️ Error: ${err.message || 'Save failed'}`);
      setTimeout(() => setRecToast(null), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  // CAPTURE LIVE SCREENSHOT (100% Reliable Dual Pipeline)
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
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(bitmap, 0, 0);
          captured = true;
        } catch (icErr) {
          console.warn('ImageCapture grabFrame notice:', icErr);
        }
      }

      // Method B: Continuously playing hidden video element fallback
      if (!captured && video && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        captured = true;
      }

      if (!captured) {
        throw new Error('Video frame not ready');
      }

      canvas.toBlob(async (blob) => {
        if (blob) {
          await api.uploadScreenshot(
            caseId,
            blob,
            elapsedSeconds,
            `Live field capture at ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
          );
          setSnapshotCount((prev) => prev + 1);
          setCapToast(`📸 Saved #${snapshotCount + 1}`);
          setTimeout(() => setCapToast(null), 2000);
          if (onRecordingSaved) onRecordingSaved();
        }
      }, 'image/png');
    } catch (err: any) {
      console.error('Snapshot capture failed:', err);
      setCapToast('Capture failed - try again');
      setTimeout(() => setCapToast(null), 2500);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (contactPhone) {
      const clean = contactPhone.replace(/[^0-9]/g, '');
      window.open(`https://web.whatsapp.com/send?phone=${clean}`, '_blank');
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Hidden Video for continuous live frame decoding */}
      <video
        ref={hiddenVideoRef}
        autoPlay
        playsInline
        muted
        style={{ display: 'none' }}
      />

      {/* ==================================================================== */}
      {/* 1. SEPARATE RECORDING PILL (Permanent, Moveable Anywhere on Screen)  */}
      {/* ==================================================================== */}
      <div
        style={{ left: `${recPos.x}px`, top: `${recPos.y}px` }}
        className={`fixed z-[99999] select-none transition-shadow ${
          isRecDragging ? 'cursor-grabbing shadow-2xl scale-105' : 'shadow-xl'
        }`}
        onMouseDown={handleRecMouseDown}
      >
        <div className="rounded-full bg-slate-900/95 backdrop-blur-md border border-slate-700/90 text-white px-3 py-1.5 flex items-center space-x-2 shadow-2xl">
          {/* Drag Handle */}
          <div
            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 pr-0.5 flex items-center"
            title="Drag to reposition recording button anywhere"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Record / Stop Button */}
          {isRecording ? (
            <div className="flex items-center space-x-1.5">
              <button
                onClick={handleStopRecording}
                disabled={isSaving}
                className="group flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-800/90 hover:bg-rose-950/80 border border-rose-500/80 hover:border-rose-400 text-white font-bold text-xs tracking-wide transition-all shadow-sm"
                title="Stop recording and save video"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <Square className="w-2.5 h-2.5 text-rose-400 fill-rose-400" />
                <span>■ STOP</span>
                <span className="pl-1 border-l border-rose-500/40 font-mono text-rose-300 text-[11px]">
                  {formatTimer(elapsedSeconds)}
                </span>
              </button>

              {/* Pause / Resume Button */}
              <button
                onClick={handleTogglePause}
                disabled={isSaving}
                className={`p-1.5 rounded-full border text-xs transition-colors ${
                  isPaused
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
                title={isPaused ? 'Resume Recording' : 'Pause Recording'}
              >
                {isPaused ? <Play className="w-3 h-3 fill-amber-300" /> : <Pause className="w-3 h-3" />}
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartRecording}
              disabled={isStarting || isSaving}
              className="flex items-center space-x-1.5 px-3.5 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide transition-all shadow-md shadow-rose-900/40 active:scale-95"
              title="Click to start screen recording"
            >
              <Circle className="w-2 h-2 fill-white text-white animate-pulse" />
              <span>{isStarting ? 'Selecting...' : '● REC'}</span>
            </button>
          )}

          {/* Toast / Status */}
          {recToast && (
            <span className="text-[10px] text-slate-300 font-medium px-1 truncate max-w-[120px]">
              {recToast}
            </span>
          )}

          {/* WhatsApp Direct Link Icon */}
          {contactPhone && (
            <button
              onClick={handleOpenWhatsApp}
              className="p-1 hover:text-emerald-400 text-slate-400 rounded transition-colors"
              title={`Open WhatsApp chat (${contactPhone})`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Close session button */}
          <button
            onClick={onClose}
            className="p-1 hover:text-rose-400 text-slate-400 rounded transition-colors"
            title="End session and close controls"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. SEPARATE CAPTURE PILL (Permanent, Moveable Anywhere on Screen)    */}
      {/* ==================================================================== */}
      <div
        style={{ left: `${capPos.x}px`, top: `${capPos.y}px` }}
        className={`fixed z-[99999] select-none transition-shadow ${
          isCapDragging ? 'cursor-grabbing shadow-2xl scale-105' : 'shadow-xl'
        }`}
        onMouseDown={handleCapMouseDown}
      >
        <div
          className={`rounded-full bg-slate-900/95 backdrop-blur-md border border-teal-500/80 text-white px-3 py-1.5 flex items-center space-x-2 shadow-2xl transition-all ${
            capFlash ? 'ring-4 ring-teal-400 scale-105' : ''
          }`}
        >
          {/* Drag Handle */}
          <div
            className="cursor-grab active:cursor-grabbing text-teal-500 hover:text-teal-300 pr-0.5 flex items-center"
            title="Drag to reposition capture button anywhere"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Capture Button */}
          <button
            onClick={handleCaptureSnapshot}
            disabled={isCapturing}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/90 hover:bg-teal-950/80 border border-teal-500/80 text-teal-300 font-bold text-xs tracking-wide transition-all active:scale-95 shadow-sm shadow-teal-900/30"
            title="Capture live screenshot"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
            <Camera className="w-3 h-3 text-teal-300" />
            <span>CAPTURE</span>
            {snapshotCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-teal-500/30 text-teal-200 text-[10px] font-mono">
                {snapshotCount}
              </span>
            )}
          </button>

          {/* Toast / Status */}
          {capToast && (
            <span className="text-[10px] text-teal-300 font-medium px-1 truncate max-w-[110px]">
              {capToast}
            </span>
          )}
        </div>
      </div>
    </>
  );
};
