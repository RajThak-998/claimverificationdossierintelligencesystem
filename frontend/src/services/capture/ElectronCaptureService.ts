/**
 * ElectronCaptureService (Phase 2 Desktop Native Implementation)
 *
 * Implements ICaptureService for Electron on Windows:
 * - Zero-prompt OS-level screen capture + Windows loopback audio via desktopCapturer
 * - Dual-audio mixing (Windows system/WhatsApp loopback audio + Investigator microphone)
 * - Video capped at 1280x720, 24-30 fps, ~1.2 Mbps (video/webm)
 * - Power save blocker (powerSaveBlocker.start('prevent-display-sleep')) to prevent screen sleep
 * - Crash-safe disk streaming: MediaRecorder timeslice chunks streamed over IPC to Node.js fs.createWriteStream()
 * - Instant non-blocking screenshots (image/jpeg quality 0.85) with exact offsetSeconds
 * - Secondary frameless, transparent, always-on-top BrowserWindow for /call-overlay
 * - Bi-directional IPC sync between main window and overlay window
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

export class ElectronCaptureService implements ICaptureService {
  private static instance: ElectronCaptureService | null = null;

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

  // Cross-Window Bridges
  private bridge: CaptureBroadcastBridge;
  private unsubscribeIpcCommand: (() => void) | null = null;

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

  public constructor(storageHandler?: IChunkStorageHandler) {
    this.storageHandler = storageHandler || new BackendChunkStorageHandler();
    this.bridge = new CaptureBroadcastBridge();

    // 1. Listen for commands relayed from overlay window via Electron IPC
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.onCommand) {
      this.unsubscribeIpcCommand = electronAPI.overlay.onCommand((msg: any) => {
        this.handleOverlayCommand(msg.command, msg.payload);
      });
    }

    // 2. Complementary BroadcastChannel listener for redundancy
    this.bridge.onMessage((msg) => {
      this.handleOverlayCommand(msg.type, (msg as any).caption);
    });

    // Cleanup on unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.cleanupSync();
      });
    }
  }

  public static getInstance(storageHandler?: IChunkStorageHandler): ElectronCaptureService {
    if (!ElectronCaptureService.instance) {
      ElectronCaptureService.instance = new ElectronCaptureService(storageHandler);
    }
    return ElectronCaptureService.instance;
  }

  private handleOverlayCommand(command: string, payload?: any): void {
    switch (command) {
      case 'CMD_TAKE_SCREENSHOT':
        this.takeScreenshot(typeof payload === 'string' ? payload : undefined).catch((err) => {
          console.error('Overlay screenshot command error:', err);
        });
        break;
      case 'CMD_STOP_RECORDING':
        this.stopRecording().catch((err) => {
          console.error('Overlay stop command error:', err);
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
    const currentState = this.getState();

    // Broadcast over BroadcastChannel
    this.bridge.postMessage({
      type: 'STATE_UPDATE',
      payload: currentState,
    });

    // Broadcast over Electron IPC to overlay window
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.sendState) {
      electronAPI.overlay.sendState(currentState);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Zero-Prompt Desktop Capture & Dual-Audio Mixing
  // ═══════════════════════════════════════════════════════════════════════

  public async initSession(): Promise<MediaStream> {
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

      // In Electron, setDisplayMediaRequestHandler supplies the screen source + loopback audio automatically!
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: true, // Captures Windows system / WhatsApp audio via loopback
      });

      // Optionally capture investigator microphone for dual-audio legal admissibility
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (micErr) {
        console.warn('Microphone capture optional fallback:', micErr);
      }

      // Mix Windows Loopback System Audio + Investigator Mic
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
          if (hasDisplayAudio) {
            tracks.push(displayStream.getAudioTracks()[0]);
          }
        }
      }

      this.sessionStream = new MediaStream(tracks);

      // Continuous offscreen video decoder for non-blocking instantaneous screenshots
      this.setupOffscreenVideo(this.sessionStream);

      // Reset state cleanly if screen share ever terminates
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
      const msg = err.message || 'Failed to acquire desktop capture';
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

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.hide) {
      try {
        await electronAPI.overlay.hide();
      } catch {}
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
  // 2. Crash-Safe Disk Streaming Recording Engine
  // ═══════════════════════════════════════════════════════════════════════

  public async startRecording(caseId: string, options?: RecordingOptions): Promise<void> {
    if (!this.sessionStream || !this.sessionStream.active) {
      await this.initSession();
    }

    if (!this.sessionStream) {
      throw new Error('Failed to start recording: No active media stream available.');
    }

    // Codec negotiation (VP8 / VP9 / WebM)
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

    // Initialize recording ID on backend storage
    this.activeRecordingId = await this.storageHandler.initRecording(caseId, options?.contactId);
    this.chunkIndex = 0;

    const electronAPI = (window as any).electronAPI;

    // Start Node.js crash-safe disk stream in main process
    if (electronAPI?.diskStream?.start) {
      try {
        await electronAPI.diskStream.start({
          caseId,
          recordingId: this.activeRecordingId,
          caseNumber: options?.caseNumber,
        });
      } catch (streamErr) {
        console.warn('Main process disk stream start notice:', streamErr);
      }
    }

    // Start PowerSaveBlocker to prevent OS and display sleep
    if (electronAPI?.startPowerSaveBlocker) {
      try {
        await electronAPI.startPowerSaveBlocker();
      } catch (psbErr) {
        console.warn('PowerSaveBlocker start notice:', psbErr);
      }
    }

    // Initialize MediaRecorder capped at 720p, ~1.2 Mbps video, 96 kbps audio
    const recorder = new MediaRecorder(this.sessionStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    });

    // ═══════════════════════════════════════════════════════════════════
    // CRASH-SAFE DUAL STREAMING:
    // Chunks are NOT accumulated in renderer memory.
    // Each timeslice chunk is:
    // 1. Streamed over IPC to Node.js fs.createWriteStream() on disk.
    // 2. Concurrently uploaded to the existing backend chunk handler.
    // ═══════════════════════════════════════════════════════════════════
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

        // 1. Pipe chunk to local disk write stream via IPC
        if (electronAPI?.diskStream?.writeChunk) {
          try {
            const arrayBuffer = await event.data.arrayBuffer();
            electronAPI.diskStream.writeChunk(this.activeRecordingId, arrayBuffer, currentMeta).catch((err: any) => {
              console.error(`Disk stream write chunk #${cIndex} error:`, err);
            });
          } catch (abErr) {
            console.error('ArrayBuffer conversion error:', abErr);
          }
        }

        // 2. Stream chunk to remote backend handler
        this.storageHandler.uploadChunk(event.data, currentMeta).catch((err) => {
          console.error(`Remote chunk upload error #${cIndex}:`, err);
        });
      }
    };

    recorder.onerror = (e) => {
      console.error('Electron MediaRecorder error:', e);
      this.updateState({ error: 'MediaRecorder encountered an error' });
    };

    this.mediaRecorder = recorder;

    // Start timeslice chunks every 5000ms (5 seconds)
    recorder.start(5000);

    // Launch the frameless always-on-top overlay window
    await this.launchOverlay();

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
      wakeLockActive: true,
      error: null,
    });
  }

  public pauseRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.updateState({ sessionState: 'paused', isPaused: true });
    }
  }

  public resumeRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
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

    const electronAPI = (window as any).electronAPI;

    // Stop PowerSaveBlocker
    if (electronAPI?.stopPowerSaveBlocker) {
      try {
        await electronAPI.stopPowerSaveBlocker();
      } catch {}
    }

    if (!recorder || recorder.state === 'inactive' || !recId || !cId) {
      if (electronAPI?.overlay?.hide) {
        try {
          await electronAPI.overlay.hide();
        } catch {}
      }
      this.updateState({
        sessionState: this.sessionStream ? 'session_active' : 'idle',
        isRecording: false,
        isPaused: false,
      });
      return { durationSeconds: finalDuration, recordingId: recId || undefined, chunkCount: totalChunks };
    }

    this.updateState({ sessionState: 'stopping' });

    // 1. Force flush hardware codec slice buffers
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

    // 3. Finalize crash-safe disk stream on Node.js side
    if (electronAPI?.diskStream?.finish) {
      try {
        const diskResult = await electronAPI.diskStream.finish(recId);
        console.log('Disk stream finalized successfully:', diskResult);
      } catch (finishErr) {
        console.error('Disk stream finish error:', finishErr);
      }
    }

    // 4. Signal backend storage handler to complete recording
    await this.storageHandler.completeRecording(cId, recId, finalDuration);

    // 5. Hide floating overlay window
    if (electronAPI?.overlay?.hide) {
      try {
        await electronAPI.overlay.hide();
      } catch {}
    }

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

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Instant Non-Blocking Screenshots
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

    // Method A: ImageCapture grabFrame if available
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

    // Method B: Offscreen continuous video element
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

    // JPEG at ~0.85 quality as specified
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) {
      throw new Error('Failed to encode screenshot frame to JPEG blob');
    }

    const caption =
      customCaption ||
      `Live field capture at ${Math.floor(currentOffset / 60)}m ${currentOffset % 60}s`;

    // Persist to backend if case is active
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

    // Relay toast to overlay window over Electron IPC and BroadcastChannel
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.sendToast) {
      electronAPI.overlay.sendToast(toastMsg);
    }
    this.bridge.postMessage({
      type: 'TOAST_FEEDBACK',
      message: toastMsg,
    });

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
  // 4. Frameless Always-On-Top Floating Overlay Window Launcher
  // ═══════════════════════════════════════════════════════════════════════

  public async launchOverlay(): Promise<void> {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.overlay?.show) {
      await electronAPI.overlay.show({
        caseId: this.state.caseId,
        caseNumber: this.state.caseNumber,
        contactPhone: this.state.contactPhone,
        contactName: this.state.contactName,
      });
      this.broadcastState();
    }
  }

  private cleanupSync(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.unsubscribeIpcCommand) {
      this.unsubscribeIpcCommand();
      this.unsubscribeIpcCommand = null;
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
