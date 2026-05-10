import { describe, it, expect, beforeEach } from "vitest";
import { useVoiceStore } from "./voice-store";

describe("useVoiceStore (P3)", () => {
  beforeEach(() => {
    useVoiceStore.setState({
      voiceInputEnabled: true,
      voiceOutputEnabled: true,
      autoPlay: false,
      voiceURI: null,
      rate: 1,
      pitch: 1,
    });
  });

  it("should have correct default state", () => {
    const state = useVoiceStore.getState();
    expect(state.voiceInputEnabled).toBe(true);
    expect(state.voiceOutputEnabled).toBe(true);
    expect(state.autoPlay).toBe(false);
    expect(state.voiceURI).toBeNull();
    expect(state.rate).toBe(1);
    expect(state.pitch).toBe(1);
  });

  it("should toggle voice input", () => {
    useVoiceStore.getState().setVoiceInputEnabled(false);
    expect(useVoiceStore.getState().voiceInputEnabled).toBe(false);
  });

  it("should toggle voice output", () => {
    useVoiceStore.getState().setVoiceOutputEnabled(false);
    expect(useVoiceStore.getState().voiceOutputEnabled).toBe(false);
  });

  it("should toggle auto play", () => {
    useVoiceStore.getState().setAutoPlay(true);
    expect(useVoiceStore.getState().autoPlay).toBe(true);
  });

  it("should set voice URI", () => {
    useVoiceStore.getState().setVoiceURI("voice-1");
    expect(useVoiceStore.getState().voiceURI).toBe("voice-1");
  });

  it("should set rate", () => {
    useVoiceStore.getState().setRate(1.5);
    expect(useVoiceStore.getState().rate).toBe(1.5);
  });

  it("should set pitch", () => {
    useVoiceStore.getState().setPitch(0.8);
    expect(useVoiceStore.getState().pitch).toBe(0.8);
  });
});
