(function (g) {
  /**
   * FIFO queue that runs one async job at a time.
   * push() returns a promise for that job. Additional jobs wait.
   */
  g.createSerialQueue = function createSerialQueue() {
    const items = [];
    let running = false;

    async function drain() {
      if (running) return;
      running = true;
      while (items.length) {
        const item = items.shift();
        try {
          item.resolve(await item.handler(item.job));
        } catch (err) {
          item.reject(err);
        }
      }
      running = false;
    }

    return {
      push(job, handler) {
        return new Promise((resolve, reject) => {
          items.push({ job, handler, resolve, reject });
          drain();
        });
      },
      get pending() {
        return items.length;
      },
      get busy() {
        return running;
      },
    };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
