import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { newPlayer } from '../../app/domain/progression';

declare global {
  interface Window {
    audioProbe: {
      context: AudioContext;
      sink: MediaStreamAudioDestinationNode;
      analyser: AnalyserNode;
      oscillators: OscillatorNode[];
    } | null;
  }
}

test('the actual ride selects four different engine voices, reacts to throttle and silences on pause', async ({
  page,
}) => {
  const errors: string[] = [],
    peaks: Record<string, number> = {};
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.audioProbe = null;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        const sink = this.createMediaStreamDestination(),
          analyser = this.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0;
        window.audioProbe = { context: this, sink, analyser, oscillators: [] };
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        window.audioProbe?.oscillators.push(oscillator);
        return oscillator;
      }
    };
    // Captured native method is always invoked with its original node receiver below.
    const connect = Object.getOwnPropertyDescriptor(
      AudioNode.prototype,
      'connect',
    )!.value as AudioNode['connect'];
    Object.defineProperty(AudioNode.prototype, 'connect', {
      value: function (
        this: AudioNode,
        destination: AudioNode | AudioParam,
        ...ports: number[]
      ) {
        const result = Reflect.apply(connect, this, [destination, ...ports]);
        if (
          destination instanceof AudioDestinationNode &&
          window.audioProbe?.context === this.context
        ) {
          Reflect.apply(connect, this, [window.audioProbe.sink]);
          Reflect.apply(connect, this, [window.audioProbe.analyser]);
        }
        return result;
      },
    });
  });
  const player = newPlayer();
  player.ownedItems.push('bike:scooter', 'bike:450', 'bike:701');
  player.settings.muted = false;
  player.settings.tutorialSeen = true;
  await page.addInitScript((p) => {
    p.bike = new URL(location.href).searchParams.get('sound-bike') ?? '125';
    localStorage.setItem('pfusch:player:v1', JSON.stringify(p));
  }, player);
  for (const bike of ['125', 'scooter', '450', '701']) {
    await page.goto(`/?sound-bike=${bike}`);
    await page.getByRole('button', { name: 'LET’S RIDE', exact: true }).click();
    await expect(page.getByTestId('ride-screen')).toHaveAttribute(
      'data-phase',
      'playing',
      { timeout: 60000 },
    );
    await page.waitForTimeout(600);
    const level = () =>
      page.evaluate(() => {
        const p = window.audioProbe!;
        const spectrum = new Float32Array(p.analyser.frequencyBinCount),
          wave = new Float32Array(p.analyser.fftSize);
        p.analyser.getFloatFrequencyData(spectrum);
        p.analyser.getFloatTimeDomainData(wave);
        // The raspy 2T and single can have a louder second harmonic. Follow the
        // combustion oscillator, then verify that frequency is present in actual output.
        const fundamental = p.oscillators
          .filter((o) => o.type === 'custom')
          .at(-1)!.frequency.value;
        const bin = Math.round(
          (fundamental * p.analyser.fftSize) / p.context.sampleRate,
        );
        return {
          peak: fundamental,
          db: Math.max(...spectrum.slice(bin - 1, bin + 2)),
          strongest: Array.from(spectrum, (db, i) => ({
            db,
            hz: (i * p.context.sampleRate) / p.analyser.fftSize,
          }))
            .sort((a, b) => b.db - a.db)
            .slice(0, 5),
          time: p.context.currentTime,
          state: p.context.state,
          rms: Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0) / wave.length),
        };
      });
    await expect
      .poll(async () => (await level()).rms, { timeout: 15000 })
      .toBeGreaterThan(0.005);
    await page.waitForTimeout(400);
    const before = await level();
    console.log(bike, before);
    peaks[bike] = before.peak;
    expect(before.db).toBeGreaterThan(-65);
    await page.keyboard.down('s');
    await page.waitForTimeout(650);
    const revved = await level();
    expect(revved.peak).toBeGreaterThan(before.peak);
    await page.keyboard.up('s');
    const recording = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const recorder = new MediaRecorder(window.audioProbe!.sink.stream, {
            mimeType: 'audio/webm;codecs=opus',
          });
          const chunks: BlobPart[] = [];
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = async () =>
            resolve(
              Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
            );
          recorder.start();
          setTimeout(() => recorder.stop(), 2200);
        }),
    );
    writeFileSync(`outputs/engine-${bike}.webm`, Buffer.from(recording));
    expect(recording.length).toBeGreaterThan(3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(550);
    expect((await level()).rms).toBeLessThan(0.001);
  }
  expect(peaks['450']).toBeLessThan(peaks['125'] * 0.65);
  expect(peaks['701']).toBeGreaterThan(peaks['125'] * 1.7);
  // The scooter fires once per revolution in its CVT power band, distinct
  // from both the low single-cylinder pulse and the inline-four's high pitch.
  expect(peaks.scooter).toBeGreaterThan(peaks['450'] * 1.4);
  expect(peaks.scooter).toBeLessThan(peaks['701'] * 0.6);
  expect(errors).toEqual([]);
  writeFileSync(
    'outputs/engine-audio-qa.json',
    JSON.stringify({ peaks }, null, 2),
  );
});
