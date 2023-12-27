import type { Task } from './type';

class MinHeap {
  private heap: Task[];

  constructor() {
    this.heap = [];
  }

  private compare(a: Task, b: Task) {
    const diff = a.sortIndex - b.sortIndex;

    return diff !== 0 ? diff : a.id - b.id;
  }

  private getParentIndex(index: number): number {
    return Math.floor((index - 1) / 2);
  }

  private getLeftChildIndex(index: number): number {
    return index * 2 + 1;
  }

  private getRightChildIndex(index: number): number {
    return index * 2 + 2;
  }

  private swap(index1: number, index2: number): void {
    [this.heap[index1], this.heap[index2]] = [this.heap[index2], this.heap[index1]];
  }

  private siftUp(index: number): void {
    if (index === 0) {
      return;
    }

    const parentIndex = this.getParentIndex(index);
    if (this.compare(this.heap[index], this.heap[parentIndex]) < 0) {
      this.swap(index, parentIndex);
      this.siftUp(parentIndex);
    }
  }

  private siftDown(index: number): void {
    const leftChildIndex = this.getLeftChildIndex(index);
    const rightChildIndex = this.getRightChildIndex(index);
    let smallestIndex = index;

    if (
      leftChildIndex < this.heap.length &&
      this.compare(this.heap[leftChildIndex], this.heap[smallestIndex]) < 0
    ) {
      smallestIndex = leftChildIndex;
    }

    if (
      rightChildIndex < this.heap.length &&
      this.compare(this.heap[rightChildIndex], this.heap[smallestIndex]) < 0
    ) {
      smallestIndex = rightChildIndex;
    }

    if (smallestIndex !== index) {
      this.swap(index, smallestIndex);
      this.siftDown(smallestIndex);
    }
  }

  public push(value: Task): void {
    this.heap.push(value);
    this.siftUp(this.heap.length - 1);
  }

  public pop(): Task | null {
    if (this.heap.length === 0) {
      return null;
    }

    if (this.heap.length === 1) {
      return this.heap.pop() ?? null;
    }

    const min = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.siftDown(0);

    return min;
  }

  public peek(): Task | null {
    return this.heap[0] ?? null;
  }
}

export default MinHeap;
