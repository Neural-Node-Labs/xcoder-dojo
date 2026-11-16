// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:27:38.385Z | xcoder:subtask code-st-1de5aa
/**
 * The action contract. Every privileged operation is expressed as an
 * ActionDescriptor; the dispatcher validates input in main and refuses to run
 * an action whose approval gate was not satisfied.
 */

export type SideEffectClass = 'none' | 'read' | 'write' | 'execute' | 'secret';
export type ActorOrigin = 'user' | 'agent' | 'system';

export interface ActionContext {
  origin: ActorOrigin;
  approvalId?: string;
  nowMs: number;
}

export interface ActionDescriptor<In, Out> {
  readonly name: string;
  readonly sideEffect: SideEffectClass;
  /** Non-optional by design: a high-impact action cannot lack a gate. */
  readonly requiresApproval: boolean;
  readonly enforcedIn: 'main';
  /** Already-redacted summary shown in the approval sheet and audit log. */
  readonly summarize: (input: In) => string;
  readonly validate: (raw: unknown) => In;
  readonly run: (input: In, ctx: ActionContext) => Promise<Out>;
}

export function defineAction<In, Out>(spec: ActionDescriptor<In, Out>): ActionDescriptor<In, Out> {
  return spec;
}
