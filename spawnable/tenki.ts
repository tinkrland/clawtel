/**
 * the tenki lane. thin provider: lifecycle only, honestly closed
 * everywhere the rail is not built yet. env-gated: TENKI_API_KEY
 * present = lane available, unset = closed, never faked.
 */

import { TenkiSandbox, type Session } from "@tenkicloud/sandbox";
import type { Spawnable, SpawnableExecResult, SpawnableProvider, SpawnableSpec, SpawnableStatus } from "./types.ts";

export type TenkiProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

const decoder = new TextDecoder();

/** deno or node, whichever is carrying this process */
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;
function envGet(key: string): string | undefined {
  if (typeof Deno !== "undefined") return Deno.env.get(key);
  return process.env[key];
}

function spawnableStatus(session: Session): SpawnableStatus {
  switch (session.state) {
    case "RUNNING":
    case "RESUMING":
      return "running";
    case "PAUSED":
    case "PAUSING":
      return "paused";
    case "CREATING":
      return "created";
    case "USER_SHUTDOWN":
      return "stopped";
    case "TERMINATING":
    case "TERMINATED":
    case "UNSPECIFIED":
      return "stopped";
  }
}

/** thrown wherever a rail exists in the seam but is not wired yet */
function notWired(what: string): Error {
  return new Error(
    `${what} is not wired in the tenki provider yet. the primitive is ` +
      `verified (see coverage.md), the rail is pending. it does not guess.`,
  );
}

export class TenkiProvider implements SpawnableProvider {
  readonly lane = "tenki" as const;
  readonly client: TenkiSandbox;
  private readonly apiKey: string | undefined;

  constructor(options: TenkiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? envGet("TENKI_API_KEY");
    this.client = new TenkiSandbox({
      authToken: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  private async requireSession(name: string): Promise<Session> {
    const sessions = await this.client.list();
    const found = sessions.find((s) => s.name === name);
    if (!found) {
      throw new Error(`no tenki spawnable named '${name}'. create it first.`);
    }
    return found;
  }

  private toRoom(session: Session): Spawnable {
    return {
      name: session.name,
      status: spawnableStatus(session),
      screen: {
        grab: () => {
          throw notWired("screen capture");
        },
        stop: async () => {
          throw notWired("screen capture");
        },
      },
      input: {
        browser: {
          navigate: async () => {
            throw notWired("browser actuation");
          },
          click: async () => {
            throw notWired("browser actuation");
          },
          evaluate: async () => {
            throw notWired("browser actuation");
          },
        },
        xInput: null,
      },
    };
  }

  async create(spec: SpawnableSpec): Promise<Spawnable> {
    if (spec.desktop) {
      throw notWired("desktop provisioning");
    }
    const session = await this.client.createAndWait({
      name: spec.name,
      cpuCores: spec.cpu,
      memoryMb: spec.memoryMib,
      diskSizeGb: spec.diskGiB,
      timeoutMs: 180_000,
    });
    return this.toRoom(session);
  }

  async start(name: string): Promise<Spawnable> {
    const session = await this.requireSession(name);
    if (session.state === "RUNNING" || session.state === "RESUMING") {
      return this.toRoom(session);
    }
    if (session.state === "PAUSED" || session.state === "PAUSING") {
      await session.resume();
      await session.waitResumed(120_000);
      await session.refresh();
      return this.toRoom(session);
    }
    throw new Error(
      `tenki cannot cold-start a spawnable in state '${session.state}'. ` +
        `state survives via pause and resume; destroyed spawnables do not come back.`,
    );
  }

  async exec(name: string, command: string): Promise<SpawnableExecResult> {
    const session = await this.requireSession(name);
    const result = await session.exec(["bash", "-lc", command], { timeoutMs: 120_000 });
    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  }

  async pause(name: string): Promise<void> {
    const session = await this.requireSession(name);
    await session.pause();
    await session.waitPaused(120_000);
  }

  async resume(name: string): Promise<Spawnable> {
    const session = await this.requireSession(name);
    await session.resume();
    await session.waitResumed(120_000);
    await session.refresh();
    return this.toRoom(session);
  }

  async destroy(name: string): Promise<void> {
    const session = await this.requireSession(name);
    await session.close();
  }
}
