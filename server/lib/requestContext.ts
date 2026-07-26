import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestStore = {
  requestId: string;
  userId: string;
  startTs: number;
  traceId?: string;
};

const als = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn);
  },
  get(): RequestStore | undefined {
    return als.getStore();
  },
};
