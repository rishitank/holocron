import { DarthError } from './base.js';

export class BackendError extends DarthError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(message, 'BACKEND_ERROR', cause);
  }
}
