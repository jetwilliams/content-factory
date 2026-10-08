// Error thrown by publishers. `transient: true` means "worth retrying on a later run" (rate limits,
// timeouts, 5xx). Anything else needs a human to look at it and run `retry <id>`.
export class PublishError extends Error {
  constructor(message, { transient = false, status, body } = {}) {
    super(message);
    this.name = 'PublishError';
    this.transient = transient;
    this.status = status;
    this.body = body;
  }
}

export class QueueError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueError';
  }
}
