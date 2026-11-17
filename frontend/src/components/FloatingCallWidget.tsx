import React, { useState, useRef, useEffect } from 'react';
import {
  Square,
  Camera,
  Circle,
  GripVertical,
  X,
  Minimize2,
  Maximize2,
  CheckCircle2,
  AlertCircle,
  Phone,
  Video,
} from 'lucide-react';
import { api } from '../api/client';

interface FloatingCallWidgetProps {
  caseId: string;
  caseNumber?: string;
  contactPhone?: string;
  contactName?: string;
  onClose: () => void;
  onRecordingSaved?: () => void;
}

export const FloatingCallWidget: React.FC<FloatingCallWidgetProps> = ({
  caseId,
  caseNumber,
  contactPhone,
  contactName,
  onClose,
  onRecordingSaved,
}) => {
  // Widget position (draggable)
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: Math.max(20, window.innerWidth / 2 - 220),
    y: Math.max(20, window.innerHeight - 120),
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [snapshotFlash, setSnapshotFlash] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Media references
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);

  // Dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from handle or non-button areas
    if ((e.target as HTMLElement).closest('button')) return;

    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      const newX = Math.min(Math.max(10, dragRef.current.posX + dx), window.innerWidth - 440);
      const newY = Math.min(Math.max(10, dragRef.current.posY + dy), window.innerHeight - 80);

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // START RECORDING
  const handleStartRecording = async () => {
    try {
      setIsStarting(true);
      setStatusMessage(null);

      // Prompt user for screen / window / tab share
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
        } as any,
        audio: true,
      });

      // Try acquiring microphone to mix audio
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Mic optional if denied
      }

      const finalTracks: MediaStreamTrack[] = [];
      const vTrack = displayStream.getVideoTracks()[0];
      if (vTrack) {
        finalTracks.push(vTrack);
        videoTrackRef.current = vTrack;

        // Auto-stop if user clicks Chrome's "Stop sharing" native bar
        vTrack.onended = () => {
          handleStopRecording();
        };
      }

      // Mix audio tracks if available
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const mixedDest = audioCtx.createMediaStreamDestination();

        if (displayStream.getAudioTracks().length > 0) {
          const displayAudioSource = audioCtx.createMediaStreamSource(displayStream);
          displayAudioSource.connect(mixedDest);
        }
        if (micStream && micStream.getAudioTracks().length > 0) {
          const micAudioSource = audioCtx.createMediaStreamSource(micStream);
          micAudioSource.connect(mixedDest);
        }

        if (mixedDest.stream.getAudioTracks().length > 0) {
          finalTracks.push(mixedDest.stream.getAudioTracks()[0]);
        }
      } catch (audioErr) {
        console.warn('Audio mixing fallback:', audioErr);
      }

      const combinedStream = new MediaStream(finalTracks);
      mediaStreamRef.current = combinedStream;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
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
      recorder.start(1000); // Gather chunks in memory

      setIsRecording(true);
      setElapsedSeconds(0);

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setStatusMessage('Screen capture was cancelled or denied');
    } finally {
      setIsStarting(false);
    }
  };

  // STOP & DIRECT UPLOAD
  const handleStopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setIsSaving(true);
    setStatusMessage('Saving recording to database...');

    const duration = Math.max(1, elapsedSeconds);

    mediaRecorderRef.current.onstop = async () => {
      try {
        const fullBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });

        // Stop all hardware tracks immediately
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }

        // Direct single upload to backend
        await api.uploadDirectRecording(caseId, fullBlob, duration);

        setStatusMessage(`✅ Saved (${Math.floor(duration / 60)}m ${duration % 60}s)`);
        if (onRecordingSaved) {
          onRecordingSaved();
        }
        setTimeout(() => setStatusMessage(null), 3500);
      } catch (err: any) {
        console.error('Direct recording upload failed:', err);
        setStatusMessage('⚠️ Upload failed — you can retry or callback');
      } finally {
        setIsSaving(false);
      }
    };

    mediaRecorderRef.current.stop();
  };

  // CAPTURE LIVE SCREENSHOT
  const handleCaptureSnapshot = async () => {
    if (!videoTrackRef.current || !isRecording) {
      setStatusMessage('Start recording first to capture snapshots');
      setTimeout(() => setStatusMessage(null), 2500);
      return;
    }

    try {
      setSnapshotFlash(true);
      setTimeout(() => setSnapshotFlash(false), 300);

      const videoElem = document.createElement('video');
      videoElem.srcObject = new MediaStream([videoTrackRef.current]);
      videoElem.muted = true;
      await videoElem.play();

      const canvas = document.createElement('canvas');
      canvas.width = videoElem.videoWidth || 1280;
      canvas.height = videoElem.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(videoElem, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        if (blob) {
          await api.uploadScreenshot(
            caseId,
            blob,
            elapsedSeconds,
            `Live field capture at ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
          );
          setSnapshotCount((prev) => prev + 1);
          setStatusMessage(`📸 Snapshot #${snapshotCount + 1} captured`);
          setTimeout(() => setStatusMessage(null), 2000);
          if (onRecordingSaved) onRecordingSaved();
        }
      }, 'image/png');
    } catch (err) {
      console.error('Snapshot failed:', err);
      setStatusMessage('Snapshot capture failed');
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      className={`fixed z-[9999] select-none transition-shadow ${
        isDragging ? 'cursor-grabbing shadow-2xl' : 'shadow-xl'
      }`}
      onMouseDown={handleMouseDown}
    >
      {/* Minimized Pill */}
      {isMinimized ? (
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-full px-3 py-1.5 flex items-center space-x-2 text-white shadow-2xl">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-bold">{caseNumber || 'RECORDER'}</span>
          {isRecording && (
            <span className="text-xs font-mono text-rose-400 font-bold">
              {formatTimer(elapsedSeconds)}
            </span>
          )}
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1 hover:text-slate-200 text-slate-400"
            title="Expand toolbar"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Expanded Floating Pill Toolbar (Matches WhatsApp Screenshot Design) */
        <div
          className={`rounded-full bg-slate-900/95 backdrop-blur-md border border-slate-700/90 text-white px-4 py-2 flex items-center space-x-3 shadow-2xl transition-all ${
            snapshotFlash ? 'ring-4 ring-emerald-400/80' : ''
          }`}
        >
          {/* Drag Handle */}
          <div
            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 pr-1 flex items-center"
            title="Drag to reposition anywhere on screen"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Case & Call Info */}
          <div className="hidden sm:flex flex-col border-r border-slate-700/80 pr-3">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              {caseNumber || 'ACTIVE CALL'}
            </span>
            <span className="text-[11px] text-slate-300 font-medium truncate max-w-[110px]">
              {contactPhone || contactName || 'Field Session'}
            </span>
          </div>

          {/* Action 1: STOP / REC BUTTON */}
          {isRecording ? (
            <button
              onClick={handleStopRecording}
              disabled={isSaving}
              className="group flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-800/90 hover:bg-rose-950/80 border border-rose-500/80 hover:border-rose-400 text-white font-bold text-xs tracking-wide transition-all shadow-sm shadow-rose-900/30"
              title="Stop and save video directly to database"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
              <Square className="w-3 h-3 text-rose-400 fill-rose-400" />
              <span>■ STOP</span>
              <span className="ml-1 pl-1.5 border-l border-rose-500/40 font-mono text-rose-300 text-[11px]">
                {formatTimer(elapsedSeconds)}
              </span>
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
              disabled={isStarting || isSaving}
              className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide transition-all shadow-md shadow-rose-900/40"
              title="Start recording WhatsApp call window"
            >
              <Circle className="w-2.5 h-2.5 fill-white text-white animate-pulse" />
              <span>{isStarting ? 'Selecting...' : '● REC'}</span>
            </button>
          )}

          {/* Action 2: CAPTURE SNAPSHOT BUTTON */}
          <button
            onClick={handleCaptureSnapshot}
            disabled={!isRecording || isSaving}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full border text-xs font-bold transition-all shadow-sm ${
              isRecording
                ? 'bg-slate-800/90 hover:bg-teal-950/80 border-teal-500/80 hover:border-teal-400 text-teal-300 shadow-teal-900/20 active:scale-95'
                : 'bg-slate-800/40 border-slate-700/60 text-slate-500 cursor-not-allowed'
            }`}
            title="Capture live video frame and attach to dossier screenshots"
          >
            <span className="w-2 h-2 rounded-full bg-teal-400"></span>
            <Camera className="w-3.5 h-3.5 text-teal-300" />
            <span>CAPTURE</span>
            {snapshotCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-teal-500/30 text-teal-200 text-[10px] font-mono">
                {snapshotCount}
              </span>
            )}
          </button>

          {/* Status Toast Message */}
          {statusMessage && (
            <div className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-medium animate-in fade-in truncate max-w-[150px]">
              {statusMessage}
            </div>
          )}

          {/* Controls: Minimize & Close */}
          <div className="flex items-center space-x-1 pl-1 border-l border-slate-700/80 text-slate-400">
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 hover:text-white rounded"
              title="Minimize to small badge"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:text-rose-400 rounded"
              title="Close recording toolbar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
