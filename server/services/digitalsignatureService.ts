/**
 * Digital Signature Service
 * Handles BankID integration for signing critical sewage application gates
 * Handles BankID integration for signing critical sewage application gates // Corrected comment
 *
 * Gates requiring signature:
 * 1. Application submission (applicant confirms all data correct)
 * 2. Soil test results (if applicable)
 * 3. Municipal decision acceptance
 *
 */

import crypto from 'node:crypto';
import type { SewageApplication } from '../../types';
import { logger } from '../logger';
import { initiateBankIdSign, collectBankIdSign } from './bankIdService';
import { SecureError } from '../security/secureErrors';

// HD-16 (A9 sweep, 2026-09-29): binds each BankID orderRef to the exact referenceNumber and
// documentHash it was initiated for. completeBankIDSignature used to accept a caller-supplied
// documentHash with no check against what was actually shown to the user in the BankID app
// (userVisibleData at initiate time) — a genuine BankID "complete" could be recorded as a valid
// signature for a different document than the one the user approved. In-memory only, same class
// of gap as recordSignatureAction's own persistence-deferred note below; a real store (keyed by
// orderRef, with TTL/eviction) is separate future work, not this fix.
const orderRefBindings = new Map<string, { referenceNumber: string; documentHash: string; createdAt: number }>();

/** Route-level use only (e.g. tenant-scoping GET /signatures/:orderRef/status, HD-15). */
export function getOrderRefBinding(orderRef: string): { referenceNumber: string; documentHash: string } | undefined {
  const binding = orderRefBindings.get(orderRef);
  return binding ? { referenceNumber: binding.referenceNumber, documentHash: binding.documentHash } : undefined;
}

/** Test-only escape hatch. */
export function __clearOrderRefBindingsForTests(): void {
  orderRefBindings.clear();
}
// ============================================================================
// DIGITAL SIGNATURE TYPES
// ============================================================================

export interface SignatureRequest {
  referenceNumber: string;
  documentId: string;
  documentHash: string; // SHA256 of document content
  signatureType: 'BANKID' | 'E_SIGNATURE';
  reason: 'APPLICATION_SUBMISSION' | 'SOIL_TEST_VERIFICATION' | 'DECISION_ACCEPTANCE';
  userPersonalNumber?: string;
}

export interface BankIDSignature {
  id: string;
  referenceNumber: string;
  signatureType: 'BANKID';
  orderRef: string;
  status: 'pending' | 'complete' | 'failed';
  personalNumber: string;
  givenName?: string;
  surname?: string;
  documentHash: string;
  signatureData?: string; // Base64 encoded signature
  signatureTime: string; // ISO 8601
  deviceIpAddress?: string;
  reason: string;
  createdAt: string;
  completedAt?: string;
}

export interface DigitalSignature {
  id: string;
  referenceNumber: string;
  documentId: string;
  documentHash: string;
  signatureType: 'BANKID' | 'E_SIGNATURE';
  reason: string;
  signedBy: string; // Personal number or user ID
  signedAt: string; // ISO 8601
  signatureData: string; // Base64 encoded
  verified: boolean;
  verificationCode?: string;
  chainOfCustody: Array<{
    timestamp: string;
    action: 'CREATED' | 'SIGNED' | 'VERIFIED' | 'VALIDATED';
    actor: string;
  }>;
}

// ============================================================================
// BANKID SIGNATURE ORCHESTRATION
// ============================================================================

/**
 * Initiate BankID signature request for application submission
 * Returns orderRef and autoStartToken for client-side BankID app
 */
export async function initiateBankIDSignature(
  referenceNumber: string,
  documentId: string,
  documentContent: string,
  endUserIp: string,
  _userPersonalNumber?: string,
): Promise<{
  orderRef: string;
  autoStartToken: string;
  qrStartToken?: string;
  message: string;
}> {
  try {
    const documentHash = hashDocument(documentContent);

    logger.info('Initiating BankID signature request', {
      referenceNumber,
      documentId,
      documentHash: documentHash.substring(0, 16) + '...',
    });

    // Call actual BankID service with nonce support for anti-replay
    const response = await initiateBankIdSign({
      endUserIp,
      userVisibleData: `Jag godkänner ansökan för ${referenceNumber}. Dokument-hash: ${documentHash}`,
    });

    // HD-16: bind this orderRef to exactly the document/reference the user was shown, so
    // completeBankIDSignature can refuse a mismatched or unbound completion instead of trusting
    // whatever documentHash the caller later supplies.
    orderRefBindings.set(response.orderRef, { referenceNumber, documentHash, createdAt: Date.now() });

    return {
      orderRef: response.orderRef,
      autoStartToken: response.autoStartToken,
      qrStartToken: response.qrStartToken,
      message: 'Signaturöversikt skickat. Öppna BankID-appen för att godkänna.',
    };
  } catch (error) {
    logger.error('Error initiating BankID signature', { error });
    throw error;
  }
}

/**
 * Complete BankID signature after user has signed in BankID app
 */
export async function completeBankIDSignature(
  orderRef: string,
  documentHash: string,
  referenceNumber: string,
  endUserIp: string,
): Promise<DigitalSignature> {
  try {
    // HD-16: fail closed if this orderRef was never initiated here, or was initiated for a
    // different document/reference than the caller now claims — a real "complete" from BankID
    // says the user approved *something*, but not provably this exact documentHash/referenceNumber
    // unless we checked what they were actually shown at initiate time.
    const binding = orderRefBindings.get(orderRef);
    if (!binding) {
      throw new SecureError(
        `completeBankIDSignature: no initiate-time binding found for orderRef ${orderRef}`,
        'Signaturen kunde inte verifieras: ingen matchande signeringsbegäran hittades.',
        409,
        'SIGNATURE_BINDING_NOT_FOUND',
      );
    }
    if (binding.documentHash !== documentHash || binding.referenceNumber !== referenceNumber) {
      logger.warn('BankID signature completion rejected: document/reference mismatch', {
        orderRef,
        expectedReferenceNumber: binding.referenceNumber,
        claimedReferenceNumber: referenceNumber,
      });
      throw new SecureError(
        `completeBankIDSignature: documentHash/referenceNumber mismatch for orderRef ${orderRef}`,
        'Signaturen kunde inte verifieras: dokumentet eller ärendet matchar inte signeringsbegäran.',
        409,
        'SIGNATURE_BINDING_MISMATCH',
      );
    }

    // Call BankID collect with anti-replay checks
    const response = await collectBankIdSign(orderRef, endUserIp);

    if (response.status !== 'complete') {
      throw new Error(
        `BankID signature not complete: ${response.status} (${response.hintCode || 'no hint'})`,
      );
    }

    const completionData = response.completionData!;

    const signature: DigitalSignature = {
      id: `sig-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      referenceNumber,
      documentId: `doc-${Date.now()}`,
      documentHash,
      signatureType: 'BANKID',
      reason: 'APPLICATION_SUBMISSION',
      signedBy: completionData.user.personalNumber,
      signedAt: new Date().toISOString(),
      signatureData: completionData.signature,
      verified: true,
      chainOfCustody: [
        {
          timestamp: new Date().toISOString(),
          action: 'SIGNED',
          actor: completionData.user.personalNumber,
        },
      ],
    };

    orderRefBindings.delete(orderRef);

    // HD-16: this signature is NOT persisted here (no DB write below) — recordSignatureAction's
    // own log already says so ("not persisted"). The previous "completed and persisted" message
    // contradicted that and overstated durability to anyone reading the logs.
    logger.info('BankID signature completed (not yet persisted — see recordSignatureAction)', {
      signatureId: signature.id,
      referenceNumber,
      documentHash: documentHash.substring(0, 16) + '...',
    });

    return signature;
  } catch (error) {
    logger.error('Error completing BankID signature', { error });
    throw error;
  }
}

/**
 * Complete BankID signature after user has signed in BankID app
 */
export async function completeBankIDSignature_DEPRECATED(
  orderRef: string,
  documentHash: string,
  referenceNumber: string,
  endUserIp: string,
): Promise<DigitalSignature> {
  try {
    // Call BankID collect with anti-replay checks
    const response = await collectBankIdSign(orderRef, endUserIp);

    if (response.status !== 'complete') {
      throw new Error(
        `BankID signature not complete: ${response.status} (${response.hintCode || 'no hint'})`,
      );
    }

    const completionData = response.completionData!;

    const signature: DigitalSignature = {
      id: `sig-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      referenceNumber,
      documentId: `doc-${Date.now()}`,
      documentHash,
      signatureType: 'BANKID',
      reason: 'APPLICATION_SUBMISSION',
      signedBy: completionData.user.personalNumber,
      signedAt: new Date().toISOString(),
      signatureData: completionData.signature,
      verified: true,
      chainOfCustody: [
        {
          timestamp: new Date().toISOString(),
          action: 'SIGNED',
          actor: completionData.user.personalNumber,
        },
      ],
    };
    return signature;
  } catch (error) {
    logger.error('Error completing BankID signature', { error });
    throw error;
  }
}

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

/**
 * Verify that a document matches its signature
 * Used to ensure integrity of signed documents
 */
export async function verifySignature(
  signature: DigitalSignature,
  documentContent: string,
): Promise<{
  valid: boolean;
  reason?: string;
  verificationTime: string;
}> {
  const currentDocumentHash = hashDocument(documentContent);

  if (currentDocumentHash !== signature.documentHash) {
    logger.warn('Signature verification failed: document mismatch', {
      signatureId: signature.id,
      expectedHash: signature.documentHash.substring(0, 16) + '...',
      currentHash: currentDocumentHash.substring(0, 16) + '...',
    });

    return {
      valid: false,
      reason: 'Document har ändrats sedan signering',
      verificationTime: new Date().toISOString(),
    };
  }

  logger.info('Signature verified successfully', {
    signatureId: signature.id,
    documentHash: signature.documentHash.substring(0, 16) + '...',
  });

  return {
    valid: true,
    verificationTime: new Date().toISOString(),
  };
}

// ============================================================================
// SIGNATURE CHAIN OF CUSTODY
// ============================================================================

export async function recordSignatureAction(
  signature: DigitalSignature,
  action: 'CREATED' | 'SIGNED' | 'VERIFIED' | 'VALIDATED',
  actor: string,
): Promise<DigitalSignature> {
  signature.chainOfCustody.push({
    timestamp: new Date().toISOString(),
    action,
    actor,
  });

  logger.info('Signature chain of custody updated', {
    signatureId: signature.id,
    action,
    actor,
    chainLength: signature.chainOfCustody.length,
  });

  // Chain-of-custody persistence deferred until DigitalSignature table is migrated.
  logger.warn('Updated signature chain-of-custody not persisted', {
    signatureId: signature.id,
    action,
  });

  return signature;
}

// ============================================================================
// DOCUMENT HASH CALCULATION
// ============================================================================

function hashDocument(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate verifiable hash of application data for signing
 * Includes all critical fields that must not change after signature
 */
export function generateApplicationSignatureHash(application: SewageApplication): string {
  const signableData = {
    referenceNumber: `AVLOPP-${application.id}`,
    propertyDesignation: application.propertyDesignation,
    pe: application.pe,
    selectedSystemType: application.selectedSystemType,
    status: application.status,
    submittedDate: application.submittedDate,
  };

  return hashDocument(JSON.stringify(signableData));
}

// ============================================================================
// BATCH SIGNATURE VERIFICATION
// ============================================================================

export async function verifyAllSignaturesForApplication(referenceNumber: string): Promise<{
  applicationSignatureValid: boolean;
  soilTestSignatureValid?: boolean;
  decisionAcceptanceSignatureValid?: boolean;
  allSignaturesValid: boolean;
  verificationDetails: Array<{
    reason: string;
    valid: boolean;
    timestamp: string;
  }>;
}> {
  const verificationDetails = [
    {
      reason: `Ingen verifierad signaturkälla är konfigurerad för ${referenceNumber}`,
      valid: false,
      timestamp: new Date().toISOString(),
    },
  ];

  return {
    applicationSignatureValid: false,
    allSignaturesValid: false,
    verificationDetails,
  };
}

// ============================================================================
// SIGNATURE STATUS ENDPOINT (FOR CLIENT POLLING)
// ============================================================================

export async function checkSignatureStatus(
  orderRef: string,
  endUserIp: string,
): Promise<{
  orderRef: string;
  status: 'pending' | 'complete' | 'failed';
  signatureId?: string;
  hintCode?: string;
  message: string;
}> {
  // Use collectBankIdSign which includes anti-replay checks
  const response = await collectBankIdSign(orderRef, endUserIp);

  return {
    orderRef: response.orderRef,
    status: response.status,
    signatureId: response.status === 'complete' ? `sig-${Date.now()}` : undefined,
    hintCode: response.hintCode,
    message: response.status === 'complete' ? 'Signering genomförd' : 'Signering pågår',
  };
}
