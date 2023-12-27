import MinHeap from './heap';
import {
  IdlePriority,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  UserBlockingPriority,
} from './priority';
import type { PriorityLevel, ScheduleCallbackOptions, Task } from './type';

const frameInterval = 5;

const maxSigned31BitInt = 1073741823;

const IMMEDIATE_PRIORITY_TIMEOUT = -1;

const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
const NORMAL_PRIORITY_TIMEOUT = 5000;
const LOW_PRIORITY_TIMEOUT = 10000;

const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

const taskQueue = new MinHeap();
const timerQueue = new MinHeap();

let taskIdCounter = 1;

export function getTaskIdCounter() {
  return taskIdCounter;
}
let currentTask: Task | null = null;
let currentPriorityLevel = NormalPriority;

let isPerformingWork = false;
let isHostCallbackScheduled = false;
let isHostTimeoutScheduled = false;
let isMessageLoopRunning = false;

let startTime = -1;
let taskTimeoutID = -1;

const initialTime = performance.now();

function getCurrentTime() {
  return performance.now() - initialTime;
}

function advanceTimers(currentTime: number) {
  let timer = timerQueue.peek();

  while (timer !== null) {
    if (timer.callback === null) {
      timerQueue.pop();
    } else if (timer.startTime <= currentTime) {
      timerQueue.pop();
      timer.sortIndex = timer.expirationTime;
      taskQueue.push(timer);
    } else {
      return;
    }

    timer = taskQueue.peek();
  }
}

function requestHostTimeout(callback: Function, timeout: number) {
  taskTimeoutID = window.setTimeout(function () {
    const currentTime = getCurrentTime();

    callback(currentTime);
  }, timeout);
}

function cancelHostTimeout() {
  clearTimeout(taskTimeoutID);
}

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;

  if (timeElapsed < frameInterval) {
    return false;
  }

  return true;
}

function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime;

  advanceTimers(currentTime);

  currentTask = taskQueue.peek();

  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && (!hasTimeRemaining || shouldYieldToHost())) {
      break;
    }

    const callback = currentTask.callback;

    if (typeof callback === 'function') {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;

      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();

      if (typeof continuationCallback === 'function') {
        currentTask.callback = continuationCallback;

        advanceTimers(currentTime);
        return true;
      } else {
        if (currentTask === taskQueue.peek()) {
          taskQueue.pop();
        }
      }

      advanceTimers(currentTime);
    } else {
      taskQueue.pop();
    }

    currentTask = taskQueue.peek();
  }

  if (currentTask !== null) {
    return true;
  } else {
    const firstTimer = timerQueue.peek();

    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }

    return false;
  }
}

function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  isHostCallbackScheduled = false;

  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;

  const previousPriorityLevel = currentPriorityLevel;

  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

function performWorkUntilDeadline() {
  const currentTime = getCurrentTime();

  startTime = currentTime;

  const hasTimeRemaining = true;

  let hasMoreWork = true;

  try {
    hasMoreWork = flushWork(hasTimeRemaining, currentTime);
  } finally {
    if (hasMoreWork) {
      schedulePerformWorkUntilDeadline();
    } else {
      isMessageLoopRunning = false;
    }
  }
}

const channel = new MessageChannel();
const port = channel.port2;

channel.port1.onmessage = performWorkUntilDeadline;

function schedulePerformWorkUntilDeadline() {
  port.postMessage(null);
}

function requestHostCallback() {
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (taskQueue.peek() !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback();
    } else {
      const firstTimer = timerQueue.peek();

      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

export function shouldYield(): boolean {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    return false;
  }

  return true;
}

export function cancelCallback(task: Task) {
  task.callback = null;
}

export function scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: (...args: any[]) => any,
  options?: ScheduleCallbackOptions
) {
  const currentTime = getCurrentTime();
  let startTime: number;

  if (typeof options === 'object' && options !== undefined) {
    const delay = options.delay;

    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  let timeout: number;

  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;

    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;

    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;

    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;

    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  const expirationTime = startTime + timeout;
  const newTask: Task = {
    id: taskIdCounter++,
    callback: callback,
    priorityLevel: priorityLevel,
    startTime: startTime,
    expirationTime: expirationTime,
    sortIndex: -1,
  };

  if (startTime > currentTime) {
    newTask.sortIndex = startTime;

    timerQueue.push(newTask);

    if (taskQueue.peek() === null && newTask === timerQueue.peek()) {
      if (isHostTimeoutScheduled) {
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }

      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    newTask.sortIndex = expirationTime;
    taskQueue.push(newTask);

    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback();
    }
  }

  return newTask;
}
