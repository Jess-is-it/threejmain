import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestWithContext } from './request-context';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const request = req as RequestWithContext;
    const incoming = req.header('X-Correlation-Id');
    const correlationId = incoming && incoming.trim().length > 0 ? incoming : uuidv4();
    request.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
