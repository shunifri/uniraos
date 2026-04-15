import { getCurrentUserId } from '../../user/request-context.js';

export class DataIsolationService {
  ensureOwner(userId: string, expectedOwner: string): void {
    if (userId !== expectedOwner && expectedOwner !== 'default') {
      throw new Error('Data isolation violation: user does not own this resource');
    }
  }

  getCurrentUserId(): string {
    return getCurrentUserId();
  }

  isValidUserId(userId: string): boolean {
    return !!userId && userId.length > 0;
  }

  sanitizeOwner(owner?: string): string {
    return owner || this.getCurrentUserId();
  }

  async filterByOwner<T extends { owner?: string }>(
    items: T[],
    owner: string
  ): Promise<T[]> {
    return items.filter((item) => item.owner === owner || item.owner === undefined);
  }
}
