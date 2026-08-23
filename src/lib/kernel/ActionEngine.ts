import { Action } from './KernelTypes';
import { supabase } from '@/lib/supabase';

type ActionListener = (actions: Action[]) => void;

export class ActionEngine {
  private actions: Action[] = [];
  private listeners: Set<ActionListener> = new Set();

  public subscribe(listener: ActionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.actions));
  }

  public dispatch(action: Action): void {
    this.actions.push(action);
    this.notify();
    this.process(action.id);
  }
  private async process(actionId: string): Promise<void> {
    const actionIndex = this.actions.findIndex((a) => a.id === actionId);
    if (actionIndex === -1) return;

    this.actions[actionIndex].status = 'processing';
    this.notify();

    try {
      const action = this.actions[actionIndex];
      const { error } = await supabase.rpc('execute_kernel_action', {
        action_type: action.type,
        payload: action.payload as never // Typescript might complain about Json type, let's see. Better yet, just cast to what's accepted. Wait, if payload is Record<string, unknown>, it can be passed as Json. If there's type issues we'll fix it. Let's pass it safely.
      });
      if (error) throw new Error(error.message);
      
      this.actions[actionIndex].status = 'completed';
    } catch (error) {
      this.actions[actionIndex].status = 'failed';
      if (error instanceof Error) {
        this.actions[actionIndex].error = error;
      } else {
        this.actions[actionIndex].error = new Error(String(error));
      }
    } finally {
      this.notify();
    }
  }
  
  public getActions(): Action[] {
    return this.actions;
  }
}
