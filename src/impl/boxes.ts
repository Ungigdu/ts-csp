import { IHandler } from './handlers';

export class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

export class PutBox<T> {
  handler: IHandler;
  value: T;

  constructor(handler: IHandler, value: T) {
    this.handler = handler;
    this.value = value;
  }
}
