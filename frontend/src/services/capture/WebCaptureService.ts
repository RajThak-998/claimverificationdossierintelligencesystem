/**
 * WebCaptureService (Phase 1 Pure Web Implementation)
 *
 * Implements ICaptureService using browser APIs:
 * - Session-persistent getDisplayMedia() with dual-audio mixing (Tab + Mic)
 * - 720p, 24-30fps, 1.2 Mbps video bitrate
 * - Memory-safe 10s timeslice MediaRecorder streaming to IChunkStorageHandler
 * - Screen Wake Lock (navigator.wakeLock)
 * - Instant offscreen canvas screenshots (image/jpeg, quality 0.85) with exact offsetSeconds
 * - Standalone /call-overlay launcher (Document PiP or compact window)
 */

import {
  ICaptureService,
  CaptureState,
  CaptureServiceListener,
  RecordingOptions,
  RecordingCompleteResult,
  ScreenshotResult,
} from './types';
import { IChunkStorageHandler, BackendChunkStorageHandler } from './storageHandler';
import { CaptureBroadcastBridge } from './broadcastBridge';
import { api } from '../../api/client';
import { mountCallOverlayInContainer } from '../../components/CallOverlay';

export class WebCaptureService implements ICaptureService {
  private static instance: WebCaptureService | null = null;

  // Session Media
  private sessionStream: MediaStream | null = null;
  private offscreenVideo: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;

  // Recording Engine
  private mediaRecorder: MediaRecorder | null = null;
  private storageHandler: IChunkStorageHandler;
  private activeRecordingId: string | null = null;
  private chunkIndex = 0;
  private timerInterval: any = null;
  private wakeLock: any = null;

  // Cross-Window Bridge
  private bridge: CaptureBroadcastBridge;

  // State
  private state: CaptureState = {
    sessionState: 'idle',
    hasActiveStream: false,
    isRecording: false,
    isPaused: false,
    elapsedSeconds: 0,
    caseId: null,
    caseNumber: null,
    contactPhone: null,
    contactName: null,
    error: null,
    screenshotCount: 0,
    wakeLockActive: false,
    lastScreenshotToast: null,
  };

  private listeners = new Set<CaptureServiceListener>();

  private constructor(storageHandler?: IChunkStorageHandler) {
    this.storageHandler = storageHandler || new BackendChunkStorageHandler();
    this.bridge = new CaptureBroadcastBridge();

    // Listen to commands from the standalone /call-overlay route
    this.bridge.onMessage((msg) => {
      switch (msg.type) {
        case 'CMD_TAKE_SCREENSHOT':
          this.takeScreenshot(msg.caption).catch((err) => {
            console.error('Bridge screenshot error:', err);
          });
          break;
        case 'CMD_STOP_RECORDING':
          this.stopRecording().catch((err) => {
            console.error('Bridge stop error:', err);
          });
          break;
        case 'CMD_PAUSE_RECORDING':
          this.pauseRecording();
          break;
        case 'CMD_RESUME_RECORDING':
          this.resumeRecording();
          break;
        case 'CMD_REQUEST_STATE':
          this.broadcastState();
          break;
      }
    });

    // Cleanup on beforeunload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.cleanupSync();
      });
    }
  }

  public static getInstance(storageHandler?: IChunkStorageHandler): WebCaptureService {
    if (!WebCaptureService.instance) {
      WebCaptureService.instance = new WebCaptureService(storageHandler);
    }
    return WebCaptureService.instance;
  }

  public getState(): CaptureState {
    return { ...this.state };
  }

  public subscribe(listener: CaptureServiceListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<CaptureState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn(this.getState()));
    this.broadcastState();
  }

  private broadcastState(): void {
    this.bridge.postMessage({
      type: 'STATE_UPDATE',
      payload: this.getState(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Session-Persistent Screen Capture
  // ═══════════════════════════════════════════════════════════════════════

  public async initSession(): Promise<MediaStream> {
    // If active stream already exists and video track is live, reuse it (NO PROMPT)
    if (this.sessionStream && this.sessionStream.active) {
      const vTrack = this.sessionStream.getVideoTracks()[0];
      if (vTrack && vTrack.readyState === 'live') {
        this.updateState({
          hasActiveStream: true,
          sessionState: this.state.isRecording ? 'recording' : 'session_active',
          error: null,
        });
        return this.sessionStream;
      }
    }

    try {
      this.updateState({ error: null });

      // 1. Capture screen with audio capped at 720p 24-30fps
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 24, max: 30 },
          displaySurface: 'browser',
        },
        audio: true, // System / tab audio
      });

      // 2. Optionally capture microphone for full dual-audio tele-verification
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (micErr) {
        console.warn('Microphone stream optional notice:', micErr);
      }

      // 3. Web Audio Mixer: Blends Tab Audio + Mic Audio
      const tracks: MediaStreamTrack[] = [];
      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) {
        tracks.push(videoTrack);
      }

      const hasDisplayAudio = displayStream.getAudioTracks().length > 0;
      const hasMicAudio = micStream && micStream.getAudioTracks().length > 0;

      if (hasDisplayAudio || hasMicAudio) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            this.audioContext = new AudioContextClass();
            const destination = this.audioContext.createMediaStreamDestination();

            if (hasDisplayAudio) {
              const srcDisplay = this.audioContext.createMediaStreamSource(displayStream);
              srcDisplay.connect(destination);
            }
            if (hasMicAudio && micStream) {
              const srcMic = this.audioContext.createMediaStreamSource(micStream);
              srcMic.connect(destination);
            }

            const mixedTrack = destination.stream.getAudioTracks()[0];
            if (mixedTrack) {
              tracks.push(mixedTrack);
            }
          }
        } catch (audioMixErr) {
          console.warn('Audio mix fallback:', audioMixErr);
          // Fallback: use display audio track directly
          if (hasDisplayAudio) {
            tracks.push(displayStream.getAudioTracks()[0]);
          }
        }
      }

      this.sessionStream = new MediaStream(tracks);

      // 4. Mount offscreen video element for continuous frame decoding (instant screenshot source)
      this.setupOffscreenVideo(this.sessionStream);

      // 5. Listen to track.onended to reset state cleanly if user clicks browser "Stop Sharing"
      if (videoTrack) {
        videoTrack.onended = () => {
          this.handleStreamEnded();
        };
      }

      this.updateState({
        sessionState: 'session_active',
        hasActiveStream: true,
        error: null,
      });

      return this.sessionStream;
    } catch (err: any) {
      const msg = err.message || 'Screen capture permission was cancelled or denied';
      this.updateState({
        sessionState: 'idle',
        hasActiveStream: false,
        error: msg,
      });
      throw err;
    }
  }

  private setupOffscreenVideo(stream: MediaStream): void {
    if (!this.offscreenVideo) {
      this.offscreenVideo = document.createElement('video');
      this.offscreenVideo.autoplay = true;
      this.offscreenVideo.muted = true;
      (this.offscreenVideo as any).playsInline = true;
      this.offscreenVideo.style.position = 'fixed';
      this.offscreenVideo.style.top = '-9999px';
      this.offscreenVideo.style.left = '-9999px';
      this.offscreenVideo.style.width = '1px';
      this.offscreenVideo.style.height = '1px';
      this.offscreenVideo.style.opacity = '0';
      this.offscreenVideo.style.pointerEvents = 'none';
      document.body.appendChild(this.offscreenVideo);
    }
    this.offscreenVideo.srcObject = stream;
    this.offscreenVideo.play().catch(() => {});
  }

  private handleStreamEnded(): void {
    if (this.state.isRecording) {
      this.stopRecording().catch((err) => console.warn('Stream ended stop error:', err));
    }
    this.endSession().catch(() => {});
  }

  public async endSession(): Promise<void> {
    if (this.state.isRecording) {
      try {
        await this.stopRecording();
      } catch (e) {
        console.warn('Auto stop recording on endSession:', e);
      }
    }

    if (this.sessionStream) {
      this.sessionStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      this.sessionStream = null;
    }

    if (this.offscreenVideo) {
      try {
        this.offscreenVideo.srcObject = null;
        this.offscreenVideo.remove();
      } catch {}
      this.offscreenVideo = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.updateState({
      sessionState: 'idle',
      hasActiveStream: false,
      isRecording: false,
      isPaused: false,
      elapsedSeconds: 0,
    });
  }

  public getMediaStream(): MediaStream | null {
    return this.sessionStream;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Memory-Safe Recording Engine (10s Timeslice Chunk Streaming)
  // ═══════════════════════════════════════════════════════════════════════

  public async startRecording(caseId: string, options?: RecordingOptions): Promise<void> {
    if (!this.sessionStream || !this.sessionStream.active) {
      await this.initSession();
    }

    if (!this.sessionStream) {
      throw new Error('Failed to start recording: No active media stream available.');
    }

    // Pick optimal lightweight codec (WebM VP8/VP9 + Opus)
    let mimeType = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
        mimeType = 'video/webm;codecs=vp9,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        mimeType = 'video/webm';
      } else {
        mimeType = '';
      }
    }

    // Initialize recording ID on modular storage handler
    this.activeRecordingId = await this.storageHandler.initRecording(caseId, options?.contactId);
    this.chunkIndex = 0;

    // MediaRecorder capped at ~1.2 Mbps video, 96 kbps audio (keeps 2h calls <= 1GB)
    const recorder = new MediaRecorder(this.sessionStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    });

    // MEMORY-SAFE DISPATCH:
    // Chunks are NOT stored in an unbounded in-memory array.
    // Each chunk is streamed to the storage handler immediately.
    recorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data && event.data.size > 0 && this.activeRecordingId) {
        const cIndex = this.chunkIndex++;
        const currentMeta = {
          caseId,
          recordingId: this.activeRecordingId,
          chunkIndex: cIndex,
          isLastChunk: false,
          durationSeconds: this.state.elapsedSeconds,
        };
        // Hand off chunk immediately without memory accumulation
        this.storageHandler.uploadChunk(event.data, currentMeta).catch((err) => {
          console.error(`Chunk upload error #${cIndex}:`, err);
        });
      }
    };

    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
      this.updateState({ error: 'MediaRecorder encountered an error' });
    };

    this.mediaRecorder = recorder;

    // Start with 10-second timeslice chunks (10000 ms)
    recorder.start(10000);

    // Acquire Screen Wake Lock so display never sleeps during long tele-verification
    await this.acquireWakeLock();

    // Start timer interval
    this.startTimer();

    this.updateState({
      sessionState: 'recording',
      isRecording: true,
      isPaused: false,
      elapsedSeconds: 0,
      caseId,
      caseNumber: options?.caseNumber || null,
      contactPhone: options?.contactPhone || null,
      contactName: options?.contactName || null,
      screenshotCount: 0,
      lastScreenshotToast: null,
      error: null,
    });
  }

  public pauseRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.pauseTimer();
      this.updateState({ sessionState: 'paused', isPaused: true });
    }
  }

  public resumeRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.resumeTimer();
      this.updateState({ sessionState: 'recording', isPaused: false });
    }
  }

  public async stopRecording(): Promise<RecordingCompleteResult> {
    const recorder = this.mediaRecorder;
    const recId = this.activeRecordingId;
    const cId = this.state.caseId;
    const finalDuration = Math.max(1, this.state.elapsedSeconds);
    const totalChunks = this.chunkIndex;

    this.stopTimer();
    await this.releaseWakeLock();

    if (!recorder || recorder.state === 'inactive' || !recId || !cId) {
      this.updateState({
        sessionState: this.sessionStream ? 'session_active' : 'idle',
        isRecording: false,
        isPaused: false,
      });
      return { durationSeconds: finalDuration, recordingId: recId || undefined, chunkCount: totalChunks };
    }

    this.updateState({ sessionState: 'stopping' });

    // 1. Force flush any pending hardware codec slice buffers
    if (recorder.state === 'recording' || recorder.state === 'paused') {
      try {
        recorder.requestData();
      } catch (reqErr) {
        console.warn('requestData buffer flush notice:', reqErr);
      }
    }

    // 2. Await stop event
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    this.mediaRecorder = null;
    this.activeRecordingId = null;

    // 3. Signal storage handler to complete & trigger backend stitching / hashing
    await this.storageHandler.completeRecording(cId, recId, finalDuration);

    this.updateState({
      sessionState: this.sessionStream ? 'session_active' : 'idle',
      isRecording: false,
      isPaused: false,
    });

    return {
      durationSeconds: finalDuration,
      recordingId: recId,
      chunkCount: totalChunks,
    };
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.state.isPaused) {
        this.updateState({ elapsedSeconds: this.state.elapsedSeconds + 1 });
      }
    }, 1000);
  }

  private pauseTimer(): void {
    // Timer remains ticking in interval but state isPaused guards increments
  }

  private resumeTimer(): void {
    // Timer continues
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        this.updateState({ wakeLockActive: true });
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
          this.updateState({ wakeLockActive: false });
        });
      }
    } catch (err) {
      console.warn('WakeLock not acquired:', err);
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {}
      this.wakeLock = null;
      this.updateState({ wakeLockActive: false });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Independent Instant Screenshots (Offscreen Canvas / Track Grab)
  // ═══════════════════════════════════════════════════════════════════════

  public async takeScreenshot(customCaption?: string): Promise<ScreenshotResult> {
    if (!this.sessionStream || !this.sessionStream.active) {
      throw new Error('Cannot take screenshot: No active media stream');
    }

    const videoTrack = this.sessionStream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      throw new Error('Video track is not active or ready');
    }

    const video = this.offscreenVideo;
    const canvas = document.createElement('canvas');

    let captured = false;

    // Method A: ImageCapture grabFrame if supported
    if ('ImageCapture' in window) {
      try {
        const ic = new (window as any).ImageCapture(videoTrack);
        const bitmap: ImageBitmap = await ic.grabFrame();
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(bitmap, 0, 0);
        captured = true;
      } catch (icErr) {
        console.warn('ImageCapture fallback to offscreen video:', icErr);
      }
    }

    // Method B: Offscreen continuous video frame decoder
    if (!captured) {
      if (!video || video.videoWidth === 0) {
        throw new Error('Video frame not ready yet');
      }
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      captured = true;
    }

    const currentOffset = this.state.elapsedSeconds;
    const timestamp = Date.now();

    // Convert to image/jpeg with ~0.85 quality as specified
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) {
      throw new Error('Failed to encode screenshot frame to JPEG blob');
    }

    const caption =
      customCaption ||
      `Live field capture at ${Math.floor(currentOffset / 60)}m ${currentOffset % 60}s`;

    // Persist to backend if caseId is active
    if (this.state.caseId) {
      try {
        await api.uploadScreenshot(
          this.state.caseId,
          blob,
          currentOffset,
          caption,
          this.activeRecordingId || undefined
        );
      } catch (uploadErr) {
        console.error('Failed to upload screenshot to backend:', uploadErr);
      }
    }

    const newCount = this.state.screenshotCount + 1;
    const toastMsg = `📸 Saved #${newCount} (+${Math.floor(currentOffset / 60)}m ${currentOffset % 60}s)`;

    this.updateState({
      screenshotCount: newCount,
      lastScreenshotToast: toastMsg,
    });

    this.bridge.postMessage({
      type: 'TOAST_FEEDBACK',
      message: toastMsg,
    });

    // Auto clear toast after 3s
    setTimeout(() => {
      if (this.state.lastScreenshotToast === toastMsg) {
        this.updateState({ lastScreenshotToast: null });
      }
    }, 3000);

    return {
      blob,
      offsetSeconds: currentOffset,
      timestamp,
      width: canvas.width,
      height: canvas.height,
      caption,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Standalone /call-overlay Launcher
  // ═══════════════════════════════════════════════════════════════════════

  public async launchOverlay(): Promise<void> {
    // 1. Try Document Picture-in-Picture first (Chromium 116+)
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window) {
      try {
        const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
          width: 440,
          height: 80,
        });

        // Copy styles into PiP document
        [...document.styleSheets].forEach((sheet) => {
          try {
            const css = [...sheet.cssRules].map((r) => r.cssText).join('\n');
            const style = pipWindow.document.createElement('style');
            style.textContent = css;
            pipWindow.document.head.appendChild(style);
          } catch {
            if (sheet.href) {
              const link = pipWindow.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              pipWindow.document.head.appendChild(link);
            }
          }
        });

        // Set transparent body in PiP
        pipWindow.document.body.style.background = 'transparent';
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.padding = '0';
        pipWindow.document.body.style.overflow = 'hidden';

        // Render CallOverlay in PiP window
        const pipRoot = pipWindow.document.createElement('div');
        pipRoot.id = 'pip-overlay-root';
        pipWindow.document.body.appendChild(pipRoot);

        const unmount = mountCallOverlayInContainer(pipRoot, this);

        pipWindow.addEventListener('pagehide', () => {
          unmount();
        });

        return;
      } catch (pipErr) {
        console.warn('Document Picture-in-Picture fallback to popup window:', pipErr);
      }
    }

    // 2. Fallback: Compact standalone popup window loading /call-overlay route
    const width = 440;
    const height = 80;
    const left = window.screenLeft + Math.max(20, window.innerWidth - width - 40);
    const top = window.screenTop + Math.max(20, window.innerHeight - height - 40);

    const query = new URLSearchParams();
    if (this.state.caseId) query.set('caseId', this.state.caseId);
    if (this.state.caseNumber) query.set('caseNumber', this.state.caseNumber);

    const popupUrl = `/call-overlay?${query.toString()}`;
    const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=no`;

    window.open(popupUrl, 'motor_call_overlay', features);
  }

  private cleanupSync(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch {}
    }
    if (this.sessionStream) {
      this.sessionStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    }
  }
}
