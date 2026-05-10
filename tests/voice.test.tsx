import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput, useVoiceOutput, useVoices } from "../web/src/hooks/useVoice";

describe("Voice Hooks", () => {
  beforeEach(() => {
    // Mock SpeechRecognition
    const mockRecognition = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onstart: null as any,
      onresult: null as any,
      onerror: null as any,
      onend: null as any,
    };
    const MockSpeechRecognition = vi.fn(function (this: any) {
      return Object.assign(this, mockRecognition);
    }) as any;
    (globalThis as any).SpeechRecognition = MockSpeechRecognition;
    (globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;

    // Mock speechSynthesis
    const mockUtterance = {
      onstart: null as any,
      onend: null as any,
      onerror: null as any,
    };
    const MockUtterance = vi.fn(function (this: any, _text: string) {
      return Object.assign(this, mockUtterance);
    }) as any;
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    (globalThis as any).speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => [
        { voiceURI: "voice-1", name: "Voice 1", lang: "zh-CN" },
        { voiceURI: "voice-2", name: "Voice 2", lang: "en-US" },
      ]),
      onvoiceschanged: null as any,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("useVoiceInput", () => {
    it("should detect speech recognition support", () => {
      const { result } = renderHook(() => useVoiceInput("zh-CN"));
      expect(result.current.supported).toBe(true);
    });

    it("should start and stop listening", () => {
      const { result } = renderHook(() => useVoiceInput("zh-CN"));

      act(() => {
        result.current.startListening();
      });

      const MockSpeechRecognition = (globalThis as any).webkitSpeechRecognition;
      const recognition = MockSpeechRecognition.mock.instances[0];

      act(() => {
        recognition.onstart();
      });

      expect(result.current.isListening).toBe(true);

      act(() => {
        result.current.stopListening();
      });

      expect(result.current.isListening).toBe(false);
    });

    it("should update transcript on result", () => {
      const { result } = renderHook(() => useVoiceInput("zh-CN"));

      act(() => {
        result.current.startListening();
      });

      const MockSpeechRecognition = (globalThis as any).webkitSpeechRecognition;
      const recognition = MockSpeechRecognition.mock.instances[0];

      act(() => {
        recognition.onresult({
          resultIndex: 0,
          results: [
            {
              isFinal: true,
              0: { transcript: "你好世界" },
            },
          ],
        });
      });

      expect(result.current.transcript).toBe("你好世界");
    });

    it("should set error on permission denied", () => {
      const { result } = renderHook(() => useVoiceInput("zh-CN"));

      act(() => {
        result.current.startListening();
      });

      const MockSpeechRecognition = (globalThis as any).webkitSpeechRecognition;
      const recognition = MockSpeechRecognition.mock.instances[0];

      act(() => {
        recognition.onerror({ error: "not-allowed" });
      });

      expect(result.current.error).toContain("denied");
      expect(result.current.isListening).toBe(false);
    });
  });

  describe("useVoiceOutput", () => {
    it("should detect speech synthesis support", () => {
      const { result } = renderHook(() => useVoiceOutput());
      expect(result.current.supported).toBe(true);
    });

    it("should speak text", () => {
      const { result } = renderHook(() => useVoiceOutput());

      act(() => {
        result.current.speak("Hello world");
      });

      expect((globalThis as any).speechSynthesis.speak).toHaveBeenCalled();
    });

    it("should stop speaking", () => {
      const { result } = renderHook(() => useVoiceOutput());

      act(() => {
        result.current.stop();
      });

      expect((globalThis as any).speechSynthesis.cancel).toHaveBeenCalled();
    });
  });

  describe("useVoices", () => {
    it("should return available voices", () => {
      const { result } = renderHook(() => useVoices());
      expect(result.current.length).toBe(2);
      expect(result.current[0].voiceURI).toBe("voice-1");
    });
  });
});
