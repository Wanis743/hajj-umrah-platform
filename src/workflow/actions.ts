export type Action = {
  id: string;
  insight: string;
  recommendation: string;
  owner: string;
  deadline: Date;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  result?: string;
};

const actionStore: Action[] = [];

export function createAction(insight: string, recommendation: string, owner: string, deadline: Date): Action {
  const action: Action = {
    id: `ACT-${Date.now()}`,
    insight,
    recommendation,
    owner,
    deadline,
    status: 'OPEN'
  };
  actionStore.push(action);
  return action;
}

export function completeAction(actionId: string, result: string) {
  const action = actionStore.find(a => a.id === actionId);
  if (action) {
    action.status = 'COMPLETED';
    action.result = result;
  }
  return { success: !!action, action };
}

export function measureEffectiveness(action: Action, kpiBefore: number, kpiAfter: number) {
  const improvement = kpiAfter - kpiBefore;
  return {
    actionId: action.id,
    kpiImprovement: improvement,
    effective: improvement > 0
  };
}

export function getOpenActions(): Action[] {
  return actionStore
    .filter(a => a.status === 'OPEN' || a.status === 'IN_PROGRESS')
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}
