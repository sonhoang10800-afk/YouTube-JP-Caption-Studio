/**
 * Forwards captured tab PCM to the offscreen document in fixed-size chunks.
 * The offscreen page owns timestamping, overlap and WAV encoding, so this
 * processor only has to preserve sample order while its timers may be frozen.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = Number(options?.processorOptions?.chunkSize) || 2048;
    this.pending = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (channel) {
      let read = 0;
      while (read < channel.length) {
        const count = Math.min(channel.length - read, this.chunkSize - this.offset);
        this.pending.set(channel.subarray(read, read + count), this.offset);
        this.offset += count;
        read += count;
        if (this.offset === this.chunkSize) {
          const samples = this.pending;
          this.port.postMessage({ type: "pcm", samples }, [samples.buffer]);
          this.pending = new Float32Array(this.chunkSize);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
