export {};

declare global {
  interface XRReferenceSpace {
    readonly __xrReferenceSpaceBrand?: never;
  }

  interface XRHitTestSource {
    cancel?(): void;
  }

  interface XRHitTestResult {
    getPose(space: XRReferenceSpace): {
      transform: { position: { x: number; y: number; z: number } };
    } | null;
  }

  interface XRFrame {
    getHitTestResults(source: XRHitTestSource): XRHitTestResult[];
  }

  interface XRSession {
    depthUsage?: unknown;
    depthDataFormat?: unknown;
    updateRenderState(state: Record<string, unknown>): void;
    requestReferenceSpace(type: string): Promise<XRReferenceSpace>;
    requestHitTestSource(options: { space: XRReferenceSpace }): Promise<XRHitTestSource>;
    requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number;
    addEventListener(type: string, listener: () => void): void;
    end(): Promise<void>;
  }

  interface Navigator {
    xr?: {
      isSessionSupported(mode: string): Promise<boolean>;
      requestSession(mode: string, options: Record<string, unknown>): Promise<XRSession>;
    };
  }

  const XRWebGLLayer: {
    new (session: XRSession, context: WebGLRenderingContext): { framebuffer: WebGLFramebuffer | null };
  };
}
