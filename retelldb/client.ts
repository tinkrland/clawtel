// the retelldb client: clawtel's control plane talking to the memory
// data plane (a python service, http). env-gated like every lane:
// RETELLDB_URL unset = the memory lane is closed and every call says
// so. a failure returns null with a reason, never fabricated memory.

export interface MemoryScope {
  persona_id?: string;
  platform: string;
  connection_id?: string;
}

export interface IngestNode {
  type: string;
  key: string;
  text: string;
  tags?: string[];
  platform?: string;
  connection_id?: string;
  sensitivity?: "normal" | "private";
  artifact_id?: string;
  pointer?: string;
}

export interface IngestArtifact {
  name: string;
  content: string;
  mime?: string;
  platform?: string;
  connection_id?: string;
  tags?: string[];
  source_uri?: string;
}

export interface MemoryNode {
  node_id: string;
  type: string;
  text: string;
  platform: string | null;
  connection_id: string | null;
  artifact_id: string | null;
  pointer: string | null;
  score: number;
}

export interface GroundingBrief {
  enabled: boolean;
  retrieval: string;
  brief: { line: string; citation: string; score: number; node_id: string }[];
  artifacts: { id: string; name: string; mime: string; tool: string }[];
  dropped: { id: string; reason: string }[];
  prompt_line: string | null;
  detail?: string;
}

export type MemoryResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export class RetelldbClient {
  private baseUrl: string | undefined;
  private apiKey: string | undefined;

  constructor(env: { url?: string; key?: string } = {}) {
    this.baseUrl = env.url ?? process.env?.RETELLDB_URL;
    this.apiKey = env.key ?? process.env?.RETELLDB_API_KEY;
  }

  isAvailable(): boolean {
    return typeof this.baseUrl === "string" && this.baseUrl.length > 0;
  }

  private async post(path: string, payload: unknown, timeoutMs = 10_000): Promise<MemoryResult<unknown>> {
    if (!this.isAvailable()) {
      return { ok: false, reason: "the memory lane is closed: RETELLDB_URL is unset" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl!.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return { ok: false, reason: (body as { error?: string })?.error ?? `the service said ${res.status}` };
      }
      return { ok: true, data: body };
    } catch (err) {
      // a failure is a failure: null memory, never a guess
      return { ok: false, reason: `the memory service did not answer: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  ingest(
    personaId: string,
    nodes: IngestNode[],
    artifacts: IngestArtifact[] = [],
    scope?: MemoryScope,
  ): Promise<MemoryResult<{ ingested: { nodes: number; artifacts: number }; node_ids: string[]; artifact_ids: string[] }>> {
    return this.post("/v1/ingest", {
      persona_id: personaId,
      nodes,
      artifacts,
      scope,
    }) as Promise<MemoryResult<{ ingested: { nodes: number; artifacts: number }; node_ids: string[]; artifact_ids: string[] }>>;
  }

  query(query: string, scope: MemoryScope, limit = 8): Promise<MemoryResult<{ nodes: MemoryNode[]; dropped: { id: string; reason: string }[]; retrieval: string }>> {
    return this.post("/v1/query", { query, scope, limit }) as Promise<MemoryResult<{ nodes: MemoryNode[]; dropped: { id: string; reason: string }[]; retrieval: string }>>;
  }

  ground(query: string, scope: MemoryScope, limit = 8): Promise<MemoryResult<GroundingBrief>> {
    return this.post("/v1/ground", { query, scope, limit }) as Promise<MemoryResult<GroundingBrief>>;
  }

  async tool(name: string, args: Record<string, unknown>, scope: MemoryScope): Promise<MemoryResult<unknown>> {
    if (!this.isAvailable()) {
      return { ok: false, reason: "the memory lane is closed: RETELLDB_URL is unset" };
    }
    try {
      const res = await fetch(`${this.baseUrl!.replace(/\/$/, "")}/v1/tools`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify({ name, args, scope }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      // a tool-level refusal is an honest answer, not a transport
      // failure: the body carries ok:false and the reason, and it
      // reaches the caller intact
      if (body && body.ok === false) {
        return { ok: true, data: body };
      }
      if (!res.ok) {
        return { ok: false, reason: body?.error ?? `the service said ${res.status}` };
      }
      return { ok: true, data: body };
    } catch (err) {
      return { ok: false, reason: `the memory service did not answer: ${(err as Error).message}` };
    }
  }

  /** the tool-calling agent: it decides what to look up, we execute, it cites. */
  async answer(
    question: string,
    scope: MemoryScope,
    opts: { maxSteps?: number } = {},
  ): Promise<MemoryResult<unknown>> {
    if (!this.isAvailable()) {
      return { ok: false, reason: "the memory lane is closed: RETELLDB_URL is unset" };
    }
    try {
      const res = await fetch(`${this.baseUrl!.replace(/\/$/, "")}/v1/answer`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify({ question, scope, max_steps: opts.maxSteps }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      // a refusal with a reason is the agent's honest answer, not a
      // transport failure: it passes through intact
      if (body && body.ok === false && body.error) {
        return { ok: true, data: body };
      }
      if (!res.ok) {
        return { ok: false, reason: body?.error ?? `the service said ${res.status}` };
      }
      return { ok: true, data: body };
    } catch (err) {
      return { ok: false, reason: `the memory service did not answer: ${(err as Error).message}` };
    }
  }

  async status(): Promise<MemoryResult<{ nodes: number; artifacts: number; persistence: string; lanes?: Record<string, unknown> }>> {
    if (!this.isAvailable()) {
      return { ok: false, reason: "the memory lane is closed: RETELLDB_URL is unset" };
    }
    try {
      const res = await fetch(`${this.baseUrl!.replace(/\/$/, "")}/v1/status`, {
        headers: this.apiKey ? { "x-api-key": this.apiKey } : {},
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, reason: (body as { error?: string })?.error ?? `the service said ${res.status}` };
      return { ok: true, data: body };
    } catch (err) {
      return { ok: false, reason: `the memory service did not answer: ${(err as Error).message}` };
    }
  }
}

// the process-wide client, wired from env like every other lane
export const memory = new RetelldbClient();
