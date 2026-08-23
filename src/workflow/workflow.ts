export type WorkflowInstance = { id: string; triggerEvent: string; currentStepId: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ESCALATED'; steps: { id: string; action: string; status: 'PENDING' | 'DONE' }[] };
export const PREDEFINED_WORKFLOWS = { VISA_REJECTION: ['Notify_Agent', 'Request_Re_submission', 'Update_Pilgrim_Status'], FLIGHT_CHANGE: ['Identify_Affected_Groups', 'Reallocate_Transport', 'Notify_Hotels', 'Notify_Pilgrims'], PAYMENT_FAILURE: ['Send_Reminder_Email', 'Alert_Finance_Team'], GROUP_AT_RISK: ['Escalate_To_Manager', 'Trigger_Emergency_Readiness_Review'] } as const;
export function createWorkflow(trigger: string, steps: string[]): WorkflowInstance {
  if (!steps.length) throw new Error('Workflow requires at least one step');
  return { id: `WF-${crypto.randomUUID()}`, triggerEvent: trigger, currentStepId: steps[0] ?? '', status: 'RUNNING', steps: steps.map(s => ({ id: s, action: s.replace(/_/g, ' '), status: 'PENDING' })) };
}
export function executeStep(workflow: WorkflowInstance, stepId: string) {
  const index = workflow.steps.findIndex(s => s.id === stepId);
  if (index < 0 || !workflow.steps[index] || workflow.status !== 'RUNNING') return { success: false, workflow, error: 'Step unavailable' };
  workflow.steps[index].status = 'DONE';
  const next = workflow.steps[index + 1];
  if (next) workflow.currentStepId = next.id; else { workflow.status = 'COMPLETED'; workflow.currentStepId = stepId; }
  return { success: true, workflow, executedStepId: stepId, nextStepId: next?.id ?? null };
}
export function checkEscalation(workflow: WorkflowInstance, slaBreached = false) {
  if (workflow.status === 'RUNNING' && slaBreached) { workflow.status = 'ESCALATED'; return { escalated: true, reason: 'SLA Breached' }; }
  return { escalated: false };
}
