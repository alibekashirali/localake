import type { WorkspaceEvent } from "./types";

type Listener = (event: WorkspaceEvent) => void;

const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * Single shared socket for query lifecycle and catalog events.
 *
 * Reconnects with backoff: the backend restarting under `--reload` should not
 * leave the UI permanently deaf.
 */
class WorkspaceSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private openListeners = new Set<() => void>();
  private retryMs = BASE_RETRY_MS;
  private timer: number | null = null;
  private closed = false;

  connect(): void {
    if (this.socket || this.closed) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.retryMs = BASE_RETRY_MS;
      this.openListeners.forEach((listener) => listener());
    };
    socket.onmessage = (message) => {
      let event: WorkspaceEvent;
      try {
        event = JSON.parse(message.data as string);
      } catch {
        return;
      }
      if (event.type === "ping") return;
      this.listeners.forEach((listener) => listener(event));
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      this.timer = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
    socket.onerror = () => socket.close();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fired every time the socket (re)opens, so callers can resync state. */
  onOpen(listener: () => void): () => void {
    this.openListeners.add(listener);
    this.connect();
    return () => {
      this.openListeners.delete(listener);
    };
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.socket?.close();
  }
}

export const workspaceSocket = new WorkspaceSocket();
