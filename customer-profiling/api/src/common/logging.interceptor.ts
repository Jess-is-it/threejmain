import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestWithContext } from './request-context';

@Injectable()
export class CorrelationLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now();
    const req = context.switchToHttp().getRequest<RequestWithContext>();

    return next.handle().pipe(
      tap(() => {
        const payload = {
          level: 'info',
          correlationId: req.correlationId,
          method: req.method,
          path: req.originalUrl,
          actorUserId: req.user?.userId || 'anonymous',
          latencyMs: Date.now() - now,
        };
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(payload));
      }),
    );
  }
}
