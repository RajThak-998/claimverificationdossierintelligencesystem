/**
 * Capture Service Types & Interfaces
 * Phase 1: Web implementation (MediaStream, MediaRecorder, PiP / popup overlay)
 * Phase 2: Electron implementation (Desktop native capture, frameless always-on-top window)
 */

export type CaptureSessionState =
  | 'idle'             // No media stream active
  | 'session_active'   // MediaStream acquired and ready; not recording yet
  | 'recording'        // Currently recording video stream
  | 'paused'           // Recording paused
  | 'stopping'         // Finalizing recording buffers and flushing chunks
  | 'error';           // Error state

export interface CaptureState {
  sessionState: CaptureSessionState;
  hasActiveStream: boolean;
  isRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  caseId: string | null;
  caseNumber: string | null;
  contactPhone: string | null;
  contactName: string | null;
  error: string | null;
  screenshotCount: number;
  wakeLockActive: boolean;
  lastScreenshotToast: string | null;
}

export interface ScreenshotResult {
  blob: Blob;
  dataUrl?: string;
  offsetSeconds: number;
  timestamp: number;
  width: number;
  height: number;
  caption?: string;
}

export interface RecordingOptions {
  caseNumber?: string;
  contactPhone?: string;
  contactName?: string;
  contactId?: string;
}

export interface RecordingCompleteResult {
  durationSeconds: number;
  recordingId?: string;
  chunkCount: number;
}

export interface CaptureServiceListener {
  (state: CaptureState): void;
}

/**
 * Clean ICaptureService contract
 * UI components interact ONLY with this interface.
 */
export interface ICaptureService {
  getState(): CaptureState;
  subscribe(listener: CaptureServiceListener): () => void;

  /**
   * Request / ensure persistent screen capture stream for this session.
   * Prompts getDisplayMedia once and keeps stream alive until endSession().
   */
  initSession(): Promise<MediaStream>;

  /**
   * Pre-configures active case metadata without immediately starting recording.
   * Enables manual recording start/stop directly from the floating overlay buttons.
   */
  prepareSession(caseId: string, options?: RecordingOptions): void;

  /**
   * Terminates active MediaStream tracks and resets session state to idle.
   */
  endSession(): Promise<void>;

  /**
   * Starts recording the active stream for a specific case.
   * Begins 10s timeslice chunking and acquires screen wake lock.
   */
  startRecording(caseId: string, options?: RecordingOptions): Promise<void>;

  pauseRecording(): void;
  resumeRecording(): void;

  /**
   * Flushes active buffers, uploads final chunk, and marks recording ready.
   */
  stopRecording(): Promise<RecordingCompleteResult>;

  /**
   * Captures the current video frame via offscreen canvas without disrupting recording.
   */
  takeScreenshot(caption?: string): Promise<ScreenshotResult>;

  /**
   * Returns current active MediaStream or null.
   */
  getMediaStream(): MediaStream | null;

  /**
   * Launches the floating controls (/call-overlay) via Document PiP or compact window.
   */
  launchOverlay(): Promise<void>;
}
