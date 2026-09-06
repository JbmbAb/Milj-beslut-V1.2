import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = resolve(process.cwd(), '.github/workflows/devgov-v0-orchestrate.yml');

function loadWorkflow() {
  return parse(readFileSync(workflowPath, 'utf8'));
}

describe('DEV-GOV proof-bound promotion orchestration', () => {
  it('binds promotion directly to completion of the canonical gate job', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = loadWorkflow();
    const promote = workflow.jobs.promote;

    expect(promote.needs).toContain('gate');
    expect(promote.environment).toBe('devgov-promoter');
    expect(source).toContain('gh run watch "$gate_run_id" --exit-status');
    expect(source).not.toContain('github-actions[bot]');
    expect(source).not.toContain('/commits/${CANDIDATE_SHA}/statuses');
    expect(source).not.toContain("context==='DEV-GOV-V0 / trusted-execution'");
  });

  it('keeps promoter authority out of plan, RED, GREEN and gate jobs', () => {
    const workflow = loadWorkflow();

    expect(JSON.stringify(workflow.jobs.plan)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.red)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.green)).not.toContain('DEVGOV_PROMOTER');
    expect(JSON.stringify(workflow.jobs.gate)).not.toContain('DEVGOV_PROMOTER');

    const promote = JSON.stringify(workflow.jobs.promote);
    expect(promote).toContain('DEVGOV_PROMOTER_APP_ID');
    expect(promote).toContain('DEVGOV_PROMOTER_PRIVATE_KEY_PEM');
  });

  it('uses the dedicated GitHub App token only inside the promoter job', () => {
    const workflow = loadWorkflow();
    const promoteJob = workflow.jobs.promote;
    const promote = JSON.stringify(promoteJob);
    const tokenStep = promoteJob.steps.find(
      (step: { uses?: string }) => step.uses === 'actions/create-github-app-token@v1',
    );

    expect(tokenStep).toBeTruthy();
    expect(tokenStep.with.repositories).toBe('${{ github.event.repository.name }}');
    expect(promote).toContain('x-access-token:${PROMOTER_TOKEN}@github.com/${GITHUB_REPOSITORY}.git');
    expect(promote).not.toContain('GITHUB_TOKEN');
    expect(promote).not.toContain('GH_TOKEN');
  });

  it('allows only a pure non-force fast-forward of the exact candidate SHA', () => {
    const source = readFileSync(workflowPath, 'utf8');

    expect(source).toContain('git merge-base --is-ancestor "$live_main" "$CANDIDATE_SHA"');
    expect(source).toContain('"${CANDIDATE_SHA}:refs/heads/main"');
    expect(source).not.toContain('--force');
    expect(source).not.toMatch(/git\s+push[^\n]*\s-f(?:\s|$)/);
    expect(source).not.toContain('git merge ');
    expect(source).not.toContain('git rebase ');
    expect(source).not.toContain('git cherry-pick ');
  });

  it('publishes PROMOTED only after remote main equals the exact candidate SHA', () => {
    const workflow = loadWorkflow();
    const state = workflow.jobs.state;
    const source = readFileSync(workflowPath, 'utf8');

    expect(state.needs).toContain('promote');
    expect(source).toContain("state: 'PROMOTED'");
    expect(source).toContain('test "$new_main" = "$CANDIDATE_SHA"');
  });

  it('cannot be triggered by pull_request and requires protected default-branch dispatch', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = loadWorkflow();

    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.workflow_dispatch).toBeTruthy();
    expect(source).toContain('test "$DISPATCH_REF" = "refs/heads/$DEFAULT_BRANCH"');
  });
});
