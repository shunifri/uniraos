import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get request ID from header or generate new one
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  
  // Attach to request object
  req.requestId = requestId;
  
  // Set response header
  res.setHeader('X-Request-Id', requestId);
  
  next();
}
