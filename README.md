# AI Provider API Changes

A GitHub Actions-powered service that monitors API specification changes from major AI providers and automatically creates pull requests when changes are detected. As pull requests are merged, releases are created with use full release notes based on the pull request description.

Additionally, if you want to get notified about some or all new releases, you can install the [ai-provider-monitor](https://github.com/apps/ai-provider-monitor) app on any repository, which will create repository dispatch event named `ai-provider-api-change/[provider slug]/[version]`, e.g. `ai-provider-api-change/openai/1.2.3`.

The version follows [semantic versioning](https://semver.org/) in the form of `[breaking version].[feature version].[fix version]`. In most cases that means

- **breaking version bump**: An API change was introduced that breaks prior behavior. That shouldn't happen, but when it does it's worth paying attention to.
- **feature version bump**: Something was added: a new API endpoint, a new parameter, or a new option for an existing parameter.
- **fix version bump**: updates to documentation, or typos in the spec.

## Get notified

You can "subscribe" to new releases

1. Install the [ai-provider-monitor](https://github.com/apps/ai-provider-monitor) app in your repository
2. Add a GitHub Action workflow to do something useful with it, such as creating an issue. Minimal example: [.github/workflows/notify-test.yml](.github/workflows/notify-test.yml)

## How it works

### Monitoring Changes

The repository uses GitHub Actions to monitor API specification changes from AI providers. When changes are detected, it automatically creates pull requests with:

- `provider:<provider-id>` label (e.g., `provider:openai`)
- `version:<type>` label where type is `breaking`, `feature`, or `fix`

### Automated Releases

When a pull request is merged, the automation:

1. **Calculates the new version** based on existing tags and the version label:
   - `breaking`: Increments major version (e.g., 1.2.3 → 2.0.0)
   - `feature`: Increments minor version (e.g., 1.2.3 → 1.3.0) 
   - `fix`: Increments patch version (e.g., 1.2.3 → 1.2.4)

2. **Creates a git tag** in the format `<provider>@<version>` (e.g., `openai@1.2.3`)

3. **Creates a GitHub release** using the tag name as the title and the pull request body as the description

## License

[ISC](LICENSE)