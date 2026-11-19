/**
 * ElectronCaptureService (Phase 2 Desktop Native Implementation Stub / Adapter)
 *
 * Implements ICaptureService via window.electronAPI:
 * - Desktop native screen capture (desktopCapturer / native source IDs)
 * - Zero browser permission prompts
 * - Frameless, transparent, always-on-top BrowserWindow for /call-overlay
 *
 * In Phase 1, this acts as the ready-to-wire adapter so Phase 2 requires ZERO changes to UI code.
 */

import {
  ICaptureService,
  CaptureState,
  CaptureServiceListener,
  RecordingOptions,
  RecordingCompleteResult,
  ScreenshotResult,
} from './types';

export class ElectronCaptureService implements ICaptureService {
  private electronAPI: any;
  private listeners = new Set<CaptureServiceListener>();
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
    wakeLockActive: true,
    lastScreenshotToast: null,
  };

  constructor(electronAPI: any) {
    this.electronAPI = electronAPI;

    // Listen to native Electron state updates
    if (this.electronAPI?.onStateChange) {
      this.electronAPI.onStateChange((newState: Partial<CaptureState>) => {
        this.state = { ...this.state, ...newState };
        this.listeners.forEach((fn) => fn(this.getState()));
      });
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

  public async initSession(): Promise<MediaStream> {
    if (this.electronAPI?.initSession) {
      return await this.electronAPI.initSession();
    }
    throw new Error('Electron capture not available');
  }

  public async endSession(): Promise<void> {
    if (this.electronAPI?.endSession) {
      await this.electronAPI.endSession();
    }
  }

  public async startRecording(caseId: string, options?: RecordingOptions): Promise<void> {
    if (this.electronAPI?.startRecording) {
      await this.electronAPI.startRecording(caseId, options);
    }
  }

  public pauseRecording(): void {
    this.electronAPI?.pauseRecording?.();
  }

  public resumeRecording(): void {
    this.electronAPI?.resumeRecording?.();
  }

  public async stopRecording(): Promise<RecordingCompleteResult> {
    if (this.electronAPI?.stopRecording) {
      return await this.electronAPI.stopRecording();
    }
    return { durationSeconds: this.state.elapsedSeconds, chunkCount: 0 };
  }

  public async takeScreenshot(caption?: string): Promise<ScreenshotResult> {
    if (this.electronAPI?.takeScreenshot) {
      return await this.electronAPI.takeScreenshot(caption);
    }
    throw new Error('Electron screenshot not available');
  }

  public getMediaStream(): MediaStream | null {
    return this.electronAPI?.getMediaStream?.() || null;
  }

  public async launchOverlay(): Promise<void> {
    // In Electron, simply tell main process to show the always-on-top transparent overlay window
    if (this.electronAPI?.showOverlay) {
      await this.electronAPI.showOverlay({
        caseId: this.state.caseId,
        caseNumber: this.state.caseNumber,
      });
    }
  }
}
