import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Play,
  Pause,
  SkipForward,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Music,
  Sliders,
  Code2,
  Copy,
  Check,
  Award,
  Zap,
  HelpCircle,
  ChevronRight,
  Radio,
} from "lucide-react";
import { LESSONS } from "./data/lessons";

/**
 * ============================================================================
 * GUITAR TUNING & PITCH-TO-FRET MATHEMATICAL CONSTANTS
 * ============================================================================
 * Standard 6-String Guitar Tuning (12-TET Equal Temperament, A4 = 440 Hz):
 *
 * In standard tab notation:
 * - String 1 (Top line)    = High E (E4) = 329.63 Hz (MIDI Note 64)
 * - String 2 (2nd line)    = B      (B3) = 246.94 Hz (MIDI Note 59)
 * - String 3 (3rd line)    = G      (G3) = 196.00 Hz (MIDI Note 55)
 * - String 4 (4th line)    = D      (D3) = 146.83 Hz (MIDI Note 50)
 * - String 5 (5th line)    = A      (A2) = 110.00 Hz (MIDI Note 45)
 * - String 6 (Bottom line) = Low E  (E2) =  82.41 Hz (MIDI Note 40)
 *
 * PITCH-TO-FRET MATH EXPLANATION:
 * 1. Frequency of a fretted note on string `s` at fret `k`:
 *      f(s, k) = f_open(s) * 2^(k / 12)
 *
 * 2. Given a detected fundamental frequency `f_detected`, the continuous
 *    semitone distance above open string `s` is:
 *      semitones_exact = 12 * log2(f_detected / f_open(s))
 *      fret = Math.round(semitones_exact)
 *
 * 3. The pitch error in "cents" (1 semitone = 100 cents) from that fret is:
 *      cents_error = 100 * (semitones_exact - fret)
 *
 * 4. Because guitar strings overlap in frequency (e.g. String 6 Fret 5 is A2 = 110Hz,
 *    which is identical in pitch to Open String 5), a single detected frequency
 *    can correspond to multiple (string, fret) coordinates on the fretboard.
 *    Therefore:
 *    - When comparing against the active note at the playhead `(targetString, targetFret)`,
 *      we compute the target frequency `f_target = f_open(targetString) * 2^(targetFret / 12)`
 *      and check if `|1200 * log2(f_detected / f_target)| <= toleranceCents` (e.g., ±55 cents).
 *    - For general HUD visualization, we also return all valid `(string, fret)` pairs
 *      on the neck (0 <= fret <= 20) and pick the most ergonomic lowest-fret match.
 */
const GUITAR_STRINGS = [
  {
    string: 1,
    name: "e",
    note: "E4",
    freq: 329.6276,
    midi: 64,
    gaugePx: 1.25,
    wound: false,
  },
  {
    string: 2,
    name: "B",
    note: "B3",
    freq: 246.9417,
    midi: 59,
    gaugePx: 1.6,
    wound: false,
  },
  {
    string: 3,
    name: "G",
    note: "G3",
    freq: 195.9977,
    midi: 55,
    gaugePx: 2.0,
    wound: false,
  },
  {
    string: 4,
    name: "D",
    note: "D3",
    freq: 146.8324,
    midi: 50,
    gaugePx: 2.5,
    wound: true,
  },
  {
    string: 5,
    name: "A",
    note: "A2",
    freq: 110.0,
    midi: 45,
    gaugePx: 3.1,
    wound: true,
  },
  {
    string: 6,
    name: "E",
    note: "E2",
    freq: 82.4069,
    midi: 40,
    gaugePx: 3.8,
    wound: true,
  },
];

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * Compute exact target frequency (Hz) for a given guitar string (1-6) and fret (0-24)
 */
function getFrequencyForStringFret(stringNum, fretNum) {
  const stringObj = GUITAR_STRINGS.find((s) => s.string === stringNum);
  if (!stringObj) return 440;
  return stringObj.freq * Math.pow(2, fretNum / 12);
}

/**
 * Convert a frequency in Hz to its nearest chromatic note name, MIDI number, and cents offset
 */
function frequencyToNoteDetails(frequency) {
  if (!frequency || frequency < 60 || frequency > 1500) return null;

  // MIDI note formula: m = 69 + 12 * log2(f / 440)
  const exactMidi = 69 + 12 * Math.log2(frequency / 440.0);
  const roundedMidi = Math.round(exactMidi);
  const centsOff = Math.round((exactMidi - roundedMidi) * 100);

  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteName = `${NOTE_NAMES[noteIndex]}${octave}`;

  // Find all valid (string, fret) positions on standard 6-string guitar (frets 0..19)
  const possiblePositions = [];
  for (const s of GUITAR_STRINGS) {
    const exactFret = 12 * Math.log2(frequency / s.freq);
    const nearestFret = Math.round(exactFret);
    const fretCentsDiff = Math.abs((exactFret - nearestFret) * 100);

    if (nearestFret >= 0 && nearestFret <= 19 && fretCentsDiff <= 55) {
      possiblePositions.push({
        string: s.string,
        fret: nearestFret,
        centsOff: Math.round((exactFret - nearestFret) * 100),
      });
    }
  }

  // Sort possible positions to prefer lower frets (open strings and first position)
  possiblePositions.sort((a, b) => a.fret - b.fret || b.string - a.string);

  const primaryPosition = possiblePositions[0] || { string: null, fret: null };

  return {
    frequency: Math.round(frequency * 10) / 10,
    midi: roundedMidi,
    noteName,
    centsOff,
    currentString: primaryPosition.string,
    currentFret: primaryPosition.fret,
    possiblePositions,
  };
}

/**
 * ============================================================================
 * YIN / AUTOCORRELATION PITCH DETECTION ALGORITHM
 * ============================================================================
 * Detects the fundamental frequency (F0) from a time-domain float32 buffer
 * captured via Web Audio API's `AnalyserNode.getFloatTimeDomainData()`.
 *
 * Why YIN over simple zero-crossing or basic peak autocorrelation?
 * Guitar strings are rich in harmonics (2nd and 3rd harmonics can have higher
 * amplitude than the fundamental E2/A2). The YIN algorithm computes the
 * Cumulative Mean Normalized Difference Function d'(tau) and finds the FIRST
 * dip below an absolute threshold, avoiding octave errors!
 *
 * @param {Float32Array} buffer - Time-domain audio samples (-1.0 to 1.0)
 * @param {number} sampleRate - AudioContext sample rate (typically 44100 or 48000 Hz)
 * @returns {number | null} Detected fundamental frequency in Hz, or null if silence/noise
 */
function detectPitchYIN(buffer, sampleRate) {
  const bufferSize = buffer.length;

  // 1. RMS (Root Mean Square) Amplitude Check (Noise Gate)
  let sumSquares = 0;
  for (let i = 0; i < bufferSize; i++) {
    sumSquares += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSquares / bufferSize);
  // Ignore background room noise below threshold
  if (rms < 0.012) {
    return null;
  }

  // 2. Define lag (tau) search bounds corresponding to guitar frequency range:
  // Max frequency ~ 1100 Hz (High E string 20th fret) -> minTau
  // Min frequency ~ 70 Hz   (Below Low E2 = 82.41 Hz) -> maxTau
  const minTau = Math.max(2, Math.floor(sampleRate / 1100));
  const maxTau = Math.min(
    Math.floor(bufferSize / 2),
    Math.ceil(sampleRate / 68),
  );

  const yinBuffer = new Float32Array(maxTau);
  yinBuffer[0] = 1;

  // 3. Step 1 & 2 of YIN: Difference function d(tau) and Cumulative Mean Normalized d'(tau)
  let runningSum = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    let deltaSum = 0;
    for (let i = 0; i < maxTau; i++) {
      const delta = buffer[i] - buffer[i + tau];
      deltaSum += delta * delta;
    }
    yinBuffer[tau] = deltaSum;
    runningSum += deltaSum;

    // Normalize by cumulative mean
    if (runningSum > 0) {
      yinBuffer[tau] = (yinBuffer[tau] * tau) / runningSum;
    } else {
      yinBuffer[tau] = 1;
    }
  }

  // 4. Step 3 of YIN: Absolute Threshold Search
  // Find the first tau >= minTau where d'(tau) dips below threshold (0.18)
  // and reaches a local minimum.
  const threshold = 0.18;
  let tauEstimate = -1;

  for (let tau = minTau; tau < maxTau; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  // Fallback: if no dip crossed 0.18, check for strong global minimum < 0.32
  if (tauEstimate === -1) {
    let minVal = 100;
    let minIdx = -1;
    for (let tau = minTau; tau < maxTau; tau++) {
      if (yinBuffer[tau] < minVal) {
        minVal = yinBuffer[tau];
        minIdx = tau;
      }
    }
    if (minVal < 0.32) {
      tauEstimate = minIdx;
    } else {
      return null; // Unpitched noise
    }
  }

  // 5. Step 4 of YIN: Parabolic Interpolation around tauEstimate for sub-sample accuracy
  let betterTau = tauEstimate;
  if (tauEstimate > 0 && tauEstimate < maxTau - 1) {
    const s0 = yinBuffer[tauEstimate - 1];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[tauEstimate + 1];
    const denominator = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denominator) > 1e-6) {
      const adjustment = (s2 - s0) / denominator;
      if (Math.abs(adjustment) < 1) {
        betterTau = tauEstimate + adjustment;
      }
    }
  }

  const fundamentalFreq = sampleRate / betterTau;
  if (fundamentalFreq < 68 || fundamentalFreq > 1100) {
    return null;
  }

  return fundamentalFreq;
}

/**
 * ============================================================================
 * CUSTOM HOOK: usePitchDetection
 * ============================================================================
 * Manages:
 * - Microphone access via `navigator.mediaDevices.getUserMedia({ audio: true })`
 * - Real-time Web Audio API `AnalyserNode` + `detectPitchYIN` loop
 * - Built-in Plucked Guitar Synthesizer that routes directly into the SAME
 *   `AnalyserNode` so users can test the real YIN pitch detector even without
 *   a physical guitar or microphone!
 */
function usePitchDetection() {
  const [isListening, setIsListening] = useState(false);
  const [micSourceActive, setMicSourceActive] = useState(false);
  const [micError, setMicError] = useState(null);
  const [pitchState, setPitchState] = useState({
    currentFrequency: null,
    currentNote: null,
    centsOff: 0,
    currentString: null,
    currentFret: null,
    possiblePositions: [],
    signalLevel: 0,
    sourceType: "idle", // 'mic' | 'synth' | 'idle'
  });

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const micSourceNodeRef = useRef(null);
  const rafIdRef = useRef(null);
  const timeDomainBufferRef = useRef(null);
  const lastValidPitchTimeRef = useRef(0);
  const activeSynthOscRef = useRef(null);

  // Ensure shared AudioContext and AnalyserNode are initialized
  const ensureAudioGraph = useCallback(async () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    if (!analyserRef.current) {
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 2048; // 2048 samples at 44.1kHz ~ 46ms window (ideal for 82Hz E2)
      analyser.smoothingTimeConstant = 0.0;
      analyserRef.current = analyser;
      timeDomainBufferRef.current = new Float32Array(analyser.fftSize);
    }
    return { audioCtx: audioCtxRef.current, analyser: analyserRef.current };
  }, []);

  // Continuous pitch analysis loop using requestAnimationFrame
  const startAnalysisLoop = useCallback(() => {
    if (rafIdRef.current) return;

    const analyzeFrame = () => {
      const analyser = analyserRef.current;
      const audioCtx = audioCtxRef.current;
      const buffer = timeDomainBufferRef.current;

      if (analyser && audioCtx && buffer) {
        analyser.getFloatTimeDomainData(buffer);

        // Compute quick RMS level for visual meter
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        const normalizedLevel = Math.min(100, Math.round(rms * 350));

        const detectedFreq = detectPitchYIN(buffer, audioCtx.sampleRate);
        const now = performance.now();

        if (detectedFreq) {
          lastValidPitchTimeRef.current = now;
          const details = frequencyToNoteDetails(detectedFreq);
          if (details) {
            setPitchState((prev) => ({
              currentFrequency: details.frequency,
              currentNote: details.noteName,
              centsOff: details.centsOff,
              currentString: details.currentString,
              currentFret: details.currentFret,
              possiblePositions: details.possiblePositions,
              signalLevel: normalizedLevel,
              sourceType:
                prev.sourceType === "synth"
                  ? "synth"
                  : micSourceNodeRef.current
                    ? "mic"
                    : "synth",
            }));
          }
        } else if (now - lastValidPitchTimeRef.current > 260) {
          // Decay pitch display smoothly after 260ms of silence
          setPitchState((prev) =>
            prev.currentFrequency === null && prev.signalLevel === 0
              ? prev
              : {
                  currentFrequency: null,
                  currentNote: null,
                  centsOff: 0,
                  currentString: null,
                  currentFret: null,
                  possiblePositions: [],
                  signalLevel: normalizedLevel,
                  sourceType: micSourceNodeRef.current ? "mic" : "idle",
                },
          );
        }
      }

      rafIdRef.current = requestAnimationFrame(analyzeFrame);
    };

    rafIdRef.current = requestAnimationFrame(analyzeFrame);
  }, []);

  // Request microphone input via getUserMedia
  const startListening = useCallback(async () => {
    setMicError(null);
    try {
      const { audioCtx, analyser } = await ensureAudioGraph();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });
      mediaStreamRef.current = stream;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      micSourceNodeRef.current = source;

      setIsListening(true);
      setMicSourceActive(true);
      setPitchState((prev) => ({ ...prev, sourceType: "mic" }));
      startAnalysisLoop();
    } catch (err) {
      setMicError(
        "Microphone access was blocked or unavailable. You can still test the full YIN pitch detector using the Virtual Guitar Pluck buttons!",
      );
      // Still run the analysis loop so virtual guitar plucks are analyzed by YIN
      await ensureAudioGraph();
      setIsListening(true);
      setMicSourceActive(false);
      startAnalysisLoop();
    }
  }, [ensureAudioGraph, startAnalysisLoop]);

  // Stop microphone and analysis loop
  const stopListening = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (micSourceNodeRef.current) {
      try {
        micSourceNodeRef.current.disconnect();
      } catch (e) {
        // ignore disconnect error
      }
      micSourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsListening(false);
    setMicSourceActive(false);
    setPitchState({
      currentFrequency: null,
      currentNote: null,
      centsOff: 0,
      currentString: null,
      currentFret: null,
      possiblePositions: [],
      signalLevel: 0,
      sourceType: "idle",
    });
  }, []);

  /**
   * Synthesize a realistic plucked guitar string at `targetFreq` Hz and route it
   * into BOTH the speakers AND the Web Audio `AnalyserNode`, so `detectPitchYIN`
   * genuinely detects the waveform in real time!
   */
  const simulateFrequency = useCallback(
    async (targetFreq, durationMs = 750, playToSpeaker = true) => {
      const { audioCtx, analyser } = await ensureAudioGraph();
      if (!rafIdRef.current) {
        setIsListening(true);
        startAnalysisLoop();
      }

      // Stop any previous overlapping test tone so the analyser receives a clean monophonic note
      if (activeSynthOscRef.current) {
        try {
          activeSynthOscRef.current.stop();
        } catch (e) {
          // ignore if already stopped
        }
      }

      const now = audioCtx.currentTime;
      const durationSec = durationMs / 1000;

      // Fundamental + subtle 2nd harmonic to mimic plucked acoustic/electric string
      const oscFundamental = audioCtx.createOscillator();
      const oscHarmonic = audioCtx.createOscillator();
      const harmonicGain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      const masterGain = audioCtx.createGain();

      oscFundamental.type = "triangle";
      oscFundamental.frequency.setValueAtTime(targetFreq, now);

      oscHarmonic.type = "sine";
      oscHarmonic.frequency.setValueAtTime(targetFreq * 2, now);
      harmonicGain.gain.setValueAtTime(0.18, now);
      harmonicGain.gain.exponentialRampToValueAtTime(
        0.01,
        now + durationSec * 0.6,
      );

      // Low-pass filter pluck envelope
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(targetFreq * 4.5, now);
      filter.frequency.exponentialRampToValueAtTime(
        targetFreq * 1.5,
        now + durationSec * 0.85,
      );

      // Pluck amplitude envelope
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(0.32, now + 0.015);
      masterGain.gain.exponentialRampToValueAtTime(
        0.08,
        now + durationSec * 0.7,
      );
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

      oscFundamental.connect(filter);
      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(filter);
      filter.connect(masterGain);

      // Route into AnalyserNode so YIN Pitch Detector processes the actual audio signal
      masterGain.connect(analyser);
      if (playToSpeaker) {
        masterGain.connect(audioCtx.destination);
      }

      setPitchState((prev) => ({ ...prev, sourceType: "synth" }));

      oscFundamental.start(now);
      oscHarmonic.start(now);
      oscFundamental.stop(now + durationSec);
      oscHarmonic.stop(now + durationSec);

      activeSynthOscRef.current = oscFundamental;
    },
    [ensureAudioGraph, startAnalysisLoop],
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isListening,
    micSourceActive,
    micError,
    startListening,
    stopListening,
    simulateFrequency,
    ...pitchState,
  };
}

/**
 * ============================================================================
 * CURATED LESSONS & SONGS DATA STRUCTURE
 * ============================================================================
 * Each lesson contains an array of notes:
 * {
 *   id: string,
 *   string: 1..6 (1 = High E4 top line, 6 = Low E2 bottom line),
 *   fret: number (0..20),
 *   timestamp: number (ms from lesson start),
 *   strumDirection: 'down' | 'up' | null,
 *   hint: string (displayed in CaptionBox when this note is active)
 * }
 */

/**
 * ============================================================================
 * COMPONENT: <StrumArrowRow />
 * ============================================================================
 * Renders a horizontal lane directly above the 6 guitar strings displaying
 * Up / Down strum direction arrows aligned with each note's horizontal offset.
 */
function StrumArrowRow({
  notes,
  currentTime,
  playheadX,
  pixelsPerMs,
  activeNoteId,
  completedNoteIds,
}) {
  return (
    <div className="relative w-full h-11 bg-[#14141b]/90 border-b border-white/10 overflow-hidden select-none">
      {/* Left Header Badge aligned with String Labels */}
      <div className="absolute left-0 top-0 bottom-0 w-24 z-30 bg-[#14141b] border-r border-white/10 flex items-center justify-center px-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300/80">
          STRUM
        </span>
      </div>

      {/* Scrolling Strum Arrows */}
      {notes.map((note) => {
        if (!note.strumDirection) return null;
        const xPos = playheadX + (note.timestamp - currentTime) * pixelsPerMs;
        // Cull arrows far outside viewport
        if (xPos < 60 || xPos > 1400) return null;

        const isCompleted = completedNoteIds.includes(note.id);
        const isActive = activeNoteId === note.id;
        const isDown = note.strumDirection === "down";

        return (
          <div
            key={`strum-${note.id}`}
            style={{ transform: `translate3d(${xPos}px, -50%, 0)` }}
            className="absolute top-1/2 -ml-4 w-8 h-8 flex items-center justify-center pointer-events-none transition-colors duration-150 z-20"
          >
            <div
              className={`w-7 h-7 rounded-lg flex flex-col items-center justify-center border text-xs font-extrabold transition-all duration-150 ${
                isCompleted
                  ? "bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-95"
                  : isActive
                    ? "bg-cyan-500/30 border-cyan-300 text-cyan-200 shadow-[0_0_16px_rgba(6,182,212,0.85)] scale-110"
                    : "bg-white/5 border-white/15 text-slate-300"
              }`}
              title={isDown ? "Downstroke (Strum Down)" : "Upstroke (Strum Up)"}
            >
              {isDown ? (
                <ArrowDown className="w-4 h-4 stroke-[2.75]" />
              ) : (
                <ArrowUp className="w-4 h-4 stroke-[2.75]" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ============================================================================
 * COMPONENT: <StringLines />
 * ============================================================================
 * Renders the 6 horizontal guitar string lines with realistic string gauges
 * (thinnest 1st string E4 at top, thickest wound 6th string E2 at bottom)
 * and interactive left-side string badges that can be clicked to pluck!
 */
function StringLines({ activeString, onPluckString }) {
  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-6">
      {GUITAR_STRINGS.map((s) => {
        const isHighlighted = activeString === s.string;

        return (
          <div key={s.string} className="relative w-full flex items-center h-8">
            {/* Left-side String Tuning Label & Quick Pluck Button */}
            <button
              type="button"
              onClick={() => onPluckString(s.string, 0)}
              title={`Click to pluck Open String ${s.string} (${s.note} - ${s.freq.toFixed(1)} Hz)`}
              className={`pointer-events-auto z-30 w-24 h-8 bg-[#16161f] border-r border-white/10 px-2.5 flex items-center justify-between transition-all group hover:bg-white/10 ${
                isHighlighted ? "bg-cyan-950/80 border-r-cyan-400" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-5 h-5 rounded-md text-[11px] font-bold flex items-center justify-center ${
                    isHighlighted
                      ? "bg-cyan-400 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                      : "bg-white/10 text-slate-300 group-hover:bg-fuchsia-500/30 group-hover:text-white"
                  }`}
                >
                  {s.string}
                </span>
                <span className="text-xs font-bold tracking-tight text-white">
                  {s.name}
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 group-hover:text-cyan-300">
                {s.note}
              </span>
            </button>

            {/* Horizontal Guitar String Line */}
            <div className="relative flex-1 h-full flex items-center">
              <div
                style={{ height: `${s.gaugePx}px` }}
                className={`w-full transition-all duration-150 ${
                  isHighlighted
                    ? "bg-gradient-to-r from-cyan-400 via-cyan-300 to-white/40 shadow-[0_0_12px_rgba(6,182,212,0.9)]"
                    : s.wound
                      ? "bg-gradient-to-r from-zinc-500 via-zinc-400/70 to-zinc-600/60"
                      : "bg-gradient-to-r from-zinc-300/80 via-zinc-400/60 to-zinc-500/50"
                }`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ============================================================================
 * COMPONENT: <Playhead />
 * ============================================================================
 * Renders the vertical cyan/teal playhead indicator line with neon glow and
 * a target reticle on the currently expected guitar string.
 */
function Playhead({ playheadX, activeString, isWaitingForPitch, justHit }) {
  // Calculate vertical percentage for activeString (1..6)
  const stringIndex = activeString ? activeString - 1 : null;

  return (
    <div
      style={{ left: `${playheadX}px` }}
      className="absolute top-0 bottom-0 z-20 pointer-events-none -ml-[1.5px]"
    >
      {/* Top Playhead Cap */}
      <div
        className={`w-4 h-2.5 -ml-[6.5px] rounded-b-md transition-colors duration-150 ${
          justHit
            ? "bg-emerald-400 shadow-[0_0_16px_#10b981]"
            : "bg-cyan-400 shadow-[0_0_15px_#06b6d4]"
        }`}
      />

      {/* Main Vertical Playhead Laser Line */}
      <div
        className={`w-[3px] h-full transition-all duration-150 ${
          justHit
            ? "bg-emerald-400 shadow-[0_0_24px_4px_rgba(16,185,129,0.95)]"
            : isWaitingForPitch
              ? "bg-cyan-300 shadow-[0_0_22px_4px_rgba(6,182,212,0.95)] animate-pulse"
              : "bg-cyan-400/90 shadow-[0_0_16px_2px_rgba(6,182,212,0.75)]"
        }`}
      />

      {/* Ambient Vertical Hit Zone Glow */}
      <div
        className={`absolute top-0 bottom-0 -left-5 w-10 pointer-events-none transition-opacity duration-200 ${
          justHit
            ? "bg-emerald-400/15 opacity-100"
            : isWaitingForPitch
              ? "bg-cyan-400/15 opacity-100"
              : "bg-cyan-400/5 opacity-70"
        }`}
      />

      {/* Active String Target Ring */}
      {stringIndex !== null && (
        <div
          style={{
            top: `calc(1.5rem + ${stringIndex} * ((100% - 3rem) / 5))`,
          }}
          className="absolute -left-6 -mt-6 w-12 h-12 rounded-2xl border-2 border-cyan-300/60 bg-cyan-400/10 shadow-[0_0_20px_rgba(6,182,212,0.5)] animate-ping pointer-events-none"
        />
      )}
    </div>
  );
}

/**
 * ============================================================================
 * COMPONENT: <NoteTile />
 * ============================================================================
 * Renders an individual fret number tile positioned on its corresponding
 * guitar string line (1-6) and horizontal x-offset based on timestamp.
 * Clicking any NoteTile directly plucks its exact frequency so users can
 * audition or test pitch detection effortlessly!
 */
function NoteTile({
  note,
  currentTime,
  playheadX,
  pixelsPerMs,
  isActive,
  isCompleted,
  onPluckNote,
}) {
  const xPos = playheadX + (note.timestamp - currentTime) * pixelsPerMs;

  // Do not render off-screen tiles
  if (xPos < 65 || xPos > 1400) return null;

  const stringIndex = note.string - 1; // 0..5

  // Determine visual state styling
  let tileStyle =
    "bg-white text-slate-950 border-2 border-slate-200 shadow-[0_4px_12px_rgba(0,0,0,0.45)] hover:scale-105";

  if (isCompleted) {
    tileStyle =
      "bg-emerald-400 text-slate-950 border-2 border-emerald-200 shadow-[0_0_22px_rgba(16,185,129,0.9)] scale-105";
  } else if (isActive) {
    tileStyle =
      "bg-cyan-300 text-slate-950 border-2 border-white ring-4 ring-cyan-400/60 shadow-[0_0_28px_rgba(6,182,212,1)] scale-115";
  }

  return (
    <button
      type="button"
      onClick={() => onPluckNote(note)}
      title={`String ${note.string}, Fret ${note.fret} (${getFrequencyForStringFret(
        note.string,
        note.fret,
      ).toFixed(1)} Hz) — Click to pluck!`}
      style={{
        left: `${xPos}px`,
        top: `calc(2.5rem + ${stringIndex} * ((100% - 5rem) / 5))`,
      }}
      className={`absolute -ml-5 -mt-5 w-10 h-10 rounded-xl font-black text-lg flex items-center justify-center select-none transition-transform duration-100 cursor-pointer z-25 ${tileStyle}`}
    >
      <span>{note.fret}</span>
      {isCompleted && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow">
          <Check className="w-2.5 h-2.5 stroke-[3]" />
        </span>
      )}
    </button>
  );
}

/**
 * ============================================================================
 * COMPONENT: <CaptionBox />
 * ============================================================================
 * Dark rounded box below the tab area showing instructional text, tutorial
 * hints, and real-time "Try again" pitch feedback if the user plays the wrong
 * fret or waits too long.
 */
function CaptionBox({
  activeNote,
  isWaitingForPitch,
  waitDurationMs,
  pitchFeedback,
  lessonComplete,
  onPluckActiveNote,
  onRestartLesson,
}) {
  if (lessonComplete) {
    return (
      <div className="mt-4 bg-[#15151e]/95 backdrop-blur-md border border-emerald-400/40 rounded-2xl p-4 sm:p-5 text-white shadow-[0_10px_35px_rgba(0,0,0,0.5)] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Section Completed!
            </div>
            <p className="text-sm sm:text-base font-semibold text-white">
              Awesome job! You nailed every note in this tab section. Ready to
              replay or jump to the next riff?
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRestartLesson}
          className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-2 transition shadow-lg cursor-pointer shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
          Replay Section
        </button>
      </div>
    );
  }

  const targetFreq = activeNote
    ? getFrequencyForStringFret(activeNote.string, activeNote.fret)
    : null;
  const targetDetails = targetFreq ? frequencyToNoteDetails(targetFreq) : null;
  const showTryAgain =
    isWaitingForPitch &&
    (waitDurationMs > 2400 || pitchFeedback?.status === "wrong");

  return (
    <div
      className={`mt-4 bg-[#14141c]/95 backdrop-blur-md border rounded-2xl p-4 sm:p-5 text-white shadow-[0_12px_35px_rgba(0,0,0,0.55)] transition-all duration-200 ${
        showTryAgain
          ? "border-amber-400/60 shadow-[0_0_25px_rgba(251,191,36,0.18)]"
          : isWaitingForPitch
            ? "border-cyan-400/60 shadow-[0_0_25px_rgba(6,182,212,0.2)]"
            : "border-white/10"
      }`}
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              showTryAgain
                ? "bg-amber-500/20 border border-amber-400/40 text-amber-300"
                : isWaitingForPitch
                  ? "bg-cyan-500/20 border border-cyan-400/50 text-cyan-300"
                  : "bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-300"
            }`}
          >
            {showTryAgain ? (
              <AlertCircle className="w-5 h-5" />
            ) : isWaitingForPitch ? (
              <Sparkles className="w-5 h-5" />
            ) : (
              <Music className="w-5 h-5" />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                {isWaitingForPitch
                  ? "Play Now at Playhead"
                  : "Upcoming Note Hint"}
              </span>
              {activeNote && (
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-xs font-mono text-slate-200">
                  String {activeNote.string} • Fret {activeNote.fret} (
                  {targetDetails?.noteName} / {targetFreq?.toFixed(1)} Hz)
                </span>
              )}
              {activeNote?.strumDirection && (
                <span className="px-2 py-0.5 rounded-md bg-fuchsia-500/20 border border-fuchsia-400/30 text-xs font-bold text-fuchsia-200 uppercase">
                  {activeNote.strumDirection === "down"
                    ? "↓ Downstroke"
                    : "↑ Upstroke"}
                </span>
              )}
            </div>

            <p className="text-sm sm:text-base font-medium text-slate-100 leading-relaxed">
              {activeNote
                ? activeNote.hint
                : "Press Play or Pluck the target note to begin scrolling the tab track."}
            </p>

            {/* Subtle "Try Again" or Pitch Direction Hint */}
            {showTryAgain && activeNote && (
              <div className="pt-1 flex items-center gap-2 text-xs sm:text-sm font-semibold text-amber-300">
                <span>
                  {pitchFeedback?.message ||
                    `Try again! Pluck String ${activeNote.string} at Fret ${activeNote.fret} (${targetDetails?.noteName}) into your mic, or click "Pluck Target Note" to simulate it.`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Instant Test Button inside Caption Box */}
        {activeNote && (
          <button
            type="button"
            onClick={() => onPluckActiveNote(activeNote)}
            className="w-full md:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 hover:from-cyan-400 hover:to-teal-300 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.4)] transition cursor-pointer shrink-0"
          >
            <Zap className="w-4 h-4 fill-slate-950" />
            <span>
              Pluck Target (S{activeNote.string} • F{activeNote.fret})
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * COMPONENT: <CodeInspectorModal />
 * ============================================================================
 * Allows the user to inspect the pitch-to-fret math and copy clean modular
 * code snippets if they wish to split the app into separate local files.
 */
function CodeInspectorModal({ isOpen, onClose }) {
  const [copiedTab, setCopiedTab] = useState(false);

  if (!isOpen) return null;

  const mathSummaryCode = `// ============================================================================
// PITCH-TO-FRET MAPPING MATH (Standard Guitar Tuning: E2 A2 D3 G3 B3 E4)
// ============================================================================
const OPEN_STRING_FREQS = {
  1: 329.63, // String 1 (High E4) - MIDI 64
  2: 246.94, // String 2 (B3)      - MIDI 59
  3: 196.00, // String 3 (G3)      - MIDI 55
  4: 146.83, // String 4 (D3)      - MIDI 50
  5: 110.00, // String 5 (A2)      - MIDI 45
  6: 82.41,  // String 6 (Low E2)  - MIDI 40
};

// 1. Calculate expected frequency for (targetString, targetFret):
export function getExpectedFrequency(targetString, targetFret) {
  const fOpen = OPEN_STRING_FREQS[targetString];
  return fOpen * Math.pow(2, targetFret / 12);
}

// 2. Calculate fret number on a given string from detected frequency fDetected:
export function getFretFromFrequency(fDetected, stringNumber) {
  const fOpen = OPEN_STRING_FREQS[stringNumber];
  const exactSemitones = 12 * Math.log2(fDetected / fOpen);
  const nearestFret = Math.round(exactSemitones);
  const centsError = (exactSemitones - nearestFret) * 100;
  return { nearestFret, centsError };
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(mathSummaryCode);
    setCopiedTab(true);
    setTimeout(() => setCopiedTab(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#161621] border border-white/15 rounded-2xl max-w-3xl w-full p-6 text-white shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <h3 className="font-bold text-lg">
              YIN Autocorrelation & Pitch-to-Fret Math Reference
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto space-y-4 text-sm text-slate-300 pr-1">
          <p>
            This application runs a real-time{" "}
            <strong>YIN Cumulative Mean Normalized Difference</strong> pitch
            detector directly on the Web Audio API{" "}
            <code className="text-cyan-300">AnalyserNode</code> time-domain
            buffer. Both live microphone audio and the built-in Virtual Guitar
            Synthesizer pass through the exact same YIN pitch detector!
          </p>

          <div className="relative bg-black/60 border border-white/10 rounded-xl p-4 font-mono text-xs text-cyan-200 overflow-x-auto">
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 text-xs cursor-pointer"
            >
              {copiedTab ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedTab ? "Copied" : "Copy Math"}
            </button>
            <pre>{mathSummaryCode}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * MAIN COMPONENT: <TabPlayer />
 * ============================================================================
 * Manages:
 * - High-precision `requestAnimationFrame` playback clock (`currentTime` in ms)
 * - Two practice modes:
 *   1. "Wait for Note (Interactive Pitch Practice)": Scrolls smoothly up to each
 *      note's timestamp, pauses at the cyan playhead, and waits for the user to
 *      play the matching frequency (via Microphone or Virtual Guitar Pluck).
 *   2. "Auto-Scroll Tempo Jam": Continuous scrolling at the chosen speed with
 *      optional synthesized guitar backing audio.
 */
function TabPlayer() {
  // Lesson & Playback State
  const [selectedLessonIdx, setSelectedLessonIdx] = useState(0);
  const currentLesson = LESSONS[selectedLessonIdx];

  const [isPlaying, setIsPlaying] = useState(false);
  const [practiceMode, setPracticeMode] = useState("wait"); // 'wait' | 'auto'
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [autoBackingAudio, setAutoBackingAudio] = useState(true);

  // Clock & Progress State
  const [currentTime, setCurrentTime] = useState(0); // ms
  const [currentNoteIndex, setCurrentNoteIndex] = useState(0);
  const [completedNoteIds, setCompletedNoteIds] = useState([]);
  const [isWaitingForPitch, setIsWaitingForPitch] = useState(false);
  const [waitDurationMs, setWaitDurationMs] = useState(0);
  const [justHit, setJustHit] = useState(false);
  const [pitchFeedback, setPitchFeedback] = useState(null);
  const [showCodeModal, setShowCodeModal] = useState(false);

  // Pitch Detector Hook
  const {
    isListening,
    micSourceActive,
    micError,
    startListening,
    stopListening,
    simulateFrequency,
    currentFrequency,
    currentNote,
    centsOff,
    currentString,
    currentFret,
    possiblePositions,
    signalLevel,
    sourceType,
  } = usePitchDetection();

  // Refs for smooth requestAnimationFrame loop without stale closures
  const clockRef = useRef(0);
  const lastFrameTimeRef = useRef(null);
  const rafRef = useRef(null);
  const waitStartTimestampRef = useRef(null);
  const lastAutoPluckedNoteIdRef = useRef(null);

  const notes = currentLesson.notes;
  const totalNotes = notes.length;
  const activeNote = notes[currentNoteIndex] || null;
  const lessonComplete = currentNoteIndex >= totalNotes;

  // Layout Constants for Scrolling Tab Track
  const PLAYHEAD_X = 190; // Fixed cyan playhead X position in pixels (after 96px string label column)
  const PIXELS_PER_MS = 0.19; // Horizontal scroll speed factor

  // Reset lesson progress helper
  const resetLesson = useCallback(() => {
    setIsPlaying(false);
    clockRef.current = 0;
    setCurrentTime(0);
    setCurrentNoteIndex(0);
    setCompletedNoteIds([]);
    setIsWaitingForPitch(false);
    setWaitDurationMs(0);
    setPitchFeedback(null);
    lastFrameTimeRef.current = null;
    waitStartTimestampRef.current = null;
    lastAutoPluckedNoteIdRef.current = null;
  }, []);

  // Switch lesson handler
  const handleSelectLesson = (idx) => {
    setSelectedLessonIdx(idx);
    setIsPlaying(false);
    clockRef.current = 0;
    setCurrentTime(0);
    setCurrentNoteIndex(0);
    setCompletedNoteIds([]);
    setIsWaitingForPitch(false);
    setWaitDurationMs(0);
    setPitchFeedback(null);
    lastFrameTimeRef.current = null;
    waitStartTimestampRef.current = null;
    lastAutoPluckedNoteIdRef.current = null;
  };

  // Advance playhead when a note is successfully matched or skipped
  const markCurrentNoteHit = useCallback(
    (noteToMark) => {
      if (!noteToMark) return;

      setCompletedNoteIds((prev) =>
        prev.includes(noteToMark.id) ? prev : [...prev, noteToMark.id],
      );
      setJustHit(true);
      setTimeout(() => setJustHit(false), 260);

      setIsWaitingForPitch(false);
      setWaitDurationMs(0);
      setPitchFeedback({ status: "hit", message: "Perfect pitch match!" });
      waitStartTimestampRef.current = null;

      setCurrentNoteIndex((prevIdx) => {
        const nextIdx = prevIdx + 1;
        if (nextIdx >= notes.length) {
          setIsPlaying(false);
        }
        return nextIdx;
      });
    },
    [notes.length],
  );

  // High-precision requestAnimationFrame clock loop
  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = (now) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      }
      const deltaMs = (now - lastFrameTimeRef.current) * playbackSpeed;
      lastFrameTimeRef.current = now;

      const targetNote = notes[currentNoteIndex];

      if (!targetNote) {
        // End of lesson reached
        setIsPlaying(false);
        return;
      }

      if (practiceMode === "wait") {
        // Scroll smoothly up to targetNote.timestamp, then pause and wait for pitch match
        const nextTime = clockRef.current + deltaMs;
        if (nextTime >= targetNote.timestamp) {
          clockRef.current = targetNote.timestamp;
          setCurrentTime(targetNote.timestamp);

          if (!waitStartTimestampRef.current) {
            waitStartTimestampRef.current = now;
          }
          setIsWaitingForPitch(true);
          setWaitDurationMs(now - waitStartTimestampRef.current);
        } else {
          clockRef.current = nextTime;
          setCurrentTime(nextTime);
          setIsWaitingForPitch(false);
        }
      } else {
        // Auto-Scroll Tempo mode: advance clock continuously
        const nextTime = clockRef.current + deltaMs;
        clockRef.current = nextTime;
        setCurrentTime(nextTime);

        if (nextTime >= targetNote.timestamp) {
          if (
            autoBackingAudio &&
            lastAutoPluckedNoteIdRef.current !== targetNote.id
          ) {
            lastAutoPluckedNoteIdRef.current = targetNote.id;
            const freq = getFrequencyForStringFret(
              targetNote.string,
              targetNote.fret,
            );
            simulateFrequency(freq, 500, true);
          }
          markCurrentNoteHit(targetNote);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    practiceMode,
    playbackSpeed,
    currentNoteIndex,
    notes,
    autoBackingAudio,
    simulateFrequency,
    markCurrentNoteHit,
  ]);

  /**
   * ============================================================================
   * REAL-TIME PITCH VERIFICATION AGAINST EXPECTED NOTE AT PLAYHEAD
   * ============================================================================
   * Whenever `currentFrequency` updates from `usePitchDetection`, compare it to
   * the expected frequency of `activeNote = { string, fret }`.
   *
   * Tolerance: ±65 cents (~3.8% frequency tolerance) so slightly out-of-tune
   * acoustic/electric guitars still feel responsive and rewarding.
   */
  useEffect(() => {
    if (!activeNote || !currentFrequency) return;

    // Allow matching when waiting at the playhead OR when within 280ms of the playhead
    const timeDiffMs = Math.abs(activeNote.timestamp - currentTime);
    const isAtPlayheadWindow = isWaitingForPitch || timeDiffMs <= 320;
    if (!isAtPlayheadWindow) return;

    const expectedFreq = getFrequencyForStringFret(
      activeNote.string,
      activeNote.fret,
    );
    const centsDifference = 1200 * Math.log2(currentFrequency / expectedFreq);

    if (Math.abs(centsDifference) <= 65) {
      // Matched expected note! Advance playhead and mark note green.
      clockRef.current = activeNote.timestamp;
      setCurrentTime(activeNote.timestamp);
      markCurrentNoteHit(activeNote);
    } else if (isWaitingForPitch) {
      // Provide helpful directional hint in CaptionBox
      const direction =
        centsDifference < 0
          ? "too low (play a higher fret/string)"
          : "too high (play a lower fret/string)";
      setPitchFeedback({
        status: "wrong",
        message: `Detected ${currentNote} (${currentFrequency.toFixed(
          1,
        )} Hz) — that's ${direction}. Aim for String ${activeNote.string}, Fret ${activeNote.fret}!`,
      });
    }
  }, [
    currentFrequency,
    currentNote,
    activeNote,
    currentTime,
    isWaitingForPitch,
    markCurrentNoteHit,
  ]);

  // Pluck a specific note (used by clicking a NoteTile or "Pluck Target" button)
  const handlePluckNote = useCallback(
    (noteObj) => {
      if (!noteObj) return;
      // Ensure clock jumps to this note if paused so the user can step through interactively
      if (!isPlaying && activeNote && noteObj.id === activeNote.id) {
        clockRef.current = activeNote.timestamp;
        setCurrentTime(activeNote.timestamp);
        setIsWaitingForPitch(true);
      }
      const targetFreq = getFrequencyForStringFret(
        noteObj.string,
        noteObj.fret,
      );
      simulateFrequency(targetFreq, 700, true);
    },
    [isPlaying, activeNote, simulateFrequency],
  );

  // Pluck arbitrary (string, fret) from the left-side labels or Mini Fretboard
  const handlePluckStringFret = useCallback(
    (stringNum, fretNum) => {
      if (!isPlaying && activeNote) {
        clockRef.current = activeNote.timestamp;
        setCurrentTime(activeNote.timestamp);
        setIsWaitingForPitch(true);
      }
      const freq = getFrequencyForStringFret(stringNum, fretNum);
      simulateFrequency(freq, 700, true);
    },
    [isPlaying, activeNote, simulateFrequency],
  );

  // SKIP button handler (skips current note or jumps to next lesson if finished)
  const handleSkip = () => {
    if (activeNote) {
      clockRef.current = activeNote.timestamp;
      setCurrentTime(activeNote.timestamp);
      markCurrentNoteHit(activeNote);
    } else {
      const nextLessonIdx = (selectedLessonIdx + 1) % LESSONS.length;
      handleSelectLesson(nextLessonIdx);
    }
  };

  // Toggle Play/Pause and automatically enable pitch detector
  const handleTogglePlay = () => {
    if (lessonComplete) {
      resetLesson();
      setIsPlaying(true);
      if (!isListening) startListening();
      return;
    }
    const nextPlay = !isPlaying;
    setIsPlaying(nextPlay);
    if (nextPlay && !isListening) {
      startListening();
    }
  };

  // Expected frequency details for HUD display
  const expectedFreq = activeNote
    ? getFrequencyForStringFret(activeNote.string, activeNote.fret)
    : null;
  const expectedNoteDetails = expectedFreq
    ? frequencyToNoteDetails(expectedFreq)
    : null;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-fuchsia-950 via-purple-900 to-indigo-950 text-white p-3 sm:p-6 md:p-8 flex flex-col justify-between select-none overflow-x-hidden">
      {/* Ambient Background Glow Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-28 -left-28 w-96 h-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-28 w-96 h-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 w-96 h-96 rounded-full bg-purple-600/25 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-6xl w-full mx-auto space-y-5">
        {/* ====================================================================
            TOP BAR: App Branding, Lesson Selector, Mode Toggle & Mic Controls
           ==================================================================== */}
        <header className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#14141d]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 sm:p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-fuchsia-500 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.5)]">
                <Music className="w-5 h-5 text-slate-950 stroke-[2.5]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-black text-base sm:text-lg tracking-tight text-white">
                    FretFlow Studio
                  </h1>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                    YIN Pitch Engine
                  </span>
                </div>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Interactive Scrolling Guitar Tab & Real-Time Web Audio Pitch
                  Trainer
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowCodeModal(true)}
              className="lg:hidden px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Code2 className="w-4 h-4 text-cyan-400" />
              <span>Math</span>
            </button>
          </div>

          {/* Lesson Picker Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {LESSONS.map((lesson, idx) => (
              <button
                key={lesson.id}
                type="button"
                onClick={() => handleSelectLesson(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selectedLessonIdx === idx
                    ? "bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white shadow-[0_0_15px_rgba(217,70,239,0.5)]"
                    : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5"
                }`}
              >
                {lesson.title.split("—")[0]}
              </button>
            ))}
          </div>

          {/* Right Controls: Practice Mode + Mic Button + Code Math Modal */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setPracticeMode("wait")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  practiceMode === "wait"
                    ? "bg-cyan-400 text-slate-950 shadow"
                    : "text-slate-300 hover:text-white"
                }`}
                title="Pauses at each note until you play the matching pitch on your guitar or virtual fretboard"
              >
                Wait for Pitch
              </button>
              <button
                type="button"
                onClick={() => setPracticeMode("auto")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  practiceMode === "auto"
                    ? "bg-cyan-400 text-slate-950 shadow"
                    : "text-slate-300 hover:text-white"
                }`}
                title="Continuously scrolls at tempo with optional guitar synth backing"
              >
                Auto Tempo
              </button>
            </div>

            <button
              type="button"
              onClick={micSourceActive ? stopListening : startListening}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition cursor-pointer border ${
                micSourceActive
                  ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.35)]"
                  : "bg-white/10 hover:bg-white/15 border-white/15 text-white"
              }`}
            >
              {micSourceActive ? (
                <>
                  <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span>Mic Live</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4 text-slate-300" />
                  <span>Enable Mic</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowCodeModal(true)}
              className="hidden lg:flex px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold items-center gap-1.5 cursor-pointer"
              title="Inspect Pitch-to-Fret Math"
            >
              <Code2 className="w-4 h-4 text-cyan-400" />
              <span>Pitch Math</span>
            </button>
          </div>
        </header>

        {/* Non-intrusive notice if microphone permission was declined */}
        {micError && (
          <div className="bg-amber-500/15 border border-amber-400/40 rounded-xl px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3">
            <span>{micError}</span>
            <button
              type="button"
              onClick={startListening}
              className="px-2.5 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 font-bold shrink-0 cursor-pointer"
            >
              Retry Mic
            </button>
          </div>
        )}

        {/* ====================================================================
            CORE UI — SCROLLING GUITAR TAB PLAYER CARD
           ==================================================================== */}
        <div className="relative bg-gradient-to-b from-[#181822] to-[#101017] border border-white/15 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.75)] overflow-hidden">
          {/* TOP CONTROL OVERLAY BAR: Play/Pause Top-Left & Progress X/Y Top-Right */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-[#1b1b26]/90 border-b border-white/10">
            {/* Top-Left: Play/Pause, Reset, Speed & Backing Synth Toggle */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleTogglePlay}
                className={`px-4 py-2 rounded-xl font-black text-xs sm:text-sm flex items-center gap-2 transition shadow-lg cursor-pointer ${
                  isPlaying
                    ? "bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-[0_0_20px_rgba(251,191,36,0.5)]"
                    : "bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.5)]"
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4 fill-slate-950" />
                    <span>PAUSE</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-slate-950" />
                    <span>{lessonComplete ? "REPLAY" : "PLAY"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetLesson}
                title="Restart section from beginning"
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {/* Speed Multiplier Selector */}
              <div className="hidden sm:flex items-center gap-1 bg-black/40 px-2 py-1 rounded-xl border border-white/10">
                <Sliders className="w-3.5 h-3.5 text-slate-400 mr-1" />
                {[0.5, 0.75, 1.0, 1.25].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      playbackSpeed === spd
                        ? "bg-white/15 text-cyan-300"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              {practiceMode === "auto" && (
                <button
                  type="button"
                  onClick={() => setAutoBackingAudio((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                    autoBackingAudio
                      ? "bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-200"
                      : "bg-white/5 border-white/10 text-slate-400"
                  }`}
                >
                  {autoBackingAudio ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden md:inline">Synth Backing</span>
                </button>
              )}
            </div>

            {/* Center Lesson Title */}
            <div className="hidden xl:block text-center">
              <div className="text-xs font-bold text-white">
                {currentLesson.title}
              </div>
              <div className="text-[11px] text-slate-400">
                {currentLesson.subtitle}
              </div>
            </div>

            {/* Top-Right: Progress Indicator "X/Y" */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-black/50 border border-white/15 px-3.5 py-1.5 rounded-xl">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span className="text-xs uppercase tracking-wider text-slate-400 font-bold">
                  Progress
                </span>
                <span className="font-mono font-black text-base sm:text-lg text-white">
                  {Math.min(
                    completedNoteIds.length + (lessonComplete ? 0 : 1),
                    totalNotes,
                  )}
                  /{totalNotes}
                </span>
              </div>
            </div>
          </div>

          {/* STRUM DIRECTION VARIANT LANE (Above the 6 Tab String Lines) */}
          <StrumArrowRow
            notes={notes}
            currentTime={currentTime}
            playheadX={PLAYHEAD_X}
            pixelsPerMs={PIXELS_PER_MS}
            activeNoteId={activeNote?.id}
            completedNoteIds={completedNoteIds}
          />

          {/* 6-STRING SCROLLING TAB TRACK CANVAS */}
          <div className="relative w-full h-72 sm:h-80 bg-gradient-to-b from-[#16161f] via-[#12121a] to-[#181822] overflow-hidden">
            {/* Subtle vertical beat grid lines */}
            {[
              0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
              11000, 12000,
            ].map((ms) => {
              const gx = PLAYHEAD_X + (ms - currentTime) * PIXELS_PER_MS;
              if (gx < 96 || gx > 1300) return null;
              return (
                <div
                  key={`grid-${ms}`}
                  style={{ left: `${gx}px` }}
                  className="absolute top-0 bottom-0 w-px bg-white/[0.04] pointer-events-none"
                />
              );
            })}

            {/* 6 Horizontal Guitar Strings */}
            <StringLines
              activeString={activeNote?.string}
              onPluckString={handlePluckStringFret}
            />

            {/* Stationary Cyan Playhead Line */}
            <Playhead
              playheadX={PLAYHEAD_X}
              activeString={activeNote?.string}
              isWaitingForPitch={isWaitingForPitch}
              justHit={justHit}
            />

            {/* Scrolling Fret Number NoteTiles */}
            {notes.map((note) => (
              <NoteTile
                key={note.id}
                note={note}
                currentTime={currentTime}
                playheadX={PLAYHEAD_X}
                pixelsPerMs={PIXELS_PER_MS}
                isActive={activeNote?.id === note.id}
                isCompleted={completedNoteIds.includes(note.id)}
                onPluckNote={handlePluckNote}
              />
            ))}

            {/* Bottom-Right "SKIP" Button inside Tab Area */}
            <div className="absolute bottom-3.5 right-4 z-30 flex items-center gap-2">
              {activeNote && (
                <button
                  type="button"
                  onClick={() => handlePluckNote(activeNote)}
                  className="px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 font-bold text-xs flex items-center gap-1.5 backdrop-blur-md transition cursor-pointer shadow-lg"
                  title="Emit target note frequency into the pitch detector"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Pluck Note</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSkip}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-black text-xs tracking-wider uppercase flex items-center gap-1.5 backdrop-blur-md transition shadow-lg cursor-pointer"
              >
                <span>SKIP</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ====================================================================
            CAPTION / SUBTITLE INSTRUCTIONAL BOX BELOW THE TAB AREA
           ==================================================================== */}
        <CaptionBox
          activeNote={activeNote}
          isWaitingForPitch={isWaitingForPitch}
          waitDurationMs={waitDurationMs}
          pitchFeedback={pitchFeedback}
          lessonComplete={lessonComplete}
          onPluckActiveNote={handlePluckNote}
          onRestartLesson={resetLesson}
        />

        {/* ====================================================================
            REAL-TIME PITCH DETECTOR HUD & INTERACTIVE TEST FRETBOARD
           ==================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left 5 Cols: Real-Time Chromatic Pitch Detector Telemetry Card */}
          <div className="lg:col-span-5 bg-[#14141d]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio
                  className={`w-4 h-4 ${
                    currentFrequency
                      ? "text-emerald-400 animate-ping"
                      : "text-cyan-400"
                  }`}
                />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                  Real-Time YIN Pitch Detector
                </h2>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/5 text-slate-400">
                {sourceType === "mic"
                  ? "Input: Microphone"
                  : sourceType === "synth"
                    ? "Input: Guitar Synth"
                    : "Waiting for audio..."}
              </span>
            </div>

            {/* Main Detected Pitch Readout vs Expected Target */}
            <div className="grid grid-cols-2 gap-3 bg-black/40 border border-white/10 rounded-xl p-3.5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Detected Pitch
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl sm:text-3xl font-black text-cyan-300 font-mono">
                    {currentNote || "--"}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {currentFrequency
                      ? `${currentFrequency.toFixed(1)} Hz`
                      : "0.0 Hz"}
                  </span>
                </div>
                <div className="text-xs text-slate-300 mt-1 font-medium">
                  {currentString !== null
                    ? `Matches String ${currentString} • Fret ${currentFret}`
                    : "Play a string or click fretboard"}
                </div>
              </div>

              <div className="border-l border-white/10 pl-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">
                  Target at Playhead
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl sm:text-3xl font-black text-white font-mono">
                    {expectedNoteDetails?.noteName || "--"}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {expectedFreq ? `${expectedFreq.toFixed(1)} Hz` : "--"}
                  </span>
                </div>
                <div className="text-xs text-fuchsia-200 mt-1 font-medium">
                  {activeNote
                    ? `String ${activeNote.string} • Fret ${activeNote.fret}`
                    : "Section Complete"}
                </div>
              </div>
            </div>

            {/* Cents Tuning Gauge & Input Signal Meter */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>-50c (Flat)</span>
                <span className="text-cyan-300 font-bold">
                  {currentFrequency
                    ? `${centsOff > 0 ? `+${centsOff}` : centsOff} cents`
                    : "0 cents"}
                </span>
                <span>+50c (Sharp)</span>
              </div>
              <div className="relative h-2.5 w-full bg-black/60 rounded-full overflow-hidden border border-white/10">
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-emerald-400 z-10" />
                {currentFrequency && (
                  <div
                    style={{
                      left: `${Math.max(5, Math.min(95, 50 + centsOff))}%`,
                    }}
                    className="absolute top-0 bottom-0 w-3 -ml-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#06b6d4] transition-all duration-75"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right 7 Cols: Interactive Mini Guitar Fretboard (Frets 0 to 6) */}
          <div className="lg:col-span-7 bg-[#14141d]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                  Interactive Guitar Fretboard Synthesizer (Click Any Fret to
                  Pluck)
                </h2>
                <p className="text-[11px] text-slate-400">
                  No guitar plugged in? Click any glowing cyan fret below (or
                  press Spacebar) to feed real synthesized guitar audio into the
                  YIN pitch detector!
                </p>
              </div>
            </div>

            {/* 6-String x Frets 0..6 Interactive Matrix */}
            <div className="overflow-x-auto">
              <div className="min-w-[460px] space-y-1.5 bg-[#0e0e15] p-3 rounded-xl border border-white/10">
                {/* Fret Header Numbers */}
                <div className="grid grid-cols-8 gap-1.5 text-center text-[10px] font-mono font-bold text-slate-400 pb-1">
                  <div className="text-left pl-1">STR</div>
                  {[0, 1, 2, 3, 4, 5, 6].map((fret) => (
                    <div key={`header-${fret}`}>
                      {fret === 0 ? "OPEN (0)" : `FRET ${fret}`}
                    </div>
                  ))}
                </div>

                {GUITAR_STRINGS.map((s) => (
                  <div
                    key={`fb-row-${s.string}`}
                    className="grid grid-cols-8 gap-1.5 items-center"
                  >
                    <div className="text-xs font-bold text-slate-300 font-mono pl-1">
                      {s.string} ({s.note})
                    </div>
                    {[0, 1, 2, 3, 4, 5, 6].map((fret) => {
                      const isTarget =
                        activeNote?.string === s.string &&
                        activeNote?.fret === fret;
                      const isDetected = possiblePositions?.some(
                        (pos) => pos.string === s.string && pos.fret === fret,
                      );

                      return (
                        <button
                          key={`cell-${s.string}-${fret}`}
                          type="button"
                          onClick={() => handlePluckStringFret(s.string, fret)}
                          className={`h-7 rounded-lg font-mono text-xs font-bold transition flex items-center justify-center cursor-pointer border ${
                            isDetected
                              ? "bg-emerald-400 text-slate-950 border-emerald-200 shadow-[0_0_12px_#10b981] scale-105"
                              : isTarget
                                ? "bg-cyan-400 text-slate-950 border-white shadow-[0_0_14px_#06b6d4] animate-pulse"
                                : "bg-white/5 hover:bg-white/15 text-slate-300 border-white/10"
                          }`}
                        >
                          {fret}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Code & Pitch Math Modal */}
      <CodeInspectorModal
        isOpen={showCodeModal}
        onClose={() => setShowCodeModal(false)}
      />
    </div>
  );
}

export default function App() {
  return <TabPlayer />;
}
