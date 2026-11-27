import type { ProviderStatus } from "./domain/state";

export const simulatorScenarios = [
  "success",
  "decline",
  "delayed_success",
  "duplicate_notification",
  "out_of_order",
  "timeout",
  "unavailable",
] as const;
export type SimulatorScenario = (typeof simulatorScenarios)[number];

export type ProviderPayment = Readonly<{
  providerReference: string;
  merchantReference: string;
  status: ProviderStatus;
  amountMinor: number;
  currency: string;
  failureCode?: string;
}>;

export type CreatePaymentRequest = Readonly<{
  /** Our payment attempt id; the provider echoes it back in every notification. */
  merchantReference: string;
  amountMinor: number;
  currency: string;
  scenario: SimulatorScenario;
}>;

/** The provider definitely did not process the request; safe to mark the attempt failed and retry. */
export class ProviderUnavailableError extends Error {
  constructor() {
    super("Payment provider unavailable");
    this.name = "ProviderUnavailableError";
  }
}

/** The request may or may not have been processed; the attempt must be reconciled. */
export class ProviderTimeoutError extends Error {
  constructor() {
    super("Payment provider timed out");
    this.name = "ProviderTimeoutError";
  }
}

export interface PaymentProvider {
  readonly name: "simulator";
  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment>;
  getPayment(merchantReference: string): Promise<ProviderPayment | null>;
  refund(providerReference: string): Promise<void>;
}
