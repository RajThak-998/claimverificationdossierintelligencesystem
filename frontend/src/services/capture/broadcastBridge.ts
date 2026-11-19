/**
 * Cross-Window Broadcast Bridge
 * Keeps the standalone /call-overlay route (popup, PiP, or Electron window)
 * synchronized with the main tab's CaptureService.
 */

import { CaptureState } from './types';

export const CAPTURE_BUS_CHANNEL = 'motor_claim_capture_bus';

export type BridgeMessage =
  | { type: 'STATE_UPDATE'; payload: CaptureState }
  | { type: 'CMD_START_RECORDING' }
  | { type: 'CMD_TAKE_SCREENSHOT'; caption?: string }
  | { type: 'CMD_STOP_RECORDING' }
  | { type: 'CMD_PAUSE_RECORDING' }
  | { type: 'CMD_RESUME_RECORDING' }
  | { type: 'CMD_REQUEST_STATE' }
  | { type: 'TOAST_FEEDBACK'; message: string };

export class CaptureBroadcastBridge {
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(CAPTURE_BUS_CHANNEL);
      } catch (err) {
        console.warn('BroadcastChannel initialization error:', err);
      }
    }
  }

  postMessage(msg: BridgeMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch (err) {
      console.warn('Failed to post broadcast message:', err);
    }
  }

  onMessage(handler: (msg: BridgeMessage) => void): () => void {
    if (!this.channel) return () => {};

    const listener = (event: MessageEvent<BridgeMessage>) => {
      if (event.data && typeof event.data === 'object' && 'type' in event.data) {
        handler(event.data);
      }
    };

    this.channel.addEventListener('message', listener);
    return () => {
      this.channel?.removeEventListener('message', listener);
    };
  }

  destroy(): void {
    try {
      this.channel?.close();
    } catch {
      // Ignore
    }
    this.channel = null;
  }
}
