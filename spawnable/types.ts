/**
 * the spawnable seam. one interface, many lanes, env-gated throughout.
 * a lane without its credentials is closed and says so, never faked.
 */

export type SpawnableStatus = "created" | "running" | "paused" | "stopped";

export type SpawnableSpec = {
  /** stable name; the spawnable keeps state across sessions */
  name: string;
  /** cpu cores, 2 is the floor for a desktop spawnable */
  cpu: number;
  /** memory in mib, 4096 is the floor for a headed browser */
  memoryMib: number;
  /** ephemeral root disk in gib */
  diskGiB: number;
  /** true = the spawnable gets an x display and a headed browser */
  desktop: boolean;
};

export type SpawnableExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** capture handle: pixels from the spawnable's display, x11grab class */
export type SpawnableScreen = {
  /** start pulling frames; returns rgba, the family's pixel contract */
  grab: (width: number, height: number, fps: number) => ReadableStream<Uint8Array>;
  stop: () => Promise<void>;
};

/** actuation handle: browser first, x input second for native apps */
export type SpawnableInput = {
  /** cdp-style drive of the spawnable's browser (dom actuation lives here) */
  browser: {
    navigate: (url: string) => Promise<void>;
    click: (selector: string) => Promise<void>;
    evaluate: (expression: string) => Promise<unknown>;
  };
  /** x input seam, only when desktop: true. throws honestly otherwise */
  xInput: {
    key: (keys: string) => Promise<void>;
    mouseMove: (x: number, y: number) => Promise<void>;
    click: (x: number, y: number) => Promise<void>;
  } | null;
};

export type Spawnable = {
  name: string;
  status: SpawnableStatus;
  screen: SpawnableScreen;
  input: SpawnableInput;
};

export interface SpawnableProvider {
  /** lane name for coverage and receipts */
  readonly lane: "tenki" | "self-hosted";

  /** true only when this lane's credentials/config exist. unset = closed */
  isAvailable(): boolean;

  create(spec: SpawnableSpec): Promise<Spawnable>;
  /** cold start; the spawnable's files, packages and logins survive */
  start(name: string): Promise<Spawnable>;
  exec(name: string, command: string): Promise<SpawnableExecResult>;
  /** compute freed, memory and files preserved. generous grace, sync first */
  pause(name: string): Promise<void>;
  resume(name: string): Promise<Spawnable>;
  /** permanent. receipts should say so */
  destroy(name: string): Promise<void>;
}
