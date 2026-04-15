import type { ResourceType } from './permission.js';

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  description: string;
  createdAt: number;
}
