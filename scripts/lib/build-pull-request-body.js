export const MAX_PULL_REQUEST_BODY_BYTES = 60_000;

/**
 * Builds a provider update PR description while keeping the action input below
 * GitHub's body limit and Linux's per-argument limit. The committed change
 * files remain the complete source of truth when the summary is truncated.
 */
export function buildPullRequestBody(
  provider,
  allChanges,
  { maxBytes = MAX_PULL_REQUEST_BODY_BYTES } = {},
) {
  let body = "";
  const breaking = allChanges.filter((change) => change.breaking);
  const features = allChanges.filter(
    (change) =>
      !change.breaking && change.change !== "removed" && !change.doc_only,
  );
  const docFixes = allChanges.filter((change) => change.doc_only);

  for (const [heading, changes, trailingBlankLine] of [
    ["Breaking changes", breaking, true],
    ["New features", features, true],
    ["Documentation fixes", docFixes, false],
  ]) {
    if (changes.length === 0) continue;

    body += `### ${heading}\n\n`;
    for (const change of changes) {
      body += `- **${change.route}**: ${change.note}\n`;
    }
    if (trailingBlankLine) body += "\n";
  }

  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;

  const footer = `\n\n---\n\n_PR description truncated. Complete change records are committed under \`changes/${provider}/\`._`;
  const footerBytes = Buffer.byteLength(footer, "utf8");
  if (footerBytes > maxBytes) {
    throw new RangeError("maxBytes is too small for the truncation notice");
  }

  const prefixBudget = maxBytes - footerBytes;
  let prefix = "";
  let prefixBytes = 0;
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (prefixBytes + lineBytes > prefixBudget) break;
    prefix += line;
    prefixBytes += lineBytes;
  }

  return prefix.trimEnd() + footer;
}
