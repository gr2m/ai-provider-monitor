#!/usr/bin/env node

import { Octokit } from ('@octokit/core');

/**
 * Script to create tags and releases when pull requests are merged
 * Triggered by GitHub Actions workflow on pull request merge
 */
async function main() {
  // Get environment variables
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY environment variable is required');
  }
  
  if (!prNumber) {
    throw new Error('PR_NUMBER environment variable is required');
  }
  
  const [owner, repo] = repository.split('/');
  const octokit = new Octokit({ auth: token });
  
  console.log(`Processing merged PR #${prNumber} in ${repository}`);
  
  try {
    // Get the merged pull request details
    const { data: pullRequest } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: parseInt(prNumber),
    });
    
    if (!pullRequest.merged) {
      console.log('Pull request is not merged, skipping release creation');
      return;
    }
    
    // Extract labels
    const labels = pullRequest.labels.map(label => label.name);
    console.log('Pull request labels:', labels);
    
    // Find provider and version labels
    const providerLabel = labels.find(label => label.startsWith('provider:'));
    const versionLabel = labels.find(label => label.startsWith('version:'));
    
    if (!providerLabel) {
      console.log('No provider label found, skipping release creation');
      return;
    }
    
    if (!versionLabel) {
      console.log('No version label found, skipping release creation');
      return;
    }
    
    const provider = providerLabel.replace('provider:', '');
    const versionType = versionLabel.replace('version:', '');
    
    console.log(`Provider: ${provider}, Version type: ${versionType}`);
    
    // Get existing tags for this provider
    const { data: tags } = await octokit.request('GET /repos/{owner}/{repo}/tags', {
      owner,
      repo,
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
    
    console.log('Existing provider tags:', providerTags.map(t => t.tag));
    
    // Calculate new version
    let newVersion;
    if (providerTags.length === 0) {
      // First version
      newVersion = versionType === 'breaking' ? '1.0.0' : '0.1.0';
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
    console.log(`Creating new tag: ${newTag}`);
    
    // Create the tag
    const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
      owner,
      repo,
      ref: pullRequest.merge_commit_sha,
    });
    
    await octokit.request('POST /repos/{owner}/{repo}/git/tags', {
      owner,
      repo,
      tag: newTag,
      message: `Release ${newTag}`,
      object: pullRequest.merge_commit_sha,
      type: 'commit',
    });
    
    // Create the reference for the tag
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/tags/${newTag}`,
      sha: pullRequest.merge_commit_sha,
    });
    
    console.log(`Tag ${newTag} created successfully`);
    
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
    
    console.log(`Release ${newTag} created successfully: ${release.html_url}`);
    
    // Output for GitHub Actions
    console.log(`::set-output name=tag::${newTag}`);
    console.log(`::set-output name=release_url::${release.html_url}`);
    
  } catch (error) {
    console.error('Error creating release:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };
