/**
 * W-U402 (U40-2, point 5; owner decision Round 20, alternative C) -- the value check of docker-compose.prod.yml's
 * mandatory acknowledgement.
 *
 * docker-compose.prod.yml passes `MILJOBESLUT_PROD_COMPOSE_ACK: ${MILJOBESLUT_PROD_COMPOSE_ACK:?…}` to the app, so a
 * missing or empty acknowledgement already stops compose from rendering the file. A WRONG value (anything but the exact
 * text below) cannot be caught by compose interpolation; it is caught here, in the app process's first import
 * (server/loadEnvFirst.ts), before any env file is read and before any module that can reach the database is evaluated.
 *
 * Present with any other value -- also empty, padded or in another case: nothing is trimmed or normalized -> refuse
 * (REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT). Absent -> the process was not started by that file: nothing to check.
 * The refusal names the variable and the expected text, never the value it got.
 *
 * Side-effect free and dependency free.
 */

export const PROD_COMPOSE_ACK_ENV = 'MILJOBESLUT_PROD_COMPOSE_ACK' as const;

/** The exact acknowledgement: the operator states that the database given to this file is not the shared live one. */
export const PROD_COMPOSE_ACK_VALUE = 'not-the-shared-live-database' as const;

export const REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT = 'REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT' as const;

export class ProdComposeAcknowledgementError extends Error {
  readonly code = REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT;

  constructor() {
    super(
      `${REJECT_PROD_COMPOSE_ACKNOWLEDGEMENT}: ${PROD_COMPOSE_ACK_ENV} is set but is not exactly ` +
        `'${PROD_COMPOSE_ACK_VALUE}' (docker-compose.prod.yml must never run against the shared/live database; ` +
        'the process refuses to start before it reads an env file or reaches a database)',
    );
    this.name = 'ProdComposeAcknowledgementError';
  }
}

export function assertProdComposeAcknowledgement(env: Readonly<Record<string, string | undefined>>): void {
  const value = env[PROD_COMPOSE_ACK_ENV];
  if (value === undefined) return;
  if (value !== PROD_COMPOSE_ACK_VALUE) throw new ProdComposeAcknowledgementError();
}
