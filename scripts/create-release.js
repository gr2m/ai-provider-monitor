#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { Octokit } from 'octokit';
import * as core from '@actions/core';

// only execute if this file is the entry file
if (import.meta.url.endsWith(process.argv[1])) {
  if (!process.env.GITHUB_TOKEN) {
    core.setFailed('GITHUB_TOKEN environment variable is required');
    process.exit();
  }
  if (!process.env.GITHUB_EVENT_PATH) {
    core.setFailed('GITHUB_EVENT_PATH environment variable is required');
    process.exit();
  }

  const token = process.env.GITHUB_TOKEN;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

  const octokit = new Octokit({ auth: token });

  run(event, core, octokit);
}

/**
 * Script to create tags and releases when pull requests are merged
 * Triggered by GitHub Actions workflow on pull request merge
 * 
 * @param {import('@octokit/webhooks-types').PullRequestClosedEvent} event - The GitHub event
 * @param {import('@actions/core').Core} core - The Actions core instance
 * @param {import('octokit').Octokit} octokit - The Octokit instance
 */
export async function run(event, core, octokit) {
  const pullRequest = event.pull_request;
  core.info(`Processing ${pullRequest.html_url}`);

  if (!pullRequest.merged) {
    core.info('Pull request is not merged, skipping release creation');
    return;
  }

  // Extract labels
  const labels = pullRequest.labels.map(label => label.name);
  core.info(`Pull request labels: ${labels.join(', ')}`);

  // Find provider and version labels
  const providerLabel = labels.find(label => label.startsWith('provider:'));
  const versionLabel = labels.find(label => label.startsWith('version:'));

  if (!providerLabel) {
    core.info('No provider label found, skipping release creation');
    return;
  }

  if (!versionLabel) {
    core.info('No version label found, skipping release creation');
    return;
  }

  const provider = providerLabel.substring('provider:'.length);
  const versionType = versionLabel.substring('version:'.length);

  core.info(`Provider: ${provider}, Version type: ${versionType}`);

  // Get existing tags for this provider
  const tags = await octokit.paginate('GET /repos/{owner}/{repo}/tags', {
    owner: pullRequest.head.repo.owner.login,
    repo: pullRequest.head.repo.name,
    per_page: 100,
  });

  // Filter tags for this provider
  const providerTags = tags
    .filter(tag => tag.name.startsWith(`${provider}@`))
    .map(tag => {
      const version = tag.name.replace(`${provider}@`, '');
      const parts = version.split('.').map(Number);
      return {
        tag: tag.name,
        version,
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0,
      };
    })
    .sort((a, b) => {
      // Sort by semantic version (descending)
      if (a.major !== b.major) return b.major - a.major;
      if (a.minor !== b.minor) return b.minor - a.minor;
      return b.patch - a.patch;
    });

  core.info(`Existing provider tags: ${providerTags.map(t => t.tag).join(', ')}`);

  // Calculate new version
  let newVersion;
  if (providerTags.length === 0) {
    // First version
    newVersion = '1.0.0';
  } else {
    const latest = providerTags[0];
    let { major, minor, patch } = latest;

    switch (versionType) {
      case 'breaking':
        major += 1;
        minor = 0;
        patch = 0;
        break;
      case 'feature':
        minor += 1;
        patch = 0;
        break;
      case 'fix':
        patch += 1;
        break;
      default:
        throw new Error(`Unknown version type: ${versionType}`);
    }

    newVersion = `${major}.${minor}.${patch}`;
  }

  const newTag = `${provider}@${newVersion}`;
  core.info(`Creating new tag: ${newTag}`);

  // Create the tag
  await octokit.request('POST /repos/{owner}/{repo}/git/tags', {
    owner,
    repo,
    tag: newTag,
    message: `Release ${newTag}`,
    object: pullRequest.merge_commit_sha,
    type: 'commit',
  });

  core.info(`Tag ${newTag} created successfully`);

  // Create the release
  const { data: release } = await octokit.request('POST /repos/{owner}/{repo}/releases', {
    owner,
    repo,
    tag_name: newTag,
    name: newTag,
    body: pullRequest.body || '',
    draft: false,
    prerelease: false,
  });

  core.info(`Release ${newTag} created successfully: ${release.html_url}`);

  // Set outputs for GitHub Actions
  core.setOutput('tag', newTag);
  core.setOutput('release_url', release.html_url);
}
