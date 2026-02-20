import { DarthError } from './base.js';

export class ContextError extends DarthError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONTEXT_ERROR', cause);
  }
}
