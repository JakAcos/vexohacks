// Keep capture continuous while sending independent PCM/WAV segments to the server.
export class AudioSegments {
    rate;
    emit;
    chunks = [];
    length = 0;
    quiet = 0;
    speech = false;
    constructor(rate, emit) {
        this.rate = rate;
        this.emit = emit;
    }
    push(samples) {
        this.chunks.push(samples);
        this.length += samples.length;
        const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
        if (rms > 0.008) {
            this.speech = true;
            this.quiet = 0;
        }
        else
            this.quiet += samples.length;
        if ((this.speech && this.length >= this.rate && this.quiet >= this.rate * 0.9) || this.length >= this.rate * 12)
            this.flush();
    }
    flush() {
        if (this.speech && this.length > 0)
            this.emit(encodeWav(this.chunks, this.length, this.rate));
        this.chunks = [];
        this.length = 0;
        this.quiet = 0;
        this.speech = false;
    }
}
export function encodeWav(chunks, length, rate) {
    const view = new DataView(new ArrayBuffer(44 + length * 2));
    const word = (offset, text) => { for (let i = 0; i < text.length; i++)
        view.setUint8(offset + i, text.charCodeAt(i)); };
    word(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    word(8, "WAVE");
    word(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    word(36, "data");
    view.setUint32(40, length * 2, true);
    let offset = 44;
    for (const chunk of chunks)
        for (const value of chunk) {
            const sample = Math.max(-1, Math.min(1, value));
            view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
            offset += 2;
        }
    return new Uint8Array(view.buffer);
}
