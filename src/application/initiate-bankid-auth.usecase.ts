import crypto from 'node:crypto';
import { IBankIdProvider, BankIdAuthResponse } from '../domain/auth';

export interface InitiateBankIdAuthInput {
  endUserIp: string;
  personalNumber?: string;
}

export interface InitiateBankIdAuthOutput extends BankIdAuthResponse {
  orderTime: string;
  qrPayload: string;
}

export class InitiateBankIdAuthUseCase {
  constructor(private bankIdProvider: IBankIdProvider) {}

  async execute(input: InitiateBankIdAuthInput): Promise<InitiateBankIdAuthOutput> {
    const orderTime = new Date();
    const order = await this.bankIdProvider.initiateAuth(input.endUserIp, {
      personalNumber: input.personalNumber,
    });

    const qrPayload = this.generateAnimatedQrPayload({
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      orderTime,
    });

    return {
      ...order,
      orderTime: orderTime.toISOString(),
      qrPayload,
    };
  }

  private generateAnimatedQrPayload(input: {
    qrStartToken: string;
    qrStartSecret: string;
    orderTime: Date;
  }): string {
    const current = new Date();
    const elapsedSeconds = Math.max(0, Math.floor((current.getTime() - input.orderTime.getTime()) / 1000));
    const authCode = crypto
      .createHmac('sha256', input.qrStartSecret)
      .update(String(elapsedSeconds))
      .digest('hex');
    return `bankid.${input.qrStartToken}.${elapsedSeconds}.${authCode}`;
  }
}
