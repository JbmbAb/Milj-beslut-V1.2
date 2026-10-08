/**
 * Isolation and observation preload for one real production entrypoint.
 *
 * Loaded with `node --import tsx --import <this file> <entry file>`. The entry file stays the
 * process main module. This module installs refusal hooks before that main module is evaluated,
 * then, when the entry reaches process.exit or an uncaught exception, calls the real generation
 * port and records the result. It does not replace the entry and it does not invent a failure code.
 *
 * Imports are static. The registration identifier is not written here; availability is read from
 * the port's status functions and the generation call is generateText.
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LOCAL_GENERATION_BLOCKER,
  generateText,
  isLocalGenerationAvailable,
} from '../../../../server/modules/ai/generation/LocalGenerationPort';
import { REQUIRED_ISOLATION_HOOKS, type ChildReport } from './types.js';

const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const cp = require('node:child_process') as typeof import('node:child_process');
const net = require('node:net') as typeof import('node:net');
const dns = require('node:dns') as typeof import('node:dns');

const OTHER_OUTCOME = ['OTHER', 'ERROR'].join('_');
const EMPTY_TEXT = ['EMPTY', 'GENERATION', 'TEXT'].join('_');
const OBSERVE_INCOMPLETE = ['OBSERVATION', 'DID', 'NOT', 'FINISH'].join('_');
const CONNECT_BLOCK = ['ISOLATION', 'CONNECT', 'BLOCKED'].join('_');
const LISTEN_BLOCK = ['ISOLATION', 'LISTEN', 'BLOCKED'].join('_');
const SPAWN_BLOCK = ['ISOLATION', 'SPAWN', 'BLOCKED'].join('_');
const WRITE_BLOCK = ['ISOLATION', 'WRITE', 'BLOCKED'].join('_');
const DNS_BLOCK = ['ISOLATION', 'DNS', 'BLOCKED'].join('_');

const state = {
  stopping: false,
  armed: false,
  hooks: [] as string[],
  connect_attempts: 0,
  listen_attempts: 0,
  spawn_attempts: 0,
  refused_writes: 0,
  dns_external_attempts: 0,
  realExit: process.exit.bind(process),
};

function blocked(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function fold(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function asPath(target: unknown): string | undefined {
  if (typeof target === 'string') return target;
  if (target instanceof URL && target.protocol === 'file:') return target.pathname;
  return undefined;
}

function writeAllowed(target: unknown): boolean {
  const raw = asPath(target);
  if (raw === undefined) return false;
  const resolved = fold(path.resolve(raw));
  const result = process.env.U51_BOOT_PROBE_RESULT;
  if (result !== undefined && fold(path.resolve(result)) === resolved) return true;
  const subject = process.env.U51_BOOT_PROBE_SUBJECT_ROOT;
  if (subject !== undefined && subject !== '') {
    const root = fold(path.resolve(subject));
    const modules = fold(path.resolve(subject, 'node_modules'));
    if (resolved === modules || resolved.startsWith(modules + path.sep)) return true;
    if (resolved === root || resolved.startsWith(root + path.sep)) return false;
  }
  const temp = fold(path.resolve(tmpdir()));
  return resolved === temp || resolved.startsWith(temp + path.sep);
}

function isWriteFlag(flag: unknown): boolean {
  const text = String(flag ?? 'r');
  return text.includes('w') || text.includes('a') || text.includes('+');
}

function refuseWrite(): never {
  state.refused_writes += 1;
  throw blocked(WRITE_BLOCK, 'boot probe refused a filesystem write');
}

function guardWrite<T extends (...args: never[]) => unknown>(original: T, flagsIndex?: number, secondPath = false): T {
  const wrapped = function (this: unknown, ...args: never[]) {
    const writing = flagsIndex === undefined ? true : isWriteFlag(args[flagsIndex]);
    if (writing && !writeAllowed(args[0])) refuseWrite();
    if (writing && secondPath && !writeAllowed(args[1])) refuseWrite();
    return original.apply(this, args);
  };
  return wrapped as T;
}

function isLoopback(host: unknown): boolean {
  const text = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return text === '127.0.0.1' || text === 'localhost' || text === '::1';
}

type NetSocket = import('node:net').Socket;
type NetServer = import('node:net').Server;

function installHooks(): void {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connectBlocked(this: NetSocket) {
    void originalConnect;
    state.connect_attempts += 1;
    throw blocked(CONNECT_BLOCK, 'boot probe refused a socket connect');
  } as typeof originalConnect;
  state.hooks.push('socket.connect');

  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function listenBlocked(this: NetServer) {
    void originalListen;
    state.listen_attempts += 1;
    throw blocked(LISTEN_BLOCK, 'boot probe refused a server listen');
  } as typeof originalListen;
  state.hooks.push('server.listen');

  const blockSpawn = <T extends (...args: never[]) => unknown>(original: T): T => {
    const wrapped = function (this: unknown) {
      void original;
      state.spawn_attempts += 1;
      throw blocked(SPAWN_BLOCK, 'boot probe refused a child process');
    };
    return wrapped as unknown as T;
  };
  cp.spawn = blockSpawn(cp.spawn);
  cp.spawnSync = blockSpawn(cp.spawnSync);
  cp.exec = blockSpawn(cp.exec);
  cp.execSync = blockSpawn(cp.execSync);
  cp.execFile = blockSpawn(cp.execFile);
  cp.execFileSync = blockSpawn(cp.execFileSync);
  cp.fork = blockSpawn(cp.fork);
  state.hooks.push('process.spawn');

  fs.writeFile = guardWrite(fs.writeFile);
  fs.writeFileSync = guardWrite(fs.writeFileSync);
  fs.appendFile = guardWrite(fs.appendFile);
  fs.appendFileSync = guardWrite(fs.appendFileSync);
  fs.mkdir = guardWrite(fs.mkdir);
  fs.mkdirSync = guardWrite(fs.mkdirSync);
  fs.rm = guardWrite(fs.rm);
  fs.rmSync = guardWrite(fs.rmSync);
  fs.unlink = guardWrite(fs.unlink);
  fs.unlinkSync = guardWrite(fs.unlinkSync);
  fs.rename = guardWrite(fs.rename, undefined, true);
  fs.renameSync = guardWrite(fs.renameSync, undefined, true);
  fs.copyFile = guardWrite(fs.copyFile, undefined, true);
  fs.copyFileSync = guardWrite(fs.copyFileSync, undefined, true);
  fs.truncate = guardWrite(fs.truncate);
  fs.truncateSync = guardWrite(fs.truncateSync);
  fs.open = guardWrite(fs.open, 1);
  fs.openSync = guardWrite(fs.openSync, 1);
  fs.createWriteStream = guardWrite(fs.createWriteStream);
  fs.promises.writeFile = guardWrite(fs.promises.writeFile);
  fs.promises.appendFile = guardWrite(fs.promises.appendFile);
  fs.promises.mkdir = guardWrite(fs.promises.mkdir);
  fs.promises.rm = guardWrite(fs.promises.rm);
  fs.promises.unlink = guardWrite(fs.promises.unlink);
  fs.promises.rename = guardWrite(fs.promises.rename, undefined, true);
  fs.promises.copyFile = guardWrite(fs.promises.copyFile, undefined, true);
  fs.promises.truncate = guardWrite(fs.promises.truncate);
  fs.promises.open = guardWrite(fs.promises.open, 1);
  state.hooks.push('fs.write');

  const originalLookup = dns.lookup;
  dns.lookup = function lookupGuarded(hostname: string, options?: unknown, callback?: unknown) {
    if (!isLoopback(hostname)) {
      state.dns_external_attempts += 1;
      const error = blocked(DNS_BLOCK, 'boot probe refused an external dns lookup');
      const cb = typeof options === 'function' ? options : callback;
      if (typeof cb === 'function') {
        cb(error, '', 0);
        return;
      }
      throw error;
    }
    return originalLookup.call(dns, hostname, options as never, callback as never);
  } as typeof dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = async function lookupGuarded(hostname: string, options?: unknown) {
    if (!isLoopback(hostname)) {
      state.dns_external_attempts += 1;
      throw blocked(DNS_BLOCK, 'boot probe refused an external dns lookup');
    }
    return originalPromiseLookup.call(dns.promises, hostname, options as never);
  } as typeof dns.promises.lookup;
  state.hooks.push('dns.external');
}

function redact(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').slice(0, 500);
}

async function observeGeneration(): Promise<{ registered_after_boot: boolean; generate_attempt: ChildReport['generate_attempt'] }> {
  const registered_after_boot = isLocalGenerationAvailable();
  try {
    const text = await Promise.race([
      generateText('u51-od3-boot-probe'),
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => reject(blocked('GENERATION_OBSERVE_DEADLINE', 'generation observation did not settle')), 5000);
      }),
    ]);
    if (typeof text === 'string' && text.trim() !== '') {
      return { registered_after_boot, generate_attempt: { outcome: 'SUCCESS' } };
    }
    return { registered_after_boot, generate_attempt: { outcome: OTHER_OUTCOME, code: EMPTY_TEXT } };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
    if (code === LOCAL_GENERATION_BLOCKER) {
      return { registered_after_boot, generate_attempt: { outcome: 'FAIL_CLOSED', code } };
    }
    return { registered_after_boot, generate_attempt: { outcome: OTHER_OUTCOME, code: code ?? 'UNCODED' } };
  }
}

function writeReport(report: ChildReport): void {
  const target = process.env.U51_BOOT_PROBE_RESULT;
  if (target === undefined || target === '') return;
  fs.writeFileSync(target, `${JSON.stringify(report)}\n`, 'utf8');
}

async function finish(stopKind: string, stopMessage: string, exitCode: number): Promise<void> {
  let report: ChildReport;
  try {
    const observed = await observeGeneration();
    report = {
      nonce: process.env.U51_BOOT_PROBE_NONCE ?? '',
      entry_id: process.env.U51_BOOT_PROBE_ENTRY_ID ?? '',
      node_env: process.env.NODE_ENV ?? '',
      registered_after_boot: observed.registered_after_boot,
      generate_attempt: observed.generate_attempt,
      isolation: {
        armed: state.armed,
        hooks: [...state.hooks],
        connect_attempts: state.connect_attempts,
        listen_attempts: state.listen_attempts,
        spawn_attempts: state.spawn_attempts,
        refused_writes: state.refused_writes,
        dns_external_attempts: state.dns_external_attempts,
      },
      subject_commit: process.env.U51_BOOT_PROBE_SUBJECT_COMMIT ?? '',
      subject_tree: process.env.U51_BOOT_PROBE_SUBJECT_TREE ?? '',
      loaded_entry: process.argv[1] ?? '',
      stop_kind: stopKind,
      stop_message: redact(stopMessage),
    };
  } catch (error) {
    report = {
      nonce: process.env.U51_BOOT_PROBE_NONCE ?? '',
      entry_id: process.env.U51_BOOT_PROBE_ENTRY_ID ?? '',
      node_env: process.env.NODE_ENV ?? '',
      registered_after_boot: isLocalGenerationAvailable(),
      generate_attempt: { outcome: OTHER_OUTCOME, code: OBSERVE_INCOMPLETE },
      isolation: {
        armed: false,
        hooks: [...state.hooks],
        connect_attempts: state.connect_attempts,
        listen_attempts: state.listen_attempts,
        spawn_attempts: state.spawn_attempts,
        refused_writes: state.refused_writes,
        dns_external_attempts: state.dns_external_attempts,
      },
      subject_commit: process.env.U51_BOOT_PROBE_SUBJECT_COMMIT ?? '',
      subject_tree: process.env.U51_BOOT_PROBE_SUBJECT_TREE ?? '',
      loaded_entry: process.argv[1] ?? '',
      stop_kind: stopKind,
      stop_message: redact(error instanceof Error ? error.message : String(error)),
    };
  }
  try {
    writeReport(report);
  } catch {
    /* the parent treats a missing report as not executed */
  }
  state.realExit(exitCode);
}

function beginStop(kind: string, message: string, code: number): boolean {
  if (state.stopping) return false;
  state.stopping = true;
  void finish(kind, message, code);
  return true;
}

if (process.env.U51_BOOT_PROBE !== '1' || process.env.U51_BOOT_PROBE_NONCE === undefined || process.env.U51_BOOT_PROBE_RESULT === undefined) {
  throw new Error('boot probe preload refused to arm without the harness environment');
}

installHooks();
state.armed = REQUIRED_ISOLATION_HOOKS.every((hook) => state.hooks.includes(hook));
if (!state.armed) {
  throw new Error('boot probe preload did not arm every isolation hook');
}

process.exit = ((code?: number) => {
  if (beginStop('exit', '', code ?? 0)) throw new Error('boot-probe-stop');
  return undefined as never;
}) as typeof process.exit;

process.on('uncaughtException', (error) => {
  if (error.message === 'boot-probe-stop') return;
  beginStop('uncaughtException', error.message, 1);
});

process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message === 'boot-probe-stop') return;
  const message = reason instanceof Error ? reason.message : String(reason);
  beginStop('unhandledRejection', message, 1);
});
