class RelayCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(2048); this.position = 0;
    this.port.onmessage = e => {
      if (e.data === 'flush') { if (this.position) this.port.postMessage(this.buffer.slice(0, this.position)); this.position = 0; this.port.postMessage('flushed'); }
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      this.buffer[this.position++] = sample;
      if (this.position === this.buffer.length) { this.port.postMessage(this.buffer); this.buffer = new Float32Array(2048); this.position = 0; }
    }
    return true;
  }
}
registerProcessor('relay-capture', RelayCapture);
