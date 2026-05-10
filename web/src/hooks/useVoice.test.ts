import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput, useVoiceOutput, useVoices, isSpeechRecognitionSupported, isSpeechSynthesisSupported } from "./useVoice";

describe("useVoice (P3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("feature detection", () => {
    it("should detect speech recognition support", () => {
      expect(isSpeechRecognitionSupported()).toBe(false);
    });

    it("should detect speech synthesis support", () => {
      expect(isSpeechSynthesisSupported()).toBe(false);
    });
  });

  describe("useVoiceInput", () => {
    it("should return unsupported when SpeechRecognition is not available", () => {
      const { result } = renderHook(() => useVoiceInput());
      expect(result.current.supported).toBe(false);
      expect(result.current.isListening).toBe(false);
      expect(result.current.transcript).toBe("");
    });

    it("should set error when starting on unsupported browser", () => {
      const { result } = renderHook(() => useVoiceInput());
      act(() => {
        result.current.startListening();
      });
      expect(result.current.error).toContain("not supported");
    });

    it("should start and stop listening with mocked SpeechRecognition", () => {
      const mockRecognition = {
        start: vi.fn(),
        stop: vi.fn(),
        continuous: false,
        interimResults: false,
        lang: "",
        onstart: null as any,
        onend: null as any,
        onresult: null as any,
        onerror: null as any,
      };
      Object.defineProperty(window, "SpeechRecognition", {
        value: function() { return mockRecognition; },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useVoiceInput());
      expect(result.current.supported).toBe(true);

      act(() => {
        result.current.startListening();
      });
      expect(mockRecognition.start).toHaveBeenCalled();

      // Simulate onstart
      act(() => {
        mockRecognition.onstart();
      });
      expect(result.current.isListening).toBe(true);

      act(() => {
        result.current.stopListening();
      });
      expect(mockRecognition.stop).toHaveBeenCalled();
      expect(result.current.isListening).toBe(false);

      delete (window as any).SpeechRecognition;
    });
  });

  describe("useVoiceOutput", () => {
    it("should return unsupported when speechSynthesis is not available", () => {
      const { result } = renderHook(() => useVoiceOutput());
      expect(result.current.supported).toBe(false);
    });

    it("should speak and stop with mocked speechSynthesis", () => {
      const mockUtterance = {
        onstart: null as any,
        onend: null as any,
        onerror: null as any,
      };
      const mockSynthesis = {
        cancel: vi.fn(),
        speak: vi.fn(),
        getVoices: vi.fn().mockReturnValue([]),
      };
      Object.defineProperty(window, "speechSynthesis", {
        value: mockSynthesis,
        writable: true,
        configurable: true,
      });
      const originalSpeechSynthesisUtterance = window.SpeechSynthesisUtterance;
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: function() { return mockUtterance; },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useVoiceOutput());
      expect(result.current.supported).toBe(true);

      act(() => {
        result.current.speak("Hello world");
      });
      expect(mockSynthesis.cancel).toHaveBeenCalled();
      expect(mockSynthesis.speak).toHaveBeenCalled();

      act(() => {
        result.current.stop();
      });
      expect(mockSynthesis.cancel).toHaveBeenCalledTimes(2);

      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: originalSpeechSynthesisUtterance,
        writable: true,
        configurable: true,
      });
      delete (window as any).speechSynthesis;
    });
  });

  describe("useVoices", () => {
    it("should return empty array when speechSynthesis is not available", () => {
      const { result } = renderHook(() => useVoices());
      expect(result.current).toEqual([]);
    });
  });
});
