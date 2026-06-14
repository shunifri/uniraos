import { useState, useRef, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
//  Feature detection
/* ------------------------------------------------------------------ */

export const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
};

export const isSpeechSynthesisSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window;
};

/* ------------------------------------------------------------------ */
//  Voice Input (STT)
/* ------------------------------------------------------------------ */

export interface UseVoiceInputResult {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  supported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function useVoiceInput(lang: string = 'zh-CN'): UseVoiceInputResult {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const supported = isSpeechRecognitionSupported();

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback(() => {
    if (!supported) {
      setError('Speech recognition is not supported in this browser');
      return;
    }
    setError(null);
    setTranscript('');
    setInterimTranscript('');

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) {
        setTranscript((prev) => prev + final);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Please allow microphone access.');
      } else if (event.error === 'no-speech') {
        setError('No speech detected. Please try again.');
      } else if (event.error === 'network') {
        setError('Network error. Please check your connection.');
      } else if (event.error === 'aborted') {
        // User stopped manually — not an error
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e: any) {
      setError(`Failed to start recognition: ${e.message}`);
      setIsListening(false);
    }
  }, [lang, supported]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    supported,
    startListening,
    stopListening,
  };
}

/* ------------------------------------------------------------------ */
//  Voice Output (TTS)
/* ------------------------------------------------------------------ */

export interface UseVoiceOutputResult {
  isSpeaking: boolean;
  supported: boolean;
  speak: (text: string, options?: {
    voiceURI?: string | null;
    rate?: number;
    pitch?: number;
    lang?: string;
  }) => void;
  stop: () => void;
}

export function useVoiceOutput(): UseVoiceOutputResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const supported = isSpeechSynthesisSupported();

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string, options?: {
    voiceURI?: string | null;
    rate?: number;
    pitch?: number;
    lang?: string;
  }) => {
    if (!supported || typeof window === 'undefined') return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options?.lang || 'zh-CN';
    utterance.rate = options?.rate ?? 1;
    utterance.pitch = options?.pitch ?? 1;

    if (options?.voiceURI) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((v) => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [supported]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { isSpeaking, supported, speak, stop };
}

/* ------------------------------------------------------------------ */
//  Available voices helper
/* ------------------------------------------------------------------ */

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();

    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  return voices;
}
