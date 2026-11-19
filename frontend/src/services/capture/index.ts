/**
 * Capture Service Factory & Exports
 */

import { ICaptureService } from './types';
import { WebCaptureService } from './WebCaptureService';
import { ElectronCaptureService } from './ElectronCaptureService';

export * from './types';
export * from './storageHandler';
export * from './broadcastBridge';
export * from './WebCaptureService';
export * from './ElectronCaptureService';
export * from './useCaptureService';

let captureServiceInstance: ICaptureService | null = null;

/**
 * Returns the singleton ICaptureService.
 * In Phase 1: Pure web implementation (WebCaptureService)
 * In Phase 2: When wrapped in Electron, window.electronAPI is present and ElectronCaptureService is returned.
 * UI components call this without knowing or caring whether they are in Web or Electron!
 */
export function getCaptureService(): ICaptureService {
  if (!captureServiceInstance) {
    if (typeof window !== 'undefined' && ((window as any).electronAPI?.isElectron || (window as any).electronAPI)) {
      captureServiceInstance = ElectronCaptureService.getInstance();
    } else {
      captureServiceInstance = WebCaptureService.getInstance();
    }
  }
  return captureServiceInstance;
}

/**
 * Overrides or sets custom capture service (useful for tests or mocking).
 */
export function setCaptureService(service: ICaptureService | null): void {
  captureServiceInstance = service;
}
