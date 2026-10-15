// opus-decoder's Web Worker variant subclasses a Worker shim that needs `worker_threads`, which
// Node 8 lacks. The service decodes synchronously, so the build swaps the shim for this empty class.
export default class NoWorker {}
