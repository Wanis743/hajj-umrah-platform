import { CommandDefinition, CommandId, CommandContext } from './KernelTypes';

export class CommandRegistry {
  private commands = new Map<CommandId, CommandDefinition>();

  public register(command: CommandDefinition): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command with id ${command.id} is already registered.`);
    }
    this.commands.set(command.id, command);
  }

  public unregister(id: CommandId): void {
    this.commands.delete(id);
  }

  public get(id: CommandId): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  public getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  public async execute(id: CommandId, context: CommandContext): Promise<void> {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command with id ${id} not found.`);
    }
    await command.execute(context);
  }
}
