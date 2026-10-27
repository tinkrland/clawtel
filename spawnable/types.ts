// clawtel spawnable contract
//
// a spawnable is a computer the agent works from. two forms:
//
// - workbench: persistent. files, installed apps and running processes
//   survive pause/resume cycles. idle means paused: no compute burned,
//   nothing lost. this is the office-hours shape.
// - dock: ephemeral. created for one job, destroyed when done. nothing
//   is expected to survive. this is the render-job / one-off-demo shape.
//
// every lane implements this same seam. env-gated throughout: a lane
// without its key stays closed, and nothing ever fakes capability.

export type SpawnableForm = "workbench" | "dock";

export type SpawnableStatus = "created" | "running" | "paused" | "stopped";

export interface SpawnableSpec {
  name: string;
  form: SpawnableForm;
  cpu: number;
  memoryMib: number;
  diskGiB: number;
  /**
   * desktop means a real x display plus a headed browser inside the
   * spawnable, so the agent can appear on camera, share its screen and
   * drive native apps. false = headless work machine.
   */
  desktop: boolean;
}

export interface SpawnableExec {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScreenHandle {
  /**
   * grab a frame of the spawnable's display. returns raw rgba bytes
   * (width x height x 4, row-major). honesty rule: providers that cannot
   * deliver pixel truth throw, never return a placeholder frame.
   */
  grab(): Promise<{ width: number; height: number; rgba: Uint8Array }>;
  startCapture(fps: number): ReadableStream<{ width: number; height: number; rgba: Uint8Array }>;
  stopCapture(): Promise<void>;
}

export interface InputHandle {
  /**
   * browser actuation inside the spawnable (navigate, click css
   * selectors, type). null when the spawnable has no desktop.
   */
  browser: {
    navigate(url: string): Promise<void>;
    click(selector: string): Promise<void>;
    type(selector: string, text: string): Promise<void>;
    screenshot(): Promise<Uint8Array>;
  } | null;
  /**
   * native-app actuation (keys and pointer at the x level for desktop
   * spawnables). null until a provider wires it; never guessed.
   */
  xInput: {
    key(name: string): Promise<void>;
    pointer(x: number, y: number, action: "click" | "move"): Promise<void>;
  } | null;
}

export interface Spawnable {
  name: string;
  status: SpawnableStatus;
  screen: ScreenHandle;
  input: InputHandle;
}

export interface SpawnableProvider {
  readonly lane: string;
  /** sync check: env present = lane open, unset = closed. never fakes. */
  isAvailable(): boolean;
  create(spec: SpawnableSpec): Promise<Spawnable>;
  /** make a paused/stopped spawnable running again. no-op if already running. */
  start(name: string): Promise<void>;
  exec(name: string, command: string, timeoutMs?: number): Promise<SpawnableExec>;
  /** workbench only. frees compute, keeps files and memory. docks pause too, nothing is owed. */
  pause(name: string): Promise<void>;
  /** back from pause. */
  resume(name: string): Promise<void>;
  /** permanent, with receipts: the spawnable is gone once this resolves. */
  destroy(name: string): Promise<void>;
}
