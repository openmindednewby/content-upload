/* Shared test doubles, imported only by the co-located *.test.ts files (kept outside src: not built, not linted). */
export type Listener = (event: unknown) => void;

export class FakeXhr {
  status = 0;
  responseText = '';
  withCredentials = false;
  method = '';
  url = '';
  body: unknown = undefined;
  readonly headers: Record<string, string> = {};
  private readonly listeners = new Map<string, Listener[]>();
  private readonly uploadListeners = new Map<string, Listener[]>();

  readonly upload = {
    addEventListener: (type: string, fn: Listener): void => {
      this.uploadListeners.set(type, [...(this.uploadListeners.get(type) ?? []), fn]);
    },
  };

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.emit('abort');
  }

  emit(type: string, event: unknown = {}): void {
    (this.listeners.get(type) ?? []).forEach((fn) => fn(event));
  }

  progress(loaded: number, total: number, lengthComputable = true): void {
    (this.uploadListeners.get('progress') ?? []).forEach((fn) => fn({ loaded, total, lengthComputable }));
  }

  respond(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.emit('load');
  }
}

export function fakeResponse(status: number, body: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([body])),
  } as unknown as Response;
}

export const OK_BODY = JSON.stringify({ contentId: 'c-1', status: 'Active', url: 'https://cdn.example/c-1.png' });

export function imageFile(name = 'logo.png', type = 'image/png', bytes = 'abc'): File {
  return new File([bytes], name, { type });
}
