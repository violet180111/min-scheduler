import { beforeEach, afterEach, vi, describe, it, expect } from 'vitest';
import { NormalPriority } from '../src/priority';

type BrowserRuntime = {
  advanceTime: (ms: number) => void;
  resetTime: () => void;
  fireMessageEvent: () => void;
  log: (val: string) => void;
  isLogEmpty: () => boolean;
  assertLog: (expected: string[]) => void;
};

describe('SchedulerBrowser', () => {
  let runtime: BrowserRuntime;
  let scheduleCallback;
  let cancelCallback;
  let shouldYield;

  beforeEach(async () => {
    vi.resetModules();

    runtime = installMockBrowserRuntime();

    const Scheduler = await import('../src/scheduler');

    cancelCallback = Scheduler.cancelCallback;
    scheduleCallback = Scheduler.scheduleCallback;
    shouldYield = Scheduler.shouldYield;
  });

  afterEach(() => {
    if (!runtime.isLogEmpty()) {
      throw Error('Test exited without clearing log.');
    }
  });

  function installMockBrowserRuntime() {
    let hasPendingMessageEvent = false;

    let timerIDCounter = 0;

    let eventLog: string[] = [];

    let currentTime = 0;

    const port1 = {
      onmessage() {},
    };
    const port2 = {
      postMessage() {
        if (hasPendingMessageEvent) {
          throw Error('Message event already scheduled');
        }
        log('Post Message');
        hasPendingMessageEvent = true;
      },
    };

    vi.stubGlobal('performance', {
      now() {
        return currentTime;
      },
    });

    vi.stubGlobal('setTimeout', function (cb: Function, delay: number) {
      const id = timerIDCounter++;
      log(`Set Timer`);
      return id;
    });

    vi.stubGlobal('clearTimeout', function (id: number) {});

    vi.stubGlobal('MessageChannel', function (this: Record<string, any>) {
      this.port1 = port1;
      this.port2 = port2;
    });

    function ensureLogIsEmpty() {
      if (eventLog.length !== 0) {
        throw Error('Log is not empty. Call assertLog before continuing.');
      }
    }

    function advanceTime(ms: number) {
      currentTime += ms;
    }

    function resetTime() {
      currentTime = 0;
    }

    function fireMessageEvent() {
      ensureLogIsEmpty();

      if (!hasPendingMessageEvent) {
        throw Error('No message event was scheduled');
      }

      hasPendingMessageEvent = false;

      const onMessage = port1.onmessage;

      log('Message Event');

      onMessage();
    }

    function log(val: string) {
      eventLog.push(val);
    }
    function isLogEmpty() {
      return eventLog.length === 0;
    }
    function assertLog(expected: string[]) {
      const actual = eventLog;

      eventLog = [];

      expect(actual).toEqual(expected);
    }
    return {
      advanceTime,
      resetTime,
      fireMessageEvent,
      log,
      isLogEmpty,
      assertLog,
    };
  }

  it('task that finishes before deadline', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });

    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Task']);
  });

  it('task with continuation', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
      while (!shouldYield()) {
        runtime.advanceTime(1);
      }
      runtime.log(`Yield at ${performance.now()}ms`);
      return () => {
        runtime.log('Continuation');
      };
    });
    runtime.assertLog(['Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Task', 'Yield at 5ms', 'Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Continuation']);
  });

  it('multiple tasks', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'A', 'B']);
  });

  it('multiple tasks with a yield in between', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
      runtime.advanceTime(4999);
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'A', 'Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  it('cancels tasks', () => {
    const task = scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Post Message']);
    cancelCallback(task);
    runtime.assertLog([]);
  });

  it('throws when a task errors then continues in a new event', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Oops!');
      throw Error('Oops!');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('Yay');
    });
    runtime.assertLog(['Post Message']);

    expect(() => runtime.fireMessageEvent()).toThrow('Oops!');
    runtime.assertLog(['Message Event', 'Oops!', 'Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Yay']);
  });

  it('schedule new task after queue has emptied', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'A']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  it('schedule new task after a cancellation', () => {
    const handle = scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Message']);
    cancelCallback(handle);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  it('yielding continues in a new task regardless of how much time is remaining', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Original Task');
      runtime.log('shouldYield: ' + shouldYield());
      runtime.log('Return a continuation');
      return () => {
        runtime.log('Continuation Task');
      };
    });
    runtime.assertLog(['Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog([
      'Message Event',
      'Original Task',
      'shouldYield: false',
      'Return a continuation',
      'Post Message',
    ]);

    expect(performance.now()).toBe(0);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Continuation Task']);
  });
});
