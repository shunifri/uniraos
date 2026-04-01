import type { CircuitBreakerConfig } from "../types/index.js";
import { CircuitState } from "../types/index.js";

interface CircuitInfo {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  halfOpenSuccesses: number;
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

  recordSuccess(skillName: string, config?: CircuitBreakerConfig): void {
    if (!config) return;

    const circuit = this.getOrCreate(skillName);
    circuit.consecutiveFailures = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.halfOpenSuccesses++;
      if (circuit.halfOpenSuccesses >= config.halfOpenRequests) {
        circuit.state = CircuitState.CLOSED;
      }
    }
  }

  recordFailure(skillName: string, config?: CircuitBreakerConfig): void {
    if (!config) return;

    const circuit = this.getOrCreate(skillName);
    circuit.consecutiveFailures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
    } else if (circuit.consecutiveFailures >= config.failureThreshold) {
      circuit.state = CircuitState.OPEN;
    }
  }

  getState(skillName: string): CircuitState {
    return this.getOrCreate(skillName).state;
  }

  private getOrCreate(skillName: string): CircuitInfo {
    let circuit = this.circuits.get(skillName);
    if (!circuit) {
      circuit = {
        state: CircuitState.CLOSED,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        halfOpenSuccesses: 0,
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
