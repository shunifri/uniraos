import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoiceSettings {
  voiceInputEnabled: boolean;
  voiceOutputEnabled: boolean;
  autoPlay: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

interface VoiceState extends VoiceSettings {
  setVoiceInputEnabled: (v: boolean) => void;
  setVoiceOutputEnabled: (v: boolean) => void;
  setAutoPlay: (v: boolean) => void;
  setVoiceURI: (v: string | null) => void;
  setRate: (v: number) => void;
  setPitch: (v: number) => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      voiceInputEnabled: true,
      voiceOutputEnabled: true,
      autoPlay: false,
      voiceURI: null,
      rate: 1,
      pitch: 1,
      setVoiceInputEnabled: (voiceInputEnabled: boolean) => set({ voiceInputEnabled }),
      setVoiceOutputEnabled: (voiceOutputEnabled: boolean) => set({ voiceOutputEnabled }),
      setAutoPlay: (autoPlay: boolean) => set({ autoPlay }),
      setVoiceURI: (voiceURI: string | null) => set({ voiceURI }),
      setRate: (rate: number) => set({ rate }),
      setPitch: (pitch: number) => set({ pitch }),
    }),
    {
      name: 'raos-voice-settings',
      partialize: (state) => ({
        voiceInputEnabled: state.voiceInputEnabled,
        voiceOutputEnabled: state.voiceOutputEnabled,
        autoPlay: state.autoPlay,
        voiceURI: state.voiceURI,
        rate: state.rate,
        pitch: state.pitch,
      }),
    },
  ),
);
