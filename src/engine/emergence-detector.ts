/**
 * Emergence Detector
 *
 * Detects emergent behaviors in generated Skill ecosystems:
 * - Unexpected chains: generated Skill invokes another generated Skill not anticipated
 * - Self-reference loops: indirect self-invocation through intermediate Skills
 * - Capability escalation: sub-Skill tries to use capabilities beyond parent's
 * - Resource spikes: sudden change in call frequency/error rate of generated Skill clusters
 */
import { log } from "../utils/logger.js";

export interface EmergencePattern {
  type: 'unexpected_chain' | 'self_reference_loop' | 'capability_escalation' | 'resource_spike';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  involvedSkills: string[];
  detectedAt: number;
}

interface CallRecord {
  timestamp: number;
  callStack: string[];
  depth: number;
  success: boolean;
  duration: number;
}

interface ErrorRateWindow {
  windowStart: number;
  totalCalls: number;
  failedCalls: number;
}

const MAX_CALL_HISTORY = 200;
const ERROR_RATE_WINDOW_MS = 60_000; // 1 minute
const SPIKE_THRESHOLD = 3.0; // 3x normal rate
const ERROR_RATE_THRESHOLD = 0.5; // 50% error rate triggers warning

export class EmergenceDetector {
  private callHistory = new Map<string, CallRecord[]>();
  private errorRateWindows = new Map<string, ErrorRateWindow[]>();
  private generatedSkills = new Set<string>();
  private patterns: EmergencePattern[] = [];
  private skillCapabilities = new Map<string, string[]>();

  /**
   * Record a skill execution and check for emergent patterns.
   */
  record(
    skillName: string,
    context: {
      callStack: string[];
      depth: number;
      success: boolean;
      duration: number;
      generatedSkills?: Set<string>;
      skillCapabilities?: Map<string, string[]>;
    },
  ): void {
    const now = Date.now();

    // Update known generated skills if provided
    if (context.generatedSkills) {
      for (const s of context.generatedSkills) {
        this.generatedSkills.add(s);
      }
    }

    // Update known capabilities if provided
    if (context.skillCapabilities) {
      for (const [name, caps] of context.skillCapabilities) {
        this.skillCapabilities.set(name, caps);
      }
    }

    // Store call record
    const record: CallRecord = {
      timestamp: now,
      callStack: [...context.callStack],
      depth: context.depth,
      success: context.success,
      duration: context.duration,
    };

    if (!this.callHistory.has(skillName)) {
      this.callHistory.set(skillName, []);
    }
    const history = this.callHistory.get(skillName)!;
    history.push(record);
    if (history.length > MAX_CALL_HISTORY) {
      history.splice(0, history.length - MAX_CALL_HISTORY);
    }

    // Update error rate window
    this.updateErrorRateWindow(skillName, now, context.success);

    // Run detection strategies
    this.detectUnexpectedChain(skillName, context.callStack, now);
    this.detectSelfReferenceLoop(skillName, context.callStack, now);
    this.detectCapabilityEscalation(skillName, context.callStack, now);
    this.detectResourceSpike(skillName, now);
  }

  /**
   * Get detected patterns with optional filters.
   */
  getPatterns(options?: { since?: number; severity?: string; type?: string }): EmergencePattern[] {
    let result = [...this.patterns];
    if (options?.since != null) {
      result = result.filter((p) => p.detectedAt >= options.since!);
    }
    if (options?.severity != null) {
      result = result.filter((p) => p.severity === options.severity);
    }
    if (options?.type != null) {
      result = result.filter((p) => p.type === options.type);
    }
    return result;
  }

  /**
   * Get a summary report of all detected patterns.
   */
  getReport(): {
    totalPatterns: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    recentPatterns: EmergencePattern[];
  } {
    const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
    const byType: Record<string, number> = {};

    for (const p of this.patterns) {
      bySeverity[p.severity] = (bySeverity[p.severity] ?? 0) + 1;
      byType[p.type] = (byType[p.type] ?? 0) + 1;
    }

    // Last 10 patterns
    const recentPatterns = this.patterns.slice(-10);

    return {
      totalPatterns: this.patterns.length,
      bySeverity,
      byType,
      recentPatterns,
    };
  }

  /**
   * Clear all detected patterns.
   */
  clearPatterns(): void {
    this.patterns = [];
  }

  // --- Detection strategies ---

  private detectUnexpectedChain(skillName: string, callStack: string[], now: number): void {
    // Check if this generated skill was invoked by another generated skill
    if (!this.generatedSkills.has(skillName)) return;

    // Look for a generated caller in the call stack (not the skill itself)
    const callers = callStack.filter((s) => s !== skillName);
    const generatedCallers = callers.filter((s) => this.generatedSkills.has(s));

    if (generatedCallers.length > 0) {
      const involved = [...generatedCallers, skillName];
      // Avoid duplicate detections for the same pair within 10 seconds
      const recent = this.patterns.find(
        (p) =>
          p.type === 'unexpected_chain' &&
          p.detectedAt > now - 10_000 &&
          p.involvedSkills.includes(skillName) &&
          p.involvedSkills.some((s) => generatedCallers.includes(s)),
      );
      if (!recent) {
        const pattern: EmergencePattern = {
          type: 'unexpected_chain',
          severity: 'warning',
          description: `Generated skill "${skillName}" was invoked by generated skill(s): ${generatedCallers.join(', ')}`,
          involvedSkills: involved,
          detectedAt: now,
        };
        this.patterns.push(pattern);
        log("warn", "emergence.unexpected_chain", {
          skillName,
          generatedCallers,
        });
      }
    }
  }

  private detectSelfReferenceLoop(skillName: string, callStack: string[], now: number): void {
    // Check if skillName appears more than once in the call stack (indirect self-invocation)
    const occurrences = callStack.filter((s) => s === skillName).length;
    if (occurrences >= 2) {
      // Find intermediary skills between the two occurrences
      const firstIdx = callStack.indexOf(skillName);
      const lastIdx = callStack.lastIndexOf(skillName);
      const intermediaries = callStack.slice(firstIdx + 1, lastIdx);

      const pattern: EmergencePattern = {
        type: 'self_reference_loop',
        severity: 'critical',
        description: `Skill "${skillName}" indirectly invokes itself through: ${intermediaries.join(' -> ') || 'direct recursion'}`,
        involvedSkills: [skillName, ...intermediaries],
        detectedAt: now,
      };
      this.patterns.push(pattern);
      log("error", "emergence.self_reference_loop", {
        skillName,
        intermediaries,
      });
    }
  }

  private detectCapabilityEscalation(skillName: string, callStack: string[], now: number): void {
    // Check if the current skill uses capabilities beyond its parent's declared capabilities
    if (callStack.length < 2) return;

    const parentName = callStack[callStack.length - 2];
    if (!parentName) return;

    const childCaps = this.skillCapabilities.get(skillName) ?? [];
    const parentCaps = this.skillCapabilities.get(parentName) ?? [];

    if (childCaps.length === 0 || parentCaps.length === 0) return;

    const escalatedCaps = childCaps.filter((cap) => !parentCaps.some((pCap) => capabilityCovers(pCap, cap)));

    if (escalatedCaps.length > 0) {
      // Avoid duplicate detections within 10 seconds
      const recent = this.patterns.find(
        (p) =>
          p.type === 'capability_escalation' &&
          p.detectedAt > now - 10_000 &&
          p.involvedSkills.includes(skillName) &&
          p.involvedSkills.includes(parentName),
      );
      if (!recent) {
        const pattern: EmergencePattern = {
          type: 'capability_escalation',
          severity: 'critical',
          description: `Skill "${skillName}" uses capabilities [${escalatedCaps.join(', ')}] beyond parent "${parentName}"'s [${parentCaps.join(', ')}]`,
          involvedSkills: [parentName, skillName],
          detectedAt: now,
        };
        this.patterns.push(pattern);
        log("error", "emergence.capability_escalation", {
          skillName,
          parentName,
          escalatedCaps,
        });
      }
    }
  }

  private detectResourceSpike(skillName: string, now: number): void {
    if (!this.generatedSkills.has(skillName)) return;

    const windows = this.errorRateWindows.get(skillName);
    if (!windows || windows.length < 2) return;

    const currentWindow = windows[windows.length - 1];
    const previousWindows = windows.slice(0, -1);

    // Check for call frequency spike
    const avgCalls = previousWindows.reduce((sum, w) => sum + w.totalCalls, 0) / previousWindows.length;
    if (avgCalls > 0 && currentWindow.totalCalls > avgCalls * SPIKE_THRESHOLD && currentWindow.totalCalls >= 5) {
      const recent = this.patterns.find(
        (p) =>
          p.type === 'resource_spike' &&
          p.detectedAt > now - ERROR_RATE_WINDOW_MS &&
          p.involvedSkills.includes(skillName) &&
          p.description.includes('call frequency'),
      );
      if (!recent) {
        const pattern: EmergencePattern = {
          type: 'resource_spike',
          severity: 'warning',
          description: `Generated skill "${skillName}" call frequency spiked: ${currentWindow.totalCalls} calls vs average ${avgCalls.toFixed(1)}`,
          involvedSkills: [skillName],
          detectedAt: now,
        };
        this.patterns.push(pattern);
        log("warn", "emergence.resource_spike", {
          skillName,
          currentCalls: currentWindow.totalCalls,
          avgCalls,
        });
      }
    }

    // Check for error rate spike
    if (currentWindow.totalCalls >= 3) {
      const errorRate = currentWindow.failedCalls / currentWindow.totalCalls;
      if (errorRate >= ERROR_RATE_THRESHOLD) {
        const recent = this.patterns.find(
          (p) =>
            p.type === 'resource_spike' &&
            p.detectedAt > now - ERROR_RATE_WINDOW_MS &&
            p.involvedSkills.includes(skillName) &&
            p.description.includes('error rate'),
        );
        if (!recent) {
          const pattern: EmergencePattern = {
            type: 'resource_spike',
            severity: 'warning',
            description: `Generated skill "${skillName}" error rate spiked: ${(errorRate * 100).toFixed(1)}% (${currentWindow.failedCalls}/${currentWindow.totalCalls})`,
            involvedSkills: [skillName],
            detectedAt: now,
          };
          this.patterns.push(pattern);
          log("warn", "emergence.error_rate_spike", {
            skillName,
            errorRate,
            failed: currentWindow.failedCalls,
            total: currentWindow.totalCalls,
          });
        }
      }
    }
  }

  private updateErrorRateWindow(skillName: string, now: number, success: boolean): void {
    if (!this.errorRateWindows.has(skillName)) {
      this.errorRateWindows.set(skillName, []);
    }
    const windows = this.errorRateWindows.get(skillName)!;

    // Get or create current window
    let currentWindow = windows[windows.length - 1];
    if (!currentWindow || now - currentWindow.windowStart >= ERROR_RATE_WINDOW_MS) {
      currentWindow = { windowStart: now, totalCalls: 0, failedCalls: 0 };
      windows.push(currentWindow);
      // Keep at most 10 windows
      if (windows.length > 10) {
        windows.splice(0, windows.length - 10);
      }
    }

    currentWindow.totalCalls++;
    if (!success) {
      currentWindow.failedCalls++;
    }
  }
}

/**
 * Check if a parent capability covers a child capability.
 * E.g., "network:outbound:*" covers "network:outbound:https"
 */
function capabilityCovers(parentCap: string, childCap: string): boolean {
  if (parentCap === childCap) return true;
  if (parentCap === '*') return true;

  const parentParts = parentCap.split(':');
  const childParts = childCap.split(':');

  for (let i = 0; i < parentParts.length; i++) {
    if (parentParts[i] === '*') return true;
    if (parentParts[i] !== childParts[i]) return false;
  }

  return parentParts.length <= childParts.length;
}
