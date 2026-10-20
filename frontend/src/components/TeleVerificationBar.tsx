import React, { useEffect, useRef, useState } from 'react';
import { Video, Mic, Camera, Square, AlertTriangle, CheckCircle2, Phone } from 'lucide-react';
import { api } from '../api/client';

interface TeleVerificationBarProps {
  caseId: string;
  contactId?: string;
  contactPhone?: string;
  onFinish: () => void;
}

export const TeleVerificationBar: React.FC<TeleVerificationBarProps> = ({
  caseId,
  contactId,
  contactPhone,
  onFinish,
}) => {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [audioMissingWarning, setAudioMissingWarning] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(true);
  const [snapshotTaken, setSnapshotTaken] = useState<boolean>(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const chunkIndexRef = useRef<number>(0);

  useEffect(() => {
    let isCancelled = false;

    async function initTeleVerification() {
      try {
        setIsStarting(true);

        // 1. Open WhatsApp Web Deep Link in new tab if phone is provided
        if (contactPhone) {
          const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
          window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}`, '_blank');
        }

        // 2. Initialize Backend Recording Session
        const sessionRes = await api.startRecording(caseId, contactId);
        if (isCancelled) return;
        setRecordingId(sessionRes.recording_id);

        // 3. Acquire Screen & Tab Audio (WhatsApp Web)
        let displayStream: MediaStream | null = null;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true, // Captures WhatsApp Web tab audio
          });
        } catch (err: any) {
          console.warn('Display media cancelled or not supported:', err);
        }

        // 4. Acquire Investigator's Microphone
        let micStream: MediaStream | null = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch (err: any) {
          console.warn('Microphone permission denied or hardware unavailable:', err);
        }

        // Check audio track sniffer (Edge Case Mitigation: "Also share tab audio" unchecked)
        if (displayStream && displayStream.getAudioTracks().length === 0) {
          setAudioMissingWarning(true);
        }

        // 5. Dual-Stream Audio Mixing with Web Audio API
        const finalTracks: MediaStreamTrack[] = [];

        if (displayStream && displayStream.getVideoTracks().length > 0) {
          const vTrack = displayStream.getVideoTracks()[0];
          finalTracks.push(vTrack);
          videoTrackRef.current = vTrack;
        }

        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const mixedDest = audioCtx.createMediaStreamDestination();

          if (displayStream && displayStream.getAudioTracks().length > 0) {
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
          console.error('Audio mixer init fallback:', audioErr);
        }

        // Construct final mixed MediaStream
        const combinedStream = new MediaStream(finalTracks);
        mediaStreamRef.current = combinedStream;

        // 6. MediaRecorder 5-Second Slicing Engine (Pillar 2: 5s Chunks)
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';

        const recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 1_200_000,
        });

        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = async (e: BlobEvent) => {
          if (e.data && e.data.size > 0 && sessionRes.recording_id) {
            const currentIndex = chunkIndexRef.current++;
            try {
              await api.uploadChunk(caseId, sessionRes.recording_id, currentIndex, e.data);
              setChunkCount((prev) => prev + 1);
            } catch (uploadErr) {
              console.error(`Chunk ${currentIndex} upload failed:`, uploadErr);
            }
          }
        };

        // CRITICAL PILLAR 2: Slices every 5000 milliseconds
        recorder.start(5000);

        // Start elapsed timer
        timerRef.current = window.setInterval(() => {
          setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        setIsStarting(false);
      } catch (err: any) {
        console.error('Tele-verification session initialization error:', err);
        setIsStarting(false);
      }
    }

    initTeleVerification();

    return () => {
      isCancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [caseId, contactId, contactPhone]);

  const handleTakeSnapshot = async () => {
    if (!videoTrackRef.current) {
      alert('Live video stream track not active');
      return;
    }

    try {
      // Capture live frame from ImageCapture or video element
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
        if (blob && recordingId) {
          await api.uploadScreenshot(
            caseId,
            blob,
            elapsedSeconds,
            `Live snapshot at ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`,
            recordingId
          );
          setSnapshotTaken(true);
          setTimeout(() => setSnapshotTaken(false), 2000);
        }
      }, 'image/png');
    } catch (err) {
      console.error('Snapshot capture failed:', err);
    }
  };

  const handleStopRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    if (recordingId) {
      try {
        await api.stopRecording(caseId, recordingId, elapsedSeconds);
      } catch (err) {
        console.error('Failed to notify backend recording stopped:', err);
      }
    }

    onFinish();
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-4 animate-in slide-in-from-bottom duration-300">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 p-4 flex flex-col gap-2">
        {/* Warning if "Also share tab audio" was omitted in Chrome prompt */}
        {audioMissingWarning && (
          <div className="bg-amber-950/90 border border-amber-500/50 text-amber-200 px-3 py-1.5 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Tab Audio Missing:</strong> Did not check "Also share tab audio" in the Chrome screen picker. Remote claimant's voice will not be captured!
              </span>
            </div>
            <button
              onClick={() => setAudioMissingWarning(false)}
              className="text-[10px] underline ml-2 text-amber-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Live Controller Bar */}
        <div className="flex items-center justify-between gap-4">
          {/* Recording Status & Elapsed Time */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="w-3.5 h-3.5 rounded-full bg-rose-500 animate-ping"></span>
              <span className="font-extrabold text-sm text-rose-400 tracking-wider font-mono">
                LIVE REC
              </span>
            </div>

            <div className="text-xl font-bold font-mono text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">
              {formatTimer(elapsedSeconds)}
            </div>

            <div className="hidden sm:flex flex-col text-[11px] text-slate-400 leading-tight">
              <span>5s Slices: <strong className="text-emerald-400">{chunkCount}</strong> synced</span>
              <span className="text-[10px] text-slate-500 font-mono">ID: {recordingId?.substring(0, 10)}...</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            {/* Snapshot Trigger */}
            <button
              onClick={handleTakeSnapshot}
              className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                snapshotTaken
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
              title="Capture timestamped high-resolution video frame screenshot"
            >
              <Camera className="w-4 h-4" />
              <span>{snapshotTaken ? 'Saved!' : 'Take Snapshot'}</span>
            </button>

            {/* Stop & Finalize Button */}
            <button
              onClick={handleStopRecording}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow-lg transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop & Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
