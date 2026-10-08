/**
 * A fake `EventSource` for web tests. jsdom has none, and tests need to push
 * server-sent events by hand.
 */
import { vi } from 'vitest';

type MessageListener = (message: MessageEvent<string>) => void;

/** A fake connection; tests call `emit` to deliver events. */
export class FakeEventSource {
  // These mirror the real EventSource's constant names, which code under test reads.
  /* eslint-disable @typescript-eslint/naming-convention */
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /* eslint-enable @typescript-eslint/naming-convention */
  /** Every connection opened since the fake was installed. */
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.OPEN;
  private readonly listeners = new Map<string, MessageListener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: MessageListener): void {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener]);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /**
   * Delivers one event to the listeners for `eventName`.
   *
   * @param eventName - e.g. `run-event`.
   * @param data - Serialized as the event's JSON data.
   */
  emit(eventName: string, data: unknown): void {
    const message = new MessageEvent<string>(eventName, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(message);
    }
  }
}

/**
 * Replaces the global `EventSource` with the fake.
 *
 * @returns The fake class, whose `instances` lists opened connections.
 */
export function installFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  return FakeEventSource;
}
