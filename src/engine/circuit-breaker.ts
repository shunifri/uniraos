import type { CircuitBreakerConfig } from "../types/index.js";
import { CircuitState } from "../types/index.js";

interface CircuitInfo {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  halfOpenSuccesses: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  slowCalls: number;
  lastStateChange: number;
}

export class CircuitBreakerManager {
  private circuits = new Map<string, CircuitInfo>();

  check(skillName: string, config?: CircuitBreakerConfig): void {
    if (!config) return;

    const circuit = this.getOrCreate(skillName);

    if (circuit.state === CircuitState.OPEN) {
      const elapsed = Date.now() - circuit.lastFailureTime;
      if (elapsed >= config.recoveryTimeMs) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.halfOpenSuccesses = 0;
      } else {
        throw new CircuitOpenError(skillName, config.recoveryTimeMs - elapsed);
      }
    }
  }

  recordSuccess(skillName: string, config?: CircuitBreakerConfig, latencyMs?: number): void {
    if (!config) return;

    const circuit = this.getOrCreate(skillName);
    circuit.consecutiveFailures = 0;
    circuit.totalRequests++;
    circuit.totalSuccesses++;

    // P2 修复：慢调用熔断（latency-based）
    if (config.slowCallThresholdMs && latencyMs !== undefined && latencyMs > config.slowCallThresholdMs) {
      circuit.slowCalls++;
    }

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.halfOpenSuccesses++;
      if (circuit.halfOpenSuccesses >= config.halfOpenRequests) {
        circuit.state = CircuitState.CLOSED;
        circuit.lastStateChange = Date.now();
      }
    }

    // P2 修复：基于成功率的熔断恢复（如果成功率恢复到可接受水平）
    if (circuit.state === CircuitState.OPEN) {
      const successRate = circuit.totalRequests > 0 ? circuit.totalSuccesses / circuit.totalRequests : 0;
      if (successRate >= 0.95 && circuit.totalRequests >= 20) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.halfOpenSuccesses = 0;
      }
    }
  }

  recordFailure(skillName: string, config?: CircuitBreakerConfig, latencyMs?: number): void {
    if (!config) return;

    const circuit = this.getOrCreate(skillName);
    circuit.consecutiveFailures++;
    circuit.lastFailureTime = Date.now();
    circuit.totalRequests++;
    circuit.totalFailures++;

    if (latencyMs !== undefined && config.slowCallThresholdMs && latencyMs > config.slowCallThresholdMs) {
      circuit.slowCalls++;
    }

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
      circuit.lastStateChange = Date.now();
    } else if (circuit.consecutiveFailures >= config.failureThreshold) {
      circuit.state = CircuitState.OPEN;
      circuit.lastStateChange = Date.now();
    }
  }

  getState(skillName: string): CircuitState {
    return this.getOrCreate(skillName).state;
  }

  /** P2 修复：暴露熔断器统计信息用于 metrics */
  getStats(skillName: string): Pick<CircuitInfo, 'state' | 'totalRequests' | 'totalFailures' | 'totalSuccesses' | 'slowCalls' | 'consecutiveFailures'> | null {
    const c = this.circuits.get(skillName);
    if (!c) return null;
    return {
      state: c.state,
      totalRequests: c.totalRequests,
      totalFailures: c.totalFailures,
      totalSuccesses: c.totalSuccesses,
      slowCalls: c.slowCalls,
      consecutiveFailures: c.consecutiveFailures,
    };
  }

  private getOrCreate(skillName: string): CircuitInfo {
    let circuit = this.circuits.get(skillName);
    if (!circuit) {
      circuit = {
        state: CircuitState.CLOSED,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        halfOpenSuccesses: 0,
        totalRequests: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        slowCalls: 0,
        lastStateChange: 0,
      };
      this.circuits.set(skillName, circuit);
    }
    return circuit;
  }
}

export class CircuitOpenError extends Error {
  constructor(skillName: string, remainingMs: number) {
    super(`Circuit breaker OPEN for "${skillName}", retry after ${Math.ceil(remainingMs)}ms`);
    this.name = "CircuitOpenError";
  }
}
