import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { defer, finalize, mergeMap, Observable } from 'rxjs';

type WaitingUpload = {
  cancelled: boolean;
  grant: (release: () => void) => void;
};

/**
 * Holds a process-wide upload slot before Multer starts buffering a product image.
 *
 * Product-image decoding and rendition generation are deliberately serialized in
 * ProductMediaService. Acquiring the same-sized admission slot at the HTTP edge
 * also prevents several full multipart files from being buffered while they wait
 * for that work.
 */
@Injectable()
export class ProductMediaUploadGateInterceptor implements NestInterceptor {
  private occupied = false;
  private readonly waiters: WaitingUpload[] = [];

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return this.acquire().pipe(
      mergeMap((release) => defer(() => next.handle()).pipe(finalize(release))),
    );
  }

  private acquire(): Observable<() => void> {
    return new Observable((subscriber) => {
      const cancelWait = this.enqueue((release) => {
        if (subscriber.closed) {
          release();
          return;
        }
        subscriber.next(release);
        subscriber.complete();
      });
      return cancelWait;
    });
  }

  private enqueue(grant: WaitingUpload['grant']): () => void {
    const waiter: WaitingUpload = { cancelled: false, grant };

    if (!this.occupied) {
      this.occupied = true;
      grant(this.releaseOnce());
    } else {
      this.waiters.push(waiter);
    }

    return () => {
      waiter.cancelled = true;
    };
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.promoteNextWaiter();
    };
  }

  private promoteNextWaiter(): void {
    let next = this.waiters.shift();
    while (next?.cancelled) next = this.waiters.shift();

    if (!next) {
      this.occupied = false;
      return;
    }

    next.grant(this.releaseOnce());
  }
}
