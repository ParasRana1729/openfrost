export type AgentRuntimeStatus = {
  ready: boolean;
  description: string;
};

export function getAgentRuntimeStatus(): AgentRuntimeStatus {
  return {
    ready: false,
    description: "Agent runtime scaffolded; provider loop arrives in a later issue.",
  };
}
