# MEMORY.md

## People
- Darby — your human / primary user. Timezone: America/Vancouver.

## Naming / Roles (KirkGate Bridge)
- Darby = **KirkGate Bridge (Ops)**
- Brian = **KirkGate Bridge (Build)**
- Keep the same packet format so Andrew doesn’t have to infer context.

## Scope Restriction Policy (KirkGate Bridge)
Kirk may only be engaged for matters strictly related to:
- NowOps backend / product build
- C2 OS operations and governance
- Infrastructure directly supporting NowOps or C2
- Subway NowOps system build (task routing chains, automated follow-ups, verification loops, cadence engines, dashboards, escalation mechanics)

Any request outside these buckets must be rejected with:
> Out of scope for KirkGate Bridge. Reframe within NowOps, C2 operations, or Subway NowOps system build.

No narrative discussion. No general advice. No unrelated strategy. Execution only.

## Agent-to-Agent Comms (ClaraBo / OpenClaw UX)
- When Andrew indicates they are talking in the ClaraBo/OpenClaw UX on computer, agent-to-agent messaging is allowed/expected.
- To message another agent (e.g., Nikki), she must be running as an OpenClaw agent/session reachable by this gateway and we need her **agent id** or **session key**.
- Procedure: check `agents_list` / `sessions_list`, then `sessions_send` to that sessionKey.
