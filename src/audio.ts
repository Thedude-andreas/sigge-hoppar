export class AudioDirector {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private nextMusicAt = 0
  private musicStep = 0
  private danger = false
  private nextFootstepAt = 0
  private nextRustleAt = 0

  start() {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return
      this.context = new Context()
      this.master = this.context.createGain()
      this.master.gain.value = 0.34
      this.master.connect(this.context.destination)
      this.nextMusicAt = this.context.currentTime + 0.04
    }
    if (this.context.state === 'suspended') {
      void this.context.resume()
    }
  }

  update(danger: boolean) {
    const ctx = this.context
    if (!ctx || !this.master || ctx.state !== 'running') return
    if (danger !== this.danger) {
      this.danger = danger
      this.musicStep = 0
      this.nextMusicAt = ctx.currentTime + 0.025
    }

    const lookAhead = ctx.currentTime + 0.16
    while (this.nextMusicAt < lookAhead) {
      if (this.danger) this.scheduleDangerNote(this.nextMusicAt)
      else this.scheduleHappyNote(this.nextMusicAt)
    }
  }

  footstep(intensity: number) {
    const ctx = this.context
    if (!ctx || !this.master || ctx.currentTime < this.nextFootstepAt) return
    this.nextFootstepAt = ctx.currentTime + 0.19 - Math.min(0.05, intensity * 0.035)
    this.noiseBurst(ctx.currentTime, 0.045, 520, 0.095)
    this.tone(ctx.currentTime, 92, 0.055, 0.055, 'sine', 72)
  }

  jump() {
    const ctx = this.context
    if (!ctx || !this.master) return
    const start = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(210, start)
    osc.frequency.exponentialRampToValueAtTime(520, start + 0.12)
    osc.frequency.exponentialRampToValueAtTime(285, start + 0.32)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.19, start + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34)
    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(start + 0.36)
  }

  rustle() {
    const ctx = this.context
    if (!ctx || !this.master || ctx.currentTime < this.nextRustleAt) return
    this.nextRustleAt = ctx.currentTime + 0.17
    const start = ctx.currentTime
    // Flera torra, högfrekventa lager ger lövprassel i stället för ett enda brus.
    this.noiseBurst(start, 0.13, 2200 + Math.random() * 700, 0.12)
    this.noiseBurst(start + 0.032, 0.095, 3900 + Math.random() * 900, 0.105)
    this.noiseBurst(start + 0.078, 0.075, 5600 + Math.random() * 900, 0.07)
  }

  eat() {
    const ctx = this.context
    if (!ctx || !this.master) return
    const start = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const at = start + i * 0.105
      this.tone(at, 185 - i * 12, 0.075, 0.095, 'triangle', 118 - i * 7)
      this.noiseBurst(at + 0.018, 0.052, 780 + i * 170, 0.07)
    }
  }

  chatter() {
    const ctx = this.context
    if (!ctx || !this.master) return
    const start = ctx.currentTime
    const syllables = [620, 790, 690, 865, 735, 820]
    syllables.forEach((frequency, index) => {
      const at = start + index * 0.082
      this.tone(at, frequency, 0.07, 0.085, index % 2 === 0 ? 'square' : 'triangle', frequency * 0.86)
    })
  }

  private scheduleHappyNote(at: number) {
    const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46]
    const bass = [130.81, 164.81, 196, 164.81]
    const step = this.musicStep++
    this.tone(at, melody[step % melody.length], 0.25, 0.038, 'triangle')
    if (step % 2 === 0) this.tone(at, bass[Math.floor(step / 2) % bass.length], 0.5, 0.026, 'sine')
    this.nextMusicAt = at + 0.31
  }

  private scheduleDangerNote(at: number) {
    const pulse = [146.83, 138.59, 123.47, 138.59, 110, 123.47, 103.83, 123.47]
    const step = this.musicStep++
    this.tone(at, pulse[step % pulse.length], 0.2, 0.055, 'sawtooth')
    if (step % 4 === 0) this.tone(at, pulse[step % pulse.length] * 2.02, 0.11, 0.035, 'square')
    this.nextMusicAt = at + 0.19
  }

  private tone(at: number, frequency: number, duration: number, volume: number, type: OscillatorType, endFrequency = frequency) {
    const ctx = this.context
    if (!ctx || !this.master) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.025, duration * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(this.master)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }

  private noiseBurst(at: number, duration: number, centerFrequency: number, volume: number) {
    const ctx = this.context
    if (!ctx || !this.master) return
    const frameCount = Math.ceil(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frameCount; i++) {
      const fade = 1 - i / frameCount
      data[i] = (Math.random() * 2 - 1) * fade
    }
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = centerFrequency
    filter.Q.value = 0.8
    gain.gain.setValueAtTime(volume, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    source.connect(filter).connect(gain).connect(this.master)
    source.start(at)
  }

}
